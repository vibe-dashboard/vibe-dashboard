use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::get,
};
use db::models::{
    execution_process::{ExecutionProcess, QueueEffectReconciliation},
    scratch::DraftFollowUpData,
    session::Session,
};
use deployment::Deployment;
use executors::profile::ExecutorConfig;
use serde::Deserialize;
use services::services::queued_message::{QueueError, QueueStatus};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError, middleware::load_session_middleware};

/// Request body for queueing a follow-up message
#[derive(Debug, Deserialize, TS)]
struct QueueMessageRequest {
    pub queue_id: uuid::Uuid,
    pub owner: String,
    pub message: String,
    pub executor_config: ExecutorConfig,
}

#[derive(Debug, Deserialize)]
struct QueueIdentity {
    pub queue_id: uuid::Uuid,
    pub owner: String,
}

fn queue_error(error: QueueError) -> ApiError {
    ApiError::Conflict(error.to_string())
}

fn validate_identity(payload: &QueueMessageRequest) -> Result<(), String> {
    if payload.owner.trim().is_empty() {
        return Err("Queue owner must not be empty".to_string());
    }
    Ok(())
}

/// Queue a follow-up message to be executed when the current execution finishes
async fn queue_message(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<QueueMessageRequest>,
) -> Result<ResponseJson<ApiResponse<QueueStatus>>, ApiError> {
    validate_identity(&payload).map_err(ApiError::BadRequest)?;
    if let Some(message) = super::invalid_session_command_message(&payload.message) {
        return Err(ApiError::BadRequest(message));
    }

    let data = DraftFollowUpData {
        session_command: super::parse_session_command(&payload.message),
        message: payload.message,
        executor_config: payload.executor_config,
    };

    let status = deployment
        .queued_message_service()
        .queue_message(session.id, payload.queue_id, payload.owner, data)
        .map_err(queue_error)?;

    deployment
        .track_if_analytics_allowed(
            "follow_up_queued",
            serde_json::json!({
                "session_id": session.id.to_string(),
                "workspace_id": session.workspace_id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(status)))
}

/// Cancel a queued follow-up message
async fn cancel_queued_message(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Query(identity): Query<QueueIdentity>,
) -> Result<ResponseJson<ApiResponse<QueueStatus>>, ApiError> {
    deployment
        .queued_message_service()
        .cancel_queued(session.id, identity.queue_id, &identity.owner)
        .map_err(queue_error)?;

    deployment
        .track_if_analytics_allowed(
            "follow_up_queue_cancelled",
            serde_json::json!({
                "session_id": session.id.to_string(),
                "workspace_id": session.workspace_id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(QueueStatus::Empty)))
}

async fn amend_queued_message(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<QueueMessageRequest>,
) -> Result<ResponseJson<ApiResponse<QueueStatus>>, ApiError> {
    validate_identity(&payload).map_err(ApiError::BadRequest)?;
    if let Some(message) = super::invalid_session_command_message(&payload.message) {
        return Err(ApiError::BadRequest(message));
    }
    let data = DraftFollowUpData {
        session_command: super::parse_session_command(&payload.message),
        message: payload.message,
        executor_config: payload.executor_config,
    };
    let queued = deployment
        .queued_message_service()
        .amend_queued(session.id, payload.queue_id, &payload.owner, data)
        .map_err(queue_error)?;
    Ok(ResponseJson(ApiResponse::success(QueueStatus::Queued {
        message: queued,
    })))
}

/// Get the current queue status for a session's workspace
async fn get_queue_status(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<QueueStatus>>, ApiError> {
    let status = deployment.queued_message_service().get_status(session.id);

    Ok(ResponseJson(ApiResponse::success(status)))
}

/// Resolve uncertain queue acceptance by stable queue identity.
async fn get_queued_execution(
    Extension(session): Extension<Session>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_session_id, queue_id)): axum::extract::Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<ResponseJson<ApiResponse<Option<QueueEffectReconciliation>>>, ApiError> {
    let reconciliation =
        ExecutionProcess::reconcile_queue_effect(&deployment.db().pool, queue_id).await?;
    if reconciliation
        .as_ref()
        .is_some_and(|effect| effect.session_id != session.id)
    {
        return Err(ApiError::BadRequest(
            "Queue effect does not belong to this session".to_string(),
        ));
    }
    Ok(ResponseJson(ApiResponse::success(reconciliation)))
}

pub(super) fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/",
            get(get_queue_status)
                .post(queue_message)
                .put(amend_queued_message)
                .delete(cancel_queued_message),
        )
        .route("/{queue_id}/process", get(get_queued_execution))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_session_middleware,
        ))
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, extract::Path, routing::get};
    use http::Request;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[tokio::test]
    async fn nested_queue_process_route_extracts_session_and_queue_ids() {
        let session_id = Uuid::new_v4();
        let queue_id = Uuid::new_v4();
        let queue_router = Router::new().route(
            "/{queue_id}/process",
            get(
                |Path((session_id, queue_id)): Path<(Uuid, Uuid)>| async move {
                    format!("{session_id}:{queue_id}")
                },
            ),
        );
        let app = Router::new().nest("/sessions/{session_id}/queue", queue_router);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{session_id}/queue/{queue_id}/process"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), http::StatusCode::OK);
    }
}
