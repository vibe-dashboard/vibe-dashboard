use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRunConfigAuditEvent {
    pub workspace_id: Option<Uuid>,
    pub repo_id: Option<Uuid>,
    pub run_config_id: Option<Uuid>,
    pub preview_slot_id: Option<Uuid>,
    pub execution_process_id: Option<Uuid>,
    pub actor: String,
    pub event_type: String,
    pub details_json: Option<String>,
}

pub struct RunConfigAuditEvent;

impl RunConfigAuditEvent {
    pub async fn create(
        pool: &SqlitePool,
        input: &CreateRunConfigAuditEvent,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"INSERT INTO run_config_audit_events
               (id, workspace_id, repo_id, run_config_id, preview_slot_id, execution_process_id, actor, event_type, details_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(Uuid::new_v4())
        .bind(input.workspace_id)
        .bind(input.repo_id)
        .bind(input.run_config_id)
        .bind(input.preview_slot_id)
        .bind(input.execution_process_id)
        .bind(&input.actor)
        .bind(&input.event_type)
        .bind(&input.details_json)
        .execute(pool)
        .await?;
        Ok(())
    }
}
