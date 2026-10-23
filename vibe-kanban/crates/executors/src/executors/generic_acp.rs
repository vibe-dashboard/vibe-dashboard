use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use workspace_utils::{msg_store::MsgStore, shell::resolve_executable_path_blocking};

use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor, acp::AcpAgentHarness,
    },
    profile::ExecutorConfig,
};

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct GenericAcp {
    /// ACP executable. Profiles are trusted administrator configuration.
    pub executable: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub argv: Vec<String>,
    #[serde(default = "default_session_namespace")]
    pub session_namespace: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_config_path: Option<std::path::PathBuf>,
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

fn default_session_namespace() -> String {
    "generic_acp_sessions".to_string()
}

impl GenericAcp {
    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        apply_overrides(
            CommandBuilder::new(&self.executable).params(self.argv.clone()),
            &self.cmd,
        )
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for GenericAcp {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        AcpAgentHarness::with_session_namespace(&self.session_namespace)
            .spawn_with_command(
                current_dir,
                self.append_prompt.combine_prompt(prompt),
                self.build_command_builder()?.build_initial()?,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
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
        AcpAgentHarness::with_session_namespace(&self.session_namespace)
            .spawn_follow_up_with_command(
                current_dir,
                self.append_prompt.combine_prompt(prompt),
                session_id,
                self.build_command_builder()?.build_follow_up(&[])?,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        crate::executors::acp::normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        self.mcp_config_path.clone()
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        if resolve_executable_path_blocking(&self.executable).is_some() {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig::new(BaseCodingAgent::GenericAcp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_deserializes_explicit_command_and_defaults_namespace() {
        let agent: GenericAcp = serde_json::from_value(serde_json::json!({
            "executable": "example-acp",
            "argv": ["serve", "--acp"]
        }))
        .unwrap();

        assert_eq!(agent.executable, "example-acp");
        assert_eq!(agent.argv, ["serve", "--acp"]);
        assert_eq!(agent.session_namespace, "generic_acp_sessions");
        agent
            .build_command_builder()
            .unwrap()
            .build_initial()
            .unwrap();
    }
}
