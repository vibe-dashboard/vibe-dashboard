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
    owner TEXT NOT NULL,
    execution_process_id BLOB NOT NULL UNIQUE,
    session_id BLOB NOT NULL,
    run_reason TEXT NOT NULL,
    executor_action TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('reserved', 'started', 'failed_before_start', 'indeterminate')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
