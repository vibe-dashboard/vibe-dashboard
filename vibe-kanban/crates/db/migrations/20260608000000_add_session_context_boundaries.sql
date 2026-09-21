ALTER TABLE sessions
    ADD COLUMN context_reset_execution_process_id BLOB
    REFERENCES execution_processes(id) ON DELETE SET NULL;
