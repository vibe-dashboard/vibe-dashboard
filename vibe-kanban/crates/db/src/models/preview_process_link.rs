use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum PreviewProcessStatusSnapshot {
    Starting,
    Ready,
    Failed,
    Stopped,
}

impl PreviewProcessStatusSnapshot {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }
}

impl TryFrom<String> for PreviewProcessStatusSnapshot {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "starting" => Ok(Self::Starting),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            "stopped" => Ok(Self::Stopped),
            other => Err(format!("unknown preview process status snapshot: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PreviewProcessLink {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub preview_slot_id: Option<Uuid>,
    pub execution_process_id: Uuid,
    pub assigned_port: i64,
    pub status_snapshot: PreviewProcessStatusSnapshot,
    #[ts(type = "Date")]
    pub started_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
    #[ts(type = "Date | null")]
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
struct PreviewProcessLinkRow {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub preview_slot_id: Option<Uuid>,
    pub execution_process_id: Uuid,
    pub assigned_port: i64,
    pub status_snapshot: String,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

impl TryFrom<PreviewProcessLinkRow> for PreviewProcessLink {
    type Error = sqlx::Error;

    fn try_from(value: PreviewProcessLinkRow) -> Result<Self, Self::Error> {
        let status_snapshot = PreviewProcessStatusSnapshot::try_from(value.status_snapshot)
            .map_err(|err| {
                sqlx::Error::Decode(
                    std::io::Error::new(std::io::ErrorKind::InvalidData, err).into(),
                )
            })?;
        Ok(Self {
            id: value.id,
            workspace_id: value.workspace_id,
            repo_id: value.repo_id,
            run_config_id: value.run_config_id,
            preview_slot_id: value.preview_slot_id,
            execution_process_id: value.execution_process_id,
            assigned_port: value.assigned_port,
            status_snapshot,
            started_at: value.started_at,
            updated_at: value.updated_at,
            ended_at: value.ended_at,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CreatePreviewProcessLink {
    pub workspace_id: Uuid,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub preview_slot_id: Option<Uuid>,
    pub execution_process_id: Uuid,
    pub assigned_port: i64,
}

impl PreviewProcessLink {
    pub async fn find_active_by_slot(
        pool: &SqlitePool,
        workspace_id: Uuid,
        preview_slot_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id,
                      assigned_port, status_snapshot, started_at, updated_at, ended_at
               FROM preview_process_links
               WHERE workspace_id = ? AND preview_slot_id = ? AND ended_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .bind(preview_slot_id)
        .fetch_optional(pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    pub async fn find_active_by_config(
        pool: &SqlitePool,
        workspace_id: Uuid,
        run_config_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id,
                      assigned_port, status_snapshot, started_at, updated_at, ended_at
               FROM preview_process_links
               WHERE workspace_id = ? AND run_config_id = ? AND ended_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .bind(run_config_id)
        .fetch_optional(pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    pub async fn count_active(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
        let count: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*)
               FROM preview_process_links ppl
               JOIN execution_processes ep ON ep.id = ppl.execution_process_id
               WHERE ppl.ended_at IS NULL AND ep.status = 'running'"#,
        )
        .fetch_one(pool)
        .await?;

        Ok(count.0)
    }

    pub async fn create(
        pool: &SqlitePool,
        input: &CreatePreviewProcessLink,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO preview_process_links
               (id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id, assigned_port, status_snapshot)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(input.workspace_id)
        .bind(input.repo_id)
        .bind(input.run_config_id)
        .bind(input.preview_slot_id)
        .bind(input.execution_process_id)
        .bind(input.assigned_port)
        .bind(PreviewProcessStatusSnapshot::Starting.as_str())
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id,
                      assigned_port, status_snapshot, started_at, updated_at, ended_at
               FROM preview_process_links
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    pub async fn mark_ended_for_process(
        pool: &SqlitePool,
        execution_process_id: Uuid,
        status: PreviewProcessStatusSnapshot,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE preview_process_links
               SET status_snapshot = ?, ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now')
               WHERE execution_process_id = ? AND ended_at IS NULL"#,
        )
        .bind(status.as_str())
        .bind(execution_process_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_status_for_process(
        pool: &SqlitePool,
        execution_process_id: Uuid,
        status: PreviewProcessStatusSnapshot,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE preview_process_links
               SET status_snapshot = ?, updated_at = datetime('now')
               WHERE execution_process_id = ? AND ended_at IS NULL"#,
        )
        .bind(status.as_str())
        .bind(execution_process_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}
