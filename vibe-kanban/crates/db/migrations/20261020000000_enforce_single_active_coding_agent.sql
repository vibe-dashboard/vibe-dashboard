-- Fail closed if an existing database already contains overlapping coding-agent
-- turns. Operators must resolve those rows before this invariant can be enabled;
-- silently choosing a winner would destroy execution history.
CREATE UNIQUE INDEX idx_execution_processes_one_running_coding_agent_per_session
ON execution_processes (session_id)
WHERE status = 'running' AND run_reason = 'codingagent';

-- Queue storage remains deliberately in memory. This table records only the
-- durable effect-to-process identity needed to reconcile uncertain acceptance.
CREATE TABLE execution_process_queue_effects (
    queue_id BLOB PRIMARY KEY NOT NULL,
    execution_process_id BLOB NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (execution_process_id) REFERENCES execution_processes(id) ON DELETE CASCADE
);
