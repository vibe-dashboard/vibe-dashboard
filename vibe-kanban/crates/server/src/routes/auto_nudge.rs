use axum::{
    Json as RequestJson, Router,
    extract::State,
    response::Json as ResponseJson,
    routing::post,
};
use chrono::{DateTime, Utc};
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    session::Session,
    workspace::Workspace,
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const DEFAULT_LIMIT_WORKSPACES: i64 = 25;
const DEFAULT_LIMIT_SESSIONS: usize = 250;
const MAX_LIMIT_WORKSPACES: i64 = 100;
const MAX_LIMIT_SESSIONS: usize = 1_000;

#[derive(Debug, Deserialize)]
pub struct AutoNudgeStatusRequest {
    #[serde(default)]
    registered_workspace_ids: Vec<Uuid>,
    #[serde(default)]
    include_global_recent: bool,
    global_cursor: Option<String>,
    updated_after: DateTime<Utc>,
    #[serde(default)]
    limit_workspaces: Option<i64>,
    #[serde(default)]
    limit_sessions: Option<usize>,
    #[serde(default)]
    process_window_queries: Vec<AutoNudgeProcessWindowQuery>,
}

#[derive(Debug, Deserialize)]
pub struct AutoNudgeProcessWindowQuery {
    id: String,
    session_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeStatusResponse {
    workspaces: Vec<AutoNudgeStatusWorkspace>,
    process_window_results: Vec<AutoNudgeProcessWindowResult>,
    next_cursor: Option<String>,
    truncated: bool,
    counts: AutoNudgeStatusCounts,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeStatusCounts {
    registered_workspaces: usize,
    global_workspaces: usize,
    sessions: usize,
    processes: usize,
    pages: usize,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeStatusWorkspace {
    workspace_id: Uuid,
    archived: bool,
    registered: bool,
    sessions: Vec<AutoNudgeStatusSession>,
    has_active_codingagent: bool,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeStatusSession {
    id: Uuid,
    workspace_id: Uuid,
    executor: String,
    name: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    latest_codingagent_process: Option<AutoNudgeStatusProcess>,
    has_active_codingagent: bool,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeStatusProcess {
    #[serde(flatten)]
    process: ExecutionProcess,
    // Broad auto-nudge scan is DB-only. Completed-turn assistant text remains
    // available through the exact /final-response endpoint, not this aggregate.
    final_response: Option<String>,
    terminal_no_response: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AutoNudgeProcessWindowResult {
    id: String,
    process_ids: Vec<Uuid>,
}

async fn session_status(
    State(deployment): State<DeploymentImpl>,
    RequestJson(request): RequestJson<AutoNudgeStatusRequest>,
) -> Result<ResponseJson<ApiResponse<AutoNudgeStatusResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    Ok(ResponseJson(ApiResponse::success(build_status(pool, request).await?)))
}

async fn build_status(
    pool: &sqlx::SqlitePool,
    request: AutoNudgeStatusRequest,
) -> Result<AutoNudgeStatusResponse, ApiError> {
    let limit_workspaces = request
        .limit_workspaces
        .unwrap_or(DEFAULT_LIMIT_WORKSPACES)
        .clamp(0, MAX_LIMIT_WORKSPACES);
    let limit_sessions = request
        .limit_sessions
        .unwrap_or(DEFAULT_LIMIT_SESSIONS)
        .min(MAX_LIMIT_SESSIONS);

    let mut workspaces = Vec::new();
    for workspace_id in unique_uuids(&request.registered_workspace_ids) {
        if let Some(workspace) = Workspace::find_by_id(pool, workspace_id).await? {
            workspaces.push((workspace, true));
        }
    }

    let global_offset = request
        .global_cursor
        .as_deref()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let mut global_workspaces = Vec::new();
    if request.include_global_recent && limit_workspaces > 0 {
        global_workspaces = sqlx::query_as::<_, Workspace>(
            r#"SELECT id,
                      task_id,
                      container_ref,
                      branch,
                      setup_completed_at,
                      created_at,
                      updated_at,
                      archived,
                      pinned,
                      name,
                      worktree_deleted
               FROM workspaces
               WHERE archived = FALSE
                 AND worktree_deleted = FALSE
                 AND updated_at >= $1
               ORDER BY updated_at DESC, id ASC
               LIMIT ?2 OFFSET ?3"#,
        )
        .bind(request.updated_after)
        .bind(limit_workspaces)
        .bind(global_offset)
        .fetch_all(pool)
        .await?;
        let registered = request.registered_workspace_ids.iter().copied().collect::<std::collections::HashSet<_>>();
        for workspace in global_workspaces.iter().filter(|workspace| !registered.contains(&workspace.id)) {
            workspaces.push((workspace.clone(), false));
        }
    }

    let mut global_session_budget = limit_sessions;
    let mut workspace_statuses = Vec::new();
    let mut session_count = 0;
    let mut process_count = 0;
    for (workspace, registered) in workspaces {
        if !registered && global_session_budget == 0 {
            break;
        }
        let sessions = Session::find_by_workspace_id(pool, workspace.id).await?;
        let mut session_statuses = Vec::new();
        for session in sessions {
            if !registered {
                if global_session_budget == 0 {
                    break;
                }
                global_session_budget -= 1;
            }
            session_count += 1;
            let latest = latest_codingagent_process(pool, session.id).await?;
            if latest.is_some() {
                process_count += 1;
            }
            let has_active = latest
                .as_ref()
                .is_some_and(|process| is_active_codingagent(process));
            session_statuses.push(AutoNudgeStatusSession {
                id: session.id,
                workspace_id: session.workspace_id,
                executor: session.executor.unwrap_or_else(|| "CODEX".to_string()),
                name: session.name,
                created_at: session.created_at,
                updated_at: session.updated_at,
                latest_codingagent_process: latest.map(status_process),
                has_active_codingagent: has_active,
            });
        }
        let has_active_codingagent = session_statuses
            .iter()
            .any(|session| session.has_active_codingagent);
        workspace_statuses.push(AutoNudgeStatusWorkspace {
            workspace_id: workspace.id,
            archived: workspace.archived,
            registered,
            sessions: session_statuses,
            has_active_codingagent,
        });
    }

    let mut process_window_results = Vec::new();
    for query in request.process_window_queries {
        let rows = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id
               FROM execution_processes
               WHERE session_id = ?1
                 AND run_reason = 'codingagent'
                 AND dropped = FALSE
                 AND created_at >= ?2
                 AND created_at <= ?3
               ORDER BY created_at ASC, id ASC"#,
        )
        .bind(query.session_id)
        .bind(query.started_at)
        .bind(query.ended_at)
        .fetch_all(pool)
        .await?;
        process_window_results.push(AutoNudgeProcessWindowResult {
            id: query.id,
            process_ids: rows,
        });
    }

    let truncated = request.include_global_recent
        && (global_workspaces.len() as i64) == limit_workspaces;
    let next_cursor = if truncated {
        Some((global_offset + limit_workspaces).to_string())
    } else {
        None
    };

    Ok(AutoNudgeStatusResponse {
        counts: AutoNudgeStatusCounts {
            registered_workspaces: request.registered_workspace_ids.len(),
            global_workspaces: workspace_statuses.iter().filter(|workspace| !workspace.registered).count(),
            sessions: session_count,
            processes: process_count,
            pages: 1,
        },
        workspaces: workspace_statuses,
        process_window_results,
        next_cursor,
        truncated,
    })
}

async fn latest_codingagent_process(
    pool: &sqlx::SqlitePool,
    session_id: Uuid,
) -> Result<Option<ExecutionProcess>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionProcess>(
        r#"SELECT ep.id,
                  ep.session_id,
                  ep.run_reason,
                  ep.executor_action,
                  ep.status,
                  ep.exit_code,
                  ep.dropped,
                  ep.started_at,
                  ep.completed_at,
                  ep.created_at,
                  ep.updated_at
           FROM execution_processes ep
           WHERE ep.session_id = ?1
             AND ep.run_reason = 'codingagent'
             AND ep.dropped = FALSE
           ORDER BY ep.created_at DESC, ep.id DESC
           LIMIT 1"#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
}

fn status_process(process: ExecutionProcess) -> AutoNudgeStatusProcess {
    let terminal_no_response = match process.status {
        ExecutionProcessStatus::Failed | ExecutionProcessStatus::Killed => Some(true),
        ExecutionProcessStatus::Running | ExecutionProcessStatus::Completed => None,
    };
    AutoNudgeStatusProcess {
        process,
        final_response: None,
        terminal_no_response,
    }
}

fn is_active_codingagent(process: &ExecutionProcess) -> bool {
    process.run_reason == ExecutionProcessRunReason::CodingAgent
        && process.status == ExecutionProcessStatus::Running
        && !process.dropped
        && process.completed_at.is_none()
}

fn unique_uuids(values: &[Uuid]) -> Vec<Uuid> {
    let mut seen = std::collections::HashSet::new();
    values.iter().copied().filter(|value| seen.insert(*value)).collect()
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/auto-nudge/session-status", post(session_status))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Executor, SqlitePool, sqlite::SqlitePoolOptions};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(
            r#"CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                task_id BLOB,
                container_ref TEXT,
                branch TEXT NOT NULL,
                setup_completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                name TEXT,
                worktree_deleted INTEGER NOT NULL DEFAULT 0
            )"#,
        ).await.unwrap();
        pool.execute(
            r#"CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                name TEXT,
                executor TEXT,
                agent_working_dir TEXT,
                context_reset_execution_process_id BLOB,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        ).await.unwrap();
        pool.execute(
            r#"CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                run_reason TEXT NOT NULL,
                executor_action TEXT NOT NULL,
                status TEXT NOT NULL,
                exit_code INTEGER,
                dropped INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        ).await.unwrap();
        pool
    }

    async fn insert_workspace(pool: &SqlitePool, id: Uuid, updated_at: &str) {
        sqlx::query("INSERT INTO workspaces (id, branch, created_at, updated_at, archived, pinned, name, worktree_deleted) VALUES (?1, 'branch', ?2, ?3, 0, 0, NULL, 0)")
            .bind(id)
            .bind(updated_at)
            .bind(updated_at)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_session(pool: &SqlitePool, id: Uuid, workspace_id: Uuid, name: &str) {
        sqlx::query("INSERT INTO sessions (id, workspace_id, name, executor, created_at, updated_at) VALUES (?1, ?2, ?3, 'CODEX', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')")
            .bind(id)
            .bind(workspace_id)
            .bind(name)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_process(pool: &SqlitePool, id: Uuid, session_id: Uuid, status: &str, created_at: &str) {
        sqlx::query("INSERT INTO execution_processes (id, session_id, run_reason, executor_action, status, exit_code, dropped, started_at, completed_at, created_at, updated_at) VALUES (?1, ?2, 'codingagent', '{\"typ\":{\"prompt\":\"work\"}}', ?3, 1, 0, ?4, ?4, ?4, ?4)")
            .bind(id)
            .bind(session_id)
            .bind(status)
            .bind(created_at)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn aggregate_status_is_db_only_paged_and_latest_one_per_session() {
        let pool = test_pool().await;
        let registered_workspace = Uuid::new_v4();
        let global_workspace = Uuid::new_v4();
        let impl_session = Uuid::new_v4();
        let global_session = Uuid::new_v4();
        let old_process = Uuid::new_v4();
        let latest_process = Uuid::new_v4();
        let failed_process = Uuid::new_v4();
        insert_workspace(&pool, registered_workspace, "2026-09-20T00:00:00Z").await;
        insert_workspace(&pool, global_workspace, "2026-09-21T00:00:00Z").await;
        insert_session(&pool, impl_session, registered_workspace, "impl").await;
        insert_session(&pool, global_session, global_workspace, "impl").await;
        insert_process(&pool, old_process, impl_session, "completed", "2026-09-20T00:00:00Z").await;
        insert_process(&pool, latest_process, impl_session, "completed", "2026-09-20T00:01:00Z").await;
        insert_process(&pool, failed_process, global_session, "failed", "2026-09-21T00:00:00Z").await;

        let response = build_status(&pool, AutoNudgeStatusRequest {
            registered_workspace_ids: vec![registered_workspace],
            include_global_recent: true,
            global_cursor: None,
            updated_after: "2026-09-19T00:00:00Z".parse().unwrap(),
            limit_workspaces: Some(1),
            limit_sessions: Some(10),
            process_window_queries: vec![AutoNudgeProcessWindowQuery {
                id: "route".to_string(),
                session_id: impl_session,
                started_at: "2026-09-20T00:00:30Z".parse().unwrap(),
                ended_at: "2026-09-20T00:02:00Z".parse().unwrap(),
            }],
        }).await.unwrap();

        assert_eq!(response.counts.registered_workspaces, 1);
        assert_eq!(response.counts.global_workspaces, 1);
        assert_eq!(response.counts.sessions, 2);
        assert_eq!(response.counts.processes, 2);
        assert_eq!(response.workspaces[0].workspace_id, registered_workspace);
        assert!(response.workspaces[0].registered);
        assert_eq!(
            response.workspaces[0].sessions[0]
                .latest_codingagent_process
                .as_ref()
                .unwrap()
                .process
                .id,
            latest_process
        );
        assert_eq!(response.process_window_results[0].process_ids, vec![latest_process]);
        assert!(response.workspaces.iter().any(|workspace| {
            workspace.sessions.iter().any(|session| {
                session.latest_codingagent_process.as_ref().is_some_and(|process| process.terminal_no_response == Some(true))
            })
        }));
    }
}
