use std::{
    collections::BTreeSet,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    db,
    errors::AppError,
    export::{
        bulk::{
            build_bulk_export_preflight, chunk_bulk_export_jobs, normalize_bulk_export_concurrency,
            serialize_bulk_export_index, serialize_bulk_export_report, BulkExportItemStatus,
            BulkExportPreflight, BulkExportPreflightItem, BulkExportReport, BulkExportResultItem,
            BulkExportStrategy,
        },
        markdown::{serialize_book_ai_summary_markdown, serialize_book_notes_markdown},
    },
    mappers::notes::{
        build_book_notes_record, map_bookmark_list_response, map_mine_reviews_page,
        map_notebook_overview_page, BookNotesRecord, HighlightRecord, NotebookBookRecord,
        ThoughtRecord,
    },
    repositories::{
        cache::RawCacheRepository,
        sync_state::{SyncStateRecord, SyncStateRepository},
    },
    services::{
        ai::{
            AiCachedOutputRecord, BookAiSummary, BookAiSummaryResponse, BookAiSummarySource,
            BOOK_NOTES_SUMMARY_FEATURE, BOOK_NOTES_SUMMARY_PROMPT_VERSION,
        },
        weread_gateway::{WereadApi, WereadGateway},
    },
};

const NOTES_SECTION: &str = "notes";
const NOTES_CACHE_NAMESPACE: &str = "notes";
const NOTEBOOK_CACHE_KEY: &str = "notebook-overview";
const DEFAULT_NOTEBOOK_PAGE_SIZE: i64 = 100;
const DEFAULT_REVIEW_PAGE_SIZE: i64 = 20;
const MAX_PAGE_SIZE: i64 = 100;
const MAX_PAGES: usize = 500;
const BULK_EXPORT_PROGRESS_EVENT: &str = "bulk-export-progress";
const NO_EXPORTABLE_NOTES_AFTER_SYNC_MESSAGE: &str = "同步完成，但没有划线或想法可导出。";
const NO_EXPORTABLE_NOTES_AFTER_SYNC_SKIP_REASON: &str =
    "同步完成，但没有可导出的划线或想法，已跳过。";

static BULK_EXPORT_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookOverviewSummary {
    pub total_book_count: i64,
    pub total_note_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookOverviewResponse {
    pub books: Vec<NotebookBookRecord>,
    pub summary: NotebookOverviewSummary,
    pub sync_state: Option<SyncStateRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBookNotesMarkdownResponse {
    pub book_id: String,
    pub file_name: String,
    pub path: String,
    pub exportable_count: usize,
    pub bookmark_content_notice: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportRequest {
    pub strategy: BulkExportStrategy,
    pub selected_book_ids: Option<Vec<String>>,
    pub concurrency: Option<usize>,
    pub exclude_without_exportable_notes: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkExportResponse {
    pub export_id: String,
    pub path: String,
    pub exported_at: String,
    pub files: Vec<String>,
    pub report: BulkExportReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum BulkExportProgressPhase {
    Preparing,
    ExportingCached,
    Syncing,
    WritingReport,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BulkExportProgressBook {
    book_id: String,
    title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BulkExportProgressLatest {
    book_id: String,
    title: String,
    status: BulkExportItemStatus,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BulkExportProgress {
    phase: BulkExportProgressPhase,
    total: usize,
    completed: usize,
    exported: usize,
    failed: usize,
    skipped: usize,
    canceled: usize,
    active: Vec<BulkExportProgressBook>,
    latest: Option<BulkExportProgressLatest>,
    message: String,
}

#[derive(Debug)]
struct BulkExportProgressTracker {
    total: usize,
    completed: usize,
    exported: usize,
    failed: usize,
    skipped: usize,
    canceled: usize,
    latest: Option<BulkExportProgressLatest>,
}

#[derive(Debug, Clone)]
struct BulkExportSyncJob {
    order: usize,
    item: BulkExportPreflightItem,
}

#[derive(Debug)]
struct PreparedBulkExportItem {
    order: usize,
    book_id: String,
    title: String,
    status: BulkExportItemStatus,
    notes_file: Option<String>,
    reason: String,
}

impl BulkExportProgressTracker {
    fn new(total: usize) -> Self {
        Self {
            total,
            completed: 0,
            exported: 0,
            failed: 0,
            skipped: 0,
            canceled: 0,
            latest: None,
        }
    }

    fn record(&mut self, item: &PreparedBulkExportItem) {
        self.completed += 1;
        match item.status {
            BulkExportItemStatus::Exported => self.exported += 1,
            BulkExportItemStatus::Failed => self.failed += 1,
            BulkExportItemStatus::Canceled => self.canceled += 1,
            BulkExportItemStatus::Skipped => self.skipped += 1,
            BulkExportItemStatus::Ready
            | BulkExportItemStatus::NeedsSync
            | BulkExportItemStatus::NoContent => {}
        }
        self.latest = Some(BulkExportProgressLatest {
            book_id: item.book_id.clone(),
            title: item.title.clone(),
            status: item.status.clone(),
            reason: item.reason.clone(),
        });
    }

    fn emit(
        &self,
        app: &AppHandle,
        phase: BulkExportProgressPhase,
        active: Vec<BulkExportProgressBook>,
        message: String,
    ) {
        let _ = app.emit(
            BULK_EXPORT_PROGRESS_EVENT,
            BulkExportProgress {
                phase,
                total: self.total,
                completed: self.completed,
                exported: self.exported,
                failed: self.failed,
                skipped: self.skipped,
                canceled: self.canceled,
                active,
                latest: self.latest.clone(),
                message,
            },
        );
    }
}

pub struct NotesService {
    app: AppHandle,
}

impl NotesService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn get_notebook_overview(
        &self,
        count: Option<i64>,
    ) -> Result<NotebookOverviewResponse, AppError> {
        let page_size = clamp_page_size(count, DEFAULT_NOTEBOOK_PAGE_SIZE);
        let started_at = current_unix_seconds();
        let mut connection = self.open_connection()?;
        SyncStateRepository::new(&connection)
            .mark_syncing(NOTES_SECTION, &started_at)
            .map_err(AppError::from)?;

        let result = match WereadGateway::new(self.app.clone()) {
            Ok(gateway) => fetch_all_notebooks(&gateway, page_size).await,
            Err(error) => Err(error),
        };

        match result {
            Ok((books, raw_pages)) => {
                let completed_at = current_unix_seconds();
                let mut books = dedupe_notebook_books(books);
                books.sort_by(|left, right| {
                    right
                        .total_note_count
                        .cmp(&left.total_note_count)
                        .then_with(|| right.sort.cmp(&left.sort))
                        .then_with(|| left.title.cmp(&right.title))
                });

                let transaction = connection.transaction().map_err(AppError::from)?;
                replace_notebook_books(&transaction, &books, &completed_at)?;
                RawCacheRepository::new(&transaction)
                    .put_json(
                        NOTES_CACHE_NAMESPACE,
                        NOTEBOOK_CACHE_KEY,
                        &json!({ "pages": raw_pages }),
                        &completed_at,
                    )
                    .map_err(AppError::from)?;
                SyncStateRepository::new(&transaction)
                    .mark_success(NOTES_SECTION, &completed_at)
                    .map_err(AppError::from)?;
                transaction.commit().map_err(AppError::from)?;

                Ok(NotebookOverviewResponse {
                    summary: summarize_notebook_books(&books),
                    books,
                    sync_state: SyncStateRepository::new(&connection)
                        .get(NOTES_SECTION)
                        .map_err(AppError::from)?,
                })
            }
            Err(error) => {
                let attempted_at = current_unix_seconds();
                let error_message = error
                    .diagnostic_message()
                    .unwrap_or_else(|| error.user_message());
                SyncStateRepository::new(&connection)
                    .mark_failed(NOTES_SECTION, &attempted_at, error.code(), &error_message)
                    .map_err(AppError::from)?;

                Err(error)
            }
        }
    }

    pub async fn get_book_notes(&self, book_id: String) -> Result<BookNotesRecord, AppError> {
        let normalized_book_id = normalize_book_id(&book_id)?;
        let started_at = current_unix_seconds();
        let mut connection = self.open_connection()?;
        SyncStateRepository::new(&connection)
            .mark_syncing(NOTES_SECTION, &started_at)
            .map_err(AppError::from)?;

        let result = match WereadGateway::new(self.app.clone()) {
            Ok(gateway) => fetch_book_notes(&gateway, &normalized_book_id).await,
            Err(error) => Err(error),
        };

        match result {
            Ok((bookmark_raw, bookmark_record, thoughts, review_raw_pages)) => {
                let completed_at = current_unix_seconds();
                let highlights = dedupe_highlights(bookmark_record.highlights);
                let thoughts = dedupe_thoughts(thoughts);
                let transaction = connection.transaction().map_err(AppError::from)?;
                replace_highlights(
                    &transaction,
                    &normalized_book_id,
                    &highlights,
                    &completed_at,
                )?;
                replace_thoughts(&transaction, &normalized_book_id, &thoughts, &completed_at)?;
                RawCacheRepository::new(&transaction)
                    .put_json(
                        NOTES_CACHE_NAMESPACE,
                        &format!("{normalized_book_id}:bookmarks"),
                        &bookmark_raw,
                        &completed_at,
                    )
                    .map_err(AppError::from)?;
                RawCacheRepository::new(&transaction)
                    .put_json(
                        NOTES_CACHE_NAMESPACE,
                        &format!("{normalized_book_id}:reviews"),
                        &json!({ "pages": review_raw_pages }),
                        &completed_at,
                    )
                    .map_err(AppError::from)?;
                SyncStateRepository::new(&transaction)
                    .mark_success(NOTES_SECTION, &completed_at)
                    .map_err(AppError::from)?;
                transaction.commit().map_err(AppError::from)?;

                let book =
                    read_notebook_book(&connection, &normalized_book_id)?.or(bookmark_record.book);

                Ok(build_book_notes_record(
                    &normalized_book_id,
                    book,
                    highlights,
                    thoughts,
                    bookmark_record.chapters,
                ))
            }
            Err(error) => {
                let attempted_at = current_unix_seconds();
                let error_message = error
                    .diagnostic_message()
                    .unwrap_or_else(|| error.user_message());
                SyncStateRepository::new(&connection)
                    .mark_failed(NOTES_SECTION, &attempted_at, error.code(), &error_message)
                    .map_err(AppError::from)?;

                Err(error)
            }
        }
    }

    pub async fn export_book_notes_markdown(
        &self,
        book_id: String,
    ) -> Result<ExportBookNotesMarkdownResponse, AppError> {
        let notes = self.get_book_notes(book_id).await?;
        let exported_at = current_unix_seconds();
        let markdown = serialize_book_notes_markdown(&notes, &exported_at);
        let export_dir = db::active_export_dir(&self.app).map_err(AppError::Storage)?;
        fs::create_dir_all(&export_dir).map_err(|error| AppError::Storage(error.to_string()))?;

        let title = notes
            .book
            .as_ref()
            .map(|book| book.title.as_str())
            .unwrap_or(notes.book_id.as_str());
        let file_name = format!(
            "{}-{}.md",
            sanitize_file_stem(title, &notes.book_id),
            exported_at
        );
        let path = export_dir.join(&file_name);
        fs::write(&path, markdown).map_err(|error| AppError::Storage(error.to_string()))?;

        Ok(ExportBookNotesMarkdownResponse {
            book_id: notes.book_id,
            file_name,
            path: path.to_string_lossy().to_string(),
            exportable_count: notes.exportable_count,
            bookmark_content_notice: notes.bookmark_content_notice,
        })
    }

    pub fn preflight_bulk_export(
        &self,
        selected_book_ids: Option<Vec<String>>,
        exclude_without_exportable_notes: bool,
    ) -> Result<BulkExportPreflight, AppError> {
        let connection = self.open_connection()?;
        let books = read_all_notebook_books(&connection)?;
        let cached_notes = read_all_cached_book_notes(&connection)?;
        let cached_ai_review_book_ids = read_cached_ai_review_book_ids(&connection)?;

        Ok(build_bulk_export_preflight(
            &books,
            &cached_notes,
            &cached_ai_review_book_ids,
            selected_book_ids.as_deref(),
            exclude_without_exportable_notes,
        ))
    }

    pub async fn export_bulk_notes(
        &self,
        request: BulkExportRequest,
    ) -> Result<BulkExportResponse, AppError> {
        BULK_EXPORT_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
        let concurrency = normalize_bulk_export_concurrency(request.concurrency);
        let selected_book_ids = request.selected_book_ids.clone();
        let exclude_without_exportable_notes =
            request.exclude_without_exportable_notes.unwrap_or(true);
        if request.strategy == BulkExportStrategy::SelectedBooksOnly
            && selected_book_ids
                .as_ref()
                .map(|ids| ids.is_empty())
                .unwrap_or(true)
        {
            return Err(AppError::InvalidPayload(
                "请先选择要导出的书籍。".to_string(),
            ));
        }

        let preflight = self
            .preflight_bulk_export(selected_book_ids.clone(), exclude_without_exportable_notes)?;
        let mut progress = BulkExportProgressTracker::new(preflight.total_books);
        progress.emit(
            &self.app,
            BulkExportProgressPhase::Preparing,
            Vec::new(),
            "正在准备批量导出任务。".to_string(),
        );
        let exported_at = current_unix_seconds();
        let export_id = format!("wxreadmaster-bulk-export-{exported_at}");
        let export_dir = db::active_export_dir(&self.app)
            .map_err(AppError::Storage)?
            .join(&export_id);
        let notes_dir = export_dir.join("notes");
        let reviews_dir = export_dir.join("reviews");
        fs::create_dir_all(&notes_dir).map_err(|error| AppError::Storage(error.to_string()))?;
        fs::create_dir_all(&reviews_dir).map_err(|error| AppError::Storage(error.to_string()))?;

        let mut prepared_items = Vec::new();
        let mut sync_jobs = Vec::new();

        for (order, item) in preflight.items.into_iter().enumerate() {
            match item.status {
                BulkExportItemStatus::Ready => {
                    let prepared = if item.cached_exportable_count == 0 && item.has_cached_ai_review
                    {
                        PreparedBulkExportItem {
                            order,
                            book_id: item.book_id,
                            title: item.title,
                            status: BulkExportItemStatus::Exported,
                            notes_file: None,
                            reason: "已导出本地已生成复盘。".to_string(),
                        }
                    } else {
                        match self.export_cached_book_notes_into(
                            &item.book_id,
                            &notes_dir,
                            &exported_at,
                        ) {
                            Ok(file_name) => PreparedBulkExportItem {
                                order,
                                book_id: item.book_id,
                                title: item.title,
                                status: BulkExportItemStatus::Exported,
                                notes_file: Some(format!("notes/{file_name}")),
                                reason: "已导出本地笔记 Markdown。".to_string(),
                            },
                            Err(error) => PreparedBulkExportItem {
                                order,
                                book_id: item.book_id,
                                title: item.title,
                                status: BulkExportItemStatus::Failed,
                                notes_file: None,
                                reason: error.user_message(),
                            },
                        }
                    };
                    progress.record(&prepared);
                    progress.emit(
                        &self.app,
                        BulkExportProgressPhase::ExportingCached,
                        Vec::new(),
                        format!("已处理本地缓存：{}。", prepared.title),
                    );
                    prepared_items.push(prepared);
                }
                BulkExportItemStatus::NeedsSync
                    if request.strategy == BulkExportStrategy::SyncMissingNotes =>
                {
                    sync_jobs.push(BulkExportSyncJob { order, item });
                }
                BulkExportItemStatus::NeedsSync => {
                    let prepared = PreparedBulkExportItem {
                        order,
                        book_id: item.book_id,
                        title: item.title,
                        status: BulkExportItemStatus::Skipped,
                        notes_file: None,
                        reason: item.reason,
                    };
                    progress.record(&prepared);
                    progress.emit(
                        &self.app,
                        BulkExportProgressPhase::ExportingCached,
                        Vec::new(),
                        format!("已跳过：{}。", prepared.title),
                    );
                    prepared_items.push(prepared);
                }
                _ => {
                    let prepared = PreparedBulkExportItem {
                        order,
                        book_id: item.book_id,
                        title: item.title,
                        status: BulkExportItemStatus::Skipped,
                        notes_file: None,
                        reason: item.reason,
                    };
                    progress.record(&prepared);
                    progress.emit(
                        &self.app,
                        BulkExportProgressPhase::ExportingCached,
                        Vec::new(),
                        format!("已跳过：{}。", prepared.title),
                    );
                    prepared_items.push(prepared);
                }
            }
        }

        let mut pending_sync_jobs = sync_jobs;
        for chunk in chunk_bulk_export_jobs(&pending_sync_jobs, concurrency) {
            if BULK_EXPORT_CANCEL_REQUESTED.load(Ordering::SeqCst) {
                for job in chunk {
                    let prepared = canceled_bulk_export_item(job);
                    progress.record(&prepared);
                    progress.emit(
                        &self.app,
                        BulkExportProgressPhase::Syncing,
                        Vec::new(),
                        format!("已取消：{}。", prepared.title),
                    );
                    prepared_items.push(prepared);
                }
                continue;
            }

            let mut handles = Vec::new();
            let active = chunk
                .iter()
                .map(|job| BulkExportProgressBook {
                    book_id: job.item.book_id.clone(),
                    title: job.item.title.clone(),
                })
                .collect::<Vec<_>>();
            let active_titles = active
                .iter()
                .map(|book| book.title.as_str())
                .collect::<Vec<_>>()
                .join("、");
            progress.emit(
                &self.app,
                BulkExportProgressPhase::Syncing,
                active,
                format!("正在同步缺失笔记：{active_titles}。"),
            );

            for job in chunk {
                let app = self.app.clone();
                let book_id = job.item.book_id.clone();
                let notes_dir = notes_dir.clone();
                let exported_at = exported_at.clone();
                let handle = tauri::async_runtime::spawn(async move {
                    NotesService::new(app)
                        .sync_then_export_book_notes_into(&book_id, &notes_dir, &exported_at)
                        .await
                });
                handles.push((job, handle));
            }

            for (job, handle) in handles {
                let prepared = match handle.await {
                    Ok(Ok(file_name)) => PreparedBulkExportItem {
                        order: job.order,
                        book_id: job.item.book_id,
                        title: job.item.title,
                        status: BulkExportItemStatus::Exported,
                        notes_file: Some(format!("notes/{file_name}")),
                        reason: "已同步缺失笔记并导出 Markdown。".to_string(),
                    },
                    Ok(Err(error)) => {
                        let message = error.user_message();
                        let (status, reason) = if message == NO_EXPORTABLE_NOTES_AFTER_SYNC_MESSAGE
                        {
                            (
                                BulkExportItemStatus::Skipped,
                                NO_EXPORTABLE_NOTES_AFTER_SYNC_SKIP_REASON.to_string(),
                            )
                        } else {
                            (BulkExportItemStatus::Failed, message)
                        };

                        PreparedBulkExportItem {
                            order: job.order,
                            book_id: job.item.book_id,
                            title: job.item.title,
                            status,
                            notes_file: None,
                            reason,
                        }
                    }
                    Err(error) => PreparedBulkExportItem {
                        order: job.order,
                        book_id: job.item.book_id,
                        title: job.item.title,
                        status: BulkExportItemStatus::Failed,
                        notes_file: None,
                        reason: format!("同步任务异常结束：{error}"),
                    },
                };

                progress.record(&prepared);
                progress.emit(
                    &self.app,
                    BulkExportProgressPhase::Syncing,
                    Vec::new(),
                    format!("已完成同步任务：{}。", prepared.title),
                );
                prepared_items.push(prepared);
            }
        }
        pending_sync_jobs.clear();

        prepared_items.sort_by_key(|item| item.order);

        let mut items = Vec::new();
        let mut files = Vec::new();
        for prepared in prepared_items {
            let mut status = prepared.status;
            let mut reason = prepared.reason;
            let mut ai_review_file = None;

            if let Some(notes_file) = prepared.notes_file.as_deref() {
                files.push(notes_file.to_string());
            }

            let ai_review_result = self.open_connection().and_then(|connection| {
                export_cached_ai_review_for_book(
                    &connection,
                    &prepared.book_id,
                    &reviews_dir,
                    &exported_at,
                )
            });
            match ai_review_result {
                Ok(Some(file_name)) => {
                    let relative_file = format!("reviews/{file_name}");
                    files.push(relative_file.clone());
                    ai_review_file = Some(relative_file);
                }
                Ok(None) => {
                    if status == BulkExportItemStatus::Exported && prepared.notes_file.is_none() {
                        status = BulkExportItemStatus::Skipped;
                        reason = "本地缓存已变化，没有可导出的内容。".to_string();
                    }
                }
                Err(error) => {
                    status = BulkExportItemStatus::Failed;
                    reason = format!("{reason}；已生成复盘导出失败：{}", error.user_message());
                }
            }

            items.push(BulkExportResultItem {
                book_id: prepared.book_id,
                title: prepared.title,
                status,
                notes_file: prepared.notes_file,
                ai_review_file,
                reason,
            });
        }

        let report = BulkExportReport {
            exported_at: exported_at.clone(),
            strategy: request.strategy,
            concurrency,
            items,
        };
        progress.emit(
            &self.app,
            BulkExportProgressPhase::WritingReport,
            Vec::new(),
            "正在写入批量导出索引和报告。".to_string(),
        );
        fs::write(
            export_dir.join("index.md"),
            serialize_bulk_export_index(&report),
        )
        .map_err(|error| AppError::Storage(error.to_string()))?;
        fs::write(
            export_dir.join("export-report.md"),
            serialize_bulk_export_report(&report),
        )
        .map_err(|error| AppError::Storage(error.to_string()))?;
        files.push("index.md".to_string());
        files.push("export-report.md".to_string());
        progress.emit(
            &self.app,
            BulkExportProgressPhase::Completed,
            Vec::new(),
            "批量导出完成。".to_string(),
        );

        Ok(BulkExportResponse {
            export_id,
            path: export_dir.display().to_string(),
            exported_at,
            files,
            report,
        })
    }

    pub fn cancel_bulk_export(&self) -> Result<(), AppError> {
        BULK_EXPORT_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn export_cached_book_notes_into(
        &self,
        book_id: &str,
        export_dir: &Path,
        exported_at: &str,
    ) -> Result<String, AppError> {
        let connection = self.open_connection()?;
        let notes = read_local_book_notes(&connection, book_id)?;
        if notes.exportable_count == 0 {
            return Err(AppError::InvalidPayload(
                "已缓存笔记但没有划线或想法可导出。".to_string(),
            ));
        }

        write_book_notes_markdown_file(&notes, export_dir, exported_at)
    }

    async fn sync_then_export_book_notes_into(
        &self,
        book_id: &str,
        export_dir: &Path,
        exported_at: &str,
    ) -> Result<String, AppError> {
        let notes = self.get_book_notes(book_id.to_string()).await?;
        if notes.exportable_count == 0 {
            return Err(AppError::InvalidPayload(
                NO_EXPORTABLE_NOTES_AFTER_SYNC_MESSAGE.to_string(),
            ));
        }

        write_book_notes_markdown_file(&notes, export_dir, exported_at)
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn canceled_bulk_export_item(job: BulkExportSyncJob) -> PreparedBulkExportItem {
    PreparedBulkExportItem {
        order: job.order,
        book_id: job.item.book_id,
        title: job.item.title,
        status: BulkExportItemStatus::Canceled,
        notes_file: None,
        reason: "用户已取消，未开始同步。".to_string(),
    }
}

async fn fetch_all_notebooks(
    gateway: &WereadGateway,
    page_size: i64,
) -> Result<(Vec<NotebookBookRecord>, Vec<Value>), AppError> {
    let mut books = Vec::new();
    let mut raw_pages = Vec::new();
    let mut seen_cursors = BTreeSet::new();
    let mut last_sort: Option<i64> = None;

    for _ in 0..MAX_PAGES {
        let mut params = Map::new();
        params.insert("count".to_string(), json!(page_size));
        if let Some(cursor) = last_sort {
            params.insert("lastSort".to_string(), json!(cursor));
        }

        let raw = gateway
            .call(WereadApi::NotebookOverview, Value::Object(params))
            .await?;
        let page = map_notebook_overview_page(&raw);
        raw_pages.push(raw);
        books.extend(page.books);

        if !page.has_more {
            break;
        }

        match page.next_last_sort {
            Some(cursor) if seen_cursors.insert(cursor) => last_sort = Some(cursor),
            _ => break,
        }
    }

    Ok((books, raw_pages))
}

async fn fetch_book_notes(
    gateway: &WereadGateway,
    book_id: &str,
) -> Result<
    (
        Value,
        crate::mappers::notes::BookmarkListRecord,
        Vec<ThoughtRecord>,
        Vec<Value>,
    ),
    AppError,
> {
    let bookmark_raw = gateway
        .call(WereadApi::BookBookmarks, json!({ "bookId": book_id }))
        .await?;
    let bookmark_record = map_bookmark_list_response(book_id, &bookmark_raw);
    let (thoughts, review_raw_pages) =
        fetch_all_mine_reviews(gateway, book_id, DEFAULT_REVIEW_PAGE_SIZE).await?;

    Ok((bookmark_raw, bookmark_record, thoughts, review_raw_pages))
}

async fn fetch_all_mine_reviews(
    gateway: &WereadGateway,
    book_id: &str,
    page_size: i64,
) -> Result<(Vec<ThoughtRecord>, Vec<Value>), AppError> {
    let mut thoughts = Vec::new();
    let mut raw_pages = Vec::new();
    let mut seen_synckeys = BTreeSet::new();
    let mut synckey: Option<i64> = None;

    for _ in 0..MAX_PAGES {
        let mut params = Map::new();
        params.insert("bookid".to_string(), json!(book_id));
        params.insert("count".to_string(), json!(page_size));
        if let Some(cursor) = synckey {
            params.insert("synckey".to_string(), json!(cursor));
        }

        let raw = gateway
            .call(WereadApi::MineReviews, Value::Object(params))
            .await?;
        let page = map_mine_reviews_page(book_id, &raw);
        raw_pages.push(raw);
        thoughts.extend(page.thoughts);

        if !page.has_more {
            break;
        }

        match page.synckey {
            Some(cursor) if seen_synckeys.insert(cursor) => synckey = Some(cursor),
            _ => break,
        }
    }

    Ok((thoughts, raw_pages))
}

fn replace_notebook_books(
    connection: &rusqlite::Connection,
    books: &[NotebookBookRecord],
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM notebook_books", [])
        .map_err(AppError::from)?;

    for book in books {
        connection
            .execute(
                "
                INSERT INTO notebook_books (
                    book_id,
                    title,
                    author,
                    cover,
                    review_count,
                    note_count,
                    bookmark_count,
                    total_note_count,
                    sort,
                    raw_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                rusqlite::params![
                    &book.book_id,
                    &book.title,
                    &book.author,
                    &book.cover,
                    book.review_count,
                    book.note_count,
                    book.bookmark_count,
                    book.total_note_count,
                    book.sort,
                    &book.raw_json,
                    updated_at
                ],
            )
            .map_err(AppError::from)?;
    }

    Ok(())
}

fn replace_highlights(
    connection: &rusqlite::Connection,
    book_id: &str,
    highlights: &[HighlightRecord],
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM highlights WHERE book_id = ?1", [book_id])
        .map_err(AppError::from)?;

    for highlight in highlights {
        connection
            .execute(
                "
                INSERT INTO highlights (
                    bookmark_id,
                    book_id,
                    chapter_uid,
                    chapter_title,
                    mark_text,
                    create_time,
                    range_text,
                    raw_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
                rusqlite::params![
                    &highlight.bookmark_id,
                    &highlight.book_id,
                    highlight.chapter_uid,
                    &highlight.chapter_title,
                    &highlight.mark_text,
                    highlight.create_time,
                    &highlight.range_text,
                    &highlight.raw_json,
                    updated_at
                ],
            )
            .map_err(AppError::from)?;
    }

    Ok(())
}

fn replace_thoughts(
    connection: &rusqlite::Connection,
    book_id: &str,
    thoughts: &[ThoughtRecord],
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM thoughts WHERE book_id = ?1", [book_id])
        .map_err(AppError::from)?;

    for thought in thoughts {
        connection
            .execute(
                "
                INSERT INTO thoughts (
                    review_id,
                    book_id,
                    content,
                    abstract_text,
                    create_time,
                    star,
                    chapter_name,
                    chapter_uid,
                    range_text,
                    deep_link,
                    is_finish,
                    raw_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ",
                rusqlite::params![
                    &thought.review_id,
                    &thought.book_id,
                    &thought.content,
                    &thought.abstract_text,
                    thought.create_time,
                    thought.star,
                    &thought.chapter_name,
                    thought.chapter_uid,
                    &thought.range_text,
                    &thought.deep_link,
                    thought.is_finish.map(bool_to_int),
                    &thought.raw_json,
                    updated_at
                ],
            )
            .map_err(AppError::from)?;
    }

    Ok(())
}

fn read_notebook_book(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<NotebookBookRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT
                book_id,
                title,
                author,
                cover,
                review_count,
                note_count,
                bookmark_count,
                total_note_count,
                sort,
                raw_json
            FROM notebook_books
            WHERE book_id = ?1
            ",
            [book_id],
            map_notebook_book_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn read_all_notebook_books(
    connection: &rusqlite::Connection,
) -> Result<Vec<NotebookBookRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                book_id,
                title,
                author,
                cover,
                review_count,
                note_count,
                bookmark_count,
                total_note_count,
                sort,
                raw_json
            FROM notebook_books
            ORDER BY sort DESC, title ASC
            ",
        )
        .map_err(AppError::from)?;

    let rows = statement
        .query_map([], map_notebook_book_row)
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(rows)
}

fn read_local_book_notes(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<BookNotesRecord, AppError> {
    let book = read_notebook_book(connection, book_id)?;
    let highlights = read_highlights(connection, book_id)?;
    let thoughts = read_thoughts(connection, book_id)?;

    if book.is_none() && highlights.is_empty() && thoughts.is_empty() {
        return Err(AppError::InvalidPayload(
            "需要同步/读取后才能导出。".to_string(),
        ));
    }

    Ok(build_book_notes_record(
        book_id,
        book,
        highlights,
        thoughts,
        vec![],
    ))
}

fn read_all_cached_book_notes(
    connection: &rusqlite::Connection,
) -> Result<Vec<BookNotesRecord>, AppError> {
    let book_ids = connection
        .prepare(
            "
            SELECT book_id FROM highlights
            UNION
            SELECT book_id FROM thoughts
            ",
        )
        .map_err(AppError::from)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    book_ids
        .into_iter()
        .map(|book_id| read_local_book_notes(connection, &book_id))
        .collect()
}

fn read_highlights(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<HighlightRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                bookmark_id,
                book_id,
                chapter_uid,
                chapter_title,
                mark_text,
                create_time,
                range_text,
                raw_json
            FROM highlights
            WHERE book_id = ?1
            ORDER BY create_time ASC
            ",
        )
        .map_err(AppError::from)?;

    let rows = statement
        .query_map([book_id], |row| {
            let normalized_book_id: String = row.get(1)?;
            let chapter_uid = row.get(2)?;
            Ok(HighlightRecord {
                bookmark_id: row.get(0)?,
                book_id: normalized_book_id.clone(),
                chapter_uid,
                chapter_title: row.get(3)?,
                mark_text: row.get(4)?,
                create_time: row.get(5)?,
                range_text: row.get(6)?,
                deep_link: chapter_uid.map(|uid| {
                    format!("weread://reading?bId={normalized_book_id}&chapterUid={uid}")
                }),
                raw_json: row.get(7)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(rows)
}

fn read_thoughts(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<ThoughtRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                review_id,
                book_id,
                content,
                abstract_text,
                create_time,
                star,
                chapter_name,
                chapter_uid,
                range_text,
                deep_link,
                is_finish,
                raw_json
            FROM thoughts
            WHERE book_id = ?1
            ORDER BY create_time ASC
            ",
        )
        .map_err(AppError::from)?;

    let rows = statement
        .query_map([book_id], |row| {
            let is_finish: Option<i64> = row.get(10)?;
            Ok(ThoughtRecord {
                review_id: row.get(0)?,
                book_id: row.get(1)?,
                content: row.get(2)?,
                abstract_text: row.get(3)?,
                create_time: row.get(4)?,
                star: row.get(5)?,
                chapter_name: row.get(6)?,
                chapter_uid: row.get(7)?,
                range_text: row.get(8)?,
                deep_link: row.get(9)?,
                is_finish: is_finish.map(|value| value == 1),
                raw_json: row.get(11)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(rows)
}

fn read_cached_ai_review_book_ids(
    connection: &rusqlite::Connection,
) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT DISTINCT scope_id
            FROM ai_outputs
            WHERE feature = ?1 AND prompt_version = ?2
            ",
        )
        .map_err(AppError::from)?;

    let rows = statement
        .query_map(
            rusqlite::params![
                BOOK_NOTES_SUMMARY_FEATURE,
                BOOK_NOTES_SUMMARY_PROMPT_VERSION
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(rows)
}

fn read_latest_cached_ai_review(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<AiCachedOutputRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT
                feature,
                scope_id,
                prompt_version,
                input_hash,
                output_json,
                source_count,
                provider_model,
                created_at,
                updated_at
            FROM ai_outputs
            WHERE feature = ?1 AND prompt_version = ?2 AND scope_id = ?3
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            rusqlite::params![
                BOOK_NOTES_SUMMARY_FEATURE,
                BOOK_NOTES_SUMMARY_PROMPT_VERSION,
                book_id
            ],
            |row| {
                let output_json: String = row.get(4)?;
                let output = serde_json::from_str::<Value>(&output_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(AiCachedOutputRecord {
                    feature: row.get(0)?,
                    scope_id: row.get(1)?,
                    prompt_version: row.get(2)?,
                    input_hash: row.get(3)?,
                    output,
                    source_count: row.get(5)?,
                    provider_model: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)
}

fn write_book_notes_markdown_file(
    notes: &BookNotesRecord,
    export_dir: &Path,
    exported_at: &str,
) -> Result<String, AppError> {
    fs::create_dir_all(export_dir).map_err(|error| AppError::Storage(error.to_string()))?;
    let title = notes
        .book
        .as_ref()
        .map(|book| book.title.as_str())
        .unwrap_or(notes.book_id.as_str());
    let file_name = format!(
        "{}-{}.md",
        sanitize_file_stem(title, &notes.book_id),
        exported_at
    );
    let markdown = serialize_book_notes_markdown(notes, exported_at);
    fs::write(export_dir.join(&file_name), markdown)
        .map_err(|error| AppError::Storage(error.to_string()))?;

    Ok(file_name)
}

fn export_cached_ai_review_for_book(
    connection: &rusqlite::Connection,
    book_id: &str,
    export_dir: &Path,
    exported_at: &str,
) -> Result<Option<String>, AppError> {
    let Some(cached) = read_latest_cached_ai_review(connection, book_id)? else {
        return Ok(None);
    };
    let summary = serde_json::from_value::<BookAiSummary>(cached.output)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    let notes = read_local_book_notes(connection, book_id)
        .unwrap_or_else(|_| build_book_notes_record(book_id, None, vec![], vec![], vec![]));
    let title = notes
        .book
        .as_ref()
        .map(|book| book.title.as_str())
        .unwrap_or(book_id);
    let author = notes.book.as_ref().and_then(|book| book.author.as_deref());
    let response = BookAiSummaryResponse {
        book_id: book_id.to_string(),
        prompt_version: cached.prompt_version,
        input_hash: cached.input_hash,
        provider_model: cached.provider_model,
        source: BookAiSummarySource::Cache,
        summary,
        cached_updated_at: Some(cached.updated_at),
        error_message: None,
    };
    let file_name = format!(
        "{}-ai-summary-{}.md",
        sanitize_file_stem(title, book_id),
        exported_at
    );
    let markdown =
        serialize_book_ai_summary_markdown(book_id, title, author, &response, exported_at, None);
    fs::create_dir_all(export_dir).map_err(|error| AppError::Storage(error.to_string()))?;
    fs::write(export_dir.join(&file_name), markdown)
        .map_err(|error| AppError::Storage(error.to_string()))?;

    Ok(Some(file_name))
}

fn summarize_notebook_books(books: &[NotebookBookRecord]) -> NotebookOverviewSummary {
    NotebookOverviewSummary {
        total_book_count: books.len() as i64,
        total_note_count: books.iter().map(|book| book.total_note_count).sum(),
    }
}

fn dedupe_notebook_books(books: Vec<NotebookBookRecord>) -> Vec<NotebookBookRecord> {
    let mut seen = BTreeSet::new();
    books
        .into_iter()
        .filter(|book| seen.insert(book.book_id.clone()))
        .collect()
}

fn dedupe_highlights(highlights: Vec<HighlightRecord>) -> Vec<HighlightRecord> {
    let mut seen = BTreeSet::new();
    highlights
        .into_iter()
        .filter(|highlight| seen.insert(highlight.bookmark_id.clone()))
        .collect()
}

fn dedupe_thoughts(thoughts: Vec<ThoughtRecord>) -> Vec<ThoughtRecord> {
    let mut seen = BTreeSet::new();
    thoughts
        .into_iter()
        .filter(|thought| seen.insert(thought.review_id.clone()))
        .collect()
}

fn map_notebook_book_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotebookBookRecord> {
    Ok(NotebookBookRecord {
        book_id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        cover: row.get(3)?,
        review_count: row.get(4)?,
        note_count: row.get(5)?,
        bookmark_count: row.get(6)?,
        total_note_count: row.get(7)?,
        reading_progress: None,
        marked_status: None,
        sort: row.get(8)?,
        raw_json: row.get(9)?,
    })
}

fn normalize_book_id(book_id: &str) -> Result<String, AppError> {
    let trimmed = book_id.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("bookId 不能为空。".to_string()));
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(AppError::InvalidPayload(
            "bookId 只能包含字母、数字、下划线或连字符。".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

fn clamp_page_size(value: Option<i64>, default_value: i64) -> i64 {
    value.unwrap_or(default_value).clamp(1, MAX_PAGE_SIZE)
}

fn sanitize_file_stem(title: &str, fallback: &str) -> String {
    let sanitized = title
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim_matches(&[' ', '.'][..])
        .chars()
        .take(80)
        .collect::<String>();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use crate::{db::initialize_schema, mappers::notes::map_notebook_overview_page};

    use super::{
        read_notebook_book, replace_highlights, replace_notebook_books, replace_thoughts,
        sanitize_file_stem,
    };

    #[test]
    fn notes_persistence_writes_overview_highlights_and_thoughts() {
        let connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let page = map_notebook_overview_page(&serde_json::json!({
            "books": [{
                "bookId": "b1",
                "book": { "title": "书名" },
                "reviewCount": 1,
                "noteCount": 2,
                "bookmarkCount": 3
            }]
        }));

        replace_notebook_books(&connection, &page.books, "100").expect("books should save");
        let book = read_notebook_book(&connection, "b1")
            .expect("book should query")
            .expect("book should exist");

        replace_highlights(&connection, "b1", &[], "100").expect("highlights should clear");
        replace_thoughts(&connection, "b1", &[], "100").expect("thoughts should clear");

        assert_eq!(book.total_note_count, 6);
    }

    #[test]
    fn sanitize_file_stem_removes_windows_forbidden_characters() {
        assert_eq!(sanitize_file_stem("a:b/c*?", "fallback"), "abc");
        assert_eq!(sanitize_file_stem("...", "fallback"), "fallback");
    }
}
