use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use enum_dispatch::enum_dispatch;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    actions::{
        coding_agent_follow_up::CodingAgentFollowUpRequest,
        coding_agent_initial::CodingAgentInitialRequest, review::ReviewRequest,
        script::ScriptRequest, session_command::CodingAgentSessionCommandRequest,
    },
    approvals::ExecutorApprovalService,
    env::ExecutionEnv,
    executors::{BaseCodingAgent, ExecutorError, SpawnedChild},
};
pub mod coding_agent_follow_up;
pub mod coding_agent_initial;
pub mod review;
pub mod script;
pub mod session_command;

pub use review::RepoReviewContext;

#[enum_dispatch]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "type")]
pub enum ExecutorActionType {
    CodingAgentInitialRequest,
    CodingAgentFollowUpRequest,
    CodingAgentSessionCommandRequest,
    ScriptRequest,
    ReviewRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExecutorAction {
    pub typ: ExecutorActionType,
    pub next_action: Option<Box<ExecutorAction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub log_normalizer: Option<ExecutorActionLogNormalizer>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum ExecutorActionLogNormalizer {
    #[default]
    SelectedExecutor,
    QaMockClaude,
}

impl ExecutorAction {
    pub fn new(typ: ExecutorActionType, next_action: Option<Box<ExecutorAction>>) -> Self {
        Self {
            typ,
            next_action,
            log_normalizer: None,
        }
    }
    pub fn append_action(mut self, action: ExecutorAction) -> Self {
        if let Some(next) = self.next_action {
            self.next_action = Some(Box::new(next.append_action(action)));
        } else {
            self.next_action = Some(Box::new(action));
        }
        self
    }

    pub fn typ(&self) -> &ExecutorActionType {
        &self.typ
    }

    pub fn next_action(&self) -> Option<&ExecutorAction> {
        self.next_action.as_deref()
    }

    pub fn with_current_runtime_log_normalizer(mut self) -> Self {
        if self.supports_agent_log_normalization() {
            self.log_normalizer = Some(
                if crate::executors::qa_mock::QaMockExecutor::runtime_enabled() {
                    ExecutorActionLogNormalizer::QaMockClaude
                } else {
                    ExecutorActionLogNormalizer::SelectedExecutor
                },
            );
        }
        self
    }

    pub fn uses_qa_mock_log_normalizer(&self) -> bool {
        self.log_normalizer == Some(ExecutorActionLogNormalizer::QaMockClaude)
    }

    pub fn should_use_qa_mock_for_spawn(&self) -> bool {
        self.uses_qa_mock_log_normalizer()
    }

    fn supports_agent_log_normalization(&self) -> bool {
        matches!(
            self.typ(),
            ExecutorActionType::CodingAgentInitialRequest(_)
                | ExecutorActionType::CodingAgentFollowUpRequest(_)
                | ExecutorActionType::CodingAgentSessionCommandRequest(_)
                | ExecutorActionType::ReviewRequest(_)
        )
    }

    pub fn base_executor(&self) -> Option<BaseCodingAgent> {
        match self.typ() {
            ExecutorActionType::CodingAgentInitialRequest(request) => Some(request.base_executor()),
            ExecutorActionType::CodingAgentFollowUpRequest(request) => {
                Some(request.base_executor())
            }
            ExecutorActionType::CodingAgentSessionCommandRequest(request) => {
                Some(request.base_executor())
            }
            ExecutorActionType::ReviewRequest(request) => Some(request.base_executor()),
            ExecutorActionType::ScriptRequest(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        actions::script::{ScriptRequest, ScriptRequestLanguage},
        executors::BaseCodingAgent,
        profile::ExecutorConfig,
    };

    fn coding_action() -> ExecutorAction {
        ExecutorAction::new(
            ExecutorActionType::CodingAgentInitialRequest(CodingAgentInitialRequest {
                prompt: "test".to_string(),
                executor_config: ExecutorConfig {
                    executor: BaseCodingAgent::Codex,
                    variant: None,
                    model_id: None,
                    agent_id: None,
                    reasoning_id: None,
                    permission_policy: None,
                },
                working_dir: None,
            }),
            None,
        )
    }

    #[test]
    fn uses_qa_mock_log_normalizer_when_action_marks_it() {
        let mut action = coding_action();
        action.log_normalizer = Some(ExecutorActionLogNormalizer::QaMockClaude);

        assert!(action.uses_qa_mock_log_normalizer());
        assert!(action.should_use_qa_mock_for_spawn());
    }

    #[test]
    fn does_not_use_qa_mock_log_normalizer_by_default() {
        let action = coding_action();

        assert!(!action.uses_qa_mock_log_normalizer());
        assert!(!action.should_use_qa_mock_for_spawn());
    }

    #[test]
    fn selected_executor_log_normalizer_does_not_use_qa_mock() {
        let mut action = coding_action();
        action.log_normalizer = Some(ExecutorActionLogNormalizer::SelectedExecutor);

        assert!(!action.uses_qa_mock_log_normalizer());
        assert!(!action.should_use_qa_mock_for_spawn());
    }

    #[test]
    fn persisted_selected_executor_normalizer_does_not_follow_current_env() {
        let action_json = serde_json::json!({
            "typ": {
                "type": "CodingAgentInitialRequest",
                "prompt": "test",
                "executor_config": {
                    "executor": "CODEX"
                }
            },
            "next_action": null,
            "log_normalizer": "selected_executor"
        });
        let action: ExecutorAction = serde_json::from_value(action_json).unwrap();

        assert_eq!(
            action.log_normalizer,
            Some(ExecutorActionLogNormalizer::SelectedExecutor)
        );
        assert!(!action.should_use_qa_mock_for_spawn());
    }

    #[test]
    fn persisted_qa_mock_normalizer_replays_with_qa_mock() {
        let action_json = serde_json::json!({
            "typ": {
                "type": "CodingAgentInitialRequest",
                "prompt": "test",
                "executor_config": {
                    "executor": "CODEX"
                }
            },
            "next_action": null,
            "log_normalizer": "qa_mock_claude"
        });
        let action: ExecutorAction = serde_json::from_value(action_json).unwrap();

        assert_eq!(
            action.log_normalizer,
            Some(ExecutorActionLogNormalizer::QaMockClaude)
        );
        assert!(action.should_use_qa_mock_for_spawn());
    }

    #[test]
    fn scripts_do_not_support_agent_log_normalizer_metadata() {
        let action = ExecutorAction::new(
            ExecutorActionType::ScriptRequest(ScriptRequest {
                script: "echo test".to_string(),
                language: ScriptRequestLanguage::Bash,
                context: crate::actions::script::ScriptContext::SetupScript,
                working_dir: None,
                env: Default::default(),
            }),
            None,
        )
        .with_current_runtime_log_normalizer();

        assert_eq!(action.log_normalizer, None);
    }
}

#[async_trait]
#[enum_dispatch(ExecutorActionType)]
pub trait Executable {
    async fn spawn(
        &self,
        current_dir: &Path,
        approvals: Arc<dyn ExecutorApprovalService>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError>;
}

#[async_trait]
impl Executable for ExecutorAction {
    async fn spawn(
        &self,
        current_dir: &Path,
        approvals: Arc<dyn ExecutorApprovalService>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        if self.should_use_qa_mock_for_spawn() {
            match self.typ() {
                ExecutorActionType::CodingAgentInitialRequest(request) => {
                    let effective_dir = request.effective_dir(current_dir);
                    tracing::info!(
                        "QA mode enabled for persisted action: using mock executor instead of real agent"
                    );
                    let executor = crate::executors::qa_mock::QaMockExecutor;
                    return executor
                        .spawn_mock(&effective_dir, &request.prompt, env)
                        .await;
                }
                ExecutorActionType::CodingAgentFollowUpRequest(request) => {
                    let effective_dir = request.effective_dir(current_dir);
                    tracing::info!(
                        "QA mode enabled for persisted action: using mock executor for follow-up"
                    );
                    let executor = crate::executors::qa_mock::QaMockExecutor;
                    return executor
                        .spawn_follow_up_mock(
                            &effective_dir,
                            &request.prompt,
                            &request.session_id,
                            request.reset_to_message_id.as_deref(),
                            env,
                        )
                        .await;
                }
                ExecutorActionType::CodingAgentSessionCommandRequest(request) => {
                    if let Some(message) = request.static_message() {
                        return session_command::spawn_static_session_command_reply(message).await;
                    }

                    let effective_dir = request.effective_dir(current_dir);
                    let session_id = request.session_id.as_deref().ok_or_else(|| {
                        ExecutorError::Io(std::io::Error::other(
                            "No active session for session command",
                        ))
                    })?;
                    let prompt = request.prompt();
                    tracing::info!(
                        "QA mode enabled for persisted action: using mock executor for session command"
                    );
                    let executor = crate::executors::qa_mock::QaMockExecutor;
                    return executor
                        .spawn_follow_up_mock(&effective_dir, &prompt, session_id, None, env)
                        .await;
                }
                ExecutorActionType::ReviewRequest(request) => {
                    let effective_dir = request.effective_dir(current_dir);
                    tracing::info!(
                        "QA mode enabled for persisted action: using mock executor for review"
                    );
                    let executor = crate::executors::qa_mock::QaMockExecutor;
                    return match request.session_id.as_deref() {
                        Some(session_id) => {
                            executor
                                .spawn_follow_up_mock(
                                    &effective_dir,
                                    &request.prompt,
                                    session_id,
                                    None,
                                    env,
                                )
                                .await
                        }
                        None => {
                            executor
                                .spawn_mock(&effective_dir, &request.prompt, env)
                                .await
                        }
                    };
                }
                ExecutorActionType::ScriptRequest(_) => {}
            }
        }

        self.typ.spawn(current_dir, approvals, env).await
    }
}
