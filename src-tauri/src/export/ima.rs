use chrono::{Datelike, Duration, Local, TimeZone};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    db,
    repositories::ima_exports::{
        current_unix_seconds, ImaBeginAttemptResult, ImaExistingExport, ImaExportAttempt,
        ImaExportChunk, ImaExportRepository,
    },
    services::ima_credentials::try_begin_ima_write,
};

use super::{
    document::{ExportDocument, ExportSourceKind},
    ima_client::{ImaClient, ImaClientError, ImaKnowledgeLocation, ImaNoteLocation},
    targets::{
        ExportTargetError, ExportTargetResult, ExportTargetStatus, ExternalExportTarget,
        ImaExportOverrides,
    },
};

const MAX_CHUNK_BYTES: usize = 160 * 1024;
const CHUNKER_VERSION: &str = "ima-v1";

#[derive(Debug, Clone)]
struct FrozenChunk {
    start_byte: usize,
    end_byte: usize,
    content: String,
    hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkdownChunkBoundaryKind {
    PrimaryHeading,
    Block,
}

#[derive(Debug, Clone, Copy)]
struct MarkdownChunkBoundary {
    offset: usize,
    kind: MarkdownChunkBoundaryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImaDestination {
    #[serde(default)]
    credential_scope_hash: String,
    #[serde(
        default,
        serialize_with = "serialize_folder_scope_id",
        deserialize_with = "deserialize_folder_scope_id"
    )]
    note_folder_id: Option<String>,
    knowledge_base_id: Option<String>,
    #[serde(
        default,
        serialize_with = "serialize_folder_scope_id",
        deserialize_with = "deserialize_folder_scope_id"
    )]
    knowledge_base_folder_id: Option<String>,
    publish_to_knowledge_base: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImaUnknownResolution {
    ConfirmSucceeded,
    Abandon,
    CreateNewSnapshot,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImaRemoteDriftStatus {
    Healthy,
    NoteMissing,
    NoteMoved,
    KnowledgeAssociationMissing,
    KnowledgeAssociationMoved,
    MultipleChanges,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaRemoteDriftReport {
    pub operation_id: String,
    pub status: ImaRemoteDriftStatus,
    pub checked_at: String,
    pub message: String,
    pub can_create_new_snapshot: bool,
}

pub async fn export_document(
    app: &AppHandle,
    document: &ExportDocument,
    markdown: &str,
    overrides: Option<&ImaExportOverrides>,
) -> ExportTargetResult {
    if !document.source_kind.supports_ima_export() {
        return failure(
            "IMA_SOURCE_UNSUPPORTED",
            "当前 Ima 版本只支持导出微信读书笔记、书籍复盘、已结束周期的阅读复盘、阅读路线和选书决策。",
            None,
            None,
            None,
        );
    }
    if document.source_kind == ExportSourceKind::ReadingStatsReview
        && !is_completed_reading_stats_review(document, Local::now())
    {
        return failure(
            "IMA_REVIEW_NOT_FINAL",
            "只有已结束的周/月/年复盘或总计复盘可以导出到 Ima。",
            Some(
                "当前周、当前月、当前年复盘仍可能变化；总计复盘必须使用 overall + baseTime=0。"
                    .to_string(),
            ),
            None,
            None,
        );
    }
    if document.source_kind == ExportSourceKind::BookNotes
        && document
            .front_matter
            .iter()
            .any(|field| field.key == "exportableCount" && field.value == "0")
    {
        return ExportTargetResult {
            target: ExternalExportTarget::Ima,
            status: ExportTargetStatus::Skipped,
            title: Some(document.title.clone()),
            path: None,
            url: None,
            page_id: None,
            operation_id: None,
            operation_stage: None,
            resource_id: None,
            file_count: None,
            warning: Some("没有可导出的划线或想法，未创建 Ima 笔记。".to_string()),
            error: None,
        };
    }

    if !has_body_export_confirmation(overrides) {
        return failure(
            "IMA_BODY_EXPORT_CONFIRMATION_REQUIRED",
            "首次向 Ima 发送笔记正文前，请确认正文将发送到 Ima。",
            None,
            None,
            None,
        );
    }

    let _write_activity = match try_begin_ima_write() {
        Ok(activity) => activity,
        Err(error) => {
            return failure(error.code(), &error.user_message(), None, None, None);
        }
    };

    let mut destination = match resolve_destination(app, document.source_kind, overrides) {
        Ok(value) => value,
        Err(result) => return result,
    };
    let client = match ImaClient::from_saved_credentials(app.clone()) {
        Ok(value) => value,
        Err(error) => return client_failure(error, None, "importDoc", None, false),
    };
    if let Err(error) = preflight_destination(&client, &mut destination).await {
        return client_failure(error, None, "importDoc", None, false);
    }
    destination.credential_scope_hash = client.credential_scope_fingerprint();
    let destination_scope = match serde_json::to_string(&destination) {
        Ok(value) => value,
        Err(error) => {
            return failure(
                "IMA_LOCAL_STATE_WRITE_FAILED",
                "无法生成 Ima 目标范围。",
                Some(error.to_string()),
                None,
                Some("persistResult"),
            )
        }
    };
    let source_key = format!(
        "{}:{}",
        document.source_kind.as_config_value(),
        document.source_id
    );
    let operation_id = unique_id("ima-export", &source_key);
    let (ima_markdown, content_hash, filtered_image_count, filtered_link_count, snapshot_title) =
        serialize_ima_note_markdown(document, markdown, &operation_id);
    let (snapshot_markdown, chunks, markdown_format_degraded) = freeze_chunks(&ima_markdown);
    let snapshot_hash = sha256_hex(&snapshot_markdown);
    let force_new_snapshot = should_force_new_snapshot(document)
        || overrides
            .and_then(|value| value.force_new_snapshot)
            .unwrap_or(false);
    let record_id = unique_id("ima-record", &source_key);
    let now = current_unix_seconds();
    let chunk_rows = chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| (index, chunk.start_byte, chunk.end_byte, chunk.hash.as_str()))
        .collect::<Vec<_>>();

    {
        let connection = match db::open_connection(app) {
            Ok(value) => value,
            Err(error) => {
                return failure(
                    "IMA_LOCAL_STATE_UNAVAILABLE",
                    "无法读取 Ima 导出记录。",
                    Some(error),
                    None,
                    None,
                )
            }
        };
        let repository = ImaExportRepository::new(&connection);
        match repository.begin_attempt(
            &record_id,
            &operation_id,
            document.source_kind.as_config_value(),
            &document.source_id,
            &content_hash,
            &destination_scope,
            &snapshot_title,
            &snapshot_markdown,
            &snapshot_hash,
            CHUNKER_VERSION,
            &chunk_rows,
            force_new_snapshot,
            &now,
        ) {
            Ok(ImaBeginAttemptResult::Started) => {}
            Ok(ImaBeginAttemptResult::Existing(existing)) => {
                return existing_export_result(existing);
            }
            Err(error) => {
                return failure(
                    "IMA_LOCAL_STATE_WRITE_FAILED",
                    "无法保存 Ima 导出快照，未发起远端请求。",
                    Some(error),
                    Some(operation_id),
                    Some("persistResult"),
                );
            }
        }
    }

    if let Err(result) = mark_chunk_attempting(app, &operation_id, 0) {
        return result;
    }
    let note_id = match client
        .import_doc(&chunks[0].content, destination.note_folder_id.as_deref())
        .await
    {
        Ok(note_id) => {
            if let Err(error) = persist_stage(
                app,
                &operation_id,
                &record_id,
                "attempting",
                Some("importDoc"),
                None,
                Some(&note_id),
                None,
                None,
            ) {
                return local_state_unknown(&operation_id, "persistResult", Some(note_id), error);
            }
            if let Err(error) = mark_chunk_result(app, &operation_id, 0, "succeeded", None) {
                return local_state_unknown(&operation_id, "persistResult", Some(note_id), error);
            }
            note_id
        }
        Err(error) => {
            let status = if error.result_unknown {
                "unknown"
            } else {
                "failed"
            };
            persist_terminal_error(
                app,
                &operation_id,
                &record_id,
                status,
                "importDoc",
                None,
                None,
                &error,
            );
            let _ = mark_chunk_result(
                app,
                &operation_id,
                0,
                if error.result_unknown {
                    "unknown"
                } else {
                    "failed"
                },
                Some(error.code.as_str()),
            );
            return client_failure(error, Some(operation_id), "importDoc", None, false);
        }
    };

    for (index, chunk) in chunks.iter().enumerate().skip(1) {
        if let Err(result) = mark_chunk_attempting(app, &operation_id, index) {
            return result;
        }
        match client.append_doc(&note_id, &chunk.content).await {
            Ok(_) => {
                if let Err(error) = mark_chunk_result(app, &operation_id, index, "succeeded", None)
                {
                    return local_state_unknown(
                        &operation_id,
                        "persistResult",
                        Some(note_id),
                        error,
                    );
                }
                if let Err(error) = persist_stage(
                    app,
                    &operation_id,
                    &record_id,
                    "attempting",
                    Some("appendDoc"),
                    None,
                    Some(&note_id),
                    None,
                    None,
                ) {
                    return local_state_unknown(
                        &operation_id,
                        "persistResult",
                        Some(note_id),
                        error,
                    );
                }
            }
            Err(error) => {
                let status = if error.result_unknown {
                    "unknown"
                } else {
                    "partial"
                };
                persist_terminal_error(
                    app,
                    &operation_id,
                    &record_id,
                    status,
                    "appendDoc",
                    Some(&note_id),
                    None,
                    &error,
                );
                let _ = mark_chunk_result(
                    app,
                    &operation_id,
                    index,
                    if error.result_unknown {
                        "unknown"
                    } else {
                        "failed"
                    },
                    Some(error.code.as_str()),
                );
                return client_failure(error, Some(operation_id), "appendDoc", Some(note_id), true);
            }
        }
    }

    let mut media_id = None;
    if destination.publish_to_knowledge_base {
        let knowledge_base_id = destination.knowledge_base_id.as_deref().unwrap_or_default();
        let completed_stage = if chunks.len() > 1 {
            "appendDoc"
        } else {
            "importDoc"
        };
        if let Err(error) = persist_stage(
            app,
            &operation_id,
            &record_id,
            "attempting",
            Some(completed_stage),
            Some("addKnowledge"),
            Some(&note_id),
            None,
            None,
        ) {
            return local_state_unknown(&operation_id, "persistResult", Some(note_id), error);
        }
        match client
            .add_note_to_knowledge_base(
                &note_id,
                &snapshot_title,
                knowledge_base_id,
                destination.knowledge_base_folder_id.as_deref(),
            )
            .await
        {
            Ok(value) => media_id = Some(value),
            Err(error) => {
                let status = if error.result_unknown {
                    "unknown"
                } else {
                    "partial"
                };
                persist_terminal_error(
                    app,
                    &operation_id,
                    &record_id,
                    status,
                    "addKnowledge",
                    Some(&note_id),
                    None,
                    &error,
                );
                return knowledge_association_failure(
                    error,
                    Some(operation_id),
                    Some(note_id),
                    &destination,
                );
            }
        }
    }

    if let Err(error) = persist_stage(
        app,
        &operation_id,
        &record_id,
        "succeeded",
        Some(if media_id.is_some() {
            "addKnowledge"
        } else if chunks.len() > 1 {
            "appendDoc"
        } else {
            "importDoc"
        }),
        None,
        Some(&note_id),
        media_id.as_deref(),
        None,
    ) {
        return local_state_unknown(&operation_id, "persistResult", Some(note_id), error);
    }

    let warning = {
        let base_warning = export_warning(
            filtered_image_count,
            filtered_link_count,
            markdown_format_degraded,
        );
        if should_force_new_snapshot(document) {
            Some(match base_warning {
                Some(value) => format!("{value} 已创建新的总计历史快照，旧快照未修改。"),
                None => "已创建新的总计历史快照，旧快照未修改。".to_string(),
            })
        } else {
            base_warning
        }
    };

    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status: ExportTargetStatus::Succeeded,
        title: Some(snapshot_title),
        path: None,
        url: None,
        page_id: None,
        operation_id: Some(operation_id),
        operation_stage: None,
        resource_id: Some(note_id),
        file_count: None,
        warning,
        error: None,
    }
}

pub async fn retry_export_attempt(app: &AppHandle, operation_id: &str) -> ExportTargetResult {
    let _write_activity = match try_begin_ima_write() {
        Ok(activity) => activity,
        Err(error) => {
            return failure(
                error.code(),
                &error.user_message(),
                None,
                Some(operation_id.to_string()),
                None,
            );
        }
    };
    let (attempt, chunks) = match load_attempt(app, operation_id) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return failure(
                "IMA_ATTEMPT_NOT_FOUND",
                "找不到 Ima 导出尝试。",
                None,
                None,
                None,
            )
        }
        Err(error) => {
            return failure(
                "IMA_LOCAL_STATE_UNAVAILABLE",
                "无法读取 Ima 导出尝试。",
                Some(error),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    };
    if !matches!(attempt.status.as_str(), "failed" | "partial") {
        return failure(
            "IMA_ATTEMPT_NOT_RETRYABLE",
            "只有已明确失败或部分成功的 Ima 尝试可以重试。",
            None,
            Some(operation_id.to_string()),
            attempt.uncertain_stage.as_deref(),
        );
    }
    if attempt.snapshot_markdown.is_empty() || chunks.is_empty() {
        return failure(
            "IMA_SNAPSHOT_UNAVAILABLE",
            "该 Ima 尝试已没有可恢复的冻结快照。",
            None,
            Some(operation_id.to_string()),
            Some("persistResult"),
        );
    }
    let mut destination = match parse_destination_scope(&attempt.destination_scope) {
        Ok(value) => value,
        Err(error) => {
            return failure(
                "IMA_DESTINATION_INVALID",
                "Ima 导出目标已失效，请重新导出。",
                Some(error),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    };
    let client = match ImaClient::from_saved_credentials(app.clone()) {
        Ok(value) => value,
        Err(error) => {
            return client_failure(
                error,
                Some(operation_id.to_string()),
                "importDoc",
                attempt.note_id,
                false,
            )
        }
    };
    if !destination.credential_scope_hash.is_empty()
        && destination.credential_scope_hash != client.credential_scope_fingerprint()
    {
        return failure(
            "IMA_CREDENTIAL_SCOPE_CHANGED",
            "Ima 凭据已更换，不能恢复原账号的导出尝试。",
            None,
            Some(operation_id.to_string()),
            Some("persistResult"),
        );
    }
    if let Err(error) = preflight_destination(&client, &mut destination).await {
        return client_failure(
            error,
            Some(operation_id.to_string()),
            "importDoc",
            attempt.note_id,
            false,
        );
    }
    execute_attempt(app, &client, &attempt, &chunks, &destination).await
}

pub async fn retarget_knowledge_association(
    app: &AppHandle,
    operation_id: &str,
    knowledge_base_id: &str,
    knowledge_base_folder_id: Option<&str>,
    confirm: bool,
) -> ExportTargetResult {
    if !confirm {
        return failure(
            "IMA_RETARGET_CONFIRMATION_REQUIRED",
            "更换 Ima 知识库关联需要显式确认。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }
    let _write_activity = match try_begin_ima_write() {
        Ok(activity) => activity,
        Err(error) => {
            return failure(
                error.code(),
                &error.user_message(),
                None,
                Some(operation_id.to_string()),
                Some("addKnowledge"),
            );
        }
    };
    let (attempt, chunks) = match load_attempt(app, operation_id) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return failure(
                "IMA_ATTEMPT_NOT_FOUND",
                "找不到 Ima 导出尝试。",
                None,
                None,
                None,
            )
        }
        Err(error) => {
            return failure(
                "IMA_LOCAL_STATE_UNAVAILABLE",
                "无法读取 Ima 导出尝试。",
                Some(error),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    };
    if attempt.status != "partial"
        || attempt.last_completed_stage.as_deref() != Some("addKnowledge")
    {
        return failure(
            "IMA_RETARGET_NOT_ALLOWED",
            "只有知识库关联阶段明确失败的部分成功尝试可以更换目标。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }
    let Some(note_id) = attempt.note_id.clone() else {
        return failure(
            "IMA_NOTE_ID_MISSING",
            "该尝试没有可复用的 Ima 笔记 ID，不能更换知识库关联。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    };
    if attempt.chunk_count == 0
        || chunks.len() != attempt.chunk_count
        || chunks.iter().any(|chunk| chunk.status != "succeeded")
        || chunks.iter().any(|chunk| {
            chunk.end_byte > attempt.snapshot_markdown.len()
                || !attempt.snapshot_markdown.is_char_boundary(chunk.start_byte)
                || !attempt.snapshot_markdown.is_char_boundary(chunk.end_byte)
        })
    {
        return failure(
            "IMA_RETARGET_CONTENT_INCOMPLETE",
            "该尝试的正文分块尚未全部确认成功，不能只更换知识库关联。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }

    let old_destination = match parse_destination_scope(&attempt.destination_scope) {
        Ok(value) => value,
        Err(error) => {
            return failure(
                "IMA_DESTINATION_INVALID",
                "原 Ima 导出目标已失效，不能更换知识库关联。",
                Some(error),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    };
    if !old_destination.publish_to_knowledge_base {
        return failure(
            "IMA_RETARGET_NOT_ALLOWED",
            "该 Ima 笔记原本没有进入知识库，不能从普通笔记尝试执行关联重定向。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }
    let client = match ImaClient::from_saved_credentials(app.clone()) {
        Ok(value) => value,
        Err(error) => {
            return client_failure(
                error,
                Some(operation_id.to_string()),
                "addKnowledge",
                Some(note_id),
                false,
            )
        }
    };
    if old_destination.credential_scope_hash.is_empty()
        || old_destination.credential_scope_hash != client.credential_scope_fingerprint()
    {
        return failure(
            "IMA_CREDENTIAL_SCOPE_CHANGED",
            "Ima 凭据已更换，不能把原账号的笔记关联到新目标。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }
    let knowledge_base_id = knowledge_base_id.trim();
    let folder_id = knowledge_base_folder_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "root");
    let old_knowledge_base_id = old_destination
        .knowledge_base_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let old_folder_id = old_destination
        .knowledge_base_folder_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "root");
    if old_knowledge_base_id == Some(knowledge_base_id) && old_folder_id == folder_id {
        return failure(
            "IMA_RETARGET_SAME_TARGET",
            "新目标与原知识库关联相同，无需执行重定向。",
            None,
            Some(operation_id.to_string()),
            Some("addKnowledge"),
        );
    }
    let folder_id = match client
        .preflight_knowledge_base_target(knowledge_base_id, folder_id)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            return client_failure(
                error,
                Some(operation_id.to_string()),
                "retargetPreflight",
                Some(note_id),
                false,
            )
        }
    };
    let destination = ImaDestination {
        credential_scope_hash: client.credential_scope_fingerprint(),
        note_folder_id: None,
        knowledge_base_id: Some(knowledge_base_id.to_string()),
        knowledge_base_folder_id: folder_id,
        publish_to_knowledge_base: true,
    };
    let destination_scope = match serde_json::to_string(&destination) {
        Ok(value) => value,
        Err(error) => {
            return failure(
                "IMA_LOCAL_STATE_WRITE_FAILED",
                "无法生成新的 Ima 目标范围。",
                Some(error.to_string()),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    };
    let new_operation_id = unique_id("ima-retarget", operation_id);
    let new_record_id = unique_id("ima-retarget-record", operation_id);
    let chunk_hashes = chunks
        .iter()
        .map(|chunk| sha256_hex(&attempt.snapshot_markdown[chunk.start_byte..chunk.end_byte]))
        .collect::<Vec<_>>();
    let chunk_rows = chunks
        .iter()
        .zip(chunk_hashes.iter())
        .map(|(chunk, hash)| {
            (
                chunk.chunk_index,
                chunk.start_byte,
                chunk.end_byte,
                hash.as_str(),
            )
        })
        .collect::<Vec<_>>();
    let begin_result = {
        let connection = match db::open_connection(app) {
            Ok(value) => value,
            Err(error) => {
                return failure(
                    "IMA_LOCAL_STATE_UNAVAILABLE",
                    "无法打开 Ima 导出记录。",
                    Some(error),
                    Some(operation_id.to_string()),
                    Some("persistResult"),
                )
            }
        };
        ImaExportRepository::new(&connection).begin_association_retarget(
            &new_record_id,
            &new_operation_id,
            &attempt.source_kind,
            &attempt.source_id,
            &attempt.content_hash,
            &destination_scope,
            &attempt.title,
            &attempt.snapshot_markdown,
            &attempt.snapshot_hash,
            CHUNKER_VERSION,
            &chunk_rows,
            &note_id,
            &current_unix_seconds(),
        )
    };
    match begin_result {
        Ok(ImaBeginAttemptResult::Existing(existing)) => return existing_export_result(existing),
        Ok(ImaBeginAttemptResult::Started) => {}
        Err(error) => {
            return failure(
                "IMA_LOCAL_STATE_WRITE_FAILED",
                "无法保存新的 Ima 目标范围，未发起远端请求。",
                Some(error),
                Some(operation_id.to_string()),
                Some("persistResult"),
            )
        }
    }
    let media_id = match client
        .add_note_to_knowledge_base(
            &note_id,
            &attempt.title,
            knowledge_base_id,
            destination.knowledge_base_folder_id.as_deref(),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            persist_terminal_error(
                app,
                &new_operation_id,
                &new_record_id,
                if error.result_unknown {
                    "unknown"
                } else {
                    "partial"
                },
                "addKnowledge",
                Some(&note_id),
                None,
                &error,
            );
            return client_failure(
                error,
                Some(new_operation_id),
                "addKnowledge",
                Some(note_id),
                true,
            );
        }
    };

    let connection = match db::open_connection(app) {
        Ok(value) => value,
        Err(error) => {
            return local_state_unknown(&new_operation_id, "persistResult", Some(note_id), error)
        }
    };
    if let Err(error) = ImaExportRepository::new(&connection).finalize_association_retarget(
        operation_id,
        &attempt.record_id,
        &new_operation_id,
        &new_record_id,
        &note_id,
        &media_id,
        &current_unix_seconds(),
    ) {
        return local_state_unknown(&new_operation_id, "persistResult", Some(note_id), error);
    }

    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status: ExportTargetStatus::Succeeded,
        title: Some(attempt.title),
        path: None,
        url: None,
        page_id: None,
        operation_id: Some(new_operation_id),
        operation_stage: Some("addKnowledge".to_string()),
        resource_id: Some(note_id),
        file_count: None,
        warning: Some("已复用原 Ima 笔记，并关联到新的知识库目标。".to_string()),
        error: None,
    }
}

pub async fn resolve_unknown_attempt(
    app: &AppHandle,
    operation_id: &str,
    action: ImaUnknownResolution,
    confirm: bool,
) -> Result<Option<ExportTargetResult>, String> {
    if !confirm {
        return Err("处理不确定的 Ima 导出结果需要显式确认。".to_string());
    }
    let (attempt, chunks) =
        load_attempt(app, operation_id)?.ok_or_else(|| "找不到 Ima 导出尝试。".to_string())?;
    if attempt.status != "unknown" {
        return Err("只有状态不确定的 Ima 尝试可以执行该操作。".to_string());
    }
    match action {
        ImaUnknownResolution::ConfirmSucceeded => {
            persist_stage(
                app,
                &attempt.export_id,
                &attempt.record_id,
                "succeeded",
                attempt.last_completed_stage.as_deref(),
                None,
                attempt.note_id.as_deref(),
                attempt.media_id.as_deref(),
                None,
            )?;
            Ok(Some(attempt_result(
                &attempt,
                ExportTargetStatus::Succeeded,
                "已由用户确认 Ima 远端结果，无需再次请求。",
            )))
        }
        ImaUnknownResolution::Abandon => {
            persist_stage(
                app,
                &attempt.export_id,
                &attempt.record_id,
                "abandoned",
                attempt.last_completed_stage.as_deref(),
                None,
                attempt.note_id.as_deref(),
                attempt.media_id.as_deref(),
                None,
            )?;
            Ok(None)
        }
        ImaUnknownResolution::CreateNewSnapshot => {
            let _write_activity = try_begin_ima_write().map_err(|error| error.user_message())?;
            if attempt.snapshot_markdown.is_empty() || chunks.is_empty() {
                return Err("该 Ima 尝试已没有可创建新版本的冻结快照。".to_string());
            }
            let mut destination = parse_destination_scope(&attempt.destination_scope)?;
            let client =
                ImaClient::from_saved_credentials(app.clone()).map_err(|error| error.message)?;
            if !destination.credential_scope_hash.is_empty()
                && destination.credential_scope_hash != client.credential_scope_fingerprint()
            {
                return Err("Ima 凭据已更换，请先恢复原账号或重新导出。".to_string());
            }
            preflight_destination(&client, &mut destination)
                .await
                .map_err(|error| error.message)?;
            let destination_scope =
                serde_json::to_string(&destination).map_err(|error| error.to_string())?;
            let _ = persist_stage(
                app,
                &attempt.export_id,
                &attempt.record_id,
                "abandoned",
                attempt.last_completed_stage.as_deref(),
                None,
                attempt.note_id.as_deref(),
                attempt.media_id.as_deref(),
                None,
            );
            let new_operation_id = unique_id("ima-export", &attempt.source_id);
            let (snapshot_markdown, new_chunks, snapshot_title) =
                refresh_snapshot(&attempt.snapshot_markdown, &new_operation_id);
            let new_record_id = unique_id("ima-record", &attempt.source_id);
            let rows = new_chunks
                .iter()
                .enumerate()
                .map(|(index, chunk)| {
                    (index, chunk.start_byte, chunk.end_byte, chunk.hash.as_str())
                })
                .collect::<Vec<_>>();
            let connection = db::open_connection(app)?;
            match ImaExportRepository::new(&connection).begin_attempt(
                &new_record_id,
                &new_operation_id,
                &attempt.source_kind,
                &attempt.source_id,
                &attempt.content_hash,
                &destination_scope,
                &snapshot_title,
                &snapshot_markdown,
                &sha256_hex(&snapshot_markdown),
                CHUNKER_VERSION,
                &rows,
                false,
                &current_unix_seconds(),
            )? {
                ImaBeginAttemptResult::Started => {}
                ImaBeginAttemptResult::Existing(existing) => {
                    return Err(format!(
                        "相同内容已有 Ima 导出操作（{}）。",
                        existing.operation_id.as_deref().unwrap_or("状态记录")
                    ));
                }
            }
            let (new_attempt, new_chunks) = load_attempt(app, &new_operation_id)?
                .ok_or_else(|| "无法读取新建的 Ima 快照。".to_string())?;
            Ok(Some(
                execute_attempt(app, &client, &new_attempt, &new_chunks, &destination).await,
            ))
        }
    }
}

pub async fn check_remote_drift(
    app: &AppHandle,
    operation_id: &str,
) -> Result<ImaRemoteDriftReport, ImaClientError> {
    let (attempt, _) = load_attempt(app, operation_id)
        .map_err(drift_local_error)?
        .ok_or_else(|| drift_local_error("找不到 Ima 导出尝试。".to_string()))?;
    if attempt.status != "succeeded" {
        return Err(drift_local_error(
            "只有已确认成功的 Ima 导出可以检查远端状态。".to_string(),
        ));
    }
    let note_id = attempt.note_id.as_deref().ok_or_else(|| {
        drift_local_error("该 Ima 导出记录缺少笔记 ID，无法检查远端状态。".to_string())
    })?;
    let destination =
        parse_destination_scope(&attempt.destination_scope).map_err(drift_local_error)?;
    let client = ImaClient::from_saved_credentials(app.clone())?;
    if !destination.credential_scope_hash.is_empty()
        && destination.credential_scope_hash != client.credential_scope_fingerprint()
    {
        return Err(ImaClientError {
            code: "IMA_CREDENTIAL_SCOPE_CHANGED".to_string(),
            message: "Ima 凭据已更换，请恢复原账号后再检查该导出。".to_string(),
            detail: None,
            result_unknown: false,
            business_code: None,
        });
    }

    let note_location = match client.locate_note(note_id).await {
        Ok(value) => value,
        Err(error) => return Ok(remote_drift_unknown(&attempt.export_id, error)),
    };
    if !destination.publish_to_knowledge_base {
        return Ok(classify_remote_drift(
            &attempt.export_id,
            &destination,
            note_location,
            None,
        ));
    }

    let Some(knowledge_base_id) = destination.knowledge_base_id.as_deref() else {
        return Err(drift_local_error(
            "该 Ima 导出记录缺少知识库目标，无法检查关联状态。".to_string(),
        ));
    };
    let Some(media_id) = attempt.media_id.as_deref() else {
        return Err(drift_local_error(
            "该 Ima 导出记录缺少知识库资料 ID，无法检查关联状态。".to_string(),
        ));
    };
    let knowledge_location = match client
        .locate_knowledge_item(knowledge_base_id, media_id)
        .await
    {
        Ok(value) => value,
        Err(error) => return Ok(remote_drift_unknown(&attempt.export_id, error)),
    };
    Ok(classify_remote_drift(
        &attempt.export_id,
        &destination,
        note_location,
        knowledge_location,
    ))
}

fn classify_remote_drift(
    operation_id: &str,
    destination: &ImaDestination,
    note_location: Option<ImaNoteLocation>,
    knowledge_location: Option<ImaKnowledgeLocation>,
) -> ImaRemoteDriftReport {
    let checked_at = current_unix_seconds();
    let note_missing = note_location.is_none();
    let note_moved = note_location
        .as_ref()
        .is_some_and(|location| location.folder_id != destination.note_folder_id);
    let knowledge_missing = destination.publish_to_knowledge_base && knowledge_location.is_none();
    let knowledge_moved = knowledge_location
        .as_ref()
        .is_some_and(|location| location.parent_folder_id != destination.knowledge_base_folder_id);
    let changed_count = [note_missing, note_moved, knowledge_missing, knowledge_moved]
        .into_iter()
        .filter(|changed| *changed)
        .count();

    let (status, message, can_create_new_snapshot) = if changed_count == 0 {
        (
            ImaRemoteDriftStatus::Healthy,
            if destination.publish_to_knowledge_base {
                "已确认 Ima 笔记和知识库资料仍位于原目标。"
            } else {
                "已确认 Ima 笔记仍位于原笔记本。"
            },
            false,
        )
    } else if changed_count > 1 {
        (
            ImaRemoteDriftStatus::MultipleChanges,
            "Ima 笔记或知识库资料的位置已发生多处变化。应用不会自动移动、删除或重复关联远端内容。",
            note_missing || knowledge_missing,
        )
    } else if note_missing {
        (
            ImaRemoteDriftStatus::NoteMissing,
            "无法在当前 Ima 账号中定位该导出笔记。它可能已删除或不再可访问。",
            true,
        )
    } else if note_moved {
        (
            ImaRemoteDriftStatus::NoteMoved,
            "Ima 笔记仍存在，但已移动到其他笔记本。",
            false,
        )
    } else if knowledge_missing {
        (
            ImaRemoteDriftStatus::KnowledgeAssociationMissing,
            "Ima 笔记仍存在，但原知识库中未找到对应资料。关联可能已解除，或资料已被删除。",
            true,
        )
    } else {
        (
            ImaRemoteDriftStatus::KnowledgeAssociationMoved,
            "知识库资料仍存在，但已移动到其他文件夹。",
            false,
        )
    };

    ImaRemoteDriftReport {
        operation_id: operation_id.to_string(),
        status,
        checked_at,
        message: message.to_string(),
        can_create_new_snapshot,
    }
}

fn remote_drift_unknown(operation_id: &str, error: ImaClientError) -> ImaRemoteDriftReport {
    ImaRemoteDriftReport {
        operation_id: operation_id.to_string(),
        status: ImaRemoteDriftStatus::Unknown,
        checked_at: current_unix_seconds(),
        message: format!("无法确认 Ima 远端状态：{}", error.message),
        can_create_new_snapshot: false,
    }
}

fn drift_local_error(message: String) -> ImaClientError {
    ImaClientError {
        code: "IMA_DRIFT_CHECK_UNAVAILABLE".to_string(),
        message,
        detail: None,
        result_unknown: false,
        business_code: None,
    }
}

fn load_attempt(
    app: &AppHandle,
    operation_id: &str,
) -> Result<Option<(ImaExportAttempt, Vec<ImaExportChunk>)>, String> {
    let connection = db::open_connection(app)?;
    let repository = ImaExportRepository::new(&connection);
    let Some(attempt) = repository.get_attempt(operation_id)? else {
        return Ok(None);
    };
    let chunks = repository.list_chunks(operation_id)?;
    Ok(Some((attempt, chunks)))
}

async fn execute_attempt(
    app: &AppHandle,
    client: &ImaClient,
    attempt: &ImaExportAttempt,
    chunks: &[ImaExportChunk],
    destination: &ImaDestination,
) -> ExportTargetResult {
    let mut note_id = attempt.note_id.clone();
    for chunk in chunks {
        if chunk.chunker_version != CHUNKER_VERSION
            || chunk.end_byte > attempt.snapshot_markdown.len()
            || !attempt.snapshot_markdown.is_char_boundary(chunk.start_byte)
            || !attempt.snapshot_markdown.is_char_boundary(chunk.end_byte)
        {
            return failure(
                "IMA_SNAPSHOT_INVALID",
                "Ima 冻结快照分块已失效，请创建新版本。",
                None,
                Some(attempt.export_id.clone()),
                Some("persistResult"),
            );
        }
    }
    if note_id.is_none()
        || chunks
            .first()
            .is_some_and(|chunk| chunk.status != "succeeded")
    {
        let Some(first) = chunks.first() else {
            return failure(
                "IMA_SNAPSHOT_INVALID",
                "Ima 冻结快照没有正文分块。",
                None,
                Some(attempt.export_id.clone()),
                Some("importDoc"),
            );
        };
        if let Err(result) = mark_chunk_attempting(app, &attempt.export_id, first.chunk_index) {
            return result;
        }
        let content = &attempt.snapshot_markdown[first.start_byte..first.end_byte];
        match client
            .import_doc(content, destination.note_folder_id.as_deref())
            .await
        {
            Ok(value) => {
                note_id = Some(value.clone());
                if let Err(error) = persist_stage(
                    app,
                    &attempt.export_id,
                    &attempt.record_id,
                    "attempting",
                    Some("importDoc"),
                    None,
                    Some(&value),
                    None,
                    None,
                ) {
                    return local_state_unknown(
                        &attempt.export_id,
                        "persistResult",
                        Some(value),
                        error,
                    );
                }
                if let Err(error) = mark_chunk_result(
                    app,
                    &attempt.export_id,
                    first.chunk_index,
                    "succeeded",
                    None,
                ) {
                    return local_state_unknown(
                        &attempt.export_id,
                        "persistResult",
                        note_id,
                        error,
                    );
                }
            }
            Err(error) => {
                let status = if error.result_unknown {
                    "unknown"
                } else {
                    "failed"
                };
                persist_terminal_error(
                    app,
                    &attempt.export_id,
                    &attempt.record_id,
                    status,
                    "importDoc",
                    None,
                    None,
                    &error,
                );
                let _ = mark_chunk_result(
                    app,
                    &attempt.export_id,
                    first.chunk_index,
                    status,
                    Some(&error.code),
                );
                return client_failure(
                    error,
                    Some(attempt.export_id.clone()),
                    "importDoc",
                    note_id,
                    false,
                );
            }
        }
    }
    let Some(note_id_value) = note_id.clone() else {
        return failure(
            "IMA_NOTE_ID_MISSING",
            "无法恢复 Ima 笔记 ID。",
            None,
            Some(attempt.export_id.clone()),
            Some("appendDoc"),
        );
    };
    for chunk in chunks.iter().skip(1) {
        if chunk.status == "succeeded" {
            continue;
        }
        if chunk.status == "unknown" {
            return failure(
                "IMA_REMOTE_UNKNOWN",
                "该分块的远端状态无法确认，请创建新版本。",
                None,
                Some(attempt.export_id.clone()),
                Some("appendDoc"),
            );
        }
        if let Err(result) = mark_chunk_attempting(app, &attempt.export_id, chunk.chunk_index) {
            return result;
        }
        let content = &attempt.snapshot_markdown[chunk.start_byte..chunk.end_byte];
        match client.append_doc(&note_id_value, content).await {
            Ok(_) => {
                if let Err(error) = mark_chunk_result(
                    app,
                    &attempt.export_id,
                    chunk.chunk_index,
                    "succeeded",
                    None,
                ) {
                    return local_state_unknown(
                        &attempt.export_id,
                        "persistResult",
                        Some(note_id_value.clone()),
                        error,
                    );
                }
                if let Err(error) = persist_stage(
                    app,
                    &attempt.export_id,
                    &attempt.record_id,
                    "attempting",
                    Some("appendDoc"),
                    None,
                    Some(&note_id_value),
                    None,
                    None,
                ) {
                    return local_state_unknown(
                        &attempt.export_id,
                        "persistResult",
                        Some(note_id_value.clone()),
                        error,
                    );
                }
            }
            Err(error) => {
                let status = if error.result_unknown {
                    "unknown"
                } else {
                    "partial"
                };
                persist_terminal_error(
                    app,
                    &attempt.export_id,
                    &attempt.record_id,
                    status,
                    "appendDoc",
                    Some(&note_id_value),
                    None,
                    &error,
                );
                let _ = mark_chunk_result(
                    app,
                    &attempt.export_id,
                    chunk.chunk_index,
                    status,
                    Some(&error.code),
                );
                return client_failure(
                    error,
                    Some(attempt.export_id.clone()),
                    "appendDoc",
                    Some(note_id_value.clone()),
                    true,
                );
            }
        }
    }
    let mut media_id = attempt.media_id.clone();
    if destination.publish_to_knowledge_base && media_id.is_none() {
        let knowledge_base_id = destination.knowledge_base_id.as_deref().unwrap_or_default();
        if let Err(error) = persist_stage(
            app,
            &attempt.export_id,
            &attempt.record_id,
            "attempting",
            Some("appendDoc"),
            Some("addKnowledge"),
            Some(&note_id_value),
            None,
            None,
        ) {
            return local_state_unknown(
                &attempt.export_id,
                "persistResult",
                Some(note_id_value.clone()),
                error,
            );
        }
        match client
            .add_note_to_knowledge_base(
                &note_id_value,
                &attempt.title,
                knowledge_base_id,
                destination.knowledge_base_folder_id.as_deref(),
            )
            .await
        {
            Ok(value) => media_id = Some(value),
            Err(error) => {
                let status = if error.result_unknown {
                    "unknown"
                } else {
                    "partial"
                };
                persist_terminal_error(
                    app,
                    &attempt.export_id,
                    &attempt.record_id,
                    status,
                    "addKnowledge",
                    Some(&note_id_value),
                    None,
                    &error,
                );
                return knowledge_association_failure(
                    error,
                    Some(attempt.export_id.clone()),
                    Some(note_id_value.clone()),
                    destination,
                );
            }
        }
    }
    if let Err(error) = persist_stage(
        app,
        &attempt.export_id,
        &attempt.record_id,
        "succeeded",
        Some(if media_id.is_some() {
            "addKnowledge"
        } else if chunks.len() > 1 {
            "appendDoc"
        } else {
            "importDoc"
        }),
        None,
        Some(&note_id_value),
        media_id.as_deref(),
        None,
    ) {
        return local_state_unknown(
            &attempt.export_id,
            "persistResult",
            Some(note_id_value),
            error,
        );
    }
    let mut result = attempt_result(
        attempt,
        ExportTargetStatus::Succeeded,
        "Ima 导出已恢复完成。",
    );
    result.resource_id = note_id;
    result
}

fn attempt_result(
    attempt: &ImaExportAttempt,
    status: ExportTargetStatus,
    warning: &str,
) -> ExportTargetResult {
    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status,
        title: Some(attempt.title.clone()),
        path: None,
        url: None,
        page_id: None,
        operation_id: Some(attempt.export_id.clone()),
        operation_stage: attempt.uncertain_stage.clone(),
        resource_id: attempt.note_id.clone(),
        file_count: None,
        warning: Some(warning.to_string()),
        error: None,
    }
}

fn existing_export_result(existing: ImaExistingExport) -> ExportTargetResult {
    if existing.status == "succeeded" {
        return ExportTargetResult {
            target: ExternalExportTarget::Ima,
            status: ExportTargetStatus::Skipped,
            title: Some(existing.title),
            path: None,
            url: None,
            page_id: None,
            operation_id: existing.operation_id,
            operation_stage: None,
            resource_id: existing.note_id,
            file_count: None,
            warning: Some(if existing.media_id.is_some() {
                "相同内容已发布为 Ima 笔记并加入知识库。".to_string()
            } else {
                "相同内容已发布为 Ima 笔记。".to_string()
            }),
            error: None,
        };
    }

    failure(
        "IMA_EXPORT_IN_PROGRESS",
        "相同内容与目标已有未完成的 Ima 导出，请打开已有操作处理。",
        None,
        existing.operation_id,
        None,
    )
}

fn parse_destination_scope(value: &str) -> Result<ImaDestination, String> {
    serde_json::from_str(value).map_err(|error| error.to_string())
}

fn refresh_snapshot(snapshot: &str, operation_id: &str) -> (String, Vec<FrozenChunk>, String) {
    let label = snapshot_time_label(&current_unix_seconds());
    let mut snapshot_title = snapshot
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .unwrap_or("Ima 阅读笔记")
        .to_string();
    let refreshed = snapshot
        .lines()
        .enumerate()
        .map(|(index, line)| {
            if index == 0 && line.starts_with("# ") {
                let stable_title = line
                    .rsplit_once(" · ")
                    .and_then(|(without_operation, _)| {
                        without_operation
                            .rsplit_once(" · ")
                            .map(|(stable_title, _)| stable_title)
                    })
                    .unwrap_or(line);
                snapshot_title = format!(
                    "{} · {label} · {}",
                    stable_title.strip_prefix("# ").unwrap_or(stable_title),
                    operation_short_id(operation_id)
                );
                format!("# {snapshot_title}")
            } else if line.starts_with("> 快照时间：") {
                format!("> 快照时间：{label}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let (snapshot_markdown, chunks, _) = freeze_chunks(&refreshed);
    (snapshot_markdown, chunks, snapshot_title)
}

async fn preflight_destination(
    client: &ImaClient,
    destination: &mut ImaDestination,
) -> Result<(), ImaClientError> {
    let validated = client
        .preflight_export_targets(
            destination.note_folder_id.as_deref(),
            destination.knowledge_base_id.as_deref(),
            destination.knowledge_base_folder_id.as_deref(),
            destination.publish_to_knowledge_base,
        )
        .await?;
    destination.note_folder_id = validated.note_folder_id;
    destination.knowledge_base_id = validated.knowledge_base_id;
    destination.knowledge_base_folder_id = validated.knowledge_base_folder_id;
    Ok(())
}

fn resolve_destination(
    app: &AppHandle,
    source_kind: ExportSourceKind,
    overrides: Option<&ImaExportOverrides>,
) -> Result<ImaDestination, ExportTargetResult> {
    let config_dir = db::default_data_dir(app).map_err(|error| {
        failure(
            "IMA_CONFIG_UNAVAILABLE",
            "无法读取 Ima 配置。",
            Some(error),
            None,
            None,
        )
    })?;
    let config = db::read_integration_config(&config_dir).map_err(|error| {
        failure(
            "IMA_CONFIG_UNAVAILABLE",
            "无法读取 Ima 配置。",
            Some(error),
            None,
            None,
        )
    })?;
    resolve_destination_from_config(&config, source_kind, overrides)
}

fn resolve_destination_from_config(
    config: &db::IntegrationConfig,
    source_kind: ExportSourceKind,
    overrides: Option<&ImaExportOverrides>,
) -> Result<ImaDestination, ExportTargetResult> {
    let route = config.ima_asset_routes.get(source_kind.as_config_value());
    let global_publish_to_knowledge_base = if source_kind == ExportSourceKind::BookDecision {
        false
    } else {
        config.ima_publish_to_knowledge_base
    };
    let publish_to_knowledge_base = overrides
        .and_then(|value| value.publish_to_knowledge_base)
        .or_else(|| route.and_then(|value| value.publish_to_knowledge_base))
        .unwrap_or(global_publish_to_knowledge_base);
    let note_folder_id = normalized_route_value(
        overrides.and_then(|value| value.note_folder_id.clone()),
        route.and_then(|value| value.note_folder_id.clone()),
        config.ima_note_folder_id.clone(),
    );
    let (knowledge_base_id, knowledge_base_folder_id) = if publish_to_knowledge_base {
        (
            normalized_route_value(
                overrides.and_then(|value| value.knowledge_base_id.clone()),
                route.and_then(|value| value.knowledge_base_id.clone()),
                config.ima_knowledge_base_id.clone(),
            ),
            normalized_route_value(
                overrides.and_then(|value| value.knowledge_base_folder_id.clone()),
                route.and_then(|value| value.knowledge_base_folder_id.clone()),
                config.ima_knowledge_base_folder_id.clone(),
            ),
        )
    } else {
        (None, None)
    };
    let destination = ImaDestination {
        credential_scope_hash: String::new(),
        note_folder_id,
        knowledge_base_id,
        knowledge_base_folder_id,
        publish_to_knowledge_base,
    };
    if destination.note_folder_id.as_deref() == Some("0") {
        return Err(failure(
            "IMA_NOTE_FOLDER_INVALID",
            "Ima 笔记本 ID 不能使用分页游标 0。",
            None,
            None,
            None,
        ));
    }
    if destination.knowledge_base_folder_id.is_some() && destination.knowledge_base_id.is_none() {
        return Err(failure(
            "IMA_KNOWLEDGE_BASE_FOLDER_INVALID",
            "选择 Ima 知识库文件夹时必须同时选择目标知识库。",
            None,
            None,
            None,
        ));
    }
    if destination.publish_to_knowledge_base && destination.knowledge_base_id.is_none() {
        return Err(failure(
            "IMA_KNOWLEDGE_BASE_MISSING",
            "请先选择可写的 Ima 知识库。",
            None,
            None,
            None,
        ));
    }
    Ok(destination)
}

fn normalized_route_value(
    override_value: Option<String>,
    route_value: Option<String>,
    configured: Option<String>,
) -> Option<String> {
    override_value
        .or(route_value)
        .or(configured)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn has_body_export_confirmation(overrides: Option<&ImaExportOverrides>) -> bool {
    overrides
        .and_then(|value| value.confirm_body_export)
        .unwrap_or(false)
}

fn serialize_folder_scope_id<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(value.as_deref().unwrap_or("root"))
}

fn deserialize_folder_scope_id<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "root"))
}

fn persist_stage(
    app: &AppHandle,
    operation_id: &str,
    record_id: &str,
    status: &str,
    stage: Option<&str>,
    uncertain_stage: Option<&str>,
    note_id: Option<&str>,
    media_id: Option<&str>,
    error: Option<(&str, &str)>,
) -> Result<(), String> {
    let connection = db::open_connection(app)?;
    ImaExportRepository::new(&connection).mark_status(
        operation_id,
        record_id,
        status,
        stage,
        uncertain_stage,
        note_id,
        media_id,
        error.map(|value| value.0),
        error.map(|value| value.1),
        &current_unix_seconds(),
    )
}

fn persist_terminal_error(
    app: &AppHandle,
    operation_id: &str,
    record_id: &str,
    status: &str,
    stage: &str,
    note_id: Option<&str>,
    media_id: Option<&str>,
    error: &ImaClientError,
) {
    let uncertain_stage = (status == "unknown").then_some(stage);
    let _ = persist_stage(
        app,
        operation_id,
        record_id,
        status,
        (status != "unknown").then_some(stage),
        uncertain_stage,
        note_id,
        media_id,
        Some((&error.code, &error.message)),
    );
}

fn mark_chunk_attempting(
    app: &AppHandle,
    operation_id: &str,
    chunk_index: usize,
) -> Result<(), ExportTargetResult> {
    let connection = db::open_connection(app)
        .map_err(|error| local_state_unknown(operation_id, "persistResult", None, error))?;
    ImaExportRepository::new(&connection)
        .mark_chunk_attempting(operation_id, chunk_index)
        .map(|_| ())
        .map_err(|error| local_state_unknown(operation_id, "persistResult", None, error))
}

fn mark_chunk_result(
    app: &AppHandle,
    operation_id: &str,
    chunk_index: usize,
    status: &str,
    error_code: Option<&str>,
) -> Result<(), String> {
    let connection = db::open_connection(app)?;
    ImaExportRepository::new(&connection).mark_chunk_result(
        operation_id,
        chunk_index,
        status,
        error_code,
    )
}

fn client_failure(
    error: ImaClientError,
    operation_id: Option<String>,
    stage: &str,
    resource_id: Option<String>,
    has_remote_note: bool,
) -> ExportTargetResult {
    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status: if error.result_unknown {
            ExportTargetStatus::Unknown
        } else if has_remote_note {
            ExportTargetStatus::Partial
        } else {
            ExportTargetStatus::Failed
        },
        title: None,
        path: None,
        url: None,
        page_id: None,
        operation_id,
        operation_stage: Some(stage.to_string()),
        resource_id,
        file_count: None,
        warning: None,
        error: Some(ExportTargetError {
            code: error.code,
            message: error.message,
            detail: error.detail,
        }),
    }
}

fn knowledge_association_failure(
    error: ImaClientError,
    operation_id: Option<String>,
    resource_id: Option<String>,
    destination: &ImaDestination,
) -> ExportTargetResult {
    let mut result = client_failure(error, operation_id, "addKnowledge", resource_id, true);
    let knowledge_base_id = destination
        .knowledge_base_id
        .as_deref()
        .unwrap_or("未知知识库");
    let folder_id = destination
        .knowledge_base_folder_id
        .as_deref()
        .unwrap_or("根目录");
    result.warning = Some(format!("原目标：知识库 {knowledge_base_id} / {folder_id}"));
    result
}

fn local_state_unknown(
    operation_id: &str,
    stage: &str,
    resource_id: Option<String>,
    detail: String,
) -> ExportTargetResult {
    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status: ExportTargetStatus::Unknown,
        title: None,
        path: None,
        url: None,
        page_id: None,
        operation_id: Some(operation_id.to_string()),
        operation_stage: Some(stage.to_string()),
        resource_id,
        file_count: None,
        warning: None,
        error: Some(ExportTargetError {
            code: "IMA_LOCAL_STATE_WRITE_FAILED".to_string(),
            message: "Ima 远端操作后的本地状态保存失败，结果无法确认。".to_string(),
            detail: Some(detail),
        }),
    }
}

fn failure(
    code: &str,
    message: &str,
    detail: Option<String>,
    operation_id: Option<String>,
    stage: Option<&str>,
) -> ExportTargetResult {
    ExportTargetResult {
        target: ExternalExportTarget::Ima,
        status: ExportTargetStatus::Failed,
        title: None,
        path: None,
        url: None,
        page_id: None,
        operation_id,
        operation_stage: stage.map(str::to_string),
        resource_id: None,
        file_count: None,
        warning: None,
        error: Some(ExportTargetError {
            code: code.to_string(),
            message: message.to_string(),
            detail,
        }),
    }
}

fn serialize_ima_note_markdown(
    document: &ExportDocument,
    markdown: &str,
    operation_id: &str,
) -> (String, String, usize, usize, String) {
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let without_front_matter = strip_front_matter(&normalized);
    let (without_local_references, filtered_image_count, filtered_link_count) =
        filter_local_markdown_references(without_front_matter);
    let mut body_lines = without_local_references.lines();
    let mut body = without_local_references.as_str();
    if let Some(first_heading) = body_lines.find(|line| line.trim_start().starts_with("# ")) {
        if let Some(offset) = without_local_references.find(first_heading) {
            let heading_end = offset + first_heading.len();
            body = without_local_references[heading_end..].trim_start_matches('\n');
        }
    }
    let snapshot_time = snapshot_time_label(&document.exported_at);
    let base_title = ima_snapshot_base_title(document);
    let snapshot_title = format!(
        "{base_title} · {} · {}",
        snapshot_time,
        operation_short_id(operation_id)
    );
    let stable_body = body
        .lines()
        .filter(|line| !line.trim_start().starts_with("- 导出时间："))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let stable_content = format!("# {base_title}\n\n{stable_body}");
    let content_hash = sha256_hex(&stable_content);
    let snapshot = format!(
        "# {snapshot_title}\n\n{stable_body}\n\n---\n\n> 导出来源：WxReadMaster\n> 资产类型：{}\n> 来源 ID：{}\n> 快照时间：{snapshot_time}\n",
        document.source_kind.ima_asset_label(),
        document.source_id,
    );
    (
        snapshot,
        content_hash,
        filtered_image_count,
        filtered_link_count,
        snapshot_title,
    )
}

fn ima_snapshot_base_title(document: &ExportDocument) -> String {
    match document.source_kind {
        ExportSourceKind::BookNotes => format!("《{}》阅读笔记", document.title),
        _ => document.title.clone(),
    }
}

fn is_completed_reading_stats_review(
    document: &ExportDocument,
    now: chrono::DateTime<Local>,
) -> bool {
    let mode = document
        .front_matter
        .iter()
        .find(|field| field.key == "mode")
        .map(|field| field.value.as_str());
    let base_time = document
        .front_matter
        .iter()
        .find(|field| field.key == "baseTime")
        .and_then(|field| field.value.parse::<i64>().ok());
    let (Some(mode), Some(base_time)) = (mode, base_time) else {
        return false;
    };
    if mode == "overall" {
        return base_time == 0;
    }
    if base_time <= 0 {
        return false;
    }

    let Some(current_period_start) = current_stats_period_start(mode, now) else {
        return false;
    };
    Local
        .timestamp_opt(base_time, 0)
        .single()
        .is_some_and(|period_start| period_start < current_period_start)
}

fn should_force_new_snapshot(document: &ExportDocument) -> bool {
    document.source_kind == ExportSourceKind::ReadingStatsReview
        && document
            .front_matter
            .iter()
            .any(|field| field.key == "mode" && field.value == "overall")
}

fn current_stats_period_start(
    mode: &str,
    now: chrono::DateTime<Local>,
) -> Option<chrono::DateTime<Local>> {
    match mode {
        "weekly" => {
            let day_start = Local
                .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
                .single()?;
            Some(day_start - Duration::days(now.weekday().num_days_from_monday().into()))
        }
        "monthly" => Local
            .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
            .single(),
        "annually" => Local.with_ymd_and_hms(now.year(), 1, 1, 0, 0, 0).single(),
        _ => None,
    }
}

fn strip_front_matter(markdown: &str) -> &str {
    if !markdown.starts_with("---\n") {
        return markdown;
    }
    markdown[4..]
        .find("\n---\n")
        .map(|end| &markdown[end + 9..])
        .unwrap_or(markdown)
}

fn snapshot_time_label(exported_at: &str) -> String {
    let datetime = exported_at
        .parse::<i64>()
        .ok()
        .and_then(|value| Local.timestamp_opt(value, 0).single())
        .unwrap_or_else(Local::now);
    datetime.format("%Y-%m-%d %H:%M:%S %:z").to_string()
}

fn freeze_chunks(markdown: &str) -> (String, Vec<FrozenChunk>, bool) {
    if markdown.len() <= MAX_CHUNK_BYTES {
        let content = markdown.to_string();
        return (
            content.clone(),
            vec![FrozenChunk {
                start_byte: 0,
                end_byte: content.len(),
                hash: sha256_hex(&content),
                content,
            }],
            false,
        );
    }

    let (segments, markdown_format_degraded) = split_markdown(markdown, MAX_CHUNK_BYTES - 128);
    let total = segments.len();
    let mut snapshot = String::new();
    let mut chunks = Vec::with_capacity(total);
    for (index, segment) in segments.into_iter().enumerate() {
        let content = if index == 0 {
            format!("> 本笔记分为 {total} 部分，当前为第 1 部分。\n\n{segment}")
        } else {
            format!("\n\n---\n\n> 第 {}/{total} 部分\n\n{segment}", index + 1)
        };
        let start_byte = snapshot.len();
        snapshot.push_str(&content);
        let end_byte = snapshot.len();
        chunks.push(FrozenChunk {
            start_byte,
            end_byte,
            hash: sha256_hex(&content),
            content,
        });
    }
    (snapshot, chunks, markdown_format_degraded)
}

fn split_markdown(value: &str, max_bytes: usize) -> (Vec<String>, bool) {
    let boundaries = markdown_chunk_boundaries(value);
    let mut chunks = Vec::new();
    let mut markdown_format_degraded = false;
    let mut start = 0;
    while start < value.len() {
        let mut end = utf8_chunk_end(value, start, max_bytes);
        if end < value.len() {
            if let Some(boundary) = select_markdown_boundary(&boundaries, start, end) {
                end = boundary;
            } else {
                markdown_format_degraded = true;
            }
        }
        if end <= start {
            end = utf8_chunk_end(value, start, 1);
        }
        chunks.push(value[start..end].to_string());
        start = end;
    }
    (chunks, markdown_format_degraded)
}

fn utf8_chunk_end(value: &str, start: usize, max_bytes: usize) -> usize {
    let mut end = start.saturating_add(max_bytes).min(value.len());
    while end > start && !value.is_char_boundary(end) {
        end -= 1;
    }
    if end > start {
        return end;
    }

    value[start..]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| start + offset)
        .unwrap_or(value.len())
}

fn markdown_chunk_boundaries(value: &str) -> Vec<MarkdownChunkBoundary> {
    let mut boundaries = Vec::new();
    let mut line_start = 0;
    let mut code_fence = None;
    let mut primary_heading_needs_content = false;

    for line in value.split_inclusive('\n') {
        let line_end = line_start + line.len();
        let trimmed = line.trim();
        let fence = markdown_fence(trimmed);
        if let Some((marker, minimum_length)) = code_fence {
            if fence.is_some_and(|(next_marker, next_length)| {
                next_marker == marker && next_length >= minimum_length
            }) {
                code_fence = None;
            }
            line_start = line_end;
            continue;
        }

        if let Some(fence) = fence {
            code_fence = Some(fence);
            primary_heading_needs_content = false;
            line_start = line_end;
            continue;
        }

        let is_primary_heading = is_primary_markdown_heading(trimmed);
        if is_primary_heading && line_start > 0 {
            boundaries.push(MarkdownChunkBoundary {
                offset: line_start,
                kind: MarkdownChunkBoundaryKind::PrimaryHeading,
            });
        }

        if trimmed.is_empty() {
            if !primary_heading_needs_content {
                boundaries.push(MarkdownChunkBoundary {
                    offset: line_end,
                    kind: MarkdownChunkBoundaryKind::Block,
                });
            }
        } else {
            primary_heading_needs_content = is_primary_heading;
        }
        line_start = line_end;
    }

    boundaries
}

fn select_markdown_boundary(
    boundaries: &[MarkdownChunkBoundary],
    start: usize,
    limit: usize,
) -> Option<usize> {
    for kind in [
        MarkdownChunkBoundaryKind::PrimaryHeading,
        MarkdownChunkBoundaryKind::Block,
    ] {
        if let Some(boundary) = boundaries.iter().rev().find(|boundary| {
            boundary.kind == kind && boundary.offset > start && boundary.offset <= limit
        }) {
            return Some(boundary.offset);
        }
    }
    None
}

fn markdown_fence(line: &str) -> Option<(u8, usize)> {
    let bytes = line.trim_start().as_bytes();
    let marker = *bytes.first()?;
    if !matches!(marker, b'`' | b'~') {
        return None;
    }

    let length = bytes.iter().take_while(|byte| **byte == marker).count();
    (length >= 3).then_some((marker, length))
}

fn is_primary_markdown_heading(line: &str) -> bool {
    line.starts_with("# ") || line.starts_with("## ")
}

fn filter_local_markdown_references(markdown: &str) -> (String, usize, usize) {
    let mut output = String::with_capacity(markdown.len());
    let mut rest = markdown;
    let mut removed = 0;
    while let Some(image_start) = rest.find("![") {
        output.push_str(&rest[..image_start]);
        let image = &rest[image_start..];
        let Some(label_end) = image.find("](") else {
            output.push_str(image);
            return downgrade_local_markdown_links(&output, removed);
        };
        let url_start = label_end + 2;
        let Some(url_end) = image[url_start..].find(')') else {
            output.push_str(image);
            return downgrade_local_markdown_links(&output, removed);
        };
        let url_end = url_start + url_end;
        let url = image[url_start..url_end].trim();
        let alt = image[2..label_end].trim();
        if alt == "封面" || is_local_image_url(url) {
            removed += 1;
        } else {
            output.push_str(&image[..=url_end]);
        }
        rest = &image[url_end + 1..];
    }
    output.push_str(rest);
    downgrade_local_markdown_links(&output, removed)
}

fn downgrade_local_markdown_links(markdown: &str, removed_images: usize) -> (String, usize, usize) {
    let mut output = String::with_capacity(markdown.len());
    let mut rest = markdown;
    let mut downgraded = 0;
    while let Some(link_start) = rest.find('[') {
        output.push_str(&rest[..link_start]);
        if link_start > 0 && rest.as_bytes().get(link_start - 1) == Some(&b'!') {
            output.push('[');
            rest = &rest[link_start + 1..];
            continue;
        }
        let link = &rest[link_start..];
        let Some(label_end) = link.find("](") else {
            output.push_str(link);
            return (output, removed_images, downgraded);
        };
        let url_start = label_end + 2;
        let Some(url_end) = link[url_start..].find(')') else {
            output.push_str(link);
            return (output, removed_images, downgraded);
        };
        let url_end = url_start + url_end;
        let url = link[url_start..url_end].trim();
        if is_local_file_url(url) {
            output.push_str(link[1..label_end].trim());
            downgraded += 1;
        } else {
            output.push_str(&link[..=url_end]);
        }
        rest = &link[url_end + 1..];
    }
    output.push_str(rest);
    (output, removed_images, downgraded)
}

fn is_local_image_url(url: &str) -> bool {
    let normalized = url.trim_matches(['<', '>']);
    !(normalized.starts_with("https://") || normalized.starts_with("http://"))
}

fn is_local_file_url(url: &str) -> bool {
    let normalized = url.trim_matches(['<', '>']).trim();
    if normalized.is_empty()
        || normalized.starts_with('#')
        || normalized.starts_with("https://")
        || normalized.starts_with("http://")
        || normalized.starts_with("mailto:")
        || normalized.starts_with("weread://")
    {
        return false;
    }
    let bytes = normalized.as_bytes();
    normalized.starts_with("file:")
        || normalized.starts_with('/')
        || normalized.starts_with('\\')
        || normalized.starts_with("./")
        || normalized.starts_with("../")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'))
        || !normalized.contains(':')
}

fn export_warning(images: usize, links: usize, markdown_format_degraded: bool) -> Option<String> {
    let mut warnings = Vec::new();
    if let Some(warning) = local_reference_warning(images, links) {
        warnings.push(warning);
    }
    if markdown_format_degraded {
        warnings.push(
            "部分 Ima 正文因单个 Markdown 块超过分块阈值按 UTF-8 字符边界拆分，格式可能降级。"
                .to_string(),
        );
    }
    (!warnings.is_empty()).then(|| warnings.join(" "))
}

fn local_reference_warning(images: usize, links: usize) -> Option<String> {
    match (images, links) {
        (0, 0) => None,
        (images, 0) => Some(format!("已过滤 {images} 个 Ima 不支持的本机图片引用。")),
        (0, links) => Some(format!("已将 {links} 个本机文件链接降级为纯文本。")),
        (images, links) => Some(format!(
            "已过滤 {images} 个 Ima 不支持的本机图片引用，并将 {links} 个本机文件链接降级为纯文本。"
        )),
    }
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unique_id(prefix: &str, source_id: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let source_hash = sha256_hex(source_id);
    format!("{prefix}-{nanos}-{}", &source_hash[..12])
}

fn operation_short_id(operation_id: &str) -> &str {
    operation_id
        .get(operation_id.len().saturating_sub(8)..)
        .unwrap_or(operation_id)
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};

    use crate::export::document::{ExportDocument, ExportMetaField, ExportSourceKind};

    use super::{
        classify_remote_drift, filter_local_markdown_references, freeze_chunks,
        has_body_export_confirmation, is_completed_reading_stats_review, refresh_snapshot,
        resolve_destination_from_config, serialize_ima_note_markdown, should_force_new_snapshot,
        split_markdown, ImaDestination, ImaRemoteDriftStatus, MAX_CHUNK_BYTES,
    };
    use crate::{
        db::{ImaAssetRouteConfig, IntegrationConfig},
        export::{
            ima_client::{ImaKnowledgeLocation, ImaNoteLocation},
            targets::ImaExportOverrides,
        },
    };

    #[test]
    fn filters_local_images_and_keeps_remote_images() {
        let (value, removed, downgraded) = filter_local_markdown_references(
            "a ![local](C:/tmp/a.png) b ![remote](https://example.com/a.png)",
        );
        assert_eq!(removed, 1);
        assert_eq!(downgraded, 0);
        assert!(!value.contains("C:/tmp"));
        assert!(value.contains("https://example.com/a.png"));
    }

    #[test]
    fn remote_drift_distinguishes_missing_and_moved_resources() {
        let destination = ImaDestination {
            credential_scope_hash: "scope-1".to_string(),
            note_folder_id: Some("notes-1".to_string()),
            knowledge_base_id: Some("kb-1".to_string()),
            knowledge_base_folder_id: Some("reviews".to_string()),
            publish_to_knowledge_base: true,
        };
        let healthy = classify_remote_drift(
            "operation-1",
            &destination,
            Some(ImaNoteLocation {
                folder_id: Some("notes-1".to_string()),
            }),
            Some(ImaKnowledgeLocation {
                parent_folder_id: Some("reviews".to_string()),
            }),
        );
        let association_missing = classify_remote_drift(
            "operation-1",
            &destination,
            Some(ImaNoteLocation {
                folder_id: Some("notes-1".to_string()),
            }),
            None,
        );
        let moved = classify_remote_drift(
            "operation-1",
            &destination,
            Some(ImaNoteLocation {
                folder_id: Some("notes-2".to_string()),
            }),
            Some(ImaKnowledgeLocation {
                parent_folder_id: Some("routes".to_string()),
            }),
        );

        assert_eq!(healthy.status, ImaRemoteDriftStatus::Healthy);
        assert!(!healthy.can_create_new_snapshot);
        assert_eq!(
            association_missing.status,
            ImaRemoteDriftStatus::KnowledgeAssociationMissing
        );
        assert!(association_missing.can_create_new_snapshot);
        assert_eq!(moved.status, ImaRemoteDriftStatus::MultipleChanges);
        assert!(!moved.can_create_new_snapshot);
    }

    #[test]
    fn local_file_links_are_downgraded_without_touching_remote_or_anchor_links() {
        let (value, removed, downgraded) = filter_local_markdown_references(
            "[local](C:/tmp/note.md) [relative](../note.md) [remote](https://example.com) [anchor](#section)",
        );
        assert_eq!(removed, 0);
        assert_eq!(downgraded, 2);
        assert!(value.contains("local relative"));
        assert!(!value.contains("C:/tmp"));
        assert!(!value.contains("../note.md"));
        assert!(value.contains("[remote](https://example.com)"));
        assert!(value.contains("[anchor](#section)"));
    }

    #[test]
    fn markdown_chunks_preserve_original_content_and_utf8_boundaries() {
        let source = "中文🙂段落\n\n".repeat(40_000);
        let (chunks, markdown_format_degraded) = split_markdown(&source, MAX_CHUNK_BYTES - 128);
        assert_eq!(chunks.concat(), source);
        assert!(!markdown_format_degraded);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.is_char_boundary(chunk.len())));
    }

    #[test]
    fn markdown_chunks_prioritize_headings_and_keep_normal_blocks_intact() {
        let link = "[完整链接](https://example.com/reading-review?section=chapter-two)";
        let table = "| 指标 | 数值 |\n| --- | --- |\n| 阅读时长 | 120 分钟 |\n| 复盘数 | 3 |";
        let code = "```rust\nlet conclusion = \"保持节奏\";\n```";
        let source = format!(
            "# 阅读复盘\n\n{}\n\n## 第二节\n\n{link}\n\n{table}\n\n{code}\n\n{}",
            "前置摘要。".repeat(8),
            "收尾结论。\n\n".repeat(16)
        );

        let (chunks, markdown_format_degraded) = split_markdown(&source, 180);

        assert_eq!(chunks.concat(), source);
        assert!(!markdown_format_degraded);
        assert!(chunks[0].ends_with("\n\n"));
        assert!(chunks.iter().any(|chunk| chunk.starts_with("## 第二节")));
        assert!(chunks.iter().any(|chunk| chunk.contains(link)));
        assert!(chunks.iter().any(|chunk| {
            chunk.contains("| 指标 | 数值 |") && chunk.contains("| 复盘数 | 3 |")
        }));
        assert!(chunks.iter().any(|chunk| {
            chunk.contains("```rust") && chunk.contains("let conclusion") && chunk.contains("\n```")
        }));
    }

    #[test]
    fn markdown_chunks_fall_back_to_utf8_only_for_an_oversized_single_block() {
        let source = "中文🙂无空行".repeat(100);
        let (chunks, markdown_format_degraded) = split_markdown(&source, 64);

        assert_eq!(chunks.concat(), source);
        assert!(markdown_format_degraded);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 64));
        assert!(chunks
            .iter()
            .all(|chunk| chunk.is_char_boundary(chunk.len())));
    }

    #[test]
    fn frozen_chunk_boundaries_cover_actual_snapshot() {
        let source = "章节内容\n\n".repeat(40_000);
        let (snapshot, chunks, markdown_format_degraded) = freeze_chunks(&source);
        assert!(chunks.len() > 1);
        assert!(!markdown_format_degraded);
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.content.as_str())
                .collect::<String>(),
            snapshot
        );
        assert_eq!(
            chunks.last().map(|chunk| chunk.end_byte),
            Some(snapshot.len())
        );
    }

    #[test]
    fn ima_snapshot_removes_front_matter_cover_and_dynamic_export_time_from_hash() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let first = "---\nexportedAt: \"100\"\n---\n\n# 测试书\n\n![封面](https://example.com/cover.png)\n\n- 导出时间：1970-01-01 00:01:40\n\n正文\n";
        let second = first.replace("1970-01-01 00:01:40", "1970-01-01 00:01:41");
        let (first_snapshot, first_hash, count, links, title) =
            serialize_ima_note_markdown(&document, first, "operation-12345678");
        let (_, second_hash, _, _, _) =
            serialize_ima_note_markdown(&document, &second, "operation-87654321");
        assert_eq!(first_hash, second_hash);
        assert_eq!(count, 1);
        assert_eq!(links, 0);
        assert!(!first_snapshot.contains("exportedAt:"));
        assert!(!first_snapshot.contains("封面"));
        assert!(first_snapshot.contains("导出来源：WxReadMaster"));
        assert!(title.contains(":40 "));
        assert!(title.ends_with("12345678"));
    }

    #[test]
    fn ima_snapshot_uses_the_asset_title_for_book_reviews() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookReview,
            source_id: "book-1".to_string(),
            title: "测试书 AI 复盘".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let (snapshot, _, _, _, title) = serialize_ima_note_markdown(
            &document,
            "# 测试书 AI 复盘\n\n正文",
            "operation-12345678",
        );

        assert!(title.starts_with("测试书 AI 复盘 · "));
        assert!(snapshot.contains("> 资产类型：书籍复盘"));
        assert!(!snapshot.contains("阅读笔记"));
    }

    #[test]
    fn destination_prefers_request_then_asset_route_then_global_default() {
        let mut config = IntegrationConfig {
            ima_note_folder_id: Some("global-notes".to_string()),
            ima_knowledge_base_id: Some("global-kb".to_string()),
            ima_knowledge_base_folder_id: Some("global-folder".to_string()),
            ima_publish_to_knowledge_base: true,
            ..IntegrationConfig::default()
        };
        config.ima_asset_routes.insert(
            "bookReview".to_string(),
            ImaAssetRouteConfig {
                note_folder_id: Some("review-notes".to_string()),
                knowledge_base_id: Some("review-kb".to_string()),
                knowledge_base_folder_id: Some("review-folder".to_string()),
                publish_to_knowledge_base: Some(true),
            },
        );
        let overrides = ImaExportOverrides {
            note_folder_id: Some("request-notes".to_string()),
            knowledge_base_id: Some("request-kb".to_string()),
            knowledge_base_folder_id: Some("request-folder".to_string()),
            publish_to_knowledge_base: Some(true),
            confirm_body_export: Some(true),
            force_new_snapshot: None,
        };

        let route = resolve_destination_from_config(&config, ExportSourceKind::BookReview, None)
            .expect("asset route should be valid");
        let request = resolve_destination_from_config(
            &config,
            ExportSourceKind::BookReview,
            Some(&overrides),
        )
        .expect("request override should be valid");
        let fallback =
            resolve_destination_from_config(&config, ExportSourceKind::ReadingRoute, None)
                .expect("global fallback should be valid");
        let decision =
            resolve_destination_from_config(&config, ExportSourceKind::BookDecision, None)
                .expect("decision safe default should be valid");

        assert_eq!(route.note_folder_id.as_deref(), Some("review-notes"));
        assert_eq!(route.knowledge_base_id.as_deref(), Some("review-kb"));
        assert_eq!(request.note_folder_id.as_deref(), Some("request-notes"));
        assert_eq!(request.knowledge_base_id.as_deref(), Some("request-kb"));
        assert_eq!(fallback.note_folder_id.as_deref(), Some("global-notes"));
        assert_eq!(fallback.knowledge_base_id.as_deref(), Some("global-kb"));
        assert_eq!(decision.note_folder_id.as_deref(), Some("global-notes"));
        assert!(!decision.publish_to_knowledge_base);
        assert_eq!(decision.knowledge_base_id, None);
    }

    #[test]
    fn refreshed_snapshot_replaces_dynamic_title_suffix_and_metadata_time() {
        let source = "# 《测试 · 进阶》阅读笔记 · 2026-08-17 14:30:25 +08:00 · 12345678\n\n正文\n\n> 快照时间：2026-08-17 14:30:25 +08:00\n";
        let (snapshot, _, title) = refresh_snapshot(source, "operation-87654321");
        let expected_heading = format!("# {title}");

        assert!(title.starts_with("《测试 · 进阶》阅读笔记 · "));
        assert!(title.ends_with("87654321"));
        assert_eq!(snapshot.lines().next(), Some(expected_heading.as_str()));
        assert!(!snapshot.contains("12345678"));
        assert!(!snapshot.contains("2026-08-17 14:30:25 +08:00"));
    }

    #[test]
    fn destination_scope_uses_root_markers_and_reads_legacy_null_folders() {
        let destination = ImaDestination {
            credential_scope_hash: "scope-1".to_string(),
            note_folder_id: None,
            knowledge_base_id: Some("kb-1".to_string()),
            knowledge_base_folder_id: None,
            publish_to_knowledge_base: true,
        };
        let serialized = serde_json::to_value(&destination).unwrap();
        assert_eq!(serialized["noteFolderId"], "root");
        assert_eq!(serialized["knowledgeBaseFolderId"], "root");

        let legacy: ImaDestination = serde_json::from_value(serde_json::json!({
            "credentialScopeHash": "scope-1",
            "noteFolderId": null,
            "knowledgeBaseId": "kb-1",
            "knowledgeBaseFolderId": null,
            "publishToKnowledgeBase": true
        }))
        .unwrap();
        assert_eq!(legacy.note_folder_id, None);
        assert_eq!(legacy.knowledge_base_folder_id, None);
    }

    #[test]
    fn body_export_requires_an_explicit_true_confirmation() {
        assert!(!has_body_export_confirmation(None));
        let mut overrides = super::ImaExportOverrides {
            note_folder_id: None,
            knowledge_base_id: None,
            knowledge_base_folder_id: None,
            publish_to_knowledge_base: None,
            confirm_body_export: Some(false),
            force_new_snapshot: None,
        };
        assert!(!has_body_export_confirmation(Some(&overrides)));
        overrides.confirm_body_export = Some(true);
        assert!(has_body_export_confirmation(Some(&overrides)));
    }

    #[test]
    fn only_completed_reading_stats_reviews_are_final_for_ima() {
        let now = Local
            .with_ymd_and_hms(2026, 8, 17, 10, 0, 0)
            .single()
            .expect("fixed local time should be valid");
        let completed_month = Local
            .with_ymd_and_hms(2026, 7, 1, 0, 0, 0)
            .single()
            .expect("fixed local time should be valid")
            .timestamp();
        let current_month = Local
            .with_ymd_and_hms(2026, 8, 1, 0, 0, 0)
            .single()
            .expect("fixed local time should be valid")
            .timestamp();

        assert!(is_completed_reading_stats_review(
            &reading_stats_review_document("monthly", completed_month),
            now
        ));
        assert!(!is_completed_reading_stats_review(
            &reading_stats_review_document("monthly", current_month),
            now
        ));
        assert!(is_completed_reading_stats_review(
            &reading_stats_review_document("overall", 0),
            now
        ));
        assert!(!is_completed_reading_stats_review(
            &reading_stats_review_document("overall", current_month),
            now
        ));
        assert!(!is_completed_reading_stats_review(
            &reading_stats_review_document("unknown", 0),
            now
        ));
    }

    #[test]
    fn only_overall_reading_stats_reviews_force_new_snapshots() {
        let overall = reading_stats_review_document("overall", 0);
        let period = reading_stats_review_document("monthly", 1_754_022_400);
        let book_notes = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "0".to_string(),
            basis_notice: None,
        };

        assert!(should_force_new_snapshot(&overall));
        assert!(!should_force_new_snapshot(&period));
        assert!(!should_force_new_snapshot(&book_notes));
    }

    fn reading_stats_review_document(mode: &str, base_time: i64) -> ExportDocument {
        ExportDocument {
            source_kind: ExportSourceKind::ReadingStatsReview,
            source_id: format!("{mode}-{base_time}"),
            title: "阅读复盘".to_string(),
            author: None,
            cover: None,
            front_matter: vec![
                ExportMetaField {
                    key: "mode".to_string(),
                    value: mode.to_string(),
                },
                ExportMetaField {
                    key: "baseTime".to_string(),
                    value: base_time.to_string(),
                },
            ],
            sections: vec![],
            exported_at: "0".to_string(),
            basis_notice: None,
        }
    }
}
