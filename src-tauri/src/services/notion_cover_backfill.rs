use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Client;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    db::{self, NotionDatabaseConnectionConfig, NotionPropertyMappingConfig},
    errors::AppError,
    export::{
        notion::{
            add_database_files_property, analyze_database, notion_client, page_cover_is_empty,
            page_files_property_is_empty, page_property_plain_text, page_title,
            query_database_pages, retrieve_page, update_page_cover, update_page_files_property,
            NotionDatabaseAnalysis, NotionExportOptions, NotionPropertySummary,
        },
        targets::NotionParentType,
    },
    services::notion_credentials::NotionCredentialService,
};

pub const NOTION_COVER_BACKFILL_PROGRESS_EVENT: &str = "notion-cover-backfill-progress";
const COVER_PROPERTY_NAME: &str = "封面";
const MAX_REPORT_ITEMS: usize = 500;

static BACKFILL_ACTIVE: AtomicBool = AtomicBool::new(false);
static BACKFILL_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static BACKFILL_OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);
static ACTIVE_OPERATION_ID: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionCoverPropertyAction {
    Reuse,
    Create,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionCoverPropertyPlan {
    pub action: NotionCoverPropertyAction,
    pub property_id: Option<String>,
    pub property_name: Option<String>,
    pub property_type: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionCoverBackfillPreflight {
    pub preflight_id: String,
    pub database_id: String,
    pub database_name: Option<String>,
    pub schema_fingerprint: String,
    pub connection_schema_changed: bool,
    pub cover_property: NotionCoverPropertyPlan,
    pub book_id_property_id: Option<String>,
    pub book_id_property_name: Option<String>,
    pub total_pages: usize,
    pub pages_with_book_id: usize,
    pub pages_with_local_cover: usize,
    pub missing_local_cover: usize,
    pub missing_cover_property: usize,
    pub missing_page_cover: usize,
    pub preserved_cover_property: usize,
    pub preserved_page_cover: usize,
    pub eligible_pages: usize,
    pub can_run: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNotionCoverBackfillRequest {
    pub preflight_id: String,
    pub database_id: String,
    pub schema_fingerprint: String,
    pub cover_property_action: NotionCoverPropertyAction,
    pub confirm: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionCoverBackfillPhase {
    Validating,
    UpgradingSchema,
    UpdatingPages,
    Canceling,
    Completed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionCoverBackfillItemStatus {
    Updated,
    Partial,
    Preserved,
    Skipped,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionCoverBackfillItemResult {
    pub page_id: String,
    pub title: String,
    pub book_id: Option<String>,
    pub status: NotionCoverBackfillItemStatus,
    pub property_updated: bool,
    pub page_cover_updated: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionCoverBackfillProgress {
    pub operation_id: String,
    pub phase: NotionCoverBackfillPhase,
    pub total: usize,
    pub completed: usize,
    pub updated: usize,
    pub partial: usize,
    pub preserved: usize,
    pub skipped: usize,
    pub failed: usize,
    pub canceled: usize,
    pub current_page_id: Option<String>,
    pub current_title: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionCoverBackfillReport {
    pub operation_id: String,
    pub preflight_id: String,
    pub database_id: String,
    pub cover_property_id: String,
    pub cover_property_name: String,
    pub total: usize,
    pub completed: usize,
    pub updated: usize,
    pub partial: usize,
    pub preserved: usize,
    pub skipped: usize,
    pub failed: usize,
    pub canceled: usize,
    pub was_canceled: bool,
    pub schema_upgraded: bool,
    pub started_at: String,
    pub completed_at: String,
    pub items: Vec<NotionCoverBackfillItemResult>,
    pub warnings: Vec<String>,
}

pub struct NotionCoverBackfillService {
    app: AppHandle,
}

impl NotionCoverBackfillService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn preflight(&self) -> Result<NotionCoverBackfillPreflight, AppError> {
        ensure_no_active_backfill()?;
        let context = self.load_context().await?;
        let local_covers = load_local_cover_urls(&self.app, &context)?;
        build_preflight(&local_covers, &context)
    }

    pub async fn run(
        &self,
        request: RunNotionCoverBackfillRequest,
    ) -> Result<NotionCoverBackfillReport, AppError> {
        validate_run_request(&request)?;
        let operation_id = next_operation_id();
        let _guard = try_begin_backfill(&operation_id)?;
        BACKFILL_CANCEL_REQUESTED.store(false, Ordering::Release);
        let started_at = current_timestamp();
        let mut context = self.load_context().await?;
        let local_covers = load_local_cover_urls(&self.app, &context)?;
        let preflight = build_preflight(&local_covers, &context)?;
        validate_preflight_snapshot(&request, &preflight)?;

        emit_progress(
            &self.app,
            NotionCoverBackfillProgress {
                operation_id: operation_id.clone(),
                phase: NotionCoverBackfillPhase::Validating,
                total: preflight.total_pages,
                completed: 0,
                updated: 0,
                partial: 0,
                preserved: 0,
                skipped: 0,
                failed: 0,
                canceled: 0,
                current_page_id: None,
                current_title: None,
                message: "安全预检已通过，正在确认封面字段。".to_string(),
            },
        );

        let mut schema_upgraded = false;
        if preflight.cover_property.action == NotionCoverPropertyAction::Create {
            emit_simple_phase(
                &self.app,
                &operation_id,
                NotionCoverBackfillPhase::UpgradingSchema,
                preflight.total_pages,
                "正在新增封面 Files & media 属性。",
            );
            add_database_files_property(&context.client, &context.options, COVER_PROPERTY_NAME)
                .await
                .map_err(|error| AppError::Gateway(format!("新增 Notion 封面属性失败：{error}")))?;
            schema_upgraded = true;
            let analysis = analyze_database(&context.options.token, &context.options.parent_id)
                .await
                .map_err(|error| {
                    AppError::Gateway(format!("封面属性已提交，但重新检查数据库失败：{error}"))
                })?;
            context.analysis = analysis;
            self.save_cover_mapping(&context.analysis)?;
        }

        let cover_property = resolve_cover_property(&context.analysis);
        if cover_property.action != NotionCoverPropertyAction::Reuse {
            return Err(AppError::InvalidPayload(
                "封面属性升级后仍无法确认唯一的 Files & media 字段，已停止回填。".to_string(),
            ));
        }
        let cover_property_id = cover_property.property_id.clone().unwrap_or_default();
        let cover_property_name = cover_property.property_name.clone().unwrap_or_default();
        let book_id_property = resolve_book_id_property(&context.connection, &context.analysis)
            .map_err(AppError::InvalidPayload)?;
        let pages = query_database_pages(&context.client, &context.options)
            .await
            .map_err(|error| AppError::Gateway(format!("读取 Notion 成果页失败：{error}")))?;

        let mut tracker = ProgressTracker::new(operation_id.clone(), pages.len());
        let mut items = Vec::new();
        for page in pages {
            if BACKFILL_CANCEL_REQUESTED.load(Ordering::Acquire) {
                tracker.cancel_remaining();
                break;
            }
            let page_id = page
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown-page")
                .to_string();
            let title = page_title(&page).unwrap_or_else(|| "未命名成果页".to_string());
            tracker.emit_active(&self.app, &page_id, &title);
            let item = self
                .process_page(
                    &local_covers,
                    &context,
                    &page_id,
                    &title,
                    &book_id_property.name,
                    &cover_property_name,
                )
                .await;
            tracker.record(&item);
            tracker.emit_result(&self.app, &item);
            if items.len() < MAX_REPORT_ITEMS {
                items.push(item);
            }
        }

        let was_canceled = BACKFILL_CANCEL_REQUESTED.load(Ordering::Acquire);
        tracker.emit_completed(&self.app, was_canceled);
        let mut warnings = Vec::new();
        if tracker.total > MAX_REPORT_ITEMS {
            warnings.push(format!(
                "报告明细最多保留 {MAX_REPORT_ITEMS} 条，汇总计数仍包含全部页面。"
            ));
        }
        Ok(NotionCoverBackfillReport {
            operation_id,
            preflight_id: request.preflight_id,
            database_id: context.options.parent_id,
            cover_property_id,
            cover_property_name,
            total: tracker.total,
            completed: tracker.completed,
            updated: tracker.updated,
            partial: tracker.partial,
            preserved: tracker.preserved,
            skipped: tracker.skipped,
            failed: tracker.failed,
            canceled: tracker.canceled,
            was_canceled,
            schema_upgraded,
            started_at,
            completed_at: current_timestamp(),
            items,
            warnings,
        })
    }

    pub fn cancel(&self, operation_id: String) -> Result<(), AppError> {
        let active = ACTIVE_OPERATION_ID
            .lock()
            .map_err(|_| AppError::Storage("封面回填任务状态锁已损坏。".to_string()))?;
        match active.as_deref() {
            Some(active_id) if active_id == operation_id.trim() => {
                BACKFILL_CANCEL_REQUESTED.store(true, Ordering::Release);
                Ok(())
            }
            Some(_) => Err(AppError::InvalidPayload(
                "operation ID 与当前封面回填任务不一致。".to_string(),
            )),
            None => Err(AppError::InvalidPayload(
                "当前没有正在执行的封面回填任务。".to_string(),
            )),
        }
    }

    async fn load_context(&self) -> Result<BackfillContext, AppError> {
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let integration = db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        let connection = integration.notion_database_connection.ok_or_else(|| {
            AppError::InvalidPayload("请先检查并保存 Notion 数据库连接。".to_string())
        })?;
        let token = NotionCredentialService::new(self.app.clone())
            .read_token()
            .map_err(|error| AppError::Authentication(error.user_message()))?;
        let options = notion_options(&token, &connection);
        let analysis = analyze_database(&token, &connection.database_id)
            .await
            .map_err(|error| AppError::Gateway(format!("检查 Notion 数据库失败：{error}")))?;
        if normalize_notion_id(&analysis.database_id)
            != normalize_notion_id(&connection.database_id)
        {
            return Err(AppError::InvalidPayload(
                "Notion 返回的 database ID 与已保存连接不一致，已拒绝回填。".to_string(),
            ));
        }
        let client = notion_client().map_err(AppError::Gateway)?;
        let pages = query_database_pages(&client, &options)
            .await
            .map_err(|error| AppError::Gateway(format!("读取 Notion 成果页失败：{error}")))?;
        Ok(BackfillContext {
            client,
            options,
            connection,
            analysis,
            pages,
        })
    }

    async fn process_page(
        &self,
        local_covers: &HashMap<String, String>,
        context: &BackfillContext,
        page_id: &str,
        fallback_title: &str,
        book_id_property_name: &str,
        cover_property_name: &str,
    ) -> NotionCoverBackfillItemResult {
        let latest = match retrieve_page(&context.client, &context.options, page_id).await {
            Ok(page) => page,
            Err(error) => {
                return item_result(
                    page_id,
                    fallback_title,
                    None,
                    NotionCoverBackfillItemStatus::Failed,
                    false,
                    false,
                    format!("读取页面最新状态失败：{error}"),
                )
            }
        };
        let title = page_title(&latest).unwrap_or_else(|| fallback_title.to_string());
        let book_id = page_property_plain_text(&latest, book_id_property_name);
        let Some(book_id_value) = book_id.as_deref() else {
            return item_result(
                page_id,
                &title,
                None,
                NotionCoverBackfillItemStatus::Skipped,
                false,
                false,
                "缺少 Book ID，无法匹配本地封面。".to_string(),
            );
        };
        let property_empty = page_files_property_is_empty(&latest, cover_property_name);
        let page_cover_empty = page_cover_is_empty(&latest);
        if !property_empty && !page_cover_empty {
            return item_result(
                page_id,
                &title,
                book_id,
                NotionCoverBackfillItemStatus::Preserved,
                false,
                false,
                "封面属性和页面封面均已有值，已保留人工内容。".to_string(),
            );
        }
        let Some(cover_url) = local_covers.get(book_id_value) else {
            return item_result(
                page_id,
                &title,
                book_id,
                NotionCoverBackfillItemStatus::Skipped,
                false,
                false,
                "本地缓存没有可用的 HTTP(S) 封面，已跳过。".to_string(),
            );
        };

        let mut property_updated = false;
        let mut page_cover_updated = false;
        let mut errors = Vec::new();
        if property_empty {
            match update_page_files_property(
                &context.client,
                &context.options,
                page_id,
                cover_property_name,
                cover_url,
            )
            .await
            {
                Ok(_) => property_updated = true,
                Err(error) => errors.push(format!("封面属性：{error}")),
            }
        }
        if page_cover_empty {
            match update_page_cover(&context.client, &context.options, page_id, cover_url).await {
                Ok(_) => page_cover_updated = true,
                Err(error) => errors.push(format!("页面封面：{error}")),
            }
        }

        let attempted = usize::from(property_empty) + usize::from(page_cover_empty);
        let succeeded = usize::from(property_updated) + usize::from(page_cover_updated);
        let status = if succeeded == attempted {
            NotionCoverBackfillItemStatus::Updated
        } else if succeeded > 0 {
            NotionCoverBackfillItemStatus::Partial
        } else {
            NotionCoverBackfillItemStatus::Failed
        };
        let reason = if errors.is_empty() {
            "已补齐缺失封面，原有值未覆盖。".to_string()
        } else {
            errors.join("；")
        };
        item_result(
            page_id,
            &title,
            book_id,
            status,
            property_updated,
            page_cover_updated,
            reason,
        )
    }

    fn save_cover_mapping(&self, analysis: &NotionDatabaseAnalysis) -> Result<(), AppError> {
        let cover = resolve_cover_property(analysis);
        let (Some(property_id), Some(property_name)) =
            (cover.property_id.as_ref(), cover.property_name.as_ref())
        else {
            return Err(AppError::InvalidPayload(
                "数据库已有改动，但无法保存封面字段映射。".to_string(),
            ));
        };
        let config_dir = db::default_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut integration =
            db::read_integration_config(&config_dir).map_err(AppError::Storage)?;
        let mut connection = integration.notion_database_connection.ok_or_else(|| {
            AppError::InvalidPayload("Notion 数据库连接已丢失，无法保存封面映射。".to_string())
        })?;
        connection
            .mappings
            .retain(|mapping| mapping.logical_field != "cover");
        connection.mappings.push(NotionPropertyMappingConfig {
            logical_field: "cover".to_string(),
            property_id: property_id.clone(),
            property_name_snapshot: property_name.clone(),
            property_type: "files".to_string(),
            enabled: true,
        });
        connection.schema_checked_at = analysis.schema_checked_at.clone();
        connection.schema_fingerprint = analysis.schema_fingerprint.clone();
        integration.notion_database_connection = Some(connection);
        db::write_integration_config(&config_dir, &integration).map_err(AppError::Storage)
    }
}

struct BackfillContext {
    client: Client,
    options: NotionExportOptions,
    connection: NotionDatabaseConnectionConfig,
    analysis: NotionDatabaseAnalysis,
    pages: Vec<Value>,
}

#[derive(Debug, Clone)]
struct ResolvedProperty {
    id: String,
    name: String,
}

fn build_preflight(
    local_covers: &HashMap<String, String>,
    context: &BackfillContext,
) -> Result<NotionCoverBackfillPreflight, AppError> {
    let cover_property = resolve_cover_property(&context.analysis);
    let book_id_property = resolve_book_id_property(&context.connection, &context.analysis);
    let mut blockers = Vec::new();
    if cover_property.action == NotionCoverPropertyAction::Conflict {
        blockers.push(cover_property.message.clone());
    }
    if let Err(error) = &book_id_property {
        blockers.push(error.clone());
    }
    let mut warnings = Vec::new();
    let current_fingerprint = context.analysis.schema_fingerprint.clone().ok_or_else(|| {
        AppError::InvalidPayload("Notion 数据库缺少 schema fingerprint。".to_string())
    })?;
    let connection_schema_changed =
        context.connection.schema_fingerprint.as_deref() != Some(current_fingerprint.as_str());
    if connection_schema_changed {
        warnings.push(
            "数据库字段自上次保存连接后发生变化；执行时将以本次预检 fingerprint 为安全边界。"
                .to_string(),
        );
    }

    let mut pages_with_book_id = 0;
    let mut pages_with_local_cover = 0;
    let mut missing_local_cover = 0;
    let mut missing_cover_property = 0;
    let mut missing_page_cover = 0;
    let mut preserved_cover_property = 0;
    let mut preserved_page_cover = 0;
    let mut eligible_pages = 0;
    if let Ok(book_id_property) = &book_id_property {
        for page in &context.pages {
            let property_empty = cover_property
                .property_name
                .as_deref()
                .map(|name| page_files_property_is_empty(page, name))
                .unwrap_or(true);
            let page_cover_empty = page_cover_is_empty(page);
            if property_empty {
                missing_cover_property += 1;
            } else {
                preserved_cover_property += 1;
            }
            if page_cover_empty {
                missing_page_cover += 1;
            } else {
                preserved_page_cover += 1;
            }
            let book_id = page_property_plain_text(page, &book_id_property.name);
            let Some(book_id) = book_id else {
                continue;
            };
            pages_with_book_id += 1;
            if local_covers.contains_key(&book_id) {
                pages_with_local_cover += 1;
                if property_empty || page_cover_empty {
                    eligible_pages += 1;
                }
            } else {
                missing_local_cover += 1;
            }
        }
    }

    Ok(NotionCoverBackfillPreflight {
        preflight_id: next_preflight_id(),
        database_id: context.analysis.database_id.clone(),
        database_name: context.analysis.database_name.clone(),
        schema_fingerprint: current_fingerprint,
        connection_schema_changed,
        cover_property,
        book_id_property_id: book_id_property.as_ref().ok().map(|value| value.id.clone()),
        book_id_property_name: book_id_property
            .as_ref()
            .ok()
            .map(|value| value.name.clone()),
        total_pages: context.pages.len(),
        pages_with_book_id,
        pages_with_local_cover,
        missing_local_cover,
        missing_cover_property,
        missing_page_cover,
        preserved_cover_property,
        preserved_page_cover,
        eligible_pages,
        can_run: blockers.is_empty(),
        blockers,
        warnings,
    })
}

fn resolve_cover_property(analysis: &NotionDatabaseAnalysis) -> NotionCoverPropertyPlan {
    let candidates = analysis
        .properties
        .iter()
        .filter(|property| {
            property.name.eq_ignore_ascii_case(COVER_PROPERTY_NAME)
                || property.name.eq_ignore_ascii_case("Cover")
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return NotionCoverPropertyPlan {
            action: NotionCoverPropertyAction::Create,
            property_id: None,
            property_name: Some(COVER_PROPERTY_NAME.to_string()),
            property_type: Some("files".to_string()),
            message: "数据库缺少封面属性；执行时将新增 Files & media 字段。".to_string(),
        };
    }
    if candidates.len() != 1 {
        return NotionCoverPropertyPlan {
            action: NotionCoverPropertyAction::Conflict,
            property_id: None,
            property_name: None,
            property_type: None,
            message: "数据库存在多个封面候选字段，无法安全判断应使用哪一个。".to_string(),
        };
    }
    let property = candidates[0];
    if property.property_type != "files" {
        return NotionCoverPropertyPlan {
            action: NotionCoverPropertyAction::Conflict,
            property_id: Some(property.id.clone()),
            property_name: Some(property.name.clone()),
            property_type: Some(property.property_type.clone()),
            message: format!(
                "字段“{}”不是 Files & media 类型，已拒绝自动修改或覆盖。",
                property.name
            ),
        };
    }
    NotionCoverPropertyPlan {
        action: NotionCoverPropertyAction::Reuse,
        property_id: Some(property.id.clone()),
        property_name: Some(property.name.clone()),
        property_type: Some(property.property_type.clone()),
        message: format!("将复用现有 Files & media 字段“{}”。", property.name),
    }
}

fn resolve_book_id_property(
    connection: &NotionDatabaseConnectionConfig,
    analysis: &NotionDatabaseAnalysis,
) -> Result<ResolvedProperty, String> {
    if let Some(mapping) = connection
        .mappings
        .iter()
        .find(|mapping| mapping.enabled && mapping.logical_field == "bookId")
    {
        if let Some(property) = analysis.properties.iter().find(|property| {
            property.id == mapping.property_id && property.property_type == "rich_text"
        }) {
            return Ok(resolved_property(property));
        }
    }
    let candidates = analysis
        .properties
        .iter()
        .filter(|property| {
            property.property_type == "rich_text"
                && ["Book ID", "书籍 ID", "书籍ID"]
                    .iter()
                    .any(|name| property.name.eq_ignore_ascii_case(name))
        })
        .collect::<Vec<_>>();
    match candidates.as_slice() {
        [property] => Ok(resolved_property(property)),
        [] => Err("数据库缺少唯一的 Book ID rich_text 字段，无法匹配本地封面。".to_string()),
        _ => Err("数据库存在多个 Book ID 候选字段，无法安全匹配本地封面。".to_string()),
    }
}

fn resolved_property(property: &NotionPropertySummary) -> ResolvedProperty {
    ResolvedProperty {
        id: property.id.clone(),
        name: property.name.clone(),
    }
}

fn load_local_cover_urls(
    app: &AppHandle,
    context: &BackfillContext,
) -> Result<HashMap<String, String>, AppError> {
    let Ok(book_id_property) = resolve_book_id_property(&context.connection, &context.analysis)
    else {
        return Ok(HashMap::new());
    };
    let connection = db::open_connection(app).map_err(AppError::Storage)?;
    let mut covers = HashMap::new();
    for page in &context.pages {
        let Some(book_id) = page_property_plain_text(page, &book_id_property.name) else {
            continue;
        };
        if covers.contains_key(&book_id) {
            continue;
        }
        if let Some(url) = local_cover_url(&connection, &book_id).map_err(AppError::Storage)? {
            covers.insert(book_id, url);
        }
    }
    Ok(covers)
}

fn local_cover_url(connection: &Connection, book_id: &str) -> Result<Option<String>, String> {
    for (sql, parameter) in [
        (
            "SELECT cover FROM notebook_books WHERE book_id = ?1",
            book_id,
        ),
        ("SELECT cover FROM book_details WHERE book_id = ?1", book_id),
        ("SELECT cover FROM shelf_entries WHERE id = ?1", book_id),
    ] {
        let value = connection
            .query_row(sql, [parameter], |row| row.get::<_, Option<String>>(0))
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        if let Some(url) = value.as_deref().and_then(valid_external_url) {
            return Ok(Some(url.to_string()));
        }
    }
    Ok(None)
}

fn valid_external_url(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty() && (value.starts_with("https://") || value.starts_with("http://")))
        .then_some(value)
}

fn notion_options(token: &str, connection: &NotionDatabaseConnectionConfig) -> NotionExportOptions {
    NotionExportOptions {
        token: token.to_string(),
        parent_id: connection.database_id.clone(),
        parent_type: NotionParentType::Database,
        use_page_cover: true,
        property_mappings: connection
            .mappings
            .iter()
            .map(|mapping| crate::export::notion::NotionPropertyMapping {
                logical_field: mapping.logical_field.clone(),
                property_id: mapping.property_id.clone(),
                property_name_snapshot: mapping.property_name_snapshot.clone(),
                property_type: mapping.property_type.clone(),
                enabled: mapping.enabled,
            })
            .collect(),
    }
}

fn validate_run_request(request: &RunNotionCoverBackfillRequest) -> Result<(), AppError> {
    if !request.confirm {
        return Err(AppError::InvalidPayload(
            "封面回填需要显式确认。".to_string(),
        ));
    }
    if request.preflight_id.trim().is_empty()
        || request.database_id.trim().is_empty()
        || request.schema_fingerprint.trim().is_empty()
    {
        return Err(AppError::InvalidPayload(
            "封面回填请求缺少预检安全字段，请重新预检。".to_string(),
        ));
    }
    if request.cover_property_action == NotionCoverPropertyAction::Conflict {
        return Err(AppError::InvalidPayload(
            "预检存在封面字段冲突，不能执行回填。".to_string(),
        ));
    }
    Ok(())
}

fn validate_preflight_snapshot(
    request: &RunNotionCoverBackfillRequest,
    current: &NotionCoverBackfillPreflight,
) -> Result<(), AppError> {
    if !current.can_run {
        return Err(AppError::InvalidPayload(format!(
            "最新预检未通过：{}",
            current.blockers.join("；")
        )));
    }
    if normalize_notion_id(&request.database_id) != normalize_notion_id(&current.database_id) {
        return Err(AppError::InvalidPayload(
            "数据库连接已变化，请重新预检后再执行。".to_string(),
        ));
    }
    if request.schema_fingerprint != current.schema_fingerprint {
        return Err(AppError::InvalidPayload(
            "数据库字段结构在确认后发生变化，请重新预检，避免写入错误字段。".to_string(),
        ));
    }
    if request.cover_property_action != current.cover_property.action {
        return Err(AppError::InvalidPayload(
            "封面字段处理方案已变化，请重新预检后再执行。".to_string(),
        ));
    }
    Ok(())
}

fn item_result(
    page_id: &str,
    title: &str,
    book_id: Option<String>,
    status: NotionCoverBackfillItemStatus,
    property_updated: bool,
    page_cover_updated: bool,
    reason: String,
) -> NotionCoverBackfillItemResult {
    NotionCoverBackfillItemResult {
        page_id: page_id.to_string(),
        title: title.to_string(),
        book_id,
        status,
        property_updated,
        page_cover_updated,
        reason,
    }
}

struct ProgressTracker {
    operation_id: String,
    total: usize,
    completed: usize,
    updated: usize,
    partial: usize,
    preserved: usize,
    skipped: usize,
    failed: usize,
    canceled: usize,
}

impl ProgressTracker {
    fn new(operation_id: String, total: usize) -> Self {
        Self {
            operation_id,
            total,
            completed: 0,
            updated: 0,
            partial: 0,
            preserved: 0,
            skipped: 0,
            failed: 0,
            canceled: 0,
        }
    }

    fn record(&mut self, item: &NotionCoverBackfillItemResult) {
        self.completed += 1;
        match item.status {
            NotionCoverBackfillItemStatus::Updated => self.updated += 1,
            NotionCoverBackfillItemStatus::Partial => self.partial += 1,
            NotionCoverBackfillItemStatus::Preserved => self.preserved += 1,
            NotionCoverBackfillItemStatus::Skipped => self.skipped += 1,
            NotionCoverBackfillItemStatus::Failed => self.failed += 1,
            NotionCoverBackfillItemStatus::Canceled => self.canceled += 1,
        }
    }

    fn cancel_remaining(&mut self) {
        self.canceled = self.total.saturating_sub(self.completed);
    }

    fn emit_active(&self, app: &AppHandle, page_id: &str, title: &str) {
        self.emit(
            app,
            NotionCoverBackfillPhase::UpdatingPages,
            Some(page_id.to_string()),
            Some(title.to_string()),
            format!("正在处理：{title}"),
        );
    }

    fn emit_result(&self, app: &AppHandle, item: &NotionCoverBackfillItemResult) {
        self.emit(
            app,
            NotionCoverBackfillPhase::UpdatingPages,
            None,
            None,
            format!("已处理：{}", item.title),
        );
    }

    fn emit_completed(&self, app: &AppHandle, canceled: bool) {
        self.emit(
            app,
            if canceled {
                NotionCoverBackfillPhase::Canceling
            } else {
                NotionCoverBackfillPhase::Completed
            },
            None,
            None,
            if canceled {
                "封面回填已取消，已完成的修改将保留。".to_string()
            } else {
                "封面回填已完成。".to_string()
            },
        );
    }

    fn emit(
        &self,
        app: &AppHandle,
        phase: NotionCoverBackfillPhase,
        current_page_id: Option<String>,
        current_title: Option<String>,
        message: String,
    ) {
        emit_progress(
            app,
            NotionCoverBackfillProgress {
                operation_id: self.operation_id.clone(),
                phase,
                total: self.total,
                completed: self.completed,
                updated: self.updated,
                partial: self.partial,
                preserved: self.preserved,
                skipped: self.skipped,
                failed: self.failed,
                canceled: self.canceled,
                current_page_id,
                current_title,
                message,
            },
        );
    }
}

fn emit_simple_phase(
    app: &AppHandle,
    operation_id: &str,
    phase: NotionCoverBackfillPhase,
    total: usize,
    message: &str,
) {
    emit_progress(
        app,
        NotionCoverBackfillProgress {
            operation_id: operation_id.to_string(),
            phase,
            total,
            completed: 0,
            updated: 0,
            partial: 0,
            preserved: 0,
            skipped: 0,
            failed: 0,
            canceled: 0,
            current_page_id: None,
            current_title: None,
            message: message.to_string(),
        },
    );
}

fn emit_progress(app: &AppHandle, progress: NotionCoverBackfillProgress) {
    let _ = app.emit(NOTION_COVER_BACKFILL_PROGRESS_EVENT, progress);
}

struct BackfillOperationGuard;

impl Drop for BackfillOperationGuard {
    fn drop(&mut self) {
        BACKFILL_CANCEL_REQUESTED.store(false, Ordering::Release);
        BACKFILL_ACTIVE.store(false, Ordering::Release);
        if let Ok(mut active) = ACTIVE_OPERATION_ID.lock() {
            *active = None;
        }
    }
}

fn try_begin_backfill(operation_id: &str) -> Result<BackfillOperationGuard, AppError> {
    BACKFILL_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| {
            AppError::InvalidPayload("已有封面回填任务正在执行，请勿重复启动。".to_string())
        })?;
    let mut active = ACTIVE_OPERATION_ID.lock().map_err(|_| {
        BACKFILL_ACTIVE.store(false, Ordering::Release);
        AppError::Storage("封面回填任务状态锁已损坏。".to_string())
    })?;
    *active = Some(operation_id.to_string());
    Ok(BackfillOperationGuard)
}

fn ensure_no_active_backfill() -> Result<(), AppError> {
    if BACKFILL_ACTIVE.load(Ordering::Acquire) {
        return Err(AppError::InvalidPayload(
            "封面回填正在执行，请等待完成或先取消任务。".to_string(),
        ));
    }
    Ok(())
}

fn normalize_notion_id(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_hexdigit)
        .flat_map(char::to_lowercase)
        .collect()
}

fn next_preflight_id() -> String {
    format!(
        "cover-preflight-{}-{}",
        current_unix_millis(),
        BACKFILL_OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn next_operation_id() -> String {
    format!(
        "cover-backfill-{}-{}",
        current_unix_millis(),
        BACKFILL_OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn property(id: &str, name: &str, property_type: &str) -> NotionPropertySummary {
        NotionPropertySummary {
            id: id.to_string(),
            name: name.to_string(),
            property_type: property_type.to_string(),
        }
    }

    fn analysis(properties: Vec<NotionPropertySummary>) -> NotionDatabaseAnalysis {
        NotionDatabaseAnalysis {
            compatibility: "full".to_string(),
            database_id: "database-id".to_string(),
            database_name: Some("阅读成果库".to_string()),
            database_url: None,
            title_property: None,
            properties,
            suggested_mappings: Vec::new(),
            issues: Vec::new(),
            schema_checked_at: "2026-08-03T00:00:00Z".to_string(),
            schema_fingerprint: Some("fingerprint".to_string()),
        }
    }

    fn connection(mappings: Vec<NotionPropertyMappingConfig>) -> NotionDatabaseConnectionConfig {
        NotionDatabaseConnectionConfig {
            database_id: "database-id".to_string(),
            database_name: Some("阅读成果库".to_string()),
            database_url: None,
            title_property_id: "title-id".to_string(),
            title_property_name_snapshot: "名称".to_string(),
            mappings,
            schema_checked_at: "2026-08-03T00:00:00Z".to_string(),
            schema_fingerprint: Some("fingerprint".to_string()),
        }
    }

    fn preflight(
        database_id: &str,
        schema_fingerprint: &str,
        cover_action: NotionCoverPropertyAction,
    ) -> NotionCoverBackfillPreflight {
        NotionCoverBackfillPreflight {
            preflight_id: "new".to_string(),
            database_id: database_id.to_string(),
            database_name: None,
            schema_fingerprint: schema_fingerprint.to_string(),
            connection_schema_changed: false,
            cover_property: NotionCoverPropertyPlan {
                action: cover_action,
                property_id: Some("cover".to_string()),
                property_name: Some("封面".to_string()),
                property_type: Some("files".to_string()),
                message: String::new(),
            },
            book_id_property_id: Some("book-id".to_string()),
            book_id_property_name: Some("Book ID".to_string()),
            total_pages: 0,
            pages_with_book_id: 0,
            pages_with_local_cover: 0,
            missing_local_cover: 0,
            missing_cover_property: 0,
            missing_page_cover: 0,
            preserved_cover_property: 0,
            preserved_page_cover: 0,
            eligible_pages: 0,
            can_run: true,
            blockers: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn item(status: NotionCoverBackfillItemStatus) -> NotionCoverBackfillItemResult {
        item_result(
            "page-id",
            "测试页面",
            Some("book-id".to_string()),
            status,
            status == NotionCoverBackfillItemStatus::Updated,
            status == NotionCoverBackfillItemStatus::Updated,
            "测试结果".to_string(),
        )
    }

    #[test]
    fn cover_property_reuses_unique_files_field() {
        let plan = resolve_cover_property(&analysis(vec![property("cover-id", "封面", "files")]));
        assert_eq!(plan.action, NotionCoverPropertyAction::Reuse);
        assert_eq!(plan.property_id.as_deref(), Some("cover-id"));
    }

    #[test]
    fn cover_property_fails_closed_on_wrong_type() {
        let plan =
            resolve_cover_property(&analysis(vec![property("cover-id", "封面", "rich_text")]));
        assert_eq!(plan.action, NotionCoverPropertyAction::Conflict);
    }

    #[test]
    fn cover_property_fails_closed_on_multiple_candidates() {
        let plan = resolve_cover_property(&analysis(vec![
            property("cover-cn", "封面", "files"),
            property("cover-en", "Cover", "files"),
        ]));
        assert_eq!(plan.action, NotionCoverPropertyAction::Conflict);
        assert!(plan.message.contains("多个封面候选字段"));
    }

    #[test]
    fn book_id_prefers_valid_saved_mapping() {
        let mapping = NotionPropertyMappingConfig {
            logical_field: "bookId".to_string(),
            property_id: "custom-book-id".to_string(),
            property_name_snapshot: "自定义书号".to_string(),
            property_type: "rich_text".to_string(),
            enabled: true,
        };
        let database = analysis(vec![
            property("custom-book-id", "已重命名书号", "rich_text"),
            property("fallback-book-id", "Book ID", "rich_text"),
        ]);

        let resolved = resolve_book_id_property(&connection(vec![mapping]), &database).unwrap();
        assert_eq!(resolved.id, "custom-book-id");
        assert_eq!(resolved.name, "已重命名书号");
    }

    #[test]
    fn book_id_fails_closed_on_multiple_fallback_candidates() {
        let database = analysis(vec![
            property("book-id-en", "Book ID", "rich_text"),
            property("book-id-cn", "书籍 ID", "rich_text"),
        ]);

        let error = resolve_book_id_property(&connection(Vec::new()), &database).unwrap_err();
        assert!(error.contains("多个 Book ID 候选字段"));
    }

    #[test]
    fn book_id_fails_closed_when_candidate_is_missing() {
        let database = analysis(vec![property("title", "名称", "title")]);

        let error = resolve_book_id_property(&connection(Vec::new()), &database).unwrap_err();
        assert!(error.contains("缺少唯一的 Book ID rich_text 字段"));
    }

    #[test]
    fn local_cover_prefers_notebook_cache_and_rejects_local_paths() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE notebook_books (book_id TEXT PRIMARY KEY, cover TEXT);\
                 CREATE TABLE book_details (book_id TEXT PRIMARY KEY, cover TEXT);\
                 CREATE TABLE shelf_entries (id TEXT PRIMARY KEY, cover TEXT);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO notebook_books (book_id, cover) VALUES (?1, ?2)",
                ["book-1", "C:/covers/local.png"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO book_details (book_id, cover) VALUES (?1, ?2)",
                ["book-1", "https://example.com/detail.png"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shelf_entries (id, cover) VALUES (?1, ?2)",
                ["book-1", "https://example.com/shelf.png"],
            )
            .unwrap();

        assert_eq!(
            local_cover_url(&connection, "book-1").unwrap().as_deref(),
            Some("https://example.com/detail.png")
        );
    }

    #[test]
    fn snapshot_validation_rejects_schema_drift() {
        let request = RunNotionCoverBackfillRequest {
            preflight_id: "preflight".to_string(),
            database_id: "database-id".to_string(),
            schema_fingerprint: "old".to_string(),
            cover_property_action: NotionCoverPropertyAction::Reuse,
            confirm: true,
        };
        let current = preflight("database-id", "new", NotionCoverPropertyAction::Reuse);
        assert!(validate_preflight_snapshot(&request, &current).is_err());
    }

    #[test]
    fn snapshot_validation_accepts_hyphenated_database_id_equivalence() {
        let request = RunNotionCoverBackfillRequest {
            preflight_id: "preflight".to_string(),
            database_id: "0123456789ABCDEF0123456789ABCDEF".to_string(),
            schema_fingerprint: "same".to_string(),
            cover_property_action: NotionCoverPropertyAction::Reuse,
            confirm: true,
        };
        let current = preflight(
            "01234567-89ab-cdef-0123-456789abcdef",
            "same",
            NotionCoverPropertyAction::Reuse,
        );

        assert!(validate_preflight_snapshot(&request, &current).is_ok());
    }

    #[test]
    fn run_request_requires_explicit_confirmation_and_safe_fields() {
        let mut request = RunNotionCoverBackfillRequest {
            preflight_id: "preflight".to_string(),
            database_id: "database-id".to_string(),
            schema_fingerprint: "fingerprint".to_string(),
            cover_property_action: NotionCoverPropertyAction::Reuse,
            confirm: false,
        };
        assert!(validate_run_request(&request).is_err());

        request.confirm = true;
        request.schema_fingerprint.clear();
        assert!(validate_run_request(&request).is_err());

        request.schema_fingerprint = "fingerprint".to_string();
        request.cover_property_action = NotionCoverPropertyAction::Conflict;
        assert!(validate_run_request(&request).is_err());
    }

    #[test]
    fn progress_tracker_aggregates_each_item_status() {
        let mut tracker = ProgressTracker::new("operation".to_string(), 5);
        for status in [
            NotionCoverBackfillItemStatus::Updated,
            NotionCoverBackfillItemStatus::Partial,
            NotionCoverBackfillItemStatus::Preserved,
            NotionCoverBackfillItemStatus::Skipped,
            NotionCoverBackfillItemStatus::Failed,
        ] {
            tracker.record(&item(status));
        }

        assert_eq!(tracker.completed, 5);
        assert_eq!(tracker.updated, 1);
        assert_eq!(tracker.partial, 1);
        assert_eq!(tracker.preserved, 1);
        assert_eq!(tracker.skipped, 1);
        assert_eq!(tracker.failed, 1);
        assert_eq!(tracker.canceled, 0);
    }

    #[test]
    fn progress_tracker_cancel_remaining_is_idempotent() {
        let mut tracker = ProgressTracker::new("operation".to_string(), 5);
        tracker.record(&item(NotionCoverBackfillItemStatus::Updated));
        tracker.record(&item(NotionCoverBackfillItemStatus::Skipped));

        tracker.cancel_remaining();
        tracker.cancel_remaining();

        assert_eq!(tracker.completed, 2);
        assert_eq!(tracker.canceled, 3);
        assert_eq!(tracker.completed + tracker.canceled, tracker.total);
    }
}
