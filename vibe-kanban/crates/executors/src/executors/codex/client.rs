use std::{
    collections::{HashMap, HashSet, VecDeque},
    io,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use async_trait::async_trait;
use codex_app_server_protocol::{
    ClientInfo, ClientNotification, ClientRequest, CommandExecutionApprovalDecision,
    CommandExecutionRequestApprovalResponse, ConfigBatchWriteParams, ConfigEdit, ConfigReadParams,
    ConfigReadResponse, ConfigWriteResponse, DynamicToolCallOutputContentItem,
    DynamicToolCallResponse, FileChangeApprovalDecision, FileChangeRequestApprovalResponse,
    GetAccountParams, GetAccountRateLimitsResponse, GetAccountResponse, InitializeCapabilities,
    InitializeParams, InitializeResponse, ItemCompletedNotification, JSONRPCError,
    JSONRPCNotification, JSONRPCRequest, JSONRPCResponse, ListMcpServerStatusParams,
    ListMcpServerStatusResponse, McpServerStatusDetail, RequestId, ReviewStartParams,
    ReviewStartResponse, ReviewTarget, ServerRequest, ThreadCompactStartParams,
    ThreadCompactStartResponse, ThreadForkParams, ThreadForkResponse, ThreadItem, ThreadReadParams,
    ThreadReadResponse, ThreadStartParams, ThreadStartResponse, ToolRequestUserInputAnswer,
    ToolRequestUserInputQuestion, ToolRequestUserInputResponse, TurnCompletedNotification,
    TurnStartParams, TurnStartResponse, TurnStatus, UserInput,
};
use codex_protocol::{
    config_types::{CollaborationMode, ModeKind, Settings},
    protocol::{EventMsg, McpStartupCompleteEvent, McpStartupStatus, McpStartupUpdateEvent},
};
use futures::TryFutureExt;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{self, Value};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt, BufWriter},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use workspace_utils::approvals::{ApprovalStatus, QuestionStatus};

use super::jsonrpc::{JsonRpcCallbacks, JsonRpcPeer};
use crate::{
    approvals::{ExecutorApprovalError, ExecutorApprovalService},
    env::RepoContext,
    executors::{ExecutorError, codex::normalize_logs::Approval},
};

struct PendingPlan {
    item_id: String,
}

#[derive(Debug, Deserialize)]
struct CodexNotificationParams {
    msg: EventMsg,
}

fn perf_agent_startup_tracing_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(workspace_utils::perf_trace::enabled)
}

#[derive(Default)]
struct CodexStartupTraceState {
    mcp: McpStartupTraceState,
    saw_session_configured: bool,
    saw_turn_started: bool,
    saw_first_reasoning_delta: bool,
    saw_first_message_delta: bool,
    saw_first_tool_request: bool,
    turn_start_response_at: Option<Instant>,
}

impl CodexStartupTraceState {
    fn mark_turn_start_response(&mut self, thread_id: &str, input_count: usize) {
        self.turn_start_response_at = Some(Instant::now());
        tracing::debug!(
            target: "perf.agent_startup",
            thread_id,
            input_count,
            "codex.turn_start.response_received"
        );
    }

    fn elapsed_since_turn_start_response_ms(&self) -> Option<u64> {
        self.turn_start_response_at
            .map(|started_at| started_at.elapsed().as_millis() as u64)
    }

    fn handle_event(&mut self, event: &EventMsg) {
        match event {
            EventMsg::SessionConfigured(config) => {
                if !self.saw_session_configured {
                    self.saw_session_configured = true;
                    tracing::debug!(
                        target: "perf.agent_startup",
                        session_id = %config.session_id,
                        forked_from_id = ?config.forked_from_id.as_ref().map(ToString::to_string),
                        model = %config.model,
                        model_provider_id = %config.model_provider_id,
                        reasoning_effort = ?config.reasoning_effort,
                        service_tier = ?config.service_tier,
                        "codex.session_configured"
                    );
                }
            }
            EventMsg::McpStartupUpdate(update) => self.mcp.handle_update(update),
            EventMsg::McpStartupComplete(complete) => self.mcp.handle_complete(complete),
            EventMsg::TurnStarted(_) if !self.saw_turn_started => {
                self.saw_turn_started = true;
                tracing::debug!(
                    target: "perf.agent_startup",
                    elapsed_since_turn_start_response_ms = ?self.elapsed_since_turn_start_response_ms(),
                    "codex.turn_started"
                );
            }
            EventMsg::AgentReasoningDelta(_) if !self.saw_first_reasoning_delta => {
                self.saw_first_reasoning_delta = true;
                tracing::debug!(
                    target: "perf.agent_startup",
                    elapsed_since_turn_start_response_ms = ?self.elapsed_since_turn_start_response_ms(),
                    "codex.first_reasoning_delta"
                );
            }
            EventMsg::AgentMessageDelta(_) if !self.saw_first_message_delta => {
                self.saw_first_message_delta = true;
                tracing::debug!(
                    target: "perf.agent_startup",
                    elapsed_since_turn_start_response_ms = ?self.elapsed_since_turn_start_response_ms(),
                    "codex.first_message_delta"
                );
            }
            _ => {}
        }
    }

    fn handle_tool_request(&mut self, tool_kind: &'static str, request_id: &RequestId) {
        if self.saw_first_tool_request {
            return;
        }
        self.saw_first_tool_request = true;
        tracing::debug!(
            target: "perf.agent_startup",
            tool_kind,
            rpc_request_id = ?request_id,
            elapsed_since_turn_start_response_ms = ?self.elapsed_since_turn_start_response_ms(),
            "codex.first_tool_request"
        );
    }
}

#[derive(Default)]
struct McpStartupTraceState {
    span: Option<tracing::Span>,
    started_at: Option<Instant>,
    seen_servers: HashSet<String>,
    server_spans: HashMap<String, tracing::Span>,
    server_started_at: HashMap<String, Instant>,
    update_count: u64,
    starting_count: u64,
    ready_count: u64,
    failed_count: u64,
    cancelled_count: u64,
}

impl McpStartupTraceState {
    fn span(&mut self) -> &tracing::Span {
        self.started_at.get_or_insert_with(Instant::now);
        self.span.get_or_insert_with(|| {
            tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.mcp_startup",
                mcp_server_count = tracing::field::Empty,
                mcp_update_count = tracing::field::Empty,
                mcp_starting_count = tracing::field::Empty,
                mcp_ready_count = tracing::field::Empty,
                mcp_failed_count = tracing::field::Empty,
                mcp_cancelled_count = tracing::field::Empty,
                mcp_ready_servers = tracing::field::Empty,
                mcp_failed_servers = tracing::field::Empty,
                mcp_cancelled_servers = tracing::field::Empty,
                elapsed_ms = tracing::field::Empty,
            )
        })
    }

    fn handle_update(&mut self, update: &McpStartupUpdateEvent) {
        self.update_count += 1;
        self.seen_servers.insert(update.server.clone());

        let status = match &update.status {
            McpStartupStatus::Starting => {
                self.starting_count += 1;
                "starting"
            }
            McpStartupStatus::Ready => {
                self.ready_count += 1;
                "ready"
            }
            McpStartupStatus::Failed { .. } => {
                self.failed_count += 1;
                "failed"
            }
            McpStartupStatus::Cancelled => {
                self.cancelled_count += 1;
                "cancelled"
            }
        };
        let error_len = match &update.status {
            McpStartupStatus::Failed { error } => Some(error.len()),
            _ => None,
        };
        let aggregate_span = self.span().clone();
        let server_elapsed_ms =
            aggregate_span.in_scope(|| self.handle_server_update(update, status, error_len));

        let update_count = self.update_count;
        let server_count = self.seen_servers.len() as u64;
        let starting_count = self.starting_count;
        let ready_count = self.ready_count;
        let failed_count = self.failed_count;
        let cancelled_count = self.cancelled_count;
        let span = self.span();
        span.record("mcp_server_count", server_count);
        span.record("mcp_update_count", update_count);
        span.record("mcp_starting_count", starting_count);
        span.record("mcp_ready_count", ready_count);
        span.record("mcp_failed_count", failed_count);
        span.record("mcp_cancelled_count", cancelled_count);
        span.in_scope(|| {
            tracing::debug!(
                target: "perf.agent_startup",
                mcp_server = %update.server,
                mcp_status = status,
                mcp_error_len = ?error_len,
                mcp_server_elapsed_ms = ?server_elapsed_ms,
                "codex.mcp_startup.update"
            );
        });
    }

    fn handle_server_update(
        &mut self,
        update: &McpStartupUpdateEvent,
        status: &str,
        error_len: Option<usize>,
    ) -> Option<u64> {
        if matches!(update.status, McpStartupStatus::Starting) {
            self.server_started_at
                .entry(update.server.clone())
                .or_insert_with(Instant::now);
            let server_span = self
                .server_spans
                .entry(update.server.clone())
                .or_insert_with(|| {
                    tracing::debug_span!(
                        target: "perf.agent_startup",
                        "codex.mcp_server_startup",
                        mcp_server = %update.server,
                        mcp_status = tracing::field::Empty,
                        elapsed_ms = tracing::field::Empty,
                        mcp_error_len = tracing::field::Empty,
                    )
                });
            server_span.record("mcp_status", status);
            server_span.in_scope(|| {
                tracing::debug!(
                    target: "perf.agent_startup",
                    mcp_server = %update.server,
                    mcp_status = status,
                    "codex.mcp_server_startup.update"
                );
            });
            return None;
        }

        let elapsed_ms = self
            .server_started_at
            .remove(&update.server)
            .map(|started_at| started_at.elapsed().as_millis() as u64);
        let server_span = self.server_spans.remove(&update.server).unwrap_or_else(|| {
            tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.mcp_server_startup",
                mcp_server = %update.server,
                mcp_status = tracing::field::Empty,
                elapsed_ms = tracing::field::Empty,
                mcp_error_len = tracing::field::Empty,
            )
        });
        server_span.record("mcp_status", status);
        if let Some(elapsed_ms) = elapsed_ms {
            server_span.record("elapsed_ms", elapsed_ms);
        }
        if let Some(error_len) = error_len {
            server_span.record("mcp_error_len", error_len as u64);
        }
        server_span.in_scope(|| {
            tracing::debug!(
                target: "perf.agent_startup",
                mcp_server = %update.server,
                mcp_status = status,
                elapsed_ms = ?elapsed_ms,
                mcp_error_len = ?error_len,
                "codex.mcp_server_startup.complete"
            );
        });
        elapsed_ms
    }

    fn handle_complete(&mut self, complete: &McpStartupCompleteEvent) {
        self.seen_servers.extend(complete.ready.iter().cloned());
        self.seen_servers
            .extend(complete.failed.iter().map(|failure| failure.server.clone()));
        self.seen_servers.extend(complete.cancelled.iter().cloned());
        for server in &complete.ready {
            self.finish_server_if_open(server, "ready", None);
        }
        for failure in &complete.failed {
            self.finish_server_if_open(&failure.server, "failed", Some(failure.error.len()));
        }
        for server in &complete.cancelled {
            self.finish_server_if_open(server, "cancelled", None);
        }

        let ready_servers = complete.ready.join(",");
        let failed_servers = complete
            .failed
            .iter()
            .map(|failure| failure.server.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let cancelled_servers = complete.cancelled.join(",");
        let elapsed_ms = self
            .started_at
            .map(|started_at| started_at.elapsed().as_millis() as u64);
        let server_count = self.seen_servers.len() as u64;
        let update_count = self.update_count;

        let span = self.span();
        span.record("mcp_server_count", server_count);
        span.record("mcp_update_count", update_count);
        span.record("mcp_ready_count", complete.ready.len() as u64);
        span.record("mcp_failed_count", complete.failed.len() as u64);
        span.record("mcp_cancelled_count", complete.cancelled.len() as u64);
        span.record("mcp_ready_servers", ready_servers.as_str());
        span.record("mcp_failed_servers", failed_servers.as_str());
        span.record("mcp_cancelled_servers", cancelled_servers.as_str());
        if let Some(elapsed_ms) = elapsed_ms {
            span.record("elapsed_ms", elapsed_ms);
        }
        span.in_scope(|| {
            tracing::debug!(
                target: "perf.agent_startup",
                mcp_ready_count = complete.ready.len(),
                mcp_failed_count = complete.failed.len(),
                mcp_cancelled_count = complete.cancelled.len(),
                mcp_ready_servers = ready_servers.as_str(),
                mcp_failed_servers = failed_servers.as_str(),
                mcp_cancelled_servers = cancelled_servers.as_str(),
                mcp_failed_error_lens = ?complete
                    .failed
                    .iter()
                    .map(|failure| (&failure.server, failure.error.len()))
                    .collect::<Vec<_>>(),
                elapsed_ms = ?elapsed_ms,
                "codex.mcp_startup.complete"
            );
        });
        self.span.take();
    }

    fn finish_server_if_open(&mut self, server: &str, status: &str, error_len: Option<usize>) {
        let Some(server_span) = self.server_spans.remove(server) else {
            return;
        };
        let elapsed_ms = self
            .server_started_at
            .remove(server)
            .map(|started_at| started_at.elapsed().as_millis() as u64);
        server_span.record("mcp_status", status);
        if let Some(elapsed_ms) = elapsed_ms {
            server_span.record("elapsed_ms", elapsed_ms);
        }
        if let Some(error_len) = error_len {
            server_span.record("mcp_error_len", error_len as u64);
        }
        server_span.in_scope(|| {
            tracing::debug!(
                target: "perf.agent_startup",
                mcp_server = server,
                mcp_status = status,
                elapsed_ms = ?elapsed_ms,
                mcp_error_len = ?error_len,
                "codex.mcp_server_startup.complete"
            );
        });
    }
}

pub struct AppServerClient {
    rpc: OnceLock<JsonRpcPeer>,
    log_writer: LogWriter,
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
    thread_id: Mutex<Option<String>>,
    pending_feedback: Mutex<VecDeque<String>>,
    startup_trace: Mutex<CodexStartupTraceState>,
    auto_approve: bool,
    plan_mode: bool,
    resolved_model: OnceLock<String>,
    pending_plan: Mutex<Option<PendingPlan>>,
    repo_context: RepoContext,
    commit_reminder: bool,
    commit_reminder_prompt: String,
    commit_reminder_sent: AtomicBool,
    cancel: CancellationToken,
}

impl AppServerClient {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        log_writer: LogWriter,
        approvals: Option<Arc<dyn ExecutorApprovalService>>,
        auto_approve: bool,
        plan_mode: bool,
        repo_context: RepoContext,
        commit_reminder: bool,
        commit_reminder_prompt: String,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            rpc: OnceLock::new(),
            log_writer,
            approvals,
            auto_approve,
            plan_mode,
            resolved_model: OnceLock::new(),
            pending_plan: Mutex::new(None),
            thread_id: Mutex::new(None),
            pending_feedback: Mutex::new(VecDeque::new()),
            startup_trace: Mutex::new(CodexStartupTraceState::default()),
            repo_context,
            commit_reminder,
            commit_reminder_prompt,
            commit_reminder_sent: AtomicBool::new(false),
            cancel,
        })
    }

    pub fn connect(&self, peer: JsonRpcPeer) {
        let _ = self.rpc.set(peer);
    }

    pub fn set_resolved_model(&self, model: String) {
        let _ = self.resolved_model.set(model);
    }

    fn rpc(&self) -> &JsonRpcPeer {
        self.rpc.get().expect("Codex RPC peer not attached")
    }

    pub fn log_writer(&self) -> &LogWriter {
        &self.log_writer
    }

    pub async fn initialize(&self) -> Result<(), ExecutorError> {
        let request = ClientRequest::Initialize {
            request_id: self.next_request_id(),
            params: InitializeParams {
                client_info: ClientInfo {
                    name: "vibe-codex-executor".to_string(),
                    title: None,
                    version: env!("CARGO_PKG_VERSION").to_string(),
                },
                capabilities: Some(InitializeCapabilities {
                    experimental_api: true,
                    ..Default::default()
                }),
            },
        };

        self.send_request::<InitializeResponse>(request, "initialize")
            .await?;
        self.send_message(&ClientNotification::Initialized).await
    }

    pub async fn thread_start(
        &self,
        params: ThreadStartParams,
    ) -> Result<ThreadStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadStart {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/start").await
    }

    pub async fn thread_fork(
        &self,
        params: ThreadForkParams,
    ) -> Result<ThreadForkResponse, ExecutorError> {
        let request = ClientRequest::ThreadFork {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/fork").await
    }

    pub async fn turn_start_with_mode(
        &self,
        thread_id: String,
        input: Vec<UserInput>,
        collaboration_mode: Option<CollaborationMode>,
    ) -> Result<TurnStartResponse, ExecutorError> {
        let input_count = input.len();
        let trace_thread_id = thread_id.clone();
        let request = ClientRequest::TurnStart {
            request_id: self.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input,
                collaboration_mode,
                ..Default::default()
            },
        };
        let response = self.send_request(request, "turn/start").await?;
        if perf_agent_startup_tracing_enabled() {
            self.startup_trace
                .lock()
                .await
                .mark_turn_start_response(&trace_thread_id, input_count);
        }
        Ok(response)
    }

    fn collaboration_mode(&self, mode: ModeKind) -> Result<CollaborationMode, ExecutorError> {
        let model = self.resolved_model.get().cloned().ok_or_else(|| {
            tracing::error!("collaboration_mode called before resolved_model was set");
            ExecutorError::Io(io::Error::other(
                "resolved model not available for collaboration mode",
            ))
        })?;
        Ok(CollaborationMode {
            mode,
            settings: Settings {
                model,
                reasoning_effort: None,
                developer_instructions: None,
            },
        })
    }

    pub fn initial_collaboration_mode(&self) -> Result<CollaborationMode, ExecutorError> {
        if self.plan_mode {
            self.collaboration_mode(ModeKind::Plan)
        } else {
            self.collaboration_mode(ModeKind::Default)
        }
    }

    pub async fn get_account(&self) -> Result<GetAccountResponse, ExecutorError> {
        let request = ClientRequest::GetAccount {
            request_id: self.next_request_id(),
            params: GetAccountParams {
                refresh_token: false,
            },
        };
        self.send_request(request, "account/read").await
    }

    pub async fn start_review(
        &self,
        thread_id: String,
        target: ReviewTarget,
    ) -> Result<ReviewStartResponse, ExecutorError> {
        let request = ClientRequest::ReviewStart {
            request_id: self.next_request_id(),
            params: ReviewStartParams {
                thread_id,
                target,
                delivery: None,
            },
        };
        self.send_request(request, "reviewStart").await
    }

    pub async fn list_mcp_server_status(
        &self,
        cursor: Option<String>,
    ) -> Result<ListMcpServerStatusResponse, ExecutorError> {
        let request = ClientRequest::McpServerStatusList {
            request_id: self.next_request_id(),
            params: ListMcpServerStatusParams {
                cursor,
                limit: None,
                detail: Some(McpServerStatusDetail::ToolsAndAuthOnly),
            },
        };
        self.send_request(request, "mcpServerStatus/list").await
    }

    pub async fn thread_compact_start(
        &self,
        thread_id: String,
    ) -> Result<ThreadCompactStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadCompactStart {
            request_id: self.next_request_id(),
            params: ThreadCompactStartParams { thread_id },
        };
        self.send_request(request, "thread/compact/start").await
    }

    pub async fn thread_read(
        &self,
        thread_id: String,
    ) -> Result<ThreadReadResponse, ExecutorError> {
        let request = ClientRequest::ThreadRead {
            request_id: self.next_request_id(),
            params: ThreadReadParams {
                thread_id,
                include_turns: false,
            },
        };
        self.send_request(request, "thread/read").await
    }

    pub async fn config_batch_write(
        &self,
        edits: Vec<ConfigEdit>,
    ) -> Result<ConfigWriteResponse, ExecutorError> {
        let request = ClientRequest::ConfigBatchWrite {
            request_id: self.next_request_id(),
            params: ConfigBatchWriteParams {
                edits,
                file_path: None,
                expected_version: None,
                reload_user_config: false,
            },
        };
        self.send_request(request, "config/batchWrite").await
    }

    pub async fn config_read(
        &self,
        cwd: Option<String>,
    ) -> Result<ConfigReadResponse, ExecutorError> {
        let request = ClientRequest::ConfigRead {
            request_id: self.next_request_id(),
            params: ConfigReadParams {
                include_layers: false,
                cwd,
            },
        };
        self.send_request(request, "config/read").await
    }

    pub async fn get_account_rate_limits(
        &self,
    ) -> Result<GetAccountRateLimitsResponse, ExecutorError> {
        let request = ClientRequest::GetAccountRateLimits {
            request_id: self.next_request_id(),
            params: None,
        };
        self.send_request(request, "account/rateLimits/read").await
    }

    async fn handle_server_request(
        &self,
        peer: &JsonRpcPeer,
        request: ServerRequest,
    ) -> Result<(), ExecutorError> {
        match request {
            ServerRequest::FileChangeRequestApproval { request_id, params } => {
                self.trace_tool_request("file_change_approval", &request_id)
                    .await;
                let call_id = params.item_id.clone();
                let status = self
                    .request_tool_approval("edit", "codex.apply_patch", &call_id)
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex file_change approval failed for item_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            call_id,
                            "codex.apply_patch".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.file_change_decision(&status);
                let response = FileChangeRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing file change denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
                self.trace_tool_request("command_execution_approval", &request_id)
                    .await;
                let call_id = params.item_id.clone();
                let status = self
                    .request_tool_approval("bash", "codex.exec_command", &call_id)
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex command_execution approval failed for item_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            call_id,
                            "codex.exec_command".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.command_execution_decision(&status);
                let response = CommandExecutionRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing exec denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::ToolRequestUserInput { request_id, params } => {
                self.trace_tool_request("user_input", &request_id).await;
                let call_id = params.item_id.clone();
                let question_count = params.questions.len();
                let status = self
                    .request_question_answer(question_count, &call_id)
                    .await
                    .inspect_err(|err| {
                        if !matches!(
                            err,
                            ExecutorError::ExecutorApprovalError(ExecutorApprovalError::Cancelled)
                        ) {
                            tracing::error!(
                                "Codex question approval failed for call_id={}: {err}",
                                call_id
                            );
                        }
                    })?;
                self.log_writer
                    .log_raw(&Approval::question_response(call_id.clone(), status.clone()).raw())
                    .await?;
                let response = match &status {
                    QuestionStatus::Answered { answers } => {
                        let answers_map: HashMap<String, Vec<String>> = answers
                            .iter()
                            .map(|qa| (qa.question.clone(), qa.answer.clone()))
                            .collect();
                        answers_to_codex_format(&params.questions, &answers_map)
                    }
                    _ => ToolRequestUserInputResponse {
                        answers: HashMap::new(),
                    },
                };
                send_server_response(peer, request_id, response).await?;
                Ok(())
            }
            ServerRequest::DynamicToolCall { request_id, params } => {
                self.trace_tool_request("dynamic_tool_call", &request_id)
                    .await;
                tracing::warn!(
                    "received unsupported dynamic tool call: tool={} call_id={}",
                    params.tool,
                    params.call_id
                );
                let response = DynamicToolCallResponse {
                    content_items: vec![DynamicToolCallOutputContentItem::InputText {
                        text: format!(
                            "Dynamic tool '{}' is not supported by this client.",
                            params.tool
                        ),
                    }],
                    success: false,
                };
                send_server_response(peer, request_id, response).await?;
                Ok(())
            }
            ServerRequest::ChatgptAuthTokensRefresh { .. }
            | ServerRequest::McpServerElicitationRequest { .. }
            | ServerRequest::PermissionsRequestApproval { .. } => {
                tracing::warn!("received unhandled v2 server request: {:?}", request);
                let response = JSONRPCResponse {
                    id: request.id().clone(),
                    result: Value::Null,
                };
                peer.send(&response).await
            }
            ServerRequest::ApplyPatchApproval { .. }
            | ServerRequest::ExecCommandApproval { .. } => {
                tracing::error!(
                    "received deprecated v1 server request (session may have been started with legacy API): {:?}",
                    request
                );
                Err(ExecutorApprovalError::RequestFailed(
                    "deprecated v1 server request".to_string(),
                )
                .into())
            }
        }
    }

    async fn trace_tool_request(&self, tool_kind: &'static str, request_id: &RequestId) {
        if !perf_agent_startup_tracing_enabled() {
            return;
        }
        self.startup_trace
            .lock()
            .await
            .handle_tool_request(tool_kind, request_id);
    }

    async fn request_tool_approval(
        &self,
        tool_name: &str,
        display_tool_name: &str,
        tool_call_id: &str,
    ) -> Result<ApprovalStatus, ExecutorError> {
        if self.auto_approve {
            return Ok(ApprovalStatus::Approved);
        }
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_tool_approval(tool_name)
            .or_else(|err| async {
                self.handle_approval_error(display_tool_name, tool_call_id)
                    .await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    tool_call_id.to_string(),
                    display_tool_name.to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        approval_service
            .wait_tool_approval(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_approval_error(display_tool_name, tool_call_id)
                    .await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)
    }

    async fn handle_approval_error(&self, display_tool_name: &str, tool_call_id: &str) {
        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_response(
                    tool_call_id.to_string(),
                    display_tool_name.to_string(),
                    ApprovalStatus::TimedOut,
                )
                .raw(),
            )
            .await;
    }

    async fn request_question_answer(
        &self,
        question_count: usize,
        tool_call_id: &str,
    ) -> Result<QuestionStatus, ExecutorError> {
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_question_approval("question", question_count)
            .or_else(|err| async {
                self.handle_question_error(tool_call_id).await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    tool_call_id.to_string(),
                    "codex.question".to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        approval_service
            .wait_question_answer(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_question_error(tool_call_id).await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)
    }

    async fn handle_question_error(&self, tool_call_id: &str) {
        let _ = self
            .log_writer
            .log_raw(
                &Approval::question_response(tool_call_id.to_string(), QuestionStatus::TimedOut)
                    .raw(),
            )
            .await;
    }

    async fn handle_plan_completed(&self, plan: PendingPlan) -> Result<bool, ExecutorError> {
        let approval_service = self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?;

        let approval_id = approval_service
            .create_tool_approval("plan")
            .or_else(|err| async {
                self.handle_approval_error("codex.plan", &plan.item_id)
                    .await;
                Err(err)
            })
            .await?;

        let _ = self
            .log_writer
            .log_raw(
                &Approval::approval_requested(
                    plan.item_id.clone(),
                    "codex.plan".to_string(),
                    approval_id.clone(),
                )
                .raw(),
            )
            .await;

        let status = approval_service
            .wait_tool_approval(&approval_id, self.cancel.clone())
            .or_else(|err| async {
                self.handle_approval_error("codex.plan", &plan.item_id)
                    .await;
                Err(err)
            })
            .await
            .map_err(ExecutorError::from)?;

        self.log_writer
            .log_raw(
                &Approval::approval_response(
                    plan.item_id,
                    "codex.plan".to_string(),
                    status.clone(),
                )
                .raw(),
            )
            .await?;

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            return Ok(true);
        };

        match status {
            ApprovalStatus::Approved => {
                self.spawn_turn_start(
                    thread_id,
                    "Implement the plan.".to_string(),
                    Some(self.collaboration_mode(ModeKind::Default)?),
                );
                Ok(false)
            }
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if let Some(feedback_text) = feedback {
                    self.spawn_turn_start(
                        thread_id,
                        format!("User feedback on the plan: {feedback_text}"),
                        Some(self.collaboration_mode(ModeKind::Plan)?),
                    );
                    Ok(false)
                } else {
                    Ok(true)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => Ok(true),
        }
    }

    pub async fn register_session(&self, thread_id: &str) -> Result<(), ExecutorError> {
        {
            let mut guard = self.thread_id.lock().await;
            guard.replace(thread_id.to_string());
        }
        self.flush_pending_feedback().await;
        Ok(())
    }

    async fn send_message<M>(&self, message: &M) -> Result<(), ExecutorError>
    where
        M: Serialize + Sync,
    {
        self.rpc().send(message).await
    }

    async fn send_request<R>(&self, request: ClientRequest, label: &str) -> Result<R, ExecutorError>
    where
        R: DeserializeOwned + std::fmt::Debug,
    {
        let request_id = request_id(&request);
        self.rpc()
            .request(request_id, &request, label, self.cancel.clone())
            .await
    }

    fn next_request_id(&self) -> RequestId {
        self.rpc().next_request_id()
    }

    fn command_execution_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (CommandExecutionApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (CommandExecutionApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (CommandExecutionApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (CommandExecutionApprovalDecision::Cancel, feedback)
                } else {
                    (CommandExecutionApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut => (CommandExecutionApprovalDecision::Decline, None),
            ApprovalStatus::Pending => (CommandExecutionApprovalDecision::Decline, None),
        }
    }

    fn file_change_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (FileChangeApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (FileChangeApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (FileChangeApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (FileChangeApprovalDecision::Cancel, feedback)
                } else {
                    (FileChangeApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut => (FileChangeApprovalDecision::Decline, None),
            ApprovalStatus::Pending => (FileChangeApprovalDecision::Decline, None),
        }
    }

    async fn enqueue_feedback(&self, message: String) {
        if message.trim().is_empty() {
            return;
        }
        let mut guard = self.pending_feedback.lock().await;
        guard.push_back(message);
    }

    /// Sends pending feedback messages as new turns.
    /// Returns `true` if any messages were sent.
    async fn flush_pending_feedback(&self) -> bool {
        let messages: Vec<String> = {
            let mut guard = self.pending_feedback.lock().await;
            guard.drain(..).collect()
        };

        if messages.is_empty() {
            return false;
        }

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            tracing::warn!(
                "pending Codex feedback but thread id unavailable; dropping {} messages",
                messages.len()
            );
            return false;
        };

        let mut sent = false;
        for message in messages {
            let trimmed = message.trim();
            if trimmed.is_empty() {
                continue;
            }
            self.spawn_user_message(thread_id.clone(), format!("User feedback: {trimmed}"));
            sent = true;
        }
        sent
    }

    fn spawn_turn_start(
        &self,
        thread_id: String,
        message: String,
        collaboration_mode: Option<CollaborationMode>,
    ) {
        let peer = self.rpc().clone();
        let cancel = self.cancel.clone();
        let request = ClientRequest::TurnStart {
            request_id: peer.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: vec![UserInput::Text {
                    text: message,
                    text_elements: vec![],
                }],
                collaboration_mode,
                ..Default::default()
            },
        };
        tokio::spawn(async move {
            if let Err(err) = peer
                .request::<TurnStartResponse, _>(
                    request_id(&request),
                    &request,
                    "turn/start",
                    cancel,
                )
                .await
            {
                tracing::error!("failed to send user message: {err}");
            }
        });
    }

    fn spawn_user_message(&self, thread_id: String, message: String) {
        self.spawn_turn_start(thread_id, message, None);
    }
}

#[async_trait]
impl JsonRpcCallbacks for AppServerClient {
    async fn on_request(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        request: JSONRPCRequest,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        match ServerRequest::try_from(request.clone()) {
            Ok(server_request) => self.handle_server_request(peer, server_request).await,
            Err(err) => {
                tracing::debug!("Unhandled server request `{}`: {err}", request.method);
                let response = JSONRPCResponse {
                    id: request.id,
                    result: Value::Null,
                };
                peer.send(&response).await
            }
        }
    }

    async fn on_response(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _response: &JSONRPCResponse,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_error(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _error: &JSONRPCError,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_notification(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<bool, ExecutorError> {
        self.log_writer.log_raw(raw).await?;

        let method = notification.method.as_str();

        if perf_agent_startup_tracing_enabled()
            && method.starts_with("codex/event")
            && let Some(params) = notification.params.as_ref()
            && let Ok(params) = serde_json::from_value::<CodexNotificationParams>(params.clone())
        {
            self.startup_trace.lock().await.handle_event(&params.msg);
        }

        // Detect completed plan items in the notification stream
        if self.plan_mode
            && method == "item/completed"
            && let Some(ref params) = notification.params
            && let Ok(completed) =
                serde_json::from_value::<ItemCompletedNotification>(params.clone())
            && let ThreadItem::Plan { id, .. } = completed.item
        {
            *self.pending_plan.lock().await = Some(PendingPlan { item_id: id });
        }

        // V2 turn completion detection
        if method == "turn/completed" {
            let mut keep_alive = false;

            if let Some(params) = notification.params
                && let Ok(completed) = serde_json::from_value::<TurnCompletedNotification>(params)
                && completed.turn.status == TurnStatus::Interrupted
            {
                tracing::debug!("codex turn interrupted; flushing feedback queue");
                if self.flush_pending_feedback().await {
                    keep_alive = true;
                }
            }

            // Handle plan approval on turn completion
            let pending = if self.plan_mode {
                self.pending_plan.lock().await.take()
            } else {
                None
            };
            if let Some(plan) = pending {
                return self.handle_plan_completed(plan).await;
            }

            // Handle commit reminder on turn completion
            if !keep_alive
                && self.commit_reminder
                && !self.commit_reminder_sent.swap(true, Ordering::SeqCst)
                && let status = self.repo_context.check_uncommitted_changes().await
                && !status.is_empty()
                && let Some(thread_id) = self.thread_id.lock().await.clone()
            {
                let prompt = format!("{}\n{}", self.commit_reminder_prompt, status);
                self.spawn_user_message(thread_id, prompt);
                return Ok(false);
            }

            return Ok(!keep_alive);
        }

        Ok(false)
    }

    async fn on_non_json(&self, raw: &str) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        Ok(())
    }
}

async fn send_server_response<T>(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    response: T,
) -> Result<(), ExecutorError>
where
    T: Serialize,
{
    let payload = JSONRPCResponse {
        id: request_id,
        result: serde_json::to_value(response)
            .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
    };

    peer.send(&payload).await
}

/// Convert our `HashMap<question_text, Vec<answer_labels>>` answer format to
/// Codex's `HashMap<question_id, ToolRequestUserInputAnswer>` format.
fn answers_to_codex_format(
    questions: &[ToolRequestUserInputQuestion],
    answers: &HashMap<String, Vec<String>>,
) -> ToolRequestUserInputResponse {
    let codex_answers = questions
        .iter()
        .filter_map(|q| {
            answers.get(&q.question).map(|answer_vec| {
                (
                    q.id.clone(),
                    ToolRequestUserInputAnswer {
                        answers: answer_vec.clone(),
                    },
                )
            })
        })
        .collect();

    ToolRequestUserInputResponse {
        answers: codex_answers,
    }
}

fn request_id(request: &ClientRequest) -> RequestId {
    match request {
        ClientRequest::Initialize { request_id, .. }
        | ClientRequest::ThreadStart { request_id, .. }
        | ClientRequest::ThreadFork { request_id, .. }
        | ClientRequest::TurnStart { request_id, .. }
        | ClientRequest::GetAccount { request_id, .. }
        | ClientRequest::ReviewStart { request_id, .. }
        | ClientRequest::McpServerStatusList { request_id, .. }
        | ClientRequest::ThreadCompactStart { request_id, .. }
        | ClientRequest::ThreadRead { request_id, .. }
        | ClientRequest::ConfigRead { request_id, .. }
        | ClientRequest::ConfigBatchWrite { request_id, .. }
        | ClientRequest::GetAccountRateLimits { request_id, .. } => request_id.clone(),
        _ => unreachable!("request_id called for unsupported request variant"),
    }
}

#[derive(Clone)]
pub struct LogWriter {
    writer: Arc<Mutex<BufWriter<Box<dyn AsyncWrite + Send + Unpin>>>>,
    first_raw_write_seen: Arc<AtomicBool>,
}

impl LogWriter {
    pub fn new(writer: impl AsyncWrite + Send + Unpin + 'static) -> Self {
        Self {
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(writer)))),
            first_raw_write_seen: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn log_raw(&self, raw: &str) -> Result<(), ExecutorError> {
        if perf_agent_startup_tracing_enabled()
            && !self.first_raw_write_seen.swap(true, Ordering::Relaxed)
        {
            tracing::debug!(
                target: "perf.agent_startup",
                raw_log_bytes = raw.len(),
                "codex.first_raw_log_write"
            );
        }
        let mut guard = self.writer.lock().await;
        guard
            .write_all(raw.as_bytes())
            .await
            .map_err(ExecutorError::Io)?;
        guard.write_all(b"\n").await.map_err(ExecutorError::Io)?;
        guard.flush().await.map_err(ExecutorError::Io)?;
        Ok(())
    }
}
