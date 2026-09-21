pub mod queue;
pub mod review;

use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcess, ExecutionProcessRunReason},
    requests::UpdateSession,
    scratch::{Scratch, ScratchType},
    session::{CreateSession, Session, SessionError},
    workspace::{Workspace, WorkspaceError},
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType,
        coding_agent_follow_up::CodingAgentFollowUpRequest,
        session_command::{CodingAgentSessionCommandRequest, SessionCommand},
    },
    profile::ExecutorConfig,
};
use serde::Deserialize;
use services::services::container::ContainerService;
use tracing::Instrument;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError, middleware::load_session_middleware,
    routes::workspaces::execution::RunScriptError,
};

#[derive(Debug, Deserialize)]
pub struct SessionQuery {
    pub workspace_id: Uuid,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateSessionRequest {
    pub workspace_id: Uuid,
    pub executor: Option<String>,
    pub name: Option<String>,
}

pub async fn get_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<SessionQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<Session>>>, ApiError> {
    let pool = &deployment.db().pool;
    let sessions = async { Session::find_by_workspace_id(pool, query.workspace_id).await }
        .instrument(tracing::debug_span!(
            "sessions.find_by_workspace_id",
            workspace_id = %query.workspace_id,
        ))
        .await?;

    tracing::debug!(
        workspace_id = %query.workspace_id,
        session_count = sessions.len(),
        "sessions.list.loaded"
    );

    Ok(ResponseJson(ApiResponse::success(sessions)))
}

#[tracing::instrument(
    level = "debug",
    skip(session),
    fields(
        session_id = %session.id,
        workspace_id = %session.workspace_id,
        has_name = session.name.is_some(),
    )
)]
pub async fn get_session(
    Extension(session): Extension<Session>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn create_session(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateSessionRequest>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    let pool = &deployment.db().pool;

    // Verify workspace exists
    let _workspace = Workspace::find_by_id(pool, payload.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    let session = Session::create(
        pool,
        &CreateSession {
            executor: payload.executor,
            name: payload.name,
        },
        Uuid::new_v4(),
        payload.workspace_id,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn update_session(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<UpdateSession>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    let pool = &deployment.db().pool;

    Session::update(pool, session.id, request.name.as_deref()).await?;

    let updated = Session::find_by_id(pool, session.id)
        .await?
        .ok_or(ApiError::Session(SessionError::NotFound))?;

    Ok(ResponseJson(ApiResponse::success(updated)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateFollowUpAttempt {
    pub prompt: String,
    pub executor_config: ExecutorConfig,
    pub retry_process_id: Option<Uuid>,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
    #[ts(skip)]
    pub stop_other_sessions_for_git_reset: Option<bool>,
}

pub(super) fn parse_session_command(prompt: &str) -> Option<SessionCommand> {
    let trimmed = prompt.trim_start();
    let without_slash = trimmed.strip_prefix('/')?;
    let mut parts = without_slash.splitn(2, |ch: char| ch.is_whitespace());
    let name = parts.next()?.trim().to_lowercase();
    let arguments = parts.next().map(str::trim).unwrap_or("");

    match name.as_str() {
        "clear" if arguments.is_empty() => Some(SessionCommand::Clear),
        "clear" => None,
        "compact" => Some(SessionCommand::Compact {
            instructions: (!arguments.is_empty()).then(|| arguments.to_string()),
        }),
        _ => None,
    }
}

pub(super) fn invalid_session_command_message(prompt: &str) -> Option<String> {
    let trimmed = prompt.trim_start();
    let without_slash = trimmed.strip_prefix('/')?;
    let mut parts = without_slash.splitn(2, |ch: char| ch.is_whitespace());
    let name = parts.next()?.trim().to_lowercase();
    let arguments = parts.next().map(str::trim).unwrap_or("");

    match name.as_str() {
        "clear" if !arguments.is_empty() => Some("`/clear` does not accept arguments.".to_string()),
        _ => None,
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct ResetProcessRequest {
    pub process_id: Uuid,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
    #[ts(skip)]
    pub stop_other_sessions_for_git_reset: Option<bool>,
}

pub async fn follow_up(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateFollowUpAttempt>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    let pool = &deployment.db().pool;

    // Load workspace from session
    let workspace = Workspace::find_by_id(pool, session.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    tracing::info!("{:?}", workspace);

    deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    let executor_profile_id = payload.executor_config.profile_id();

    // Validate executor matches session if session has prior executions
    let expected_executor: Option<String> =
        ExecutionProcess::latest_executor_profile_for_session(pool, session.id)
            .await?
            .map(|profile| profile.executor.to_string())
            .or_else(|| session.executor.clone());

    if let Some(expected) = expected_executor {
        let actual = executor_profile_id.executor.to_string();
        if expected != actual {
            return Err(ApiError::Session(SessionError::ExecutorMismatch {
                expected,
                actual,
            }));
        }
    }

    if session.executor.is_none() {
        Session::update_executor(pool, session.id, &executor_profile_id.executor.to_string())
            .await?;
    }

    let retry_process_id = payload.retry_process_id;
    if let Some(proc_id) = retry_process_id {
        let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
        let perform_git_reset = payload.perform_git_reset.unwrap_or(true);
        let stop_other_sessions_for_git_reset =
            payload.stop_other_sessions_for_git_reset.unwrap_or(false);
        deployment
            .container()
            .reset_session_to_process(
                session.id,
                proc_id,
                perform_git_reset,
                force_when_dirty,
                stop_other_sessions_for_git_reset,
            )
            .await?;
    }

    let prompt = payload.prompt;
    if let Some(message) = invalid_session_command_message(&prompt) {
        return Err(ApiError::BadRequest(message));
    }

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let cleanup_action = deployment.container().cleanup_actions_for_repos(&repos);

    let working_dir = session
        .agent_working_dir
        .as_ref()
        .filter(|dir| !dir.is_empty())
        .cloned();

    let action_type = if let Some(command) = parse_session_command(&prompt) {
        let latest_session_info =
            if command.requires_provider_context(payload.executor_config.executor) {
                CodingAgentTurn::find_latest_session_info(pool, session.id).await?
            } else {
                None
            };
        ExecutorActionType::CodingAgentSessionCommandRequest(CodingAgentSessionCommandRequest {
            command,
            prompt: prompt.clone(),
            session_id: latest_session_info
                .as_ref()
                .map(|info| info.session_id.clone()),
            executor_config: payload.executor_config.clone(),
            working_dir: working_dir.clone(),
        })
    } else if let Some(info) = CodingAgentTurn::find_latest_session_info(pool, session.id).await? {
        let is_reset = payload.retry_process_id.is_some();
        ExecutorActionType::CodingAgentFollowUpRequest(CodingAgentFollowUpRequest {
            prompt: prompt.clone(),
            session_id: info.session_id,
            reset_to_message_id: if is_reset { info.message_id } else { None },
            executor_config: payload.executor_config.clone(),
            working_dir: working_dir.clone(),
        })
    } else {
        ExecutorActionType::CodingAgentInitialRequest(
            executors::actions::coding_agent_initial::CodingAgentInitialRequest {
                prompt,
                executor_config: payload.executor_config.clone(),
                working_dir,
            },
        )
    };

    let cleanup_action = if matches!(
        &action_type,
        ExecutorActionType::CodingAgentSessionCommandRequest(_)
    ) {
        None
    } else {
        cleanup_action
    };
    let (action_kind, session_command) = match &action_type {
        ExecutorActionType::CodingAgentSessionCommandRequest(request) => {
            let command = match &request.command {
                SessionCommand::Clear => "clear",
                SessionCommand::Compact { .. } => "compact",
            };
            ("session_command", Some(command))
        }
        ExecutorActionType::CodingAgentFollowUpRequest(_) => ("follow_up", None),
        ExecutorActionType::CodingAgentInitialRequest(_) => ("initial_request", None),
        ExecutorActionType::ReviewRequest(_) => ("review", None),
        ExecutorActionType::ScriptRequest(_) => ("script", None),
    };
    let action = ExecutorAction::new(action_type, cleanup_action.map(Box::new));

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .instrument(tracing::debug_span!(
            target: "perf.agent_startup",
            "agent.turn",
            workspace_id = %workspace.id,
            session_id = %session.id,
            executor = %executor_profile_id.executor,
            action_kind,
            session_command = ?session_command,
            retry_process_id = ?retry_process_id,
            execution_process_id = tracing::field::Empty,
        ))
        .await?;

    // Clear the draft follow-up scratch on successful spawn
    // This ensures the scratch is wiped even if the user navigates away quickly
    if let Err(e) = Scratch::delete(pool, session.id, &ScratchType::DraftFollowUp).await {
        // Log but don't fail the request - scratch deletion is best-effort
        tracing::debug!(
            "Failed to delete draft follow-up scratch for session {}: {}",
            session.id,
            e
        );
    }

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

pub async fn reset_process(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ResetProcessRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
    let perform_git_reset = payload.perform_git_reset.unwrap_or(true);
    let stop_other_sessions_for_git_reset =
        payload.stop_other_sessions_for_git_reset.unwrap_or(false);

    deployment
        .container()
        .reset_session_to_process(
            session.id,
            payload.process_id,
            perform_git_reset,
            force_when_dirty,
            stop_other_sessions_for_git_reset,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn stop_session_execution(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    deployment
        .container()
        .stop_running_processes_for_session(session.id, false)
        .await?;

    deployment
        .track_if_analytics_allowed(
            "task_attempt_stopped",
            serde_json::json!({
                "workspace_id": session.workspace_id.to_string(),
                "session_id": session.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn run_setup_script(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess, RunScriptError>>, ApiError> {
    let pool = &deployment.db().pool;

    let workspace = Workspace::find_by_id(pool, session.workspace_id)
        .await?
        .ok_or(ApiError::Workspace(WorkspaceError::ValidationError(
            "Workspace not found".to_string(),
        )))?;

    if ExecutionProcess::has_running_non_dev_server_processes_for_workspace(pool, workspace.id)
        .await?
    {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            RunScriptError::ProcessAlreadyRunning,
        )));
    }

    deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let executor_action = match deployment.container().setup_actions_for_repos(&repos) {
        Some(action) => action,
        None => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                RunScriptError::NoScriptConfigured,
            )));
        }
    };

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &executor_action,
            &ExecutionProcessRunReason::SetupScript,
        )
        .await?;

    deployment
        .track_if_analytics_allowed(
            "setup_script_executed",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let session_id_router = Router::new()
        .route("/", get(get_session).put(update_session))
        .route("/follow-up", post(follow_up))
        .route("/reset", post(reset_process))
        .route("/execution/stop", post(stop_session_execution))
        .route("/setup", post(run_setup_script))
        .route("/review", post(review::start_review))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_session_middleware,
        ));

    let sessions_router = Router::new()
        .route("/", get(get_sessions).post(create_session))
        .nest("/{session_id}", session_id_router)
        .nest("/{session_id}/queue", queue::router(deployment));

    Router::new().nest("/sessions", sessions_router)
}

#[cfg(test)]
mod tests {
    use super::{SessionCommand, invalid_session_command_message, parse_session_command};

    #[test]
    fn parses_clear_and_compact_session_commands() {
        assert!(matches!(
            parse_session_command("/clear"),
            Some(SessionCommand::Clear)
        ));

        assert!(matches!(
            parse_session_command("  /compact focus on current TODOs"),
            Some(SessionCommand::Compact {
                instructions: Some(instructions)
            }) if instructions == "focus on current TODOs"
        ));

        assert!(parse_session_command("please /clear").is_none());
        assert!(parse_session_command("/clear now").is_none());
        assert!(parse_session_command("/status").is_none());
    }

    #[test]
    fn rejects_clear_with_arguments() {
        assert_eq!(
            invalid_session_command_message("/clear now"),
            Some("`/clear` does not accept arguments.".to_string())
        );
        assert!(invalid_session_command_message("/compact focus").is_none());
        assert!(invalid_session_command_message("please /clear now").is_none());
    }
}
