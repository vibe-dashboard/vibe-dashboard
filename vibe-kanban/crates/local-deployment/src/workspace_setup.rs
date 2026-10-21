use std::{collections::HashMap, path::Path, process::Stdio, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use command_group::AsyncCommandGroup;
use serde::Deserialize;
use serde_json::Value;
use tokio::{fs, io::AsyncReadExt, process::Command, sync::Mutex};
use uuid::Uuid;

const SUCCESS_FILE: &str = ".vk-workspace-setup.json";

#[derive(Deserialize)]
#[serde(default)]
struct SetupConfig {
    enabled: bool,
    required: bool,
    timeout_seconds: u64,
    command: String,
}

impl Default for SetupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            required: true,
            timeout_seconds: 120,
            command: "workspace-setup.sh".to_string(),
        }
    }
}

/// Serialize setup for each workspace. Only successful runs are remembered on disk,
/// so failures remain retryable and recreated worktrees get their setup again.
#[derive(Default)]
pub(crate) struct WorkspaceSetup {
    locks: Mutex<HashMap<Uuid, std::sync::Weak<Mutex<()>>>>,
}

impl WorkspaceSetup {
    pub(crate) async fn run(
        &self,
        settings_dir: &Path,
        workspace_id: Uuid,
        workspace_dir: &Path,
        repos: Value,
    ) -> Result<()> {
        let lock = {
            let mut locks = self.locks.lock().await;
            locks.retain(|_, lock| lock.strong_count() > 0);
            let lock = locks
                .get(&workspace_id)
                .and_then(std::sync::Weak::upgrade)
                .unwrap_or_else(|| Arc::new(Mutex::new(())));
            locks.insert(workspace_id, Arc::downgrade(&lock));
            lock
        };
        let _guard = lock.lock().await;
        let config_path = settings_dir.join("workspace-setup.toml");
        let content = match fs::read_to_string(&config_path).await {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error).context("Cannot read workspace setup configuration"),
        };
        let config: SetupConfig = toml::from_str(&content).with_context(|| {
            format!(
                "Invalid workspace setup configuration {}",
                config_path.display()
            )
        })?;
        if !config.enabled {
            return Ok(());
        }

        let command_path = settings_dir.join(&config.command);
        let signature = serde_json::to_vec(&serde_json::json!({
            "config": content,
            "commandPath": command_path,
            "workspaceId": workspace_id,
            "workspaceDir": workspace_dir,
            "repos": repos,
        }))?;
        let success_path = workspace_dir.join(SUCCESS_FILE);
        if fs::read(&success_path).await.ok().as_deref() == Some(signature.as_slice()) {
            return Ok(());
        }

        let result = async {
            if config.timeout_seconds == 0 || config.command.trim().is_empty() {
                bail!("Workspace setup requires a command and a positive timeout_seconds");
            }
            tracing::info!(%workspace_id, "Running workspace setup");
            run_command(
                &command_path,
                settings_dir,
                workspace_id,
                workspace_dir,
                &repos,
                Duration::from_secs(config.timeout_seconds),
            )
            .await?;
            // An interrupted write cannot match the full signature, so a later call retries.
            fs::write(success_path, signature).await?;
            Ok::<_, anyhow::Error>(())
        }
        .await;
        match result {
            Err(error) if !config.required => {
                tracing::warn!(%workspace_id, error = %error, "Optional workspace setup failed");
                Ok(())
            }
            result => result,
        }
    }
}

async fn run_command(
    command_path: &Path,
    settings_dir: &Path,
    workspace_id: Uuid,
    workspace_dir: &Path,
    repos: &Value,
    timeout: Duration,
) -> Result<()> {
    let mut child = Command::new(command_path)
        .current_dir(workspace_dir)
        .env("VK_SETTINGS_DIRECTORY", settings_dir)
        .env("VK_WORKSPACE_ID", workspace_id.to_string())
        .env("VK_WORKSPACE_DIR", workspace_dir)
        .env("VK_WORKSPACE_REPOS_JSON", serde_json::to_string(repos)?)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .group_spawn()
        .with_context(|| format!("Cannot start workspace setup {}", command_path.display()))?;
    let stdout = child
        .inner()
        .stdout
        .take()
        .context("Missing setup stdout")?;
    let stderr = child
        .inner()
        .stderr
        .take()
        .context("Missing setup stderr")?;
    let result = tokio::time::timeout(timeout, async {
        tokio::try_join!(child.wait(), read_output(stdout), read_output(stderr))
    })
    .await;
    match result {
        Ok(Ok((status, stdout, stderr))) => {
            tracing::info!(%workspace_id, %status, %stdout, %stderr, "Workspace setup finished");
            if !status.success() {
                bail!("Workspace setup exited with {status}: {stderr}{stdout}");
            }
            Ok(())
        }
        result => {
            let _ = child.kill().await;
            match result {
                Err(_) => bail!(
                    "Workspace setup timed out after {} seconds",
                    timeout.as_secs()
                ),
                Ok(Err(error)) => Err(error).context("Cannot wait for workspace setup"),
                Ok(Ok(_)) => unreachable!(),
            }
        }
    }
}

async fn read_output(mut reader: impl tokio::io::AsyncRead + Unpin) -> std::io::Result<String> {
    // Drain the pipes without retaining unbounded command output in memory.
    let mut output = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let remaining = (64 * 1024_usize).saturating_sub(output.len());
        output.extend_from_slice(&buffer[..count.min(remaining)]);
    }
    Ok(String::from_utf8_lossy(&output).into_owned())
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    struct Fixture {
        root: TempDir,
        id: Uuid,
        setup: WorkspaceSetup,
    }

    impl Fixture {
        async fn new(script: &str, required: bool, timeout: u64) -> Self {
            let fixture = Self {
                root: tempfile::tempdir().unwrap(),
                id: Uuid::new_v4(),
                setup: WorkspaceSetup::default(),
            };
            fs::create_dir(fixture.dir()).await.unwrap();
            fs::write(
                fixture.root.path().join("workspace-setup.toml"),
                format!("enabled = true\nrequired = {required}\ntimeout_seconds = {timeout}\ncommand = 'workspace-setup.sh'\n"),
            )
            .await
            .unwrap();
            fixture.script(script).await;
            fixture
        }

        fn dir(&self) -> std::path::PathBuf {
            self.root.path().join("workspace")
        }

        async fn script(&self, script: &str) {
            let path = self.root.path().join("workspace-setup.sh");
            fs::write(&path, format!("#!/bin/sh\nset -eu\n{script}\n"))
                .await
                .unwrap();
            fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
                .await
                .unwrap();
        }

        async fn run(&self, repos: Value) -> Result<()> {
            self.setup
                .run(self.root.path(), self.id, &self.dir(), repos)
                .await
        }
    }

    #[tokio::test]
    async fn setup_serializes_calls_and_refreshes_changed_repositories() {
        let fixture = Fixture::new(
            r#"test "$PWD" -ef "$VK_WORKSPACE_DIR"
test -f "$VK_SETTINGS_DIRECTORY/workspace-setup.toml"
printf '%s\n' "$VK_WORKSPACE_ID" >> calls
printf '%s' "$VK_WORKSPACE_REPOS_JSON" > repos.json"#,
            true,
            10,
        )
        .await;
        let repos = json!([{"name": "one", "targetBranch": "main"}]);
        let (first, second) = tokio::join!(fixture.run(repos.clone()), fixture.run(repos.clone()));
        first.unwrap();
        second.unwrap();
        assert_eq!(
            fs::read_to_string(fixture.dir().join("calls"))
                .await
                .unwrap(),
            format!("{}\n", fixture.id)
        );

        // A service restart does not repeat setup for an unchanged workspace.
        WorkspaceSetup::default()
            .run(fixture.root.path(), fixture.id, &fixture.dir(), repos)
            .await
            .unwrap();
        let repos = json!([{"name": "one"}, {"name": "two", "targetBranch": "develop"}]);
        fixture.run(repos.clone()).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(fixture.dir().join("repos.json")).await.unwrap()
            )
            .unwrap(),
            repos
        );
        assert_eq!(
            fs::read_to_string(fixture.dir().join("calls"))
                .await
                .unwrap()
                .lines()
                .count(),
            2
        );
        fs::remove_dir_all(fixture.dir()).await.unwrap();
        fs::create_dir(fixture.dir()).await.unwrap();
        fixture.run(repos).await.unwrap();
        assert!(fixture.dir().join("calls").exists());
    }

    #[tokio::test]
    async fn required_failure_is_visible_and_retryable_without_removing_workspace() {
        let fixture = Fixture::new("echo 'setup broke' >&2; exit 42", true, 10).await;
        let existing_file = fixture.dir().join("user-work.txt");
        fs::write(&existing_file, "keep this").await.unwrap();
        let error = fixture.run(json!([])).await.unwrap_err().to_string();
        assert!(error.contains("42"), "{error}");
        assert!(error.contains("setup broke"), "{error}");
        assert!(!fixture.dir().join(SUCCESS_FILE).exists());
        assert!(existing_file.exists());
        fixture.script("touch ready").await;
        fixture.run(json!([])).await.unwrap();
        assert!(fixture.dir().join("ready").exists());
        assert!(fixture.dir().join(SUCCESS_FILE).exists());
    }

    #[tokio::test]
    async fn optional_failure_allows_progress_but_is_not_recorded_as_success() {
        let fixture = Fixture::new("exit 1", false, 10).await;
        fixture.run(json!([])).await.unwrap();
        assert!(!fixture.dir().join(SUCCESS_FILE).exists());
        fixture.script("touch retried").await;
        fixture.run(json!([])).await.unwrap();
        assert!(fixture.dir().join("retried").exists());
    }

    #[tokio::test]
    async fn missing_or_disabled_configuration_does_not_run_setup() {
        let fixture = Fixture::new("touch unexpected", true, 10).await;
        let config_path = fixture.root.path().join("workspace-setup.toml");
        fs::write(&config_path, "enabled = false").await.unwrap();
        fixture.run(json!([])).await.unwrap();
        fs::remove_file(config_path).await.unwrap();
        fixture.run(json!([])).await.unwrap();
        assert!(!fixture.dir().join("unexpected").exists());
    }

    #[tokio::test]
    async fn timeout_kills_descendants_and_leaves_setup_retryable() {
        let fixture = Fixture::new("(sleep 2; touch leaked-child) & wait", true, 1).await;
        let error = fixture.run(json!([])).await.unwrap_err().to_string();
        assert!(error.contains("timed out"), "{error}");
        tokio::time::sleep(Duration::from_millis(1500)).await;
        assert!(!fixture.dir().join("leaked-child").exists());
        assert!(!fixture.dir().join(SUCCESS_FILE).exists());
    }
}
