use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RepoDevServerScript {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub name: String,
    pub script: String,
    pub working_dir: Option<String>,
    pub is_default: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
struct RepoDevServerScriptRow {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub name: String,
    pub script: String,
    pub working_dir: Option<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<RepoDevServerScriptRow> for RepoDevServerScript {
    fn from(value: RepoDevServerScriptRow) -> Self {
        Self {
            id: value.id,
            repo_id: value.repo_id,
            name: value.name,
            script: value.script,
            working_dir: value.working_dir,
            is_default: value.is_default,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateRepoDevServerScript {
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<Uuid>,
    pub name: String,
    pub script: String,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

impl RepoDevServerScript {
    pub async fn find_by_repo_id(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RepoDevServerScriptRow>(
            r#"SELECT id,
                      repo_id,
                      name,
                      script,
                      working_dir,
                      is_default,
                      created_at,
                      updated_at
               FROM repo_dev_server_scripts
               WHERE repo_id = ?
               ORDER BY is_default DESC, name ASC, created_at ASC"#,
        )
        .bind(repo_id)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn find_by_repo_ids(
        pool: &SqlitePool,
        repo_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<Self>>, sqlx::Error> {
        let mut result = HashMap::with_capacity(repo_ids.len());

        for repo_id in repo_ids {
            result.insert(*repo_id, Self::find_by_repo_id(pool, *repo_id).await?);
        }

        Ok(result)
    }
}
