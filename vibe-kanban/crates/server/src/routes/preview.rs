use axum::{
    Router,
    extract::{
        Json as RequestJson, Path, Request, State, ws::rejection::WebSocketUpgradeRejection,
    },
    http::StatusCode,
    response::{IntoResponse, Json as ResponseJson, Response},
    routing::{any, post},
};
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessStatus},
    preview_process_link::{PreviewProcessLink, PreviewProcessStatusSnapshot},
    preview_slot::PreviewSlot,
    run_config::RunConfig,
    workspace::Workspace,
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpStream,
    time::{Duration, timeout},
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;
use ws_bridge::{bridge_axum_ws, connect_upstream_ws};

use crate::{
    DeploymentImpl, error::ApiError, middleware::signed_ws::SignedWsUpgrade,
    routes::workspaces::execution::start_run_config,
};

pub(super) fn api_router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/preview/resolve", post(resolve_named_preview))
        .route("/preview/{target_port}", any(proxy_preview_request_no_tail))
        .route("/preview/{target_port}/{*tail}", any(proxy_preview_request))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NamedPreviewResolveRequest {
    pub host: String,
    pub workspace_token: String,
    pub repo_slug: String,
    pub slot_slug: String,
    pub customer_slug: String,
    #[serde(default)]
    pub ensure: bool,
    pub method: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NamedPreviewResolveResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_process_id: Option<Uuid>,
}

async fn resolve_named_preview(
    State(deployment): State<DeploymentImpl>,
    RequestJson(payload): RequestJson<NamedPreviewResolveRequest>,
) -> Result<ResponseJson<ApiResponse<NamedPreviewResolveResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let Some(workspace) = find_workspace_by_preview_token(pool, &payload.workspace_token).await?
    else {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Preview workspace was not found"),
        )));
    };
    let Some(repo_id) =
        find_workspace_repo_by_preview_slug(pool, workspace.id, &payload.repo_slug).await?
    else {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Preview repo was not found"),
        )));
    };
    let Some(slot) = PreviewSlot::find_by_repo_slot(pool, repo_id, &payload.slot_slug).await?
    else {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Preview slot was not found"),
        )));
    };
    let Some(run_config) = RunConfig::find_by_id(pool, slot.run_config_id).await? else {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Run config was not found"),
        )));
    };
    if !slot.enabled {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Preview slot is disabled"),
        )));
    }
    if !run_config.enabled {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::not_found("Run config is disabled"),
        )));
    }

    if let Some(active) =
        PreviewProcessLink::find_active_by_slot(pool, workspace.id, slot.id).await?
        && let Some(process) =
            ExecutionProcess::find_by_id(pool, active.execution_process_id).await?
    {
        if process.status == ExecutionProcessStatus::Running {
            if preview_port_is_ready(active.assigned_port).await {
                PreviewProcessLink::update_status_for_process(
                    pool,
                    active.execution_process_id,
                    PreviewProcessStatusSnapshot::Ready,
                )
                .await?;
                return Ok(ResponseJson(ApiResponse::success(
                    NamedPreviewResolveResponse::ready(
                        active.assigned_port,
                        active.execution_process_id,
                    ),
                )));
            }
            PreviewProcessLink::update_status_for_process(
                pool,
                active.execution_process_id,
                PreviewProcessStatusSnapshot::Starting,
            )
            .await?;
            return Ok(ResponseJson(ApiResponse::success(
                NamedPreviewResolveResponse::starting_with_process(active.execution_process_id),
            )));
        }
        PreviewProcessLink::mark_ended_for_process(
            pool,
            active.execution_process_id,
            PreviewProcessStatusSnapshot::Failed,
        )
        .await?;
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::failed("Preview process is no longer running"),
        )));
    }

    if !payload.ensure {
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::starting(),
        )));
    }

    let started = match start_run_config(&deployment, &workspace, &run_config, Some(&slot)).await {
        Ok(started) => started,
        Err(ApiError::Conflict(message)) => {
            return Ok(ResponseJson(ApiResponse::success(
                NamedPreviewResolveResponse::capacity_full(&message),
            )));
        }
        Err(ApiError::BadRequest(message)) => {
            return Ok(ResponseJson(ApiResponse::success(
                NamedPreviewResolveResponse::failed(&message),
            )));
        }
        Err(error) => {
            tracing::warn!(?error, "Failed to start preview run config");
            return Ok(ResponseJson(ApiResponse::success(
                NamedPreviewResolveResponse::failed("Preview process failed to start"),
            )));
        }
    };

    if probe_preview_port_short(started.preview_process_link.assigned_port).await {
        PreviewProcessLink::update_status_for_process(
            pool,
            started.execution_process.id,
            PreviewProcessStatusSnapshot::Ready,
        )
        .await?;
        return Ok(ResponseJson(ApiResponse::success(
            NamedPreviewResolveResponse::ready(
                started.preview_process_link.assigned_port,
                started.execution_process.id,
            ),
        )));
    }

    Ok(ResponseJson(ApiResponse::success(
        NamedPreviewResolveResponse::starting_with_process(started.execution_process.id),
    )))
}

impl NamedPreviewResolveResponse {
    fn ready(port: i64, execution_process_id: Uuid) -> Self {
        Self {
            status: "ready".to_string(),
            upstream: Some(format!("http://127.0.0.1:{port}")),
            message: None,
            execution_process_id: Some(execution_process_id),
        }
    }

    fn starting() -> Self {
        Self {
            status: "starting".to_string(),
            upstream: None,
            message: Some("Preview server is starting".to_string()),
            execution_process_id: None,
        }
    }

    fn starting_with_process(execution_process_id: Uuid) -> Self {
        Self {
            status: "starting".to_string(),
            upstream: None,
            message: Some("Preview server is starting".to_string()),
            execution_process_id: Some(execution_process_id),
        }
    }

    fn not_found(message: &str) -> Self {
        Self {
            status: "not_found".to_string(),
            upstream: None,
            message: Some(message.to_string()),
            execution_process_id: None,
        }
    }

    fn capacity_full(message: &str) -> Self {
        Self {
            status: "capacity_full".to_string(),
            upstream: None,
            message: Some(message.to_string()),
            execution_process_id: None,
        }
    }

    fn failed(message: &str) -> Self {
        Self {
            status: "failed".to_string(),
            upstream: None,
            message: Some(message.to_string()),
            execution_process_id: None,
        }
    }
}

async fn preview_port_is_ready(port: i64) -> bool {
    timeout(
        Duration::from_millis(150),
        TcpStream::connect(("127.0.0.1", port as u16)),
    )
    .await
    .is_ok_and(|result| result.is_ok())
}

async fn probe_preview_port_short(port: i64) -> bool {
    for _ in 0..5 {
        if preview_port_is_ready(port).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

async fn find_workspace_by_preview_token(
    pool: &sqlx::SqlitePool,
    token: &str,
) -> Result<Option<Workspace>, sqlx::Error> {
    let workspace_id: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT workspace_id
           FROM workspace_preview_tokens
           WHERE token = ?"#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    match workspace_id {
        Some((id,)) => Workspace::find_by_id(pool, id).await,
        None => Ok(None),
    }
}

async fn find_workspace_repo_by_preview_slug(
    pool: &sqlx::SqlitePool,
    workspace_id: Uuid,
    repo_slug: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT rps.repo_id
           FROM repo_preview_slugs rps
           JOIN workspace_repos wr ON wr.repo_id = rps.repo_id
           WHERE wr.workspace_id = ? AND rps.slug = ?"#,
    )
    .bind(workspace_id)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(repo_id,)| repo_id))
}

pub fn subdomain_router(deployment: DeploymentImpl) -> Router {
    Router::new()
        .fallback(subdomain_proxy_request)
        .with_state(deployment)
}

async fn proxy_preview_request_no_tail(
    State(deployment): State<DeploymentImpl>,
    Path(target_port): Path<u16>,
    ws_upgrade: Result<SignedWsUpgrade, WebSocketUpgradeRejection>,
    request: Request,
) -> Response {
    match ws_upgrade {
        Ok(ws) => forward_preview_ws(ws, target_port, String::new(), request).await,
        Err(rejection) => {
            preview_proxy::api::proxy_api_request(
                deployment.preview_proxy(),
                target_port,
                String::new(),
                Err(rejection),
                request,
            )
            .await
        }
    }
}

async fn proxy_preview_request(
    State(deployment): State<DeploymentImpl>,
    Path((target_port, tail)): Path<(u16, String)>,
    ws_upgrade: Result<SignedWsUpgrade, WebSocketUpgradeRejection>,
    request: Request,
) -> Response {
    match ws_upgrade {
        Ok(ws) => forward_preview_ws(ws, target_port, tail, request).await,
        Err(rejection) => {
            preview_proxy::api::proxy_api_request(
                deployment.preview_proxy(),
                target_port,
                tail,
                Err(rejection),
                request,
            )
            .await
        }
    }
}

async fn forward_preview_ws(
    ws: SignedWsUpgrade,
    target_port: u16,
    tail: String,
    request: Request,
) -> Response {
    let query = request.uri().query().unwrap_or_default();
    let normalized = tail.trim_start_matches('/');
    let ws_url = if normalized.is_empty() {
        format!("ws://localhost:{target_port}/?{query}")
    } else if query.is_empty() {
        format!("ws://localhost:{target_port}/{normalized}")
    } else {
        format!("ws://localhost:{target_port}/{normalized}?{query}")
    };

    let protocols = request
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned);

    let (upstream_ws, selected_protocol) =
        match connect_upstream_ws(ws_url, protocols.as_deref()).await {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(?error, "Failed to connect preview upstream WebSocket");
                return (StatusCode::BAD_GATEWAY, "Preview WebSocket unavailable").into_response();
            }
        };

    let ws = if let Some(protocol) = selected_protocol {
        ws.protocols([protocol])
    } else {
        ws
    };

    ws.on_upgrade(move |client| async move {
        if let Err(error) = bridge_axum_ws(client, upstream_ws).await {
            tracing::debug!(?error, "Preview WS bridge closed with error");
        }
    })
    .into_response()
}

async fn subdomain_proxy_request(
    State(deployment): State<DeploymentImpl>,
    request: Request,
) -> Response {
    let Some(server_addr) = deployment.client_info().get_server_addr() else {
        return (
            StatusCode::BAD_REQUEST,
            "Local server address is not available",
        )
            .into_response();
    };

    let Some(proxy_port) = deployment.client_info().get_preview_proxy_port() else {
        return (
            StatusCode::BAD_REQUEST,
            "Preview proxy port is not available",
        )
            .into_response();
    };

    preview_proxy::proxy_subdomain_request(
        deployment.preview_proxy(),
        server_addr,
        proxy_port,
        request,
    )
    .await
}
