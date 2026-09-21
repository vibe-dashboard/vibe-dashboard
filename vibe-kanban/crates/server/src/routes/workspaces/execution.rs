use std::{collections::HashMap, net::TcpListener, sync::OnceLock};

use axum::{
    Extension, Router,
    extract::{Path as AxumPath, Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    preview_identity::{RepoPreviewSlug, WorkspacePreviewToken},
    preview_process_link::{CreatePreviewProcessLink, PreviewProcessLink},
    preview_slot::{PreviewSlot, UpsertPreviewSlot},
    run_config::{RunConfig, UpsertRunConfig},
    run_config_audit_event::{CreateRunConfigAuditEvent, RunConfigAuditEvent},
    scratch::{Scratch, ScratchPayload, ScratchType},
    session::{CreateSession, Session},
    workspace::Workspace,
    workspace_repo::WorkspaceRepo,
};
use deployment::Deployment;
use executors::actions::{
    ExecutorAction, ExecutorActionType,
    script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
};
use serde::{Deserialize, Serialize};
use services::services::container::ContainerService;
use tokio::sync::Mutex;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum RunScriptError {
    NoScriptConfigured,
    ProcessAlreadyRunning,
}

const DEFAULT_RUN_CONFIG_GLOBAL_PROCESS_LIMIT: i64 = 5;

type RunConfigStartLock = Mutex<()>;

fn run_config_start_lock() -> &'static RunConfigStartLock {
    static LOCK: OnceLock<RunConfigStartLock> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct RunConfigStartResponse {
    pub execution_process: ExecutionProcess,
    pub preview_process_link: PreviewProcessLink,
    pub upstream: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct WorkspaceRunConfigsResponse {
    pub run_configs: Vec<RunConfig>,
    pub preview_slots: Vec<PreviewSlot>,
    pub preview_url_parts: Vec<PreviewSlotUrlParts>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSlotUrlParts {
    pub preview_slot_id: Uuid,
    pub workspace_token: String,
    pub repo_slug: String,
    pub slot_slug: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSlotUrlResponse {
    pub preview_slot_id: Uuid,
    pub workspace_token: String,
    pub repo_slug: String,
    pub slot_slug: String,
    pub customer_slug: String,
    pub host: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSlotUrlQuery {
    pub customer_slug: String,
    #[serde(default)]
    pub base_domain: Option<String>,
}

fn repo_has_dev_server(repo: &db::models::repo::Repo) -> bool {
    if !repo.dev_server_scripts.is_empty() {
        return true;
    }

    repo.dev_server_script
        .as_ref()
        .is_some_and(|script| !script.trim().is_empty())
}

fn default_dev_server_request(repo: &db::models::repo::Repo) -> Option<ScriptRequest> {
    if let Some(script) = repo
        .dev_server_scripts
        .iter()
        .find(|script| script.is_default)
    {
        let working_dir = script
            .working_dir
            .as_ref()
            .map(|dir| format!("{}/{}", repo.name, dir))
            .or_else(|| Some(repo.name.clone()));

        return Some(ScriptRequest {
            script: script.script.clone(),
            language: ScriptRequestLanguage::Bash,
            context: ScriptContext::DevServer,
            working_dir,
            env: Default::default(),
        });
    }

    repo.dev_server_script.as_ref().and_then(|script| {
        let trimmed = script.trim();
        if trimmed.is_empty() {
            return None;
        }

        Some(ScriptRequest {
            script: trimmed.to_string(),
            language: ScriptRequestLanguage::Bash,
            context: ScriptContext::DevServer,
            working_dir: Some(repo.name.clone()),
            env: Default::default(),
        })
    })
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/dev-server/start", post(start_dev_server))
        .route(
            "/run-configs",
            get(list_run_configs).post(upsert_run_config),
        )
        .route(
            "/run-configs/{run_config_id}/start",
            post(start_run_config_by_id),
        )
        .route(
            "/preview-slots",
            get(list_preview_slots).post(upsert_preview_slot),
        )
        .route(
            "/preview-slots/{preview_slot_id}/start",
            post(start_preview_slot_by_id),
        )
        .route(
            "/preview-slots/{preview_slot_id}/url",
            get(preview_slot_url),
        )
        .route("/cleanup", post(run_cleanup_script))
        .route("/archive", post(run_archive_script))
}

#[axum::debug_handler]
pub async fn list_run_configs(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<WorkspaceRunConfigsResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let mut run_configs = Vec::new();
    let mut preview_slots = Vec::new();
    let workspace_token = WorkspacePreviewToken::ensure(pool, workspace.id)
        .await?
        .token;
    let mut preview_url_parts = Vec::new();

    for repo in repos {
        let repo_slug = RepoPreviewSlug::ensure(pool, repo.id, &repo.display_name)
            .await?
            .slug;
        run_configs.extend(RunConfig::find_by_repo_id(pool, repo.id).await?);
        let repo_slots = PreviewSlot::find_by_repo_id(pool, repo.id).await?;
        preview_url_parts.extend(repo_slots.iter().map(|slot| PreviewSlotUrlParts {
            preview_slot_id: slot.id,
            workspace_token: workspace_token.clone(),
            repo_slug: repo_slug.clone(),
            slot_slug: slot.slot_slug.clone(),
        }));
        preview_slots.extend(repo_slots);
    }

    Ok(ResponseJson(ApiResponse::success(
        WorkspaceRunConfigsResponse {
            run_configs,
            preview_slots,
            preview_url_parts,
        },
    )))
}

#[axum::debug_handler]
pub async fn list_preview_slots(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<PreviewSlot>>>, ApiError> {
    let pool = &deployment.db().pool;
    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let mut preview_slots = Vec::new();

    for repo in repos {
        RepoPreviewSlug::ensure(pool, repo.id, &repo.display_name).await?;
        preview_slots.extend(PreviewSlot::find_by_repo_id(pool, repo.id).await?);
    }
    WorkspacePreviewToken::ensure(pool, workspace.id).await?;

    Ok(ResponseJson(ApiResponse::success(preview_slots)))
}

#[axum::debug_handler]
pub async fn upsert_run_config(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    ResponseJson(mut payload): ResponseJson<UpsertRunConfig>,
) -> Result<ResponseJson<ApiResponse<RunConfig>>, ApiError> {
    validate_slug("run config slug", &payload.slug, 18)?;
    validate_workspace_repo(&deployment, workspace.id, payload.repo_id).await?;
    if payload
        .working_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(ApiError::BadRequest(
            "Run config working_dir override is disabled for Preview URLs V1; cd inside the command instead".to_string(),
        ));
    }
    payload.working_dir = None;
    if payload.command.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Run config command is required".to_string(),
        ));
    }

    let run_config = RunConfig::upsert(&deployment.db().pool, &payload).await?;
    write_run_config_audit(
        &deployment,
        Some(workspace.id),
        Some(run_config.repo_id),
        Some(run_config.id),
        None,
        None,
        "run_config.upsert",
        None,
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(run_config)))
}

#[axum::debug_handler]
pub async fn upsert_preview_slot(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    ResponseJson(payload): ResponseJson<UpsertPreviewSlot>,
) -> Result<ResponseJson<ApiResponse<PreviewSlot>>, ApiError> {
    validate_slug("preview slot slug", &payload.slot_slug, 10)?;
    validate_workspace_repo(&deployment, workspace.id, payload.repo_id).await?;
    let run_config = RunConfig::find_by_id(&deployment.db().pool, payload.run_config_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Run config not found".to_string()))?;
    if run_config.repo_id != payload.repo_id {
        return Err(ApiError::BadRequest(
            "Preview slot repo must match run config repo".to_string(),
        ));
    }

    let slot = PreviewSlot::upsert(&deployment.db().pool, &payload).await?;
    RepoPreviewSlug::ensure(
        &deployment.db().pool,
        payload.repo_id,
        &repo_display_name(&deployment, workspace.id, payload.repo_id).await?,
    )
    .await?;
    WorkspacePreviewToken::ensure(&deployment.db().pool, workspace.id).await?;
    write_run_config_audit(
        &deployment,
        Some(workspace.id),
        Some(slot.repo_id),
        Some(slot.run_config_id),
        Some(slot.id),
        None,
        "preview_slot.upsert",
        None,
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(slot)))
}

#[axum::debug_handler]
pub async fn preview_slot_url(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    AxumPath((workspace_id, preview_slot_id)): AxumPath<(Uuid, Uuid)>,
    Query(query): Query<PreviewSlotUrlQuery>,
) -> Result<ResponseJson<ApiResponse<PreviewSlotUrlResponse>>, ApiError> {
    debug_assert_eq!(workspace_id, workspace.id);
    validate_slug("customer slug", &query.customer_slug, 16)?;
    let pool = &deployment.db().pool;
    let slot = PreviewSlot::find_by_id(pool, preview_slot_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Preview slot not found".to_string()))?;
    validate_workspace_repo(&deployment, workspace.id, slot.repo_id).await?;
    let repo_name = repo_display_name(&deployment, workspace.id, slot.repo_id).await?;
    let workspace_token = WorkspacePreviewToken::ensure(pool, workspace.id)
        .await?
        .token;
    let repo_slug = RepoPreviewSlug::ensure(pool, slot.repo_id, &repo_name)
        .await?
        .slug;
    let base_domain = query
        .base_domain
        .as_deref()
        .unwrap_or("vibedashboard.dev")
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let host = format!(
        "{}-{}-{}-{}.{}",
        workspace_token, repo_slug, slot.slot_slug, query.customer_slug, base_domain
    );
    Ok(ResponseJson(ApiResponse::success(PreviewSlotUrlResponse {
        preview_slot_id: slot.id,
        workspace_token,
        repo_slug,
        slot_slug: slot.slot_slug,
        customer_slug: query.customer_slug,
        url: format!("https://{host}/"),
        host,
    })))
}

#[axum::debug_handler]
pub async fn start_run_config_by_id(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    AxumPath((workspace_id, run_config_id)): AxumPath<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<RunConfigStartResponse>>, ApiError> {
    debug_assert_eq!(workspace_id, workspace.id);
    let run_config = RunConfig::find_by_id(&deployment.db().pool, run_config_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Run config not found".to_string()))?;
    let response = start_run_config(&deployment, &workspace, &run_config, None).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

#[axum::debug_handler]
pub async fn start_preview_slot_by_id(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    AxumPath((workspace_id, preview_slot_id)): AxumPath<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<RunConfigStartResponse>>, ApiError> {
    debug_assert_eq!(workspace_id, workspace.id);
    let slot = PreviewSlot::find_by_id(&deployment.db().pool, preview_slot_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Preview slot not found".to_string()))?;
    let run_config = RunConfig::find_by_id(&deployment.db().pool, slot.run_config_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Run config not found".to_string()))?;
    let response = start_run_config(&deployment, &workspace, &run_config, Some(&slot)).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

#[axum::debug_handler]
pub async fn start_dev_server(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ExecutionProcess>>>, ApiError> {
    let pool = &deployment.db().pool;

    let existing_dev_servers =
        match ExecutionProcess::find_running_dev_servers_by_workspace(pool, workspace.id).await {
            Ok(servers) => servers,
            Err(e) => {
                tracing::error!(
                    "Failed to find running dev servers for workspace {}: {}",
                    workspace.id,
                    e
                );
                return Err(ApiError::Workspace(
                    db::models::workspace::WorkspaceError::ValidationError(e.to_string()),
                ));
            }
        };

    for dev_server in existing_dev_servers {
        tracing::info!(
            "Stopping existing dev server {} for workspace {}",
            dev_server.id,
            workspace.id
        );

        if let Err(e) = deployment
            .container()
            .stop_execution(&dev_server, ExecutionProcessStatus::Killed)
            .await
        {
            tracing::error!("Failed to stop dev server {}: {}", dev_server.id, e);
        }
    }

    let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;
    let selected_repo_ids = Scratch::find_by_id(
        pool,
        workspace.id,
        &ScratchType::WorkspaceDevServerSelection,
    )
    .await?
    .and_then(|scratch| match scratch.payload {
        ScratchPayload::WorkspaceDevServerSelection(data) => Some(data.selected_repo_ids),
        _ => None,
    });

    let repos_with_dev_script: Vec<_> = repos
        .iter()
        .filter(|repo| repo_has_dev_server(repo))
        .filter(|repo| {
            selected_repo_ids
                .as_ref()
                .map(|ids| ids.is_empty() || ids.contains(&repo.id))
                .unwrap_or(true)
        })
        .collect();

    if repos_with_dev_script.is_empty() {
        return Ok(ResponseJson(ApiResponse::error(
            "No dev server script configured for any repository in this workspace",
        )));
    }

    let session = match Session::find_latest_by_workspace_id(pool, workspace.id).await? {
        Some(s) => s,
        None => {
            Session::create(
                pool,
                &CreateSession {
                    executor: Some("dev-server".to_string()),
                    name: None,
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?
        }
    };

    let mut execution_processes = Vec::new();
    for repo in repos_with_dev_script {
        let Some(script_request) = default_dev_server_request(repo) else {
            continue;
        };

        let executor_action =
            ExecutorAction::new(ExecutorActionType::ScriptRequest(script_request), None);

        let execution_process = deployment
            .container()
            .start_execution(
                &workspace,
                &session,
                &executor_action,
                &ExecutionProcessRunReason::DevServer,
            )
            .await?;
        execution_processes.push(execution_process);
    }

    deployment
        .track_if_analytics_allowed(
            "dev_server_started",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(execution_processes)))
}

pub(crate) async fn start_run_config(
    deployment: &DeploymentImpl,
    workspace: &Workspace,
    run_config: &RunConfig,
    preview_slot: Option<&PreviewSlot>,
) -> Result<RunConfigStartResponse, ApiError> {
    if !run_config.enabled {
        return Err(ApiError::BadRequest("Run config is disabled".to_string()));
    }
    if let Some(slot) = preview_slot
        && (!slot.enabled
            || slot.run_config_id != run_config.id
            || slot.repo_id != run_config.repo_id)
    {
        return Err(ApiError::BadRequest(
            "Preview slot is disabled or does not match run config".to_string(),
        ));
    }
    validate_workspace_repo(deployment, workspace.id, run_config.repo_id).await?;
    if run_config
        .working_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(ApiError::BadRequest(
            "Run config working_dir override is disabled for Preview URLs V1; cd inside the command instead".to_string(),
        ));
    }

    let _guard = run_config_start_lock().lock().await;
    let pool = &deployment.db().pool;
    write_run_config_audit(
        deployment,
        Some(workspace.id),
        Some(run_config.repo_id),
        Some(run_config.id),
        preview_slot.map(|slot| slot.id),
        None,
        "run_config.start_requested",
        None,
    )
    .await?;

    let existing_link = match preview_slot {
        Some(slot) => PreviewProcessLink::find_active_by_slot(pool, workspace.id, slot.id).await?,
        None => {
            PreviewProcessLink::find_active_by_config(pool, workspace.id, run_config.id).await?
        }
    };
    if let Some(link) = existing_link {
        if let Some(process) = ExecutionProcess::find_by_id(pool, link.execution_process_id).await?
            && process.status == ExecutionProcessStatus::Running
        {
            write_run_config_audit(
                deployment,
                Some(workspace.id),
                Some(run_config.repo_id),
                Some(run_config.id),
                preview_slot.map(|slot| slot.id),
                Some(process.id),
                "run_config.start_reused",
                None,
            )
            .await?;
            return Ok(RunConfigStartResponse {
                execution_process: process,
                upstream: format!("http://127.0.0.1:{}", link.assigned_port),
                preview_process_link: link,
            });
        }
        PreviewProcessLink::mark_ended_for_process(
            pool,
            link.execution_process_id,
            db::models::preview_process_link::PreviewProcessStatusSnapshot::Stopped,
        )
        .await?;
    }

    let active_count = PreviewProcessLink::count_active(pool).await?;
    if active_count >= DEFAULT_RUN_CONFIG_GLOBAL_PROCESS_LIMIT {
        write_run_config_audit(
            deployment,
            Some(workspace.id),
            Some(run_config.repo_id),
            Some(run_config.id),
            preview_slot.map(|slot| slot.id),
            None,
            "run_config.start_capacity_full",
            None,
        )
        .await?;
        return Err(ApiError::Conflict(format!(
            "Run config process capacity is full (limit {})",
            DEFAULT_RUN_CONFIG_GLOBAL_PROCESS_LIMIT
        )));
    }

    let repo = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id)
        .await?
        .into_iter()
        .find(|repo| repo.id == run_config.repo_id)
        .ok_or_else(|| {
            ApiError::BadRequest("Run config repo is not attached to workspace".to_string())
        })?;
    let assigned_port = allocate_preview_port()?;
    let working_dir = Some(repo.name.clone());
    let mut env = HashMap::new();
    env.insert("PORT".to_string(), assigned_port.to_string());

    let executor_action = ExecutorAction::new(
        ExecutorActionType::ScriptRequest(ScriptRequest {
            script: run_config.command.clone(),
            language: ScriptRequestLanguage::Bash,
            context: ScriptContext::DevServer,
            working_dir,
            env,
        }),
        None,
    );

    let session = match Session::find_latest_by_workspace_id(pool, workspace.id).await? {
        Some(s) => s,
        None => {
            Session::create(
                pool,
                &CreateSession {
                    executor: Some("run-config".to_string()),
                    name: None,
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?
        }
    };

    let execution_process = deployment
        .container()
        .start_execution(
            workspace,
            &session,
            &executor_action,
            &ExecutionProcessRunReason::DevServer,
        )
        .await?;

    let link = PreviewProcessLink::create(
        pool,
        &CreatePreviewProcessLink {
            workspace_id: workspace.id,
            repo_id: run_config.repo_id,
            run_config_id: run_config.id,
            preview_slot_id: preview_slot.map(|slot| slot.id),
            execution_process_id: execution_process.id,
            assigned_port,
        },
    )
    .await?;
    write_run_config_audit(
        deployment,
        Some(workspace.id),
        Some(run_config.repo_id),
        Some(run_config.id),
        preview_slot.map(|slot| slot.id),
        Some(execution_process.id),
        "run_config.start_spawned",
        None,
    )
    .await?;

    Ok(RunConfigStartResponse {
        upstream: format!("http://127.0.0.1:{assigned_port}"),
        execution_process,
        preview_process_link: link,
    })
}

async fn validate_workspace_repo(
    deployment: &DeploymentImpl,
    workspace_id: Uuid,
    repo_id: Uuid,
) -> Result<(), ApiError> {
    let repos =
        WorkspaceRepo::find_repos_for_workspace(&deployment.db().pool, workspace_id).await?;
    if repos.iter().any(|repo| repo.id == repo_id) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Repository is not attached to workspace".to_string(),
        ))
    }
}

#[allow(clippy::result_large_err)]
fn validate_slug(label: &str, slug: &str, max_len: usize) -> Result<(), ApiError> {
    let valid = !slug.is_empty()
        && slug.len() <= max_len
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "{label} must be 1-{max_len} lowercase alphanumeric characters"
        )))
    }
}

#[allow(clippy::result_large_err)]
fn allocate_preview_port() -> Result<i64, ApiError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| ApiError::BadRequest(format!("Failed to allocate preview port: {err}")))?;
    let port = listener
        .local_addr()
        .map_err(|err| ApiError::BadRequest(format!("Failed to read preview port: {err}")))?
        .port();
    Ok(i64::from(port))
}

async fn repo_display_name(
    deployment: &DeploymentImpl,
    workspace_id: Uuid,
    repo_id: Uuid,
) -> Result<String, ApiError> {
    WorkspaceRepo::find_repos_for_workspace(&deployment.db().pool, workspace_id)
        .await?
        .into_iter()
        .find(|repo| repo.id == repo_id)
        .map(|repo| repo.display_name)
        .ok_or_else(|| ApiError::BadRequest("Repository is not attached to workspace".to_string()))
}

#[allow(clippy::too_many_arguments)]
async fn write_run_config_audit(
    deployment: &DeploymentImpl,
    workspace_id: Option<Uuid>,
    repo_id: Option<Uuid>,
    run_config_id: Option<Uuid>,
    preview_slot_id: Option<Uuid>,
    execution_process_id: Option<Uuid>,
    event_type: &str,
    details_json: Option<String>,
) -> Result<(), ApiError> {
    RunConfigAuditEvent::create(
        &deployment.db().pool,
        &CreateRunConfigAuditEvent {
            workspace_id,
            repo_id,
            run_config_id,
            preview_slot_id,
            execution_process_id,
            actor: "backend".to_string(),
            event_type: event_type.to_string(),
            details_json,
        },
    )
    .await?;
    Ok(())
}

#[axum::debug_handler]
pub async fn run_cleanup_script(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess, RunScriptError>>, ApiError> {
    let pool = &deployment.db().pool;

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
    let executor_action = match deployment.container().cleanup_actions_for_repos(&repos) {
        Some(action) => action,
        None => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                RunScriptError::NoScriptConfigured,
            )));
        }
    };

    let session = match Session::find_latest_by_workspace_id(pool, workspace.id).await? {
        Some(s) => s,
        None => {
            Session::create(
                pool,
                &CreateSession {
                    executor: None,
                    name: None,
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?
        }
    };

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &executor_action,
            &ExecutionProcessRunReason::CleanupScript,
        )
        .await?;

    deployment
        .track_if_analytics_allowed(
            "cleanup_script_executed",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

pub async fn run_archive_script(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess, RunScriptError>>, ApiError> {
    let pool = &deployment.db().pool;
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
    let executor_action = match deployment.container().archive_actions_for_repos(&repos) {
        Some(action) => action,
        None => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                RunScriptError::NoScriptConfigured,
            )));
        }
    };
    let session = match Session::find_latest_by_workspace_id(pool, workspace.id).await? {
        Some(s) => s,
        None => {
            Session::create(
                pool,
                &CreateSession {
                    executor: None,
                    name: None,
                },
                Uuid::new_v4(),
                workspace.id,
            )
            .await?
        }
    };

    let execution_process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &executor_action,
            &ExecutionProcessRunReason::ArchiveScript,
        )
        .await?;

    deployment
        .track_if_analytics_allowed(
            "archive_script_executed",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, extract::Path as AxumPath, routing::get};
    use http::Request;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[tokio::test]
    async fn nested_run_config_route_path_extracts_workspace_and_run_config_ids() {
        let workspace_id = Uuid::new_v4();
        let run_config_id = Uuid::new_v4();
        let execution_router = Router::new().route(
            "/run-configs/{run_config_id}/start",
            get(
                |AxumPath((workspace_id, run_config_id)): AxumPath<(Uuid, Uuid)>| async move {
                    format!("{workspace_id}:{run_config_id}")
                },
            ),
        );
        let workspace_router = Router::new().nest("/execution", execution_router);
        let app = Router::new().nest("/workspaces/{id}", workspace_router);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/workspaces/{workspace_id}/execution/run-configs/{run_config_id}/start"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), http::StatusCode::OK);
    }

    #[tokio::test]
    async fn nested_preview_slot_route_path_extracts_workspace_and_preview_slot_ids() {
        let workspace_id = Uuid::new_v4();
        let preview_slot_id = Uuid::new_v4();
        let execution_router = Router::new().route(
            "/preview-slots/{preview_slot_id}/url",
            get(
                |AxumPath((workspace_id, preview_slot_id)): AxumPath<(Uuid, Uuid)>| async move {
                    format!("{workspace_id}:{preview_slot_id}")
                },
            ),
        );
        let workspace_router = Router::new().nest("/execution", execution_router);
        let app = Router::new().nest("/workspaces/{id}", workspace_router);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/workspaces/{workspace_id}/execution/preview-slots/{preview_slot_id}/url"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), http::StatusCode::OK);
    }
}
