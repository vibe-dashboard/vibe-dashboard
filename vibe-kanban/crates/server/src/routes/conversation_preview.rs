use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{session::SessionError, workspace::WorkspaceError};
use deployment::Deployment;
use serde::Deserialize;
use services::services::conversation_preview::{
    ConversationPreview, ConversationPreviewError, WarmConversationPreviewRequest,
    WarmConversationPreviewResponse, get_session_conversation_preview as get_session_preview,
    get_workspace_conversation_preview as get_workspace_preview,
    warm_conversation_previews as warm_previews,
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Deserialize)]
pub struct ConversationPreviewQuery {
    pub limit: Option<usize>,
}

fn map_conversation_preview_error(error: ConversationPreviewError) -> ApiError {
    match error {
        ConversationPreviewError::Database(error) => ApiError::Database(error),
        ConversationPreviewError::SessionNotFound => ApiError::Session(SessionError::NotFound),
        ConversationPreviewError::WorkspaceNotFound => {
            ApiError::Workspace(WorkspaceError::WorkspaceNotFound)
        }
    }
}

pub async fn warm_conversation_previews(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<WarmConversationPreviewRequest>,
) -> Result<ResponseJson<ApiResponse<WarmConversationPreviewResponse>>, ApiError> {
    let response = warm_previews(&deployment.db().pool, request).await;
    Ok(ResponseJson(ApiResponse::success(response)))
}

pub async fn get_session_conversation_preview(
    State(deployment): State<DeploymentImpl>,
    Path(session_id): Path<Uuid>,
    Query(query): Query<ConversationPreviewQuery>,
) -> Result<ResponseJson<ApiResponse<ConversationPreview>>, ApiError> {
    let preview = get_session_preview(&deployment.db().pool, session_id, query.limit)
        .await
        .map_err(map_conversation_preview_error)?;
    Ok(ResponseJson(ApiResponse::success(preview)))
}

pub async fn get_workspace_conversation_preview(
    State(deployment): State<DeploymentImpl>,
    Path(workspace_id): Path<Uuid>,
    Query(query): Query<ConversationPreviewQuery>,
) -> Result<ResponseJson<ApiResponse<ConversationPreview>>, ApiError> {
    let preview = get_workspace_preview(&deployment.db().pool, workspace_id, query.limit)
        .await
        .map_err(map_conversation_preview_error)?;
    Ok(ResponseJson(ApiResponse::success(preview)))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/conversation-preview/warm",
            post(warm_conversation_previews),
        )
        .route(
            "/sessions/{session_id}/conversation-preview",
            get(get_session_conversation_preview),
        )
        .route(
            "/workspaces/{workspace_id}/conversation-preview",
            get(get_workspace_conversation_preview),
        )
}
