use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, OnceLock},
};

use chrono::{DateTime, Utc};
use db::models::{execution_process::ExecutionProcess, session::Session, workspace::Workspace};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use tokio::sync::Mutex;
use ts_rs::TS;
use uuid::Uuid;

const DEFAULT_PREVIEW_MESSAGE_LIMIT: usize = 3;
const MAX_PREVIEW_MESSAGE_LIMIT: usize = 50;
const PREVIEW_CACHE_SESSION_CAPACITY: usize = 25;
const RECENT_TURN_SCAN_LIMIT: i64 = 100;

#[derive(Debug, Error)]
pub enum ConversationPreviewError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Session not found")]
    SessionNotFound,
    #[error("Workspace not found")]
    WorkspaceNotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConversationPreviewMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ConversationPreviewMessage {
    pub role: ConversationPreviewMessageRole,
    pub content: String,
    pub execution_process_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ConversationPreview {
    pub workspace_id: Uuid,
    pub session_id: Option<Uuid>,
    pub messages: Vec<ConversationPreviewMessage>,
    pub has_running_turn: bool,
    pub source: ConversationPreviewSource,
    pub warmed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConversationPreviewSource {
    Cache,
    Computed,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct WarmWorkspaceSessionsRequest {
    pub workspace_id: Uuid,
    #[serde(default)]
    pub session_ids: Vec<Uuid>,
    #[serde(default = "default_true")]
    pub include_latest_session: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct WarmConversationPreviewRequest {
    #[serde(default)]
    pub workspace_ids: Vec<Uuid>,
    #[serde(default)]
    pub session_ids: Vec<Uuid>,
    #[serde(default)]
    pub workspace_sessions: Vec<WarmWorkspaceSessionsRequest>,
    pub message_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct WarmConversationPreviewItem {
    pub workspace_id: Uuid,
    pub session_id: Option<Uuid>,
    pub message_count: usize,
    pub source: ConversationPreviewSource,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct WarmConversationPreviewError {
    pub workspace_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct WarmConversationPreviewResponse {
    pub warmed: Vec<WarmConversationPreviewItem>,
    pub errors: Vec<WarmConversationPreviewError>,
}

#[derive(Clone)]
struct CachedConversationPreview {
    preview: ConversationPreview,
    max_messages: usize,
    source_fingerprint: PreviewSourceFingerprint,
}

#[derive(Default)]
struct ConversationPreviewCache {
    by_session: HashMap<Uuid, CachedConversationPreview>,
    recency: VecDeque<Uuid>,
}

struct ComputedConversationPreview {
    preview: ConversationPreview,
    source_fingerprint: PreviewSourceFingerprint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewSourceFingerprint {
    context_reset_execution_process_id: Option<Uuid>,
    turns: Vec<PreviewSourceTurnFingerprint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewSourceTurnFingerprint {
    execution_process_id: Uuid,
    process_created_at: DateTime<Utc>,
    process_completed_at: Option<DateTime<Utc>>,
    process_status: String,
    prompt: Option<String>,
    summary: Option<String>,
}

type SharedConversationPreviewCache = Arc<Mutex<ConversationPreviewCache>>;

fn conversation_preview_cache() -> &'static SharedConversationPreviewCache {
    static CACHE: OnceLock<SharedConversationPreviewCache> = OnceLock::new();
    CACHE.get_or_init(|| Arc::new(Mutex::new(ConversationPreviewCache::default())))
}

fn default_true() -> bool {
    true
}

pub fn normalize_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_PREVIEW_MESSAGE_LIMIT)
        .clamp(1, MAX_PREVIEW_MESSAGE_LIMIT)
}

impl ConversationPreviewCache {
    fn get_cached(&self, session_id: Uuid, limit: usize) -> Option<CachedConversationPreview> {
        let cached = self.by_session.get(&session_id)?;
        if cached.max_messages < limit {
            return None;
        }

        Some(cached.clone())
    }

    fn touch_cached_preview(
        &mut self,
        session_id: Uuid,
        cached: CachedConversationPreview,
        limit: usize,
    ) -> ConversationPreview {
        let mut preview = cached.preview;
        preview.source = ConversationPreviewSource::Cache;
        preview.messages = take_latest_messages(&preview.messages, limit);
        self.touch(session_id);
        preview
    }

    fn insert(
        &mut self,
        session_id: Uuid,
        computed: ComputedConversationPreview,
        max_messages: usize,
    ) {
        self.by_session.insert(
            session_id,
            CachedConversationPreview {
                preview: computed.preview,
                max_messages,
                source_fingerprint: computed.source_fingerprint,
            },
        );
        self.touch(session_id);
        self.evict_if_needed();
    }

    fn touch(&mut self, session_id: Uuid) {
        self.recency.retain(|id| *id != session_id);
        self.recency.push_back(session_id);
    }

    fn evict_if_needed(&mut self) {
        while self.by_session.len() > PREVIEW_CACHE_SESSION_CAPACITY {
            let Some(oldest) = self.recency.pop_front() else {
                break;
            };
            self.by_session.remove(&oldest);
        }
    }
}

pub fn take_latest_messages(
    messages: &[ConversationPreviewMessage],
    limit: usize,
) -> Vec<ConversationPreviewMessage> {
    let start = messages.len().saturating_sub(limit);
    messages[start..].to_vec()
}

#[derive(Debug, FromRow)]
struct ConversationTurnRow {
    workspace_id: Uuid,
    execution_process_id: Uuid,
    process_created_at: DateTime<Utc>,
    process_completed_at: Option<DateTime<Utc>>,
    process_status: String,
    prompt: Option<String>,
    summary: Option<String>,
    context_reset_execution_process_id: Option<Uuid>,
}

impl From<&ConversationTurnRow> for PreviewSourceTurnFingerprint {
    fn from(row: &ConversationTurnRow) -> Self {
        Self {
            execution_process_id: row.execution_process_id,
            process_created_at: row.process_created_at,
            process_completed_at: row.process_completed_at,
            process_status: row.process_status.clone(),
            prompt: row.prompt.clone(),
            summary: row.summary.clone(),
        }
    }
}

fn source_fingerprint_from_rows(
    context_reset_execution_process_id: Option<Uuid>,
    rows: &[ConversationTurnRow],
) -> PreviewSourceFingerprint {
    PreviewSourceFingerprint {
        context_reset_execution_process_id,
        turns: rows
            .iter()
            .map(PreviewSourceTurnFingerprint::from)
            .collect(),
    }
}

async fn empty_preview_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<ComputedConversationPreview, ConversationPreviewError> {
    let session = Session::find_by_id(pool, session_id)
        .await?
        .ok_or(ConversationPreviewError::SessionNotFound)?;

    Ok(ComputedConversationPreview {
        preview: ConversationPreview {
            workspace_id: session.workspace_id,
            session_id: Some(session.id),
            messages: Vec::new(),
            has_running_turn: false,
            source: ConversationPreviewSource::Computed,
            warmed_at: Utc::now(),
        },
        source_fingerprint: PreviewSourceFingerprint {
            context_reset_execution_process_id: session.context_reset_execution_process_id,
            turns: Vec::new(),
        },
    })
}

async fn load_preview_source_rows(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<Vec<ConversationTurnRow>, ConversationPreviewError> {
    Ok(sqlx::query_as::<_, ConversationTurnRow>(
        r#"
        SELECT *
        FROM (
            SELECT
                s.workspace_id AS workspace_id,
                s.context_reset_execution_process_id AS context_reset_execution_process_id,
                ep.id AS execution_process_id,
                ep.created_at AS process_created_at,
                ep.completed_at AS process_completed_at,
                ep.status AS process_status,
                cat.prompt AS prompt,
                cat.summary AS summary
            FROM coding_agent_turns cat
            JOIN execution_processes ep ON ep.id = cat.execution_process_id
            JOIN sessions s ON s.id = ep.session_id
            LEFT JOIN execution_processes reset_ep
              ON reset_ep.id = s.context_reset_execution_process_id
            WHERE ep.session_id = ?
              AND ep.dropped = FALSE
              AND (
                  s.context_reset_execution_process_id IS NULL
                  OR reset_ep.id IS NULL
                  OR ep.rowid > reset_ep.rowid
              )
            ORDER BY ep.created_at DESC
            LIMIT ?
        )
        ORDER BY process_created_at ASC
        "#,
    )
    .bind(session_id)
    .bind(RECENT_TURN_SCAN_LIMIT)
    .fetch_all(pool)
    .await?)
}

async fn compute_preview_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
    limit: usize,
) -> Result<ComputedConversationPreview, ConversationPreviewError> {
    let rows = load_preview_source_rows(pool, session_id).await?;

    let Some(workspace_id) = rows.first().map(|row| row.workspace_id) else {
        return empty_preview_for_session(pool, session_id).await;
    };
    let context_reset_execution_process_id = rows
        .first()
        .and_then(|row| row.context_reset_execution_process_id);

    let has_running_turn = rows.iter().any(|row| row.process_status == "running");
    let mut messages = Vec::new();

    for row in &rows {
        if let Some(prompt) = row.prompt.as_deref().map(str::trim)
            && !prompt.is_empty()
        {
            messages.push(ConversationPreviewMessage {
                role: ConversationPreviewMessageRole::User,
                content: prompt.to_string(),
                execution_process_id: row.execution_process_id,
                created_at: row.process_created_at,
            });
        }

        if let Some(summary) = row.summary.as_deref().map(str::trim)
            && !summary.is_empty()
        {
            messages.push(ConversationPreviewMessage {
                role: ConversationPreviewMessageRole::Assistant,
                content: summary.to_string(),
                execution_process_id: row.execution_process_id,
                created_at: row.process_completed_at.unwrap_or(row.process_created_at),
            });
        }
    }

    Ok(ComputedConversationPreview {
        preview: ConversationPreview {
            workspace_id,
            session_id: Some(session_id),
            messages: take_latest_messages(&messages, limit),
            has_running_turn,
            source: ConversationPreviewSource::Computed,
            warmed_at: Utc::now(),
        },
        source_fingerprint: source_fingerprint_from_rows(context_reset_execution_process_id, &rows),
    })
}

async fn latest_preview_fingerprint(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<PreviewSourceFingerprint, ConversationPreviewError> {
    let rows = load_preview_source_rows(pool, session_id).await?;
    if rows.is_empty() {
        return Ok(empty_preview_for_session(pool, session_id)
            .await?
            .source_fingerprint);
    }

    let context_reset_execution_process_id = rows
        .first()
        .and_then(|row| row.context_reset_execution_process_id);
    Ok(source_fingerprint_from_rows(
        context_reset_execution_process_id,
        &rows,
    ))
}

pub async fn get_or_compute_preview(
    pool: &SqlitePool,
    session_id: Uuid,
    limit: usize,
) -> Result<ConversationPreview, ConversationPreviewError> {
    let cached = conversation_preview_cache()
        .lock()
        .await
        .get_cached(session_id, limit);

    if let Some(cached) = cached
        && latest_preview_fingerprint(pool, session_id).await? == cached.source_fingerprint
    {
        return Ok(conversation_preview_cache()
            .lock()
            .await
            .touch_cached_preview(session_id, cached, limit));
    }

    let computed = compute_preview_for_session(pool, session_id, limit).await?;
    let preview = computed.preview.clone();
    conversation_preview_cache()
        .lock()
        .await
        .insert(session_id, computed, limit);

    Ok(preview)
}

pub async fn get_session_conversation_preview(
    pool: &SqlitePool,
    session_id: Uuid,
    limit: Option<usize>,
) -> Result<ConversationPreview, ConversationPreviewError> {
    get_or_compute_preview(pool, session_id, normalize_limit(limit)).await
}

pub async fn get_workspace_conversation_preview(
    pool: &SqlitePool,
    workspace_id: Uuid,
    limit: Option<usize>,
) -> Result<ConversationPreview, ConversationPreviewError> {
    Workspace::find_by_id(pool, workspace_id)
        .await?
        .ok_or(ConversationPreviewError::WorkspaceNotFound)?;

    let Some(session) = Session::find_latest_by_workspace_id(pool, workspace_id).await? else {
        return Ok(ConversationPreview {
            workspace_id,
            session_id: None,
            messages: Vec::new(),
            has_running_turn: false,
            source: ConversationPreviewSource::Computed,
            warmed_at: Utc::now(),
        });
    };

    get_or_compute_preview(pool, session.id, normalize_limit(limit)).await
}

async fn push_validated_workspace_session_id(
    pool: &SqlitePool,
    session_ids: &mut Vec<Uuid>,
    errors: &mut Vec<WarmConversationPreviewError>,
    workspace_id: Uuid,
    session_id: Uuid,
) {
    match Session::find_by_id(pool, session_id).await {
        Ok(Some(session)) if session.workspace_id == workspace_id => session_ids.push(session_id),
        Ok(Some(session)) => errors.push(WarmConversationPreviewError {
            workspace_id: Some(workspace_id),
            session_id: Some(session_id),
            message: format!(
                "Session belongs to workspace {}, not workspace {}",
                session.workspace_id, workspace_id
            ),
        }),
        Ok(None) => errors.push(WarmConversationPreviewError {
            workspace_id: Some(workspace_id),
            session_id: Some(session_id),
            message: "Session not found".to_string(),
        }),
        Err(error) => errors.push(WarmConversationPreviewError {
            workspace_id: Some(workspace_id),
            session_id: Some(session_id),
            message: format!("Failed to validate workspace session: {error}"),
        }),
    }
}

async fn resolve_warm_session_ids(
    pool: &SqlitePool,
    request: &WarmConversationPreviewRequest,
) -> (Vec<Uuid>, Vec<Uuid>, Vec<WarmConversationPreviewError>) {
    let mut session_ids = request.session_ids.clone();
    let mut empty_workspace_ids = Vec::new();
    let mut errors = Vec::new();

    for workspace_id in &request.workspace_ids {
        match Workspace::find_by_id(pool, *workspace_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                errors.push(WarmConversationPreviewError {
                    workspace_id: Some(*workspace_id),
                    session_id: None,
                    message: ConversationPreviewError::WorkspaceNotFound.to_string(),
                });
                continue;
            }
            Err(error) => {
                errors.push(WarmConversationPreviewError {
                    workspace_id: Some(*workspace_id),
                    session_id: None,
                    message: format!("Failed to validate workspace: {error}"),
                });
                continue;
            }
        }

        match Session::find_latest_by_workspace_id(pool, *workspace_id).await {
            Ok(Some(session)) => session_ids.push(session.id),
            Ok(None) => empty_workspace_ids.push(*workspace_id),
            Err(error) => errors.push(WarmConversationPreviewError {
                workspace_id: Some(*workspace_id),
                session_id: None,
                message: format!("Failed to resolve latest workspace session: {error}"),
            }),
        }
    }

    for workspace_sessions in &request.workspace_sessions {
        let workspace_exists =
            match Workspace::find_by_id(pool, workspace_sessions.workspace_id).await {
                Ok(Some(_)) => true,
                Ok(None) => {
                    errors.push(WarmConversationPreviewError {
                        workspace_id: Some(workspace_sessions.workspace_id),
                        session_id: None,
                        message: ConversationPreviewError::WorkspaceNotFound.to_string(),
                    });
                    false
                }
                Err(error) => {
                    errors.push(WarmConversationPreviewError {
                        workspace_id: Some(workspace_sessions.workspace_id),
                        session_id: None,
                        message: format!("Failed to validate workspace: {error}"),
                    });
                    false
                }
            };
        if !workspace_exists {
            continue;
        }

        for session_id in &workspace_sessions.session_ids {
            push_validated_workspace_session_id(
                pool,
                &mut session_ids,
                &mut errors,
                workspace_sessions.workspace_id,
                *session_id,
            )
            .await;
        }

        if workspace_sessions.include_latest_session {
            let latest_session =
                Session::find_latest_by_workspace_id(pool, workspace_sessions.workspace_id).await;
            match latest_session {
                Ok(Some(session)) => session_ids.push(session.id),
                Ok(None) => empty_workspace_ids.push(workspace_sessions.workspace_id),
                Err(error) => errors.push(WarmConversationPreviewError {
                    workspace_id: Some(workspace_sessions.workspace_id),
                    session_id: None,
                    message: format!("Failed to resolve latest workspace session: {error}"),
                }),
            }
        }
    }

    let mut seen = HashSet::new();
    session_ids.retain(|session_id| seen.insert(*session_id));

    let mut seen_empty_workspaces = HashSet::new();
    empty_workspace_ids.retain(|workspace_id| seen_empty_workspaces.insert(*workspace_id));

    (session_ids, empty_workspace_ids, errors)
}

pub async fn warm_conversation_previews(
    pool: &SqlitePool,
    request: WarmConversationPreviewRequest,
) -> WarmConversationPreviewResponse {
    let limit = normalize_limit(request.message_limit);
    let (session_ids, empty_workspace_ids, mut errors) =
        resolve_warm_session_ids(pool, &request).await;
    let mut warmed = Vec::new();

    for workspace_id in empty_workspace_ids {
        warmed.push(WarmConversationPreviewItem {
            workspace_id,
            session_id: None,
            message_count: 0,
            source: ConversationPreviewSource::Computed,
        });
    }

    for session_id in session_ids {
        match compute_preview_for_session(pool, session_id, limit).await {
            Ok(computed) => {
                let preview = computed.preview.clone();
                conversation_preview_cache()
                    .lock()
                    .await
                    .insert(session_id, computed, limit);
                warmed.push(WarmConversationPreviewItem {
                    workspace_id: preview.workspace_id,
                    session_id: preview.session_id,
                    message_count: preview.messages.len(),
                    source: preview.source,
                });
            }
            Err(error) => errors.push(WarmConversationPreviewError {
                workspace_id: None,
                session_id: Some(session_id),
                message: error.to_string(),
            }),
        }
    }

    WarmConversationPreviewResponse { warmed, errors }
}

pub async fn refresh_session_preview(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<(), ConversationPreviewError> {
    let computed =
        compute_preview_for_session(pool, session_id, DEFAULT_PREVIEW_MESSAGE_LIMIT).await?;
    conversation_preview_cache().lock().await.insert(
        session_id,
        computed,
        DEFAULT_PREVIEW_MESSAGE_LIMIT,
    );

    Ok(())
}

pub async fn refresh_execution_process_preview(
    pool: &SqlitePool,
    execution_process_id: Uuid,
) -> Result<(), ConversationPreviewError> {
    let Some(execution_process) = ExecutionProcess::find_by_id(pool, execution_process_id).await?
    else {
        return Ok(());
    };

    refresh_session_preview(pool, execution_process.session_id).await
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use sqlx::{Executor, SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{
        ConversationPreviewError, ConversationPreviewMessage, ConversationPreviewMessageRole,
        ConversationPreviewSource, MAX_PREVIEW_MESSAGE_LIMIT, RECENT_TURN_SCAN_LIMIT,
        WarmConversationPreviewRequest, get_or_compute_preview, get_workspace_conversation_preview,
        normalize_limit, take_latest_messages, warm_conversation_previews,
    };

    #[test]
    fn take_latest_messages_preserves_chronological_order() {
        let process_id = Uuid::new_v4();
        let messages: Vec<_> = (0..5)
            .map(|idx| ConversationPreviewMessage {
                role: if idx % 2 == 0 {
                    ConversationPreviewMessageRole::User
                } else {
                    ConversationPreviewMessageRole::Assistant
                },
                content: format!("message {idx}"),
                execution_process_id: process_id,
                created_at: Utc::now(),
            })
            .collect();

        let latest = take_latest_messages(&messages, 3);

        assert_eq!(
            latest
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["message 2", "message 3", "message 4"]
        );
    }

    #[test]
    fn normalize_limit_clamps_to_supported_range() {
        assert_eq!(normalize_limit(None), 3);
        assert_eq!(normalize_limit(Some(0)), 1);
        assert_eq!(normalize_limit(Some(100)), 50);
        assert!(RECENT_TURN_SCAN_LIMIT >= MAX_PREVIEW_MESSAGE_LIMIT as i64);
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        pool.execute(
            r#"CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                task_id BLOB NULL,
                container_ref TEXT NULL,
                branch TEXT NOT NULL,
                setup_completed_at TEXT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archived BOOLEAN NOT NULL DEFAULT FALSE,
                pinned BOOLEAN NOT NULL DEFAULT FALSE,
                name TEXT NULL,
                worktree_deleted BOOLEAN NOT NULL DEFAULT FALSE
            )"#,
        )
        .await
        .unwrap();

        pool.execute(
            r#"CREATE TABLE workspace_repos (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                repo_id BLOB NOT NULL,
                target_branch TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

        pool.execute(
            r#"CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                name TEXT NULL,
                executor TEXT NULL,
                agent_working_dir TEXT NULL,
                context_reset_execution_process_id BLOB NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

        pool.execute(
            r#"CREATE TABLE execution_processes (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                run_reason TEXT NOT NULL,
                executor_action TEXT NOT NULL,
                status TEXT NOT NULL,
                exit_code INTEGER NULL,
                dropped BOOLEAN NOT NULL DEFAULT FALSE,
                started_at TEXT NOT NULL,
                completed_at TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

        pool.execute(
            r#"CREATE TABLE coding_agent_turns (
                id BLOB PRIMARY KEY,
                execution_process_id BLOB NOT NULL,
                agent_session_id TEXT NULL,
                agent_message_id TEXT NULL,
                prompt TEXT NULL,
                summary TEXT NULL,
                seen BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

        pool
    }

    fn follow_up_action_json(prompt: &str) -> String {
        serde_json::json!({
            "typ": {
                "type": "CodingAgentFollowUpRequest",
                "prompt": prompt,
                "session_id": "agent-session",
                "reset_to_message_id": null,
                "executor_config": { "executor": "CODEX" },
                "working_dir": null
            },
            "next_action": null
        })
        .to_string()
    }

    async fn insert_workspace(pool: &SqlitePool, id: Uuid) {
        sqlx::query("INSERT INTO workspaces (id, branch, name) VALUES (?, 'branch', 'workspace')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_session(pool: &SqlitePool, id: Uuid, workspace_id: Uuid) {
        sqlx::query("INSERT INTO sessions (id, workspace_id, executor) VALUES (?, ?, 'CODEX')")
            .bind(id)
            .bind(workspace_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn set_context_reset_boundary(pool: &SqlitePool, session_id: Uuid, process_id: Uuid) {
        sqlx::query("UPDATE sessions SET context_reset_execution_process_id = ? WHERE id = ?")
            .bind(process_id)
            .bind(session_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_turn(
        pool: &SqlitePool,
        session_id: Uuid,
        prompt: &str,
        summary: &str,
        offset_seconds: i64,
    ) -> Uuid {
        let process_id = Uuid::new_v4();
        let turn_id = Uuid::new_v4();
        let created_at = Utc::now() + Duration::seconds(offset_seconds);
        let completed_at = created_at + Duration::seconds(1);

        sqlx::query(
            r#"INSERT INTO execution_processes (
                id, session_id, run_reason, executor_action, status, exit_code,
                dropped, started_at, completed_at, created_at, updated_at
            ) VALUES (?, ?, 'codingagent', ?, 'completed', 0, FALSE, ?, ?, ?, ?)"#,
        )
        .bind(process_id)
        .bind(session_id)
        .bind(follow_up_action_json(prompt))
        .bind(created_at)
        .bind(completed_at)
        .bind(created_at)
        .bind(completed_at)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            r#"INSERT INTO coding_agent_turns (
                id, execution_process_id, prompt, summary, seen
            ) VALUES (?, ?, ?, ?, FALSE)"#,
        )
        .bind(turn_id)
        .bind(process_id)
        .bind(prompt)
        .bind(summary)
        .execute(pool)
        .await
        .unwrap();

        process_id
    }

    #[tokio::test]
    async fn db_preview_respects_context_reset_boundary() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        insert_workspace(&pool, workspace_id).await;
        insert_session(&pool, session_id, workspace_id).await;

        insert_turn(&pool, session_id, "before", "old answer", 0).await;
        let boundary = insert_turn(&pool, session_id, "/clear", "cleared", 10).await;
        insert_turn(&pool, session_id, "after", "new answer", 20).await;
        set_context_reset_boundary(&pool, session_id, boundary).await;

        let preview = get_or_compute_preview(&pool, session_id, 10).await.unwrap();

        assert_eq!(
            preview
                .messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["after", "new answer"]
        );
    }

    #[tokio::test]
    async fn db_cached_preview_recomputes_after_context_reset_boundary_changes() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        insert_workspace(&pool, workspace_id).await;
        insert_session(&pool, session_id, workspace_id).await;

        insert_turn(&pool, session_id, "before", "old answer", 0).await;
        let boundary = insert_turn(&pool, session_id, "/clear", "cleared", 10).await;
        insert_turn(&pool, session_id, "after", "new answer", 20).await;

        let warm = get_or_compute_preview(&pool, session_id, 10).await.unwrap();
        assert_eq!(warm.source, ConversationPreviewSource::Computed);
        assert_eq!(
            warm.messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec![
                "before",
                "old answer",
                "/clear",
                "cleared",
                "after",
                "new answer"
            ]
        );

        let cached = get_or_compute_preview(&pool, session_id, 10).await.unwrap();
        assert_eq!(cached.source, ConversationPreviewSource::Cache);

        set_context_reset_boundary(&pool, session_id, boundary).await;

        let recomputed = get_or_compute_preview(&pool, session_id, 10).await.unwrap();
        assert_eq!(recomputed.source, ConversationPreviewSource::Computed);
        assert_eq!(
            recomputed
                .messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["after", "new answer"]
        );
    }

    #[tokio::test]
    async fn db_cached_preview_recomputes_after_drop_with_same_message_count() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        insert_workspace(&pool, workspace_id).await;
        insert_session(&pool, session_id, workspace_id).await;

        insert_turn(&pool, session_id, "first", "first answer", 0).await;
        let second = insert_turn(&pool, session_id, "second", "second answer", 10).await;

        let warm = get_or_compute_preview(&pool, session_id, 2).await.unwrap();
        assert_eq!(
            warm.messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "second answer"]
        );

        sqlx::query("UPDATE execution_processes SET dropped = TRUE WHERE id = ?")
            .bind(second)
            .execute(&pool)
            .await
            .unwrap();

        let recomputed = get_or_compute_preview(&pool, session_id, 2).await.unwrap();
        assert_eq!(recomputed.source, ConversationPreviewSource::Computed);
        assert_eq!(
            recomputed
                .messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "first answer"]
        );
    }

    #[tokio::test]
    async fn db_workspace_preview_distinguishes_empty_from_nonexistent_workspace() {
        let pool = test_pool().await;
        let workspace_id = Uuid::new_v4();
        insert_workspace(&pool, workspace_id).await;

        let empty_preview = get_workspace_conversation_preview(&pool, workspace_id, None)
            .await
            .unwrap();
        assert_eq!(empty_preview.workspace_id, workspace_id);
        assert!(empty_preview.session_id.is_none());
        assert!(empty_preview.messages.is_empty());

        let error = get_workspace_conversation_preview(&pool, Uuid::new_v4(), None)
            .await
            .unwrap_err();
        assert!(matches!(error, ConversationPreviewError::WorkspaceNotFound));
    }

    #[tokio::test]
    async fn db_warm_returns_error_for_nonexistent_workspace() {
        let pool = test_pool().await;

        let response = warm_conversation_previews(
            &pool,
            WarmConversationPreviewRequest {
                workspace_ids: vec![Uuid::new_v4()],
                session_ids: Vec::new(),
                workspace_sessions: Vec::new(),
                message_limit: None,
            },
        )
        .await;

        assert!(response.warmed.is_empty());
        assert_eq!(response.errors.len(), 1);
        assert_eq!(response.errors[0].message, "Workspace not found");
    }
}
