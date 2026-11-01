//! Upgrade-contract tests for pinned coding-agent CLI integrations.
//!
//! These tests intentionally avoid invoking CLIs, network access, or credentials.
//! Upgrade PRs should update the pinned versions and committed fixtures together.

use std::{collections::BTreeMap, path::Path, sync::Arc};

use serde::Deserialize;
use serde_json::Value;
use workspace_utils::{log_msg::LogMsg, msg_store::MsgStore};

use crate::{
    executors::{
        claude::{ClaudeLogProcessor, HistoryStrategy},
        codex::normalize_logs as codex_normalize_logs,
    },
    logs::{NormalizedEntry, NormalizedEntryType, ToolStatus, utils::EntryIndexProvider},
};

const CODEX_SOURCE: &str = include_str!("executors/codex.rs");
const CLAUDE_SOURCE: &str = include_str!("executors/claude.rs");
const EXECUTORS_CARGO_TOML: &str = include_str!("../Cargo.toml");
const CARGO_LOCK: &str = include_str!("../../../Cargo.lock");

const CODEX_CURRENT_METADATA: &str =
    include_str!("../tests/fixtures/agent-cli/codex/current/metadata.json");
const CODEX_PREVIOUS_METADATA: &str =
    include_str!("../tests/fixtures/agent-cli/codex/previous/metadata.json");
const CLAUDE_CURRENT_METADATA: &str =
    include_str!("../tests/fixtures/agent-cli/claude/current/metadata.json");
const CLAUDE_PREVIOUS_METADATA: &str =
    include_str!("../tests/fixtures/agent-cli/claude/previous/metadata.json");

#[derive(Debug, Deserialize)]
struct FixtureMetadata {
    cli: String,
    package: String,
    version_role: String,
    version: String,
    captured_from: String,
    raw_fixture: String,
    compatibility_scope: String,
}

#[test]
fn codex_pinned_versions_are_in_lockstep() {
    let npm_version = extract_package_version(CODEX_SOURCE, "@openai/codex@");
    assert_eq!(npm_version, "0.147.0");

    let expected_tag = format!("rust-v{npm_version}");
    assert_dependency_tag(EXECUTORS_CARGO_TOML, "codex-protocol", &expected_tag);
    assert_dependency_tag(
        EXECUTORS_CARGO_TOML,
        "codex-app-server-protocol",
        &expected_tag,
    );
    assert_lock_package(CARGO_LOCK, "codex-protocol", npm_version, &expected_tag);
    assert_lock_package(
        CARGO_LOCK,
        "codex-app-server-protocol",
        npm_version,
        &expected_tag,
    );

    let current = fixture_metadata(CODEX_CURRENT_METADATA);
    assert_eq!(current.cli, "codex");
    assert_eq!(current.package, "@openai/codex");
    assert_eq!(current.version_role, "current");
    assert_eq!(current.version, npm_version);
    assert_eq!(current.compatibility_scope, "normalization_no_migration");

    let previous = fixture_metadata(CODEX_PREVIOUS_METADATA);
    assert_eq!(previous.cli, "codex");
    assert_eq!(previous.package, "@openai/codex");
    assert_eq!(previous.version_role, "previous");
    assert_eq!(previous.version, "0.144.1");
    assert_ne!(previous.version, current.version);
    assert_eq!(previous.compatibility_scope, current.compatibility_scope);
}

#[test]
fn claude_pinned_version_matches_fixtures_without_router_coupling() {
    let anthropic_version = extract_package_version(CLAUDE_SOURCE, "@anthropic-ai/claude-code@");
    assert_eq!(anthropic_version, "2.1.227");
    assert!(
        CLAUDE_SOURCE.contains("@musistudio/claude-code-router@"),
        "router command should remain visible as a separate integration surface"
    );

    let current = fixture_metadata(CLAUDE_CURRENT_METADATA);
    assert_eq!(current.cli, "claude");
    assert_eq!(current.package, "@anthropic-ai/claude-code");
    assert_eq!(current.version_role, "current");
    assert_eq!(current.version, anthropic_version);
    assert_eq!(current.compatibility_scope, "normalization_no_migration");

    let previous = fixture_metadata(CLAUDE_PREVIOUS_METADATA);
    assert_eq!(previous.cli, "claude");
    assert_eq!(previous.package, "@anthropic-ai/claude-code");
    assert_eq!(previous.version_role, "previous");
    assert_eq!(previous.version, "2.1.207");
    assert_ne!(previous.version, current.version);
    assert_eq!(previous.compatibility_scope, current.compatibility_scope);
}

#[tokio::test]
async fn codex_current_and_previous_saved_log_fixtures_normalize() {
    let cases = [
        (
            fixture_metadata(CODEX_CURRENT_METADATA),
            include_str!("../tests/fixtures/agent-cli/codex/current/stdout.jsonl"),
        ),
        (
            fixture_metadata(CODEX_PREVIOUS_METADATA),
            include_str!("../tests/fixtures/agent-cli/codex/previous/stdout.jsonl"),
        ),
    ];

    for (metadata, raw) in cases {
        assert_eq!(metadata.raw_fixture, "stdout.jsonl");
        assert_eq!(metadata.captured_from, "committed_raw_fixture");

        let entries = normalize_codex_fixture(raw).await;
        assert!(
            entries.iter().any(|entry| {
                matches!(
                    &entry.entry_type,
                    NormalizedEntryType::ToolUse {
                        tool_name,
                        status: ToolStatus::Success,
                        ..
                    } if tool_name == "lookup_ticket"
                )
            }),
            "Codex {} fixture did not normalize dynamic tool success: {entries:#?}",
            metadata.version_role
        );
    }
}

#[tokio::test]
async fn claude_current_and_previous_saved_log_fixtures_normalize() {
    let cases = [
        (
            fixture_metadata(CLAUDE_CURRENT_METADATA),
            include_str!("../tests/fixtures/agent-cli/claude/current/stdout.jsonl"),
        ),
        (
            fixture_metadata(CLAUDE_PREVIOUS_METADATA),
            include_str!("../tests/fixtures/agent-cli/claude/previous/stdout.jsonl"),
        ),
    ];

    for (metadata, raw) in cases {
        assert_eq!(metadata.raw_fixture, "stdout.jsonl");
        assert_eq!(metadata.captured_from, "committed_raw_fixture");

        let entries = normalize_claude_fixture(raw).await;
        assert!(
            entries.iter().any(|entry| {
                matches!(entry.entry_type, NormalizedEntryType::AssistantMessage)
                    && entry.content.contains("Fixture response")
            }),
            "Claude {} fixture did not normalize assistant response: {entries:#?}",
            metadata.version_role
        );
    }
}

fn fixture_metadata(raw: &str) -> FixtureMetadata {
    serde_json::from_str(raw).expect("fixture metadata must be valid JSON")
}

fn extract_package_version<'a>(source: &'a str, package_prefix: &str) -> &'a str {
    let start = source
        .find(package_prefix)
        .unwrap_or_else(|| panic!("missing package prefix {package_prefix}"))
        + package_prefix.len();
    let version = &source[start..];
    version
        .split(|ch: char| ch == '"' || ch.is_whitespace())
        .next()
        .unwrap_or_else(|| panic!("missing package version after {package_prefix}"))
}

fn assert_dependency_tag(cargo_toml: &str, dependency: &str, expected_tag: &str) {
    let line = cargo_toml
        .lines()
        .find(|line| line.starts_with(&format!("{dependency} = ")))
        .unwrap_or_else(|| panic!("missing dependency {dependency}"));
    assert!(
        line.contains(&format!(r#"tag = "{expected_tag}""#)),
        "{dependency} tag must be {expected_tag}, got: {line}"
    );
}

fn assert_lock_package(lock: &str, package: &str, expected_version: &str, expected_tag: &str) {
    let block = lock
        .split("[[package]]")
        .find(|block| block.contains(&format!("name = \"{package}\"")))
        .unwrap_or_else(|| panic!("missing Cargo.lock package {package}"));
    assert!(
        block.contains(&format!("version = \"{expected_version}\"")),
        "{package} Cargo.lock version must be {expected_version}, got: {block}"
    );
    assert!(
        block.contains(&format!("tag={expected_tag}")),
        "{package} Cargo.lock source must use {expected_tag}, got: {block}"
    );
}

async fn normalize_codex_fixture(raw: &str) -> Vec<NormalizedEntry> {
    let msg_store = Arc::new(MsgStore::new());
    for line in jsonl_lines(raw) {
        msg_store.push_stdout(format!("{line}\n"));
    }
    msg_store.push_finished();

    for handle in
        codex_normalize_logs::normalize_logs(msg_store.clone(), Path::new("/tmp/worktree"))
    {
        handle.await.unwrap();
    }

    latest_normalized_entries(&msg_store)
}

async fn normalize_claude_fixture(raw: &str) -> Vec<NormalizedEntry> {
    let msg_store = Arc::new(MsgStore::new());
    for line in jsonl_lines(raw) {
        msg_store.push_stdout(format!("{line}\n"));
    }
    msg_store.push_finished();

    let handle = ClaudeLogProcessor::process_logs(
        msg_store.clone(),
        Path::new("/tmp/worktree"),
        EntryIndexProvider::start_from(&msg_store),
        HistoryStrategy::Default,
    );
    handle.await.unwrap();

    latest_normalized_entries(&msg_store)
}

fn jsonl_lines(raw: &str) -> impl Iterator<Item = &str> {
    raw.lines().map(str::trim).filter(|line| !line.is_empty())
}

fn latest_normalized_entries(msg_store: &MsgStore) -> Vec<NormalizedEntry> {
    let mut entries = BTreeMap::new();
    for msg in msg_store.get_history() {
        if let LogMsg::JsonPatch(patch) = msg
            && let Some((index, entry)) =
                crate::logs::utils::patch::extract_normalized_entry_from_patch(&patch)
        {
            entries.insert(index, entry);
        }
    }
    entries.into_values().collect()
}

#[allow(dead_code)]
fn assert_json_fixture_is_valid_jsonl(raw: &str) {
    for line in jsonl_lines(raw) {
        serde_json::from_str::<Value>(line).expect("fixture lines must be valid JSON");
    }
}
