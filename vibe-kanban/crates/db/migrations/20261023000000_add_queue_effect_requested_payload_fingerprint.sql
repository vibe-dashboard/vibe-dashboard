-- Existing queue effects predate payload binding. They cannot be safely replayed:
-- retain them as indeterminate tombstones so a delayed request can never start
-- different work under the old queue identity.
ALTER TABLE execution_process_queue_effects
ADD COLUMN requested_payload_fingerprint TEXT;

UPDATE execution_process_queue_effects
SET lifecycle = 'indeterminate',
    requested_payload_fingerprint = 'legacy:unknown'
WHERE requested_payload_fingerprint IS NULL;
