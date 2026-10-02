//! Minimal JSON-RPC helper tailored for the Codex executor.
//!
//! We keep this bespoke layer because the codex-app-server client must handle server-initiated
//! requests as well as client-initiated requests. When a bidirectional client that
//! supports this pattern is available, this module should be straightforward to
//! replace.

use std::{
    collections::HashMap,
    fmt::Debug,
    io,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicI64, Ordering},
    },
};

use async_trait::async_trait;
use codex_app_server_protocol::{
    JSONRPCError, JSONRPCMessage, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse, RequestId,
};
use codex_protocol::protocol::W3cTraceContext;
use opentelemetry::trace::TraceContextExt;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, ChildStdout},
    sync::{Mutex, oneshot},
};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::executors::{ExecutorError, ExecutorExitResult};

fn perf_agent_startup_tracing_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(workspace_utils::perf_trace::enabled)
}

fn request_id_attr(request_id: &RequestId) -> String {
    match request_id {
        RequestId::Integer(id) => id.to_string(),
        RequestId::String(id) => id.clone(),
    }
}

fn current_span_trace_context() -> Option<W3cTraceContext> {
    let context = tracing::Span::current().context();
    let span_context = context.span().span_context().clone();
    if !span_context.is_valid() {
        return None;
    }

    Some(W3cTraceContext {
        traceparent: Some(format!(
            "00-{}-{}-{:02x}",
            span_context.trace_id(),
            span_context.span_id(),
            span_context.trace_flags().to_u8()
        )),
        tracestate: {
            let header = span_context.trace_state().header();
            (!header.is_empty()).then_some(header)
        },
    })
}

fn encode_request_with_trace<T>(
    request_id: RequestId,
    message: &T,
    trace: Option<W3cTraceContext>,
) -> io::Result<String>
where
    T: Serialize + Sync,
{
    let mut value =
        serde_json::to_value(message).map_err(|err| io::Error::other(err.to_string()))?;
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| io::Error::other("JSON-RPC request missing method"))?
        .to_string();
    let params = value
        .as_object_mut()
        .and_then(|object| object.remove("params"));

    serde_json::to_string(&JSONRPCRequest {
        id: request_id,
        method,
        params,
        trace,
    })
    .map_err(|err| io::Error::other(err.to_string()))
}

#[derive(Debug)]
pub enum PendingResponse {
    Result(Value),
    Error(JSONRPCError),
    Shutdown,
}

#[derive(Clone)]
pub struct ExitSignalSender {
    inner: Arc<Mutex<Option<oneshot::Sender<ExecutorExitResult>>>>,
}

impl ExitSignalSender {
    pub fn new(sender: oneshot::Sender<ExecutorExitResult>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(sender))),
        }
    }

    pub async fn send_exit_signal(&self, result: ExecutorExitResult) {
        if let Some(sender) = self.inner.lock().await.take() {
            let _ = sender.send(result);
        }
    }
}

#[derive(Clone)]
pub struct JsonRpcPeer {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<RequestId, oneshot::Sender<PendingResponse>>>>,
    id_counter: Arc<AtomicI64>,
}

impl JsonRpcPeer {
    pub fn spawn(
        stdin: ChildStdin,
        stdout: ChildStdout,
        callbacks: Arc<dyn JsonRpcCallbacks>,
        exit_tx: ExitSignalSender,
        cancel: CancellationToken,
    ) -> Self {
        let peer = Self {
            stdin: Arc::new(Mutex::new(stdin)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            id_counter: Arc::new(AtomicI64::new(1)),
        };

        let reader_peer = peer.clone();
        let callbacks = callbacks.clone();

        let reader_span = tracing::Span::current();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buffer = String::new();

            loop {
                buffer.clear();
                tokio::select! {
                    _ = cancel.cancelled() => {
                        tracing::debug!("Codex executor cancelled");
                        break;
                    }
                    read_result = reader.read_line(&mut buffer) => {
                        match read_result {
                            Ok(0) => break,
                            Ok(_) => {
                                let line = buffer.trim_end_matches(['\n', '\r']);
                                if line.is_empty() {
                                    continue;
                                }

                                match serde_json::from_str::<JSONRPCMessage>(line) {
                                    Ok(JSONRPCMessage::Response(response)) => {
                                        let request_id = response.id.clone();
                                        let result = response.result.clone();
                                        if callbacks
                                            .on_response(&reader_peer, line, &response)
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                        reader_peer
                                            .resolve(request_id, PendingResponse::Result(result))
                                            .await;
                                    }
                                    Ok(JSONRPCMessage::Error(error)) => {
                                        let request_id = error.id.clone();
                                        if callbacks
                                            .on_error(&reader_peer, line, &error)
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                        reader_peer
                                            .resolve(request_id, PendingResponse::Error(error))
                                            .await;
                                    }
                                    Ok(JSONRPCMessage::Request(request)) => {
                                        if callbacks
                                            .on_request(&reader_peer, line, request)
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                    Ok(JSONRPCMessage::Notification(notification)) => {
                                        match callbacks
                                            .on_notification(&reader_peer, line, notification)
                                            .await
                                        {
                                            // finished
                                            Ok(true) => break,
                                            Ok(false) => {}
                                            Err(_) => {
                                                break;
                                            }
                                        }
                                    }
                                    Err(_) => {
                                        if callbacks.on_non_json(line).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(err) => {
                                tracing::warn!("Error reading Codex output: {err}");
                                break;
                            }
                        }
                    }
                }
            }

            exit_tx.send_exit_signal(ExecutorExitResult::Success).await;
            let _ = reader_peer.shutdown().await;
        }.instrument(reader_span));

        peer
    }

    pub fn next_request_id(&self) -> RequestId {
        RequestId::Integer(self.id_counter.fetch_add(1, Ordering::Relaxed))
    }

    pub async fn register(&self, request_id: RequestId) -> PendingReceiver {
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(request_id, sender);
        receiver
    }

    pub async fn resolve(&self, request_id: RequestId, response: PendingResponse) {
        if let Some(sender) = self.pending.lock().await.remove(&request_id) {
            let _ = sender.send(response);
        }
    }

    pub async fn shutdown(&self) -> Result<(), ExecutorError> {
        let mut pending = self.pending.lock().await;
        for (_, sender) in pending.drain() {
            let _ = sender.send(PendingResponse::Shutdown);
        }
        Ok(())
    }

    pub async fn send<T>(&self, message: &T) -> Result<(), ExecutorError>
    where
        T: Serialize + Sync,
    {
        let raw = serde_json::to_string(message)
            .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;
        self.send_raw(&raw).await
    }

    pub async fn request<R, T>(
        &self,
        request_id: RequestId,
        message: &T,
        label: &str,
        cancel: CancellationToken,
    ) -> Result<R, ExecutorError>
    where
        R: DeserializeOwned + Debug,
        T: Serialize + Sync,
    {
        if perf_agent_startup_tracing_enabled() {
            let request_id_value = request_id_attr(&request_id);
            let span = tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.rpc.request",
                rpc_method = label,
                rpc_request_id = %request_id_value,
            );
            return async move {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    rpc_request_id = %request_id_value,
                    "codex.rpc.register_pending"
                );
                let receiver = self.register(request_id.clone()).await;

                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    rpc_request_id = %request_id_value,
                    "codex.rpc.serialize"
                );
                let trace = current_span_trace_context();
                let raw = encode_request_with_trace(request_id.clone(), message, trace).map_err(
                    |err| {
                        tracing::debug!(
                            target: "perf.agent_startup",
                            rpc_method = label,
                            rpc_request_id = %request_id_value,
                            error = %err,
                            "codex.rpc.serialize_failed"
                        );
                        ExecutorError::Io(io::Error::other(err.to_string()))
                    },
                )?;

                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    rpc_request_id = %request_id_value,
                    rpc_request_bytes = raw.len(),
                    "codex.rpc.stdin_write"
                );
                self.send_raw(&raw).await.inspect_err(|err| {
                    tracing::debug!(
                        target: "perf.agent_startup",
                        rpc_method = label,
                        rpc_request_id = %request_id_value,
                        error = %err,
                        "codex.rpc.stdin_write_failed"
                    );
                })?;

                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    rpc_request_id = %request_id_value,
                    "codex.rpc.await_response"
                );
                let response = await_response(receiver, label, cancel).await;
                match &response {
                    Ok(_) => tracing::debug!(
                        target: "perf.agent_startup",
                        rpc_method = label,
                        rpc_request_id = %request_id_value,
                        "codex.rpc.response_deserialized"
                    ),
                    Err(err) => tracing::debug!(
                        target: "perf.agent_startup",
                        rpc_method = label,
                        rpc_request_id = %request_id_value,
                        error = %err,
                        "codex.rpc.request_failed"
                    ),
                }
                response
            }
            .instrument(span)
            .await;
        }

        let receiver = self.register(request_id).await;
        self.send(message).await?;
        await_response(receiver, label, cancel).await
    }

    async fn send_raw(&self, payload: &str) -> Result<(), ExecutorError> {
        let mut guard = self.stdin.lock().await;
        guard
            .write_all(payload.as_bytes())
            .await
            .map_err(ExecutorError::Io)?;
        guard.write_all(b"\n").await.map_err(ExecutorError::Io)?;
        guard.flush().await.map_err(ExecutorError::Io)?;
        Ok(())
    }
}

pub type PendingReceiver = oneshot::Receiver<PendingResponse>;

pub async fn await_response<R>(
    receiver: PendingReceiver,
    label: &str,
    cancel: CancellationToken,
) -> Result<R, ExecutorError>
where
    R: DeserializeOwned + Debug,
{
    let response = tokio::select! {
        _ = cancel.cancelled() => {
            if perf_agent_startup_tracing_enabled() {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    "codex.rpc.await_cancelled"
                );
            }
            return Err(ExecutorError::Io(io::Error::other(format!(
                "{label} request cancelled",
            ))));
        }
        result = receiver => result,
    };

    match response {
        Ok(PendingResponse::Result(value)) => {
            if perf_agent_startup_tracing_enabled() {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    "codex.rpc.response_received"
                );
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    "codex.rpc.deserialize_response"
                );
            }
            serde_json::from_value(value).map_err(|err| {
                if perf_agent_startup_tracing_enabled() {
                    tracing::debug!(
                        target: "perf.agent_startup",
                        rpc_method = label,
                        error = %err,
                        "codex.rpc.deserialize_failed"
                    );
                }
                ExecutorError::Io(io::Error::other(format!(
                    "failed to decode {label} response: {err}",
                )))
            })
        }
        Ok(PendingResponse::Error(error)) => {
            if perf_agent_startup_tracing_enabled() {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    rpc_error_code = error.error.code,
                    rpc_error_message_len = error.error.message.len(),
                    "codex.rpc.error_response"
                );
            }
            Err(ExecutorError::Io(io::Error::other(format!(
                "{label} request failed: {}",
                error.error.message
            ))))
        }
        Ok(PendingResponse::Shutdown) => {
            if perf_agent_startup_tracing_enabled() {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    "codex.rpc.await_shutdown"
                );
            }
            Err(ExecutorError::Io(io::Error::other(format!(
                "server was shutdown while waiting for {label} response",
            ))))
        }
        Err(_) => {
            if perf_agent_startup_tracing_enabled() {
                tracing::debug!(
                    target: "perf.agent_startup",
                    rpc_method = label,
                    "codex.rpc.await_dropped"
                );
            }
            Err(ExecutorError::Io(io::Error::other(format!(
                "{label} request was dropped",
            ))))
        }
    }
}

#[async_trait]
pub trait JsonRpcCallbacks: Send + Sync {
    async fn on_request(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        request: JSONRPCRequest,
    ) -> Result<(), ExecutorError>;

    async fn on_response(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        response: &JSONRPCResponse,
    ) -> Result<(), ExecutorError>;

    async fn on_error(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        error: &JSONRPCError,
    ) -> Result<(), ExecutorError>;

    async fn on_notification(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<bool, ExecutorError>;

    async fn on_non_json(&self, _raw: &str) -> Result<(), ExecutorError>;
}

#[cfg(test)]
mod tests {
    use serde::Serialize;

    use super::*;

    #[derive(Serialize)]
    struct TestRequest {
        method: &'static str,
        id: RequestId,
        params: serde_json::Value,
    }

    #[test]
    fn encode_request_with_trace_wraps_typed_request_in_jsonrpc_envelope() {
        let raw = encode_request_with_trace(
            RequestId::Integer(7),
            &TestRequest {
                method: "thread/fork",
                id: RequestId::Integer(7),
                params: serde_json::json!({ "threadId": "thread-1" }),
            },
            Some(W3cTraceContext {
                traceparent: Some(
                    "00-00000000000000000000000000000001-0000000000000002-01".to_string(),
                ),
                tracestate: Some("vk=1".to_string()),
            }),
        )
        .expect("request should encode");

        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");
        assert_eq!(value["id"], 7);
        assert_eq!(value["method"], "thread/fork");
        assert_eq!(value["params"]["threadId"], "thread-1");
        assert_eq!(
            value["trace"]["traceparent"],
            "00-00000000000000000000000000000001-0000000000000002-01"
        );
        assert_eq!(value["trace"]["tracestate"], "vk=1");
    }
}
