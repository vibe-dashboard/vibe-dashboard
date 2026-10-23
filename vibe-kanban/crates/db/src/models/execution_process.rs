use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use executors::{
    actions::{ExecutorAction, ExecutorActionType},
    profile::ExecutorProfileId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use super::{
    execution_process_repo_state::{CreateExecutionProcessRepoState, ExecutionProcessRepoState},
    repo::Repo,
    session::Session,
    workspace::Workspace,
    workspace_repo::WorkspaceRepo,
};

#[derive(Debug, Error)]
pub enum ExecutionProcessError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Execution process not found")]
    ExecutionProcessNotFound,
    #[error("Failed to create execution process: {0}")]
    CreateFailed(String),
    #[error("Failed to update execution process: {0}")]
    UpdateFailed(String),
    #[error("Invalid executor action format")]
    InvalidExecutorAction,
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Session {session_id} already has an active coding-agent turn")]
    SessionBusy { session_id: Uuid },
    #[error("Queue effect {queue_id} is already correlated to different work")]
    QueueEffectConflict { queue_id: Uuid },
    #[error("Queue effect {queue_id} has an unresolved prior start attempt")]
    QueueEffectIndeterminate { queue_id: Uuid },
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "execution_process_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ExecutionProcessStatus {
    Running,
    Completed,
    Failed,
    Killed,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "execution_process_run_reason", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionProcessRunReason {
    SetupScript,
    CleanupScript,
    ArchiveScript,
    CodingAgent,
    DevServer,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ExecutionProcess {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_reason: ExecutionProcessRunReason,
    #[ts(type = "ExecutorAction")]
    pub executor_action: sqlx::types::Json<ExecutorActionField>,
    pub status: ExecutionProcessStatus,
    pub exit_code: Option<i64>,
    /// dropped: true if this process is excluded from the current
    /// history view (due to restore/trimming). Hidden from logs/timeline;
    /// still listed in the Processes tab.
    pub dropped: bool,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateExecutionProcess {
    pub session_id: Uuid,
    pub executor_action: ExecutorAction,
    pub run_reason: ExecutionProcessRunReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
pub enum QueueEffectLifecycle {
    Reserved,
    Started,
    FailedBeforeStart,
    Indeterminate,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct QueueEffectReconciliation {
    pub queue_id: Uuid,
    pub owner: String,
    pub session_id: Uuid,
    pub requested_payload_fingerprint: String,
    pub lifecycle: QueueEffectLifecycle,
    pub process: Option<ExecutionProcess>,
}

pub enum QueueEffectReservation {
    Proceed,
    Started(Box<ExecutionProcess>),
}

#[derive(Debug)]
pub struct ExecutionContext {
    pub execution_process: ExecutionProcess,
    pub session: Session,
    pub workspace: Workspace,
    pub repos: Vec<Repo>,
}

/// Summary info about the latest execution process for a workspace
#[derive(Debug, Clone, FromRow)]
pub struct LatestProcessInfo {
    pub workspace_id: Uuid,
    pub execution_process_id: Uuid,
    pub session_id: Uuid,
    pub status: ExecutionProcessStatus,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExecutorActionField {
    ExecutorAction(ExecutorAction),
    Other(Value),
}

#[derive(Debug, Clone)]
pub struct MissingBeforeContext {
    pub id: Uuid,
    pub session_id: Uuid,
    pub workspace_id: Uuid,
    pub repo_id: Uuid,
    pub prev_after_head_commit: Option<String>,
    pub target_branch: String,
    pub repo_path: Option<String>,
}

impl ExecutionProcess {
    /// Find execution process by ID
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.id = ?"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Context for backfilling before_head_commit for legacy rows
    /// List processes that have after_head_commit set but missing before_head_commit, with join context
    pub async fn list_missing_before_context(
        pool: &SqlitePool,
    ) -> Result<Vec<MissingBeforeContext>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"SELECT
                ep.id                         as "id!: Uuid",
                ep.session_id                 as "session_id!: Uuid",
                s.workspace_id                as "workspace_id!: Uuid",
                eprs.repo_id                  as "repo_id!: Uuid",
                eprs.after_head_commit        as after_head_commit,
                prev.after_head_commit        as prev_after_head_commit,
                wr.target_branch              as "target_branch!",
                r.path                        as repo_path
            FROM execution_processes ep
            JOIN sessions s ON s.id = ep.session_id
            JOIN execution_process_repo_states eprs ON eprs.execution_process_id = ep.id
            JOIN repos r ON r.id = eprs.repo_id
            JOIN workspaces w ON w.id = s.workspace_id
            JOIN workspace_repos wr ON wr.workspace_id = w.id AND wr.repo_id = eprs.repo_id
            LEFT JOIN execution_process_repo_states prev
              ON prev.execution_process_id = (
                   SELECT id FROM execution_processes
                     WHERE session_id = ep.session_id
                       AND created_at < ep.created_at
                     ORDER BY created_at DESC
                     LIMIT 1
               )
              AND prev.repo_id = eprs.repo_id
            WHERE eprs.before_head_commit IS NULL
              AND eprs.after_head_commit IS NOT NULL"#
        )
        .fetch_all(pool)
        .await?;

        let result = rows
            .into_iter()
            .map(|r| MissingBeforeContext {
                id: r.id,
                session_id: r.session_id,
                workspace_id: r.workspace_id,
                repo_id: r.repo_id,
                prev_after_head_commit: r.prev_after_head_commit,
                target_branch: r.target_branch,
                repo_path: Some(r.repo_path),
            })
            .collect();
        Ok(result)
    }

    /// Find execution process by rowid
    pub async fn find_by_rowid(pool: &SqlitePool, rowid: i64) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.rowid = ?"#,
            rowid
        )
        .fetch_optional(pool)
        .await
    }

    /// Find all execution processes for a session (optionally include soft-deleted)
    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
        show_soft_deleted: bool,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                      ep.id              as "id!: Uuid",
                      ep.session_id      as "session_id!: Uuid",
                      ep.run_reason      as "run_reason!: ExecutionProcessRunReason",
                      ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                      ep.status          as "status!: ExecutionProcessStatus",
                      ep.exit_code,
                      ep.dropped as "dropped!: bool",
                      ep.started_at      as "started_at!: DateTime<Utc>",
                      ep.completed_at    as "completed_at?: DateTime<Utc>",
                      ep.created_at      as "created_at!: DateTime<Utc>",
                      ep.updated_at      as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep
               WHERE ep.session_id = ?
                 AND (? OR ep.dropped = FALSE)
               ORDER BY ep.created_at ASC"#,
            session_id,
            show_soft_deleted
        )
        .fetch_all(pool)
        .await
    }

    /// Find running execution processes
    pub async fn find_running(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.status = 'running' ORDER BY ep.created_at ASC"#,
        )
        .fetch_all(pool)
        .await
    }

    /// Check if there's a running coding agent process for a session
    pub async fn has_running_coding_agent_for_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!: i64"
               FROM execution_processes ep
               WHERE ep.session_id = $1
                 AND ep.status = 'running'
                 AND ep.run_reason = 'codingagent'"#,
            session_id
        )
        .fetch_one(pool)
        .await?;
        Ok(count > 0)
    }

    /// Check if there are running processes (excluding dev servers) for a workspace (across all sessions)
    pub async fn has_running_non_dev_server_processes_for_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!: i64"
               FROM execution_processes ep
               JOIN sessions s ON ep.session_id = s.id
               WHERE s.workspace_id = $1
                 AND ep.status = 'running'
                 AND ep.run_reason != 'devserver'"#,
            workspace_id
        )
        .fetch_one(pool)
        .await?;
        Ok(count > 0)
    }

    /// Find running dev servers for a specific workspace (across all sessions)
    pub async fn find_running_dev_servers_by_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"
        SELECT
            ep.id as "id!: Uuid",
            ep.session_id as "session_id!: Uuid",
            ep.run_reason as "run_reason!: ExecutionProcessRunReason",
            ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
            ep.status as "status!: ExecutionProcessStatus",
            ep.exit_code,
            ep.dropped as "dropped!: bool",
            ep.started_at as "started_at!: DateTime<Utc>",
            ep.completed_at as "completed_at?: DateTime<Utc>",
            ep.created_at as "created_at!: DateTime<Utc>",
            ep.updated_at as "updated_at!: DateTime<Utc>"
        FROM execution_processes ep
        JOIN sessions s ON ep.session_id = s.id
        WHERE s.workspace_id = ?
          AND ep.status = 'running'
          AND ep.run_reason = 'devserver'
        ORDER BY ep.created_at DESC
        "#,
            workspace_id
        )
        .fetch_all(pool)
        .await
    }

    /// Find latest execution process by session and run reason
    /// Find latest execution process by workspace and run reason (across all sessions)
    pub async fn find_latest_by_workspace_and_run_reason(
        pool: &SqlitePool,
        workspace_id: Uuid,
        run_reason: &ExecutionProcessRunReason,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep
               JOIN sessions s ON ep.session_id = s.id
               WHERE s.workspace_id = ? AND ep.run_reason = ? AND ep.dropped = FALSE
               ORDER BY ep.created_at DESC LIMIT 1"#,
            workspace_id,
            run_reason
        )
        .fetch_optional(pool)
        .await
    }

    /// Create a new execution process
    ///
    /// Note: We intentionally avoid using a transaction here. SQLite update
    /// hooks fire during transactions (before commit), and the hook spawns an
    /// async task that queries `find_by_rowid` on a different connection.
    /// If we used a transaction, that query would not see the uncommitted row,
    /// causing the WebSocket event to be lost.
    pub async fn create(
        pool: &SqlitePool,
        data: &CreateExecutionProcess,
        process_id: Uuid,
        repo_states: &[CreateExecutionProcessRepoState],
    ) -> Result<Self, ExecutionProcessError> {
        let now = Utc::now();
        let executor_action_json = sqlx::types::Json(&data.executor_action);

        if let Err(error) = sqlx::query!(
            r#"INSERT INTO execution_processes (
                    id, session_id, run_reason, executor_action,
                    status, exit_code, started_at, completed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            process_id,
            data.session_id,
            data.run_reason,
            executor_action_json,
            ExecutionProcessStatus::Running,
            None::<i64>,
            now,
            None::<DateTime<Utc>>,
            now,
            now
        )
        .execute(pool)
        .await
        {
            if data.run_reason == ExecutionProcessRunReason::CodingAgent
                && is_single_active_turn_violation(&error)
            {
                return Err(ExecutionProcessError::SessionBusy {
                    session_id: data.session_id,
                });
            }
            return Err(error.into());
        }

        if let Err(error) =
            ExecutionProcessRepoState::create_many(pool, process_id, repo_states).await
        {
            let _ = Self::update_completion(pool, process_id, ExecutionProcessStatus::Failed, None)
                .await;
            return Err(error.into());
        }

        match Self::find_by_id(pool, process_id).await {
            Ok(Some(process)) => Ok(process),
            Ok(None) => {
                let _ =
                    Self::update_completion(pool, process_id, ExecutionProcessStatus::Failed, None)
                        .await;
                Err(ExecutionProcessError::ExecutionProcessNotFound)
            }
            Err(error) => {
                let _ =
                    Self::update_completion(pool, process_id, ExecutionProcessStatus::Failed, None)
                        .await;
                Err(error.into())
            }
        }
    }

    pub async fn reserve_queue_effect(
        pool: &SqlitePool,
        queue_id: Uuid,
        owner: &str,
        process_id: Uuid,
        data: &CreateExecutionProcess,
        requested_payload_fingerprint: &str,
    ) -> Result<QueueEffectReservation, ExecutionProcessError> {
        let action = serde_json::to_string(&data.executor_action)
            .map_err(|error| ExecutionProcessError::CreateFailed(error.to_string()))?;
        let run_reason = serde_json::to_string(&data.run_reason)
            .map_err(|error| ExecutionProcessError::CreateFailed(error.to_string()))?;
        let inserted = sqlx::query(
            "INSERT INTO execution_process_queue_effects (queue_id, owner, execution_process_id, session_id, requested_payload_fingerprint, run_reason, executor_action, lifecycle) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved') ON CONFLICT(queue_id) DO NOTHING",
        )
        .bind(queue_id)
        .bind(owner)
        .bind(process_id)
        .bind(data.session_id)
        .bind(requested_payload_fingerprint)
        .bind(&run_reason)
        .bind(&action)
        .execute(pool)
        .await?;
        if inserted.rows_affected() == 1 {
            return Ok(QueueEffectReservation::Proceed);
        }

        let row = sqlx::query_as::<_, (String, Uuid, Uuid, String, String, String, String)>(
            "SELECT owner, execution_process_id, session_id, requested_payload_fingerprint, run_reason, executor_action, lifecycle FROM execution_process_queue_effects WHERE queue_id = ?",
        )
        .bind(queue_id)
        .fetch_one(pool)
        .await?;
        if row.0 != owner
            || row.2 != data.session_id
            || row.3 != requested_payload_fingerprint
            || row.4 != run_reason
            || row.5 != action
        {
            return Err(ExecutionProcessError::QueueEffectConflict { queue_id });
        }
        match row.6.as_str() {
            "started" => Self::find_by_id(pool, row.1)
                .await?
                .map(|process| QueueEffectReservation::Started(Box::new(process)))
                .ok_or(ExecutionProcessError::ExecutionProcessNotFound),
            "failed_before_start" => {
                let changed = sqlx::query("UPDATE execution_process_queue_effects SET execution_process_id = ?, lifecycle = 'reserved', updated_at = datetime('now', 'subsec') WHERE queue_id = ? AND lifecycle = 'failed_before_start'")
                    .bind(process_id)
                    .bind(queue_id)
                    .execute(pool)
                    .await?;
                if changed.rows_affected() == 1 {
                    Ok(QueueEffectReservation::Proceed)
                } else {
                    Err(ExecutionProcessError::QueueEffectIndeterminate { queue_id })
                }
            }
            "reserved" | "indeterminate" => {
                Err(ExecutionProcessError::QueueEffectIndeterminate { queue_id })
            }
            value => Err(ExecutionProcessError::CreateFailed(format!(
                "unknown queue effect lifecycle {value}"
            ))),
        }
    }

    pub async fn set_queue_effect_lifecycle(
        pool: &SqlitePool,
        queue_id: Uuid,
        process_id: Uuid,
        lifecycle: QueueEffectLifecycle,
    ) -> Result<(), ExecutionProcessError> {
        let lifecycle = match lifecycle {
            QueueEffectLifecycle::Reserved => "reserved",
            QueueEffectLifecycle::Started => "started",
            QueueEffectLifecycle::FailedBeforeStart => "failed_before_start",
            QueueEffectLifecycle::Indeterminate => "indeterminate",
        };
        let result = sqlx::query("UPDATE execution_process_queue_effects SET lifecycle = ?, updated_at = datetime('now', 'subsec') WHERE queue_id = ? AND execution_process_id = ?")
            .bind(lifecycle)
            .bind(queue_id)
            .bind(process_id)
            .execute(pool)
            .await?;
        if result.rows_affected() != 1 {
            return Err(ExecutionProcessError::QueueEffectConflict { queue_id });
        }
        Ok(())
    }

    pub async fn reconcile_queue_effect(
        pool: &SqlitePool,
        queue_id: Uuid,
    ) -> Result<Option<QueueEffectReconciliation>, ExecutionProcessError> {
        let row = sqlx::query_as::<_, (String, Uuid, Uuid, String, String)>(
            "SELECT owner, execution_process_id, session_id, requested_payload_fingerprint, lifecycle FROM execution_process_queue_effects WHERE queue_id = ?",
        )
        .bind(queue_id)
        .fetch_optional(pool)
        .await?;
        let Some((owner, process_id, session_id, requested_payload_fingerprint, lifecycle)) = row
        else {
            return Ok(None);
        };
        let lifecycle = match lifecycle.as_str() {
            "reserved" => QueueEffectLifecycle::Reserved,
            "started" => QueueEffectLifecycle::Started,
            "failed_before_start" => QueueEffectLifecycle::FailedBeforeStart,
            "indeterminate" => QueueEffectLifecycle::Indeterminate,
            value => {
                return Err(ExecutionProcessError::CreateFailed(format!(
                    "unknown queue effect lifecycle {value}"
                )));
            }
        };
        let process = Self::find_by_id(pool, process_id).await?;
        Ok(Some(QueueEffectReconciliation {
            queue_id,
            owner,
            session_id,
            requested_payload_fingerprint,
            lifecycle,
            process,
        }))
    }

    pub async fn was_stopped(pool: &SqlitePool, id: Uuid) -> bool {
        if let Ok(exp_process) = Self::find_by_id(pool, id).await
            && exp_process.is_some_and(|ep| {
                ep.status == ExecutionProcessStatus::Killed
                    || ep.status == ExecutionProcessStatus::Completed
            })
        {
            return true;
        }
        false
    }

    /// Update execution process status and completion info
    pub async fn update_completion(
        pool: &SqlitePool,
        id: Uuid,
        status: ExecutionProcessStatus,
        exit_code: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        let completed_at = if matches!(status, ExecutionProcessStatus::Running) {
            None
        } else {
            Some(Utc::now())
        };

        sqlx::query!(
            r#"UPDATE execution_processes
               SET status = $1, exit_code = $2, completed_at = $3
               WHERE id = $4"#,
            status,
            exit_code,
            completed_at,
            id
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub fn executor_action(&self) -> Result<&ExecutorAction, anyhow::Error> {
        match &self.executor_action.0 {
            ExecutorActionField::ExecutorAction(action) => Ok(action),
            ExecutorActionField::Other(_) => Err(anyhow::anyhow!(
                "Executor action is not a valid ExecutorAction JSON object"
            )),
        }
    }

    /// Soft-drop processes at and after the specified boundary (inclusive)
    pub async fn drop_at_and_after(
        pool: &SqlitePool,
        session_id: Uuid,
        boundary_process_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let result = sqlx::query!(
            r#"UPDATE execution_processes
               SET dropped = TRUE
             WHERE session_id = $1
               AND created_at >= (SELECT created_at FROM execution_processes WHERE id = $2)
               AND dropped = FALSE"#,
            session_id,
            boundary_process_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected() as i64)
    }

    /// Find the previous process's after_head_commit before the given boundary process
    /// for a specific repository
    pub async fn find_prev_after_head_commit(
        pool: &SqlitePool,
        session_id: Uuid,
        boundary_process_id: Uuid,
        repo_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let result = sqlx::query_scalar!(
            r#"SELECT eprs.after_head_commit
               FROM execution_process_repo_states eprs
               JOIN execution_processes ep ON ep.id = eprs.execution_process_id
              WHERE ep.session_id = $1
                AND eprs.repo_id = $2
                AND ep.created_at < (SELECT created_at FROM execution_processes WHERE id = $3)
              ORDER BY ep.created_at DESC
              LIMIT 1"#,
            session_id,
            repo_id,
            boundary_process_id
        )
        .fetch_optional(pool)
        .await?;
        Ok(result.flatten())
    }

    /// Get both the parent Workspace and Session for this execution process
    pub async fn parent_workspace_and_session(
        &self,
        pool: &SqlitePool,
    ) -> Result<Option<(Workspace, Session)>, sqlx::Error> {
        let session = match Session::find_by_id(pool, self.session_id).await? {
            Some(s) => s,
            None => return Ok(None),
        };
        let workspace = match Workspace::find_by_id(pool, session.workspace_id).await? {
            Some(w) => w,
            None => return Ok(None),
        };
        Ok(Some((workspace, session)))
    }

    /// Load execution context with related session, workspace, task, project, and repos
    pub async fn load_context(
        pool: &SqlitePool,
        exec_id: Uuid,
    ) -> Result<ExecutionContext, sqlx::Error> {
        let execution_process = Self::find_by_id(pool, exec_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let session = Session::find_by_id(pool, execution_process.session_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let workspace = Workspace::find_by_id(pool, session.workspace_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;

        Ok(ExecutionContext {
            execution_process,
            session,
            workspace,
            repos,
        })
    }

    /// Fetch the latest CodingAgent executor profile for a session.
    /// Returns None if no CodingAgent execution process exists for this session.
    pub async fn latest_executor_profile_for_session(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Option<ExecutorProfileId>, ExecutionProcessError> {
        // Find the latest CodingAgent execution process for this session
        let latest_execution_process = sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep
               WHERE ep.session_id = ? AND ep.run_reason = ? AND ep.dropped = FALSE
               ORDER BY ep.created_at DESC LIMIT 1"#,
            session_id,
            ExecutionProcessRunReason::CodingAgent
        )
        .fetch_optional(pool)
        .await?;

        let Some(latest_execution_process) = latest_execution_process else {
            return Ok(None);
        };

        let action = latest_execution_process
            .executor_action()
            .map_err(|e| ExecutionProcessError::ValidationError(e.to_string()))?;

        match &action.typ {
            ExecutorActionType::CodingAgentInitialRequest(request) => {
                Ok(Some(request.executor_config.profile_id()))
            }
            ExecutorActionType::CodingAgentFollowUpRequest(request) => {
                Ok(Some(request.executor_config.profile_id()))
            }
            ExecutorActionType::CodingAgentSessionCommandRequest(request) => {
                Ok(Some(request.executor_config.profile_id()))
            }
            ExecutorActionType::ReviewRequest(request) => {
                Ok(Some(request.executor_config.profile_id()))
            }
            _ => Err(ExecutionProcessError::ValidationError(
                "Couldn't find profile from initial request".to_string(),
            )),
        }
    }

    /// Fetch latest execution process info for all workspaces with the given archived status.
    /// Returns a map of workspace_id -> LatestProcessInfo for the most recent
    /// non-dropped execution process (excluding dev servers).
    pub async fn find_latest_for_workspaces(
        pool: &SqlitePool,
        archived: bool,
    ) -> Result<HashMap<Uuid, LatestProcessInfo>, sqlx::Error> {
        let rows: Vec<LatestProcessInfo> = sqlx::query_as!(
            LatestProcessInfo,
            r#"
            SELECT
                workspace_id as "workspace_id!: Uuid",
                execution_process_id as "execution_process_id!: Uuid",
                session_id as "session_id!: Uuid",
                status as "status!: ExecutionProcessStatus",
                completed_at as "completed_at?: DateTime<Utc>"
            FROM (
                SELECT
                    s.workspace_id,
                    ep.id as execution_process_id,
                    ep.session_id,
                    ep.status,
                    ep.completed_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY s.workspace_id
                        ORDER BY ep.created_at DESC
                    ) as rn
                FROM execution_processes ep
                JOIN sessions s ON ep.session_id = s.id
                JOIN workspaces w ON s.workspace_id = w.id
                WHERE w.archived = $1
                  AND ep.run_reason IN ('codingagent', 'setupscript', 'cleanupscript')
                  AND ep.dropped = FALSE
            )
            WHERE rn = 1
            "#,
            archived
        )
        .fetch_all(pool)
        .await?;

        let result = rows
            .into_iter()
            .map(|info| (info.workspace_id, info))
            .collect();

        Ok(result)
    }

    /// Find all workspaces with running dev servers, filtered by archived status.
    /// Returns a set of workspace IDs that have at least one running dev server.
    pub async fn find_workspaces_with_running_dev_servers(
        pool: &SqlitePool,
        archived: bool,
    ) -> Result<HashSet<Uuid>, sqlx::Error> {
        let rows: Vec<Uuid> = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT s.workspace_id as "workspace_id!: Uuid"
            FROM execution_processes ep
            JOIN sessions s ON ep.session_id = s.id
            JOIN workspaces w ON s.workspace_id = w.id
            WHERE w.archived = $1
              AND ep.status = 'running'
              AND ep.run_reason = 'devserver'
            "#,
            archived
        )
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().collect())
    }
}

fn is_single_active_turn_violation(error: &sqlx::Error) -> bool {
    error.as_database_error().is_some_and(|database| {
        database.is_unique_violation()
            && database
                .message()
                .contains("execution_processes.session_id")
    })
}

#[cfg(test)]
mod admission_tests {
    use std::collections::HashMap;

    use executors::actions::{
        ExecutorActionType,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    };
    use sqlx::{Executor, sqlite::SqlitePoolOptions};

    use super::*;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            "CREATE TABLE sessions (
                id BLOB PRIMARY KEY
            )",
        )
        .await
        .unwrap();
        pool.execute(
            "CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                status TEXT NOT NULL,
                run_reason TEXT NOT NULL,
                executor_action TEXT NOT NULL DEFAULT '{}',
                exit_code INTEGER,
                dropped INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
                updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
            )",
        )
        .await
        .unwrap();
        pool
    }

    fn script_action(script: &str) -> ExecutorAction {
        ExecutorAction::new(
            ExecutorActionType::ScriptRequest(ScriptRequest {
                script: script.to_string(),
                language: ScriptRequestLanguage::Bash,
                context: ScriptContext::SetupScript,
                working_dir: None,
                env: HashMap::new(),
            }),
            None,
        )
    }

    async fn apply_admission_migration(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::raw_sql(include_str!(
            "../../migrations/20261020000000_enforce_single_active_coding_agent.sql"
        ))
        .execute(pool)
        .await
        .map(|_| ())
    }

    async fn insert(
        pool: &SqlitePool,
        id: Uuid,
        session_id: Uuid,
        status: &str,
        run_reason: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO execution_processes (id, session_id, status, run_reason)
             VALUES (?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session_id)
        .bind(status)
        .bind(run_reason)
        .execute(pool)
        .await
        .map(|_| ())
    }

    #[tokio::test]
    async fn database_admission_allows_only_one_running_coding_agent() {
        let pool = pool().await;
        apply_admission_migration(&pool).await.unwrap();
        let session = Uuid::new_v4();

        insert(&pool, Uuid::new_v4(), session, "running", "codingagent")
            .await
            .unwrap();
        let conflict = insert(&pool, Uuid::new_v4(), session, "running", "codingagent")
            .await
            .unwrap_err();
        assert!(is_single_active_turn_violation(&conflict));

        insert(&pool, Uuid::new_v4(), session, "running", "setupscript")
            .await
            .unwrap();
        sqlx::query(
            "UPDATE execution_processes SET status = 'completed' WHERE run_reason = 'codingagent'",
        )
        .execute(&pool)
        .await
        .unwrap();
        insert(&pool, Uuid::new_v4(), session, "running", "codingagent")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn migration_fails_closed_on_preexisting_overlap() {
        let pool = pool().await;
        let session = Uuid::new_v4();
        for _ in 0..2 {
            insert(&pool, Uuid::new_v4(), session, "running", "codingagent")
                .await
                .unwrap();
        }

        let error = apply_admission_migration(&pool).await.unwrap_err();
        assert!(
            error
                .as_database_error()
                .is_some_and(|db| db.is_unique_violation())
        );
    }

    #[tokio::test]
    async fn queue_effect_retries_only_failed_before_start_and_never_replays_indeterminate() {
        let pool = pool().await;
        apply_admission_migration(&pool).await.unwrap();
        let queue_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        sqlx::query("INSERT INTO sessions (id) VALUES (?)")
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();
        let first_process = Uuid::new_v4();
        let data = CreateExecutionProcess {
            session_id,
            executor_action: script_action("echo one"),
            run_reason: ExecutionProcessRunReason::SetupScript,
        };

        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                first_process,
                &data,
                "sha256:test",
            )
            .await
            .unwrap(),
            QueueEffectReservation::Proceed
        ));
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                Uuid::new_v4(),
                &data,
                "sha256:test",
            )
            .await,
            Err(ExecutionProcessError::QueueEffectIndeterminate { .. })
        ));
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                Uuid::new_v4(),
                &data,
                "sha256:changed-payload",
            )
            .await,
            Err(ExecutionProcessError::QueueEffectConflict { .. })
        ));

        ExecutionProcess::set_queue_effect_lifecycle(
            &pool,
            queue_id,
            first_process,
            QueueEffectLifecycle::FailedBeforeStart,
        )
        .await
        .unwrap();
        let retry_process = Uuid::new_v4();
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                retry_process,
                &data,
                "sha256:test",
            )
            .await
            .unwrap(),
            QueueEffectReservation::Proceed
        ));
        ExecutionProcess::set_queue_effect_lifecycle(
            &pool,
            queue_id,
            retry_process,
            QueueEffectLifecycle::Indeterminate,
        )
        .await
        .unwrap();
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                Uuid::new_v4(),
                &data,
                "sha256:test",
            )
            .await,
            Err(ExecutionProcessError::QueueEffectIndeterminate { .. })
        ));
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "other-owner",
                Uuid::new_v4(),
                &data,
                "sha256:test",
            )
            .await,
            Err(ExecutionProcessError::QueueEffectConflict { .. })
        ));
        let reconciliation = ExecutionProcess::reconcile_queue_effect(&pool, queue_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reconciliation.owner, "workflow");
        assert_eq!(reconciliation.queue_id, queue_id);
        assert_eq!(reconciliation.session_id, session_id);
    }

    #[tokio::test]
    async fn started_queue_effect_replays_the_exact_durable_process() {
        let pool = pool().await;
        apply_admission_migration(&pool).await.unwrap();
        let queue_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        sqlx::query("INSERT INTO sessions (id) VALUES (?)")
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();
        let process_id = Uuid::new_v4();
        let data = CreateExecutionProcess {
            session_id,
            executor_action: script_action("echo started"),
            run_reason: ExecutionProcessRunReason::SetupScript,
        };

        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                process_id,
                &data,
                "sha256:test"
            )
            .await
            .unwrap(),
            QueueEffectReservation::Proceed
        ));
        let created = ExecutionProcess::create(&pool, &data, process_id, &[])
            .await
            .unwrap();
        ExecutionProcess::set_queue_effect_lifecycle(
            &pool,
            queue_id,
            process_id,
            QueueEffectLifecycle::Started,
        )
        .await
        .unwrap();

        let replay = ExecutionProcess::reserve_queue_effect(
            &pool,
            queue_id,
            "workflow",
            Uuid::new_v4(),
            &data,
            "sha256:test",
        )
        .await
        .unwrap();
        let QueueEffectReservation::Started(replayed) = replay else {
            panic!("started queue effect did not replay its process");
        };
        assert_eq!(replayed.id, created.id);
        let reconciliation = ExecutionProcess::reconcile_queue_effect(&pool, queue_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reconciliation.lifecycle, QueueEffectLifecycle::Started);
        assert_eq!(reconciliation.process.unwrap().id, created.id);
    }

    #[tokio::test]
    async fn indeterminate_tracked_process_holds_admission_and_refuses_replay() {
        let pool = pool().await;
        apply_admission_migration(&pool).await.unwrap();
        let queue_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        sqlx::query("INSERT INTO sessions (id) VALUES (?)")
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();
        let process_id = Uuid::new_v4();
        let data = CreateExecutionProcess {
            session_id,
            executor_action: script_action("sleep 30"),
            run_reason: ExecutionProcessRunReason::CodingAgent,
        };
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                process_id,
                &data,
                "sha256:test"
            )
            .await
            .unwrap(),
            QueueEffectReservation::Proceed
        ));
        ExecutionProcess::create(&pool, &data, process_id, &[])
            .await
            .unwrap();
        ExecutionProcess::set_queue_effect_lifecycle(
            &pool,
            queue_id,
            process_id,
            QueueEffectLifecycle::Indeterminate,
        )
        .await
        .unwrap();

        assert!(matches!(
            ExecutionProcess::create(&pool, &data, Uuid::new_v4(), &[]).await,
            Err(ExecutionProcessError::SessionBusy { .. })
        ));
        assert!(matches!(
            ExecutionProcess::reserve_queue_effect(
                &pool,
                queue_id,
                "workflow",
                Uuid::new_v4(),
                &data,
                "sha256:test",
            )
            .await,
            Err(ExecutionProcessError::QueueEffectIndeterminate { .. })
        ));
    }
}
