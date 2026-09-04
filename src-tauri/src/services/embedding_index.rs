use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::db;

use super::{
    embedding::{
        EmbeddingProviderSettings, EmbeddingService, EmbeddingServiceError, RemoteEmbeddingBatch,
    },
    note_synthesis::stable_provider_hash,
    vector_retrieval::{
        complete_profile_for_execution, read_pending_documents,
        upsert_embedding_batch_for_execution, EmbeddedDocument,
    },
};

const PROVIDER_KIND: &str = "openai-compatible";
const NORMALIZATION_VERSION: &str = "retrieval-text-v1";
const CHUNKING_VERSION: &str = "document-v1";
const CONTENT_HASH_VERSION: &str = "sha256-v1";
const EXECUTION_LEASE_SECONDS: u64 = 90;
static PROFILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static EXECUTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

type EmbeddingRequestFuture = Pin<
    Box<dyn Future<Output = Result<RemoteEmbeddingBatch, EmbeddingServiceError>> + Send + 'static>,
>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingIndexProfile {
    pub id: String,
    pub provider_kind: String,
    pub model_id: String,
    pub dimensions: usize,
    pub provider_label: Option<String>,
    pub consent_confirmed_at: Option<String>,
    pub status: String,
    pub total_document_count: usize,
    pub indexed_document_count: usize,
    pub cancel_requested_at: Option<String>,
    pub last_started_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub worker_active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingIndexState {
    pub active: Option<EmbeddingIndexProfile>,
    pub ready: Option<EmbeddingIndexProfile>,
    pub latest: Option<EmbeddingIndexProfile>,
}

#[derive(Debug, Clone)]
pub enum EmbeddingIndexError {
    InvalidRequest(String),
    InvalidState(String),
    NotFound(String),
    Provider(EmbeddingServiceError),
    Storage(String),
}

impl EmbeddingIndexError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_embedding_index_request",
            Self::InvalidState(_) => "invalid_embedding_index_state",
            Self::NotFound(_) => "embedding_index_not_found",
            Self::Provider(error) => error.code(),
            Self::Storage(_) => "embedding_index_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidRequest(message)
            | Self::InvalidState(message)
            | Self::NotFound(message) => message.clone(),
            Self::Provider(error) => error.user_message(),
            Self::Storage(_) => "本地语义索引状态暂时不可用，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl std::fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct EmbeddingIndexService {
    app: AppHandle,
}

impl EmbeddingIndexService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn state(&self) -> Result<EmbeddingIndexState, EmbeddingIndexError> {
        read_index_state(&self.open_connection()?)
    }

    pub async fn start(&self) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
        let embedding = EmbeddingService::new(self.app.clone());
        let settings_state = embedding
            .settings_state()
            .map_err(EmbeddingIndexError::Provider)?;
        let settings = settings_state.provider;
        let probe = embedding
            .test_connection(None, Some(settings.clone()))
            .await
            .map_err(EmbeddingIndexError::Provider)?;
        let profile_id = next_profile_id(&settings.model);
        let execution_id = next_execution_id(&profile_id);
        let now = current_unix_seconds();
        create_remote_profile(
            &self.open_connection()?,
            &profile_id,
            &settings,
            probe.dimensions,
            &now,
            &execution_id,
        )?;
        self.run(&profile_id, &execution_id, &settings).await
    }

    pub async fn resume(
        &self,
        profile_id: &str,
    ) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
        let embedding = EmbeddingService::new(self.app.clone());
        let settings = embedding
            .settings_state()
            .map_err(EmbeddingIndexError::Provider)?
            .provider;
        let execution_id = next_execution_id(profile_id);
        resume_profile(
            &self.open_connection()?,
            profile_id,
            &settings,
            &execution_id,
        )?;
        self.run(profile_id, &execution_id, &settings).await
    }

    pub fn request_cancel(
        &self,
        profile_id: &str,
    ) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
        request_profile_cancel(&self.open_connection()?, profile_id)
    }

    pub fn clear(
        &self,
        profile_id: Option<&str>,
        confirm: bool,
    ) -> Result<EmbeddingIndexState, EmbeddingIndexError> {
        clear_profiles(&self.open_connection()?, profile_id, confirm)
    }

    async fn run(
        &self,
        profile_id: &str,
        execution_id: &str,
        settings: &EmbeddingProviderSettings,
    ) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
        let app = self.app.clone();
        run_index_with(
            || self.open_connection(),
            profile_id,
            execution_id,
            settings,
            move |inputs| {
                let embedding = EmbeddingService::new(app.clone());
                let settings = settings.clone();
                Box::pin(async move { embedding.embed_authorized_notes(&settings, &inputs).await })
            },
        )
        .await
    }

    fn open_connection(&self) -> Result<Connection, EmbeddingIndexError> {
        db::open_connection(&self.app).map_err(EmbeddingIndexError::Storage)
    }
}

pub(crate) fn read_index_state(
    connection: &Connection,
) -> Result<EmbeddingIndexState, EmbeddingIndexError> {
    Ok(EmbeddingIndexState {
        active: read_latest_profile(connection, Some("building"))?,
        ready: read_latest_profile(connection, Some("ready"))?,
        latest: read_latest_profile(connection, None)?,
    })
}

fn create_remote_profile(
    connection: &Connection,
    profile_id: &str,
    settings: &EmbeddingProviderSettings,
    dimensions: usize,
    now: &str,
    execution_id: &str,
) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
    require_authorized_settings(settings)?;
    if dimensions == 0 {
        return Err(EmbeddingIndexError::InvalidRequest(
            "Embedding 向量维度必须大于零。".to_string(),
        ));
    }
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM retrieval_documents WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(EmbeddingIndexError::storage)?;
    if total <= 0 {
        return Err(EmbeddingIndexError::InvalidState(
            "当前没有可建立语义索引的笔记。".to_string(),
        ));
    }
    let active_worker_count = connection
        .query_row(
            "SELECT COUNT(*) FROM retrieval_index_profiles
             WHERE status IN ('building', 'cancelled')
               AND execution_id IS NOT NULL
               AND lease_expires_at IS NOT NULL
               AND CAST(lease_expires_at AS INTEGER) > CAST(?1 AS INTEGER)",
            [now],
            |row| row.get::<_, i64>(0),
        )
        .map_err(EmbeddingIndexError::storage)?;
    if active_worker_count > 0 {
        return Err(EmbeddingIndexError::InvalidState(
            "已有语义索引任务正在收尾，请稍后再开始新的构建。".to_string(),
        ));
    }
    let lease_expires_at = lease_expires_at(now);
    connection
        .execute(
            "INSERT INTO retrieval_index_profiles (
                id, provider_kind, model_id, dimensions, distance_metric,
                normalization_version, chunking_version, content_hash_version,
                provider_base_url_hash, provider_label, consent_confirmed_at,
                status, total_document_count, indexed_document_count,
                last_started_at, execution_id, heartbeat_at, lease_expires_at,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'cosine', ?5, ?6, ?7, ?8, ?9, ?10,
                'building', ?11, 0, ?12, ?13, ?12, ?14, ?12, ?12)",
            params![
                profile_id,
                PROVIDER_KIND,
                settings.model,
                dimensions as i64,
                NORMALIZATION_VERSION,
                CHUNKING_VERSION,
                CONTENT_HASH_VERSION,
                stable_provider_hash(&settings.base_url),
                settings.provider_label,
                settings.consent_confirmed_at,
                total,
                now,
                execution_id,
                lease_expires_at,
            ],
        )
        .map_err(|error| {
            if error
                .to_string()
                .contains("idx_retrieval_index_profiles_one_building")
            {
                EmbeddingIndexError::InvalidState(
                    "已有语义索引任务正在构建，请先等待或取消。".to_string(),
                )
            } else {
                EmbeddingIndexError::storage(error)
            }
        })?;
    get_profile(connection, profile_id)
}

fn resume_profile(
    connection: &Connection,
    profile_id: &str,
    settings: &EmbeddingProviderSettings,
    execution_id: &str,
) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
    require_authorized_settings(settings)?;
    let profile = get_profile(connection, profile_id)?;
    if !matches!(profile.status.as_str(), "failed" | "cancelled" | "building") {
        return Err(EmbeddingIndexError::InvalidState(
            "只有失败、已取消或中断的语义索引任务可以继续。".to_string(),
        ));
    }
    let snapshot = connection
        .query_row(
            "SELECT provider_base_url_hash, provider_label, consent_confirmed_at
             FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(EmbeddingIndexError::storage)?;
    if profile.provider_kind != PROVIDER_KIND
        || profile.model_id != settings.model
        || snapshot.0.as_deref() != Some(stable_provider_hash(&settings.base_url).as_str())
        || snapshot.1.as_deref() != Some(settings.provider_label.as_str())
        || snapshot.2 != settings.consent_confirmed_at
    {
        return Err(EmbeddingIndexError::InvalidState(
            "当前 Embedding Provider、模型或授权与任务创建时不同，不能继续该任务。".to_string(),
        ));
    }
    let now = current_unix_seconds();
    let lease_expires_at = lease_expires_at(&now);
    let changed = connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'building', cancel_requested_at = NULL,
                 last_started_at = ?2, error_code = NULL, error_message = NULL,
                 completed_at = NULL, execution_id = ?3, heartbeat_at = ?2,
                 lease_expires_at = ?4, updated_at = ?2
             WHERE id = ?1
               AND status IN ('failed', 'cancelled', 'building')
               AND (
                 execution_id IS NULL
                 OR lease_expires_at IS NULL
                 OR CAST(lease_expires_at AS INTEGER) <= CAST(?2 AS INTEGER)
               )",
            params![profile_id, now, execution_id, lease_expires_at],
        )
        .map_err(|error| {
            if error
                .to_string()
                .contains("idx_retrieval_index_profiles_one_building")
            {
                EmbeddingIndexError::InvalidState("已有其他语义索引任务正在构建。".to_string())
            } else {
                EmbeddingIndexError::storage(error)
            }
        })?;
    if changed != 1 {
        return Err(EmbeddingIndexError::InvalidState(
            "语义索引任务仍由另一个应用实例处理，请稍后再继续。".to_string(),
        ));
    }
    get_profile(connection, profile_id)
}

async fn run_index_with<OpenConnection, RequestProvider>(
    open_connection: OpenConnection,
    profile_id: &str,
    execution_id: &str,
    settings: &EmbeddingProviderSettings,
    request_provider: RequestProvider,
) -> Result<EmbeddingIndexProfile, EmbeddingIndexError>
where
    OpenConnection: Fn() -> Result<Connection, EmbeddingIndexError>,
    RequestProvider: Fn(Vec<String>) -> EmbeddingRequestFuture,
{
    loop {
        let connection = open_connection()?;
        let profile = get_profile(&connection, profile_id)?;
        if !execution_owned(&connection, profile_id, execution_id)? {
            return Err(EmbeddingIndexError::InvalidState(
                "语义索引任务已由另一个应用实例接管。".to_string(),
            ));
        }
        if profile.status == "cancelled" {
            release_execution(&connection, profile_id, execution_id)?;
            return get_profile(&connection, profile_id);
        }
        if profile.status != "building" {
            return Err(EmbeddingIndexError::InvalidState(
                "语义索引任务当前不在构建状态。".to_string(),
            ));
        }
        refresh_execution_lease(&connection, profile_id, execution_id)?;
        if profile.cancel_requested_at.is_some() {
            mark_cancelled(&connection, profile_id, execution_id)?;
            return get_profile(&connection, profile_id);
        }
        let pending = read_pending_documents(&connection, profile_id, settings.batch_size)
            .map_err(EmbeddingIndexError::Storage)?;
        if pending.is_empty() {
            complete_profile_for_execution(
                &connection,
                profile_id,
                execution_id,
                &current_unix_seconds(),
            )
            .map_err(EmbeddingIndexError::Storage)?;
            return get_profile(&connection, profile_id);
        }
        let inputs = pending
            .iter()
            .map(|document| document.content.clone())
            .collect::<Vec<_>>();
        drop(connection);

        let result = request_provider(inputs).await;
        let connection = open_connection()?;
        let profile_after_request = get_profile(&connection, profile_id)?;
        if !execution_owned(&connection, profile_id, execution_id)? {
            return Err(EmbeddingIndexError::InvalidState(
                "语义索引任务已由另一个应用实例接管。".to_string(),
            ));
        }
        if profile_after_request.status == "cancelled" {
            release_execution(&connection, profile_id, execution_id)?;
            return get_profile(&connection, profile_id);
        }
        if profile_after_request.status != "building" {
            return Err(EmbeddingIndexError::InvalidState(
                "语义索引任务当前不在构建状态。".to_string(),
            ));
        }
        refresh_execution_lease(&connection, profile_id, execution_id)?;
        if cancel_requested(&connection, profile_id)? {
            mark_cancelled(&connection, profile_id, execution_id)?;
            return get_profile(&connection, profile_id);
        }
        let batch = match result {
            Ok(batch) => batch,
            Err(error) => {
                mark_failed(
                    &connection,
                    profile_id,
                    execution_id,
                    error.code(),
                    &error.user_message(),
                )?;
                return get_profile(&connection, profile_id);
            }
        };
        if batch.model != profile.model_id
            || batch.vectors.len() != pending.len()
            || batch
                .vectors
                .iter()
                .any(|vector| vector.len() != profile.dimensions)
        {
            mark_failed(
                &connection,
                profile_id,
                execution_id,
                "embedding_provider_output_error",
                "Embedding Provider 返回数量或维度与任务不一致。",
            )?;
            return get_profile(&connection, profile_id);
        }
        let documents = pending
            .into_iter()
            .zip(batch.vectors)
            .map(|(document, vector)| EmbeddedDocument {
                document_id: document.document_id,
                content_hash: document.content_hash,
                vector,
            })
            .collect::<Vec<_>>();
        if upsert_embedding_batch_for_execution(
            &connection,
            profile_id,
            execution_id,
            &documents,
            &current_unix_seconds(),
        )
        .is_err()
        {
            mark_failed(
                &connection,
                profile_id,
                execution_id,
                "embedding_index_write_error",
                "笔记在构建期间发生变化，请继续任务以重新计算。",
            )?;
            return get_profile(&connection, profile_id);
        }
    }
}

fn request_profile_cancel(
    connection: &Connection,
    profile_id: &str,
) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
    let profile = get_profile(connection, profile_id)?;
    if profile.status != "building" {
        return Ok(profile);
    }
    let now = current_unix_seconds();
    if !profile.worker_active {
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'cancelled',
                     cancel_requested_at = COALESCE(cancel_requested_at, ?2),
                     completed_at = COALESCE(completed_at, ?2),
                     error_code = COALESCE(error_code, 'embedding_cancelled_after_worker_loss'),
                     execution_id = NULL, heartbeat_at = NULL, lease_expires_at = NULL,
                     updated_at = ?2
                 WHERE id = ?1 AND status = 'building'",
                params![profile_id, now],
            )
            .map_err(EmbeddingIndexError::storage)?;
        return get_profile(connection, profile_id);
    }
    connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'cancelled',
                 cancel_requested_at = COALESCE(cancel_requested_at, ?2),
                 completed_at = COALESCE(completed_at, ?2),
                 updated_at = ?2
             WHERE id = ?1 AND status = 'building'",
            params![profile_id, now],
        )
        .map_err(EmbeddingIndexError::storage)?;
    get_profile(connection, profile_id)
}

fn clear_profiles(
    connection: &Connection,
    profile_id: Option<&str>,
    confirm: bool,
) -> Result<EmbeddingIndexState, EmbeddingIndexError> {
    if !confirm {
        return Err(EmbeddingIndexError::InvalidRequest(
            "清除语义索引需要显式确认。".to_string(),
        ));
    }
    let active_worker_count = connection
        .query_row(
            "SELECT COUNT(*) FROM retrieval_index_profiles
             WHERE status IN ('building', 'cancelled')
               AND execution_id IS NOT NULL
               AND lease_expires_at IS NOT NULL
               AND CAST(lease_expires_at AS INTEGER) > CAST(?2 AS INTEGER)
               AND (?1 IS NULL OR id = ?1)",
            params![profile_id, current_unix_seconds()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(EmbeddingIndexError::storage)?;
    if active_worker_count > 0 {
        return Err(EmbeddingIndexError::InvalidState(
            "请先等待语义索引任务完成取消收尾。".to_string(),
        ));
    }
    match profile_id {
        Some(profile_id) => {
            connection
                .execute(
                    "DELETE FROM retrieval_index_profiles WHERE id = ?1",
                    [profile_id],
                )
                .map_err(EmbeddingIndexError::storage)?;
        }
        None => {
            connection
                .execute("DELETE FROM retrieval_index_profiles", [])
                .map_err(EmbeddingIndexError::storage)?;
        }
    }
    read_index_state(connection)
}

fn require_authorized_settings(
    settings: &EmbeddingProviderSettings,
) -> Result<(), EmbeddingIndexError> {
    if !settings.remote_note_embedding_enabled || settings.consent_confirmed_at.is_none() {
        return Err(EmbeddingIndexError::Provider(
            EmbeddingServiceError::ConsentRequired,
        ));
    }
    Ok(())
}

fn cancel_requested(
    connection: &Connection,
    profile_id: &str,
) -> Result<bool, EmbeddingIndexError> {
    connection
        .query_row(
            "SELECT cancel_requested_at IS NOT NULL
             FROM retrieval_index_profiles WHERE id = ?1",
            [profile_id],
            |row| row.get(0),
        )
        .map_err(EmbeddingIndexError::storage)
}

fn execution_owned(
    connection: &Connection,
    profile_id: &str,
    execution_id: &str,
) -> Result<bool, EmbeddingIndexError> {
    connection
        .query_row(
            "SELECT COALESCE(execution_id = ?2, 0)
             FROM retrieval_index_profiles WHERE id = ?1",
            params![profile_id, execution_id],
            |row| row.get(0),
        )
        .map_err(EmbeddingIndexError::storage)
}

fn refresh_execution_lease(
    connection: &Connection,
    profile_id: &str,
    execution_id: &str,
) -> Result<(), EmbeddingIndexError> {
    let now = current_unix_seconds();
    let lease_expires_at = lease_expires_at(&now);
    let changed = connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET heartbeat_at = ?3, lease_expires_at = ?4, updated_at = ?3
             WHERE id = ?1 AND execution_id = ?2 AND status = 'building'",
            params![profile_id, execution_id, now, lease_expires_at],
        )
        .map_err(EmbeddingIndexError::storage)?;
    if changed != 1 {
        return Err(EmbeddingIndexError::InvalidState(
            "语义索引任务执行权已失效。".to_string(),
        ));
    }
    Ok(())
}

fn release_execution(
    connection: &Connection,
    profile_id: &str,
    execution_id: &str,
) -> Result<(), EmbeddingIndexError> {
    connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET execution_id = NULL, heartbeat_at = NULL, lease_expires_at = NULL
             WHERE id = ?1 AND execution_id = ?2",
            params![profile_id, execution_id],
        )
        .map_err(EmbeddingIndexError::storage)?;
    Ok(())
}

fn mark_cancelled(
    connection: &Connection,
    profile_id: &str,
    execution_id: &str,
) -> Result<(), EmbeddingIndexError> {
    let now = current_unix_seconds();
    connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, ?2),
                 completed_at = ?2, execution_id = NULL, heartbeat_at = NULL,
                 lease_expires_at = NULL, updated_at = ?2
             WHERE id = ?1 AND status = 'building' AND execution_id = ?3",
            params![profile_id, now, execution_id],
        )
        .map_err(EmbeddingIndexError::storage)?;
    Ok(())
}

fn mark_failed(
    connection: &Connection,
    profile_id: &str,
    execution_id: &str,
    code: &str,
    message: &str,
) -> Result<(), EmbeddingIndexError> {
    let now = current_unix_seconds();
    connection
        .execute(
            "UPDATE retrieval_index_profiles
             SET status = 'failed', error_code = ?2, error_message = ?3,
                 completed_at = ?4, execution_id = NULL, heartbeat_at = NULL,
                 lease_expires_at = NULL, updated_at = ?4
             WHERE id = ?1 AND status = 'building' AND execution_id = ?5",
            params![profile_id, code, message, now, execution_id],
        )
        .map_err(EmbeddingIndexError::storage)?;
    Ok(())
}

fn get_profile(
    connection: &Connection,
    profile_id: &str,
) -> Result<EmbeddingIndexProfile, EmbeddingIndexError> {
    connection
        .query_row(
            "SELECT id, provider_kind, model_id, dimensions, provider_label,
                consent_confirmed_at, status, total_document_count, indexed_document_count,
                cancel_requested_at, last_started_at, error_code, error_message,
                created_at, updated_at, completed_at, execution_id, lease_expires_at
             FROM retrieval_index_profiles
             WHERE id = ?1",
            [profile_id],
            map_profile_row,
        )
        .optional()
        .map_err(EmbeddingIndexError::storage)?
        .ok_or_else(|| EmbeddingIndexError::NotFound("没有找到对应的语义索引任务。".to_string()))
}

fn read_latest_profile(
    connection: &Connection,
    status: Option<&str>,
) -> Result<Option<EmbeddingIndexProfile>, EmbeddingIndexError> {
    connection
        .query_row(
            "SELECT id, provider_kind, model_id, dimensions, provider_label,
                consent_confirmed_at, status, total_document_count, indexed_document_count,
                cancel_requested_at, last_started_at, error_code, error_message,
                created_at, updated_at, completed_at, execution_id, lease_expires_at
             FROM retrieval_index_profiles
             WHERE (?1 IS NULL OR status = ?1)
             ORDER BY updated_at DESC, id DESC
             LIMIT 1",
            [status],
            map_profile_row,
        )
        .optional()
        .map_err(EmbeddingIndexError::storage)
}

fn map_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EmbeddingIndexProfile> {
    let dimensions = row.get::<_, i64>(3)?;
    let total = row.get::<_, i64>(7)?;
    let indexed = row.get::<_, i64>(8)?;
    let status = row.get::<_, String>(6)?;
    let execution_id = row.get::<_, Option<String>>(16)?;
    let lease_expires_at = row.get::<_, Option<String>>(17)?;
    let worker_active = matches!(status.as_str(), "building" | "cancelled")
        && execution_id.is_some()
        && lease_expires_at
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|expires_at| expires_at > current_unix_seconds_value());
    Ok(EmbeddingIndexProfile {
        id: row.get(0)?,
        provider_kind: row.get(1)?,
        model_id: row.get(2)?,
        dimensions: dimensions.max(0) as usize,
        provider_label: row.get(4)?,
        consent_confirmed_at: row.get(5)?,
        status,
        total_document_count: total.max(0) as usize,
        indexed_document_count: indexed.max(0) as usize,
        cancel_requested_at: row.get(9)?,
        last_started_at: row.get(10)?,
        error_code: row.get(11)?,
        error_message: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        completed_at: row.get(15)?,
        worker_active,
    })
}

fn current_unix_seconds() -> String {
    current_unix_seconds_value().to_string()
}

fn current_unix_seconds_value() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn lease_expires_at(now: &str) -> String {
    now.parse::<u64>()
        .unwrap_or_else(|_| current_unix_seconds_value())
        .saturating_add(EXECUTION_LEASE_SECONDS)
        .to_string()
}

fn next_execution_id(profile_id: &str) -> String {
    let timestamp = current_unix_seconds_value();
    let timestamp_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = EXECUTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(b"embedding-index-execution-v1\0");
    hasher.update(profile_id.as_bytes());
    hasher.update(timestamp_nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(timestamp.to_le_bytes());
    hasher.update(sequence.to_le_bytes());
    let suffix = format!("{:x}", hasher.finalize());
    format!("embedding-execution-{timestamp}-{}", &suffix[..16])
}

fn next_profile_id(model: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(b"embedding-index-profile-v1\0");
    hasher.update(model.as_bytes());
    hasher.update(sequence.to_le_bytes());
    let suffix = format!("{:x}", hasher.finalize());
    format!("embedding-index-{timestamp}-{}", &suffix[..10])
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        fs,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Mutex,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use rusqlite::Connection;

    use crate::db::initialize_schema;

    use super::{
        clear_profiles, create_remote_profile, get_profile, read_index_state, release_execution,
        request_profile_cancel, resume_profile, run_index_with, EmbeddingIndexError,
        EmbeddingProviderSettings, EmbeddingServiceError, RemoteEmbeddingBatch,
    };

    static TEST_DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TempDatabase {
        path: std::path::PathBuf,
    }

    impl TempDatabase {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should work")
                .as_nanos();
            let sequence = TEST_DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "wxreadmaster-embedding-index-{timestamp}-{sequence}.sqlite"
            ));
            let _ = fs::remove_file(&path);
            Self { path }
        }

        fn open(&self) -> Connection {
            let connection = Connection::open(&self.path).expect("database should open");
            connection
                .execute_batch("PRAGMA foreign_keys = ON;")
                .expect("foreign keys should enable");
            connection
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn settings() -> EmbeddingProviderSettings {
        EmbeddingProviderSettings {
            base_url: "https://provider.example/v1".to_string(),
            model: "embed-v1".to_string(),
            provider_label: "Example".to_string(),
            batch_size: 2,
            remote_note_embedding_enabled: true,
            consent_confirmed_at: Some("100".to_string()),
        }
    }

    fn seeded_database() -> TempDatabase {
        let database = TempDatabase::new();
        let connection = database.open();
        initialize_schema(&connection).expect("schema should initialize");
        for index in 0..3 {
            connection
                .execute(
                    "INSERT INTO retrieval_documents (
                        id, source_type, source_id, book_id, content, normalized_content,
                        metadata_json, content_hash, source_updated_at, indexed_at
                     ) VALUES (?1, 'highlight', ?2, 'book-1', ?3, ?3, '{}', ?4, '100', '100')",
                    rusqlite::params![
                        format!("note:highlight:h{index}"),
                        format!("h{index}"),
                        format!("正文 {index}"),
                        format!("hash-{index}"),
                    ],
                )
                .expect("document should insert");
        }
        database
    }

    fn vector_batch(count: usize) -> RemoteEmbeddingBatch {
        RemoteEmbeddingBatch {
            model: "embed-v1".to_string(),
            vectors: (0..count)
                .map(|index| {
                    if index % 2 == 0 {
                        vec![1.0, 0.0]
                    } else {
                        vec![0.0, 1.0]
                    }
                })
                .collect(),
        }
    }

    fn make_execution_active(connection: &Connection, profile_id: &str, execution_id: &str) {
        let now = super::current_unix_seconds();
        let expires_at = super::lease_expires_at(&now);
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET heartbeat_at = ?2, lease_expires_at = ?3
                 WHERE id = ?1 AND execution_id = ?4",
                rusqlite::params![profile_id, now, expires_at, execution_id],
            )
            .expect("execution lease should refresh");
    }

    #[tokio::test]
    async fn remote_index_completes_in_batches_and_becomes_ready() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        drop(connection);
        let path = database.path.clone();
        let calls = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let call_log = calls.clone();
        let profile = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-1",
            "execution-1",
            &settings(),
            move |inputs| {
                call_log.lock().unwrap().push(inputs.clone());
                Box::pin(async move { Ok(vector_batch(inputs.len())) })
            },
        )
        .await
        .expect("index should complete");

        assert_eq!(profile.status, "ready");
        assert_eq!(profile.indexed_document_count, 3);
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .map(Vec::len)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    #[tokio::test]
    async fn failed_index_resumes_without_reembedding_completed_batch() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        drop(connection);
        let path = database.path.clone();
        let responses = Arc::new(Mutex::new(VecDeque::from([
            Ok(vector_batch(2)),
            Err(EmbeddingServiceError::ProviderNetwork(
                "offline".to_string(),
            )),
        ])));
        let scripted = responses.clone();
        let failed = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-1",
            "execution-1",
            &settings(),
            move |inputs| {
                let response = scripted
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or_else(|| Ok(vector_batch(inputs.len())));
                Box::pin(async move { response })
            },
        )
        .await
        .expect("provider failure should persist state");
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.indexed_document_count, 2);

        let connection = database.open();
        resume_profile(&connection, "profile-1", &settings(), "execution-2")
            .expect("profile should resume");
        drop(connection);
        let resumed_inputs = Arc::new(Mutex::new(Vec::<usize>::new()));
        let input_counts = resumed_inputs.clone();
        let ready = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-1",
            "execution-2",
            &settings(),
            move |inputs| {
                input_counts.lock().unwrap().push(inputs.len());
                Box::pin(async move { Ok(vector_batch(inputs.len())) })
            },
        )
        .await
        .expect("resumed index should complete");
        assert_eq!(ready.status, "ready");
        assert_eq!(*resumed_inputs.lock().unwrap(), vec![1]);
    }

    #[tokio::test]
    async fn cancellation_is_observed_after_inflight_batch_without_writing_it() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        drop(connection);
        let path = database.path.clone();
        let cancel_path = path.clone();
        let cancelled = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-1",
            "execution-1",
            &settings(),
            move |inputs| {
                let connection = Connection::open(&cancel_path).unwrap();
                request_profile_cancel(&connection, "profile-1").unwrap();
                Box::pin(async move { Ok(vector_batch(inputs.len())) })
            },
        )
        .await
        .expect("cancel should persist state");
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.indexed_document_count, 0);
        assert!(!cancelled.worker_active);
    }

    #[test]
    fn cancel_request_converges_building_profile_immediately() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        make_execution_active(&connection, "profile-1", "execution-1");

        let cancelled = request_profile_cancel(&connection, "profile-1")
            .expect("cancel request should persist terminal state");

        assert_eq!(cancelled.status, "cancelled");
        assert!(cancelled.cancel_requested_at.is_some());
        assert!(cancelled.completed_at.is_some());
        assert!(cancelled.worker_active);
        assert!(resume_profile(&connection, "profile-1", &settings(), "execution-2").is_err());
        assert!(clear_profiles(&connection, Some("profile-1"), true).is_err());
        release_execution(&connection, "profile-1", "execution-1")
            .expect("worker should release its lease");
        assert!(clear_profiles(&connection, Some("profile-1"), true).is_ok());
    }

    #[tokio::test]
    async fn provider_model_drift_fails_without_replacing_ready_profile() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-old",
            &settings(),
            2,
            "100",
            "execution-old",
        )
        .expect("old profile should create");
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'ready', indexed_document_count = total_document_count,
                     completed_at = '100', execution_id = NULL,
                     heartbeat_at = NULL, lease_expires_at = NULL
                 WHERE id = 'profile-old'",
                [],
            )
            .expect("old profile should become ready");
        create_remote_profile(
            &connection,
            "profile-new",
            &settings(),
            2,
            "101",
            "execution-new",
        )
        .expect("new profile should create");
        drop(connection);

        let path = database.path.clone();
        let failed = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-new",
            "execution-new",
            &settings(),
            move |inputs| {
                let mut batch = vector_batch(inputs.len());
                batch.model = "embed-other".to_string();
                Box::pin(async move { Ok(batch) })
            },
        )
        .await
        .expect("model drift should persist failure");
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.indexed_document_count, 0);

        let connection = database.open();
        let state = read_index_state(&connection).expect("state should read");
        assert_eq!(
            state.ready.expect("old ready should remain").id,
            "profile-old"
        );
        let embedding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_embeddings WHERE profile_id = 'profile-new'",
                [],
                |row| row.get(0),
            )
            .expect("embedding count should read");
        assert_eq!(embedding_count, 0);
    }

    #[test]
    fn clearing_profiles_requires_confirmation_and_rejects_building() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        make_execution_active(&connection, "profile-1", "execution-1");
        assert!(clear_profiles(&connection, Some("profile-1"), false).is_err());
        assert!(clear_profiles(&connection, Some("profile-1"), true).is_err());
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'cancelled', execution_id = NULL,
                     heartbeat_at = NULL, lease_expires_at = NULL
                 WHERE id = 'profile-1'",
                [],
            )
            .expect("profile should cancel");
        let state = clear_profiles(&connection, Some("profile-1"), true)
            .expect("cancelled profile should clear");
        assert!(state.latest.is_none());
        assert!(get_profile(&connection, "profile-1").is_err());
    }

    #[test]
    fn resume_rejects_provider_or_authorization_drift() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'failed', execution_id = NULL,
                     heartbeat_at = NULL, lease_expires_at = NULL
                 WHERE id = 'profile-1'",
                [],
            )
            .expect("profile should fail");
        let mut changed = settings();
        changed.model = "embed-v2".to_string();
        assert!(resume_profile(&connection, "profile-1", &changed, "execution-2").is_err());
        assert_eq!(
            get_profile(&connection, "profile-1").unwrap().status,
            "failed"
        );
    }

    #[test]
    fn resume_uses_a_single_live_execution_lease() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-1",
        )
        .expect("profile should create");
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'failed', execution_id = NULL,
                     heartbeat_at = NULL, lease_expires_at = NULL
                 WHERE id = 'profile-1'",
                [],
            )
            .expect("profile should fail");

        resume_profile(&connection, "profile-1", &settings(), "execution-2")
            .expect("first resume should claim the lease");
        let second = resume_profile(&connection, "profile-1", &settings(), "execution-3")
            .expect_err("second resume should not claim a live lease");
        assert!(second.user_message().contains("另一个应用实例"));
        assert_eq!(
            get_profile(&connection, "profile-1")
                .expect("profile should remain readable")
                .worker_active,
            true
        );
    }

    #[tokio::test]
    async fn stale_execution_cannot_write_after_lease_takeover() {
        let database = seeded_database();
        let connection = database.open();
        create_remote_profile(
            &connection,
            "profile-1",
            &settings(),
            2,
            "100",
            "execution-old",
        )
        .expect("profile should create");
        let now = super::current_unix_seconds();
        let expires_at = super::lease_expires_at(&now);
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET execution_id = 'execution-new', heartbeat_at = ?2,
                     lease_expires_at = ?3
                 WHERE id = 'profile-1'",
                rusqlite::params!["profile-1", now, expires_at],
            )
            .expect("new execution should take over");
        drop(connection);

        let path = database.path.clone();
        let result = run_index_with(
            || Connection::open(&path).map_err(EmbeddingIndexError::storage),
            "profile-1",
            "execution-old",
            &settings(),
            |_inputs| panic!("stale execution must not call the provider"),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(
            get_profile(&database.open(), "profile-1")
                .expect("profile should remain readable")
                .status,
            "building"
        );
    }
}
