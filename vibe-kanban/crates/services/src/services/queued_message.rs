use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::{DashMap, mapref::entry::Entry};
use db::models::scratch::DraftFollowUpData;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

/// Represents a queued follow-up message for a session
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct QueuedMessage {
    /// Stable caller-supplied identity for idempotency and reconciliation.
    pub id: Uuid,
    /// Caller namespace that owns cancellation and amendment.
    pub owner: String,
    /// The session this message is queued for
    pub session_id: Uuid,
    /// The follow-up data (message + variant)
    pub data: DraftFollowUpData,
    /// Hash of the exact caller-requested payload, before executor derivation.
    pub requested_payload_fingerprint: String,
    /// Timestamp when the message was queued
    pub queued_at: DateTime<Utc>,
}

/// Status of the queue for a session (for frontend display)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QueueStatus {
    /// No message queued
    Empty,
    /// Message is queued and waiting for execution to complete
    Queued { message: QueuedMessage },
    /// Message has been claimed for execution and can no longer be changed.
    Consuming { message: QueuedMessage },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum QueueError {
    #[error("session queue is occupied by message {id} owned by {owner}")]
    Occupied { id: Uuid, owner: String },
    #[error("queue identity {id} conflicts with its existing owner or payload")]
    IdentityConflict { id: Uuid },
    #[error("queued message {id} has already been consumed or is no longer queued")]
    TooLate { id: Uuid },
}

#[derive(Debug, Clone)]
pub enum QueueClaim {
    Claimed(QueuedMessage),
    Consuming(QueuedMessage),
}

#[derive(Debug, Clone)]
struct QueueSlot {
    message: QueuedMessage,
    consuming: bool,
}

/// In-memory service for managing queued follow-up messages.
/// One queued message per session.
#[derive(Clone)]
pub struct QueuedMessageService {
    queue: Arc<DashMap<Uuid, QueueSlot>>,
}

impl QueuedMessageService {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(DashMap::new()),
        }
    }

    /// Atomically enqueue without replacing another caller's intent.
    pub fn queue_message(
        &self,
        session_id: Uuid,
        id: Uuid,
        owner: String,
        data: DraftFollowUpData,
    ) -> Result<QueueStatus, QueueError> {
        let requested_payload_fingerprint = requested_payload_fingerprint(&data);
        let queued = QueuedMessage {
            id,
            owner,
            session_id,
            data,
            requested_payload_fingerprint,
            queued_at: Utc::now(),
        };
        match self.queue.entry(session_id) {
            Entry::Vacant(entry) => {
                entry.insert(QueueSlot {
                    message: queued.clone(),
                    consuming: false,
                });
                Ok(QueueStatus::Queued { message: queued })
            }
            Entry::Occupied(entry) => {
                let existing = &entry.get().message;
                if existing.id == queued.id {
                    if existing.owner == queued.owner && same_data(&existing.data, &queued.data) {
                        Ok(if entry.get().consuming {
                            QueueStatus::Consuming {
                                message: existing.clone(),
                            }
                        } else {
                            QueueStatus::Queued {
                                message: existing.clone(),
                            }
                        })
                    } else {
                        Err(QueueError::IdentityConflict { id })
                    }
                } else {
                    Err(QueueError::Occupied {
                        id: existing.id,
                        owner: existing.owner.clone(),
                    })
                }
            }
        }
    }

    /// Cancel only the named, still-queued message.
    pub fn cancel_queued(
        &self,
        session_id: Uuid,
        id: Uuid,
        owner: &str,
    ) -> Result<QueuedMessage, QueueError> {
        match self.queue.entry(session_id) {
            Entry::Vacant(_) => Err(QueueError::TooLate { id }),
            Entry::Occupied(entry) => {
                check_identity(&entry.get().message, id, owner)?;
                if entry.get().consuming {
                    return Err(QueueError::TooLate { id });
                }
                Ok(entry.remove().message)
            }
        }
    }

    /// Amend only the named, still-queued message.
    pub fn amend_queued(
        &self,
        session_id: Uuid,
        id: Uuid,
        owner: &str,
        data: DraftFollowUpData,
    ) -> Result<QueuedMessage, QueueError> {
        match self.queue.entry(session_id) {
            Entry::Vacant(_) => Err(QueueError::TooLate { id }),
            Entry::Occupied(mut entry) => {
                check_identity(&entry.get().message, id, owner)?;
                if entry.get().consuming {
                    return Err(QueueError::TooLate { id });
                }
                entry.get_mut().message.data = data;
                entry.get_mut().message.queued_at = Utc::now();
                Ok(entry.get().message.clone())
            }
        }
    }

    /// Get the queued message for a session (if any)
    pub fn get_queued(&self, session_id: Uuid) -> Option<QueuedMessage> {
        self.queue.get(&session_id).map(|r| r.message.clone())
    }

    /// Claim a message for execution without losing it before admission succeeds.
    pub fn claim_queued(&self, session_id: Uuid) -> Option<QueuedMessage> {
        let mut entry = self.queue.get_mut(&session_id)?;
        if entry.consuming {
            return None;
        }
        entry.consuming = true;
        Some(entry.message.clone())
    }

    /// Claim only the exact immutable queue intent. An exact consuming replay
    /// is reported separately so a second caller can reconcile but never start.
    pub fn claim_queued_identity(
        &self,
        session_id: Uuid,
        id: Uuid,
        owner: &str,
        data: &DraftFollowUpData,
    ) -> Result<QueueClaim, QueueError> {
        match self.queue.entry(session_id) {
            Entry::Vacant(_) => Err(QueueError::TooLate { id }),
            Entry::Occupied(mut entry) => {
                check_identity(&entry.get().message, id, owner)?;
                if !same_data(&entry.get().message.data, data) {
                    return Err(QueueError::IdentityConflict { id });
                }
                if entry.get().consuming {
                    return Ok(QueueClaim::Consuming(entry.get().message.clone()));
                }
                entry.get_mut().consuming = true;
                Ok(QueueClaim::Claimed(entry.get().message.clone()))
            }
        }
    }

    /// Return an exact consuming intent for a DB-proven failed-before-start
    /// retry. Durable queue-effect reservation remains the single start winner.
    pub fn retry_consuming_identity(
        &self,
        session_id: Uuid,
        id: Uuid,
        owner: &str,
        data: &DraftFollowUpData,
    ) -> Result<QueuedMessage, QueueError> {
        let entry = self
            .queue
            .get(&session_id)
            .ok_or(QueueError::TooLate { id })?;
        check_identity(&entry.message, id, owner)?;
        if !entry.consuming || !same_data(&entry.message.data, data) {
            return Err(QueueError::IdentityConflict { id });
        }
        Ok(entry.message.clone())
    }

    pub fn release_claim(&self, session_id: Uuid, id: Uuid) {
        if let Some(mut entry) = self.queue.get_mut(&session_id)
            && entry.message.id == id
        {
            entry.consuming = false;
        }
    }

    pub fn complete_claim(&self, session_id: Uuid, id: Uuid) -> Result<QueuedMessage, QueueError> {
        match self.queue.entry(session_id) {
            Entry::Vacant(_) => Err(QueueError::TooLate { id }),
            Entry::Occupied(entry) => {
                if entry.get().message.id != id || !entry.get().consuming {
                    return Err(QueueError::TooLate { id });
                }
                Ok(entry.remove().message)
            }
        }
    }

    /// Check if a session has a queued message
    pub fn has_queued(&self, session_id: Uuid) -> bool {
        self.queue.contains_key(&session_id)
    }

    /// Get queue status for frontend display
    pub fn get_status(&self, session_id: Uuid) -> QueueStatus {
        match self.queue.get(&session_id) {
            Some(slot) if slot.consuming => QueueStatus::Consuming {
                message: slot.message.clone(),
            },
            Some(slot) => QueueStatus::Queued {
                message: slot.message.clone(),
            },
            None => QueueStatus::Empty,
        }
    }
}

fn same_data(left: &DraftFollowUpData, right: &DraftFollowUpData) -> bool {
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

/// Fingerprint the caller-requested queue payload before it is expanded into
/// executor continuity and cleanup actions.
pub fn requested_payload_fingerprint(data: &DraftFollowUpData) -> String {
    let bytes = serde_json::to_vec(data).expect("DraftFollowUpData must serialize");
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn check_identity(message: &QueuedMessage, id: Uuid, owner: &str) -> Result<(), QueueError> {
    if message.id == id && message.owner == owner {
        Ok(())
    } else {
        Err(QueueError::IdentityConflict { id })
    }
}

impl Default for QueuedMessageService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use executors::{executors::BaseCodingAgent, profile::ExecutorConfig};

    use super::*;

    fn data(message: &str) -> DraftFollowUpData {
        DraftFollowUpData {
            message: message.to_string(),
            executor_config: ExecutorConfig::new(BaseCodingAgent::Codex),
            session_command: None,
        }
    }

    #[test]
    fn enqueue_is_idempotent_but_never_replaces() {
        let service = QueuedMessageService::new();
        let session = Uuid::new_v4();
        let id = Uuid::new_v4();
        let first = service
            .queue_message(session, id, "workflow".into(), data("one"))
            .unwrap();
        assert!(matches!(first, QueueStatus::Queued { .. }));
        assert!(matches!(
            service
                .queue_message(session, id, "workflow".into(), data("one"))
                .unwrap(),
            QueueStatus::Queued { .. }
        ));
        assert!(matches!(
            service.queue_message(session, id, "workflow".into(), data("changed")),
            Err(QueueError::IdentityConflict { .. })
        ));
        assert!(matches!(
            service.queue_message(session, id, "other-owner".into(), data("one")),
            Err(QueueError::IdentityConflict { .. })
        ));
        assert!(matches!(
            service.queue_message(session, Uuid::new_v4(), "ui".into(), data("other")),
            Err(QueueError::Occupied { .. })
        ));
        assert_eq!(service.get_queued(session).unwrap().data.message, "one");
    }

    #[test]
    fn cancel_and_amend_lose_to_consumption() {
        let service = QueuedMessageService::new();
        let session = Uuid::new_v4();
        let id = Uuid::new_v4();
        service
            .queue_message(session, id, "callback".into(), data("one"))
            .unwrap();
        assert_eq!(
            service
                .amend_queued(session, id, "callback", data("two"))
                .unwrap()
                .data
                .message,
            "two"
        );
        assert_eq!(service.claim_queued(session).unwrap().id, id);
        assert!(matches!(
            service.get_status(session),
            QueueStatus::Consuming { .. }
        ));
        service
            .queue_message(session, id, "callback".into(), data("two"))
            .unwrap();
        assert!(matches!(
            service.get_status(session),
            QueueStatus::Consuming { .. }
        ));
        assert!(matches!(
            service.cancel_queued(session, id, "callback"),
            Err(QueueError::TooLate { .. })
        ));
        assert!(matches!(
            service.amend_queued(session, id, "callback", data("three")),
            Err(QueueError::TooLate { .. })
        ));
        service.release_claim(session, id);
        assert_eq!(
            service.cancel_queued(session, id, "callback").unwrap().id,
            id
        );
    }

    #[test]
    fn exact_claim_has_one_starter_and_consuming_replays_never_reclaim() {
        let service = QueuedMessageService::new();
        let session = Uuid::new_v4();
        let id = Uuid::new_v4();
        let payload = data("one");
        service
            .queue_message(session, id, "workflow".into(), payload.clone())
            .unwrap();
        assert!(matches!(
            service.claim_queued_identity(session, id, "workflow", &payload),
            Ok(QueueClaim::Claimed(_))
        ));
        assert!(matches!(
            service.claim_queued_identity(session, id, "workflow", &payload),
            Ok(QueueClaim::Consuming(_))
        ));
        assert_eq!(
            service
                .retry_consuming_identity(session, id, "workflow", &payload)
                .unwrap()
                .id,
            id
        );
        assert!(matches!(
            service.claim_queued_identity(session, id, "other", &payload),
            Err(QueueError::IdentityConflict { .. })
        ));
        assert!(matches!(
            service.claim_queued_identity(session, id, "workflow", &data("changed")),
            Err(QueueError::IdentityConflict { .. })
        ));
    }

    #[test]
    fn concurrent_enqueue_has_one_winner() {
        let service = Arc::new(QueuedMessageService::new());
        let session = Uuid::new_v4();
        let barrier = Arc::new(Barrier::new(3));
        let handles = ["one", "two"].map(|message| {
            let service = service.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                service.queue_message(session, Uuid::new_v4(), message.into(), data(message))
            })
        });
        barrier.wait();
        let results = handles.map(|handle| handle.join().unwrap());
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(QueueError::Occupied { .. })))
                .count(),
            1
        );
    }
}
