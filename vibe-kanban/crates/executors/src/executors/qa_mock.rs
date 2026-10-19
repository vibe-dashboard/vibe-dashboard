//! QA Mode: Mock executor for testing
//!
//! This module provides a mock executor that:
//! 1. Writes one deterministic fixture file
//! 2. Streams 10 mock log entries over 10 seconds
//! 3. Outputs logs in ClaudeJson format for compatibility with existing log normalization

use std::{path::Path, process::Stdio, sync::Arc};

#[cfg(feature = "qa-mode")]
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tracing::info;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use crate::{
    env::ExecutionEnv,
    executors::{
        ExecutorError, SpawnedChild,
        claude::{
            ClaudeContentItem, ClaudeJson, ClaudeMessage, ClaudeMessageContent, ClaudeToolData,
        },
    },
    logs::utils::EntryIndexProvider,
};
#[cfg(feature = "qa-mode")]
use crate::{
    executors::{BaseCodingAgent, StandardCodingAgentExecutor},
    profile::ExecutorConfig,
};

/// Primary runtime switch for QA-mode agent response mocking.
pub const QA_MODE_ENV_VAR: &str = "VK_QA_MODE";
/// Backwards-compatible shorthand accepted by local QA harnesses.
pub const LEGACY_QA_MODE_ENV_VAR: &str = "QA_MODE";

/// Mock executor for QA testing
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, TS, JsonSchema)]
pub struct QaMockExecutor;

impl QaMockExecutor {
    /// Returns true when QA agent response mocking is enabled at runtime.
    pub fn runtime_enabled() -> bool {
        std::env::var(QA_MODE_ENV_VAR)
            .or_else(|_| std::env::var(LEGACY_QA_MODE_ENV_VAR))
            .is_ok_and(|value| env_value_enabled(&value))
    }

    pub async fn spawn_mock(
        &self,
        current_dir: &Path,
        prompt: &str,
        _env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        info!("QA Mock Executor: spawning mock execution");

        // 1. Write the same fixture advertised by the mock tool event.
        write_qa_fixture(current_dir).await?;

        // 2. Generate mock logs and write to temp file to avoid shell escaping issues
        let logs = generate_mock_logs(prompt);
        let temp_dir = std::env::temp_dir();
        let log_file = temp_dir.join(format!("qa_mock_logs_{}.jsonl", uuid::Uuid::new_v4()));

        // Write all logs to file, one per line
        let content = logs.join("\n") + "\n";
        tokio::fs::write(&log_file, &content)
            .await
            .map_err(|e| ExecutorError::Io(std::io::Error::other(e)))?;

        // 3. Create shell script that reads file and outputs with delays
        // Using IFS= read -r to preserve exact content (no word splitting, no backslash interpretation)
        let script = format!(
            r#"while IFS= read -r line; do echo "$line"; sleep 1; done < "{}"; rm -f "{}""#,
            log_file.display(),
            log_file.display()
        );

        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c")
            .arg(&script)
            .current_dir(current_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd.group_spawn_no_window().map_err(ExecutorError::Io)?;
        Ok(SpawnedChild::from(child))
    }

    pub async fn spawn_follow_up_mock(
        &self,
        current_dir: &Path,
        prompt: &str,
        _session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        // QA mode doesn't support real sessions, just spawn fresh
        info!("QA Mock Executor: follow-up request treated as new spawn");
        self.spawn_mock(current_dir, prompt, env).await
    }

    pub fn normalize_mock_logs(
        &self,
        msg_store: Arc<MsgStore>,
        current_dir: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        // Reuse Claude's log processor since we output ClaudeJson format
        let entry_index_provider = EntryIndexProvider::start_from(&msg_store);
        let h1 = crate::executors::claude::ClaudeLogProcessor::process_logs(
            msg_store,
            current_dir,
            entry_index_provider,
            crate::executors::claude::HistoryStrategy::Default,
        );
        vec![h1]
    }
}

#[cfg(feature = "qa-mode")]
#[async_trait]
impl StandardCodingAgentExecutor for QaMockExecutor {
    fn apply_overrides(&mut self, _executor_config: &ExecutorConfig) {}

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_mock(current_dir, prompt, env).await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_follow_up_mock(current_dir, prompt, session_id, reset_to_message_id, env)
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        current_dir: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        self.normalize_mock_logs(msg_store, current_dir)
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        None // QA mock doesn't need MCP config
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::QaMock,
            variant: None,
            model_id: Some("qa-mock".to_string()),
            agent_id: None,
            reasoning_id: None,
            permission_policy: Some(crate::model_selector::PermissionPolicy::Auto),
        }
    }
}

fn env_value_enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

async fn write_qa_fixture(dir: &Path) -> Result<(), ExecutorError> {
    let path = dir.join("qa_output.txt");
    tokio::fs::write(&path, "QA generated content\n")
        .await
        .map_err(|error| ExecutorError::Io(std::io::Error::other(error)))?;
    info!("QA Mock: wrote fixture file {:?}", path);
    Ok(())
}

/// Generate 10 mock log entries in ClaudeJson format using strongly-typed structs
fn generate_mock_logs(prompt: &str) -> Vec<String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let logs: Vec<ClaudeJson> = vec![
        // 1. System init
        ClaudeJson::System {
            subtype: Some("init".to_string()),
            session_id: Some(session_id.clone()),
            cwd: None,
            tools: None,
            model: Some("qa-mock-executor".to_string()),
            api_key_source: Some("unknown".to_string()),
            status: None,
            slash_commands: vec![],
            plugins: vec![],
            agents: vec![],
            task_id: None,
            tool_use_id: None,
            description: None,
            task_type: None,
            prompt: None,
            summary: None,
            last_tool_name: None,
        },
        // 2. Assistant thinking
        ClaudeJson::Assistant {
            message: ClaudeMessage {
                id: Some("msg-qa-1".to_string()),
                message_type: Some("message".to_string()),
                role: "assistant".to_string(),
                model: Some("qa-mock".to_string()),
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::Thinking {
                    thinking: "Analyzing the QA task and preparing mock execution...".to_string(),
                }]),
                stop_reason: None,
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-1".to_string()),
        },
        // 3. Read tool use
        ClaudeJson::Assistant {
            message: ClaudeMessage {
                id: Some("msg-qa-2".to_string()),
                message_type: Some("message".to_string()),
                role: "assistant".to_string(),
                model: Some("qa-mock".to_string()),
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolUse {
                    id: "qa-tool-1".to_string(),
                    tool_data: ClaudeToolData::Read {
                        file_path: "README.md".to_string(),
                    },
                }]),
                stop_reason: None,
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-2".to_string()),
        },
        // 4. Read tool result
        ClaudeJson::User {
            message: ClaudeMessage {
                id: Some("msg-qa-3".to_string()),
                message_type: Some("message".to_string()),
                role: "user".to_string(),
                model: None,
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolResult {
                    tool_use_id: "qa-tool-1".to_string(),
                    content: serde_json::json!(
                        "# Project README\\n\\nThis is a QA test repository."
                    ),
                    is_error: Some(false),
                }]),
                stop_reason: None,
            },
            is_synthetic: false,
            is_replay: false,
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-3".to_string()),
        },
        // 5. Write tool use
        ClaudeJson::Assistant {
            message: ClaudeMessage {
                id: Some("msg-qa-4".to_string()),
                message_type: Some("message".to_string()),
                role: "assistant".to_string(),
                model: Some("qa-mock".to_string()),
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolUse {
                    id: "qa-tool-2".to_string(),
                    tool_data: ClaudeToolData::Write {
                        file_path: "qa_output.txt".to_string(),
                        content: "QA generated content".to_string(),
                    },
                }]),
                stop_reason: None,
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-4".to_string()),
        },
        // 6. Write tool result
        ClaudeJson::User {
            message: ClaudeMessage {
                id: Some("msg-qa-5".to_string()),
                message_type: Some("message".to_string()),
                role: "user".to_string(),
                model: None,
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolResult {
                    tool_use_id: "qa-tool-2".to_string(),
                    content: serde_json::json!("File written successfully"),
                    is_error: Some(false),
                }]),
                stop_reason: None,
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-5".to_string()),
            is_synthetic: false,
            is_replay: false,
        },
        // 7. Bash tool use
        ClaudeJson::Assistant {
            message: ClaudeMessage {
                id: Some("msg-qa-6".to_string()),
                message_type: Some("message".to_string()),
                role: "assistant".to_string(),
                model: Some("qa-mock".to_string()),
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolUse {
                    id: "qa-tool-3".to_string(),
                    tool_data: ClaudeToolData::Bash {
                        command: "echo 'QA test complete'".to_string(),
                        description: Some("Run QA test command".to_string()),
                    },
                }]),
                stop_reason: None,
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-6".to_string()),
        },
        // 8. Bash tool result
        ClaudeJson::User {
            message: ClaudeMessage {
                id: Some("msg-qa-7".to_string()),
                message_type: Some("message".to_string()),
                role: "user".to_string(),
                model: None,
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::ToolResult {
                    tool_use_id: "qa-tool-3".to_string(),
                    content: serde_json::json!("QA test complete\\n"),
                    is_error: Some(false),
                }]),
                stop_reason: None,
            },
            is_synthetic: false,
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-7".to_string()),
            is_replay: false,
        },
        // 9. Assistant final message
        ClaudeJson::Assistant {
            message: ClaudeMessage {
                id: Some("msg-qa-8".to_string()),
                message_type: Some("message".to_string()),
                role: "assistant".to_string(),
                model: Some("qa-mock".to_string()),
                content: ClaudeMessageContent::Array(vec![ClaudeContentItem::Text {
                    text: format!(
                        "QA mode execution completed successfully.\\n\\nI performed the following operations:\\n1. Read README.md\\n2. Created qa_output.txt\\n3. Ran a test command\\nOriginal prompt: {}",
                        prompt
                    ),
                }]),
                stop_reason: Some("end_turn".to_string()),
            },
            session_id: Some(session_id.clone()),
            uuid: Some("uuid-qa-8".to_string()),
        },
        // 10. Result success
        ClaudeJson::Result {
            subtype: Some("success".to_string()),
            is_error: Some(false),
            duration_ms: Some(10000),
            result: None,
            error: None,
            num_turns: Some(3),
            session_id: Some(session_id),
            model_usage: None,
            usage: None,
        },
    ];

    // Serialize to JSON strings - this ensures proper escaping
    logs.into_iter()
        .map(|log| serde_json::to_string(&log).expect("ClaudeJson should serialize"))
        .collect()
}

#[cfg(test)]
mod tests {
    use workspace_utils::log_msg::LogMsg;

    use super::*;
    use crate::logs::{NormalizedEntryType, utils::patch::extract_normalized_entry_from_patch};

    #[tokio::test]
    async fn test_write_qa_fixture_creates_the_advertised_file_only() {
        let dir = std::env::temp_dir().join(format!("qa-mock-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&dir).await.unwrap();
        tokio::fs::write(dir.join("README.md"), "keep me\n")
            .await
            .unwrap();

        write_qa_fixture(&dir).await.unwrap();

        assert_eq!(
            tokio::fs::read_to_string(dir.join("qa_output.txt"))
                .await
                .unwrap(),
            "QA generated content\n"
        );
        assert_eq!(
            tokio::fs::read_to_string(dir.join("README.md"))
                .await
                .unwrap(),
            "keep me\n"
        );
        let mut names = Vec::new();
        let mut entries = tokio::fs::read_dir(&dir).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            names.push(entry.file_name());
        }
        names.sort();
        assert_eq!(
            names,
            [
                std::ffi::OsString::from("README.md"),
                std::ffi::OsString::from("qa_output.txt")
            ]
        );

        tokio::fs::remove_dir_all(dir).await.unwrap();
    }

    #[test]
    fn test_generate_mock_logs_count() {
        let logs = generate_mock_logs("test prompt");
        assert_eq!(logs.len(), 10, "Should generate exactly 10 log entries");
    }

    #[test]
    fn test_generate_mock_logs_valid_json() {
        let logs = generate_mock_logs("test prompt");
        for (i, log) in logs.iter().enumerate() {
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(log);
            assert!(
                parsed.is_ok(),
                "Log entry {} should be valid JSON: {}",
                i,
                log
            );
        }
    }

    #[test]
    fn test_generate_mock_logs_deserializes_to_claudejson() {
        let logs = generate_mock_logs("test prompt");
        for (i, log) in logs.iter().enumerate() {
            let parsed: Result<ClaudeJson, _> = serde_json::from_str(log);
            assert!(
                parsed.is_ok(),
                "Log entry {} should deserialize to ClaudeJson: {} - error: {:?}",
                i,
                log,
                parsed.err()
            );
        }
    }

    #[test]
    fn test_escape_special_characters() {
        let logs = generate_mock_logs("test with \"quotes\" and\nnewlines");
        // The final assistant message (index 8) should contain the prompt
        let final_log = &logs[8];
        let parsed: ClaudeJson = serde_json::from_str(final_log).unwrap();

        if let ClaudeJson::Assistant { message, .. } = parsed {
            if let ClaudeMessageContent::Array(items) = &message.content {
                if let Some(ClaudeContentItem::Text { text }) = items.first() {
                    assert!(text.contains("test with \"quotes\" and\nnewlines"));
                } else {
                    panic!("Expected Text content item");
                }
            } else {
                panic!("Expected Array content");
            }
        } else {
            panic!("Expected Assistant variant");
        }
    }

    #[tokio::test]
    async fn test_normalize_mock_logs_does_not_emit_raw_assistant_json() {
        let executor = QaMockExecutor;
        let msg_store = Arc::new(MsgStore::new());
        let current_dir = std::path::PathBuf::from("/tmp/work");

        let handles = executor.normalize_mock_logs(msg_store.clone(), &current_dir);
        let logs = generate_mock_logs("prompt with `backticks` and VK_QA_MODE");
        for log in logs.iter().take(8) {
            msg_store.push_stdout(format!("{log}\n"));
        }
        msg_store.push_stdout(logs[8].clone());
        msg_store.push_finished();
        for handle in handles {
            handle.await.unwrap();
        }

        let history = msg_store.get_history();
        let normalized_contents: Vec<String> = history
            .iter()
            .filter_map(|msg| match msg {
                LogMsg::JsonPatch(patch) => {
                    extract_normalized_entry_from_patch(patch).map(|(_, entry)| entry.content)
                }
                _ => None,
            })
            .collect();
        let raw_stdout_contents: Vec<&str> = history
            .iter()
            .filter_map(|msg| match msg {
                LogMsg::Stdout(content) => Some(content.as_str()),
                _ => None,
            })
            .collect();

        assert!(
            normalized_contents
                .iter()
                .any(|content| content.contains("QA mode execution completed successfully")),
            "expected normalized assistant prose, got {normalized_contents:#?}; history: {history:#?}"
        );
        assert!(
            normalized_contents
                .iter()
                .all(|content| !content.starts_with(r#"{"type":"assistant""#)),
            "raw assistant JSON should not be emitted as normalized content: {normalized_contents:#?}"
        );
        assert!(
            history.iter().any(|msg| matches!(
                msg,
                LogMsg::JsonPatch(patch)
                    if extract_normalized_entry_from_patch(patch)
                        .is_some_and(|(_, entry)| matches!(
                            entry.entry_type,
                            NormalizedEntryType::AssistantMessage
                        ))
            )),
            "expected final assistant patch for unterminated QA JSON; raw stdout was {raw_stdout_contents:#?}"
        );
    }

    #[test]
    fn test_env_value_enabled_accepts_common_truthy_values() {
        for value in ["1", "true", "TRUE", " yes ", "on", "On"] {
            assert!(env_value_enabled(value), "{value:?} should enable QA mode");
        }
    }

    #[test]
    fn test_env_value_enabled_rejects_falsey_and_unknown_values() {
        for value in ["", "0", "false", "no", "off", "enabled"] {
            assert!(
                !env_value_enabled(value),
                "{value:?} should not enable QA mode"
            );
        }
    }
}
