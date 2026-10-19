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
    pub description: Option<String>,
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
    pub description: Option<String>,
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
            description: value.description,
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
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

impl PreviewSlot {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, run_config_id, slot_slug, title, description, enabled, created_at, updated_at
               FROM preview_slots
               WHERE run_config_id = ?
               ORDER BY slot_slug ASC, created_at ASC"#,
        )
        .bind(run_config_id)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn upsert(pool: &SqlitePool, input: &UpsertPreviewSlot) -> Result<Self, sqlx::Error> {
        let id = input.id.unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            r#"INSERT INTO preview_slots
               (id, repo_id, run_config_id, slot_slug, title, description, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 repo_id = excluded.repo_id,
                 run_config_id = excluded.run_config_id,
                 slot_slug = excluded.slot_slug,
                 title = excluded.title,
                 description = excluded.description,
                 enabled = excluded.enabled,
                 updated_at = datetime('now')"#,
        )
        .bind(id)
        .bind(input.repo_id)
        .bind(input.run_config_id)
        .bind(&input.slot_slug)
        .bind(&input.title)
        .bind(&input.description)
        .bind(input.enabled)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM preview_slots WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::UpsertPreviewSlot;

    #[test]
    fn upsert_description_round_trips_and_remains_optional() {
        let with_description: UpsertPreviewSlot = serde_json::from_value(serde_json::json!({
            "repo_id": "00000000-0000-0000-0000-000000000001",
            "run_config_id": "00000000-0000-0000-0000-000000000002",
            "slot_slug": "web",
            "title": "Web",
            "description": "Primary UI preview"
        }))
        .expect("description should deserialize");
        assert_eq!(
            with_description.description.as_deref(),
            Some("Primary UI preview")
        );
        assert_eq!(
            serde_json::to_value(with_description).unwrap()["description"],
            "Primary UI preview"
        );

        let without_description: UpsertPreviewSlot = serde_json::from_value(serde_json::json!({
            "repo_id": "00000000-0000-0000-0000-000000000001",
            "run_config_id": "00000000-0000-0000-0000-000000000002",
            "slot_slug": "web",
            "title": "Web"
        }))
        .expect("description should remain optional");
        assert_eq!(without_description.description, None);
    }
}
