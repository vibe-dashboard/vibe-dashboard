CREATE TABLE repo_dev_server_scripts (
    id BLOB PRIMARY KEY,
    repo_id BLOB NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    script TEXT NOT NULL,
    working_dir TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_repo_dev_server_scripts_repo_id
    ON repo_dev_server_scripts(repo_id);

CREATE UNIQUE INDEX idx_repo_dev_server_scripts_default_per_repo
    ON repo_dev_server_scripts(repo_id)
    WHERE is_default = TRUE;

INSERT INTO repo_dev_server_scripts (id, repo_id, name, script, working_dir, is_default, created_at, updated_at)
SELECT randomblob(16),
       id,
       'Default',
       dev_server_script,
       NULL,
       TRUE,
       created_at,
       updated_at
FROM repos
WHERE dev_server_script IS NOT NULL
  AND trim(dev_server_script) != '';
