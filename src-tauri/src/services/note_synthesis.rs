use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    db,
    services::{
        ai::{
            book_notes_summary_json_schema, book_notes_summary_system_prompt,
            normalize_summary_output, request_ai_json_with_schema_fallback, AiOutputUpsert,
            AiProviderSettings, AiService, AiServiceError, BookAiSummarySourceStats,
            ProviderJsonResult,
        },
        retrieval::{normalize_retrieval_text, rebuild_book_retrieval_documents},
    },
};

pub const NOTE_SYNTHESIS_BATCH_PROMPT_VERSION: &str = "reading-note-batch-summary-v1";
pub const NOTE_SYNTHESIS_MERGE_PROMPT_VERSION: &str = "reading-note-synthesis-merge-v1";
pub const NOTE_SYNTHESIS_BATCHING_VERSION: &str = "reading-note-batching-v1";
pub const FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION: &str =
    crate::services::ai::BOOK_NOTES_SUMMARY_FULL_PROMPT_VERSION;
pub const DEFAULT_NOTE_SYNTHESIS_BATCH_MAX_CHARS: usize = 12_000;
pub const MAX_NOTE_SYNTHESIS_ITEM_CHARS: usize = 8_000;

static JOB_SEQUENCE: AtomicU64 = AtomicU64::new(0);

type ProviderRequestFuture =
    Pin<Box<dyn Future<Output = Result<ProviderJsonResult, AiServiceError>> + Send>>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteSynthesisJobStatus {
    Queued,
    Snapshotting,
    Batching,
    Summarizing,
    Merging,
    Completed,
    Partial,
    Failed,
    Cancelled,
}

impl NoteSynthesisJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Snapshotting => "snapshotting",
            Self::Batching => "batching",
            Self::Summarizing => "summarizing",
            Self::Merging => "merging",
            Self::Completed => "completed",
            Self::Partial => "partial",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Result<Self, NoteSynthesisError> {
        match value {
            "queued" => Ok(Self::Queued),
            "snapshotting" => Ok(Self::Snapshotting),
            "batching" => Ok(Self::Batching),
            "summarizing" => Ok(Self::Summarizing),
            "merging" => Ok(Self::Merging),
            "completed" => Ok(Self::Completed),
            "partial" => Ok(Self::Partial),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(NoteSynthesisError::InvalidState(format!(
                "未知的全量归纳任务状态：{value}"
            ))),
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisPreview {
    pub book_id: String,
    pub total_count: usize,
    pub highlight_count: usize,
    pub thought_count: usize,
    pub estimated_batch_count: usize,
    pub estimated_char_count: usize,
    pub current_source_hash: String,
    pub provider_model: String,
    pub provider_label: String,
    pub active_job: Option<NoteSynthesisJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisJobSummary {
    pub active_job: Option<NoteSynthesisJob>,
    pub latest_completed_job: Option<NoteSynthesisJob>,
    pub latest_terminal_job: Option<NoteSynthesisJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisResultReference {
    pub feature: String,
    pub prompt_version: String,
    pub input_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisFailedBatch {
    pub batch_index: usize,
    pub source_count: usize,
    pub attempt_count: usize,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisCoverageReport {
    pub total_count: usize,
    pub processed_count: usize,
    pub pending_count: usize,
    pub skipped_empty_count: usize,
    pub skipped_duplicate_count: usize,
    pub failed_item_count: usize,
    pub full_snapshot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSynthesisJob {
    pub id: String,
    pub book_id: String,
    pub status: NoteSynthesisJobStatus,
    pub source_snapshot_hash: String,
    pub total_count: usize,
    pub processed_count: usize,
    pub batch_count: usize,
    pub completed_batch_count: usize,
    pub failed_batch_count: usize,
    pub provider_model: String,
    pub provider_label: String,
    pub consent_confirmed_at: String,
    pub cancel_requested_at: Option<String>,
    pub last_started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result: Option<NoteSynthesisResultReference>,
    pub failed_batches: Vec<NoteSynthesisFailedBatch>,
    pub coverage: NoteSynthesisCoverageReport,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartNoteSynthesisResult {
    pub created: bool,
    pub job: NoteSynthesisJob,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartNoteSynthesisRequest {
    pub book_id: String,
    pub provider_base_url_hash: String,
    pub provider_model: String,
    pub provider_label: String,
    pub consent_confirmed_at: String,
}

#[derive(Debug, Clone)]
struct SnapshotDocument {
    document_id: String,
    source_type: String,
    content_hash: String,
    chapter_uid: Option<i64>,
    chapter_title: Option<String>,
    title: Option<String>,
    content_snapshot: String,
    source_updated_at: String,
    audit_status: &'static str,
    audit_reason: Option<String>,
    batch_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedBatch {
    batch_index: usize,
    chapter_uid: Option<i64>,
    source_types: Vec<String>,
    document_ids: Vec<String>,
    input_hash: String,
}

#[derive(Debug, Clone)]
pub enum NoteSynthesisError {
    InvalidRequest(String),
    NotFound(String),
    InvalidState(String),
    Storage(String),
}

impl NoteSynthesisError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_note_synthesis_request",
            Self::NotFound(_) => "note_synthesis_job_not_found",
            Self::InvalidState(_) => "invalid_note_synthesis_state",
            Self::Storage(_) => "note_synthesis_storage_error",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidRequest(message)
            | Self::NotFound(message)
            | Self::InvalidState(message) => message.clone(),
            Self::Storage(_) => "全量笔记归纳任务暂时无法访问，请稍后重试。".to_string(),
        }
    }

    fn storage(error: impl fmt::Display) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct NoteSynthesisService {
    app: AppHandle,
}

impl NoteSynthesisService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn open_connection(&self) -> Result<Connection, NoteSynthesisError> {
        db::open_connection(&self.app).map_err(NoteSynthesisError::Storage)
    }

    pub fn preview(
        &self,
        book_id: &str,
        provider_model: String,
        provider_label: String,
    ) -> Result<NoteSynthesisPreview, NoteSynthesisError> {
        let connection = self.open_connection()?;
        preview_note_synthesis(&connection, book_id, provider_model, provider_label)
    }

    pub fn start(
        &self,
        request: StartNoteSynthesisRequest,
    ) -> Result<StartNoteSynthesisResult, NoteSynthesisError> {
        let mut connection = self.open_connection()?;
        start_note_synthesis(&mut connection, request)
    }

    pub fn get(&self, job_id: &str) -> Result<NoteSynthesisJob, NoteSynthesisError> {
        let connection = self.open_connection()?;
        get_note_synthesis_job(&connection, job_id)
    }

    pub fn get_active(
        &self,
        book_id: &str,
    ) -> Result<Option<NoteSynthesisJob>, NoteSynthesisError> {
        let connection = self.open_connection()?;
        get_active_note_synthesis_job(&connection, book_id)
    }

    pub fn get_summary(
        &self,
        book_id: &str,
    ) -> Result<NoteSynthesisJobSummary, NoteSynthesisError> {
        let connection = self.open_connection()?;
        get_note_synthesis_job_summary(&connection, book_id)
    }

    pub fn request_cancel(&self, job_id: &str) -> Result<NoteSynthesisJob, NoteSynthesisError> {
        let connection = self.open_connection()?;
        request_note_synthesis_cancel(&connection, job_id)
    }

    pub async fn continue_job(&self, job_id: &str) -> Result<NoteSynthesisJob, NoteSynthesisError> {
        let job = self.get(job_id)?;
        validate_continue_state(&job)?;
        let ai = AiService::new(self.app.clone());
        let settings = ai.settings_state().map_err(map_ai_error)?;
        if settings.provider.model != job.provider_model {
            return Err(NoteSynthesisError::InvalidState(
                "当前 Provider 模型与任务创建时不同，请恢复原模型后继续。".to_string(),
            ));
        }
        if stable_provider_hash(&settings.provider.base_url)
            != read_provider_hash_for_job(&self.open_connection()?, job_id)?
        {
            return Err(NoteSynthesisError::InvalidState(
                "当前 Provider 地址与任务授权时不同，请恢复原 Provider 后继续。".to_string(),
            ));
        }
        let api_key = match ai.read_api_key() {
            Ok(value) => value,
            Err(error) => {
                let connection = self.open_connection()?;
                mark_job_failed(&connection, job_id, error.code(), &error.user_message())?;
                return get_note_synthesis_job(&connection, job_id);
            }
        };

        run_note_synthesis_job(&self.app, job_id, &api_key, &settings.provider).await
    }

    pub async fn retry_failed_batches(
        &self,
        job_id: &str,
    ) -> Result<NoteSynthesisJob, NoteSynthesisError> {
        let connection = self.open_connection()?;
        let job = get_note_synthesis_job(&connection, job_id)?;
        if !matches!(
            job.status,
            NoteSynthesisJobStatus::Partial | NoteSynthesisJobStatus::Failed
        ) {
            return Err(NoteSynthesisError::InvalidState(
                "只有部分失败或失败的全量归纳任务才能重试失败批次。".to_string(),
            ));
        }
        reset_failed_batches(&connection, job_id)?;
        drop(connection);
        self.continue_job(job_id).await
    }
}

pub fn preview_note_synthesis(
    connection: &Connection,
    book_id: &str,
    provider_model: String,
    provider_label: String,
) -> Result<NoteSynthesisPreview, NoteSynthesisError> {
    let book_id = require_non_empty(book_id, "缺少书籍 ID，无法预估全量归纳任务。")?;
    rebuild_book_retrieval_documents(connection, book_id, &current_unix_seconds())
        .map_err(NoteSynthesisError::storage)?;
    let documents = read_snapshot_documents(connection, book_id)?;
    let highlight_count = documents
        .iter()
        .filter(|document| document.source_type == "highlight")
        .count();
    let thought_count = documents
        .iter()
        .filter(|document| document.source_type == "thought")
        .count();
    let estimated_char_count = documents
        .iter()
        .map(|document| document.content_snapshot.chars().count())
        .sum();
    let mut planned = prepare_snapshot_documents(documents);
    let batches = build_stable_batches(&mut planned, DEFAULT_NOTE_SYNTHESIS_BATCH_MAX_CHARS);
    let current_source_hash = snapshot_hash(&planned);

    Ok(NoteSynthesisPreview {
        book_id: book_id.to_string(),
        total_count: planned.len(),
        highlight_count,
        thought_count,
        estimated_batch_count: batches.len(),
        estimated_char_count,
        current_source_hash,
        provider_model,
        provider_label,
        active_job: get_active_note_synthesis_job(connection, book_id)?,
    })
}

pub fn start_note_synthesis(
    connection: &mut Connection,
    request: StartNoteSynthesisRequest,
) -> Result<StartNoteSynthesisResult, NoteSynthesisError> {
    let book_id = require_non_empty(&request.book_id, "缺少书籍 ID，无法创建全量归纳任务。")?;
    require_non_empty(
        &request.provider_base_url_hash,
        "缺少 Provider 标识，无法记录本次授权。",
    )?;
    require_non_empty(
        &request.provider_model,
        "缺少 Provider 模型，无法创建全量归纳任务。",
    )?;
    require_non_empty(
        &request.provider_label,
        "缺少 Provider 名称，无法记录本次授权。",
    )?;
    require_non_empty(
        &request.consent_confirmed_at,
        "创建全量归纳任务前必须逐次确认原始笔记授权。",
    )?;

    if let Some(job) = get_active_note_synthesis_job(connection, book_id)? {
        return Ok(StartNoteSynthesisResult {
            created: false,
            job,
        });
    }

    rebuild_book_retrieval_documents(connection, book_id, &current_unix_seconds())
        .map_err(NoteSynthesisError::storage)?;
    let documents = read_snapshot_documents(connection, book_id)?;
    if documents.is_empty() {
        return Err(NoteSynthesisError::InvalidRequest(
            "这本书还没有可归纳的划线或想法。".to_string(),
        ));
    }

    let mut documents = prepare_snapshot_documents(documents);
    let batches = build_stable_batches(&mut documents, DEFAULT_NOTE_SYNTHESIS_BATCH_MAX_CHARS);
    let source_snapshot_hash = snapshot_hash(&documents);
    let processed_count = documents
        .iter()
        .filter(|document| document.audit_status != "pending")
        .count();
    let now = current_unix_seconds();
    let job_id = next_job_id(book_id, &source_snapshot_hash);
    let transaction = connection
        .transaction()
        .map_err(NoteSynthesisError::storage)?;

    transaction
        .execute(
            "INSERT INTO note_synthesis_jobs (
                id, book_id, status, source_snapshot_hash, total_count, processed_count,
                batch_count, completed_batch_count, failed_batch_count,
                batch_prompt_version, merge_prompt_version, batching_version,
                provider_base_url_hash, provider_model, consent_confirmed_at,
                consent_provider_label, created_at, updated_at
             ) VALUES (
                ?1, ?2, 'queued', ?3, ?4, ?5, ?6, 0, 0,
                ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14
             )",
            params![
                job_id,
                book_id,
                source_snapshot_hash,
                documents.len() as i64,
                processed_count as i64,
                batches.len() as i64,
                NOTE_SYNTHESIS_BATCH_PROMPT_VERSION,
                NOTE_SYNTHESIS_MERGE_PROMPT_VERSION,
                NOTE_SYNTHESIS_BATCHING_VERSION,
                request.provider_base_url_hash.trim(),
                request.provider_model.trim(),
                request.consent_confirmed_at.trim(),
                request.provider_label.trim(),
                now,
            ],
        )
        .map_err(NoteSynthesisError::storage)?;

    for document in &documents {
        transaction
            .execute(
                "INSERT INTO note_synthesis_job_items (
                    job_id, document_id, source_type, content_hash, chapter_uid,
                    chapter_title, title, content_snapshot, source_updated_at,
                    batch_index, audit_status, audit_reason, processed_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
                 )",
                params![
                    job_id,
                    document.document_id,
                    document.source_type,
                    document.content_hash,
                    document.chapter_uid,
                    document.chapter_title,
                    document.title,
                    document.content_snapshot,
                    document.source_updated_at,
                    document.batch_index.map(|value| value as i64),
                    document.audit_status,
                    document.audit_reason,
                    (document.audit_status != "pending").then_some(now.as_str()),
                ],
            )
            .map_err(NoteSynthesisError::storage)?;
    }

    for batch in &batches {
        let source_types_json =
            serde_json::to_string(&batch.source_types).map_err(NoteSynthesisError::storage)?;
        transaction
            .execute(
                "INSERT INTO note_synthesis_batches (
                    job_id, batch_index, status, chapter_uid, source_types_json,
                    source_count, input_hash, updated_at
                 ) VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7)",
                params![
                    job_id,
                    batch.batch_index as i64,
                    batch.chapter_uid,
                    source_types_json,
                    batch.document_ids.len() as i64,
                    batch.input_hash,
                    now,
                ],
            )
            .map_err(NoteSynthesisError::storage)?;
    }

    transaction.commit().map_err(NoteSynthesisError::storage)?;

    Ok(StartNoteSynthesisResult {
        created: true,
        job: get_note_synthesis_job(connection, &job_id)?,
    })
}

pub fn get_note_synthesis_job(
    connection: &Connection,
    job_id: &str,
) -> Result<NoteSynthesisJob, NoteSynthesisError> {
    let job_id = require_non_empty(job_id, "缺少全量归纳任务 ID。")?;
    read_job_by_clause(connection, "id = ?1", job_id)?
        .ok_or_else(|| NoteSynthesisError::NotFound("没有找到对应的全量归纳任务。".to_string()))
}

pub fn get_active_note_synthesis_job(
    connection: &Connection,
    book_id: &str,
) -> Result<Option<NoteSynthesisJob>, NoteSynthesisError> {
    let book_id = require_non_empty(book_id, "缺少书籍 ID。")?;
    read_job_by_clause(
        connection,
        "book_id = ?1 AND status IN (
            'queued', 'snapshotting', 'batching', 'summarizing', 'merging', 'partial'
         ) ORDER BY updated_at DESC LIMIT 1",
        book_id,
    )
}

pub fn get_note_synthesis_job_summary(
    connection: &Connection,
    book_id: &str,
) -> Result<NoteSynthesisJobSummary, NoteSynthesisError> {
    let book_id = require_non_empty(book_id, "缺少书籍 ID。")?;
    Ok(NoteSynthesisJobSummary {
        active_job: get_active_note_synthesis_job(connection, book_id)?,
        latest_completed_job: read_job_by_clause(
            connection,
            "book_id = ?1 AND status = 'completed'
             ORDER BY COALESCE(finished_at, updated_at) DESC, updated_at DESC, id DESC
             LIMIT 1",
            book_id,
        )?,
        latest_terminal_job: read_job_by_clause(
            connection,
            "book_id = ?1 AND status IN ('completed', 'failed', 'cancelled')
             ORDER BY COALESCE(finished_at, updated_at) DESC, updated_at DESC, id DESC
             LIMIT 1",
            book_id,
        )?,
    })
}

pub fn request_note_synthesis_cancel(
    connection: &Connection,
    job_id: &str,
) -> Result<NoteSynthesisJob, NoteSynthesisError> {
    let job = get_note_synthesis_job(connection, job_id)?;
    if job.status.is_terminal() {
        return Ok(job);
    }

    let now = current_unix_seconds();
    let immediately_cancel = matches!(
        job.status,
        NoteSynthesisJobStatus::Queued
            | NoteSynthesisJobStatus::Snapshotting
            | NoteSynthesisJobStatus::Batching
            | NoteSynthesisJobStatus::Partial
    );
    if immediately_cancel {
        connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET status = 'cancelled', cancel_requested_at = ?2,
                     finished_at = ?2, updated_at = ?2
                 WHERE id = ?1",
                params![job_id, now],
            )
            .map_err(NoteSynthesisError::storage)?;
    } else {
        connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET cancel_requested_at = COALESCE(cancel_requested_at, ?2), updated_at = ?2
                 WHERE id = ?1",
                params![job_id, now],
            )
            .map_err(NoteSynthesisError::storage)?;
    }

    get_note_synthesis_job(connection, job_id)
}

fn validate_continue_state(job: &NoteSynthesisJob) -> Result<(), NoteSynthesisError> {
    if job.status.is_terminal() {
        return Err(NoteSynthesisError::InvalidState(
            "终态全量归纳任务不能继续执行。".to_string(),
        ));
    }
    Ok(())
}

fn map_ai_error(error: AiServiceError) -> NoteSynthesisError {
    NoteSynthesisError::Storage(format!("{}: {}", error.code(), error.user_message()))
}

fn read_provider_hash_for_job(
    connection: &Connection,
    job_id: &str,
) -> Result<String, NoteSynthesisError> {
    connection
        .query_row(
            "SELECT provider_base_url_hash FROM note_synthesis_jobs WHERE id = ?1",
            [job_id],
            |row| row.get(0),
        )
        .map_err(NoteSynthesisError::storage)
}

async fn run_note_synthesis_job(
    app: &AppHandle,
    job_id: &str,
    api_key: &str,
    provider: &AiProviderSettings,
) -> Result<NoteSynthesisJob, NoteSynthesisError> {
    run_note_synthesis_job_with(
        || db::open_connection(app).map_err(NoteSynthesisError::storage),
        job_id,
        provider,
        |kind, input, system_prompt, schema| {
            let api_key = api_key.to_string();
            let provider = provider.clone();
            Box::pin(async move {
                request_ai_json_with_schema_fallback(
                    &api_key,
                    &provider,
                    &system_prompt,
                    &input,
                    &kind,
                    schema,
                )
                .await
            })
        },
    )
    .await
}

async fn run_note_synthesis_job_with<OpenConnection, RequestProvider>(
    open_connection: OpenConnection,
    job_id: &str,
    provider: &AiProviderSettings,
    request_provider: RequestProvider,
) -> Result<NoteSynthesisJob, NoteSynthesisError>
where
    OpenConnection: Fn() -> Result<Connection, NoteSynthesisError>,
    RequestProvider: Fn(String, Value, String, Value) -> ProviderRequestFuture,
{
    let connection = open_connection()?;
    let job = get_note_synthesis_job(&connection, job_id)?;
    if job.cancel_requested_at.is_some() {
        mark_job_cancelled(&connection, job_id)?;
        return get_note_synthesis_job(&connection, job_id);
    }
    recover_interrupted_batches(&connection, job_id)?;
    set_job_running(&connection, job_id)?;
    drop(connection);

    let batch_indices = pending_batch_indices_with(&open_connection, job_id)?;
    for batch_index in batch_indices {
        let connection = open_connection()?;
        if cancel_requested(&connection, job_id)? {
            mark_job_cancelled(&connection, job_id)?;
            return get_note_synthesis_job(&connection, job_id);
        }
        let batch_input = read_batch_input(&connection, job_id, batch_index)?;
        begin_batch(&connection, job_id, batch_index)?;
        drop(connection);

        let result = request_provider(
            "reading_note_batch_summary".to_string(),
            batch_input.clone(),
            note_synthesis_batch_system_prompt().to_string(),
            note_synthesis_batch_json_schema(),
        )
        .await;

        let connection = open_connection()?;
        match result {
            Ok(result) => {
                if cancel_requested(&connection, job_id)? {
                    mark_batch_cancelled(&connection, job_id, batch_index)?;
                    mark_job_cancelled(&connection, job_id)?;
                    return get_note_synthesis_job(&connection, job_id);
                }
                if let Err(error) = validate_batch_output(&result.value, &batch_input) {
                    mark_batch_failed(
                        &connection,
                        job_id,
                        batch_index,
                        "invalid_provider_output",
                        &error,
                    )?;
                    mark_job_partial(&connection, job_id, "invalid_provider_output", &error)?;
                    return get_note_synthesis_job(&connection, job_id);
                }
                complete_batch(
                    &connection,
                    job_id,
                    batch_index,
                    &result.value,
                    &batch_input,
                )?;
            }
            Err(error) => {
                let code = error.code();
                let message = error.user_message();
                mark_batch_failed(&connection, job_id, batch_index, code, &message)?;
                mark_job_partial(&connection, job_id, code, &message)?;
                return get_note_synthesis_job(&connection, job_id);
            }
        }
    }

    let connection = open_connection()?;
    if cancel_requested(&connection, job_id)? {
        mark_job_cancelled(&connection, job_id)?;
        return get_note_synthesis_job(&connection, job_id);
    }
    set_job_merging(&connection, job_id)?;
    let merge_input = read_merge_input(&connection, job_id)?;
    let job = get_note_synthesis_job(&connection, job_id)?;
    drop(connection);

    let merge_result = request_provider(
        "book_notes_summary_full".to_string(),
        merge_input,
        book_notes_summary_system_prompt().to_string(),
        book_notes_summary_json_schema(),
    )
    .await;
    let merge_result = match merge_result {
        Ok(value) => value,
        Err(error) => {
            let connection = open_connection()?;
            mark_job_failed(&connection, job_id, error.code(), &error.user_message())?;
            return get_note_synthesis_job(&connection, job_id);
        }
    };
    let connection = open_connection()?;
    if cancel_requested(&connection, job_id)? {
        mark_job_cancelled(&connection, job_id)?;
        return get_note_synthesis_job(&connection, job_id);
    }
    drop(connection);
    let source_stats = read_source_stats_with(&open_connection, job_id)?;
    let summary = match normalize_summary_output(
        merge_result.value,
        source_stats,
        current_unix_seconds(),
        FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        merge_result.response_format,
    ) {
        Ok(summary) => summary,
        Err(error) => {
            let connection = open_connection()?;
            mark_job_failed(&connection, job_id, error.code(), &error.user_message())?;
            return get_note_synthesis_job(&connection, job_id);
        }
    };
    let output = serde_json::to_value(summary).map_err(NoteSynthesisError::storage)?;
    let input_hash = stable_hash_parts([
        job.source_snapshot_hash.as_str(),
        FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION,
    ]);
    let connection = open_connection()?;
    finalize_completed_job(&connection, &job, output, input_hash, provider)?;
    get_note_synthesis_job(&connection, job_id)
}

fn pending_batch_indices_with(
    open_connection: &impl Fn() -> Result<Connection, NoteSynthesisError>,
    job_id: &str,
) -> Result<Vec<usize>, NoteSynthesisError> {
    let connection = open_connection()?;
    let mut statement = connection
        .prepare(
            "SELECT batch_index FROM note_synthesis_batches
             WHERE job_id = ?1 AND status IN ('pending', 'failed')
             ORDER BY batch_index ASC",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement
        .query_map([job_id], |row| row.get::<_, i64>(0))
        .map_err(NoteSynthesisError::storage)?;
    rows.map(|row| {
        row.map(|value| value as usize)
            .map_err(NoteSynthesisError::storage)
    })
    .collect()
}

fn read_batch_input(
    connection: &Connection,
    job_id: &str,
    batch_index: usize,
) -> Result<Value, NoteSynthesisError> {
    let mut statement = connection
        .prepare(
            "SELECT document_id, source_type, chapter_title, title, content_snapshot
             FROM note_synthesis_job_items
             WHERE job_id = ?1 AND batch_index = ?2 AND audit_status = 'pending'
             ORDER BY document_id ASC",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement
        .query_map(params![job_id, batch_index as i64], |row| {
            Ok(json!({
                "documentId": row.get::<_, String>(0)?,
                "noteType": row.get::<_, String>(1)?,
                "chapter": row.get::<_, Option<String>>(2)?,
                "title": row.get::<_, Option<String>>(3)?,
                "content": row.get::<_, String>(4)?,
            }))
        })
        .map_err(NoteSynthesisError::storage)?;
    let notes = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(NoteSynthesisError::storage)?;
    if notes.is_empty() {
        return Err(NoteSynthesisError::InvalidState(
            "批次没有可发送的快照笔记。".to_string(),
        ));
    }
    Ok(json!({
        "batchIndex": batch_index,
        "notes": notes,
    }))
}

fn validate_batch_output(value: &Value, input: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "批次摘要必须是 JSON 对象。".to_string())?;
    let source_ids = object
        .get("sourceDocumentIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "批次摘要缺少 sourceDocumentIds。".to_string())?;
    let allowed = input["notes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|note| note["documentId"].as_str())
        .collect::<std::collections::HashSet<_>>();
    if source_ids
        .iter()
        .any(|id| id.as_str().is_none_or(|id| !allowed.contains(id)))
    {
        return Err("批次摘要引用了不属于当前快照的文档。".to_string());
    }
    if object.get("overview").and_then(Value::as_str).is_none() {
        return Err("批次摘要缺少 overview。".to_string());
    }
    Ok(())
}

fn begin_batch(
    connection: &Connection,
    job_id: &str,
    batch_index: usize,
) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection.execute(
        "UPDATE note_synthesis_batches SET status = 'running', attempt_count = attempt_count + 1,
         last_started_at = ?3, error_code = NULL, error_message = NULL, updated_at = ?3
         WHERE job_id = ?1 AND batch_index = ?2",
        params![job_id, batch_index as i64, now],
    ).map_err(NoteSynthesisError::storage)?;
    connection.execute(
        "UPDATE note_synthesis_jobs SET status = 'summarizing', last_started_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![job_id, now],
    ).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn complete_batch(
    connection: &Connection,
    job_id: &str,
    batch_index: usize,
    output: &Value,
    input: &Value,
) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    let output_json = serde_json::to_string(output).map_err(NoteSynthesisError::storage)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(NoteSynthesisError::storage)?;
    transaction
        .execute(
            "UPDATE note_synthesis_batches SET status = 'completed', output_json = ?3,
         completed_at = ?4, error_code = NULL, error_message = NULL, updated_at = ?4
         WHERE job_id = ?1 AND batch_index = ?2",
            params![job_id, batch_index as i64, output_json, now],
        )
        .map_err(NoteSynthesisError::storage)?;
    let source_ids = input["notes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|note| note["documentId"].as_str());
    for document_id in source_ids {
        transaction
            .execute(
                "UPDATE note_synthesis_job_items SET audit_status = 'processed', processed_at = ?3
             WHERE job_id = ?1 AND document_id = ?2 AND audit_status = 'pending'",
                params![job_id, document_id, now],
            )
            .map_err(NoteSynthesisError::storage)?;
    }
    refresh_job_counts(&transaction, job_id, &now)?;
    transaction.commit().map_err(NoteSynthesisError::storage)
}

fn read_merge_input(connection: &Connection, job_id: &str) -> Result<Value, NoteSynthesisError> {
    let mut statement = connection
        .prepare(
            "SELECT batch_index, output_json FROM note_synthesis_batches
         WHERE job_id = ?1 AND status = 'completed' ORDER BY batch_index ASC",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement.query_map([job_id], |row| {
        let output = row.get::<_, String>(1)?;
        Ok(json!({ "batchIndex": row.get::<_, i64>(0)?, "summary": serde_json::from_str::<Value>(&output).unwrap_or(Value::Null) }))
    }).map_err(NoteSynthesisError::storage)?;
    let summaries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(NoteSynthesisError::storage)?;
    Ok(json!({ "mode": "fullSnapshot", "batchSummaries": summaries }))
}

fn read_source_stats_with(
    open_connection: &impl Fn() -> Result<Connection, NoteSynthesisError>,
    job_id: &str,
) -> Result<BookAiSummarySourceStats, NoteSynthesisError> {
    let connection = open_connection()?;
    let (highlight_count, thought_count): (i64, i64) = connection
        .query_row(
            "SELECT
            COALESCE(SUM(CASE WHEN source_type = 'highlight' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN source_type = 'thought' THEN 1 ELSE 0 END), 0)
         FROM note_synthesis_job_items WHERE job_id = ?1",
            [job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(NoteSynthesisError::storage)?;
    Ok(BookAiSummarySourceStats {
        highlight_count: highlight_count as usize,
        thought_count: thought_count as usize,
        bookmark_count: 0,
        chapter_count: connection.query_row("SELECT COUNT(DISTINCT chapter_uid) FROM note_synthesis_job_items WHERE job_id = ?1 AND chapter_uid IS NOT NULL", [job_id], |row| row.get::<_, i64>(0)).map_err(NoteSynthesisError::storage)? as usize,
        included_highlight_count: highlight_count as usize,
        included_thought_count: thought_count as usize,
        selection: None,
    })
}

fn refresh_job_counts(
    connection: &Connection,
    job_id: &str,
    now: &str,
) -> Result<(), NoteSynthesisError> {
    connection.execute(
        "UPDATE note_synthesis_jobs SET
            processed_count = (SELECT COUNT(*) FROM note_synthesis_job_items WHERE job_id = ?1 AND audit_status <> 'pending'),
            completed_batch_count = (SELECT COUNT(*) FROM note_synthesis_batches WHERE job_id = ?1 AND status = 'completed'),
            failed_batch_count = (SELECT COUNT(*) FROM note_synthesis_batches WHERE job_id = ?1 AND status = 'failed'),
            updated_at = ?2 WHERE id = ?1",
        params![job_id, now],
    ).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn recover_interrupted_batches(
    connection: &Connection,
    job_id: &str,
) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection
        .execute(
            "UPDATE note_synthesis_batches
             SET status = 'pending', error_code = 'interrupted',
                 error_message = '应用在 Provider 请求期间退出，批次已等待显式继续', updated_at = ?2
             WHERE job_id = ?1 AND status = 'running'",
            params![job_id, now],
        )
        .map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn set_job_running(connection: &Connection, job_id: &str) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection.execute("UPDATE note_synthesis_jobs SET status = 'summarizing', last_started_at = ?2, updated_at = ?2 WHERE id = ?1", params![job_id, now]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn set_job_merging(connection: &Connection, job_id: &str) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection
        .execute(
            "UPDATE note_synthesis_jobs SET status = 'merging', updated_at = ?2 WHERE id = ?1",
            params![job_id, now],
        )
        .map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn cancel_requested(connection: &Connection, job_id: &str) -> Result<bool, NoteSynthesisError> {
    connection
        .query_row(
            "SELECT cancel_requested_at IS NOT NULL FROM note_synthesis_jobs WHERE id = ?1",
            [job_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(NoteSynthesisError::storage)
}

fn mark_batch_cancelled(
    connection: &Connection,
    job_id: &str,
    batch_index: usize,
) -> Result<(), NoteSynthesisError> {
    connection.execute("UPDATE note_synthesis_batches SET status = 'cancelled', updated_at = ?3 WHERE job_id = ?1 AND batch_index = ?2 AND status = 'running'", params![job_id, batch_index as i64, current_unix_seconds()]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn mark_job_cancelled(connection: &Connection, job_id: &str) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection.execute("UPDATE note_synthesis_jobs SET status = 'cancelled', finished_at = ?2, updated_at = ?2 WHERE id = ?1 AND status <> 'completed'", params![job_id, now]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn mark_batch_failed(
    connection: &Connection,
    job_id: &str,
    batch_index: usize,
    code: &str,
    message: &str,
) -> Result<(), NoteSynthesisError> {
    connection.execute("UPDATE note_synthesis_batches SET status = 'failed', error_code = ?3, error_message = ?4, updated_at = ?5 WHERE job_id = ?1 AND batch_index = ?2", params![job_id, batch_index as i64, code, message, current_unix_seconds()]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn mark_job_partial(
    connection: &Connection,
    job_id: &str,
    code: &str,
    message: &str,
) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    refresh_job_counts(connection, job_id, &now)?;
    connection.execute("UPDATE note_synthesis_jobs SET status = 'partial', error_code = ?2, error_message = ?3, updated_at = ?4 WHERE id = ?1", params![job_id, code, message, now]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn mark_job_failed(
    connection: &Connection,
    job_id: &str,
    code: &str,
    message: &str,
) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection.execute("UPDATE note_synthesis_jobs SET status = 'failed', finished_at = ?2, error_code = ?3, error_message = ?4, updated_at = ?2 WHERE id = ?1", params![job_id, now, code, message]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn reset_failed_batches(connection: &Connection, job_id: &str) -> Result<(), NoteSynthesisError> {
    let now = current_unix_seconds();
    connection.execute("UPDATE note_synthesis_batches SET status = 'pending', error_code = NULL, error_message = NULL, updated_at = ?2 WHERE job_id = ?1 AND status = 'failed'", params![job_id, now]).map_err(NoteSynthesisError::storage)?;
    connection.execute("UPDATE note_synthesis_jobs SET status = 'partial', error_code = NULL, error_message = NULL, finished_at = NULL, updated_at = ?2 WHERE id = ?1", params![job_id, now]).map_err(NoteSynthesisError::storage)?;
    Ok(())
}

fn verify_full_coverage(
    connection: &Connection,
    job_id: &str,
    total_count: usize,
    batch_count: usize,
) -> Result<bool, NoteSynthesisError> {
    let processed_count = connection
        .query_row(
            "SELECT COUNT(*) FROM note_synthesis_job_items
             WHERE job_id = ?1 AND audit_status <> 'pending' AND audit_status <> 'failed'",
            [job_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(NoteSynthesisError::storage)? as usize;
    let (completed_batches, failed_batches, unfinished_batches): (i64, i64, i64) = connection
        .query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status IN ('pending', 'running') THEN 1 ELSE 0 END), 0)
             FROM note_synthesis_batches WHERE job_id = ?1",
            [job_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(NoteSynthesisError::storage)?;
    Ok(processed_count == total_count
        && completed_batches as usize == batch_count
        && failed_batches == 0
        && unfinished_batches == 0)
}

fn finalize_completed_job(
    connection: &Connection,
    job: &NoteSynthesisJob,
    output: Value,
    input_hash: String,
    provider: &AiProviderSettings,
) -> Result<(), NoteSynthesisError> {
    let coverage = verify_full_coverage(connection, &job.id, job.total_count, job.batch_count)?;
    if !coverage {
        return Err(NoteSynthesisError::InvalidState(
            "全量归纳尚未覆盖全部快照笔记或存在失败批次。".to_string(),
        ));
    }
    let now = current_unix_seconds();
    let transaction = connection
        .unchecked_transaction()
        .map_err(NoteSynthesisError::storage)?;
    let draft = AiOutputUpsert {
        feature: "book-notes-summary".to_string(),
        scope_id: job.book_id.clone(),
        prompt_version: FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION.to_string(),
        input_hash: input_hash.clone(),
        output,
        source_count: Some(job.total_count as i64),
        provider_model: Some(provider.model.clone()),
    };
    crate::services::ai::upsert_ai_output(&transaction, &draft, &now).map_err(map_ai_error)?;
    transaction
        .execute(
            "UPDATE note_synthesis_jobs SET status = 'completed', processed_count = total_count,
         completed_batch_count = batch_count, failed_batch_count = 0,
         result_feature = ?2, result_prompt_version = ?3, result_input_hash = ?4,
         error_code = NULL, error_message = NULL, finished_at = ?5, updated_at = ?5
         WHERE id = ?1",
            params![job.id, draft.feature, draft.prompt_version, input_hash, now],
        )
        .map_err(NoteSynthesisError::storage)?;
    transaction.commit().map_err(NoteSynthesisError::storage)
}

fn note_synthesis_batch_system_prompt() -> &'static str {
    "你是阅读笔记全量归纳的批次分析器。只基于输入中的笔记生成简体中文 JSON。必须保留 sourceDocumentIds，且只能填写输入中出现的 documentId；不得补造文档。overview 必须概括本批次，keyIdeas、myFocus、actionItems、themeTags、representativeQuotes、reflectionQuestions 均使用稳定结构。"
}

fn note_synthesis_batch_json_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["overview", "keyIdeas", "myFocus", "actionItems", "themeTags", "representativeQuotes", "reflectionQuestions", "sourceDocumentIds"],
        "properties": {
            "overview": { "type": "string" },
            "keyIdeas": { "type": "array", "items": { "type": "string" } },
            "myFocus": { "type": "array", "items": { "type": "string" } },
            "actionItems": { "type": "array", "items": { "type": "string" } },
            "themeTags": { "type": "array", "items": { "type": "string" } },
            "representativeQuotes": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["quote", "reason", "noteType"], "properties": { "quote": { "type": "string" }, "reason": { "type": "string" }, "chapter": { "type": "string" }, "noteType": { "type": "string", "enum": ["划线", "想法"] } } } },
            "reflectionQuestions": { "type": "array", "items": { "type": "string" } },
            "sourceDocumentIds": { "type": "array", "items": { "type": "string" } }
        }
    })
}

fn read_job_by_clause(
    connection: &Connection,
    clause: &str,
    parameter: &str,
) -> Result<Option<NoteSynthesisJob>, NoteSynthesisError> {
    let sql = format!(
        "SELECT id, book_id, status, source_snapshot_hash, total_count, processed_count,
                batch_count, completed_batch_count, failed_batch_count,
                provider_model, consent_provider_label, consent_confirmed_at,
                result_feature, result_prompt_version, result_input_hash,
                cancel_requested_at, last_started_at, finished_at,
                error_code, error_message, created_at, updated_at
         FROM note_synthesis_jobs WHERE {clause}"
    );
    let row = connection
        .query_row(&sql, [parameter], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, Option<String>>(19)?,
                row.get::<_, String>(20)?,
                row.get::<_, String>(21)?,
            ))
        })
        .optional()
        .map_err(NoteSynthesisError::storage)?;

    let Some(row) = row else {
        return Ok(None);
    };
    let status = NoteSynthesisJobStatus::parse(&row.2)?;
    let failed_batches = read_failed_batches(connection, &row.0)?;
    let coverage =
        read_coverage_report(connection, &row.0, status, row.4 as usize, row.5 as usize)?;
    let result = match (row.12, row.13, row.14) {
        (Some(feature), Some(prompt_version), Some(input_hash)) => {
            Some(NoteSynthesisResultReference {
                feature,
                prompt_version,
                input_hash,
            })
        }
        (None, None, None) => None,
        _ => {
            return Err(NoteSynthesisError::InvalidState(
                "全量归纳任务的正式资产引用不完整。".to_string(),
            ))
        }
    };

    Ok(Some(NoteSynthesisJob {
        id: row.0,
        book_id: row.1,
        status,
        source_snapshot_hash: row.3,
        total_count: row.4 as usize,
        processed_count: row.5 as usize,
        batch_count: row.6 as usize,
        completed_batch_count: row.7 as usize,
        failed_batch_count: row.8 as usize,
        provider_model: row.9,
        provider_label: row.10,
        consent_confirmed_at: row.11,
        result,
        cancel_requested_at: row.15,
        last_started_at: row.16,
        finished_at: row.17,
        error_code: row.18,
        error_message: row.19,
        failed_batches,
        coverage,
        created_at: row.20,
        updated_at: row.21,
    }))
}

fn read_failed_batches(
    connection: &Connection,
    job_id: &str,
) -> Result<Vec<NoteSynthesisFailedBatch>, NoteSynthesisError> {
    let mut statement = connection
        .prepare(
            "SELECT batch_index, source_count, attempt_count, error_code, error_message
             FROM note_synthesis_batches
             WHERE job_id = ?1 AND status = 'failed'
             ORDER BY batch_index ASC",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement
        .query_map([job_id], |row| {
            Ok(NoteSynthesisFailedBatch {
                batch_index: row.get::<_, i64>(0)? as usize,
                source_count: row.get::<_, i64>(1)? as usize,
                attempt_count: row.get::<_, i64>(2)? as usize,
                error_code: row.get(3)?,
                error_message: row.get(4)?,
            })
        })
        .map_err(NoteSynthesisError::storage)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(NoteSynthesisError::storage)
}

fn read_coverage_report(
    connection: &Connection,
    job_id: &str,
    status: NoteSynthesisJobStatus,
    total_count: usize,
    processed_count: usize,
) -> Result<NoteSynthesisCoverageReport, NoteSynthesisError> {
    let mut counts = HashMap::new();
    let mut statement = connection
        .prepare(
            "SELECT audit_status, COUNT(*)
             FROM note_synthesis_job_items
             WHERE job_id = ?1
             GROUP BY audit_status",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement
        .query_map([job_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
        })
        .map_err(NoteSynthesisError::storage)?;
    for row in rows {
        let (audit_status, count) = row.map_err(NoteSynthesisError::storage)?;
        counts.insert(audit_status, count);
    }

    Ok(NoteSynthesisCoverageReport {
        total_count,
        processed_count,
        pending_count: counts.get("pending").copied().unwrap_or_default(),
        skipped_empty_count: counts.get("skipped_empty").copied().unwrap_or_default(),
        skipped_duplicate_count: counts.get("skipped_duplicate").copied().unwrap_or_default(),
        failed_item_count: counts.get("failed").copied().unwrap_or_default(),
        full_snapshot: status == NoteSynthesisJobStatus::Completed
            && processed_count == total_count,
    })
}

fn read_snapshot_documents(
    connection: &Connection,
    book_id: &str,
) -> Result<Vec<SnapshotDocument>, NoteSynthesisError> {
    let mut statement = connection
        .prepare(
            "SELECT id, source_type, content_hash, chapter_uid, chapter_title, title,
                    content, source_updated_at
             FROM retrieval_documents
             WHERE book_id = ?1
               AND source_type IN ('highlight', 'thought')
               AND deleted_at IS NULL
             ORDER BY
               CASE WHEN chapter_uid IS NULL THEN 1 ELSE 0 END ASC,
               chapter_uid ASC,
               CASE source_type WHEN 'thought' THEN 0 ELSE 1 END ASC,
               id ASC",
        )
        .map_err(NoteSynthesisError::storage)?;
    let rows = statement
        .query_map([book_id], |row| {
            let original_content = row.get::<_, String>(6)?;
            let (content_snapshot, truncated) =
                truncate_chars(original_content.trim(), MAX_NOTE_SYNTHESIS_ITEM_CHARS);
            Ok(SnapshotDocument {
                document_id: row.get(0)?,
                source_type: row.get(1)?,
                content_hash: row.get(2)?,
                chapter_uid: row.get(3)?,
                chapter_title: row.get(4)?,
                title: row.get(5)?,
                content_snapshot,
                source_updated_at: row.get(7)?,
                audit_status: "pending",
                audit_reason: truncated.then(|| {
                    format!("内容超过 {MAX_NOTE_SYNTHESIS_ITEM_CHARS} 字符，快照已按任务预算截断")
                }),
                batch_index: None,
            })
        })
        .map_err(NoteSynthesisError::storage)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(NoteSynthesisError::storage)
}

fn prepare_snapshot_documents(mut documents: Vec<SnapshotDocument>) -> Vec<SnapshotDocument> {
    let mut first_by_normalized_content = HashMap::<String, String>::new();
    for document in &mut documents {
        let normalized = normalize_retrieval_text(&document.content_snapshot);
        if normalized.is_empty() {
            document.audit_status = "skipped_empty";
            document.audit_reason = Some("正文为空，未发送到 Provider".to_string());
            continue;
        }
        if let Some(first_document_id) = first_by_normalized_content.get(&normalized) {
            document.audit_status = "skipped_duplicate";
            document.audit_reason = Some(format!("与 {first_document_id} 内容重复，未重复发送"));
            continue;
        }
        first_by_normalized_content.insert(normalized, document.document_id.clone());
    }
    documents
}

fn build_stable_batches(documents: &mut [SnapshotDocument], max_chars: usize) -> Vec<PlannedBatch> {
    let max_chars = max_chars.max(1);
    let mut by_chapter = BTreeMap::<(bool, i64), Vec<usize>>::new();
    for (index, document) in documents.iter().enumerate() {
        if document.audit_status == "pending" {
            by_chapter
                .entry((
                    document.chapter_uid.is_none(),
                    document.chapter_uid.unwrap_or_default(),
                ))
                .or_default()
                .push(index);
        }
    }

    let mut ordered_indices = Vec::new();
    for indices in by_chapter.values() {
        let mut thoughts = indices
            .iter()
            .copied()
            .filter(|index| documents[*index].source_type == "thought")
            .collect::<Vec<_>>();
        let mut highlights = indices
            .iter()
            .copied()
            .filter(|index| documents[*index].source_type == "highlight")
            .collect::<Vec<_>>();
        thoughts.sort_by(|left, right| {
            documents[*left]
                .document_id
                .cmp(&documents[*right].document_id)
        });
        highlights.sort_by(|left, right| {
            documents[*left]
                .document_id
                .cmp(&documents[*right].document_id)
        });
        let max_len = thoughts.len().max(highlights.len());
        for offset in 0..max_len {
            if let Some(index) = thoughts.get(offset) {
                ordered_indices.push(*index);
            }
            if let Some(index) = highlights.get(offset) {
                ordered_indices.push(*index);
            }
        }
    }

    let mut batches = Vec::<PlannedBatch>::new();
    let mut current_indices = Vec::<usize>::new();
    let mut current_chars = 0_usize;
    let mut current_chapter = None;

    let flush = |indices: &mut Vec<usize>,
                 documents: &mut [SnapshotDocument],
                 batches: &mut Vec<PlannedBatch>| {
        if indices.is_empty() {
            return;
        }
        let batch_index = batches.len();
        let document_ids = indices
            .iter()
            .map(|index| {
                documents[*index].batch_index = Some(batch_index);
                documents[*index].document_id.clone()
            })
            .collect::<Vec<_>>();
        let mut source_types = indices
            .iter()
            .map(|index| documents[*index].source_type.clone())
            .collect::<Vec<_>>();
        source_types.sort();
        source_types.dedup();
        let chapter_uid = documents[indices[0]].chapter_uid;
        let input_hash = stable_hash_parts(
            indices
                .iter()
                .flat_map(|index| {
                    [
                        documents[*index].document_id.as_str(),
                        documents[*index].content_hash.as_str(),
                        documents[*index].content_snapshot.as_str(),
                    ]
                })
                .chain([NOTE_SYNTHESIS_BATCH_PROMPT_VERSION]),
        );
        batches.push(PlannedBatch {
            batch_index,
            chapter_uid,
            source_types,
            document_ids,
            input_hash,
        });
        indices.clear();
    };

    for index in ordered_indices {
        let item_chars = documents[index].content_snapshot.chars().count();
        let next_chapter = documents[index].chapter_uid;
        let chapter_changed = !current_indices.is_empty() && current_chapter != next_chapter;
        let budget_exceeded = !current_indices.is_empty() && current_chars + item_chars > max_chars;
        if chapter_changed || budget_exceeded {
            flush(&mut current_indices, documents, &mut batches);
            current_chars = 0;
        }
        current_chapter = next_chapter;
        current_chars += item_chars;
        current_indices.push(index);
    }
    flush(&mut current_indices, documents, &mut batches);
    batches
}

fn snapshot_hash(documents: &[SnapshotDocument]) -> String {
    stable_hash_parts(documents.iter().flat_map(|document| {
        [
            document.document_id.as_str(),
            document.content_hash.as_str(),
            document.content_snapshot.as_str(),
            document.audit_status,
        ]
    }))
}

pub fn stable_provider_hash(base_url: &str) -> String {
    stable_hash_parts([base_url.trim()])
}

fn stable_hash_parts<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for part in parts {
        for byte in part.as_bytes().iter().copied().chain([0xff]) {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut iterator = value.chars();
    let truncated = iterator.by_ref().take(max_chars).collect::<String>();
    if iterator.next().is_some() {
        (truncated, true)
    } else {
        (truncated, false)
    }
}

fn require_non_empty<'a>(value: &'a str, message: &str) -> Result<&'a str, NoteSynthesisError> {
    let value = value.trim();
    if value.is_empty() {
        Err(NoteSynthesisError::InvalidRequest(message.to_string()))
    } else {
        Ok(value)
    }
}

fn current_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
        .to_string()
}

fn next_job_id(book_id: &str, snapshot_hash: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = JOB_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let suffix = stable_hash_parts([book_id, snapshot_hash, &sequence.to_string()]);
    format!("note-synthesis-{timestamp}-{}", &suffix[..8])
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
    use serde_json::{json, Value};

    use crate::{
        db::initialize_schema,
        services::{
            ai::{AiProviderSettings, AiResponseFormatPolicy, AiServiceError, ProviderJsonResult},
            retrieval::rebuild_book_retrieval_documents,
        },
    };

    use super::{
        build_stable_batches, complete_batch, finalize_completed_job,
        get_active_note_synthesis_job, get_note_synthesis_job, get_note_synthesis_job_summary,
        note_synthesis_batch_json_schema, prepare_snapshot_documents, preview_note_synthesis,
        read_batch_input, recover_interrupted_batches, request_note_synthesis_cancel,
        run_note_synthesis_job_with, stable_hash_parts, start_note_synthesis,
        validate_batch_output, verify_full_coverage, NoteSynthesisJob, NoteSynthesisJobStatus,
        SnapshotDocument, StartNoteSynthesisRequest, DEFAULT_NOTE_SYNTHESIS_BATCH_MAX_CHARS,
    };

    fn seed_notes(connection: &Connection) {
        connection
            .execute(
                "INSERT INTO notebook_books (
                    book_id, title, review_count, note_count, bookmark_count,
                    total_note_count, raw_json, updated_at
                 ) VALUES ('book-1', '测试书', 2, 2, 2, 4, '{}', '100')",
                [],
            )
            .expect("book should insert");
        for (id, chapter_uid, chapter_title, content) in [
            ("h1", 1, "第一章", "第一条划线"),
            ("h2", 1, "第一章", "第二条划线"),
        ] {
            connection
                .execute(
                    "INSERT INTO highlights (
                        bookmark_id, book_id, chapter_uid, chapter_title,
                        mark_text, raw_json, updated_at
                     ) VALUES (?1, 'book-1', ?2, ?3, ?4, '{}', '100')",
                    rusqlite::params![id, chapter_uid, chapter_title, content],
                )
                .expect("highlight should insert");
        }
        for (id, chapter_uid, chapter_title, content) in [
            ("t1", 1, "第一章", "第一条想法"),
            ("t2", 2, "第二章", "第二条想法"),
        ] {
            connection
                .execute(
                    "INSERT INTO thoughts (
                        review_id, book_id, chapter_uid, chapter_name,
                        content, raw_json, updated_at
                     ) VALUES (?1, 'book-1', ?2, ?3, ?4, '{}', '100')",
                    rusqlite::params![id, chapter_uid, chapter_title, content],
                )
                .expect("thought should insert");
        }
        rebuild_book_retrieval_documents(connection, "book-1", "100")
            .expect("retrieval documents should rebuild");
    }

    fn start_request() -> StartNoteSynthesisRequest {
        StartNoteSynthesisRequest {
            book_id: "book-1".to_string(),
            provider_base_url_hash: "provider-hash".to_string(),
            provider_model: "test-model".to_string(),
            provider_label: "Test Provider".to_string(),
            consent_confirmed_at: "100".to_string(),
        }
    }

    fn test_provider() -> AiProviderSettings {
        AiProviderSettings {
            base_url: "https://provider.example/v1".to_string(),
            model: "test-model".to_string(),
            preset_id: "custom".to_string(),
            response_format_policy: AiResponseFormatPolicy::Auto,
        }
    }

    static TEMP_DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TempDatabase {
        path: std::path::PathBuf,
    }

    impl TempDatabase {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be valid")
                .as_nanos();
            let sequence = TEMP_DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "wxreadmaster-note-synthesis-{timestamp}-{sequence}.sqlite"
            ));
            let _ = fs::remove_file(&path);
            Self { path }
        }

        fn open(&self) -> Connection {
            Connection::open(&self.path).expect("temporary database should open")
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn seeded_file_database() -> (TempDatabase, String) {
        let database = TempDatabase::new();
        let mut connection = database.open();
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);
        let job = start_note_synthesis(&mut connection, start_request()).expect("job should start");
        (database, job.job.id)
    }

    fn valid_batch_result(input: &Value) -> ProviderJsonResult {
        ProviderJsonResult {
            value: json!({
                "overview": "批次摘要",
                "sourceDocumentIds": input["notes"]
                    .as_array()
                    .expect("batch input should include notes")
                    .iter()
                    .map(|note| note["documentId"].clone())
                    .collect::<Vec<_>>(),
            }),
            response_format: None,
        }
    }

    fn valid_merge_result() -> ProviderJsonResult {
        ProviderJsonResult {
            value: json!({
                "overview": "完整复盘",
                "keyIdeas": ["核心观点"],
                "myFocus": ["关注重点"],
                "actionItems": ["整理一条行动"],
                "themeTags": ["主题"],
                "representativeQuotes": [],
                "reflectionQuestions": ["接下来验证什么？"]
            }),
            response_format: None,
        }
    }

    fn run_scripted_job(
        database: &TempDatabase,
        job_id: &str,
        responses: Vec<Result<ProviderJsonResult, AiServiceError>>,
    ) -> impl std::future::Future<Output = Result<NoteSynthesisJob, super::NoteSynthesisError>>
    {
        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        let database_path = database.path.clone();
        let job_id = job_id.to_string();
        let provider = test_provider();
        Box::pin(async move {
            run_note_synthesis_job_with(
                || Connection::open(&database_path).map_err(super::NoteSynthesisError::storage),
                &job_id,
                &provider,
                move |_kind, input, _prompt, _schema| {
                    let response = responses
                        .lock()
                        .expect("scripted provider lock should succeed")
                        .pop_front()
                        .unwrap_or_else(|| Ok(valid_batch_result(&input)));
                    Box::pin(async move { response })
                },
            )
            .await
        })
    }

    #[tokio::test]
    async fn provider_batch_network_error_preserves_retryable_partial_job() {
        let (database, job_id) = seeded_file_database();

        let job = run_scripted_job(
            &database,
            &job_id,
            vec![Err(AiServiceError::ProviderNetwork("offline".to_string()))],
        )
        .await
        .expect("provider failure should resolve the job state");

        assert_eq!(job.status, NoteSynthesisJobStatus::Partial);
        assert_eq!(job.failed_batch_count, 1);
        assert_eq!(
            job.failed_batches[0].error_code.as_deref(),
            Some("ai_provider_network_error")
        );
        let connection = database.open();
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
    }

    #[tokio::test]
    async fn invalid_batch_output_is_rejected_without_publishing_summary() {
        let (database, job_id) = seeded_file_database();
        let invalid = ProviderJsonResult {
            value: json!({ "overview": "缺少来源" }),
            response_format: None,
        };

        let job = run_scripted_job(&database, &job_id, vec![Ok(invalid)])
            .await
            .expect("invalid output should resolve the job state");

        assert_eq!(job.status, NoteSynthesisJobStatus::Partial);
        assert_eq!(
            job.failed_batches[0].error_code.as_deref(),
            Some("invalid_provider_output")
        );
        let connection = database.open();
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
    }

    #[tokio::test]
    async fn complete_job_publishes_one_full_summary_after_all_batches() {
        let (database, job_id) = seeded_file_database();

        let job = run_scripted_job(
            &database,
            &job_id,
            vec![
                Ok(valid_batch_result(&json!({
                    "notes": [{ "documentId": "note:thought:t1" }, { "documentId": "note:highlight:h1" }, { "documentId": "note:highlight:h2" }]
                }))),
                Ok(valid_batch_result(&json!({
                    "notes": [{ "documentId": "note:thought:t2" }]
                }))),
                Ok(valid_merge_result()),
            ],
        )
        .await
        .expect("complete scripted job should succeed");

        assert_eq!(job.status, NoteSynthesisJobStatus::Completed);
        assert!(job.coverage.full_snapshot);
        assert_eq!(job.completed_batch_count, job.batch_count);
        assert_eq!(
            job.result
                .as_ref()
                .map(|result| result.prompt_version.as_str()),
            Some(super::FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION)
        );
        let connection = database.open();
        let outputs: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM ai_outputs WHERE feature = 'book-notes-summary' AND prompt_version = ?1",
                [super::FULL_BOOK_NOTES_SUMMARY_PROMPT_VERSION],
                |row| row.get(0),
            )
            .expect("full output count should read");
        assert_eq!(outputs, 1);
    }

    #[tokio::test]
    async fn merge_provider_error_keeps_batch_results_without_publishing_summary() {
        let (database, job_id) = seeded_file_database();
        let first = valid_batch_result(&json!({
            "notes": [{ "documentId": "note:thought:t1" }, { "documentId": "note:highlight:h1" }, { "documentId": "note:highlight:h2" }]
        }));
        let second = valid_batch_result(&json!({
            "notes": [{ "documentId": "note:thought:t2" }]
        }));
        let job = run_scripted_job(
            &database,
            &job_id,
            vec![
                Ok(first),
                Ok(second),
                Err(AiServiceError::ProviderNetwork("merge offline".to_string())),
            ],
        )
        .await
        .expect("merge failure should resolve the job state");

        assert_eq!(job.status, NoteSynthesisJobStatus::Failed);
        assert_eq!(job.completed_batch_count, job.batch_count);
        assert_eq!(job.error_code.as_deref(), Some("ai_provider_network_error"));
        let connection = database.open();
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
    }

    #[tokio::test]
    async fn invalid_merge_output_fails_without_publishing_summary() {
        let (database, job_id) = seeded_file_database();
        let job = run_scripted_job(
            &database,
            &job_id,
            vec![
                Ok(valid_batch_result(&json!({
                    "notes": [{ "documentId": "note:thought:t1" }, { "documentId": "note:highlight:h1" }, { "documentId": "note:highlight:h2" }]
                }))),
                Ok(valid_batch_result(&json!({
                    "notes": [{ "documentId": "note:thought:t2" }]
                }))),
                Ok(ProviderJsonResult {
                    value: json!({ "keyIdeas": ["缺少摘要"] }),
                    response_format: None,
                }),
            ],
        )
        .await
        .expect("invalid merge output should resolve job state");

        assert_eq!(job.status, NoteSynthesisJobStatus::Failed);
        assert_eq!(job.error_code.as_deref(), Some("ai_provider_output_error"));
        let connection = database.open();
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
    }

    #[tokio::test]
    async fn cancellation_after_merge_request_prevents_full_summary_publish() {
        let (database, job_id) = seeded_file_database();
        let database_path = database.path.clone();
        let cancellation_database_path = database.path.clone();
        let cancellation_job_id = job_id.clone();
        let responses = Arc::new(Mutex::new(VecDeque::from(vec![
            Ok(valid_batch_result(&json!({
                "notes": [{ "documentId": "note:thought:t1" }, { "documentId": "note:highlight:h1" }, { "documentId": "note:highlight:h2" }]
            }))),
            Ok(valid_batch_result(&json!({
                "notes": [{ "documentId": "note:thought:t2" }]
            }))),
            Ok(valid_merge_result()),
        ])));
        let provider = test_provider();
        let job = run_note_synthesis_job_with(
            || Connection::open(&database_path).map_err(super::NoteSynthesisError::storage),
            &job_id,
            &provider,
            move |kind, input, _prompt, _schema| {
                if kind == "book_notes_summary_full" {
                    let cancellation_connection = Connection::open(&cancellation_database_path)
                        .expect("cancellation connection should open");
                    request_note_synthesis_cancel(&cancellation_connection, &cancellation_job_id)
                        .expect("cancellation should persist");
                }
                let response = responses
                    .lock()
                    .expect("scripted provider lock should succeed")
                    .pop_front()
                    .unwrap_or_else(|| Ok(valid_batch_result(&input)));
                Box::pin(async move { response })
            },
        )
        .await
        .expect("cancelled merge should resolve job state");

        assert_eq!(job.status, NoteSynthesisJobStatus::Cancelled);
        let connection = database.open();
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
    }

    #[test]
    fn preview_counts_all_local_notes_without_provider_limit() {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);

        let preview = preview_note_synthesis(
            &connection,
            "book-1",
            "test-model".to_string(),
            "Test Provider".to_string(),
        )
        .expect("preview should build");

        assert_eq!(preview.total_count, 4);
        assert_eq!(preview.highlight_count, 2);
        assert_eq!(preview.thought_count, 2);
        assert_eq!(preview.estimated_batch_count, 2);
        assert!(!preview.current_source_hash.is_empty());
        assert!(preview.active_job.is_none());
    }

    #[test]
    fn preview_source_hash_matches_new_job_and_changes_with_current_notes() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);

        let initial_preview = preview_note_synthesis(
            &connection,
            "book-1",
            "test-model".to_string(),
            "Test Provider".to_string(),
        )
        .expect("initial preview should build");
        let started =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");

        assert_eq!(
            initial_preview.current_source_hash,
            started.job.source_snapshot_hash
        );

        connection
            .execute(
                "UPDATE highlights SET mark_text = '源笔记已修改' WHERE bookmark_id = 'h1'",
                [],
            )
            .expect("source note should update");
        let changed_preview = preview_note_synthesis(
            &connection,
            "book-1",
            "test-model".to_string(),
            "Test Provider".to_string(),
        )
        .expect("changed preview should build");

        assert_ne!(
            changed_preview.current_source_hash,
            started.job.source_snapshot_hash
        );
    }

    #[test]
    fn start_persists_immutable_snapshot_and_is_idempotent_per_book() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);

        let first =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");
        let second = start_note_synthesis(&mut connection, start_request())
            .expect("active job should return");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(first.job.id, second.job.id);
        assert_eq!(first.job.total_count, 4);
        assert_eq!(first.job.status, NoteSynthesisJobStatus::Queued);
        assert_eq!(first.job.coverage.pending_count, 4);
        let snapshot: String = connection
            .query_row(
                "SELECT content_snapshot FROM note_synthesis_job_items
                 WHERE job_id = ?1 AND document_id = 'note:highlight:h1'",
                [&first.job.id],
                |row| row.get(0),
            )
            .expect("snapshot should read");
        connection
            .execute(
                "UPDATE highlights SET mark_text = '源笔记已修改' WHERE bookmark_id = 'h1'",
                [],
            )
            .expect("source note should update");
        assert_eq!(snapshot, "第一条划线");
        assert_eq!(
            get_active_note_synthesis_job(&connection, "book-1")
                .expect("active job should read")
                .expect("active job should exist")
                .id,
            first.job.id
        );
    }

    #[test]
    fn empty_and_duplicate_notes_are_audited_without_batches() {
        let mut documents = vec![
            document("a", "highlight", "  ", Some(1)),
            document("b", "highlight", "重复正文", Some(1)),
            document("c", "thought", "重复正文", Some(1)),
        ];
        documents = prepare_snapshot_documents(documents);
        let batches = build_stable_batches(&mut documents, DEFAULT_NOTE_SYNTHESIS_BATCH_MAX_CHARS);

        assert_eq!(documents[0].audit_status, "skipped_empty");
        assert_eq!(documents[1].audit_status, "pending");
        assert_eq!(documents[2].audit_status, "skipped_duplicate");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].document_ids, vec!["b"]);
    }

    #[test]
    fn stable_batching_prefers_chapters_and_interleaves_note_types() {
        let mut documents = vec![
            document("h2", "highlight", "2222", Some(1)),
            document("h1", "highlight", "1111", Some(1)),
            document("t1", "thought", "3333", Some(1)),
            document("t2", "thought", "4444", Some(2)),
        ];
        let batches = build_stable_batches(&mut documents, 20);

        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].document_ids, vec!["t1", "h1", "h2"]);
        assert_eq!(batches[1].document_ids, vec!["t2"]);
        assert_eq!(batches[0].source_types, vec!["highlight", "thought"]);
    }

    #[test]
    fn batch_output_rejects_document_ids_outside_snapshot() {
        let input = serde_json::json!({
            "notes": [{ "documentId": "doc-1" }]
        });
        let output = serde_json::json!({
            "overview": "摘要",
            "sourceDocumentIds": ["doc-2"]
        });

        let error = validate_batch_output(&output, &input).expect_err("foreign id should fail");

        assert!(error.contains("不属于当前快照"));
        assert_eq!(
            note_synthesis_batch_json_schema()["additionalProperties"],
            false
        );
    }

    #[test]
    fn interrupted_batch_is_recovered_and_completed_batch_updates_coverage() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);
        let started =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");
        connection
            .execute(
                "UPDATE note_synthesis_batches SET status = 'running' WHERE job_id = ?1 AND batch_index = 0",
                [&started.job.id],
            )
            .expect("batch should run");

        recover_interrupted_batches(&connection, &started.job.id)
            .expect("interrupted batch should recover");
        let status: String = connection
            .query_row(
                "SELECT status FROM note_synthesis_batches WHERE job_id = ?1 AND batch_index = 0",
                [&started.job.id],
                |row| row.get(0),
            )
            .expect("batch status should read");
        assert_eq!(status, "pending");

        let input = read_batch_input(&connection, &started.job.id, 0).expect("input should read");
        let source_ids = input["notes"]
            .as_array()
            .expect("notes should exist")
            .iter()
            .map(|note| note["documentId"].clone())
            .collect::<Vec<_>>();
        complete_batch(
            &connection,
            &started.job.id,
            0,
            &serde_json::json!({ "overview": "第一批", "sourceDocumentIds": source_ids }),
            &input,
        )
        .expect("batch should complete");

        assert!(!verify_full_coverage(
            &connection,
            &started.job.id,
            started.job.total_count,
            started.job.batch_count
        )
        .expect("coverage should verify"));
        let job = get_note_synthesis_job(&connection, &started.job.id).expect("job should read");
        assert_eq!(job.completed_batch_count, 1);
        assert!(job.processed_count > 0);
        assert!(job.processed_count < job.total_count);
    }

    #[test]
    fn incomplete_coverage_rejects_final_publish_without_writing_output() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);
        let started =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");

        let error = finalize_completed_job(
            &connection,
            &started.job,
            json!({ "overview": "不应发布" }),
            "input-hash".to_string(),
            &test_provider(),
        )
        .expect_err("incomplete coverage must reject publishing");

        assert_eq!(error.code(), "invalid_note_synthesis_state");
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
        assert_eq!(
            get_note_synthesis_job(&connection, &started.job.id)
                .expect("job should read")
                .status,
            NoteSynthesisJobStatus::Queued
        );
    }

    #[test]
    fn publish_transaction_rolls_back_when_completion_update_fails() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);
        let started =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");
        for batch_index in 0..started.job.batch_count {
            let input = read_batch_input(&connection, &started.job.id, batch_index)
                .expect("batch input should read");
            complete_batch(
                &connection,
                &started.job.id,
                batch_index,
                &valid_batch_result(&input).value,
                &input,
            )
            .expect("batch should complete");
        }
        connection
            .execute_batch(
                "CREATE TRIGGER reject_synthesis_completion
                 BEFORE UPDATE OF status ON note_synthesis_jobs
                 WHEN NEW.status = 'completed'
                 BEGIN SELECT RAISE(ABORT, 'forced completion failure'); END;",
            )
            .expect("trigger should install");

        let job = get_note_synthesis_job(&connection, &started.job.id).expect("job should read");
        let error = finalize_completed_job(
            &connection,
            &job,
            json!({ "overview": "不应保留" }),
            stable_hash_parts(["transaction-test"]),
            &test_provider(),
        )
        .expect_err("completion trigger should abort publish");

        assert_eq!(error.code(), "note_synthesis_storage_error");
        let outputs: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_outputs", [], |row| row.get(0))
            .expect("output count should read");
        assert_eq!(outputs, 0);
        let job = get_note_synthesis_job(&connection, &started.job.id).expect("job should read");
        assert_ne!(job.status, NoteSynthesisJobStatus::Completed);
        assert!(job.result.is_none());
    }

    #[test]
    fn queued_job_can_be_cancelled_without_provider_work() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);
        let started =
            start_note_synthesis(&mut connection, start_request()).expect("job should start");

        let cancelled =
            request_note_synthesis_cancel(&connection, &started.job.id).expect("job should cancel");

        assert_eq!(cancelled.status, NoteSynthesisJobStatus::Cancelled);
        assert!(cancelled.cancel_requested_at.is_some());
        assert!(get_active_note_synthesis_job(&connection, "book-1")
            .expect("active job query should succeed")
            .is_none());
        assert_eq!(
            get_note_synthesis_job(&connection, &started.job.id)
                .expect("job should remain queryable")
                .status,
            NoteSynthesisJobStatus::Cancelled
        );
    }

    #[test]
    fn job_summary_keeps_active_completed_and_latest_terminal_jobs_separate() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        seed_notes(&connection);

        let completed = start_note_synthesis(&mut connection, start_request())
            .expect("completed job should start");
        connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET status = 'completed',
                     processed_count = total_count,
                     completed_batch_count = batch_count,
                     failed_batch_count = 0,
                     result_feature = 'book-notes-summary',
                     result_prompt_version = 'book-notes-summary-full-v1',
                     result_input_hash = 'completed-input',
                     finished_at = '200',
                     updated_at = '200'
                 WHERE id = ?1",
                [&completed.job.id],
            )
            .expect("completed job should update");

        let failed = start_note_synthesis(&mut connection, start_request())
            .expect("failed job should start");
        connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET status = 'failed', finished_at = '300', updated_at = '300'
                 WHERE id = ?1",
                [&failed.job.id],
            )
            .expect("failed job should update");

        let active = start_note_synthesis(&mut connection, start_request())
            .expect("active job should start");
        let summary =
            get_note_synthesis_job_summary(&connection, "book-1").expect("job summary should read");

        assert_eq!(
            summary.active_job.as_ref().map(|job| job.id.as_str()),
            Some(active.job.id.as_str())
        );
        assert_eq!(
            summary
                .latest_completed_job
                .as_ref()
                .map(|job| job.id.as_str()),
            Some(completed.job.id.as_str())
        );
        assert_eq!(
            summary
                .latest_terminal_job
                .as_ref()
                .map(|job| job.id.as_str()),
            Some(failed.job.id.as_str())
        );
    }

    fn document(
        id: &str,
        source_type: &str,
        content: &str,
        chapter_uid: Option<i64>,
    ) -> SnapshotDocument {
        SnapshotDocument {
            document_id: id.to_string(),
            source_type: source_type.to_string(),
            content_hash: format!("hash-{id}"),
            chapter_uid,
            chapter_title: chapter_uid.map(|value| format!("第{value}章")),
            title: None,
            content_snapshot: content.to_string(),
            source_updated_at: "100".to_string(),
            audit_status: "pending",
            audit_reason: None,
            batch_index: None,
        }
    }
}
