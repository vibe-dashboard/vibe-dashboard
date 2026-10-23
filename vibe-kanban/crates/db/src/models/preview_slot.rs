use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PreviewSlot {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub slot_slug: String,
    pub title: String,
    pub enabled: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
struct PreviewSlotRow {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub slot_slug: String,
    pub title: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<PreviewSlotRow> for PreviewSlot {
    fn from(value: PreviewSlotRow) -> Self {
        Self {
            id: value.id,
            repo_id: value.repo_id,
            run_config_id: value.run_config_id,
            slot_slug: value.slot_slug,
            title: value.title,
            enabled: value.enabled,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpsertPreviewSlot {
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<Uuid>,
    pub repo_id: Uuid,
    pub run_config_id: Uuid,
    pub slot_slug: String,
    pub title: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

impl PreviewSlot {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, enabled, created_at, updated_at
               FROM preview_slots
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(Into::into))
    }

    pub async fn find_by_repo_slot(
        pool: &SqlitePool,
        repo_id: Uuid,
        slot_slug: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, enabled, created_at, updated_at
               FROM preview_slots
               WHERE repo_id = ? AND slot_slug = ?"#,
        )
        .bind(repo_id)
        .bind(slot_slug)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(Into::into))
    }

    pub async fn find_by_repo_id(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, enabled, created_at, updated_at
               FROM preview_slots
               WHERE repo_id = ?
               ORDER BY slot_slug ASC, created_at ASC"#,
        )
        .bind(repo_id)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn find_by_run_config_id(
        pool: &SqlitePool,
        run_config_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, enabled, created_at, updated_at
               FROM preview_slots
               WHERE run_config_id = ?
               ORDER BY slot_slug ASC, created_at ASC"#,
        )
        .bind(run_config_id)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM preview_slots WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn upsert(pool: &SqlitePool, input: &UpsertPreviewSlot) -> Result<Self, sqlx::Error> {
        let id = input.id.unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            r#"INSERT INTO preview_slots
               (id, repo_id, run_config_id, slot_slug, title, enabled)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 repo_id = excluded.repo_id,
                 run_config_id = excluded.run_config_id,
                 slot_slug = excluded.slot_slug,
                 title = excluded.title,
                 enabled = excluded.enabled,
                 updated_at = datetime('now')"#,
        )
        .bind(id)
        .bind(input.repo_id)
        .bind(input.run_config_id)
        .bind(&input.slot_slug)
        .bind(&input.title)
        .bind(input.enabled)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Executor, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{PreviewSlot, UpsertPreviewSlot};
    use crate::models::{
        run_config::{RunConfig, UpsertRunConfig},
        run_config_audit_event::{CreateRunConfigAuditEvent, RunConfigAuditEvent},
    };

    #[tokio::test]
    async fn deleting_preview_slot_preserves_shared_config_and_audit_history() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute("PRAGMA foreign_keys = ON").await.unwrap();
        pool.execute("CREATE TABLE repos (id BLOB PRIMARY KEY)")
            .await
            .unwrap();
        pool.execute("CREATE TABLE workspaces (id BLOB PRIMARY KEY)")
            .await
            .unwrap();
        pool.execute("CREATE TABLE execution_processes (id BLOB PRIMARY KEY)")
            .await
            .unwrap();
        pool.execute(include_str!(
            "../../migrations/20260810000000_add_run_configs_preview_slots.sql"
        ))
        .await
        .unwrap();
        let repo_id = Uuid::new_v4();
        sqlx::query("INSERT INTO repos (id) VALUES (?)")
            .bind(repo_id)
            .execute(&pool)
            .await
            .unwrap();
        let config_input: UpsertRunConfig = serde_json::from_value(serde_json::json!({
            "repo_id": repo_id, "slug": "web", "name": "Web",
            "command": "npm run dev", "kind": "long_running"
        }))
        .unwrap();
        let config = RunConfig::upsert(&pool, &config_input).await.unwrap();
        let slot_input: UpsertPreviewSlot = serde_json::from_value(serde_json::json!({
            "repo_id": repo_id, "run_config_id": config.id, "slot_slug": "web",
            "title": "Web", "enabled": false
        }))
        .unwrap();
        let slot = PreviewSlot::upsert(&pool, &slot_input).await.unwrap();
        let sibling_input: UpsertPreviewSlot = serde_json::from_value(serde_json::json!({
            "repo_id": repo_id, "run_config_id": config.id,
            "slot_slug": "other", "title": "Other"
        }))
        .unwrap();
        let sibling = PreviewSlot::upsert(&pool, &sibling_input).await.unwrap();
        RunConfigAuditEvent::create(
            &pool,
            &CreateRunConfigAuditEvent {
                workspace_id: None,
                repo_id: Some(repo_id),
                run_config_id: Some(config.id),
                preview_slot_id: Some(slot.id),
                execution_process_id: None,
                actor: "test".to_string(),
                event_type: "preview_slot.upsert".to_string(),
                details_json: None,
            },
        )
        .await
        .unwrap();

        let linked = PreviewSlot::find_by_run_config_id(&pool, config.id)
            .await
            .unwrap();
        assert_eq!(linked.len(), 2);
        assert!(
            linked
                .iter()
                .any(|entry| entry.id == slot.id && !entry.enabled)
        );
        PreviewSlot::delete(&pool, slot.id).await.unwrap();
        assert!(
            PreviewSlot::find_by_id(&pool, slot.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            PreviewSlot::find_by_id(&pool, sibling.id)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            RunConfig::find_by_id(&pool, config.id)
                .await
                .unwrap()
                .is_some()
        );
        let audit: (Option<Uuid>, Option<Uuid>) =
            sqlx::query_as("SELECT run_config_id, preview_slot_id FROM run_config_audit_events")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(audit, (Some(config.id), None));

        PreviewSlot::delete(&pool, sibling.id).await.unwrap();
        RunConfig::delete(&pool, config.id).await.unwrap();
        assert!(
            RunConfig::find_by_id(&pool, config.id)
                .await
                .unwrap()
                .is_none()
        );
        let audit: (Option<Uuid>, Option<Uuid>) =
            sqlx::query_as("SELECT run_config_id, preview_slot_id FROM run_config_audit_events")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(audit, (None, None));
    }
}
