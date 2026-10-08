pub mod client;
pub mod jsonrpc;
mod model_catalog;
pub mod normalize_logs;
pub mod review;
pub mod slash_commands;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};

/// Returns the Codex home directory.
///
/// Checks the `CODEX_HOME` environment variable first, then falls back to `~/.codex`.
/// This allows users to configure a custom location for Codex configuration and state.
pub fn codex_home() -> Option<PathBuf> {
    if let Ok(codex_home) = env::var("CODEX_HOME")
        && !codex_home.trim().is_empty()
    {
        return Some(PathBuf::from(codex_home));
    }
    dirs::home_dir().map(|home| home.join(".codex"))
}

pub(crate) fn resolve_model(model: Option<&str>) -> (Option<&str>, bool) {
    match model.and_then(|m| m.strip_suffix("-fast")) {
        Some(base) => (Some(base), true),
        None => (model, false),
    }
}

pub(crate) fn fork_params_from(thread_id: String, params: ThreadStartParams) -> ThreadForkParams {
    ThreadForkParams {
        thread_id,
        model: params.model,
        model_provider: params.model_provider,
        cwd: params.cwd,
        approval_policy: params.approval_policy,
        sandbox: params.sandbox,
        config: params.config,
        base_instructions: params.base_instructions,
        developer_instructions: params.developer_instructions,
        service_tier: params.service_tier,
        ..Default::default()
    }
}

use async_trait::async_trait;
use codex_app_server_protocol::{
    AskForApproval as V2AskForApproval, ReviewTarget, SandboxMode as V2SandboxMode,
    ThreadForkParams, ThreadStartParams, UserInput,
};
use codex_protocol::config_types::ServiceTier;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use strum_macros::{AsRefStr, EnumString};
use tokio::process::Command;
use tracing::Instrument;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use self::{
    client::{AppServerClient, LogWriter},
    jsonrpc::{ExitSignalSender, JsonRpcPeer},
    normalize_logs::{Error, normalize_logs},
};
use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, CommandParts, apply_overrides},
    env::ExecutionEnv,
    executor_discovery::ExecutorDiscoveredOptions,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, ExecutorExitResult,
        SlashCommandDescription, SpawnedChild, StandardCodingAgentExecutor,
    },
    logs::utils::patch,
    model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy, ReasoningOption},
    profile::ExecutorConfig,
    stdout_dup::create_stdout_pipe_writer,
};

/// Sandbox policy modes for Codex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum SandboxMode {
    Auto,
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

/// Determines when the user is consulted to approve Codex actions.
///
/// - `UnlessTrusted`: Read-only commands are auto-approved. Everything else will
///   ask the user to approve.
/// - `OnFailure`: All commands run in a restricted sandbox initially. If a
///   command fails, the user is asked to approve execution without the sandbox.
/// - `OnRequest`: The model decides when to ask the user for approval.
/// - `Never`: Commands never ask for approval. Commands that fail in the
///   restricted sandbox are not retried.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum AskForApproval {
    UnlessTrusted,
    OnFailure,
    OnRequest,
    Never,
}

/// Reasoning effort for the underlying model
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr, EnumString)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    Xhigh,
}

/// Model reasoning summary style
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummary {
    Auto,
    Concise,
    Detailed,
    None,
}

/// Format for model reasoning summaries
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummaryFormat {
    None,
    Experimental,
}

enum CodexSessionAction {
    Chat { prompt: String },
    Review { target: ReviewTarget },
}

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Codex {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_for_approval: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oss: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<ReasoningEffort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary: Option<ReasoningSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary_format: Option<ReasoningSummaryFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_apply_patch_tool: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_instructions: Option<String>,
    #[serde(default)]
    pub plan: bool,
    #[serde(flatten)]
    pub cmd: CmdOverrides,

    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

#[async_trait]
impl StandardCodingAgentExecutor for Codex {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }
        if let Some(reasoning_id) = &executor_config.reasoning_id
            && let Ok(reasoning_effort) = ReasoningEffort::from_str(reasoning_id)
        {
            self.model_reasoning_effort = Some(reasoning_effort)
        }
        if let Some(permission_policy) = &executor_config.permission_policy {
            match permission_policy {
                crate::model_selector::PermissionPolicy::Auto => {
                    self.ask_for_approval = Some(AskForApproval::Never);
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Supervised => {
                    if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
                        self.ask_for_approval = Some(AskForApproval::UnlessTrusted);
                    }
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Plan => {
                    self.plan = true;
                }
            }
        }
    }

    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, None, env)
            .await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, Some(session_id), env)
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<PathBuf> {
        codex_home().map(|home| home.join("config.toml"))
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        if let Some(timestamp) = codex_home()
            .and_then(|home| std::fs::metadata(home.join("auth.json")).ok())
            .and_then(|m| m.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
        {
            return AvailabilityInfo::LoginDetected {
                last_auth_timestamp: timestamp,
            };
        }

        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let installation_indicator_found = codex_home()
            .map(|home| home.join("version.json").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        use crate::model_selector::*;
        let permission_policy = if self.plan {
            PermissionPolicy::Plan
        } else if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
            PermissionPolicy::Auto
        } else {
            PermissionPolicy::Supervised
        };

        ExecutorConfig {
            executor: BaseCodingAgent::Codex,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: self
                .model_reasoning_effort
                .as_ref()
                .map(|e| e.as_ref().to_string()),
            permission_policy: Some(permission_policy),
        }
    }

    async fn discover_options(
        &self,
        _workdir: Option<&std::path::Path>,
        _repo_path: Option<&std::path::Path>,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let fallback_options = Self::static_discovered_options();
        let initial_options = ExecutorDiscoveredOptions {
            loading_models: true,
            ..fallback_options.clone()
        };
        let this = self.clone();

        let discovery_stream = async_stream::stream! {
            yield patch::executor_discovered_options(initial_options);

            match this.discover_model_selector_from_bundled_catalog().await {
                Ok(model_selector) => {
                    let options = ExecutorDiscoveredOptions {
                        model_selector,
                        ..fallback_options
                    };
                    yield patch::executor_discovered_options(options);
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to discover Codex models from bundled catalog; using static fallback: {error}"
                    );
                    yield patch::executor_discovered_options(fallback_options);
                }
            }
        };

        Ok(Box::pin(discovery_stream))
    }

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let review_target = ReviewTarget::Custom {
            instructions: prompt.to_string(),
        };
        let action = CodexSessionAction::Review {
            target: review_target,
        };
        self.spawn_inner(current_dir, command_parts, action, session_id, env)
            .await
    }
}

impl Codex {
    fn static_discovered_options() -> ExecutorDiscoveredOptions {
        let xhigh_reasoning_options = ReasoningOption::from_names(
            [
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
                ReasoningEffort::Xhigh,
            ]
            .map(|e| e.as_ref().to_string()),
        );

        let models = vec![
            ModelInfo {
                id: "gpt-5.6".to_string(),
                name: "GPT-5.6".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-sol".to_string(),
                name: "GPT-5.6 Sol".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-sol-fast".to_string(),
                name: "GPT-5.6 Sol Fast".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-terra".to_string(),
                name: "GPT-5.6 Terra".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-terra-fast".to_string(),
                name: "GPT-5.6 Terra Fast".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-luna".to_string(),
                name: "GPT-5.6 Luna".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.5".to_string(),
                name: "GPT-5.5".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.5-fast".to_string(),
                name: "GPT-5.5 Fast".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.4".to_string(),
                name: "GPT-5.4".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.4-fast".to_string(),
                name: "GPT-5.4 Fast".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.4-mini".to_string(),
                name: "GPT-5.4 Mini".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.3-codex".to_string(),
                name: "GPT-5.3 Codex".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.3-codex-spark".to_string(),
                name: "GPT-5.3 Codex Spark".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.2".to_string(),
                name: "GPT-5.2".to_string(),
                provider_id: None,
                reasoning_options: xhigh_reasoning_options,
            },
        ];
        let model_order = models.iter().map(|model| model.id.clone()).collect();

        ExecutorDiscoveredOptions {
            model_selector: ModelSelectorConfig {
                models,
                model_order: Some(model_order),
                permissions: vec![
                    PermissionPolicy::Auto,
                    PermissionPolicy::Supervised,
                    PermissionPolicy::Plan,
                ],
                ..Default::default()
            },
            slash_commands: vec![
                SlashCommandDescription {
                    name: "clear".to_string(),
                    description: Some(
                        "clear VK's session context while keeping conversation history visible"
                            .to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "compact".to_string(),
                    description: Some(
                        "summarize conversation to prevent hitting the context limit; extra instructions are provider-dependent best-effort"
                            .to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "init".to_string(),
                    description: Some(
                        "create an AGENTS.md file with instructions for Codex".to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "status".to_string(),
                    description: Some(
                        "show current session configuration and token usage".to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "mcp".to_string(),
                    description: Some("list configured MCP tools".to_string()),
                },
                SlashCommandDescription {
                    name: "model".to_string(),
                    description: Some("view or switch the active model".to_string()),
                },
                SlashCommandDescription {
                    name: "fast".to_string(),
                    description: Some(
                        "toggle fast mode for highest speed inference (2× plan usage). Use `/fast on` or `/fast off` to set explicitly".to_string(),
                    ),
                },
            ],
            ..Default::default()
        }
    }
}

impl Codex {
    const BINARY_ENV_VAR: &'static str = "VK_CODEX_BINARY";

    pub fn base_command() -> &'static str {
        "npx -y @openai/codex@0.147.0"
    }

    fn selected_base_command(&self) -> Result<String, CommandBuildError> {
        Self::select_base_command(
            self.cmd.base_command_override.as_deref(),
            env::var_os(Self::BINARY_ENV_VAR),
        )
    }

    fn select_base_command(
        user_override: Option<&str>,
        configured_binary: Option<std::ffi::OsString>,
    ) -> Result<String, CommandBuildError> {
        if let Some(user_override) = user_override {
            return Ok(user_override.to_string());
        }

        let Some(configured_binary) = configured_binary else {
            return Ok(Self::base_command().to_string());
        };
        let path = PathBuf::from(configured_binary);
        if !path.is_absolute() || !Self::is_executable_file(&path) {
            return Err(CommandBuildError::InvalidConfiguredExecutable {
                variable: Self::BINARY_ENV_VAR,
                path: path.to_string_lossy().into_owned(),
            });
        }

        let path = path.to_string_lossy();
        #[cfg(windows)]
        let command = format!("\"{}\"", path.replace('"', "\\\""));
        #[cfg(not(windows))]
        let command = shlex::try_quote(&path)?.into_owned();
        Ok(command)
    }

    fn is_executable_file(path: &Path) -> bool {
        let Ok(metadata) = path.metadata() else {
            return false;
        };
        if !metadata.is_file() {
            return false;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            true
        }
    }

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(self.selected_base_command()?);
        builder = builder.extend_params(["app-server"]);
        if self.oss.unwrap_or(false) {
            builder = builder.extend_params(["--oss"]);
        }

        apply_overrides(builder, &self.cmd)
    }

    fn build_model_catalog_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        Ok(
            CommandBuilder::new(self.selected_base_command()?).extend_params([
                "debug",
                "models",
                "--bundled",
            ]),
        )
    }

    async fn discover_model_selector_from_bundled_catalog(
        &self,
    ) -> Result<ModelSelectorConfig, ExecutorError> {
        const CODEX_MODEL_CATALOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

        let command_parts = self
            .build_model_catalog_command_builder()?
            .build_initial()
            .map_err(ExecutorError::from)?;
        let (executable, args) = command_parts.into_resolved().await?;
        let mut command = Command::new(executable);
        command.env("CODEX_SQLITE_LOGS", "off").args(args);
        if let Some(env) = &self.cmd.env {
            command.envs(env);
        }

        let output = tokio::time::timeout(CODEX_MODEL_CATALOG_TIMEOUT, command.output())
            .await
            .map_err(|_| {
                ExecutorError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "timed out running codex debug models --bundled",
                ))
            })?
            .map_err(ExecutorError::Io)?;

        if !output.status.success() {
            return Err(ExecutorError::Io(std::io::Error::other(format!(
                "codex debug models --bundled exited with status {}",
                output.status
            ))));
        }

        model_catalog::model_selector_from_catalog_slice(&output.stdout)
            .map_err(|error| ExecutorError::Io(std::io::Error::other(error)))
    }

    fn build_thread_start_params(&self, cwd: &Path) -> ThreadStartParams {
        let sandbox = match self.sandbox.as_ref() {
            None | Some(SandboxMode::Auto) => Some(V2SandboxMode::WorkspaceWrite), // match the Auto preset in codex
            Some(SandboxMode::ReadOnly) => Some(V2SandboxMode::ReadOnly),
            Some(SandboxMode::WorkspaceWrite) => Some(V2SandboxMode::WorkspaceWrite),
            Some(SandboxMode::DangerFullAccess) => Some(V2SandboxMode::DangerFullAccess),
        };

        let approval_policy = match self.ask_for_approval.as_ref() {
            None if matches!(self.sandbox.as_ref(), None | Some(SandboxMode::Auto)) => {
                // match the Auto preset in codex
                Some(V2AskForApproval::OnRequest)
            }
            None => None,
            Some(AskForApproval::UnlessTrusted) => Some(V2AskForApproval::UnlessTrusted),
            Some(AskForApproval::OnFailure) => Some(V2AskForApproval::OnRequest),
            Some(AskForApproval::OnRequest) => Some(V2AskForApproval::OnRequest),
            Some(AskForApproval::Never) => Some(V2AskForApproval::Never),
        };

        let mut config = self.build_config_overrides();
        // V1 top-level params that moved into config overrides in v2
        if let Some(profile) = &self.profile {
            config
                .get_or_insert_with(HashMap::new)
                .insert("profile".to_string(), Value::String(profile.clone()));
        }
        if let Some(include) = self.include_apply_patch_tool {
            config
                .get_or_insert_with(HashMap::new)
                .insert("include_apply_patch_tool".to_string(), Value::Bool(include));
        }
        if let Some(compact) = &self.compact_prompt {
            config
                .get_or_insert_with(HashMap::new)
                .insert("compact_prompt".to_string(), Value::String(compact.clone()));
        }
        if !matches!(approval_policy, None | Some(V2AskForApproval::Never)) {
            let map = config.get_or_insert_with(HashMap::new);
            map.insert(
                "features.default_mode_request_user_input".to_string(),
                Value::Bool(true),
            );
            map.insert(
                "suppress_unstable_features_warning".to_string(),
                Value::Bool(true),
            );
        }

        let (model, is_fast) = resolve_model(self.model.as_deref());
        let service_tier = if is_fast {
            Some(Some(ServiceTier::Fast.request_value().to_string()))
        } else {
            None
        };

        ThreadStartParams {
            model: model.map(|m| m.to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            approval_policy,
            sandbox,
            config,
            base_instructions: self.base_instructions.clone(),
            model_provider: self.model_provider.clone(),
            developer_instructions: self.developer_instructions.clone(),
            service_tier,
            ..Default::default()
        }
    }

    fn build_config_overrides(&self) -> Option<HashMap<String, Value>> {
        let mut overrides = HashMap::new();

        if let Some(effort) = &self.model_reasoning_effort {
            overrides.insert(
                "model_reasoning_effort".to_string(),
                Value::String(effort.as_ref().to_string()),
            );
        }

        if let Some(summary) = &self.model_reasoning_summary {
            overrides.insert(
                "model_reasoning_summary".to_string(),
                Value::String(summary.as_ref().to_string()),
            );
        }

        if let Some(format) = &self.model_reasoning_summary_format
            && format != &ReasoningSummaryFormat::None
        {
            overrides.insert(
                "model_reasoning_summary_format".to_string(),
                Value::String(format.as_ref().to_string()),
            );
        }

        if overrides.is_empty() {
            None
        } else {
            Some(overrides)
        }
    }

    async fn spawn_inner(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        action: CodexSessionAction,
        resume_session: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let params = self.build_thread_start_params(current_dir);
        let resume_session = resume_session.map(|s| s.to_string());

        self.spawn_app_server(
            current_dir,
            command_parts,
            env,
            move |client, _| async move {
                match action {
                    CodexSessionAction::Chat { prompt } => {
                        Self::launch_codex_agent(params, resume_session, prompt, client).await
                    }
                    CodexSessionAction::Review { target } => {
                        review::launch_codex_review(params, resume_session, target, client).await
                    }
                }
            },
        )
        .await
    }

    async fn launch_codex_agent(
        thread_start_params: ThreadStartParams,
        resume_session: Option<String>,
        combined_prompt: String,
        client: Arc<AppServerClient>,
    ) -> Result<(), ExecutorError> {
        let resume = resume_session.is_some();
        let account = client
            .get_account()
            .instrument(tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.get_account"
            ))
            .await?;
        if account.requires_openai_auth && account.account.is_none() {
            return Err(ExecutorError::AuthRequired(
                "Codex authentication required".to_string(),
            ));
        }

        let (thread_id, resolved_model) = match resume_session {
            None => {
                let response = client
                    .thread_start(thread_start_params)
                    .instrument(tracing::debug_span!(
                        target: "perf.agent_startup",
                        "codex.thread_start"
                    ))
                    .await?;
                (response.thread.id, response.model)
            }
            Some(session_id) => {
                let response = client
                    .thread_fork(fork_params_from(session_id, thread_start_params))
                    .instrument(tracing::debug_span!(
                        target: "perf.agent_startup",
                        "codex.thread_fork"
                    ))
                    .await?;
                tracing::debug!("forked thread, new thread_id={}", response.thread.id);
                (response.thread.id, response.model)
            }
        };

        tracing::debug!(
            target: "perf.agent_startup",
            thread_id = %thread_id,
            model = %resolved_model,
            resume,
            "codex.thread_ready"
        );
        client.set_resolved_model(resolved_model);
        client
            .register_session(&thread_id)
            .instrument(tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.register_session",
                thread_id = %thread_id,
            ))
            .await?;
        let collaboration_mode = client.initial_collaboration_mode()?;
        let turn_start_thread_id = thread_id.clone();
        client
            .turn_start_with_mode(
                thread_id,
                vec![UserInput::Text {
                    text: combined_prompt,
                    text_elements: vec![],
                }],
                Some(collaboration_mode),
            )
            .instrument(tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.turn_start",
                thread_id = %turn_start_thread_id,
            ))
            .await?;

        Ok(())
    }

    /// Common boilerplate for spawning a Codex app server process
    /// Handles process spawning, stdout piping, exit signal handling, client initialization, and error logging.
    /// Delegates the actual Codex session logic to the provided `task` closure.
    async fn spawn_app_server<F, Fut>(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        env: &ExecutionEnv,
        task: F,
    ) -> Result<SpawnedChild, ExecutorError>
    where
        F: FnOnce(Arc<AppServerClient>, ExitSignalSender) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<(), ExecutorError>> + Send + 'static,
    {
        let (program_path, args) = command_parts
            .into_resolved()
            .instrument(tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.resolve_command"
            ))
            .await?;

        let mut process = Command::new(program_path);
        process
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            // Codex app-server speaks JSON-RPC on stdout. Its stderr is not part
            // of the agent log stream here, and leaving a piped stderr unread can
            // block the child process if diagnostics/tracing emits enough logs.
            .stderr(std::process::Stdio::null())
            .current_dir(current_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .env("NODE_NO_WARNINGS", "1")
            .env("NO_COLOR", "1")
            .env("RUST_LOG", "error")
            .env("CODEX_SQLITE_LOGS", "off")
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut process);

        let mut child = {
            let _span = tracing::debug_span!(
                target: "perf.agent_startup",
                "codex.process_spawn",
                cwd = %current_dir.display(),
            )
            .entered();
            process.group_spawn_no_window()?
        };

        let child_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdout"))
        })?;
        let child_stdin = child.inner().stdin.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdin"))
        })?;

        let new_stdout = create_stdout_pipe_writer(&mut child)?;
        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();
        let cancel = tokio_util::sync::CancellationToken::new();

        let auto_approve = matches!(
            (&self.sandbox, &self.ask_for_approval),
            (Some(SandboxMode::DangerFullAccess), None)
        );
        let plan_mode = self.plan;
        let approvals = self.approvals.clone();
        let repo_context = env.repo_context.clone();
        let commit_reminder = env.commit_reminder;
        let commit_reminder_prompt = env.commit_reminder_prompt.clone();
        let cancel_for_task = cancel.clone();

        let app_server_span = tracing::debug_span!(
            target: "perf.agent_startup",
            "codex.spawn_app_server",
            cwd = %current_dir.display(),
        );
        tokio::spawn(
            async move {
                let exit_signal_tx = ExitSignalSender::new(exit_signal_tx);
                let log_writer = LogWriter::new(new_stdout);

                // Initialize the AppServerClient
                let client = AppServerClient::new(
                    log_writer.clone(),
                    approvals,
                    auto_approve,
                    plan_mode,
                    repo_context,
                    commit_reminder,
                    commit_reminder_prompt,
                    cancel_for_task.clone(),
                );
                let rpc_peer = JsonRpcPeer::spawn(
                    child_stdin,
                    child_stdout,
                    client.clone(),
                    exit_signal_tx.clone(),
                    cancel_for_task,
                );
                client.connect(rpc_peer);

                let result = async {
                    client
                        .initialize()
                        .instrument(tracing::debug_span!(
                            target: "perf.agent_startup",
                            "codex.rpc.initialize"
                        ))
                        .await?;
                    task(client, exit_signal_tx.clone()).await
                }
                .await;

                if let Err(err) = result {
                    match &err {
                        ExecutorError::Io(io_err)
                            if io_err.kind() == std::io::ErrorKind::BrokenPipe =>
                        {
                            // Broken pipe likely means the parent process exited, so we can ignore it
                            return;
                        }
                        ExecutorError::AuthRequired(message) => {
                            log_writer
                                .log_raw(&Error::auth_required(message.clone()).raw())
                                .await
                                .ok();
                            exit_signal_tx
                                .send_exit_signal(ExecutorExitResult::Failure)
                                .await;
                            return;
                        }
                        _ => {
                            tracing::error!("Codex spawn error: {}", err);
                            log_writer
                                .log_raw(&Error::launch_error(err.to_string()).raw())
                                .await
                                .ok();
                        }
                    }
                    exit_signal_tx
                        .send_exit_signal(ExecutorExitResult::Failure)
                        .await;
                }
            }
            .instrument(app_server_span),
        );

        Ok(SpawnedChild {
            child,
            exit_signal: Some(exit_signal_rx),
            cancel: Some(cancel),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use codex_app_server_protocol::AskForApproval as V2AskForApproval;
    use futures::StreamExt;

    use super::{AskForApproval, Codex, resolve_model};
    use crate::{
        command::CommandBuildError,
        executor_discovery::ExecutorDiscoveredOptions,
        executors::{BaseCodingAgent, CodingAgent, StandardCodingAgentExecutor},
        profile::{ExecutorConfigs, ExecutorProfileId},
    };

    fn test_codex() -> Codex {
        Codex {
            append_prompt: Default::default(),
            sandbox: None,
            ask_for_approval: None,
            oss: None,
            model: None,
            model_reasoning_effort: None,
            model_reasoning_summary: None,
            model_reasoning_summary_format: None,
            profile: None,
            base_instructions: None,
            include_apply_patch_tool: None,
            model_provider: None,
            compact_prompt: None,
            developer_instructions: None,
            plan: false,
            cmd: Default::default(),
            approvals: None,
        }
    }

    fn options_from_patch(patch: json_patch::Patch) -> ExecutorDiscoveredOptions {
        let value = serde_json::to_value(patch).unwrap();
        serde_json::from_value(value[0]["value"].clone()).unwrap()
    }

    #[test]
    fn resolve_model_detects_fast_suffix() {
        assert_eq!(
            resolve_model(Some("gpt-5.6-sol-fast")),
            (Some("gpt-5.6-sol"), true)
        );
        assert_eq!(resolve_model(Some("gpt-5.5-fast")), (Some("gpt-5.5"), true));
        assert_eq!(resolve_model(Some("gpt-5.4-fast")), (Some("gpt-5.4"), true));
    }

    #[test]
    fn resolve_model_leaves_non_fast_models_unchanged() {
        assert_eq!(resolve_model(Some("gpt-5.6")), (Some("gpt-5.6"), false));
        assert_eq!(resolve_model(Some("gpt-5.5")), (Some("gpt-5.5"), false));
        assert_eq!(
            resolve_model(Some("gpt-5.4-mini")),
            (Some("gpt-5.4-mini"), false)
        );
        assert_eq!(resolve_model(None), (None, false));
    }

    #[test]
    fn user_command_override_takes_precedence_over_configured_binary() {
        let selected = Codex::select_base_command(
            Some("custom-codex --flag"),
            Some(OsString::from("/missing/deployment/codex")),
        )
        .unwrap();

        assert_eq!(selected, "custom-codex --flag");
    }

    #[test]
    fn configured_binary_takes_precedence_over_builtin_command() {
        let executable = std::env::current_exe().unwrap();
        let selected =
            Codex::select_base_command(None, Some(executable.clone().into_os_string())).unwrap();

        #[cfg(not(windows))]
        assert_eq!(
            shlex::split(&selected),
            Some(vec![executable.to_string_lossy().into_owned()])
        );
        #[cfg(windows)]
        assert!(selected.contains(&executable.to_string_lossy().to_string()));
    }

    #[test]
    fn builtin_command_is_used_without_overrides() {
        assert_eq!(
            Codex::select_base_command(None, None).unwrap(),
            Codex::base_command()
        );
    }

    #[test]
    fn configured_binary_must_be_an_existing_absolute_file() {
        let error =
            Codex::select_base_command(None, Some(OsString::from("/missing/deployment/codex")))
                .unwrap_err();

        assert!(matches!(
            error,
            CommandBuildError::InvalidConfiguredExecutable {
                variable: "VK_CODEX_BINARY",
                ..
            }
        ));
    }

    #[test]
    fn codex_defaults_disable_sqlite_logs() {
        let config = ExecutorConfigs::from_defaults()
            .get_coding_agent(&ExecutorProfileId::new(BaseCodingAgent::Codex));
        let Some(CodingAgent::Codex(codex)) = config else {
            panic!("missing default Codex profile");
        };

        assert_eq!(
            codex
                .cmd
                .env
                .as_ref()
                .and_then(|env| env.get("CODEX_SQLITE_LOGS"))
                .map(String::as_str),
            Some("off")
        );
    }

    #[test]
    fn on_failure_approval_maps_to_on_request() {
        let mut codex = test_codex();
        codex.ask_for_approval = Some(AskForApproval::OnFailure);

        let params = codex.build_thread_start_params(std::path::Path::new("/tmp/test-worktree"));

        assert_eq!(params.approval_policy, Some(V2AskForApproval::OnRequest));
    }

    #[tokio::test]
    async fn discover_options_falls_back_when_bundled_catalog_command_fails() {
        let mut codex = test_codex();
        codex.cmd.base_command_override = Some("__vk_missing_codex_for_catalog_test__".to_string());

        let mut stream = codex.discover_options(None, None).await.unwrap();
        let initial_options = options_from_patch(stream.next().await.unwrap());
        let fallback_options = options_from_patch(stream.next().await.unwrap());

        assert!(initial_options.loading_models);
        let initial_model_ids: Vec<_> = initial_options
            .model_selector
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect();
        let fallback_model_ids: Vec<_> = fallback_options
            .model_selector
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect();
        assert_eq!(initial_model_ids, fallback_model_ids);
        assert_eq!(
            fallback_options
                .model_selector
                .models
                .first()
                .map(|model| model.id.as_str()),
            Some("gpt-5.6")
        );
        assert!(!fallback_options.loading_models);
        assert!(stream.next().await.is_none());
    }
}
