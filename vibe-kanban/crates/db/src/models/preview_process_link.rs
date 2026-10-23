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
    pub async fn find_latest_by_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id,
                      assigned_port, status_snapshot, started_at, updated_at, ended_at
               FROM preview_process_links AS link
               WHERE workspace_id = ?
                 AND preview_slot_id IS NOT NULL
                 AND id = (
                   SELECT candidate.id
                   FROM preview_process_links AS candidate
                   WHERE candidate.workspace_id = link.workspace_id
                     AND candidate.preview_slot_id = link.preview_slot_id
                   ORDER BY candidate.started_at DESC, candidate.id DESC
                   LIMIT 1
                 )
               ORDER BY started_at DESC, id DESC"#,
        )
        .bind(workspace_id)
        .fetch_all(pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

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

    pub async fn find_active_by_workspace_process(
        pool: &SqlitePool,
        workspace_id: Uuid,
        execution_process_id: Uuid,
        preview_slot_id: Option<Uuid>,
    ) -> Result<Option<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id,
                      assigned_port, status_snapshot, started_at, updated_at, ended_at
               FROM preview_process_links
               WHERE workspace_id = ? AND execution_process_id = ? AND ended_at IS NULL
               ORDER BY started_at DESC"#,
        )
        .bind(workspace_id)
        .bind(execution_process_id)
        .fetch_all(pool)
        .await?;

        rows.into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<Self>, sqlx::Error>>()?
            .into_iter()
            .find(|link| {
                preview_slot_id.is_none_or(|slot_id| link.preview_slot_id == Some(slot_id))
            })
            .map(Ok)
            .transpose()
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

    pub async fn find_oldest_active(pool: &SqlitePool) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewProcessLinkRow>(
            r#"SELECT ppl.id, ppl.workspace_id, ppl.repo_id, ppl.run_config_id,
                      ppl.preview_slot_id, ppl.execution_process_id, ppl.assigned_port,
                      ppl.status_snapshot, ppl.started_at, ppl.updated_at, ppl.ended_at
               FROM preview_process_links AS ppl
               JOIN execution_processes AS ep ON ep.id = ppl.execution_process_id
               WHERE ppl.ended_at IS NULL AND ep.status = 'running'
               ORDER BY ep.started_at ASC, ep.rowid ASC
               LIMIT 1"#,
        )
        .fetch_optional(pool)
        .await?;

        row.map(TryInto::try_into).transpose()
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

#[cfg(test)]
mod tests {
    use sqlx::{Executor, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{CreatePreviewProcessLink, PreviewProcessLink};

    #[tokio::test]
    async fn latest_workspace_links_returns_one_link_per_slot_in_one_query() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            r#"CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        )
        .await
        .unwrap();
        pool.execute(
            r#"CREATE TABLE preview_process_links (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                repo_id BLOB NOT NULL,
                run_config_id BLOB NOT NULL,
                preview_slot_id BLOB,
                execution_process_id BLOB NOT NULL,
                assigned_port INTEGER NOT NULL,
                status_snapshot TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                ended_at TEXT
            )"#,
        )
        .await
        .unwrap();

        let workspace_id = Uuid::new_v4();
        let slot_id = Uuid::new_v4();
        let first = create_link(&pool, workspace_id, Some(slot_id)).await;
        let latest = create_link(&pool, workspace_id, Some(slot_id)).await;
        let other_slot = create_link(&pool, workspace_id, Some(Uuid::new_v4())).await;
        let _unrelated = create_link(&pool, Uuid::new_v4(), Some(slot_id)).await;
        sqlx::query("UPDATE preview_process_links SET started_at = ? WHERE id = ?")
            .bind("2026-09-15 20:00:00")
            .bind(first.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE preview_process_links SET started_at = ? WHERE id = ?")
            .bind("2026-09-15 21:00:00")
            .bind(latest.id)
            .execute(&pool)
            .await
            .unwrap();

        let links = PreviewProcessLink::find_latest_by_workspace(&pool, workspace_id)
            .await
            .unwrap();

        assert_eq!(links.len(), 2);
        assert!(links.iter().any(|link| link.id == latest.id));
        assert!(links.iter().any(|link| link.id == other_slot.id));
        assert!(!links.iter().any(|link| link.id == first.id));
    }

    #[tokio::test]
    async fn active_workspace_process_lookup_requires_matching_workspace_slot_and_open_link() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        let process_id = Uuid::new_v4();
        let slot_id = Uuid::new_v4();
        let matching =
            create_link_with_process(&pool, workspace_id, process_id, Some(slot_id)).await;
        let _sibling_slot =
            create_link_with_process(&pool, workspace_id, process_id, Some(Uuid::new_v4())).await;
        let _other_workspace =
            create_link_with_process(&pool, Uuid::new_v4(), process_id, Some(slot_id)).await;
        let ended =
            create_link_with_process(&pool, workspace_id, Uuid::new_v4(), Some(slot_id)).await;
        PreviewProcessLink::mark_ended_for_process(
            &pool,
            ended.execution_process_id,
            super::PreviewProcessStatusSnapshot::Stopped,
        )
        .await
        .unwrap();

        let found = PreviewProcessLink::find_active_by_workspace_process(
            &pool,
            workspace_id,
            process_id,
            Some(slot_id),
        )
        .await
        .unwrap();

        assert_eq!(found.map(|link| link.id), Some(matching.id));
        assert!(
            PreviewProcessLink::find_active_by_workspace_process(
                &pool,
                workspace_id,
                process_id,
                Some(Uuid::new_v4()),
            )
            .await
            .unwrap()
            .is_none()
        );
    }

    #[tokio::test]
    async fn oldest_active_link_uses_insertion_order_to_break_timestamp_ties() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        let first = create_link(&pool, workspace_id, None).await;
        let second = create_link(&pool, workspace_id, None).await;
        let stopped = create_link(&pool, workspace_id, None).await;
        sqlx::query("UPDATE execution_processes SET started_at = ?")
            .bind("2026-10-23 01:00:00")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE execution_processes SET status = 'killed' WHERE id = ?")
            .bind(stopped.execution_process_id)
            .execute(&pool)
            .await
            .unwrap();

        let oldest = PreviewProcessLink::find_oldest_active(&pool)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(oldest.id, first.id);
        assert_ne!(oldest.id, second.id);
    }

    async fn create_link(
        pool: &sqlx::SqlitePool,
        workspace_id: Uuid,
        preview_slot_id: Option<Uuid>,
    ) -> PreviewProcessLink {
        create_link_with_process(pool, workspace_id, Uuid::new_v4(), preview_slot_id).await
    }

    async fn create_link_with_process(
        pool: &sqlx::SqlitePool,
        workspace_id: Uuid,
        execution_process_id: Uuid,
        preview_slot_id: Option<Uuid>,
    ) -> PreviewProcessLink {
        sqlx::query("INSERT OR IGNORE INTO execution_processes (id, status) VALUES (?, 'running')")
            .bind(execution_process_id)
            .execute(pool)
            .await
            .unwrap();
        PreviewProcessLink::create(
            pool,
            &CreatePreviewProcessLink {
                workspace_id,
                repo_id: Uuid::new_v4(),
                run_config_id: Uuid::new_v4(),
                preview_slot_id,
                execution_process_id,
                assigned_port: 4000,
            },
        )
        .await
        .unwrap()
    }

    async fn test_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            r#"CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        )
        .await
        .unwrap();
        pool.execute(
            r#"CREATE TABLE preview_process_links (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                repo_id BLOB NOT NULL,
                run_config_id BLOB NOT NULL,
                preview_slot_id BLOB,
                execution_process_id BLOB NOT NULL,
                assigned_port INTEGER NOT NULL,
                status_snapshot TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                ended_at TEXT
            )"#,
        )
        .await
        .unwrap();
        pool
    }
}
