use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Instant,
};

use axum::{
    Extension,
    extract::{Query, State, ws::Message},
    response::IntoResponse,
};
use deployment::Deployment;
use serde::Deserialize;
use services::services::container::ContainerService;
use utils::process_diag;

use crate::{
    DeploymentImpl,
    middleware::signed_ws::{MaybeSignedWebSocket, SignedWsUpgrade},
};

static ACTIVE_WORKSPACES_WS: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_DIFF_WS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Deserialize)]
pub struct DiffStreamQuery {
    #[serde(default)]
    pub stats_only: bool,
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceStreamQuery {
    pub archived: Option<bool>,
    pub limit: Option<i64>,
}

pub async fn stream_workspaces_ws(
    ws: SignedWsUpgrade,
    Query(query): Query<WorkspaceStreamQuery>,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        let started_at = Instant::now();
        let active = ACTIVE_WORKSPACES_WS.fetch_add(1, Ordering::SeqCst) + 1;
        log_ws_event(
            "workspaces_ws_open",
            active,
            Some(format!(
                "archived={:?} limit={:?}",
                query.archived, query.limit
            )),
        );
        if let Err(e) = handle_workspaces_ws(socket, deployment, query.archived, query.limit).await
        {
            tracing::warn!("workspaces WS closed: {}", e);
        }
        let active = ACTIVE_WORKSPACES_WS.fetch_sub(1, Ordering::SeqCst) - 1;
        log_ws_event(
            "workspaces_ws_close",
            active,
            Some(format!("lifetime_ms={}", started_at.elapsed().as_millis())),
        );
    })
}

pub async fn stream_workspace_diff_ws(
    ws: SignedWsUpgrade,
    Query(params): Query<DiffStreamQuery>,
    Extension(workspace): Extension<db::models::workspace::Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    let _ = deployment.container().touch(&workspace).await;
    let stats_only = params.stats_only;
    ws.on_upgrade(move |socket| async move {
        let started_at = Instant::now();
        let active = ACTIVE_DIFF_WS.fetch_add(1, Ordering::SeqCst) + 1;
        log_ws_event(
            "diff_ws_open",
            active,
            Some(format!(
                "workspace_id={} stats_only={}",
                workspace.id, stats_only
            )),
        );
        if let Err(e) = handle_workspace_diff_ws(socket, deployment, workspace, stats_only).await {
            tracing::warn!("diff WS closed: {}", e);
        }
        let active = ACTIVE_DIFF_WS.fetch_sub(1, Ordering::SeqCst) - 1;
        log_ws_event(
            "diff_ws_close",
            active,
            Some(format!("lifetime_ms={}", started_at.elapsed().as_millis())),
        );
    })
}

async fn handle_workspace_diff_ws(
    mut socket: MaybeSignedWebSocket,
    deployment: DeploymentImpl,
    workspace: db::models::workspace::Workspace,
    stats_only: bool,
) -> anyhow::Result<()> {
    use futures_util::{StreamExt, TryStreamExt};
    use utils::log_msg::LogMsg;

    let stream = deployment
        .container()
        .stream_diff(&workspace, stats_only)
        .await?;

    let mut stream = stream.map_ok(|msg: LogMsg| msg.to_ws_message_unchecked());

    loop {
        tokio::select! {
            item = stream.next() => {
                match item {
                    Some(Ok(msg)) => {
                        if socket.send(msg).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        tracing::error!("stream error: {}", e);
                        break;
                    }
                    None => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Ok(Some(Message::Close(_))) => break,
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }
    Ok(())
}

fn log_ws_event(event: &str, active_connections: usize, detail: Option<String>) {
    if !crate::startup::runtime_diagnostics_enabled() {
        return;
    }

    let snapshot = process_diag::sample_current_process();
    tracing::info!(
        event,
        active_connections,
        detail = detail.as_deref().unwrap_or(""),
        rss_mb = process_diag::bytes_to_mb(snapshot.rss_bytes),
        vm_size_mb = process_diag::bytes_to_mb(snapshot.virtual_bytes),
        threads = snapshot.thread_count,
        fds = snapshot.open_fd_count,
        child_processes = snapshot.child_process_count,
        elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
        "runtime_diag_ws"
    );
}

async fn handle_workspaces_ws(
    mut socket: MaybeSignedWebSocket,
    deployment: DeploymentImpl,
    archived: Option<bool>,
    limit: Option<i64>,
) -> anyhow::Result<()> {
    use futures_util::{StreamExt, TryStreamExt};

    let mut stream = deployment
        .events()
        .stream_workspaces_raw(archived, limit)
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    loop {
        tokio::select! {
            item = stream.next() => {
                match item {
                    Some(Ok(msg)) => {
                        if socket.send(msg).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        tracing::error!("stream error: {}", e);
                        break;
                    }
                    None => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Ok(Some(Message::Close(_))) => break,
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }
    Ok(())
}
