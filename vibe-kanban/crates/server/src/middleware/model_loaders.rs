use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use db::models::{
    execution_process::ExecutionProcess, session::Session, tag::Tag, workspace::Workspace,
};
use deployment::Deployment;
use uuid::Uuid;

use crate::DeploymentImpl;

pub async fn load_workspace_middleware(
    State(deployment): State<DeploymentImpl>,
    Path(workspace_id): Path<Uuid>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Load the Workspace from the database
    let workspace = match Workspace::find_by_id(&deployment.db().pool, workspace_id).await {
        Ok(Some(w)) => w,
        Ok(None) => {
            tracing::warn!("Workspace {} not found", workspace_id);
            return Err(StatusCode::NOT_FOUND);
        }
        Err(e) => {
            tracing::error!("Failed to fetch Workspace {}: {}", workspace_id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Insert the workspace into extensions
    request.extensions_mut().insert(workspace);

    // Continue on
    Ok(next.run(request).await)
}

pub async fn load_execution_process_middleware(
    State(deployment): State<DeploymentImpl>,
    Path(process_id): Path<Uuid>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Load the execution process from the database
    let execution_process =
        match ExecutionProcess::find_by_id(&deployment.db().pool, process_id).await {
            Ok(Some(process)) => process,
            Ok(None) => {
                tracing::warn!("ExecutionProcess {} not found", process_id);
                return Err(StatusCode::NOT_FOUND);
            }
            Err(e) => {
                tracing::error!("Failed to fetch execution process {}: {}", process_id, e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    // Inject the execution process into the request
    request.extensions_mut().insert(execution_process);

    // Continue to the next middleware/handler
    Ok(next.run(request).await)
}

// Middleware that loads and injects Tag based on the tag_id path parameter
pub async fn load_tag_middleware(
    State(deployment): State<DeploymentImpl>,
    Path(tag_id): Path<Uuid>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Load the tag from the database
    let tag = match Tag::find_by_id(&deployment.db().pool, tag_id).await {
        Ok(Some(tag)) => tag,
        Ok(None) => {
            tracing::warn!("Tag {} not found", tag_id);
            return Err(StatusCode::NOT_FOUND);
        }
        Err(e) => {
            tracing::error!("Failed to fetch tag {}: {}", tag_id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Insert the tag as an extension
    let mut request = request;
    request.extensions_mut().insert(tag);

    // Continue with the next middleware/handler
    Ok(next.run(request).await)
}

/// Extract the session by name so nested routes may carry additional IDs.
#[derive(serde::Deserialize)]
pub struct SessionPath {
    session_id: Uuid,
}

pub async fn load_session_middleware(
    State(deployment): State<DeploymentImpl>,
    Path(SessionPath { session_id }): Path<SessionPath>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let session = match Session::find_by_id(&deployment.db().pool, session_id).await {
        Ok(Some(session)) => session,
        Ok(None) => {
            tracing::warn!("Session {} not found", session_id);
            return Err(StatusCode::NOT_FOUND);
        }
        Err(e) => {
            tracing::error!("Failed to fetch session {}: {}", session_id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    request.extensions_mut().insert(session);
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, middleware::from_fn, routing::get};
    use http::Request as HttpRequest;
    use tower::ServiceExt;

    use super::*;

    fn session_path_router() -> Router {
        Router::new()
            .route("/", get(|| async { "session" }))
            .route("/queue/{queue_id}/process", get(|| async { "queue" }))
            .layer(from_fn(
                |Path(SessionPath { session_id }): Path<SessionPath>,
                 request: Request,
                 next: Next| async move {
                    let mut response = next.run(request).await;
                    response
                        .headers_mut()
                        .insert("x-session-id", session_id.to_string().parse().unwrap());
                    response
                },
            ))
    }

    #[tokio::test]
    async fn session_path_accepts_single_and_nested_session_routes() {
        let session_id = Uuid::new_v4();
        let queue_id = Uuid::new_v4();
        let app = Router::new().nest("/sessions/{session_id}", session_path_router());
        for uri in [
            format!("/sessions/{session_id}"),
            format!("/sessions/{session_id}/queue/{queue_id}/process"),
        ] {
            let response = app
                .clone()
                .oneshot(HttpRequest::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-session-id"], session_id.to_string());
        }
    }

    #[tokio::test]
    async fn session_path_rejects_invalid_session_despite_valid_nested_queue_id() {
        let app = Router::new().nest("/sessions/{session_id}", session_path_router());
        let response = app
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/sessions/not-a-uuid/queue/{}/process",
                        Uuid::new_v4()
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
