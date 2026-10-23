-- sqlx-sqlite wraps migrations in a transaction. End it so SQLite can disable
-- foreign keys while rebuilding a referenced table, then restore one for sqlx.
COMMIT;
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE preview_slots_new (
    id BLOB PRIMARY KEY,
    repo_id BLOB NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL DEFAULT 'local_run_config'
        CHECK (target_type IN ('local_run_config', 'external_redirect')),
    run_config_id BLOB REFERENCES run_configs(id) ON DELETE CASCADE,
    external_url_template TEXT,
    external_project_slug TEXT,
    external_allowed_host_template TEXT,
    slot_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repo_id, slot_slug),
    CHECK (
        (target_type = 'local_run_config'
            AND run_config_id IS NOT NULL
            AND external_url_template IS NULL
            AND external_project_slug IS NULL
            AND external_allowed_host_template IS NULL)
        OR
        (target_type = 'external_redirect'
            AND run_config_id IS NULL
            AND external_url_template IS NOT NULL
            AND external_allowed_host_template IS NOT NULL)
    )
);

INSERT INTO preview_slots_new (
    id, repo_id, target_type, run_config_id, slot_slug, title, description,
    enabled, created_at, updated_at
)
SELECT
    id, repo_id, 'local_run_config', run_config_id, slot_slug, title,
    description, enabled, created_at, updated_at
FROM preview_slots;

DROP TABLE preview_slots;
ALTER TABLE preview_slots_new RENAME TO preview_slots;

CREATE INDEX idx_preview_slots_repo_id ON preview_slots(repo_id);
CREATE INDEX idx_preview_slots_run_config_id ON preview_slots(run_config_id);

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
