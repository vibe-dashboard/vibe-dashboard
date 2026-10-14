use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum RunConfigKind {
    LongRunning,
    OneShot,
    Test,
}

impl RunConfigKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LongRunning => "long_running",
            Self::OneShot => "one_shot",
            Self::Test => "test",
        }
    }
}

impl TryFrom<String> for RunConfigKind {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "long_running" => Ok(Self::LongRunning),
            "one_shot" => Ok(Self::OneShot),
            "test" => Ok(Self::Test),
            other => Err(format!("unknown run config kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RunConfig {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub slug: String,
    pub name: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub kind: RunConfigKind,
    pub enabled: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
struct RunConfigRow {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub slug: String,
    pub name: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub kind: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl TryFrom<RunConfigRow> for RunConfig {
    type Error = sqlx::Error;

    fn try_from(value: RunConfigRow) -> Result<Self, Self::Error> {
        let kind = RunConfigKind::try_from(value.kind).map_err(|err| {
            sqlx::Error::Decode(std::io::Error::new(std::io::ErrorKind::InvalidData, err).into())
        })?;
        Ok(Self {
            id: value.id,
            repo_id: value.repo_id,
            slug: value.slug,
            name: value.name,
            command: value.command,
            working_dir: value.working_dir,
            kind,
            enabled: value.enabled,
            created_at: value.created_at,
            updated_at: value.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpsertRunConfig {
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<Uuid>,
    pub repo_id: Uuid,
    pub slug: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub working_dir: Option<String>,
    pub kind: RunConfigKind,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

impl RunConfig {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, RunConfigRow>(
            r#"SELECT id, repo_id, slug, name, command, working_dir, kind, enabled, created_at, updated_at
               FROM run_configs
               WHERE id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    pub async fn find_by_repo_id(
        pool: &SqlitePool,
        repo_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, RunConfigRow>(
            r#"SELECT id, repo_id, slug, name, command, working_dir, kind, enabled, created_at, updated_at
               FROM run_configs
               WHERE repo_id = ?
               ORDER BY name ASC, created_at ASC"#,
        )
        .bind(repo_id)
        .fetch_all(pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    pub async fn upsert(pool: &SqlitePool, input: &UpsertRunConfig) -> Result<Self, sqlx::Error> {
        let id = input.id.unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            r#"INSERT INTO run_configs
               (id, repo_id, slug, name, command, working_dir, kind, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 repo_id = excluded.repo_id,
                 slug = excluded.slug,
                 name = excluded.name,
                 command = excluded.command,
                 working_dir = excluded.working_dir,
                 kind = excluded.kind,
                 enabled = excluded.enabled,
                 updated_at = datetime('now')"#,
        )
        .bind(id)
        .bind(input.repo_id)
        .bind(&input.slug)
        .bind(&input.name)
        .bind(&input.command)
        .bind(&input.working_dir)
        .bind(input.kind.as_str())
        .bind(input.enabled)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }
}
