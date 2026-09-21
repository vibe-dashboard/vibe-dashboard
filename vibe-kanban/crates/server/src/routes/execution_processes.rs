use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};

use anyhow;
use axum::{
    Extension, Router,
    extract::{Path, Query, State, ws::Message},
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson},
    routing::{get, post},
};
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessStatus},
    execution_process_repo_state::ExecutionProcessRepoState,
};
use deployment::Deployment;
use futures_util::{
    FutureExt, StreamExt, TryStreamExt,
    future::{BoxFuture, Shared},
    stream::{self, BoxStream},
};
use serde::Deserialize;
use services::services::container::ContainerService;
use tokio::sync::Mutex;
use tracing::Instrument;
use utils::{log_msg::LogMsg, msg_store::MsgStore, response::ApiResponse};
use uuid::Uuid;

use crate::{
    DeploymentImpl,
    error::ApiError,
    middleware::{
        load_execution_process_middleware,
        signed_ws::{MaybeSignedWebSocket, SignedWsUpgrade},
    },
};

#[derive(Debug, Deserialize)]
struct SessionExecutionProcessQuery {
    pub session_id: Uuid,
    /// If true, include soft-deleted (dropped) processes in results/stream
    #[serde(default)]
    pub show_soft_deleted: Option<bool>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum NormalizedLogReplayMode {
    Historic,
}

type SharedNormalizedLogHistoryFuture = Shared<BoxFuture<'static, Option<Arc<Vec<String>>>>>;
type NormalizedLogHistoryInflight =
    Arc<Mutex<HashMap<(Uuid, NormalizedLogReplayMode), SharedNormalizedLogHistoryFuture>>>;

#[derive(Clone, Debug, Default)]
struct LiveNormalizedLogMessages {
    payloads: Vec<String>,
    finished: bool,
}

fn normalized_log_history_inflight() -> &'static NormalizedLogHistoryInflight {
    static INFLIGHT: OnceLock<NormalizedLogHistoryInflight> = OnceLock::new();
    INFLIGHT.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

async fn get_execution_process_by_id(
    Extension(execution_process): Extension<ExecutionProcess>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

async fn stream_raw_logs_ws(
    ws: SignedWsUpgrade,
    State(deployment): State<DeploymentImpl>,
    Path(exec_id): Path<Uuid>,
) -> impl IntoResponse {
    // Always accept the WebSocket upgrade — handle "not found" inside the
    // connection by sending `finished` and closing cleanly, instead of
    // rejecting with HTTP 404 which the browser surfaces as an opaque
    // connection failure.
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_raw_logs_ws(socket, deployment, exec_id).await {
            tracing::warn!("raw logs WS closed: {}", e);
        }
    })
}

async fn handle_raw_logs_ws(
    mut socket: MaybeSignedWebSocket,
    deployment: DeploymentImpl,
    exec_id: Uuid,
) -> anyhow::Result<()> {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use executors::logs::utils::patch::ConversationPatch;
    use utils::log_msg::LogMsg;

    // Get the raw stream — if not found, send finished and close cleanly
    let raw_stream = match deployment.container().stream_raw_logs(&exec_id).await {
        Some(stream) => stream,
        None => {
            // No logs available: send finished so the client gets a clean
            // close instead of retrying endlessly.
            let _ = socket
                .send(LogMsg::Finished.to_ws_message_unchecked())
                .await;
            let _ = socket.close().await;
            return Ok(());
        }
    };

    let counter = Arc::new(AtomicUsize::new(0));
    let mut stream = raw_stream.map_ok({
        let counter = counter.clone();
        move |m| match m {
            LogMsg::Stdout(content) => {
                let index = counter.fetch_add(1, Ordering::SeqCst);
                let patch = ConversationPatch::add_stdout(index, content);
                LogMsg::JsonPatch(patch).to_ws_message_unchecked()
            }
            LogMsg::Stderr(content) => {
                let index = counter.fetch_add(1, Ordering::SeqCst);
                let patch = ConversationPatch::add_stderr(index, content);
                LogMsg::JsonPatch(patch).to_ws_message_unchecked()
            }
            LogMsg::Finished => LogMsg::Finished.to_ws_message_unchecked(),
            _ => unreachable!("Raw stream should only have Stdout/Stderr/Finished"),
        }
    });

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
            inbound = socket.recv() => {
                match inbound {
                    Ok(Some(Message::Close(_))) => break,
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }
    // Send a proper close frame so the client sees code 1000 (normal closure)
    // instead of an abnormal TCP drop that triggers reconnection attempts.
    let _ = socket.close().await;
    Ok(())
}

async fn stream_normalized_logs_ws(
    ws: SignedWsUpgrade,
    State(deployment): State<DeploymentImpl>,
    Path(exec_id): Path<Uuid>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Some(store) = async { deployment.container().get_msg_store_by_id(&exec_id).await }
            .instrument(tracing::debug_span!(
                "normalized_logs.lookup_live_store",
                execution_process_id = %exec_id,
            ))
            .await
        {
            let stream = build_live_normalized_logs_stream(exec_id, store).await;
            if let Err(e) = handle_normalized_logs_ws(socket, stream).await {
                tracing::warn!("normalized logs WS closed: {}", e);
            }
            return;
        }

        match get_historic_normalized_log_messages_single_flight(&deployment, exec_id).await {
            Some(messages) => {
                let payloads = (*messages).clone();
                let stream = futures_util::stream::iter(
                    payloads
                        .into_iter()
                        .map(|payload| Ok::<_, anyhow::Error>(Message::Text(payload.into()))),
                );
                if let Err(e) = handle_normalized_logs_ws(socket, stream).await {
                    tracing::warn!("normalized logs WS closed: {}", e);
                }
            }
            None => {
                let mut socket = socket;
                let _ = socket
                    .send(utils::log_msg::LogMsg::Finished.to_ws_message_unchecked())
                    .await;
                let _ = socket.close().await;
            }
        }
    })
}

#[tracing::instrument(level = "debug", skip(store), fields(execution_process_id = %exec_id))]
async fn build_live_normalized_logs_stream(
    exec_id: Uuid,
    store: Arc<MsgStore>,
) -> BoxStream<'static, anyhow::Result<Message>> {
    let receiver = store.get_receiver();
    let messages = collect_live_normalized_log_messages(&store);
    tracing::debug!(
        execution_process_id = %exec_id,
        history_message_count = messages.payloads.len(),
        history_finished = messages.finished,
        "normalized_logs.live_history_loaded"
    );
    let history_stream = stream::iter(
        messages
            .payloads
            .clone()
            .into_iter()
            .map(|payload| Ok::<_, anyhow::Error>(Message::Text(payload.into()))),
    );

    if messages.finished {
        return history_stream
            .chain(stream::once(async {
                Ok::<_, anyhow::Error>(LogMsg::Finished.to_ws_message_unchecked())
            }))
            .boxed();
    }

    let live_stream = stream::unfold(receiver, move |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(LogMsg::JsonPatch(patch)) => {
                    return Some((
                        Ok::<_, anyhow::Error>(LogMsg::JsonPatch(patch).to_ws_message_unchecked()),
                        receiver,
                    ));
                }
                Ok(LogMsg::Finished) => return None,
                Ok(_) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::error!(
                        skipped = n,
                        execution_process_id = %exec_id,
                        "normalized log stream lagged for subscriber"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    history_stream
        .chain(live_stream)
        .chain(stream::once(async {
            Ok::<_, anyhow::Error>(LogMsg::Finished.to_ws_message_unchecked())
        }))
        .boxed()
}

#[tracing::instrument(level = "debug", skip(deployment), fields(execution_process_id = %exec_id))]
async fn get_historic_normalized_log_messages_single_flight(
    deployment: &DeploymentImpl,
    exec_id: Uuid,
) -> Option<Arc<Vec<String>>> {
    get_normalized_log_messages_single_flight(NormalizedLogReplayMode::Historic, exec_id, {
        let deployment = deployment.clone();
        async move { collect_historic_normalized_log_messages(&deployment, exec_id).await }.boxed()
    })
    .await
}

#[tracing::instrument(
    level = "debug",
    skip(future),
    fields(execution_process_id = %exec_id, mode = ?mode)
)]
async fn get_normalized_log_messages_single_flight(
    mode: NormalizedLogReplayMode,
    exec_id: Uuid,
    future: BoxFuture<'static, Option<Arc<Vec<String>>>>,
) -> Option<Arc<Vec<String>>> {
    let inflight = normalized_log_history_inflight();
    let key = (exec_id, mode);
    let (future, created_here) = {
        let mut guard = inflight.lock().await;
        if let Some(future) = guard.get(&key) {
            (future.clone(), false)
        } else {
            let future = future.shared();
            guard.insert(key, future.clone());
            (future, true)
        }
    };

    let result = future.await;

    if created_here {
        let mut guard = inflight.lock().await;
        guard.remove(&key);
    }

    result
}

#[tracing::instrument(level = "debug", skip(store))]
fn collect_live_normalized_log_messages(store: &MsgStore) -> LiveNormalizedLogMessages {
    let history = store.get_history();
    let finished = history.iter().any(|msg| matches!(msg, LogMsg::Finished));
    let payloads: Vec<String> = history
        .into_iter()
        .take_while(|msg| !matches!(msg, LogMsg::Finished))
        .filter_map(|msg| match msg {
            LogMsg::JsonPatch(patch) => match LogMsg::JsonPatch(patch).to_ws_message_unchecked() {
                Message::Text(payload) => Some(payload.to_string()),
                _ => None,
            },
            _ => None,
        })
        .collect();

    tracing::debug!(
        history_message_count = payloads.len(),
        history_finished = finished,
        "normalized_logs.live_history_collected"
    );

    LiveNormalizedLogMessages { payloads, finished }
}

#[tracing::instrument(level = "debug", skip(deployment), fields(execution_process_id = %exec_id))]
async fn collect_historic_normalized_log_messages(
    deployment: &DeploymentImpl,
    exec_id: Uuid,
) -> Option<Arc<Vec<String>>> {
    let stream = deployment
        .container()
        .stream_normalized_logs(&exec_id)
        .await?;
    let mut stream = stream.err_into::<anyhow::Error>().into_stream();
    let mut messages = Vec::new();

    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => match msg.to_ws_message_unchecked() {
                Message::Text(payload) => messages.push(payload.to_string()),
                _ => continue,
            },
            Err(e) => {
                tracing::warn!(
                    execution_process_id = %exec_id,
                    error = %e,
                    "failed to collect historic normalized logs"
                );
                return None;
            }
        }
    }

    let messages = Arc::new(messages);
    tracing::debug!(
        execution_process_id = %exec_id,
        history_message_count = messages.len(),
        "normalized_logs.historic_history_collected"
    );
    Some(messages)
}

#[tracing::instrument(level = "debug", skip(socket, stream))]
async fn handle_normalized_logs_ws(
    mut socket: MaybeSignedWebSocket,
    stream: impl futures_util::Stream<Item = anyhow::Result<Message>> + Unpin + Send + 'static,
) -> anyhow::Result<()> {
    let mut stream = stream;
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
            inbound = socket.recv() => {
                match inbound {
                    Ok(Some(Message::Close(_))) => break,
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }
    let _ = socket.close().await;
    Ok(())
}

async fn stop_execution_process(
    Extension(execution_process): Extension<ExecutionProcess>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    deployment
        .container()
        .stop_execution(&execution_process, ExecutionProcessStatus::Killed)
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

async fn stream_execution_processes_by_session_ws(
    ws: SignedWsUpgrade,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<SessionExecutionProcessQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_execution_processes_by_session_ws(
            socket,
            deployment,
            query.session_id,
            query.show_soft_deleted.unwrap_or(false),
        )
        .await
        {
            tracing::warn!("execution processes by session WS closed: {}", e);
        }
    })
}

#[tracing::instrument(
    level = "debug",
    skip(socket, deployment),
    fields(session_id = %session_id, show_soft_deleted = show_soft_deleted)
)]
async fn handle_execution_processes_by_session_ws(
    mut socket: MaybeSignedWebSocket,
    deployment: DeploymentImpl,
    session_id: uuid::Uuid,
    show_soft_deleted: bool,
) -> anyhow::Result<()> {
    // Get the raw stream and convert LogMsg to WebSocket messages
    let mut stream = deployment
        .events()
        .stream_execution_processes_for_session_raw(session_id, show_soft_deleted)
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
            inbound = socket.recv() => {
                match inbound {
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

async fn get_execution_process_repo_states(
    Extension(execution_process): Extension<ExecutionProcess>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ExecutionProcessRepoState>>>, ApiError> {
    let pool = &deployment.db().pool;
    let repo_states =
        ExecutionProcessRepoState::find_by_execution_process_id(pool, execution_process.id).await?;
    Ok(ResponseJson(ApiResponse::success(repo_states)))
}

pub(super) fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let workspace_id_router = Router::new()
        .route("/", get(get_execution_process_by_id))
        .route("/stop", post(stop_execution_process))
        .route("/repo-states", get(get_execution_process_repo_states))
        .route("/raw-logs/ws", get(stream_raw_logs_ws))
        .route("/normalized-logs/ws", get(stream_normalized_logs_ws))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_execution_process_middleware,
        ));

    let workspaces_router = Router::new()
        .route(
            "/stream/session/ws",
            get(stream_execution_processes_by_session_ws),
        )
        .nest("/{id}", workspace_id_router);

    Router::new().nest("/execution-processes", workspaces_router)
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use futures_util::{FutureExt, StreamExt};
    use serde_json::json;
    use tokio::{
        sync::{Mutex, oneshot},
        time::timeout,
    };
    use utils::{log_msg::LogMsg, msg_store::MsgStore};
    use uuid::Uuid;

    use super::{
        NormalizedLogReplayMode, build_live_normalized_logs_stream,
        get_normalized_log_messages_single_flight,
    };

    #[tokio::test]
    async fn live_normalized_stream_finishes_when_history_already_finished() {
        let store = Arc::new(MsgStore::new());
        let patch = serde_json::from_value(json!([
            {
                "op": "add",
                "path": "/entries/0",
                "value": "already normalized"
            }
        ]))
        .expect("valid json patch");
        store.push(LogMsg::JsonPatch(patch));
        store.push(LogMsg::Finished);

        let mut stream = build_live_normalized_logs_stream(Uuid::new_v4(), store).await;

        let first = timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("history patch should not hang")
            .expect("history patch should be present")
            .expect("history patch should be ok");
        assert!(
            first.into_text().expect("text message").contains("entries"),
            "expected replayed normalized patch"
        );

        let second = timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("finished message should not hang")
            .expect("finished message should be present")
            .expect("finished message should be ok");
        assert_eq!(
            second.into_text().expect("text message"),
            "{\"finished\":true}"
        );

        let end = timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("stream end should not hang");
        assert!(end.is_none());
    }

    #[tokio::test]
    async fn single_flight_shares_same_mode_requests() {
        let exec_id = Uuid::new_v4();
        let call_count = Arc::new(AtomicUsize::new(0));
        let (started_tx, started_rx) = oneshot::channel::<()>();
        let (release_tx, release_rx) = oneshot::channel::<()>();
        let started_tx = Arc::new(Mutex::new(Some(started_tx)));
        let shared_rx = Arc::new(Mutex::new(Some(release_rx)));

        let task1 = {
            let call_count = call_count.clone();
            let started_tx = started_tx.clone();
            let shared_rx = shared_rx.clone();
            tokio::spawn(async move {
                get_normalized_log_messages_single_flight(
                    NormalizedLogReplayMode::Historic,
                    exec_id,
                    async move {
                        call_count.fetch_add(1, Ordering::SeqCst);
                        if let Some(tx) = started_tx.lock().await.take() {
                            let _ = tx.send(());
                        }
                        if let Some(rx) = shared_rx.lock().await.take() {
                            let _ = rx.await;
                        }
                        Some(Arc::new(vec!["historic".to_string()]))
                    }
                    .boxed(),
                )
                .await
            })
        };

        started_rx.await.unwrap();

        let task2 = {
            let call_count = call_count.clone();
            tokio::spawn(async move {
                get_normalized_log_messages_single_flight(
                    NormalizedLogReplayMode::Historic,
                    exec_id,
                    async move {
                        call_count.fetch_add(1, Ordering::SeqCst);
                        Some(Arc::new(vec!["duplicate".to_string()]))
                    }
                    .boxed(),
                )
                .await
            })
        };

        release_tx.send(()).unwrap();

        let result1 = task1.await.unwrap().unwrap();
        let result2 = task2.await.unwrap().unwrap();

        assert_eq!(call_count.load(Ordering::SeqCst), 1);
        assert_eq!(&*result1, &vec!["historic".to_string()]);
        assert_eq!(&*result2, &vec!["historic".to_string()]);
    }
}
