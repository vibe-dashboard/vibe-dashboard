use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use db::{
    DBService,
    models::{
        file::WorkspaceAttachment,
        repo::{Repo, RepoError},
        requests::WorkspaceRepoInput,
        session::Session,
        workspace::Workspace as DbWorkspace,
        workspace_repo::{
            CreateWorkspaceRepo, RepoWithTargetBranch, WorkspaceRepo,
            branch_names_conflict_as_self_target,
        },
    },
};
use git::{GitService, GitServiceError};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use uuid::Uuid;
use worktree_manager::{WorktreeCleanup, WorktreeError, WorktreeManager};

#[derive(Debug, Clone)]
pub struct RepoWorkspaceInput {
    pub repo: Repo,
    pub target_branch: String,
    pub create_branch: bool,
    pub checkout_branch: Option<String>,
}

impl RepoWorkspaceInput {
    pub fn new(
        repo: Repo,
        target_branch: String,
        create_branch: bool,
        checkout_branch: Option<String>,
    ) -> Self {
        Self {
            repo,
            target_branch,
            create_branch,
            checkout_branch,
        }
    }

    fn branch_name<'a>(&'a self, workspace_branch: &'a str) -> &'a str {
        if self.create_branch {
            workspace_branch
        } else {
            self.checkout_branch.as_deref().unwrap_or(workspace_branch)
        }
    }
}

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Repo(#[from] RepoError),
    #[error(transparent)]
    Worktree(#[from] WorktreeError),
    #[error(transparent)]
    GitService(#[from] GitServiceError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Workspace not found")]
    WorkspaceNotFound,
    #[error("Repository already attached to workspace")]
    RepoAlreadyAttached,
    #[error("Repository name '{repo_name}' is already attached to workspace")]
    RepoNameAlreadyAttached { repo_name: String },
    #[error("Branch '{branch}' does not exist in repository '{repo_name}'")]
    BranchNotFound { repo_name: String, branch: String },
    #[error("Direct checkout mode requires an existing local branch in repository '{repo_name}'")]
    DirectCheckoutBranchRequired { repo_name: String },
    #[error("Direct checkout branch '{branch}' in repository '{repo_name}' must be a local branch")]
    DirectCheckoutBranchNotLocal { repo_name: String, branch: String },
    #[error(
        "Direct checkout branch '{branch}' in repository '{repo_name}' is already checked out at {path}"
    )]
    DirectCheckoutBranchAlreadyCheckedOut {
        repo_name: String,
        branch: String,
        path: PathBuf,
    },
    #[error(
        "Direct checkout branch and target/base branch must be different for repository '{repo_name}'"
    )]
    DirectCheckoutBranchMatchesTarget { repo_name: String },
    #[error("Workspace branch name '{branch}' is not a valid git branch name")]
    InvalidWorkspaceBranchName { branch: String },
    #[error("Workspace branch '{branch}' already exists in repository '{repo_name}'")]
    WorkspaceBranchAlreadyExists { repo_name: String, branch: String },
    #[error(
        "Workspace branch '{branch}' in repository '{repo_name}' is already checked out at {path}"
    )]
    WorkspaceBranchAlreadyCheckedOut {
        repo_name: String,
        branch: String,
        path: PathBuf,
    },
    #[error("No repositories provided")]
    NoRepositories,
    #[error("Partial workspace creation failed: {0}")]
    PartialCreation(String),
}

/// Info about a single repo's worktree within a workspace
#[derive(Debug, Clone)]
pub struct RepoWorktree {
    pub repo_id: Uuid,
    pub repo_name: String,
    pub source_repo_path: PathBuf,
    pub worktree_path: PathBuf,
}

/// A container directory holding worktrees for all project repos
#[derive(Debug, Clone)]
pub struct WorktreeContainer {
    pub workspace_dir: PathBuf,
    pub worktrees: Vec<RepoWorktree>,
}

#[cfg(test)]
mod direct_branch_tests {
    use chrono::Utc;
    use db::models::repo::Repo;
    use uuid::Uuid;

    use super::RepoWorkspaceInput;

    fn repo(name: &str) -> Repo {
        Repo {
            id: Uuid::new_v4(),
            path: format!("/tmp/{name}").into(),
            name: name.to_string(),
            display_name: name.to_string(),
            setup_script: None,
            cleanup_script: None,
            archive_script: None,
            copy_files: None,
            parallel_setup_script: false,
            dev_server_script: None,
            dev_server_scripts: Vec::new(),
            default_target_branch: None,
            default_working_dir: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn direct_mode_inputs_allow_different_checkout_branch_names() {
        let repo_a = RepoWorkspaceInput::new(
            repo("repo-a"),
            "main".to_string(),
            false,
            Some("feature-a".to_string()),
        );
        let repo_b = RepoWorkspaceInput::new(
            repo("repo-b"),
            "main".to_string(),
            false,
            Some("feature-b".to_string()),
        );

        assert_eq!(repo_a.branch_name("vk/workspace"), "feature-a");
        assert_eq!(repo_b.branch_name("vk/workspace"), "feature-b");
    }

    #[test]
    fn create_branch_inputs_continue_to_use_workspace_branch() {
        let repo = RepoWorkspaceInput::new(
            repo("repo"),
            "main".to_string(),
            true,
            Some("ignored-direct-branch".to_string()),
        );

        assert_eq!(repo.branch_name("vk/workspace"), "vk/workspace");
    }

    #[test]
    fn direct_mode_checkout_branch_does_not_replace_workspace_branch_for_deletion() {
        let repo = RepoWorkspaceInput::new(
            repo("repo"),
            "main".to_string(),
            false,
            Some("user-owned-feature".to_string()),
        );
        let workspace_branch = "vk/generated-workspace-branch";

        assert_eq!(repo.branch_name(workspace_branch), "user-owned-feature");

        let deletion_context = super::WorkspaceDeletionContext {
            workspace_id: Uuid::new_v4(),
            branch_name: workspace_branch.to_string(),
            workspace_dir: None,
            repositories: vec![],
            repo_paths: vec![],
            session_ids: vec![],
        };

        assert_eq!(deletion_context.branch_name, workspace_branch);
        assert_ne!(
            deletion_context.branch_name,
            repo.branch_name(workspace_branch)
        );
    }

    #[test]
    fn direct_checkout_rejects_self_targeting_before_git_lookup() {
        let repo = repo("repo");
        let git = git::GitService::new();

        let err = super::WorkspaceManager::validate_direct_checkout_branch(
            &repo, "feature", "feature", &git,
        )
        .expect_err("direct checkout branch must not match target/base branch");

        assert!(matches!(
            err,
            super::WorkspaceError::DirectCheckoutBranchMatchesTarget { .. }
        ));
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceDeletionContext {
    pub workspace_id: Uuid,
    pub branch_name: String,
    pub workspace_dir: Option<PathBuf>,
    pub repositories: Vec<Repo>,
    pub repo_paths: Vec<PathBuf>,
    pub session_ids: Vec<Uuid>,
}

#[derive(Clone)]
pub struct ManagedWorkspace {
    pub workspace: DbWorkspace,
    pub repos: Vec<RepoWithTargetBranch>,
    db: DBService,
}

impl ManagedWorkspace {
    fn new(db: DBService, workspace: DbWorkspace, repos: Vec<RepoWithTargetBranch>) -> Self {
        Self {
            workspace,
            repos,
            db,
        }
    }

    async fn attach_repository(
        &self,
        repo: &WorkspaceRepoInput,
    ) -> Result<WorkspaceRepo, sqlx::Error> {
        let create_repo = CreateWorkspaceRepo {
            repo_id: repo.repo_id,
            target_branch: repo.target_branch.clone(),
            create_branch: repo.create_branch,
            checkout_branch: repo.checkout_branch.clone(),
        };

        WorkspaceRepo::create_many(
            &self.db.pool,
            self.workspace.id,
            std::slice::from_ref(&create_repo),
        )
        .await
        .map(|mut repos| repos.remove(0))
    }

    async fn refresh(&mut self) -> Result<(), WorkspaceError> {
        self.workspace = DbWorkspace::find_by_id(&self.db.pool, self.workspace.id)
            .await?
            .ok_or(WorkspaceError::WorkspaceNotFound)?;
        self.repos = WorkspaceRepo::find_repos_with_target_branch_for_workspace(
            &self.db.pool,
            self.workspace.id,
        )
        .await?;
        Ok(())
    }

    pub async fn add_repository(
        &mut self,
        repo_ref: &WorkspaceRepoInput,
        git: &GitService,
    ) -> Result<WorkspaceRepo, WorkspaceError> {
        let repo =
            WorkspaceManager::validate_repository_input(&self.db.pool, repo_ref, git).await?;

        if WorkspaceRepo::find_by_workspace_and_repo_id(
            &self.db.pool,
            self.workspace.id,
            repo_ref.repo_id,
        )
        .await?
        .is_some()
        {
            return Err(WorkspaceError::RepoAlreadyAttached);
        }

        if WorkspaceRepo::find_by_workspace_and_repo_name(
            &self.db.pool,
            self.workspace.id,
            &repo.name,
        )
        .await?
        .is_some()
        {
            return Err(WorkspaceError::RepoNameAlreadyAttached {
                repo_name: repo.name,
            });
        }

        if !git.check_branch_exists(&repo.path, &repo_ref.target_branch)? {
            return Err(WorkspaceError::BranchNotFound {
                repo_name: repo.name,
                branch: repo_ref.target_branch.clone(),
            });
        }

        let workspace_repo = self.attach_repository(repo_ref).await?;
        self.refresh().await?;
        Ok(workspace_repo)
    }

    pub async fn associate_attachments(&self, attachment_ids: &[Uuid]) -> Result<(), sqlx::Error> {
        if attachment_ids.is_empty() {
            return Ok(());
        }

        WorkspaceAttachment::associate_many_dedup(&self.db.pool, self.workspace.id, attachment_ids)
            .await
    }

    pub async fn prepare_deletion_context(&self) -> Result<WorkspaceDeletionContext, sqlx::Error> {
        let repositories =
            WorkspaceRepo::find_repos_for_workspace(&self.db.pool, self.workspace.id).await?;
        let session_ids = Session::find_by_workspace_id(&self.db.pool, self.workspace.id)
            .await?
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();
        let repo_paths = repositories
            .iter()
            .map(|repo| repo.path.clone())
            .collect::<Vec<_>>();

        Ok(WorkspaceDeletionContext {
            workspace_id: self.workspace.id,
            branch_name: self.workspace.branch.clone(),
            workspace_dir: self.workspace.container_ref.clone().map(PathBuf::from),
            repositories,
            repo_paths,
            session_ids,
        })
    }

    pub async fn delete_record(&self) -> Result<u64, sqlx::Error> {
        DbWorkspace::delete(&self.db.pool, self.workspace.id).await
    }
}

#[derive(Clone)]
pub struct WorkspaceManager {
    db: DBService,
}

impl WorkspaceManager {
    pub fn new(db: DBService) -> Self {
        Self { db }
    }

    pub async fn validate_repository_inputs(
        &self,
        repos: &[WorkspaceRepoInput],
        git: &GitService,
    ) -> Result<(), WorkspaceError> {
        let mut seen_repo_ids = HashSet::new();
        for repo_ref in repos {
            if !seen_repo_ids.insert(repo_ref.repo_id) {
                return Err(WorkspaceError::RepoAlreadyAttached);
            }
            Self::validate_repository_input(&self.db.pool, repo_ref, git).await?;
        }
        Ok(())
    }

    pub async fn validate_new_workspace_branch_name(
        &self,
        repos: &[WorkspaceRepoInput],
        branch_name: &str,
        git: &GitService,
    ) -> Result<(), WorkspaceError> {
        if !git.is_branch_name_valid(branch_name) {
            return Err(WorkspaceError::InvalidWorkspaceBranchName {
                branch: branch_name.to_string(),
            });
        }

        for repo_ref in repos.iter().filter(|repo_ref| repo_ref.create_branch) {
            let repo = Repo::find_by_id(&self.db.pool, repo_ref.repo_id)
                .await?
                .ok_or(RepoError::NotFound)?;

            if git.is_local_branch(&repo.path, branch_name)? {
                if let Some(path) = git.find_checkout_path_for_branch(&repo.path, branch_name)? {
                    return Err(WorkspaceError::WorkspaceBranchAlreadyCheckedOut {
                        repo_name: repo.name,
                        branch: branch_name.to_string(),
                        path,
                    });
                }
                return Err(WorkspaceError::WorkspaceBranchAlreadyExists {
                    repo_name: repo.name,
                    branch: branch_name.to_string(),
                });
            }
        }

        Ok(())
    }

    async fn validate_repository_input(
        pool: &sqlx::SqlitePool,
        repo_ref: &WorkspaceRepoInput,
        git: &GitService,
    ) -> Result<Repo, WorkspaceError> {
        let repo = Repo::find_by_id(pool, repo_ref.repo_id)
            .await?
            .ok_or(RepoError::NotFound)?;

        if !git.check_branch_exists(&repo.path, &repo_ref.target_branch)? {
            return Err(WorkspaceError::BranchNotFound {
                repo_name: repo.name.clone(),
                branch: repo_ref.target_branch.clone(),
            });
        }

        if !repo_ref.create_branch {
            let checkout_branch = repo_ref.checkout_branch.as_deref().ok_or_else(|| {
                WorkspaceError::DirectCheckoutBranchRequired {
                    repo_name: repo.name.clone(),
                }
            })?;

            Self::validate_direct_checkout_branch(
                &repo,
                checkout_branch,
                &repo_ref.target_branch,
                git,
            )?;
        }

        Ok(repo)
    }

    fn validate_direct_checkout_branch(
        repo: &Repo,
        checkout_branch: &str,
        target_branch: &str,
        git: &GitService,
    ) -> Result<(), WorkspaceError> {
        let target_is_remote =
            checkout_branch != target_branch && git.is_remote_branch(&repo.path, target_branch)?;
        if branch_names_conflict_as_self_target(checkout_branch, target_branch, target_is_remote) {
            return Err(WorkspaceError::DirectCheckoutBranchMatchesTarget {
                repo_name: repo.name.clone(),
            });
        }

        if !git.is_local_branch(&repo.path, checkout_branch)? {
            return Err(WorkspaceError::DirectCheckoutBranchNotLocal {
                repo_name: repo.name.clone(),
                branch: checkout_branch.to_string(),
            });
        }

        if let Some(path) = git.find_checkout_path_for_branch(&repo.path, checkout_branch)? {
            return Err(WorkspaceError::DirectCheckoutBranchAlreadyCheckedOut {
                repo_name: repo.name.clone(),
                branch: checkout_branch.to_string(),
                path,
            });
        }

        Ok(())
    }

    pub async fn load_managed_workspace(
        &self,
        workspace: DbWorkspace,
    ) -> Result<ManagedWorkspace, sqlx::Error> {
        let repos =
            WorkspaceRepo::find_repos_with_target_branch_for_workspace(&self.db.pool, workspace.id)
                .await?;
        Ok(ManagedWorkspace::new(self.db.clone(), workspace, repos))
    }

    pub fn spawn_workspace_deletion_cleanup(
        context: WorkspaceDeletionContext,
        delete_branches: bool,
    ) {
        tokio::spawn(async move {
            let WorkspaceDeletionContext {
                workspace_id,
                branch_name,
                workspace_dir,
                repositories,
                repo_paths,
                session_ids,
            } = context;

            for session_id in session_ids {
                if let Err(e) = Self::remove_session_process_logs(session_id).await {
                    warn!(
                        "Failed to remove filesystem process logs for session {}: {}",
                        session_id, e
                    );
                }
            }

            if let Some(workspace_dir) = workspace_dir {
                info!(
                    "Starting background cleanup for workspace {} at {}",
                    workspace_id,
                    workspace_dir.display()
                );

                if let Err(e) = Self::cleanup_workspace(&workspace_dir, &repositories).await {
                    error!(
                        "Background workspace cleanup failed for {} at {}: {}",
                        workspace_id,
                        workspace_dir.display(),
                        e
                    );
                } else {
                    info!(
                        "Background cleanup completed for workspace {}",
                        workspace_id
                    );
                }
            }

            if delete_branches {
                let git_service = GitService::new();
                for repo_path in repo_paths {
                    match git_service.delete_branch(&repo_path, &branch_name) {
                        Ok(()) => {
                            info!("Deleted branch '{}' from repo {:?}", branch_name, repo_path);
                        }
                        Err(e) => {
                            warn!(
                                "Failed to delete branch '{}' from repo {:?}: {}",
                                branch_name, repo_path, e
                            );
                        }
                    }
                }
            }
        });
    }

    async fn remove_session_process_logs(session_id: Uuid) -> Result<(), std::io::Error> {
        let dir = utils::execution_logs::process_logs_session_dir(session_id);
        match tokio::fs::remove_dir_all(&dir).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Create a workspace with worktrees for all repositories.
    /// On failure, rolls back any already-created worktrees.
    pub async fn create_workspace(
        workspace_dir: &Path,
        repos: &[RepoWorkspaceInput],
        branch_name: &str,
    ) -> Result<WorktreeContainer, WorkspaceError> {
        if repos.is_empty() {
            return Err(WorkspaceError::NoRepositories);
        }

        info!(
            "Creating workspace at {} with {} repositories",
            workspace_dir.display(),
            repos.len()
        );

        tokio::fs::create_dir_all(workspace_dir).await?;

        let mut created_worktrees: Vec<RepoWorktree> = Vec::new();

        for input in repos {
            let worktree_path = workspace_dir.join(&input.repo.name);

            debug!(
                "Creating worktree for repo '{}' at {}",
                input.repo.name,
                worktree_path.display()
            );

            match WorktreeManager::create_worktree(
                &input.repo.path,
                input.branch_name(branch_name),
                &worktree_path,
                &input.target_branch,
                input.create_branch,
            )
            .await
            {
                Ok(()) => {
                    created_worktrees.push(RepoWorktree {
                        repo_id: input.repo.id,
                        repo_name: input.repo.name.clone(),
                        source_repo_path: input.repo.path.clone(),
                        worktree_path,
                    });
                }
                Err(e) => {
                    error!(
                        "Failed to create worktree for repo '{}': {}. Rolling back...",
                        input.repo.name, e
                    );

                    // Rollback: cleanup all worktrees we've created so far
                    Self::cleanup_created_worktrees(&created_worktrees).await;

                    // Also remove the workspace directory if it's empty
                    if let Err(cleanup_err) = tokio::fs::remove_dir(workspace_dir).await {
                        debug!(
                            "Could not remove workspace dir during rollback: {}",
                            cleanup_err
                        );
                    }

                    return Err(WorkspaceError::PartialCreation(format!(
                        "Failed to create worktree for repo '{}': {}",
                        input.repo.name, e
                    )));
                }
            }
        }

        info!(
            "Successfully created workspace with {} worktrees",
            created_worktrees.len()
        );

        Ok(WorktreeContainer {
            workspace_dir: workspace_dir.to_path_buf(),
            worktrees: created_worktrees,
        })
    }

    /// Ensure all worktrees in a workspace exist (for cold restart scenarios)
    pub async fn ensure_workspace_exists(
        workspace_dir: &Path,
        repos: &[RepoWorkspaceInput],
        branch_name: &str,
    ) -> Result<(), WorkspaceError> {
        if repos.is_empty() {
            return Err(WorkspaceError::NoRepositories);
        }

        // Try legacy migration first (single repo projects only)
        // Old layout had worktree directly at workspace_dir; new layout has it at workspace_dir/{repo_name}
        if repos.len() == 1 && Self::migrate_legacy_worktree(workspace_dir, &repos[0].repo).await? {
            return Ok(());
        }

        if !workspace_dir.exists() {
            tokio::fs::create_dir_all(workspace_dir).await?;
        }

        let git = GitService::new();

        for input in repos {
            let repo = &input.repo;
            let worktree_path = workspace_dir.join(&repo.name);

            debug!(
                "Ensuring worktree exists for repo '{}' at {}",
                repo.name,
                worktree_path.display()
            );

            let branch_name = input.branch_name(branch_name);

            if git.check_branch_exists(&repo.path, branch_name)? {
                WorktreeManager::ensure_worktree_exists(&repo.path, branch_name, &worktree_path)
                    .await?;
            } else {
                info!(
                    "Workspace branch '{}' missing in repo '{}'; creating from target branch '{}'",
                    branch_name, repo.name, input.target_branch
                );
                WorktreeManager::create_worktree(
                    &repo.path,
                    branch_name,
                    &worktree_path,
                    &input.target_branch,
                    input.create_branch,
                )
                .await?;
            }
        }

        Ok(())
    }

    /// Clean up all worktrees in a workspace
    pub async fn cleanup_workspace(
        workspace_dir: &Path,
        repos: &[Repo],
    ) -> Result<(), WorkspaceError> {
        info!("Cleaning up workspace at {}", workspace_dir.display());

        let cleanup_data: Vec<WorktreeCleanup> = repos
            .iter()
            .map(|repo| {
                let worktree_path = workspace_dir.join(&repo.name);
                WorktreeCleanup::new(worktree_path, Some(repo.path.clone()))
            })
            .collect();

        WorktreeManager::batch_cleanup_worktrees(&cleanup_data).await?;

        // Remove the workspace directory itself
        if workspace_dir.exists()
            && let Err(e) = tokio::fs::remove_dir_all(workspace_dir).await
        {
            debug!(
                "Could not remove workspace directory {}: {}",
                workspace_dir.display(),
                e
            );
        }

        Ok(())
    }

    /// Get the base directory for workspaces (same as worktree base dir)
    pub fn get_workspace_base_dir() -> PathBuf {
        WorktreeManager::get_worktree_base_dir()
    }

    /// Migrate a legacy single-worktree layout to the new workspace layout.
    /// Old layout: workspace_dir IS the worktree
    /// New layout: workspace_dir contains worktrees at workspace_dir/{repo_name}
    ///
    /// Returns Ok(true) if migration was performed, Ok(false) if no migration needed.
    async fn migrate_legacy_worktree(
        workspace_dir: &Path,
        repo: &Repo,
    ) -> Result<bool, WorkspaceError> {
        let expected_worktree_path = workspace_dir.join(&repo.name);

        // Detect old-style: workspace_dir exists AND has .git file (worktree marker)
        // AND expected new location doesn't exist
        let git_file = workspace_dir.join(".git");
        let is_old_style = workspace_dir.exists()
            && git_file.exists()
            && git_file.is_file() // .git file = worktree, .git dir = main repo
            && !expected_worktree_path.exists();

        if !is_old_style {
            return Ok(false);
        }

        info!(
            "Detected legacy worktree at {}, migrating to new layout",
            workspace_dir.display()
        );

        // Move old worktree to temp location (can't move into subdirectory of itself)
        let temp_name = format!(
            "{}-migrating",
            workspace_dir
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default()
        );
        let temp_path = workspace_dir.with_file_name(temp_name);

        WorktreeManager::move_worktree(&repo.path, workspace_dir, &temp_path).await?;

        // Create new workspace directory
        tokio::fs::create_dir_all(workspace_dir).await?;

        // Move worktree to final location using git worktree move
        WorktreeManager::move_worktree(&repo.path, &temp_path, &expected_worktree_path).await?;

        if temp_path.exists() {
            let _ = tokio::fs::remove_dir_all(&temp_path).await;
        }

        info!(
            "Successfully migrated legacy worktree to {}",
            expected_worktree_path.display()
        );

        Ok(true)
    }

    /// Helper to cleanup worktrees during rollback
    async fn cleanup_created_worktrees(worktrees: &[RepoWorktree]) {
        for worktree in worktrees {
            let cleanup = WorktreeCleanup::new(
                worktree.worktree_path.clone(),
                Some(worktree.source_repo_path.clone()),
            );

            if let Err(e) = WorktreeManager::cleanup_worktree(&cleanup).await {
                error!(
                    "Failed to cleanup worktree '{}' during rollback: {}",
                    worktree.repo_name, e
                );
            }
        }
    }

    pub async fn cleanup_orphan_workspaces(&self) {
        if std::env::var("DISABLE_WORKTREE_CLEANUP").is_ok() {
            info!(
                "Orphan workspace cleanup is disabled via DISABLE_WORKTREE_CLEANUP environment variable"
            );
            return;
        }

        // Always clean up the default directory
        let default_dir = WorktreeManager::get_default_worktree_base_dir();
        self.cleanup_orphans_in_directory(&default_dir).await;

        // Also clean up custom directory if it's different from the default
        let current_dir = Self::get_workspace_base_dir();
        if current_dir != default_dir {
            self.cleanup_orphans_in_directory(&current_dir).await;
        }
    }

    async fn cleanup_orphans_in_directory(&self, workspace_base_dir: &Path) {
        if !workspace_base_dir.exists() {
            debug!(
                "Workspace base directory {} does not exist, skipping orphan cleanup",
                workspace_base_dir.display()
            );
            return;
        }

        let entries = match std::fs::read_dir(workspace_base_dir) {
            Ok(entries) => entries,
            Err(e) => {
                error!(
                    "Failed to read workspace base directory {}: {}",
                    workspace_base_dir.display(),
                    e
                );
                return;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    warn!("Failed to read directory entry: {}", e);
                    continue;
                }
            };

            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let workspace_path_str = path.to_string_lossy().to_string();
            if let Ok(false) =
                DbWorkspace::container_ref_exists(&self.db.pool, &workspace_path_str).await
            {
                info!("Found orphaned workspace: {}", workspace_path_str);
                if let Err(e) = Self::cleanup_workspace_without_repos(&path).await {
                    error!(
                        "Failed to remove orphaned workspace {}: {}",
                        workspace_path_str, e
                    );
                } else {
                    info!(
                        "Successfully removed orphaned workspace: {}",
                        workspace_path_str
                    );
                }
            }
        }
    }

    async fn cleanup_workspace_without_repos(workspace_dir: &Path) -> Result<(), WorkspaceError> {
        info!(
            "Cleaning up orphaned workspace at {}",
            workspace_dir.display()
        );

        let entries = match std::fs::read_dir(workspace_dir) {
            Ok(entries) => entries,
            Err(e) => {
                debug!(
                    "Cannot read workspace directory {}, attempting direct removal: {}",
                    workspace_dir.display(),
                    e
                );
                return tokio::fs::remove_dir_all(workspace_dir)
                    .await
                    .map_err(WorkspaceError::Io);
            }
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir()
                && let Err(e) = WorktreeManager::cleanup_suspected_worktree(&path).await
            {
                warn!("Failed to cleanup suspected worktree: {}", e);
            }
        }

        if workspace_dir.exists()
            && let Err(e) = tokio::fs::remove_dir_all(workspace_dir).await
        {
            debug!(
                "Could not remove workspace directory {}: {}",
                workspace_dir.display(),
                e
            );
        }

        Ok(())
    }
}

#[cfg(test)]
mod repository_attachment_tests {
    use std::{
        path::{Path, PathBuf},
        process::Command,
    };

    use db::{
        DBService,
        models::{
            repo::Repo,
            requests::WorkspaceRepoInput,
            workspace::{CreateWorkspace, Workspace},
            workspace_repo::WorkspaceRepo,
        },
    };
    use git::GitService;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;
    use uuid::Uuid;

    use super::{WorkspaceError, WorkspaceManager};

    async fn test_db() -> DBService {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        for statement in [
            r#"
            CREATE TABLE repos (
                id BLOB PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                setup_script TEXT,
                cleanup_script TEXT,
                archive_script TEXT,
                copy_files TEXT,
                parallel_setup_script INTEGER NOT NULL DEFAULT 0,
                dev_server_script TEXT,
                default_target_branch TEXT,
                default_working_dir TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                task_id BLOB,
                container_ref TEXT,
                branch TEXT NOT NULL,
                setup_completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                name TEXT,
                worktree_deleted BOOLEAN NOT NULL DEFAULT FALSE
            )
            "#,
            r#"
            CREATE TABLE workspace_repos (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                repo_id BLOB NOT NULL,
                target_branch TEXT NOT NULL,
                create_branch BOOLEAN NOT NULL DEFAULT TRUE,
                checkout_branch TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                UNIQUE (workspace_id, repo_id)
            )
            "#,
            r#"
            CREATE TABLE repo_dev_server_scripts (
                id BLOB PRIMARY KEY,
                repo_id BLOB NOT NULL,
                name TEXT NOT NULL,
                script TEXT NOT NULL,
                working_dir TEXT,
                is_default BOOLEAN NOT NULL DEFAULT FALSE,
                created_at DATETIME NOT NULL DEFAULT (datetime('now')),
                updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
            )
            "#,
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        DBService { pool }
    }

    fn init_git_repo(path: &Path) {
        GitService::new()
            .initialize_repo_with_main_branch(path)
            .unwrap();
    }

    fn create_branch(path: &Path, branch: &str) {
        GitService::new()
            .create_branch(path, branch, "main")
            .unwrap();
    }

    async fn create_repo(db: &DBService, path: PathBuf) -> Repo {
        Repo::find_or_create(&db.pool, &path, path.file_name().unwrap().to_str().unwrap())
            .await
            .unwrap()
    }

    async fn create_workspace(db: &DBService) -> Workspace {
        Workspace::create(
            &db.pool,
            &CreateWorkspace {
                branch: "vk/test-workspace".to_string(),
                name: Some("test workspace".to_string()),
            },
            Uuid::new_v4(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn exact_workspace_branch_name_allows_any_valid_git_ref() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        let repo = create_repo(&db, repo_path).await;

        WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "feature/human-picked-name",
                &GitService::new(),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn exact_workspace_branch_name_rejects_invalid_ref() {
        let db = test_db().await;
        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(&[], "bad..branch", &GitService::new())
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::InvalidWorkspaceBranchName { branch } if branch == "bad..branch"
        ));
    }

    #[tokio::test]
    async fn exact_workspace_branch_name_rejects_collision() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        create_branch(&repo_path, "feature/existing");
        let repo = create_repo(&db, repo_path).await;

        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "feature/existing",
                &GitService::new(),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::WorkspaceBranchAlreadyExists { repo_name, branch }
                if repo_name == "repo" && branch == "feature/existing"
        ));
    }

    #[tokio::test]
    async fn exact_workspace_branch_name_rejects_checked_out_elsewhere() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("other-worktree");
        init_git_repo(&repo_path);
        create_branch(&repo_path, "feature/in-use");
        let output = Command::new("git")
            .arg("-C")
            .arg(&repo_path)
            .arg("worktree")
            .arg("add")
            .arg(&worktree_path)
            .arg("feature/in-use")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let repo = create_repo(&db, repo_path).await;

        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "feature/in-use",
                &GitService::new(),
            )
            .await
            .unwrap_err();

        match error {
            WorkspaceError::WorkspaceBranchAlreadyCheckedOut { repo_name, branch, path } => {
                assert_eq!(repo_name, "repo");
                assert_eq!(branch, "feature/in-use");
                assert_eq!(path.canonicalize().unwrap(), worktree_path.canonicalize().unwrap());
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn add_repository_rejects_duplicate_repo_name() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let first_repo_path = temp_dir.path().join("first").join("same-name");
        let second_repo_path = temp_dir.path().join("second").join("same-name");
        init_git_repo(&first_repo_path);
        init_git_repo(&second_repo_path);
        let first_repo = create_repo(&db, first_repo_path).await;
        let second_repo = create_repo(&db, second_repo_path).await;
        assert_ne!(first_repo.id, second_repo.id);
        assert_eq!(first_repo.name, second_repo.name);

        let workspace = create_workspace(&db).await;
        let mut managed_workspace = WorkspaceManager::new(db.clone())
            .load_managed_workspace(workspace)
            .await
            .unwrap();

        managed_workspace
            .add_repository(
                &WorkspaceRepoInput {
                    repo_id: first_repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                },
                &GitService::new(),
            )
            .await
            .unwrap();

        let error = managed_workspace
            .add_repository(
                &WorkspaceRepoInput {
                    repo_id: second_repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                },
                &GitService::new(),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::RepoNameAlreadyAttached { repo_name } if repo_name == "same-name"
        ));
        let attached =
            WorkspaceRepo::find_by_workspace_id(&db.pool, managed_workspace.workspace.id)
                .await
                .unwrap();
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].repo_id, first_repo.id);
    }

    #[tokio::test]
    async fn add_repository_rejects_case_variant_repo_name() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let first_repo_path = temp_dir.path().join("first").join("Same-Name");
        let second_repo_path = temp_dir.path().join("second").join("same-name");
        init_git_repo(&first_repo_path);
        init_git_repo(&second_repo_path);
        let first_repo = create_repo(&db, first_repo_path).await;
        let second_repo = create_repo(&db, second_repo_path).await;
        assert_ne!(first_repo.id, second_repo.id);
        assert_ne!(first_repo.name, second_repo.name);
        assert_eq!(
            first_repo.name.to_lowercase(),
            second_repo.name.to_lowercase()
        );

        let workspace = create_workspace(&db).await;
        let mut managed_workspace = WorkspaceManager::new(db.clone())
            .load_managed_workspace(workspace)
            .await
            .unwrap();

        managed_workspace
            .add_repository(
                &WorkspaceRepoInput {
                    repo_id: first_repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                },
                &GitService::new(),
            )
            .await
            .unwrap();

        let error = managed_workspace
            .add_repository(
                &WorkspaceRepoInput {
                    repo_id: second_repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                },
                &GitService::new(),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::RepoNameAlreadyAttached { repo_name } if repo_name == "same-name"
        ));
        let attached =
            WorkspaceRepo::find_by_workspace_id(&db.pool, managed_workspace.workspace.id)
                .await
                .unwrap();
        assert_eq!(attached.len(), 1);
        assert_eq!(attached[0].repo_id, first_repo.id);
    }

    #[tokio::test]
    async fn validate_new_workspace_branch_rejects_invalid_ref() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        init_git_repo(&repo_path);
        let repo = create_repo(&db, repo_path).await;

        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "bad..branch",
                &GitService::new(),
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::InvalidWorkspaceBranchName { branch } if branch == "bad..branch"
        ));
    }

    #[tokio::test]
    async fn validate_new_workspace_branch_rejects_existing_branch() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        let git = GitService::new();
        init_git_repo(&repo_path);
        git.create_branch(&repo_path, "feature/exact", "main")
            .unwrap();
        let repo = create_repo(&db, repo_path).await;

        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "feature/exact",
                &git,
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            WorkspaceError::WorkspaceBranchAlreadyExists { repo_name, branch }
                if repo_name == "repo" && branch == "feature/exact"
        ));
    }

    #[tokio::test]
    async fn validate_new_workspace_branch_rejects_checked_out_branch() {
        let db = test_db().await;
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktree");
        let git = GitService::new();
        init_git_repo(&repo_path);
        git.create_branch(&repo_path, "feature/exact", "main")
            .unwrap();
        git.add_worktree(&repo_path, &worktree_path, "feature/exact", false)
            .unwrap();
        let repo = create_repo(&db, repo_path).await;

        let error = WorkspaceManager::new(db)
            .validate_new_workspace_branch_name(
                &[WorkspaceRepoInput {
                    repo_id: repo.id,
                    target_branch: "main".to_string(),
                    create_branch: true,
                    checkout_branch: None,
                }],
                "feature/exact",
                &git,
            )
            .await
            .unwrap_err();

        match error {
            WorkspaceError::WorkspaceBranchAlreadyCheckedOut { repo_name, branch, path } => {
                assert_eq!(repo_name, "repo");
                assert_eq!(branch, "feature/exact");
                assert_eq!(path.canonicalize().unwrap(), worktree_path.canonicalize().unwrap());
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
