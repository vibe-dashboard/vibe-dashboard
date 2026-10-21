use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::{repo::Repo, repo_dev_server_script::RepoDevServerScript};

pub fn branch_names_conflict_as_self_target(
    source_branch: &str,
    target_branch: &str,
    target_is_remote: bool,
) -> bool {
    source_branch == target_branch
        || (target_is_remote
            && target_branch
                .split_once('/')
                .is_some_and(|(_, short_target)| short_target == source_branch))
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkspaceRepo {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub repo_id: Uuid,
    pub target_branch: String,
    pub create_branch: bool,
    #[ts(optional, type = "string | null")]
    pub checkout_branch: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkspaceRepo {
    pub repo_id: Uuid,
    pub target_branch: String,
    pub create_branch: bool,
    #[ts(optional, type = "string | null")]
    pub checkout_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RepoWithTargetBranch {
    #[serde(flatten)]
    pub repo: Repo,
    pub target_branch: String,
    pub create_branch: bool,
    #[ts(optional, type = "string | null")]
    pub checkout_branch: Option<String>,
}

impl RepoWithTargetBranch {
    pub fn branch_name<'a>(&'a self, workspace_branch: &'a str) -> &'a str {
        if self.create_branch {
            workspace_branch
        } else {
            self.checkout_branch.as_deref().unwrap_or(workspace_branch)
        }
    }
}

/// Repo info with copy_files configuration.
#[derive(Debug, Clone)]
pub struct RepoWithCopyFiles {
    pub id: Uuid,
    pub path: PathBuf,
    pub name: String,
    pub copy_files: Option<String>,
}

impl WorkspaceRepo {
    pub fn branch_name<'a>(&'a self, workspace_branch: &'a str) -> &'a str {
        if self.create_branch {
            workspace_branch
        } else {
            self.checkout_branch.as_deref().unwrap_or(workspace_branch)
        }
    }

    pub async fn create_many(
        pool: &SqlitePool,
        workspace_id: Uuid,
        repos: &[CreateWorkspaceRepo],
    ) -> Result<Vec<Self>, sqlx::Error> {
        if repos.is_empty() {
            return Ok(Vec::new());
        }

        // Build bulk insert query with VALUES for each repo
        // SQLite doesn't have great support for bulk inserts with RETURNING,
        // so we'll use a transaction to batch the inserts efficiently
        let mut tx = pool.begin().await?;
        let mut results = Vec::with_capacity(repos.len());

        for repo in repos {
            let id = Uuid::new_v4();
            let workspace_repo = sqlx::query_as!(
                WorkspaceRepo,
                r#"INSERT INTO workspace_repos (id, workspace_id, repo_id, target_branch, create_branch, checkout_branch)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   RETURNING id as "id!: Uuid",
                             workspace_id as "workspace_id!: Uuid",
                             repo_id as "repo_id!: Uuid",
                             target_branch,
                             create_branch as "create_branch!: bool",
                             checkout_branch,
                             created_at as "created_at!: DateTime<Utc>",
                             updated_at as "updated_at!: DateTime<Utc>""#,
                id,
                workspace_id,
                repo.repo_id,
                repo.target_branch,
                repo.create_branch,
                repo.checkout_branch
            )
            .fetch_one(&mut *tx)
            .await?;
            results.push(workspace_repo);
        }

        tx.commit().await?;
        Ok(results)
    }

    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceRepo,
            r#"SELECT id as "id!: Uuid",
                      workspace_id as "workspace_id!: Uuid",
                      repo_id as "repo_id!: Uuid",
                      target_branch,
                      create_branch as "create_branch!: bool",
                      checkout_branch,
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM workspace_repos
               WHERE workspace_id = $1"#,
            workspace_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_repos_for_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Repo>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"SELECT r.id as "id!: Uuid",
                      r.path,
                      r.name,
                      r.display_name,
                      r.setup_script,
                      r.cleanup_script,
                      r.archive_script,
                      r.copy_files,
                      r.parallel_setup_script as "parallel_setup_script!: bool",
                      r.dev_server_script,
                      r.default_target_branch,
                      r.default_working_dir,
                      r.created_at as "created_at!: DateTime<Utc>",
                      r.updated_at as "updated_at!: DateTime<Utc>"
               FROM repos r
               JOIN workspace_repos wr ON r.id = wr.repo_id
               WHERE wr.workspace_id = $1
               ORDER BY r.display_name ASC"#,
            workspace_id
        )
        .fetch_all(pool)
        .await?;

        let scripts_by_repo = RepoDevServerScript::find_by_repo_ids(
            pool,
            &rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        )
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| Repo {
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
                dev_server_scripts: scripts_by_repo.get(&row.id).cloned().unwrap_or_default(),
                default_target_branch: row.default_target_branch,
                default_working_dir: row.default_working_dir,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
            .collect())
    }

    pub async fn find_repos_with_target_branch_for_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<RepoWithTargetBranch>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"SELECT r.id as "id!: Uuid",
                      r.path,
                      r.name,
                      r.display_name,
                      r.setup_script,
                      r.cleanup_script,
                      r.archive_script,
                      r.copy_files,
                      r.parallel_setup_script as "parallel_setup_script!: bool",
                      r.dev_server_script,
                      r.default_target_branch,
                      r.default_working_dir,
                      r.created_at as "created_at!: DateTime<Utc>",
                      r.updated_at as "updated_at!: DateTime<Utc>",
                      wr.target_branch,
                      wr.create_branch as "create_branch!: bool",
                      wr.checkout_branch
               FROM repos r
               JOIN workspace_repos wr ON r.id = wr.repo_id
               WHERE wr.workspace_id = $1
               ORDER BY r.display_name ASC"#,
            workspace_id
        )
        .fetch_all(pool)
        .await?;

        let scripts_by_repo = RepoDevServerScript::find_by_repo_ids(
            pool,
            &rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        )
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| RepoWithTargetBranch {
                repo: Repo {
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
                    dev_server_scripts: scripts_by_repo.get(&row.id).cloned().unwrap_or_default(),
                    default_target_branch: row.default_target_branch,
                    default_working_dir: row.default_working_dir,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                target_branch: row.target_branch,
                create_branch: row.create_branch,
                checkout_branch: row.checkout_branch,
            })
            .collect())
    }

    pub async fn find_by_workspace_and_repo_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
        repo_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceRepo,
            r#"SELECT id as "id!: Uuid",
                      workspace_id as "workspace_id!: Uuid",
                      repo_id as "repo_id!: Uuid",
                      target_branch,
                      create_branch as "create_branch!: bool",
                      checkout_branch,
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM workspace_repos
               WHERE workspace_id = $1 AND repo_id = $2"#,
            workspace_id,
            repo_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_workspace_and_repo_name(
        pool: &SqlitePool,
        workspace_id: Uuid,
        repo_name: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            WorkspaceRepo,
            r#"SELECT wr.id as "id!: Uuid",
                      wr.workspace_id as "workspace_id!: Uuid",
                      wr.repo_id as "repo_id!: Uuid",
                      wr.target_branch,
                      wr.create_branch as "create_branch!: bool",
                      wr.checkout_branch,
                      wr.created_at as "created_at!: DateTime<Utc>",
                      wr.updated_at as "updated_at!: DateTime<Utc>"
               FROM workspace_repos wr
               JOIN repos r ON r.id = wr.repo_id
               WHERE wr.workspace_id = $1 AND lower(r.name) = lower($2)"#,
            workspace_id,
            repo_name
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn delete_by_id(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM workspace_repos WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn update_target_branch(
        pool: &SqlitePool,
        workspace_id: Uuid,
        repo_id: Uuid,
        new_target_branch: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE workspace_repos SET target_branch = $1, updated_at = datetime('now') WHERE workspace_id = $2 AND repo_id = $3",
            new_target_branch,
            workspace_id,
            repo_id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_target_branch_for_children_of_workspace(
        pool: &SqlitePool,
        parent_workspace_id: Uuid,
        old_branch: &str,
        new_branch: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            r#"UPDATE workspace_repos
               SET target_branch = $1, updated_at = datetime('now')
               WHERE target_branch = $2
                 AND workspace_id IN (
                     SELECT w.id FROM workspaces w
                     JOIN tasks t ON w.task_id = t.id
                     WHERE t.parent_workspace_id = $3
                 )"#,
            new_branch,
            old_branch,
            parent_workspace_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Find repos for a workspace with their copy_files configuration.
    pub async fn find_repos_with_copy_files(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<RepoWithCopyFiles>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"SELECT r.id as "id!: Uuid", r.path, r.name, r.copy_files
               FROM repos r
               JOIN workspace_repos wr ON r.id = wr.repo_id
               WHERE wr.workspace_id = $1"#,
            workspace_id
        )
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| RepoWithCopyFiles {
                id: row.id,
                path: PathBuf::from(row.path),
                name: row.name,
                copy_files: row.copy_files,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::WorkspaceRepo;

    fn workspace_repo(create_branch: bool, checkout_branch: Option<&str>) -> WorkspaceRepo {
        WorkspaceRepo {
            id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            repo_id: Uuid::new_v4(),
            target_branch: "main".to_string(),
            create_branch,
            checkout_branch: checkout_branch.map(str::to_string),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn create_branch_repos_use_workspace_branch() {
        let repo = workspace_repo(true, Some("ignored-direct-branch"));

        assert_eq!(repo.branch_name("vk/workspace"), "vk/workspace");
    }

    #[test]
    fn direct_mode_repos_use_per_repo_checkout_branch() {
        let repo_a = workspace_repo(false, Some("feature-a"));
        let repo_b = workspace_repo(false, Some("feature-b"));

        assert_eq!(repo_a.branch_name("vk/workspace"), "feature-a");
        assert_eq!(repo_b.branch_name("vk/workspace"), "feature-b");
    }

    #[test]
    fn direct_mode_keeps_source_branch_distinct_from_target_branch() {
        let repo = workspace_repo(false, Some("feature"));

        assert_eq!(repo.branch_name("vk/workspace"), "feature");
        assert_eq!(repo.target_branch, "main");
        assert_ne!(repo.branch_name("vk/workspace"), repo.target_branch);
    }

    #[test]
    fn self_target_detection_handles_remote_tracking_branch_names() {
        assert!(super::branch_names_conflict_as_self_target(
            "main",
            "origin/main",
            true
        ));
        assert!(!super::branch_names_conflict_as_self_target(
            "feature",
            "origin/main",
            true
        ));
        assert!(!super::branch_names_conflict_as_self_target(
            "bar/baz",
            "foo/bar/baz",
            false
        ));
    }
}
