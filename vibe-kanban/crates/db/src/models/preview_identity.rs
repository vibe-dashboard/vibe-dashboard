use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

const WORKSPACE_TOKEN_ATTEMPTS: usize = 16;
const REPO_SLUG_MAX_LEN: usize = 18;
const REPO_SLUG_SUFFIX_LEN: usize = 7;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkspacePreviewToken {
    pub workspace_id: Uuid,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RepoPreviewSlug {
    pub repo_id: Uuid,
    pub slug: String,
}

#[derive(Debug, Clone, FromRow)]
struct WorkspacePreviewTokenRow {
    pub workspace_id: Uuid,
    pub token: String,
}

#[derive(Debug, Clone, FromRow)]
struct RepoPreviewSlugRow {
    pub repo_id: Uuid,
    pub slug: String,
}

impl From<WorkspacePreviewTokenRow> for WorkspacePreviewToken {
    fn from(value: WorkspacePreviewTokenRow) -> Self {
        Self {
            workspace_id: value.workspace_id,
            token: value.token,
        }
    }
}

impl From<RepoPreviewSlugRow> for RepoPreviewSlug {
    fn from(value: RepoPreviewSlugRow) -> Self {
        Self {
            repo_id: value.repo_id,
            slug: value.slug,
        }
    }
}

pub fn normalize_repo_preview_slug(input: &str) -> String {
    let slug: String = input
        .chars()
        .filter_map(|ch| {
            let lower = ch.to_ascii_lowercase();
            if lower.is_ascii_lowercase() || lower.is_ascii_digit() {
                Some(lower)
            } else {
                None
            }
        })
        .take(REPO_SLUG_MAX_LEN)
        .collect();

    if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    }
}

fn repo_collision_slug(base: &str, repo_id: Uuid, attempt: usize) -> String {
    let repo_hex = repo_id.simple().to_string();
    let suffix_source = if attempt == 0 {
        repo_hex[..6].to_string()
    } else {
        format!("{}{:x}", &repo_hex[..5], attempt % 16)
    };
    let prefix_len = REPO_SLUG_MAX_LEN - REPO_SLUG_SUFFIX_LEN;
    let mut prefix: String = base.chars().take(prefix_len).collect();
    if prefix.is_empty() {
        prefix = "repo".to_string();
    }
    format!("{prefix}{suffix_source}")
}

fn random_workspace_token() -> String {
    Uuid::new_v4().simple().to_string()[..16].to_string()
}

impl WorkspacePreviewToken {
    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, WorkspacePreviewTokenRow>(
            r#"SELECT workspace_id, token
               FROM workspace_preview_tokens
               WHERE workspace_id = ?"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn ensure(pool: &SqlitePool, workspace_id: Uuid) -> Result<Self, sqlx::Error> {
        if let Some(existing) = Self::find_by_workspace_id(pool, workspace_id).await? {
            return Ok(existing);
        }

        for _ in 0..WORKSPACE_TOKEN_ATTEMPTS {
            let token = random_workspace_token();
            let result = sqlx::query(
                r#"INSERT INTO workspace_preview_tokens (workspace_id, token)
                   VALUES (?, ?)
                   ON CONFLICT(workspace_id) DO NOTHING"#,
            )
            .bind(workspace_id)
            .bind(&token)
            .execute(pool)
            .await;

            match result {
                Ok(_) => {
                    if let Some(existing) = Self::find_by_workspace_id(pool, workspace_id).await? {
                        return Ok(existing);
                    }
                }
                Err(sqlx::Error::Database(err)) if err.is_unique_violation() => continue,
                Err(err) => return Err(err),
            }
        }

        Err(sqlx::Error::Protocol(
            "failed to allocate unique workspace preview token".to_string(),
        ))
    }
}

impl RepoPreviewSlug {
    pub async fn find_by_repo_id(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, RepoPreviewSlugRow>(
            r#"SELECT repo_id, slug
               FROM repo_preview_slugs
               WHERE repo_id = ?"#,
        )
        .bind(repo_id)
        .fetch_optional(pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn ensure(
        pool: &SqlitePool,
        repo_id: Uuid,
        preferred_name: &str,
    ) -> Result<Self, sqlx::Error> {
        if let Some(existing) = Self::find_by_repo_id(pool, repo_id).await? {
            return Ok(existing);
        }

        let base = normalize_repo_preview_slug(preferred_name);
        let mut candidates = vec![base.clone()];
        candidates.extend((0..16).map(|attempt| repo_collision_slug(&base, repo_id, attempt)));

        for slug in candidates {
            let result = sqlx::query(
                r#"INSERT INTO repo_preview_slugs (repo_id, slug)
                   VALUES (?, ?)
                   ON CONFLICT(repo_id) DO NOTHING"#,
            )
            .bind(repo_id)
            .bind(&slug)
            .execute(pool)
            .await;

            match result {
                Ok(_) => {
                    if let Some(existing) = Self::find_by_repo_id(pool, repo_id).await? {
                        return Ok(existing);
                    }
                }
                Err(sqlx::Error::Database(err)) if err.is_unique_violation() => continue,
                Err(err) => return Err(err),
            }
        }

        Err(sqlx::Error::Protocol(
            "failed to allocate unique repo preview slug".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Executor, SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{RepoPreviewSlug, WorkspacePreviewToken, normalize_repo_preview_slug};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            r#"CREATE TABLE workspace_preview_tokens (
                workspace_id BLOB PRIMARY KEY,
                token TEXT NOT NULL UNIQUE,
                created_at DATETIME NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .await
        .unwrap();
        pool.execute(
            r#"CREATE TABLE repo_preview_slugs (
                repo_id BLOB PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                created_at DATETIME NOT NULL DEFAULT (datetime('now')),
                updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn workspace_token_is_stable_and_16_hex() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();

        let first = WorkspacePreviewToken::ensure(&pool, workspace_id)
            .await
            .unwrap();
        let second = WorkspacePreviewToken::ensure(&pool, workspace_id)
            .await
            .unwrap();

        assert_eq!(first.token, second.token);
        assert_eq!(first.token.len(), 16);
        assert!(first.token.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert!(first.token.chars().all(|ch| !ch.is_ascii_uppercase()));
    }

    #[tokio::test]
    async fn repo_slug_is_stable_and_collision_resolved() {
        let pool = test_pool().await;
        let first_repo_id = Uuid::new_v4();
        let second_repo_id = Uuid::new_v4();

        let first = RepoPreviewSlug::ensure(&pool, first_repo_id, "Vibe Kanban!!!")
            .await
            .unwrap();
        let second = RepoPreviewSlug::ensure(&pool, second_repo_id, "Vibe Kanban!!!")
            .await
            .unwrap();
        let renamed = RepoPreviewSlug::ensure(&pool, first_repo_id, "Renamed Repo")
            .await
            .unwrap();

        assert_eq!(first.slug, "vibekanban");
        assert_ne!(first.slug, second.slug);
        assert!(second.slug.starts_with("vibekanban"));
        assert!(second.slug.len() <= 18);
        assert_eq!(renamed.slug, first.slug);
    }

    #[test]
    fn normalizes_repo_slug_to_dashless_lower_alnum() {
        assert_eq!(
            normalize_repo_preview_slug("Vibe-Kanban Web!"),
            "vibekanbanweb"
        );
        assert_eq!(normalize_repo_preview_slug("---"), "repo");
        assert_eq!(
            normalize_repo_preview_slug("abcdefghijklmnopqrst"),
            "abcdefghijklmnopqr"
        );
    }
}
