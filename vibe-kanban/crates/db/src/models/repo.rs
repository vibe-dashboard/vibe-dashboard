use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::rust::double_option;
use sqlx::{Executor, FromRow, Sqlite, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use super::repo_dev_server_script::{RepoDevServerScript, UpdateRepoDevServerScript};

#[derive(Debug, Serialize, TS)]
pub struct SearchResult {
    pub path: String,
    pub is_file: bool,
    pub match_type: SearchMatchType,
    /// Ranking score based on git history (higher = more recently/frequently edited)
    #[serde(default)]
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
pub enum SearchMatchType {
    FileName,
    DirectoryName,
    FullPath,
}

#[derive(Debug, Error)]
pub enum RepoError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Repository not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Repo {
    pub id: Uuid,
    pub path: PathBuf,
    pub name: String,
    pub display_name: String,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub archive_script: Option<String>,
    pub copy_files: Option<String>,
    pub parallel_setup_script: bool,
    pub dev_server_script: Option<String>,
    #[serde(default)]
    pub dev_server_scripts: Vec<RepoDevServerScript>,
    pub default_target_branch: Option<String>,
    pub default_working_dir: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
struct RepoRow {
    pub id: Uuid,
    pub path: String,
    pub name: String,
    pub display_name: String,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub archive_script: Option<String>,
    pub copy_files: Option<String>,
    pub parallel_setup_script: bool,
    pub dev_server_script: Option<String>,
    pub default_target_branch: Option<String>,
    pub default_working_dir: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateRepo {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub display_name: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub setup_script: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub cleanup_script: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub archive_script: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub copy_files: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "boolean | null")]
    pub parallel_setup_script: Option<Option<bool>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub dev_server_script: Option<Option<String>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dev_server_scripts: Option<Vec<UpdateRepoDevServerScript>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub default_target_branch: Option<Option<String>>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub default_working_dir: Option<Option<String>>,
}

impl Repo {
    fn from_row(row: RepoRow, dev_server_scripts: Vec<RepoDevServerScript>) -> Self {
        Self {
            id: row.id,
            path: PathBuf::from(row.path),
            name: row.name,
            display_name: row.display_name,
            setup_script: row.setup_script,
            cleanup_script: row.cleanup_script,
            archive_script: row.archive_script,
            copy_files: row.copy_files,
            parallel_setup_script: row.parallel_setup_script,
            dev_server_script: row.dev_server_script,
            dev_server_scripts,
            default_target_branch: row.default_target_branch,
            default_working_dir: row.default_working_dir,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }

    async fn with_scripts(pool: &SqlitePool, rows: Vec<RepoRow>) -> Result<Vec<Self>, sqlx::Error> {
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let scripts_by_repo = RepoDevServerScript::find_by_repo_ids(pool, &ids).await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let scripts = scripts_by_repo.get(&row.id).cloned().unwrap_or_default();
                Self::from_row(row, scripts)
            })
            .collect())
    }

    fn normalize_dev_server_scripts(
        scripts: &[UpdateRepoDevServerScript],
    ) -> Result<Vec<UpdateRepoDevServerScript>, RepoError> {
        let mut normalized = Vec::with_capacity(scripts.len());

        for script in scripts {
            let name = script.name.trim().to_string();
            if name.is_empty() {
                return Err(RepoError::Validation(
                    "Dev server script name cannot be empty".to_string(),
                ));
            }

            let body = script.script.trim().to_string();
            if body.is_empty() {
                return Err(RepoError::Validation(
                    "Dev server script body cannot be empty".to_string(),
                ));
            }

            let working_dir = script
                .working_dir
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            normalized.push(UpdateRepoDevServerScript {
                id: script.id,
                name,
                script: body,
                working_dir,
                is_default: script.is_default,
            });
        }

        let default_count = normalized.iter().filter(|script| script.is_default).count();
        if let Some(first) = normalized.first_mut() {
            if default_count == 0 {
                first.is_default = true;
            } else if default_count > 1 {
                let mut seen_default = false;
                for script in &mut normalized {
                    if script.is_default {
                        if seen_default {
                            script.is_default = false;
                        } else {
                            seen_default = true;
                        }
                    }
                }
            }
        }

        Ok(normalized)
    }

    async fn replace_dev_server_scripts(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        repo_id: Uuid,
        scripts: &[UpdateRepoDevServerScript],
    ) -> Result<(), RepoError> {
        sqlx::query("DELETE FROM repo_dev_server_scripts WHERE repo_id = ?")
            .bind(repo_id)
            .execute(&mut **tx)
            .await?;

        for script in scripts {
            let script_id = script.id.unwrap_or_else(Uuid::new_v4);
            sqlx::query(
                r#"INSERT INTO repo_dev_server_scripts
                   (id, repo_id, name, script, working_dir, is_default)
                   VALUES (?, ?, ?, ?, ?, ?)"#,
            )
            .bind(script_id)
            .bind(repo_id)
            .bind(&script.name)
            .bind(&script.script)
            .bind(&script.working_dir)
            .bind(script.is_default)
            .execute(&mut **tx)
            .await?;
        }

        Ok(())
    }

    /// Get repos that still have the migration sentinel as their name.
    /// Used by the startup backfill to fix repo names.
    pub async fn list_needing_name_fix(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RepoRow>(
            r#"SELECT id,
                      path,
                      name,
                      display_name,
                      setup_script,
                      cleanup_script,
                      archive_script,
                      copy_files,
                      parallel_setup_script,
                      dev_server_script,
                      default_target_branch,
                      default_working_dir,
                      created_at,
                      updated_at
               FROM repos
               WHERE name = '__NEEDS_BACKFILL__'"#,
        )
        .fetch_all(pool)
        .await?;

        Self::with_scripts(pool, rows).await
    }

    pub async fn update_name(
        pool: &SqlitePool,
        id: Uuid,
        name: &str,
        display_name: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE repos SET name = $1, display_name = $2, updated_at = datetime('now', 'subsec') WHERE id = $3",
            name,
            display_name,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, RepoRow>(
            r#"SELECT id,
                      path,
                      name,
                      display_name,
                      setup_script,
                      cleanup_script,
                      archive_script,
                      copy_files,
                      parallel_setup_script,
                      dev_server_script,
                      default_target_branch,
                      default_working_dir,
                      created_at,
                      updated_at
               FROM repos
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        match row {
            Some(row) => {
                let scripts = RepoDevServerScript::find_by_repo_id(pool, row.id).await?;
                Ok(Some(Self::from_row(row, scripts)))
            }
            None => Ok(None),
        }
    }

    pub async fn find_by_ids(pool: &SqlitePool, ids: &[Uuid]) -> Result<Vec<Self>, sqlx::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch each repo individually since SQLite doesn't support array parameters
        let mut repos = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(repo) = Self::find_by_id(pool, *id).await? {
                repos.push(repo);
            }
        }
        Ok(repos)
    }

    pub async fn find_or_create<'e, E>(
        executor: E,
        path: &Path,
        display_name: &str,
    ) -> Result<Self, sqlx::Error>
    where
        E: Executor<'e, Database = Sqlite>,
    {
        let path_str = path.to_string_lossy().to_string();
        let id = Uuid::new_v4();
        let repo_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| id.to_string());

        // Use INSERT OR IGNORE + SELECT to handle race conditions atomically
        let row = sqlx::query_as::<_, RepoRow>(
            r#"INSERT INTO repos (id, path, name, display_name)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET updated_at = updated_at
               RETURNING id,
                         path,
                         name,
                         display_name,
                         setup_script,
                         cleanup_script,
                         archive_script,
                         copy_files,
                         parallel_setup_script,
                         dev_server_script,
                         default_target_branch,
                         default_working_dir,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(path_str)
        .bind(repo_name)
        .bind(display_name)
        .fetch_one(executor)
        .await?;

        Ok(Self::from_row(row, Vec::new()))
    }

    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RepoRow>(
            r#"SELECT id,
                      path,
                      name,
                      display_name,
                      setup_script,
                      cleanup_script,
                      archive_script,
                      copy_files,
                      parallel_setup_script,
                      dev_server_script,
                      default_target_branch,
                      default_working_dir,
                      created_at,
                      updated_at
               FROM repos
               ORDER BY display_name ASC"#,
        )
        .fetch_all(pool)
        .await?;

        Self::with_scripts(pool, rows).await
    }

    pub async fn list_by_recent_workspace_usage(
        pool: &SqlitePool,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RepoRow>(
            r#"SELECT r.id,
                      r.path,
                      r.name,
                      r.display_name,
                      r.setup_script,
                      r.cleanup_script,
                      r.archive_script,
                      r.copy_files,
                      r.parallel_setup_script,
                      r.dev_server_script,
                      r.default_target_branch,
                      r.default_working_dir,
                      r.created_at,
                      r.updated_at
               FROM repos r
               LEFT JOIN (
                   SELECT repo_id, MAX(updated_at) AS last_used_at
                   FROM workspace_repos
                   GROUP BY repo_id
               ) wr ON wr.repo_id = r.id
               ORDER BY wr.last_used_at DESC, r.display_name ASC"#,
        )
        .fetch_all(pool)
        .await?;

        Self::with_scripts(pool, rows).await
    }

    /// Returns the names of active (non-archived) workspaces that reference this repo.
    pub async fn active_workspace_names(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_scalar!(
            r#"SELECT w.name AS "name: String"
               FROM workspaces w
               JOIN workspace_repos wr ON wr.workspace_id = w.id
               WHERE wr.repo_id = $1
                 AND w.archived = FALSE"#,
            repo_id
        )
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|name| name.unwrap_or_else(|| "Unnamed workspace".to_string()))
            .collect())
    }

    /// Delete a repo by ID. Relies on ON DELETE CASCADE for workspace_repos / project_repos.
    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM repos WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        payload: &UpdateRepo,
    ) -> Result<Self, RepoError> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(RepoError::NotFound)?;

        // None = don't update (use existing)
        // Some(None) = set to NULL
        // Some(Some(v)) = set to v
        let display_name = match &payload.display_name {
            None => existing.display_name,
            Some(v) => v.clone().unwrap_or_default(),
        };
        let setup_script = match &payload.setup_script {
            None => existing.setup_script,
            Some(v) => v.clone(),
        };
        let cleanup_script = match &payload.cleanup_script {
            None => existing.cleanup_script,
            Some(v) => v.clone(),
        };
        let archive_script = match &payload.archive_script {
            None => existing.archive_script,
            Some(v) => v.clone(),
        };
        let copy_files = match &payload.copy_files {
            None => existing.copy_files,
            Some(v) => v.clone(),
        };
        let parallel_setup_script = match &payload.parallel_setup_script {
            None => existing.parallel_setup_script,
            Some(v) => v.unwrap_or(false),
        };
        let dev_server_script = match &payload.dev_server_script {
            None => existing.dev_server_script,
            Some(v) => v.clone(),
        };
        let default_target_branch = match &payload.default_target_branch {
            None => existing.default_target_branch,
            Some(v) => v.clone(),
        };
        let default_working_dir = match &payload.default_working_dir {
            None => existing.default_working_dir,
            Some(v) => v.clone(),
        };

        let mut tx = pool.begin().await?;

        let row = sqlx::query_as::<_, RepoRow>(
            r#"UPDATE repos
               SET display_name = ?,
                   setup_script = ?,
                   cleanup_script = ?,
                   archive_script = ?,
                   copy_files = ?,
                   parallel_setup_script = ?,
                   dev_server_script = ?,
                   default_target_branch = ?,
                   default_working_dir = ?,
                   updated_at = datetime('now', 'subsec')
               WHERE id = ?
               RETURNING id,
                         path,
                         name,
                         display_name,
                         setup_script,
                         cleanup_script,
                         archive_script,
                         copy_files,
                         parallel_setup_script,
                         dev_server_script,
                         default_target_branch,
                         default_working_dir,
                         created_at,
                         updated_at"#,
        )
        .bind(display_name)
        .bind(setup_script)
        .bind(cleanup_script)
        .bind(archive_script)
        .bind(copy_files)
        .bind(parallel_setup_script)
        .bind(dev_server_script.clone())
        .bind(default_target_branch)
        .bind(default_working_dir)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;

        if let Some(scripts) = &payload.dev_server_scripts {
            let normalized = Self::normalize_dev_server_scripts(scripts)?;
            let default_script = normalized
                .iter()
                .find(|script| script.is_default)
                .map(|script| script.script.clone());

            sqlx::query(
                "UPDATE repos SET dev_server_script = ?, updated_at = datetime('now', 'subsec') WHERE id = ?",
            )
            .bind(default_script)
            .bind(id)
            .execute(&mut *tx)
            .await?;

            Self::replace_dev_server_scripts(&mut tx, id, &normalized).await?;
        } else if payload.dev_server_script.is_some() && existing.dev_server_scripts.len() <= 1 {
            let normalized = match dev_server_script.as_ref() {
                Some(script) if !script.trim().is_empty() => vec![UpdateRepoDevServerScript {
                    id: existing.dev_server_scripts.first().map(|script| script.id),
                    name: existing
                        .dev_server_scripts
                        .first()
                        .map(|script| script.name.clone())
                        .unwrap_or_else(|| "Default".to_string()),
                    script: script.trim().to_string(),
                    working_dir: existing
                        .dev_server_scripts
                        .first()
                        .and_then(|script| script.working_dir.clone()),
                    is_default: true,
                }],
                _ => Vec::new(),
            };

            Self::replace_dev_server_scripts(&mut tx, id, &normalized).await?;
        }

        tx.commit().await?;

        Self::find_by_id(pool, row.id)
            .await?
            .ok_or(RepoError::NotFound)
    }
}
