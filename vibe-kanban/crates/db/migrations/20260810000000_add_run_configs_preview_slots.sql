CREATE TABLE run_configs (
    id BLOB PRIMARY KEY,
    repo_id BLOB NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    working_dir TEXT,
    kind TEXT NOT NULL DEFAULT 'long_running'
        CHECK (kind IN ('long_running', 'one_shot', 'test')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repo_id, slug)
);

CREATE INDEX idx_run_configs_repo_id
    ON run_configs(repo_id);

CREATE TABLE preview_slots (
    id BLOB PRIMARY KEY,
    repo_id BLOB NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    run_config_id BLOB NOT NULL REFERENCES run_configs(id) ON DELETE CASCADE,
    slot_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repo_id, slot_slug)
);

CREATE INDEX idx_preview_slots_repo_id
    ON preview_slots(repo_id);

CREATE INDEX idx_preview_slots_run_config_id
    ON preview_slots(run_config_id);

CREATE TABLE preview_process_links (
    id BLOB PRIMARY KEY,
    workspace_id BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repo_id BLOB NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    run_config_id BLOB NOT NULL REFERENCES run_configs(id) ON DELETE CASCADE,
    preview_slot_id BLOB REFERENCES preview_slots(id) ON DELETE SET NULL,
    execution_process_id BLOB NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
    assigned_port INTEGER NOT NULL,
    status_snapshot TEXT NOT NULL DEFAULT 'starting'
        CHECK (status_snapshot IN ('starting', 'ready', 'failed', 'stopped')),
    started_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    ended_at DATETIME
);

CREATE INDEX idx_preview_process_links_workspace_slot_active
    ON preview_process_links(workspace_id, preview_slot_id, ended_at);

CREATE INDEX idx_preview_process_links_workspace_config_active
    ON preview_process_links(workspace_id, run_config_id, ended_at);

CREATE TABLE workspace_preview_tokens (
    workspace_id BLOB PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE repo_preview_slugs (
    repo_id BLOB PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE run_config_audit_events (
    id BLOB PRIMARY KEY,
    workspace_id BLOB REFERENCES workspaces(id) ON DELETE SET NULL,
    repo_id BLOB REFERENCES repos(id) ON DELETE SET NULL,
    run_config_id BLOB REFERENCES run_configs(id) ON DELETE SET NULL,
    preview_slot_id BLOB REFERENCES preview_slots(id) ON DELETE SET NULL,
    execution_process_id BLOB REFERENCES execution_processes(id) ON DELETE SET NULL,
    actor TEXT NOT NULL DEFAULT 'backend',
    event_type TEXT NOT NULL,
    details_json TEXT,
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_run_config_audit_events_config_created
    ON run_config_audit_events(run_config_id, created_at DESC);
