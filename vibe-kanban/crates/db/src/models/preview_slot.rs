use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum PreviewSlotTarget {
    LocalRunConfig {
        run_config_id: Uuid,
    },
    ExternalRedirect {
        url_template: String,
        #[serde(default)]
        project_slug: Option<String>,
        allowed_host_template: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PreviewSlot {
    pub id: Uuid,
    pub repo_id: Uuid,
    /// Compatibility field for clients that predate tagged slot targets.
    pub run_config_id: Option<Uuid>,
    pub target: PreviewSlotTarget,
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
    pub target_type: String,
    pub run_config_id: Option<Uuid>,
    pub external_url_template: Option<String>,
    pub external_project_slug: Option<String>,
    pub external_allowed_host_template: Option<String>,
    pub slot_slug: String,
    pub title: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<PreviewSlotRow> for PreviewSlot {
    fn from(value: PreviewSlotRow) -> Self {
        let target = match value.target_type.as_str() {
            "local_run_config" => PreviewSlotTarget::LocalRunConfig {
                run_config_id: value
                    .run_config_id
                    .expect("local preview slot must have a run config"),
            },
            "external_redirect" => PreviewSlotTarget::ExternalRedirect {
                url_template: value
                    .external_url_template
                    .expect("external preview slot must have a URL template"),
                project_slug: value.external_project_slug,
                allowed_host_template: value
                    .external_allowed_host_template
                    .expect("external preview slot must have an allowed host template"),
            },
            other => panic!("unsupported preview slot target type: {other}"),
        };
        Self {
            id: value.id,
            repo_id: value.repo_id,
            run_config_id: value.run_config_id,
            target,
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
    #[serde(default)]
    pub run_config_id: Option<Uuid>,
    #[serde(default)]
    pub target: Option<PreviewSlotTarget>,
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

impl UpsertPreviewSlot {
    pub fn local_run_config_id(&self) -> Option<Uuid> {
        match self.target.as_ref() {
            Some(PreviewSlotTarget::LocalRunConfig { run_config_id }) => Some(*run_config_id),
            Some(PreviewSlotTarget::ExternalRedirect { .. }) => None,
            None => self.run_config_id,
        }
    }
}

impl PreviewSlot {
    pub fn local_run_config_id(&self) -> Option<Uuid> {
        match self.target {
            PreviewSlotTarget::LocalRunConfig { run_config_id } => Some(run_config_id),
            PreviewSlotTarget::ExternalRedirect { .. } => None,
        }
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, PreviewSlotRow>(
            r#"SELECT id, repo_id, target_type, run_config_id, external_url_template,
                      external_project_slug, external_allowed_host_template,
                      slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, target_type, run_config_id, external_url_template,
                      external_project_slug, external_allowed_host_template,
                      slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, target_type, run_config_id, external_url_template,
                      external_project_slug, external_allowed_host_template,
                      slot_slug, title, description, enabled, created_at, updated_at
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
            r#"SELECT id, repo_id, target_type, run_config_id, external_url_template,
                      external_project_slug, external_allowed_host_template,
                      slot_slug, title, description, enabled, created_at, updated_at
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
        let target = input.target.clone().or_else(|| {
            input
                .run_config_id
                .map(|run_config_id| PreviewSlotTarget::LocalRunConfig { run_config_id })
        });
        let Some(target) = target else {
            return Err(sqlx::Error::Protocol(
                "preview slot target is required".to_string(),
            ));
        };
        if input.target.is_some() && input.run_config_id.is_some() {
            return Err(sqlx::Error::Protocol(
                "provide target or legacy run_config_id, not both".to_string(),
            ));
        }
        let (
            target_type,
            run_config_id,
            external_url_template,
            external_project_slug,
            external_allowed_host_template,
        ) = match target {
            PreviewSlotTarget::LocalRunConfig { run_config_id } => {
                ("local_run_config", Some(run_config_id), None, None, None)
            }
            PreviewSlotTarget::ExternalRedirect {
                url_template,
                project_slug,
                allowed_host_template,
            } => (
                "external_redirect",
                None,
                Some(url_template),
                project_slug,
                Some(allowed_host_template),
            ),
        };
        sqlx::query(
            r#"INSERT INTO preview_slots
               (id, repo_id, target_type, run_config_id, external_url_template,
                external_project_slug, external_allowed_host_template, slot_slug, title, description, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 repo_id = excluded.repo_id,
                 target_type = excluded.target_type,
                 run_config_id = excluded.run_config_id,
                 external_url_template = excluded.external_url_template,
                 external_project_slug = excluded.external_project_slug,
                 external_allowed_host_template = excluded.external_allowed_host_template,
                 slot_slug = excluded.slot_slug,
                 title = excluded.title,
                 description = excluded.description,
                 enabled = excluded.enabled,
                 updated_at = datetime('now')"#,
        )
        .bind(id)
        .bind(input.repo_id)
        .bind(target_type)
        .bind(run_config_id)
        .bind(external_url_template)
        .bind(external_project_slug)
        .bind(external_allowed_host_template)
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
    use sqlx::{Executor, SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{PreviewSlot, PreviewSlotTarget, UpsertPreviewSlot};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            r#"CREATE TABLE preview_slots (
                id BLOB PRIMARY KEY,
                repo_id BLOB NOT NULL,
                target_type TEXT NOT NULL,
                run_config_id BLOB,
                external_url_template TEXT,
                external_project_slug TEXT,
                external_allowed_host_template TEXT,
                slot_slug TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                enabled BOOLEAN NOT NULL,
                created_at DATETIME NOT NULL DEFAULT (datetime('now')),
                updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
                CHECK (
                    (target_type = 'local_run_config' AND run_config_id IS NOT NULL
                        AND external_url_template IS NULL AND external_project_slug IS NULL
                        AND external_allowed_host_template IS NULL)
                    OR
                    (target_type = 'external_redirect' AND run_config_id IS NULL
                        AND external_url_template IS NOT NULL
                        AND external_allowed_host_template IS NOT NULL)
                )
            )"#,
        )
        .await
        .unwrap();
        pool
    }

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

    #[test]
    fn tagged_external_target_deserializes_without_legacy_run_config() {
        let input: UpsertPreviewSlot = serde_json::from_value(serde_json::json!({
            "repo_id": "00000000-0000-0000-0000-000000000001",
            "target": {
                "type": "external_redirect",
                "url_template": "https://{branchSlug}--dashboard.netlify.app",
                "project_slug": "dashboard",
                "allowed_host_template": "{branchSlug}--dashboard.netlify.app"
            },
            "slot_slug": "web",
            "title": "Web"
        }))
        .expect("external target should deserialize");

        assert_eq!(input.run_config_id, None);
        assert_eq!(
            input.target,
            Some(PreviewSlotTarget::ExternalRedirect {
                url_template: "https://{branchSlug}--dashboard.netlify.app".to_string(),
                project_slug: Some("dashboard".to_string()),
                allowed_host_template: "{branchSlug}--dashboard.netlify.app".to_string(),
            })
        );
    }

    #[tokio::test]
    async fn external_target_round_trips_through_storage() {
        let pool = test_pool().await;
        let input = UpsertPreviewSlot {
            id: None,
            repo_id: Uuid::new_v4(),
            run_config_id: None,
            target: Some(PreviewSlotTarget::ExternalRedirect {
                url_template: "https://{branchSlug}--dashboard.netlify.app".to_string(),
                project_slug: Some("dashboard".to_string()),
                allowed_host_template: "{branchSlug}--dashboard.netlify.app".to_string(),
            }),
            slot_slug: "web".to_string(),
            title: "Web".to_string(),
            description: None,
            enabled: true,
        };

        let slot = PreviewSlot::upsert(&pool, &input).await.unwrap();
        assert_eq!(slot.run_config_id, None);
        assert_eq!(slot.target, input.target.unwrap());
    }
}
