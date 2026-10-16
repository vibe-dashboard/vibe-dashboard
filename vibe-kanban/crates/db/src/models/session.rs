use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use super::workspace_repo::WorkspaceRepo;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Session not found")]
    NotFound,
    #[error("Workspace not found")]
    WorkspaceNotFound,
    #[error("Executor mismatch: session uses {expected} but request specified {actual}")]
    ExecutorMismatch { expected: String, actual: String },
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Session {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: Option<String>,
    pub executor: Option<String>,
    pub agent_working_dir: Option<String>,
    pub context_reset_execution_process_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateSession {
    pub executor: Option<String>,
    pub name: Option<String>,
}

impl Session {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT id AS "id!: Uuid",
                      workspace_id AS "workspace_id!: Uuid",
                      name,
                      executor,
                      agent_working_dir,
                      context_reset_execution_process_id AS "context_reset_execution_process_id?: Uuid",
                      created_at AS "created_at!: DateTime<Utc>",
                      updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find all sessions for a workspace, ordered by most recently used.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT s.id AS "id!: Uuid",
                      s.workspace_id AS "workspace_id!: Uuid",
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.context_reset_execution_process_id AS "context_reset_execution_process_id?: Uuid",
                      s.created_at AS "created_at!: DateTime<Utc>",
                      s.updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions s
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = $1
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC"#,
            workspace_id
        )
        .fetch_all(pool)
        .await
    }

    /// Find the most recently used session for a workspace.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_latest_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT s.id AS "id!: Uuid",
                      s.workspace_id AS "workspace_id!: Uuid",
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.context_reset_execution_process_id AS "context_reset_execution_process_id?: Uuid",
                      s.created_at AS "created_at!: DateTime<Utc>",
                      s.updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions s
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = $1
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC
               LIMIT 1"#,
            workspace_id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find the first-created session for a workspace.
    /// This is a temporary policy for orchestrator MCP session discovery.
    pub async fn find_first_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT id,
                      workspace_id,
                      name,
                      executor,
                      agent_working_dir,
                      context_reset_execution_process_id,
                      created_at,
                      updated_at
               FROM sessions
               WHERE workspace_id = ?
               ORDER BY created_at ASC, id ASC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateSession,
        id: Uuid,
        workspace_id: Uuid,
    ) -> Result<Self, SessionError> {
        let agent_working_dir = Self::resolve_agent_working_dir(pool, workspace_id).await?;
        let name = data.name.as_deref().filter(|s| !s.is_empty());

        Ok(sqlx::query_as!(
            Session,
            r#"INSERT INTO sessions (id, workspace_id, name, executor, agent_working_dir)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id AS "id!: Uuid",
                         workspace_id AS "workspace_id!: Uuid",
                         name,
                         executor,
                         agent_working_dir,
                         context_reset_execution_process_id AS "context_reset_execution_process_id?: Uuid",
                         created_at AS "created_at!: DateTime<Utc>",
                         updated_at AS "updated_at!: DateTime<Utc>""#,
            id,
            workspace_id,
            name,
            data.executor,
            agent_working_dir
        )
        .fetch_one(pool)
        .await?)
    }

    async fn resolve_agent_working_dir(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace_id).await?;
        if repos.len() != 1 {
            return Ok(None);
        }

        let repo = &repos[0];
        let path = match repo.default_working_dir.as_deref() {
            Some(subdir) if !subdir.is_empty() => std::path::PathBuf::from(&repo.name).join(subdir),
            _ => std::path::PathBuf::from(&repo.name),
        };

        Ok(Some(path.to_string_lossy().to_string()))
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let name_value = name.filter(|s| !s.is_empty());
        let name_provided = name.is_some();

        sqlx::query!(
            r#"UPDATE sessions SET
                name = CASE WHEN $1 THEN $2 ELSE name END,
                updated_at = datetime('now', 'subsec')
            WHERE id = $3"#,
            name_provided,
            name_value,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_executor(
        pool: &SqlitePool,
        id: Uuid,
        executor: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE sessions SET executor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"#,
            executor,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn mark_context_cleared(
        pool: &SqlitePool,
        id: Uuid,
        execution_process_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"UPDATE sessions
               SET context_reset_execution_process_id = $2,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(execution_process_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Recompute the `/clear` context boundary after execution processes are
    /// soft-dropped.
    ///
    /// Reset/retry keeps historical rows but hides dropped processes from the
    /// visible timeline. If the previous boundary pointed at a dropped
    /// `/clear` process, future resume context must use the latest remaining
    /// non-dropped `/clear` process, or no boundary when none remains.
    pub async fn recompute_context_reset_boundary(
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        sqlx::query_scalar::<_, Option<Uuid>>(
            r#"UPDATE sessions
               SET context_reset_execution_process_id = (
                       SELECT ep.id
                         FROM execution_processes ep
                        WHERE ep.session_id = ?1
                          AND ep.dropped = FALSE
                          AND ep.run_reason = 'codingagent'
                          AND json_extract(ep.executor_action, '$.typ.type') = 'CodingAgentSessionCommandRequest'
                          AND json_extract(ep.executor_action, '$.typ.command.type') = 'clear'
                        ORDER BY ep.rowid DESC
                        LIMIT 1
                   ),
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1
         RETURNING context_reset_execution_process_id"#,
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use sqlx::{Executor, SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::Session;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        pool.execute(
            r#"CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                context_reset_execution_process_id BLOB NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();
        pool.execute(
            r#"CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                run_reason TEXT NOT NULL,
                executor_action TEXT NOT NULL,
                dropped BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

        pool
    }

    fn clear_action_json() -> String {
        serde_json::json!({
            "typ": {
                "type": "CodingAgentSessionCommandRequest",
                "command": { "type": "clear" },
                "prompt": "/clear",
                "session_id": null,
                "executor_config": { "executor": "claude_code" },
                "working_dir": null
            },
            "next_action": null
        })
        .to_string()
    }

    fn follow_up_action_json() -> String {
        serde_json::json!({
            "typ": {
                "type": "CodingAgentFollowUpRequest",
                "prompt": "continue",
                "session_id": "agent-session",
                "reset_to_message_id": null,
                "executor_config": { "executor": "claude_code" },
                "working_dir": null
            },
            "next_action": null
        })
        .to_string()
    }

    async fn insert_process(
        pool: &SqlitePool,
        session_id: Uuid,
        id: Uuid,
        action_json: String,
        dropped: bool,
    ) {
        sqlx::query(
            r#"INSERT INTO execution_processes (
                id, session_id, run_reason, executor_action, dropped, created_at
            )
            VALUES (?1, ?2, 'codingagent', ?3, ?4, CURRENT_TIMESTAMP)"#,
        )
        .bind(id)
        .bind(session_id)
        .bind(action_json)
        .bind(dropped)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn context_reset_boundary(pool: &SqlitePool, session_id: Uuid) -> Option<Uuid> {
        sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT context_reset_execution_process_id FROM sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn recompute_context_reset_boundary_ignores_dropped_clear_processes() {
        let pool = test_pool().await;
        let session_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let first_clear_id = Uuid::new_v4();
        let later_follow_up_id = Uuid::new_v4();
        let dropped_clear_id = Uuid::new_v4();

        sqlx::query(
            r#"INSERT INTO sessions (
                id, workspace_id, context_reset_execution_process_id, updated_at
            )
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)"#,
        )
        .bind(session_id)
        .bind(workspace_id)
        .bind(dropped_clear_id)
        .execute(&pool)
        .await
        .unwrap();

        insert_process(
            &pool,
            session_id,
            first_clear_id,
            clear_action_json(),
            false,
        )
        .await;
        insert_process(
            &pool,
            session_id,
            later_follow_up_id,
            follow_up_action_json(),
            false,
        )
        .await;
        insert_process(
            &pool,
            session_id,
            dropped_clear_id,
            clear_action_json(),
            true,
        )
        .await;

        let recomputed = Session::recompute_context_reset_boundary(&pool, session_id)
            .await
            .unwrap();

        assert_eq!(recomputed, Some(first_clear_id));
        assert_eq!(
            context_reset_boundary(&pool, session_id).await,
            Some(first_clear_id)
        );
    }

    #[tokio::test]
    async fn recompute_context_reset_boundary_clears_when_no_visible_clear_remains() {
        let pool = test_pool().await;
        let session_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let dropped_clear_id = Uuid::new_v4();
        let follow_up_id = Uuid::new_v4();

        sqlx::query(
            r#"INSERT INTO sessions (
                id, workspace_id, context_reset_execution_process_id, updated_at
            )
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)"#,
        )
        .bind(session_id)
        .bind(workspace_id)
        .bind(dropped_clear_id)
        .execute(&pool)
        .await
        .unwrap();

        insert_process(
            &pool,
            session_id,
            dropped_clear_id,
            clear_action_json(),
            true,
        )
        .await;
        insert_process(
            &pool,
            session_id,
            follow_up_id,
            follow_up_action_json(),
            false,
        )
        .await;

        let recomputed = Session::recompute_context_reset_boundary(&pool, session_id)
            .await
            .unwrap();

        assert_eq!(recomputed, None);
        assert_eq!(context_reset_boundary(&pool, session_id).await, None);
    }
}
