use axum::{Extension, Json, Router, extract::State, response::Json as ResponseJson, routing::get};
use db::models::{
    execution_process::ExecutionProcess,
    requests::WorkspaceRepoInput,
    workspace::{Workspace, WorkspaceError},
    workspace_repo::{RepoWithTargetBranch, WorkspaceRepo},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::container::ContainerService;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct AddWorkspaceRepoRequest {
    pub repo_id: Uuid,
    pub target_branch: String,
}

#[derive(Debug, Serialize, TS)]
pub struct AddWorkspaceRepoResponse {
    pub workspace: Workspace,
    pub repo: RepoWithTargetBranch,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new().route("/", get(get_workspace_repos).post(add_workspace_repo))
}

pub async fn get_workspace_repos(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<RepoWithTargetBranch>>>, ApiError> {
    let pool = &deployment.db().pool;
    let repos =
        WorkspaceRepo::find_repos_with_target_branch_for_workspace(pool, workspace.id).await?;
    Ok(ResponseJson(ApiResponse::success(repos)))
}

#[axum::debug_handler]
pub async fn add_workspace_repo(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<AddWorkspaceRepoRequest>,
) -> Result<ResponseJson<ApiResponse<AddWorkspaceRepoResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    if ExecutionProcess::has_running_non_dev_server_processes_for_workspace(pool, workspace.id)
        .await?
    {
        return Err(ApiError::Conflict(
            "Cannot add repository while processes are running. Stop all non-dev-server processes first."
                .to_string(),
        ));
    }

    let mut managed_workspace = deployment
        .workspace_manager()
        .load_managed_workspace(workspace)
        .await?;

    let repo_input = WorkspaceRepoInput {
        repo_id: payload.repo_id,
        target_branch: payload.target_branch,
    };

    let workspace_repo = managed_workspace
        .add_repository(&repo_input, deployment.git())
        .await
        .map_err(ApiError::from)?;

    if let Err(err) = deployment
        .container()
        .ensure_container_exists(&managed_workspace.workspace)
        .await
    {
        if let Err(rollback_err) = WorkspaceRepo::delete_by_id(pool, workspace_repo.id).await {
            tracing::error!(
                "Failed to roll back workspace repo {} after container ensure failure for workspace {}: {}",
                workspace_repo.id,
                managed_workspace.workspace.id,
                rollback_err
            );
        }
        return Err(err.into());
    }

    let workspace = Workspace::find_by_id(pool, managed_workspace.workspace.id)
        .await?
        .ok_or(WorkspaceError::WorkspaceNotFound)?;
    let repo = managed_workspace
        .repos
        .iter()
        .find(|repo_with_target| repo_with_target.repo.id == repo_input.repo_id)
        .cloned()
        .ok_or_else(|| {
            ApiError::Conflict("Repository already attached to workspace".to_string())
        })?;

    deployment
        .track_if_analytics_allowed(
            "task_attempt_repo_added",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
                "repo_id": repo.repo.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(
        AddWorkspaceRepoResponse { workspace, repo },
    )))
}
