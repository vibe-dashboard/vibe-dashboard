use std::{collections::HashMap, path::Path, sync::Arc};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, shell::get_shell_command};

use crate::{
    actions::Executable,
    approvals::ExecutorApprovalService,
    env::ExecutionEnv,
    executors::{ExecutorError, SpawnedChild},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub enum ScriptRequestLanguage {
    Bash,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub enum ScriptContext {
    SetupScript,
    CleanupScript,
    ArchiveScript,
    DevServer,
    ToolInstallScript,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct ScriptRequest {
    pub script: String,
    pub language: ScriptRequestLanguage,
    pub context: ScriptContext,
    /// Optional relative path to execute the script in (relative to container_ref).
    /// If None, uses the container_ref directory directly.
    #[serde(default)]
    pub working_dir: Option<String>,
    /// Optional environment overrides for this script invocation.
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[async_trait]
impl Executable for ScriptRequest {
    async fn spawn(
        &self,
        current_dir: &Path,
        _approvals: Arc<dyn ExecutorApprovalService>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        // Use working_dir if specified, otherwise use current_dir
        let effective_dir = match &self.working_dir {
            Some(rel_path) => current_dir.join(rel_path),
            None => current_dir.to_path_buf(),
        };

        let (shell_cmd, shell_arg) = get_shell_command();
        let mut command = Command::new(shell_cmd);
        command
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .arg(shell_arg)
            .arg(&self.script)
            .current_dir(&effective_dir);

        // Apply environment variables; request-scoped overrides take precedence.
        let env = env.clone().with_overrides(&self.env);
        env.apply_to_command(&mut command);

        let child = command
            .group_spawn_no_window()
            .map_err(|error| ExecutorError::SpawnError(error).proven_not_spawned())?;

        Ok(child.into())
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, path::Path, sync::Arc};

    use super::*;
    use crate::{approvals::NoopExecutorApprovalService, env::RepoContext};

    #[tokio::test]
    async fn script_spawn_failure_is_proven_not_spawned() {
        let request = ScriptRequest {
            script: "true".to_string(),
            language: ScriptRequestLanguage::Bash,
            context: ScriptContext::SetupScript,
            working_dir: Some("missing-working-directory".to_string()),
            env: HashMap::new(),
        };

        let error = request
            .spawn(
                Path::new("/definitely/missing/vibe-kanban-script-root"),
                Arc::new(NoopExecutorApprovalService),
                &ExecutionEnv::new(RepoContext::default(), false, String::new()),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error.into_proven_not_spawned(),
            Ok(ExecutorError::SpawnError(_))
        ));
    }
}
