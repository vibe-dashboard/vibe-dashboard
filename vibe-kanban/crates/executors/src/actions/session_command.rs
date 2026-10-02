use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use ts_rs::TS;
use workspace_utils::{log_msg::LogMsg, msg_store::MsgStore};

use crate::{
    actions::Executable,
    approvals::ExecutorApprovalService,
    env::ExecutionEnv,
    executors::{BaseCodingAgent, ExecutorError, SpawnedChild, StandardCodingAgentExecutor},
    logs::{
        NormalizedEntry, NormalizedEntryType,
        utils::{ConversationPatch, EntryIndexProvider},
    },
    profile::{ExecutorConfig, ExecutorConfigs},
    stdout_dup::spawn_local_output_process,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionCommand {
    Clear,
    Compact { instructions: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CodingAgentSessionCommandRequest {
    pub command: SessionCommand,
    /// Original user-entered slash command text for chat display and executor input.
    #[serde(default)]
    pub prompt: String,
    /// Agent session/thread id to resume when the command needs provider context.
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(alias = "executor_profile_id", alias = "profile_variant_label")]
    pub executor_config: ExecutorConfig,
    #[serde(default)]
    pub working_dir: Option<String>,
}

impl SessionCommand {
    pub fn prompt(&self) -> String {
        match self {
            Self::Clear => "/clear".to_string(),
            Self::Compact { instructions } => instructions
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .map(|s| format!("/compact {}", s.trim()))
                .unwrap_or_else(|| "/compact".to_string()),
        }
    }

    pub fn is_supported_for(&self, executor: BaseCodingAgent) -> bool {
        match self {
            Self::Clear => true,
            Self::Compact { .. } => matches!(
                executor,
                BaseCodingAgent::ClaudeCode | BaseCodingAgent::Codex | BaseCodingAgent::Opencode
            ),
        }
    }

    pub fn requires_provider_context(&self, executor: BaseCodingAgent) -> bool {
        matches!(self, Self::Compact { .. }) && self.is_supported_for(executor)
    }
}

impl CodingAgentSessionCommandRequest {
    pub fn effective_dir(&self, current_dir: &Path) -> std::path::PathBuf {
        match &self.working_dir {
            Some(rel_path) => current_dir.join(rel_path),
            None => current_dir.to_path_buf(),
        }
    }

    pub fn base_executor(&self) -> BaseCodingAgent {
        self.executor_config.executor
    }

    pub fn prompt(&self) -> String {
        let prompt = self.prompt.trim();
        if prompt.is_empty() {
            self.command.prompt()
        } else {
            prompt.to_string()
        }
    }

    pub fn static_message(&self) -> Option<String> {
        if !self.command.is_supported_for(self.base_executor()) {
            return Some(format!(
                "Compact is not supported for {}.",
                self.base_executor()
            ));
        }

        match (&self.command, self.session_id.as_deref()) {
            (SessionCommand::Clear, _) => Some(
                "Context cleared. Previous messages remain visible but will not be included in future agent context."
                    .to_string(),
            ),
            (SessionCommand::Compact { .. }, None) => {
                Some("No active context to compact.".to_string())
            }
            (SessionCommand::Compact { .. }, Some(_)) => None,
        }
    }
}

#[async_trait]
impl Executable for CodingAgentSessionCommandRequest {
    async fn spawn(
        &self,
        current_dir: &Path,
        approvals: Arc<dyn ExecutorApprovalService>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        if let Some(message) = self.static_message() {
            return spawn_static_session_command_reply(message).await;
        }

        let effective_dir = self.effective_dir(current_dir);
        let session_id = self.session_id.as_deref().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other(
                "No active session for session command",
            ))
        })?;
        let prompt = self.prompt();

        if crate::executors::qa_mock::QaMockExecutor::runtime_enabled() {
            tracing::info!("QA mode env enabled: using mock executor for session command");
            let executor = crate::executors::qa_mock::QaMockExecutor;
            return executor
                .spawn_follow_up_mock(&effective_dir, &prompt, session_id, None, env)
                .await;
        }

        let profile_id = self.executor_config.profile_id();
        let mut agent = ExecutorConfigs::get_cached()
            .get_coding_agent(&profile_id)
            .ok_or(ExecutorError::UnknownExecutorType(profile_id.to_string()))?;

        if self.executor_config.has_overrides() {
            agent.apply_overrides(&self.executor_config);
        }
        agent.use_approvals(approvals);

        agent
            .spawn_follow_up(&effective_dir, &prompt, session_id, None, env)
            .await
    }
}

pub(crate) async fn spawn_static_session_command_reply(
    message: String,
) -> Result<SpawnedChild, ExecutorError> {
    let (mut spawned, mut writer) = spawn_local_output_process()?;
    let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();

    tokio::spawn(async move {
        let result = async {
            writer.write_all(message.as_bytes()).await?;
            writer.write_all(b"\n").await?;
            writer.flush().await
        }
        .await;

        let _ = exit_signal_tx.send(if result.is_ok() {
            crate::executors::ExecutorExitResult::Success
        } else {
            crate::executors::ExecutorExitResult::Failure
        });
    });

    spawned.exit_signal = Some(exit_signal_rx);
    Ok(spawned)
}

pub fn normalize_static_session_command_logs(
    msg_store: Arc<MsgStore>,
) -> Vec<tokio::task::JoinHandle<()>> {
    let entry_index_provider = EntryIndexProvider::start_from(&msg_store);
    vec![tokio::spawn(async move {
        let mut stream = msg_store.history_plus_stream();
        while let Some(Ok(msg)) = stream.next().await {
            match msg {
                LogMsg::Stdout(line) => {
                    let content = line.trim();
                    if content.is_empty() {
                        continue;
                    }
                    let entry = NormalizedEntry {
                        timestamp: None,
                        entry_type: NormalizedEntryType::SystemMessage,
                        content: content.to_string(),
                        metadata: None,
                    };
                    let patch =
                        ConversationPatch::add_normalized_entry(entry_index_provider.next(), entry);
                    msg_store.push_patch(patch);
                }
                LogMsg::Finished => break,
                _ => {}
            }
        }
    })]
}

#[cfg(test)]
mod tests {
    use crate::{actions::session_command::SessionCommand, executors::BaseCodingAgent};

    #[test]
    fn compact_support_is_limited_to_providers_with_native_handling() {
        let compact = SessionCommand::Compact { instructions: None };

        assert!(compact.is_supported_for(BaseCodingAgent::ClaudeCode));
        assert!(compact.is_supported_for(BaseCodingAgent::Codex));
        assert!(compact.is_supported_for(BaseCodingAgent::Opencode));
        assert!(!compact.is_supported_for(BaseCodingAgent::Gemini));
        assert!(!compact.is_supported_for(BaseCodingAgent::QwenCode));
    }

    #[test]
    fn clear_is_vk_level_for_all_providers() {
        assert!(SessionCommand::Clear.is_supported_for(BaseCodingAgent::ClaudeCode));
        assert!(SessionCommand::Clear.is_supported_for(BaseCodingAgent::Gemini));
    }

    #[test]
    fn clear_static_message_explains_visible_history_boundary() {
        let request = super::CodingAgentSessionCommandRequest {
            command: SessionCommand::Clear,
            prompt: "/clear".to_string(),
            session_id: None,
            executor_config: crate::profile::ExecutorConfig::new(BaseCodingAgent::ClaudeCode),
            working_dir: None,
        };

        let message = request.static_message().unwrap();
        assert!(message.contains("Previous messages remain visible"));
        assert!(message.contains("future agent context"));
    }

    #[test]
    fn session_command_request_prefers_original_prompt() {
        let request = super::CodingAgentSessionCommandRequest {
            command: SessionCommand::Compact {
                instructions: Some("trimmed".to_string()),
            },
            prompt: " /compact   keep spacing ".to_string(),
            session_id: Some("thread-1".to_string()),
            executor_config: crate::profile::ExecutorConfig::new(BaseCodingAgent::Codex),
            working_dir: None,
        };

        assert_eq!(request.prompt(), "/compact   keep spacing");
    }

    #[test]
    fn session_command_request_falls_back_for_legacy_actions() {
        let request = super::CodingAgentSessionCommandRequest {
            command: SessionCommand::Clear,
            prompt: String::new(),
            session_id: None,
            executor_config: crate::profile::ExecutorConfig::new(BaseCodingAgent::Codex),
            working_dir: None,
        };

        assert_eq!(request.prompt(), "/clear");
    }
}
