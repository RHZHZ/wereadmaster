use std::{fmt, time::Duration};

use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::{document::ExportDocument, targets::NotionParentType};

const NOTION_API_BASE: &str = "https://api.notion.com/v1";
pub(crate) const NOTION_LEGACY_API_VERSION: &str = "2022-06-28";
pub(crate) const NOTION_VIEWS_API_VERSION: &str = "2026-03-11";
const MAX_BLOCK_TEXT_LENGTH: usize = 1_900;
const MAX_BLOCKS_PER_REQUEST: usize = 100;
const MAX_RICH_TEXT_ITEMS_PER_BLOCK: usize = 100;
const NOTION_REQUEST_TIMEOUT_SECONDS: u64 = 30;
const NOTION_CONNECT_TIMEOUT_SECONDS: u64 = 15;
const NOTION_RATE_LIMIT_MAX_RETRIES: u32 = 3;
const NOTION_RATE_LIMIT_MAX_DELAY_SECONDS: u64 = 15;
const WORKSPACE_PAGE_TITLE: &str = "微信读书知识库";
const READING_DATABASE_TITLE: &str = "阅读成果库";
const WORKSPACE_PAGE_COVER_URL: &str =
    "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1600&q=80";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NotionRequestError {
    message: String,
    result_unknown: bool,
}

impl NotionRequestError {
    pub(crate) fn result_unknown(&self) -> bool {
        self.result_unknown
    }
}

impl fmt::Display for NotionRequestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for NotionRequestError {}

#[derive(Debug, Clone)]
pub struct NotionExportOptions {
    pub token: String,
    pub parent_id: String,
    pub parent_type: NotionParentType,
    pub use_page_cover: bool,
    pub property_mappings: Vec<NotionPropertyMapping>,
}

#[derive(Debug, Clone)]
pub struct NotionExportOutput {
    pub page_id: String,
    pub url: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NotionReadingLibraryTemplateOutput {
    pub database_id: String,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionDatabaseCreateError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub result_unknown: bool,
}

impl fmt::Display for NotionDatabaseCreateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for NotionDatabaseCreateError {}

#[derive(Debug, Clone)]
pub struct NotionReadingWorkspaceTemplateOutput {
    pub home_page_id: String,
    pub home_page_url: String,
    pub database_id: String,
    pub database_url: String,
    pub title: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionPropertySummary {
    pub id: String,
    pub name: String,
    pub property_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionPropertyMapping {
    pub logical_field: String,
    pub property_id: String,
    pub property_name_snapshot: String,
    pub property_type: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionDatabaseIssue {
    pub code: String,
    pub message: String,
    pub logical_field: Option<String>,
    pub property_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionDatabaseAnalysis {
    pub compatibility: String,
    pub database_id: String,
    pub database_name: Option<String>,
    pub database_url: Option<String>,
    pub title_property: Option<NotionPropertySummary>,
    pub properties: Vec<NotionPropertySummary>,
    pub suggested_mappings: Vec<NotionPropertyMapping>,
    pub issues: Vec<NotionDatabaseIssue>,
    pub schema_checked_at: String,
    pub schema_fingerprint: Option<String>,
}

pub async fn export_document(
    document: &ExportDocument,
    markdown: &str,
    options: &NotionExportOptions,
    prebuilt_blocks: Option<&[Value]>,
) -> Result<NotionExportOutput, String> {
    let client = notion_client()?;
    let database_schema = match options.parent_type {
        NotionParentType::Page => None,
        NotionParentType::Database => Some(database_schema(&client, options).await?),
    };
    let title_property = database_schema.as_ref().and_then(|schema| {
        if options.property_mappings.is_empty() {
            schema.title_property.clone()
        } else {
            mapped_property_name(schema, &options.property_mappings, "title")
        }
    });
    if options.parent_type == NotionParentType::Database && title_property.is_none() {
        return Err(if options.property_mappings.is_empty() {
            "目标 Notion 数据库缺少标题属性。".to_string()
        } else {
            "已保存的 Notion 标题字段已删除或类型发生变化，请重新检查数据库并保存字段映射。"
                .to_string()
        });
    }
    let blocks = match prebuilt_blocks {
        Some(prebuilt) => {
            let mut blocks = Vec::with_capacity(prebuilt.len() + 1);
            if !options.use_page_cover {
                if let Some(url) = document
                    .cover
                    .as_ref()
                    .and_then(|asset| asset.remote_url.as_deref())
                {
                    push_image_block(&mut blocks, "封面", url);
                }
            }
            blocks.extend_from_slice(prebuilt);
            blocks
        }
        None => markdown_to_blocks(markdown),
    };
    let first_blocks = blocks
        .iter()
        .take(MAX_BLOCKS_PER_REQUEST)
        .cloned()
        .collect::<Vec<_>>();
    let mapping_warning = database_schema
        .as_ref()
        .and_then(|schema| property_mapping_warning(schema, &options.property_mappings));
    let mut payload = create_page_payload(
        document,
        options,
        title_property.as_deref(),
        database_schema.as_ref(),
    );
    if !first_blocks.is_empty() {
        payload["children"] = Value::Array(first_blocks);
    }

    let page = create_page(&client, options, &payload).await?;
    let page_id = page
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion 创建页面成功，但响应缺少页面 ID。".to_string())?
        .to_string();
    let url = page
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://www.notion.so/{}", page_id.replace('-', "")));

    let total_blocks = blocks.len();
    let mut appended_blocks = MAX_BLOCKS_PER_REQUEST.min(total_blocks);
    let mut warning = mapping_warning;
    if let Some(cover_url) = document_cover_url(document) {
        if let Some(cover_property) = database_schema.as_ref().and_then(|schema| {
            if options.property_mappings.is_empty() {
                property_type_matches(schema, "封面", "files").then(|| "封面".to_string())
            } else {
                mapped_property_name(schema, &options.property_mappings, "cover")
            }
        }) {
            if let Err(error) =
                update_page_files_property(&client, options, &page_id, &cover_property, cover_url)
                    .await
            {
                warning = merge_warning(
                    warning,
                    Some(format!(
                        "Notion 封面属性写入失败，正文与页面已保留：{error}"
                    )),
                );
            }
        }
        if options.use_page_cover {
            if let Err(error) = update_page_cover(&client, options, &page_id, cover_url).await {
                warning = merge_warning(
                    warning,
                    Some(format!(
                        "Notion 页面封面写入失败，正文与封面属性已保留：{error}"
                    )),
                );
            }
        }
    }
    for chunk in blocks[appended_blocks..].chunks(MAX_BLOCKS_PER_REQUEST) {
        let result = send_notion_request(
            notion_request(
                &client,
                options,
                reqwest::Method::PATCH,
                &format!("/blocks/{page_id}/children"),
            )
            .json(&json!({ "children": chunk })),
        )
        .await;
        match result {
            Ok(_) => appended_blocks += chunk.len(),
            Err(error) => {
                let addition = format!(
                    "正文只写入前 {appended_blocks}/{total_blocks} 个块，剩余内容追加失败：{error}。页面已创建，可从链接查看后重试。"
                );
                warning = merge_warning(warning, Some(addition));
                break;
            }
        }
    }

    Ok(NotionExportOutput {
        page_id,
        url,
        warning,
    })
}

pub async fn analyze_database(
    token: &str,
    database_id: &str,
) -> Result<NotionDatabaseAnalysis, String> {
    let options = NotionExportOptions {
        token: token.to_string(),
        parent_id: database_id.to_string(),
        parent_type: NotionParentType::Database,
        use_page_cover: false,
        property_mappings: Vec::new(),
    };
    let client = notion_client()?;
    let database = retrieve_database(&client, &options).await?;
    Ok(analyze_database_value(database_id, &database))
}

pub async fn create_reading_library_template(
    token: &str,
    parent_page_id: &str,
) -> Result<NotionReadingLibraryTemplateOutput, String> {
    create_reading_library_template_typed(token, parent_page_id)
        .await
        .map_err(|error| error.message)
}

pub async fn create_reading_library_template_typed(
    token: &str,
    parent_page_id: &str,
) -> Result<NotionReadingLibraryTemplateOutput, NotionDatabaseCreateError> {
    let options = NotionExportOptions {
        token: token.to_string(),
        parent_id: parent_page_id.to_string(),
        parent_type: NotionParentType::Page,
        use_page_cover: false,
        property_mappings: Vec::new(),
    };
    let client = notion_client().map_err(|message| NotionDatabaseCreateError {
        code: "notion_client_initialization_failed".to_string(),
        message,
        retryable: true,
        result_unknown: false,
    })?;
    let database = create_reading_database_typed(&client, &options, READING_DATABASE_TITLE).await?;
    let (database_id, url) =
        notion_object_id_and_url(&database, "Notion 数据库创建成功，但响应缺少数据库 ID。")
            .map_err(|message| NotionDatabaseCreateError {
                code: "notion_database_create_response_invalid".to_string(),
                message,
                retryable: false,
                result_unknown: true,
            })?;

    Ok(NotionReadingLibraryTemplateOutput {
        database_id,
        url,
        title: READING_DATABASE_TITLE.to_string(),
    })
}

pub async fn create_reading_workspace_template(
    token: &str,
    parent_page_id: &str,
) -> Result<NotionReadingWorkspaceTemplateOutput, String> {
    let options = NotionExportOptions {
        token: token.to_string(),
        parent_id: parent_page_id.to_string(),
        parent_type: NotionParentType::Page,
        use_page_cover: false,
        property_mappings: Vec::new(),
    };
    let client = notion_client()?;
    let mut home_payload = workspace_homepage_payload(parent_page_id, true);
    let (home_page, warning) = match create_page(&client, &options, &home_payload).await {
        Ok(page) => (page, None),
        Err(cover_error) if is_cover_related_error(&cover_error) => {
            home_payload
                .as_object_mut()
                .map(|value| value.remove("cover"));
            let page = create_page(&client, &options, &home_payload).await?;
            (
                page,
                Some(format!(
                    "Notion 首页封面写入失败，已创建无封面工作台：{cover_error}"
                )),
            )
        }
        Err(error) => return Err(error),
    };
    let (home_page_id, home_page_url) =
        notion_object_id_and_url(&home_page, "Notion 工作台首页创建成功，但响应缺少页面 ID。")?;

    let database_options = NotionExportOptions {
        token: token.to_string(),
        parent_id: home_page_id.clone(),
        parent_type: NotionParentType::Page,
        use_page_cover: false,
        property_mappings: Vec::new(),
    };
    let database =
        create_reading_database(&client, &database_options, READING_DATABASE_TITLE).await?;
    let (database_id, database_url) = notion_object_id_and_url(
        &database,
        "Notion 阅读成果库创建成功，但响应缺少数据库 ID。",
    )?;
    let warning = match append_workspace_database_blocks(
        &client,
        &database_options,
        &home_page_id,
        &database_url,
    )
    .await
    {
        Ok(()) => warning,
        Err(append_error) => Some(match warning {
            Some(existing) => format!("{existing}；首页数据库链接追加失败：{append_error}"),
            None => format!("首页数据库链接追加失败，但阅读成果库已创建：{append_error}"),
        }),
    };

    Ok(NotionReadingWorkspaceTemplateOutput {
        home_page_id,
        home_page_url,
        database_id,
        database_url,
        title: WORKSPACE_PAGE_TITLE.to_string(),
        warning,
    })
}

async fn create_page(
    client: &Client,
    options: &NotionExportOptions,
    payload: &Value,
) -> Result<Value, String> {
    send_notion_request(
        notion_request(client, options, reqwest::Method::POST, "/pages").json(payload),
    )
    .await
}

pub(crate) async fn retrieve_page(
    client: &Client,
    options: &NotionExportOptions,
    page_id: &str,
) -> Result<Value, String> {
    send_notion_request(notion_request(
        client,
        options,
        reqwest::Method::GET,
        &format!("/pages/{page_id}"),
    ))
    .await
}

pub(crate) async fn update_page_files_property(
    client: &Client,
    options: &NotionExportOptions,
    page_id: &str,
    property_name: &str,
    url: &str,
) -> Result<Value, String> {
    let file = external_file_value("封面", url)
        .ok_or_else(|| "封面 URL 不是有效的 HTTP(S) 地址。".to_string())?;
    let result = send_notion_request(
        notion_request(
            client,
            options,
            reqwest::Method::PATCH,
            &format!("/pages/{page_id}"),
        )
        .json(&json!({
            "properties": {
                property_name: { "files": [file] }
            }
        })),
    )
    .await;
    reconcile_page_mutation(
        client,
        options,
        page_id,
        result,
        |page| page_files_property_contains_url(page, property_name, url),
        "封面属性",
    )
    .await
}

pub(crate) async fn update_page_cover(
    client: &Client,
    options: &NotionExportOptions,
    page_id: &str,
    url: &str,
) -> Result<Value, String> {
    let cover = external_cover_value(url)
        .ok_or_else(|| "封面 URL 不是有效的 HTTP(S) 地址。".to_string())?;
    let result = send_notion_request(
        notion_request(
            client,
            options,
            reqwest::Method::PATCH,
            &format!("/pages/{page_id}"),
        )
        .json(&json!({ "cover": cover })),
    )
    .await;
    reconcile_page_mutation(
        client,
        options,
        page_id,
        result,
        |page| page_cover_contains_url(page, url),
        "页面封面",
    )
    .await
}

async fn reconcile_page_mutation(
    client: &Client,
    options: &NotionExportOptions,
    page_id: &str,
    result: Result<Value, String>,
    applied: impl Fn(&Value) -> bool,
    target: &str,
) -> Result<Value, String> {
    match result {
        Ok(page) => Ok(page),
        Err(error) => match retrieve_page(client, options, page_id).await {
            Ok(page) if applied(&page) => Ok(page),
            Ok(_) => Err(error),
            Err(reconcile_error) => Err(format!(
                "{error}；无法重新读取页面确认{target}是否已生效：{reconcile_error}"
            )),
        },
    }
}

pub(crate) async fn query_database_pages(
    client: &Client,
    options: &NotionExportOptions,
) -> Result<Vec<Value>, String> {
    let mut pages = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut payload = json!({ "page_size": 100 });
        if let Some(value) = cursor.as_deref() {
            payload["start_cursor"] = Value::String(value.to_string());
        }
        let response = send_notion_request(
            notion_request(
                client,
                options,
                reqwest::Method::POST,
                &format!("/databases/{}/query", options.parent_id),
            )
            .json(&payload),
        )
        .await?;
        let results = response
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(|| "Notion 数据库查询响应缺少 results。".to_string())?;
        pages.extend(results.iter().cloned());
        let has_more = response
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !has_more {
            break;
        }
        cursor = response
            .get("next_cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if cursor.is_none() {
            return Err("Notion 数据库查询响应标记了更多结果，但缺少 next_cursor。".to_string());
        }
    }
    Ok(pages)
}

pub(crate) async fn add_database_files_property(
    client: &Client,
    options: &NotionExportOptions,
    property_name: &str,
) -> Result<Value, String> {
    let result = send_notion_request(
        notion_request(
            client,
            options,
            reqwest::Method::PATCH,
            &format!("/databases/{}", options.parent_id),
        )
        .json(&json!({
            "properties": {
                property_name: { "files": {} }
            }
        })),
    )
    .await;
    match result {
        Ok(database) => Ok(database),
        Err(error) => match retrieve_database(client, options).await {
            Ok(database) if database_property_type(&database, property_name) == Some("files") => {
                Ok(database)
            }
            Ok(_) => Err(error),
            Err(reconcile_error) => Err(format!(
                "{error}；无法重新读取数据库确认封面属性是否已创建：{reconcile_error}"
            )),
        },
    }
}

pub(crate) fn database_property_type<'a>(
    database: &'a Value,
    property_name: &str,
) -> Option<&'a str> {
    database
        .get("properties")?
        .get(property_name)?
        .get("type")?
        .as_str()
}

pub(crate) fn page_property_plain_text(page: &Value, property_name: &str) -> Option<String> {
    let property = page.get("properties")?.get(property_name)?;
    let items = property
        .get("rich_text")
        .or_else(|| property.get("title"))?
        .as_array()?;
    let value = items
        .iter()
        .filter_map(|item| item.get("plain_text").and_then(Value::as_str))
        .collect::<String>();
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

pub(crate) fn page_title(page: &Value) -> Option<String> {
    page.get("properties")?
        .as_object()?
        .values()
        .find(|property| property.get("type").and_then(Value::as_str) == Some("title"))
        .and_then(|property| {
            let value = property
                .get("title")?
                .as_array()?
                .iter()
                .filter_map(|item| item.get("plain_text").and_then(Value::as_str))
                .collect::<String>();
            (!value.trim().is_empty()).then(|| value.trim().to_string())
        })
}

pub(crate) fn page_files_property_is_empty(page: &Value, property_name: &str) -> bool {
    page.get("properties")
        .and_then(|properties| properties.get(property_name))
        .and_then(|property| property.get("files"))
        .and_then(Value::as_array)
        .map(Vec::is_empty)
        .unwrap_or(true)
}

pub(crate) fn page_cover_is_empty(page: &Value) -> bool {
    page.get("cover").map(Value::is_null).unwrap_or(true)
}

fn page_files_property_contains_url(page: &Value, property_name: &str, expected: &str) -> bool {
    page.get("properties")
        .and_then(|properties| properties.get(property_name))
        .and_then(|property| property.get("files"))
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .any(|file| notion_file_url(file) == Some(expected))
        })
        .unwrap_or(false)
}

fn page_cover_contains_url(page: &Value, expected: &str) -> bool {
    page.get("cover").and_then(notion_file_url) == Some(expected)
}

fn notion_file_url(value: &Value) -> Option<&str> {
    value
        .get("external")
        .and_then(|external| external.get("url"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("file")
                .and_then(|file| file.get("url"))
                .and_then(Value::as_str)
        })
}

pub(crate) async fn create_reading_database(
    client: &Client,
    options: &NotionExportOptions,
    title: &str,
) -> Result<Value, String> {
    create_reading_database_typed(client, options, title)
        .await
        .map_err(|error| error.message)
}

pub(crate) async fn create_reading_database_typed(
    client: &Client,
    options: &NotionExportOptions,
    title: &str,
) -> Result<Value, NotionDatabaseCreateError> {
    let payload = reading_database_payload(&options.parent_id, title);
    send_notion_database_create_request(
        notion_request(client, options, reqwest::Method::POST, "/databases").json(&payload),
    )
    .await
}

async fn append_workspace_database_blocks(
    client: &Client,
    options: &NotionExportOptions,
    page_id: &str,
    database_url: &str,
) -> Result<(), String> {
    send_notion_request(
        notion_request(
            client,
            options,
            reqwest::Method::PATCH,
            &format!("/blocks/{page_id}/children"),
        )
        .json(&json!({ "children": workspace_database_followup_blocks(database_url) })),
    )
    .await?;
    Ok(())
}

fn notion_object_id_and_url(
    value: &Value,
    missing_id_message: &str,
) -> Result<(String, String), String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| missing_id_message.to_string())?
        .to_string();
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://www.notion.so/{}", id.replace('-', "")));
    Ok((id, url))
}

fn reading_database_payload(parent_page_id: &str, title: &str) -> Value {
    json!({
        "parent": { "type": "page_id", "page_id": parent_page_id },
        "title": rich_text(title),
        "properties": reading_library_template_properties()
    })
}

fn workspace_homepage_payload(parent_page_id: &str, include_cover: bool) -> Value {
    let mut payload = json!({
        "parent": { "type": "page_id", "page_id": parent_page_id },
        "icon": { "type": "emoji", "emoji": "📚" },
        "properties": { "title": rich_text(WORKSPACE_PAGE_TITLE) },
        "children": workspace_homepage_initial_blocks()
    });
    if include_cover {
        payload["cover"] = json!({
            "type": "external",
            "external": { "url": WORKSPACE_PAGE_COVER_URL }
        });
    }
    payload
}

fn workspace_homepage_initial_blocks() -> Vec<Value> {
    vec![
        callout_block_with_color(
            "阅读资产工作台：把微信读书里的划线、想法、AI 复盘、阅读路线和选书决策，沉淀成一个可整理、可检索、可行动的长期知识库。",
            "🧭",
            "blue_background",
        ),
        quote_block("边界说明：这里是一键导出/导入工作台，不是双向同步。每次导出都会创建新的成果页，方便保留版本历史。"),
        heading_block("heading_2", "今日驾驶舱"),
        callout_block_with_color(
            "最近导入：打开阅读成果库后，按导出时间倒序查看最新成果。",
            "🕘",
            "gray_background",
        ),
        callout_block_with_color(
            "待读整理：把导入状态改为待整理，形成 Notion 内部整理队列。",
            "🧺",
            "yellow_background",
        ),
        callout_block_with_color(
            "行动优先：筛选行动数大于 0 的复盘、阅读路线和选书决策。",
            "🎯",
            "green_background",
        ),
        divider_block(),
        heading_block("heading_2", "成果入口"),
        callout_block_with_color(
            "书籍笔记：保存原始划线、想法、章节分组和封面，是所有复盘的证据层。",
            "📒",
            "green_background",
        ),
        callout_block_with_color(
            "书籍复盘：沉淀概览、主题标签、关键观点、行动项和复盘问题。",
            "🧠",
            "blue_background",
        ),
        callout_block_with_color(
            "阅读路线：记录当前书、候选书、推进顺序、检查点和下一步行动。",
            "🗺️",
            "orange_background",
        ),
        callout_block_with_color(
            "统计复盘：按周、月、年或总览回看阅读节奏、偏好和阶段变化。",
            "📈",
            "yellow_background",
        ),
        callout_block_with_color(
            "选书决策：保留下一本书的选择依据、取舍、预计投入和触发条件。",
            "🧩",
            "purple_background",
        ),
        divider_block(),
        heading_block("heading_2", "一键导出流程"),
        numbered_list_block("在 wxreadmaster 中生成或打开一份阅读成果。"),
        numbered_list_block("选择导出到 Notion，或选择 Obsidian + Notion 双目标。"),
        numbered_list_block("导出成功后回到阅读成果库，补充导入状态、标签和整理结论。"),
        callout_block_with_color(
            "双目标模式会先写入 Obsidian Vault，再把本地文件路径写入 Notion 的 Obsidian 路径字段，方便从线上页面反查本地笔记。",
            "🔗",
            "gray_background",
        ),
    ]
}

fn workspace_database_followup_blocks(database_url: &str) -> Vec<Value> {
    vec![
        divider_block(),
        heading_block("heading_2", "核心数据库"),
        callout_block_with_color(
            "阅读成果库是这个工作台的唯一核心表。每一次导出是一条成果记录，正文保留完整内容，属性用于筛选、排序和整理。",
            "🗃️",
            "blue_background",
        ),
        bookmark_block(database_url, "打开阅读成果库"),
        paragraph_link_block("也可以从这里打开阅读成果库", database_url),
        heading_block("heading_2", "推荐视图配方"),
        toggle_block(
            "全部成果",
            vec![
                bulleted_list_block("过滤：无。"),
                bulleted_list_block("排序：导出时间倒序。"),
                bulleted_list_block("用途：作为最近导入和全局检索入口。"),
            ],
        ),
        toggle_block(
            "书籍笔记 / 书籍复盘 / 阅读路线 / 统计复盘 / 选书决策",
            vec![
                bulleted_list_block("过滤：资产类型分别等于对应成果类型。"),
                bulleted_list_block("排序：导出时间倒序，或按导入状态分组。"),
                bulleted_list_block("用途：让不同阅读成果拥有独立入口，但仍共用一个数据库。"),
            ],
        ),
        toggle_block(
            "待读整理",
            vec![
                bulleted_list_block("过滤：导入状态等于待整理。"),
                bulleted_list_block("排序：行动数倒序，再按导出时间倒序。"),
                bulleted_list_block("用途：把导入后的二次加工变成一个稳定队列。"),
            ],
        ),
        heading_block("heading_2", "整理工作流"),
        to_do_block("导出后先检查标题、资产类型、导出时间和导入状态。"),
        to_do_block("优先处理行动数大于 0 的书籍复盘、阅读路线和选书决策。"),
        to_do_block("整理完成后把导入状态改为已复盘或已归档。"),
        heading_block("heading_2", "字段速览"),
        callout_block_with_color(
            "核心字段：名称、作者、资产类型、导出时间、导入状态、标签、微信读书、Obsidian 路径、Prompt 版本、输入哈希。",
            "🏷️",
            "gray_background",
        ),
        callout_block_with_color(
            "建议保留字段名不变。wxreadmaster 会只写入存在且类型匹配的属性；如果你删掉某个字段，正文导入仍会继续。",
            "🛡️",
            "yellow_background",
        ),
    ]
}

fn heading_block(kind: &str, text: &str) -> Value {
    json!({
        "object": "block",
        "type": kind,
        kind: { "rich_text": rich_text(text) }
    })
}

fn paragraph_link_block(text: &str, url: &str) -> Value {
    json!({
        "object": "block",
        "type": "paragraph",
        "paragraph": { "rich_text": rich_text_link(text, url) }
    })
}

fn bulleted_list_block(text: &str) -> Value {
    json!({
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": { "rich_text": rich_text(text) }
    })
}

fn numbered_list_block(text: &str) -> Value {
    json!({
        "object": "block",
        "type": "numbered_list_item",
        "numbered_list_item": { "rich_text": rich_text(text) }
    })
}

fn callout_block_with_color(text: &str, emoji: &str, color: &str) -> Value {
    json!({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": rich_text(text),
            "icon": { "type": "emoji", "emoji": emoji },
            "color": color
        }
    })
}

fn quote_block(text: &str) -> Value {
    json!({
        "object": "block",
        "type": "quote",
        "quote": { "rich_text": rich_text(text) }
    })
}

fn bookmark_block(url: &str, caption: &str) -> Value {
    json!({
        "object": "block",
        "type": "bookmark",
        "bookmark": {
            "url": url,
            "caption": rich_text(caption)
        }
    })
}

fn toggle_block(text: &str, children: Vec<Value>) -> Value {
    json!({
        "object": "block",
        "type": "toggle",
        "toggle": {
            "rich_text": rich_text(text),
            "color": "gray_background",
            "children": children
        }
    })
}

fn to_do_block(text: &str) -> Value {
    json!({
        "object": "block",
        "type": "to_do",
        "to_do": {
            "rich_text": rich_text(text),
            "checked": false
        }
    })
}

fn divider_block() -> Value {
    json!({
        "object": "block",
        "type": "divider",
        "divider": {}
    })
}

#[derive(Debug, Clone)]
struct NotionDatabaseSchema {
    title_property: Option<String>,
    properties: Map<String, Value>,
}

pub(crate) async fn retrieve_database(
    client: &Client,
    options: &NotionExportOptions,
) -> Result<Value, String> {
    send_notion_request(notion_request(
        client,
        options,
        reqwest::Method::GET,
        &format!("/databases/{}", options.parent_id),
    ))
    .await
}

async fn database_schema(
    client: &Client,
    options: &NotionExportOptions,
) -> Result<NotionDatabaseSchema, String> {
    let database = retrieve_database(client, options).await?;
    let properties = database
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let title_property = properties.iter().find_map(|(name, value)| {
        (value.get("type").and_then(Value::as_str) == Some("title")).then(|| name.clone())
    });

    Ok(NotionDatabaseSchema {
        title_property,
        properties,
    })
}

fn analyze_database_value(database_id: &str, database: &Value) -> NotionDatabaseAnalysis {
    let properties = database
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut summaries = properties
        .iter()
        .filter_map(|(name, property)| {
            let id = property.get("id").and_then(Value::as_str)?;
            let property_type = property.get("type").and_then(Value::as_str)?;
            Some(NotionPropertySummary {
                id: id.to_string(),
                name: name.clone(),
                property_type: property_type.to_string(),
            })
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| left.name.cmp(&right.name));
    let title_property = summaries
        .iter()
        .find(|property| property.property_type == "title")
        .cloned();
    let suggested_mappings = suggested_property_mappings(&summaries);
    let recommended_count = suggested_mappings
        .iter()
        .filter(|mapping| mapping.logical_field != "title")
        .count();
    let mut issues = Vec::new();
    let compatibility = if title_property.is_none() {
        issues.push(NotionDatabaseIssue {
            code: "missing_title_property".to_string(),
            message: "数据库缺少 Title 属性，无法创建导出页面。".to_string(),
            logical_field: Some("title".to_string()),
            property_id: None,
        });
        "invalid"
    } else if recommended_count >= 4 {
        "full"
    } else {
        issues.push(NotionDatabaseIssue {
            code: "limited_metadata_fields".to_string(),
            message: "数据库可用于标题和正文导出，但可自动写入的推荐元数据字段较少。".to_string(),
            logical_field: None,
            property_id: None,
        });
        "basic"
    };
    let title = notion_database_title(database);
    let url = database
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string);
    let schema_fingerprint = schema_fingerprint(&summaries);

    NotionDatabaseAnalysis {
        compatibility: compatibility.to_string(),
        database_id: database
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(database_id)
            .to_string(),
        database_name: title,
        database_url: url,
        title_property,
        properties: summaries,
        suggested_mappings,
        issues,
        schema_checked_at: Utc::now().to_rfc3339(),
        schema_fingerprint: Some(schema_fingerprint),
    }
}

fn notion_database_title(database: &Value) -> Option<String> {
    let title = database.get("title")?.as_array()?;
    let value = title
        .iter()
        .filter_map(|item| item.get("plain_text").and_then(Value::as_str))
        .collect::<String>();
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

fn suggested_property_mappings(properties: &[NotionPropertySummary]) -> Vec<NotionPropertyMapping> {
    const FIELD_SPECS: &[(&str, &[&str], &[&str])] = &[
        ("title", &["名称", "标题", "Name", "Title"], &["title"]),
        ("author", &["作者", "Author"], &["rich_text"]),
        ("cover", &["封面", "Cover"], &["files"]),
        ("bookId", &["Book ID", "书籍 ID", "书籍ID"], &["rich_text"]),
        ("assetType", &["资产类型", "类型"], &["select", "status"]),
        (
            "source",
            &["来源", "Source"],
            &["select", "status", "rich_text"],
        ),
        ("exportedAt", &["导出时间", "Exported At"], &["date"]),
        ("importStatus", &["导入状态"], &["status", "select"]),
        ("readingStatus", &["阅读状态"], &["status", "select"]),
        ("readingStage", &["阅读阶段"], &["select", "status"]),
        ("progress", &["进度", "Progress"], &["number"]),
        ("tags", &["标签", "Tags"], &["multi_select"]),
        ("wereadUrl", &["微信读书", "微信读书链接"], &["url"]),
        ("obsidianPath", &["Obsidian 路径"], &["rich_text"]),
        ("promptVersion", &["Prompt 版本"], &["rich_text"]),
        ("inputHash", &["输入哈希"], &["rich_text"]),
        ("scopeId", &["Scope ID"], &["rich_text"]),
        ("period", &["周期"], &["select", "status"]),
        ("actionCount", &["行动数"], &["number"]),
        ("candidateCount", &["候选书数"], &["number"]),
        ("highlightCount", &["划线数"], &["number"]),
        ("thoughtCount", &["想法数"], &["number"]),
        ("bookmarkCount", &["书签数"], &["number"]),
        ("exportableCount", &["可导出数"], &["number"]),
    ];

    FIELD_SPECS
        .iter()
        .filter_map(|(logical_field, names, types)| {
            let property = properties.iter().find(|property| {
                types.contains(&property.property_type.as_str())
                    && (property.property_type == "title"
                        || names
                            .iter()
                            .any(|name| property.name.eq_ignore_ascii_case(name)))
            })?;
            Some(NotionPropertyMapping {
                logical_field: (*logical_field).to_string(),
                property_id: property.id.clone(),
                property_name_snapshot: property.name.clone(),
                property_type: property.property_type.clone(),
                enabled: true,
            })
        })
        .collect()
}

fn schema_fingerprint(properties: &[NotionPropertySummary]) -> String {
    let mut canonical_properties = properties
        .iter()
        .map(|property| format!("{}:{}", property.id, property.property_type))
        .collect::<Vec<_>>();
    canonical_properties.sort();
    let canonical = canonical_properties.join("|");
    let hash = canonical
        .bytes()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            hash.wrapping_mul(0x100000001b3) ^ u64::from(byte)
        });
    format!("{hash:016x}")
}

fn create_page_payload(
    document: &ExportDocument,
    options: &NotionExportOptions,
    title_property: Option<&str>,
    database_schema: Option<&NotionDatabaseSchema>,
) -> Value {
    let parent = match options.parent_type {
        NotionParentType::Page => json!({ "page_id": options.parent_id }),
        NotionParentType::Database => json!({ "database_id": options.parent_id }),
    };
    let properties = match title_property {
        Some(property) => {
            let mut values = Map::new();
            values.insert(
                property.to_string(),
                json!({ "title": rich_text(&document.title) }),
            );
            if let Some(schema) = database_schema {
                append_template_page_properties(
                    &mut values,
                    schema,
                    document,
                    &options.property_mappings,
                );
            }
            Value::Object(values)
        }
        None => json!({ "title": rich_text(&document.title) }),
    };
    json!({ "parent": parent, "properties": properties })
}

fn append_template_page_properties(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    document: &ExportDocument,
    mappings: &[NotionPropertyMapping],
) {
    let property_name = |logical_field: &str, fallback: &str| {
        if mappings.is_empty() {
            Some(fallback.to_string())
        } else {
            mapped_property_name(schema, mappings, logical_field)
        }
    };
    if let Some(name) = property_name("author", "作者") {
        insert_rich_text_property(values, schema, &name, document.author.as_deref());
    }
    let actual_book_id = meta_value(document, "bookId");
    let display_book_id = actual_book_id.or(Some(&document.source_id));
    if let Some(name) = property_name("bookId", "Book ID") {
        insert_rich_text_property(values, schema, &name, display_book_id);
    }
    if let Some(name) = property_name("scopeId", "Scope ID") {
        insert_rich_text_property(values, schema, &name, meta_value(document, "scope"));
    }
    if let Some(name) = property_name("assetType", "资产类型") {
        insert_status_like_property(
            values,
            schema,
            &name,
            Some(source_kind_label(document.source_kind)),
        );
    }
    if let Some(name) = property_name("source", "来源") {
        insert_select_status_or_text_property(values, schema, &name, Some("wxreadmaster"));
    }
    if let Some(name) = property_name("exportedAt", "导出时间") {
        insert_date_property(
            values,
            schema,
            &name,
            exported_at_to_notion_date(&document.exported_at),
        );
    }
    if let Some(name) = property_name("importStatus", "导入状态") {
        insert_status_like_property(values, schema, &name, Some("已导入"));
    }
    if let Some(name) = property_name("readingStatus", "阅读状态") {
        insert_status_like_property(
            values,
            schema,
            &name,
            meta_value(document, "readingStatusLabel")
                .or_else(|| meta_value(document, "readingStatus")),
        );
    }
    if let Some(name) = property_name("promptVersion", "Prompt 版本") {
        insert_rich_text_property(values, schema, &name, meta_value(document, "promptVersion"));
    }
    if let Some(name) = property_name("inputHash", "输入哈希") {
        insert_rich_text_property(values, schema, &name, meta_value(document, "inputHash"));
    }
    if let Some(name) = property_name("period", "周期") {
        insert_status_like_property(
            values,
            schema,
            &name,
            meta_value(document, "period").map(period_label),
        );
    }
    if let Some(name) = property_name("readingStage", "阅读阶段") {
        insert_status_like_property(
            values,
            schema,
            &name,
            meta_value(document, "readingStageLabel")
                .or_else(|| meta_value(document, "readingStage").map(reading_stage_label)),
        );
    }
    if let Some(name) = property_name("progress", "进度") {
        insert_progress_property(values, schema, &name, meta_number(document, "progress"));
    }
    if let Some(name) = property_name("actionCount", "行动数") {
        insert_number_property(values, schema, &name, meta_number(document, "actionCount"));
    }
    if let Some(name) = property_name("candidateCount", "候选书数") {
        insert_number_property(
            values,
            schema,
            &name,
            meta_number(document, "candidateCount"),
        );
    }
    if let Some(name) = property_name("highlightCount", "划线数") {
        insert_number_property(
            values,
            schema,
            &name,
            meta_number(document, "highlightCount"),
        );
    }
    if let Some(name) = property_name("thoughtCount", "想法数") {
        insert_number_property(values, schema, &name, meta_number(document, "thoughtCount"));
    }
    if let Some(name) = property_name("bookmarkCount", "书签数") {
        insert_number_property(
            values,
            schema,
            &name,
            meta_number(document, "bookmarkCount"),
        );
    }
    if let Some(name) = property_name("exportableCount", "可导出数") {
        insert_number_property(
            values,
            schema,
            &name,
            meta_number(document, "exportableCount"),
        );
    }
    if let Some(name) = property_name("tags", "标签") {
        insert_multi_select_property(values, schema, &name, meta_csv_values(document, "tagList"));
    }
    if let Some(name) = property_name("wereadUrl", "微信读书") {
        insert_url_property(
            values,
            schema,
            &name,
            meta_value(document, "wereadUrl")
                .map(str::to_string)
                .or_else(|| actual_book_id.and_then(weread_book_url)),
        );
    }
    if let Some(name) = property_name("obsidianPath", "Obsidian 路径") {
        insert_rich_text_property(values, schema, &name, meta_value(document, "obsidianPath"));
    }
}

fn reading_library_template_properties() -> Value {
    json!({
        "名称": { "title": {} },
        "作者": { "rich_text": {} },
        "封面": { "files": {} },
        "Book ID": { "rich_text": {} },
        "资产类型": {
            "select": {
                "options": [
                    { "name": "书籍笔记", "color": "green" },
                    { "name": "书籍复盘", "color": "blue" },
                    { "name": "阅读统计复盘", "color": "yellow" },
                    { "name": "阅读路线", "color": "orange" },
                    { "name": "选书决策", "color": "purple" }
                ]
            }
        },
        "来源": {
            "select": {
                "options": [
                    { "name": "wxreadmaster", "color": "green" },
                    { "name": "Obsidian", "color": "gray" },
                    { "name": "手动整理", "color": "brown" }
                ]
            }
        },
        "导出时间": { "date": {} },
        "导入状态": {
            "select": {
                "options": [
                    { "name": "待整理", "color": "yellow" },
                    { "name": "已导入", "color": "green" },
                    { "name": "已复盘", "color": "blue" },
                    { "name": "已归档", "color": "gray" }
                ]
            }
        },
        "阅读状态": {
            "select": {
                "options": [
                    { "name": "待读", "color": "gray" },
                    { "name": "阅读中", "color": "yellow" },
                    { "name": "复盘中", "color": "blue" },
                    { "name": "已整理", "color": "green" }
                ]
            }
        },
        "阅读阶段": {
            "select": {
                "options": [
                    { "name": "起步", "color": "gray" },
                    { "name": "建立主线", "color": "yellow" },
                    { "name": "深入推进", "color": "blue" },
                    { "name": "收束整理", "color": "orange" },
                    { "name": "完成归档", "color": "green" }
                ]
            }
        },
        "进度": { "number": { "format": "percent" } },
        "标签": {
            "multi_select": {
                "options": [
                    { "name": "重点", "color": "red" },
                    { "name": "待复盘", "color": "yellow" },
                    { "name": "可行动", "color": "green" }
                ]
            }
        },
        "微信读书": { "url": {} },
        "Obsidian 路径": { "rich_text": {} },
        "Prompt 版本": { "rich_text": {} },
        "输入哈希": { "rich_text": {} },
        "Scope ID": { "rich_text": {} },
        "周期": {
            "select": {
                "options": [
                    { "name": "周复盘", "color": "blue" },
                    { "name": "月复盘", "color": "green" },
                    { "name": "年复盘", "color": "yellow" },
                    { "name": "总览", "color": "purple" }
                ]
            }
        },
        "行动数": { "number": { "format": "number" } },
        "候选书数": { "number": { "format": "number" } },
        "划线数": { "number": { "format": "number" } },
        "想法数": { "number": { "format": "number" } },
        "书签数": { "number": { "format": "number" } },
        "可导出数": { "number": { "format": "number" } }
    })
}

fn external_url(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty() && (value.starts_with("http://") || value.starts_with("https://")))
        .then_some(value)
}

fn document_cover_url(document: &ExportDocument) -> Option<&str> {
    document
        .cover
        .as_ref()
        .and_then(|asset| asset.remote_url.as_deref())
        .and_then(external_url)
}

pub(crate) fn external_file_value(name: &str, url: &str) -> Option<Value> {
    let url = external_url(url)?;
    let name = name.trim();
    Some(json!({
        "name": if name.is_empty() { "封面" } else { name },
        "type": "external",
        "external": { "url": url }
    }))
}

pub(crate) fn external_cover_value(url: &str) -> Option<Value> {
    external_url(url).map(|url| {
        json!({
            "type": "external",
            "external": { "url": url }
        })
    })
}

fn insert_rich_text_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<&str>,
) {
    if !property_type_matches(schema, name, "rich_text") {
        return;
    }
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    values.insert(name.to_string(), json!({ "rich_text": rich_text(value) }));
}

fn insert_status_like_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<&str>,
) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if property_type_matches(schema, name, "status") {
        values.insert(name.to_string(), json!({ "status": { "name": value } }));
    } else if property_type_matches(schema, name, "select") {
        values.insert(name.to_string(), json!({ "select": { "name": value } }));
    }
}

fn insert_select_status_or_text_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<&str>,
) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if property_type_matches(schema, name, "rich_text") {
        values.insert(name.to_string(), json!({ "rich_text": rich_text(value) }));
    } else {
        insert_status_like_property(values, schema, name, Some(value));
    }
}

fn insert_multi_select_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Vec<String>,
) {
    if !property_type_matches(schema, name, "multi_select") || value.is_empty() {
        return;
    }
    values.insert(
        name.to_string(),
        json!({ "multi_select": value.into_iter().map(|name| json!({ "name": name })).collect::<Vec<_>>() }),
    );
}

fn insert_number_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<f64>,
) {
    if !property_type_matches(schema, name, "number") {
        return;
    }
    let Some(value) = value else {
        return;
    };
    values.insert(name.to_string(), json!({ "number": value }));
}

fn insert_progress_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<f64>,
) {
    if !property_type_matches(schema, name, "number") {
        return;
    }
    let Some(value) = value else {
        return;
    };
    let percent_format = schema
        .properties
        .get(name)
        .and_then(|property| property.get("number"))
        .and_then(|number| number.get("format"))
        .and_then(Value::as_str)
        == Some("percent");
    let value = if percent_format { value / 100.0 } else { value };
    values.insert(name.to_string(), json!({ "number": value }));
}

fn insert_date_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<String>,
) {
    if !property_type_matches(schema, name, "date") {
        return;
    }
    let Some(value) = value else {
        return;
    };
    values.insert(name.to_string(), json!({ "date": { "start": value } }));
}

fn insert_url_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<String>,
) {
    if !property_type_matches(schema, name, "url") {
        return;
    }
    let Some(value) = value
        .map(|value| value.trim().to_string())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
    else {
        return;
    };
    values.insert(name.to_string(), json!({ "url": value }));
}

fn mapped_property_name(
    schema: &NotionDatabaseSchema,
    mappings: &[NotionPropertyMapping],
    logical_field: &str,
) -> Option<String> {
    let mapping = mappings
        .iter()
        .find(|mapping| mapping.enabled && mapping.logical_field == logical_field)?;
    schema.properties.iter().find_map(|(name, property)| {
        let id_matches =
            property.get("id").and_then(Value::as_str) == Some(mapping.property_id.as_str());
        let type_matches =
            property.get("type").and_then(Value::as_str) == Some(mapping.property_type.as_str());
        (id_matches && type_matches).then(|| name.clone())
    })
}

fn property_mapping_warning(
    schema: &NotionDatabaseSchema,
    mappings: &[NotionPropertyMapping],
) -> Option<String> {
    if mappings.is_empty() {
        return None;
    }

    let unavailable = mappings
        .iter()
        .filter(|mapping| mapping.enabled && mapping.logical_field != "title")
        .filter(|mapping| {
            !schema.properties.values().any(|property| {
                property.get("id").and_then(Value::as_str) == Some(mapping.property_id.as_str())
                    && property.get("type").and_then(Value::as_str)
                        == Some(mapping.property_type.as_str())
            })
        })
        .map(|mapping| mapping.property_name_snapshot.as_str())
        .collect::<Vec<_>>();

    (!unavailable.is_empty()).then(|| {
        format!(
            "以下 Notion 可选字段已删除或类型发生变化，本次已跳过：{}。正文和其余字段已继续导出。",
            unavailable.join("、")
        )
    })
}

fn merge_warning(existing: Option<String>, addition: Option<String>) -> Option<String> {
    match (existing, addition) {
        (Some(existing), Some(addition)) => Some(format!("{existing}；{addition}")),
        (Some(existing), None) => Some(existing),
        (None, Some(addition)) => Some(addition),
        (None, None) => None,
    }
}

fn property_type_matches(schema: &NotionDatabaseSchema, name: &str, expected: &str) -> bool {
    schema
        .properties
        .get(name)
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        == Some(expected)
}

fn meta_value<'a>(document: &'a ExportDocument, key: &str) -> Option<&'a str> {
    document
        .front_matter
        .iter()
        .find(|field| field.key == key)
        .map(|field| field.value.trim())
        .filter(|value| !value.is_empty())
}

fn meta_number(document: &ExportDocument, key: &str) -> Option<f64> {
    meta_value(document, key).and_then(|value| value.parse::<f64>().ok())
}

fn meta_csv_values(document: &ExportDocument, key: &str) -> Vec<String> {
    meta_value(document, key)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .fold(Vec::new(), |mut values, item| {
                    if !values.iter().any(|existing| existing == item) {
                        values.push(item.to_string());
                    }
                    values
                })
        })
        .unwrap_or_default()
}

fn weread_book_url(book_id: &str) -> Option<String> {
    super::weread_link::weread_book_detail_url(book_id)
}

fn exported_at_to_notion_date(exported_at: &str) -> Option<String> {
    let value = exported_at.trim();
    if value.is_empty() {
        return None;
    }
    if value.contains('T') || value.contains('-') {
        return Some(value.to_string());
    }
    value
        .parse::<i64>()
        .ok()
        .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
        .map(|datetime| datetime.to_rfc3339())
}

fn source_kind_label(source_kind: super::document::ExportSourceKind) -> &'static str {
    match source_kind {
        super::document::ExportSourceKind::BookNotes => "书籍笔记",
        super::document::ExportSourceKind::BookReview => "书籍复盘",
        super::document::ExportSourceKind::ReadingStatsReview => "阅读统计复盘",
        super::document::ExportSourceKind::ReadingRoute => "阅读路线",
        super::document::ExportSourceKind::BookDecision => "选书决策",
    }
}

fn period_label(value: &str) -> &str {
    match value {
        "weekly" => "周复盘",
        "annually" => "年复盘",
        "overall" => "总览",
        _ => "月复盘",
    }
}

fn reading_stage_label(value: &str) -> &str {
    match value {
        "framing" => "建立主线",
        "deepening" => "深入推进",
        "closing" => "收束整理",
        "completed" => "完成归档",
        _ => "起步",
    }
}

fn markdown_to_blocks(markdown: &str) -> Vec<Value> {
    let mut blocks = Vec::new();
    let mut paragraph = Vec::new();
    let mut quote = Vec::new();
    let mut code_fence: Option<MarkdownCodeFence> = None;
    for raw_line in markdown
        .lines()
        .skip(yaml_front_matter_line_count(markdown))
    {
        if let Some(fence) = code_fence.as_mut() {
            if raw_line.trim().starts_with("```") {
                flush_code_fence(&mut blocks, &mut code_fence);
            } else {
                fence.lines.push(raw_line.to_string());
            }
            continue;
        }

        if let Some(language) = raw_line.trim().strip_prefix("```") {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            code_fence = Some(MarkdownCodeFence {
                language: notion_code_language(language),
                lines: Vec::new(),
            });
            continue;
        }

        let Some(line) = strip_obsidian_block_anchor(raw_line) else {
            continue;
        };
        let trimmed = line.trim();

        if trimmed.is_empty() {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            continue;
        }

        if is_horizontal_rule(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            blocks.push(divider_block());
            continue;
        }

        if let Some((kind, value)) = heading_parts(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            push_text_blocks(&mut blocks, kind, value);
        } else if let Some((alt, url)) = parse_markdown_image(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            push_image_block(&mut blocks, alt, url);
        } else if let Some(value) = trimmed.strip_prefix(">") {
            flush_paragraph(&mut blocks, &mut paragraph);
            quote.push(value.trim_start().to_string());
        } else if let Some(value) = markdown_list_item_text(line.trim_start(), "- ")
            .or_else(|| markdown_list_item_text(line.trim_start(), "* "))
        {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            push_text_blocks(&mut blocks, "bulleted_list_item", value);
        } else if let Some(value) = markdown_numbered_list_item_text(line.trim_start()) {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            push_text_blocks(&mut blocks, "numbered_list_item", value);
        } else {
            flush_quote(&mut blocks, &mut quote);
            paragraph.push(trimmed.to_string());
        }
    }
    flush_code_fence(&mut blocks, &mut code_fence);
    flush_quote(&mut blocks, &mut quote);
    flush_paragraph(&mut blocks, &mut paragraph);
    blocks
}

#[derive(Debug, Clone)]
struct MarkdownCodeFence {
    language: String,
    lines: Vec<String>,
}

fn flush_paragraph(blocks: &mut Vec<Value>, paragraph: &mut Vec<String>) {
    if paragraph.is_empty() {
        return;
    }
    push_text_blocks(blocks, "paragraph", &paragraph.join("\n"));
    paragraph.clear();
}

fn flush_quote(blocks: &mut Vec<Value>, quote: &mut Vec<String>) {
    if quote.is_empty() {
        return;
    }
    push_text_blocks(blocks, "quote", &quote.join("\n"));
    quote.clear();
}

fn flush_code_fence(blocks: &mut Vec<Value>, code_fence: &mut Option<MarkdownCodeFence>) {
    let Some(fence) = code_fence.take() else {
        return;
    };
    push_code_blocks(blocks, &fence.lines.join("\n"), &fence.language);
}

fn push_text_blocks(blocks: &mut Vec<Value>, kind: &str, text: &str) {
    let runs = parse_inline_runs(text);
    for chunk in split_runs_into_blocks(runs, MAX_BLOCK_TEXT_LENGTH) {
        blocks.push(json!({
            "object": "block",
            "type": kind,
            kind: { "rich_text": runs_to_rich_text(&chunk) }
        }));
    }
}

/// 单条 Notion rich_text 片段：正文加可选的粗体、斜体、行内代码与链接标注。
#[derive(Debug, Clone, PartialEq, Eq)]
struct InlineRun {
    text: String,
    bold: bool,
    italic: bool,
    code: bool,
    link: Option<String>,
}

impl InlineRun {
    fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: false,
            italic: false,
            code: false,
            link: None,
        }
    }
}

fn runs_to_rich_text(runs: &[InlineRun]) -> Vec<Value> {
    runs.iter()
        .map(|run| {
            let mut item = json!({ "type": "text", "text": { "content": run.text } });
            if let Some(url) = run.link.as_deref() {
                item["text"]["link"] = json!({ "url": url });
            }
            let mut annotations = Map::new();
            if run.bold {
                annotations.insert("bold".to_string(), Value::Bool(true));
            }
            if run.italic {
                annotations.insert("italic".to_string(), Value::Bool(true));
            }
            if run.code {
                annotations.insert("code".to_string(), Value::Bool(true));
            }
            if !annotations.is_empty() {
                item["annotations"] = Value::Object(annotations);
            }
            item
        })
        .collect()
}

/// 跳过文档起始处的 YAML front matter（Obsidian/Markdown 专用，Notion 元数据走属性）。
fn yaml_front_matter_line_count(markdown: &str) -> usize {
    let mut lines = markdown.lines();
    match lines.next() {
        Some(first) if first.trim() == "---" => {}
        _ => return 0,
    }
    let mut count = 1;
    for line in lines {
        count += 1;
        let trimmed = line.trim();
        if trimmed == "---" || trimmed == "..." {
            return count;
        }
    }
    0
}

fn is_block_anchor_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// 去除 Obsidian 块引用锚点（`^block-id`）：整行锚点返回 None，行尾锚点被剥离。
fn strip_obsidian_block_anchor(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if let Some(id) = trimmed.strip_prefix('^') {
        if is_block_anchor_id(id) {
            return None;
        }
    }
    let trimmed_end = line.trim_end();
    if let Some((rest, token)) = trimmed_end.rsplit_once(' ') {
        if let Some(id) = token.strip_prefix('^') {
            if is_block_anchor_id(id) && !rest.trim().is_empty() {
                return Some(rest.trim_end());
            }
        }
    }
    Some(line)
}

fn is_horizontal_rule(line: &str) -> bool {
    line.chars().count() >= 3
        && (line.chars().all(|character| character == '-')
            || line.chars().all(|character| character == '*')
            || line.chars().all(|character| character == '_'))
}

fn heading_parts(line: &str) -> Option<(&'static str, &str)> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = line[hashes..].strip_prefix(' ')?;
    let kind = match hashes {
        1 => "heading_1",
        2 => "heading_2",
        _ => "heading_3",
    };
    let value = rest.trim();
    if value.is_empty() {
        return None;
    }
    Some((kind, value))
}

fn is_cover_related_error(message: &str) -> bool {
    message.to_ascii_lowercase().contains("cover")
}

fn flush_plain_run(runs: &mut Vec<InlineRun>, plain: &mut String) {
    if plain.is_empty() {
        return;
    }
    runs.push(InlineRun::plain(std::mem::take(plain)));
}

fn find_inline_code_close(chars: &[char], from: usize) -> Option<usize> {
    let mut index = from;
    while index < chars.len() {
        match chars[index] {
            '\n' => return None,
            '`' => return (index > from).then_some(index),
            _ => index += 1,
        }
    }
    None
}

fn find_double_star_close(chars: &[char], from: usize) -> Option<usize> {
    let mut index = from;
    while index + 1 < chars.len() {
        if chars[index] == '\n' {
            return None;
        }
        if chars[index] == '*' && chars[index + 1] == '*' {
            return (index > from).then_some(index);
        }
        index += 1;
    }
    None
}

fn find_underscore_close(chars: &[char], from: usize) -> Option<usize> {
    let mut index = from;
    while index < chars.len() {
        if chars[index] == '\n' {
            return None;
        }
        if chars[index] == '_' {
            let boundary = index + 1 == chars.len() || !chars[index + 1].is_alphanumeric();
            return (index > from && boundary).then_some(index);
        }
        index += 1;
    }
    None
}

fn find_single_star_close(chars: &[char], from: usize) -> Option<usize> {
    let mut index = from;
    while index < chars.len() {
        if chars[index] == '\n' {
            return None;
        }
        if chars[index] == '*' {
            let after_ok = index + 1 == chars.len() || chars[index + 1] != '*';
            let before_ok = index > from && !chars[index - 1].is_whitespace();
            return (after_ok && before_ok).then_some(index);
        }
        index += 1;
    }
    None
}

fn parse_link_at(chars: &[char], bracket_start: usize) -> Option<(String, String, usize)> {
    if chars.get(bracket_start) != Some(&'[') {
        return None;
    }
    let mut label_end = bracket_start + 1;
    while label_end < chars.len() && chars[label_end] != ']' && chars[label_end] != '\n' {
        label_end += 1;
    }
    if chars.get(label_end) != Some(&']') || chars.get(label_end + 1) != Some(&'(') {
        return None;
    }
    let mut url_end = label_end + 2;
    while url_end < chars.len() && chars[url_end] != ')' && chars[url_end] != '\n' {
        url_end += 1;
    }
    if chars.get(url_end) != Some(&')') {
        return None;
    }
    let label = chars[bracket_start + 1..label_end].iter().collect();
    let url = chars[label_end + 2..url_end].iter().collect();
    Some((label, url, url_end + 1))
}

fn merge_adjacent_runs(runs: Vec<InlineRun>) -> Vec<InlineRun> {
    let mut merged: Vec<InlineRun> = Vec::new();
    for run in runs {
        if run.text.is_empty() {
            continue;
        }
        match merged.last_mut() {
            Some(last)
                if last.bold == run.bold
                    && last.italic == run.italic
                    && last.code == run.code
                    && last.link == run.link =>
            {
                last.text.push_str(&run.text);
            }
            _ => merged.push(run),
        }
    }
    merged
}

/// 极简行内 Markdown 解析：链接、粗体、斜体、行内代码与反斜杠转义。
/// 非 http(s) 链接（如 weread:// 深链）降级为纯文本，只保留可读文字。
fn parse_inline_runs(text: &str) -> Vec<InlineRun> {
    parse_inline_runs_depth(text, 0)
}

fn parse_inline_runs_depth(text: &str, depth: usize) -> Vec<InlineRun> {
    let chars: Vec<char> = text.chars().collect();
    let mut runs: Vec<InlineRun> = Vec::new();
    let mut plain = String::new();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];

        if current == '\\' && index + 1 < chars.len() && chars[index + 1].is_ascii_punctuation() {
            plain.push(chars[index + 1]);
            index += 2;
            continue;
        }

        if current == '`' {
            if let Some(end) = find_inline_code_close(&chars, index + 1) {
                flush_plain_run(&mut runs, &mut plain);
                runs.push(InlineRun {
                    text: chars[index + 1..end].iter().collect(),
                    bold: false,
                    italic: false,
                    code: true,
                    link: None,
                });
                index = end + 1;
                continue;
            }
        }

        if depth < 2 && current == '*' && chars.get(index + 1) == Some(&'*') {
            if let Some(end) = find_double_star_close(&chars, index + 2) {
                let content: String = chars[index + 2..end].iter().collect();
                if !content.trim().is_empty() {
                    flush_plain_run(&mut runs, &mut plain);
                    for mut run in parse_inline_runs_depth(&content, depth + 1) {
                        run.bold = true;
                        runs.push(run);
                    }
                    index = end + 2;
                    continue;
                }
            }
        }

        if current == '[' || (current == '!' && chars.get(index + 1) == Some(&'[')) {
            let is_image = current == '!';
            let bracket_start = if is_image { index + 1 } else { index };
            if let Some((label, url, next_index)) = parse_link_at(&chars, bracket_start) {
                flush_plain_run(&mut runs, &mut plain);
                let url = url
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .trim();
                let label = label.trim();
                if !is_image && (url.starts_with("http://") || url.starts_with("https://")) {
                    let text = if label.is_empty() { url } else { label };
                    runs.push(InlineRun {
                        text: text.to_string(),
                        bold: false,
                        italic: false,
                        code: false,
                        link: Some(url.to_string()),
                    });
                } else if !label.is_empty() {
                    runs.push(InlineRun::plain(label));
                }
                index = next_index;
                continue;
            }
        }

        if depth < 2 && current == '_' {
            let boundary = index == 0 || !chars[index - 1].is_alphanumeric();
            if boundary {
                if let Some(end) = find_underscore_close(&chars, index + 1) {
                    let content: String = chars[index + 1..end].iter().collect();
                    if !content.trim().is_empty() {
                        flush_plain_run(&mut runs, &mut plain);
                        for mut run in parse_inline_runs_depth(&content, depth + 1) {
                            run.italic = true;
                            runs.push(run);
                        }
                        index = end + 1;
                        continue;
                    }
                }
            }
        }

        if depth < 2
            && current == '*'
            && chars.get(index + 1) != Some(&'*')
            && chars
                .get(index + 1)
                .is_some_and(|next| !next.is_whitespace())
        {
            if let Some(end) = find_single_star_close(&chars, index + 1) {
                let content: String = chars[index + 1..end].iter().collect();
                if !content.trim().is_empty() {
                    flush_plain_run(&mut runs, &mut plain);
                    for mut run in parse_inline_runs_depth(&content, depth + 1) {
                        run.italic = true;
                        runs.push(run);
                    }
                    index = end + 1;
                    continue;
                }
            }
        }

        plain.push(current);
        index += 1;
    }
    flush_plain_run(&mut runs, &mut plain);
    merge_adjacent_runs(runs)
}

/// 按 Notion 限制切分：单块 rich_text 总字符 ≤ max_chars，条目数 ≤ 100。
fn split_runs_into_blocks(runs: Vec<InlineRun>, max_chars: usize) -> Vec<Vec<InlineRun>> {
    let mut blocks = Vec::new();
    let mut current: Vec<InlineRun> = Vec::new();
    let mut current_chars = 0usize;
    for run in runs {
        let chars: Vec<char> = run.text.chars().collect();
        let mut offset = 0;
        while offset < chars.len() {
            if current_chars >= max_chars || current.len() >= MAX_RICH_TEXT_ITEMS_PER_BLOCK {
                blocks.push(std::mem::take(&mut current));
                current_chars = 0;
            }
            let take_count = (max_chars - current_chars).min(chars.len() - offset);
            current.push(InlineRun {
                text: chars[offset..offset + take_count].iter().collect(),
                bold: run.bold,
                italic: run.italic,
                code: run.code,
                link: run.link.clone(),
            });
            current_chars += take_count;
            offset += take_count;
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn push_code_blocks(blocks: &mut Vec<Value>, text: &str, language: &str) {
    for chunk in split_text(text, MAX_BLOCK_TEXT_LENGTH) {
        blocks.push(json!({
            "object": "block",
            "type": "code",
            "code": {
                "rich_text": rich_text(&chunk),
                "language": language
            }
        }));
    }
}

fn push_image_block(blocks: &mut Vec<Value>, alt: &str, url: &str) {
    let caption = alt.trim();
    blocks.push(json!({
        "object": "block",
        "type": "image",
        "image": {
            "type": "external",
            "external": { "url": url },
            "caption": if caption.is_empty() { Vec::new() } else { rich_text(caption) }
        }
    }));
}

fn markdown_list_item_text<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    line.strip_prefix(marker)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn markdown_numbered_list_item_text(line: &str) -> Option<&str> {
    let (number, rest) = line.split_once(". ")?;
    if number.is_empty() || !number.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    Some(rest.trim()).filter(|value| !value.is_empty())
}

fn parse_markdown_image(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix("![")?;
    let (alt, url_part) = rest.split_once("](")?;
    let url = url_part.strip_suffix(')')?.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        Some((alt, url))
    } else {
        None
    }
}

fn notion_code_language(value: &str) -> String {
    let language = value.trim().to_ascii_lowercase();
    let normalized = match language.as_str() {
        "" | "text" | "txt" | "plain" => "plain text",
        "js" => "javascript",
        "ts" => "typescript",
        "rs" => "rust",
        "py" => "python",
        "ps1" => "powershell",
        "sh" => "shell",
        "md" => "markdown",
        "yml" => "yaml",
        "csharp" => "c#",
        "cpp" => "c++",
        "html" | "xml" | "css" | "json" | "javascript" | "typescript" | "python" | "rust"
        | "powershell" | "shell" | "bash" | "markdown" | "yaml" | "sql" | "java" | "go" | "php"
        | "ruby" | "swift" | "kotlin" | "c" | "c++" | "c#" | "mermaid" => language.as_str(),
        _ => "plain text",
    };
    normalized.to_string()
}

fn split_text(value: &str, max_chars: usize) -> Vec<String> {
    if value.is_empty() {
        return Vec::new();
    }
    let chars = value.chars().collect::<Vec<_>>();
    chars
        .chunks(max_chars)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

fn rich_text(value: &str) -> Vec<Value> {
    vec![json!({ "type": "text", "text": { "content": value } })]
}

fn rich_text_link(value: &str, url: &str) -> Vec<Value> {
    vec![json!({
        "type": "text",
        "text": {
            "content": value,
            "link": { "url": url }
        }
    })]
}

pub(crate) fn notion_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(NOTION_CONNECT_TIMEOUT_SECONDS))
        .timeout(Duration::from_secs(NOTION_REQUEST_TIMEOUT_SECONDS))
        .user_agent(concat!(
            env!("CARGO_PKG_NAME"),
            "/",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|error| format!("初始化 Notion 网络客户端失败：{error}"))
}

fn notion_network_error(error: &reqwest::Error) -> String {
    let reason = if error.is_timeout() {
        "连接或等待响应超时"
    } else if error.is_connect() {
        "无法建立网络连接"
    } else if error.is_request() {
        "请求发送失败"
    } else if error.is_body() {
        "响应传输中断"
    } else if error.is_decode() {
        "响应内容无法解析"
    } else {
        "网络请求失败"
    };
    notion_network_error_message(reason, &error.to_string())
}

fn notion_network_error_message(reason: &str, diagnostic: &str) -> String {
    format!(
        "无法连接 Notion API（{reason}）。请检查网络、系统代理或 VPN 后重试。诊断：{diagnostic}"
    )
}

pub(crate) fn notion_request(
    client: &Client,
    options: &NotionExportOptions,
    method: reqwest::Method,
    path: &str,
) -> reqwest::RequestBuilder {
    notion_request_with_version(
        client,
        &options.token,
        method,
        path,
        NOTION_LEGACY_API_VERSION,
    )
}

pub(crate) fn notion_request_with_version(
    client: &Client,
    token: &str,
    method: reqwest::Method,
    path: &str,
    notion_version: &'static str,
) -> reqwest::RequestBuilder {
    client
        .request(method, format!("{NOTION_API_BASE}{path}"))
        .bearer_auth(token)
        .header("Notion-Version", notion_version)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .timeout(std::time::Duration::from_secs(
            NOTION_REQUEST_TIMEOUT_SECONDS,
        ))
}

/// 标准数据库创建专用请求。该路径必须保留“服务端明确拒绝”和“请求结果未知”的区别，
/// 以便上层决定是否允许再次创建。
async fn send_notion_database_create_request(
    builder: reqwest::RequestBuilder,
) -> Result<Value, NotionDatabaseCreateError> {
    let mut attempt: u32 = 0;
    loop {
        let request = builder
            .try_clone()
            .ok_or_else(|| NotionDatabaseCreateError {
                code: "notion_database_create_request_invalid".to_string(),
                message: "Notion 数据库创建请求构造失败。".to_string(),
                retryable: false,
                result_unknown: false,
            })?;
        let response = request.send().await.map_err(|error| {
            let timed_out = error.is_timeout();
            NotionDatabaseCreateError {
                code: if timed_out {
                    "notion_database_create_timeout"
                } else {
                    "notion_database_create_network_error"
                }
                .to_string(),
                message: if timed_out {
                    "创建 Notion 数据库请求超时，远端结果暂时无法确认。".to_string()
                } else {
                    format!("创建 Notion 数据库时网络中断，远端结果暂时无法确认：{error}")
                },
                retryable: true,
                result_unknown: true,
            }
        })?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS
            && attempt < NOTION_RATE_LIMIT_MAX_RETRIES
        {
            let delay_seconds = retry_after_seconds(&response)
                .unwrap_or(u64::from(attempt) + 1)
                .clamp(1, NOTION_RATE_LIMIT_MAX_DELAY_SECONDS);
            tokio::time::sleep(std::time::Duration::from_secs(delay_seconds)).await;
            attempt += 1;
            continue;
        }

        let status = response.status();
        let payload = response.json::<Value>().await;
        if status.is_success() {
            return payload.map_err(|error| NotionDatabaseCreateError {
                code: "notion_database_create_response_invalid".to_string(),
                message: format!(
                    "Notion 返回成功状态，但创建结果无法解析，远端结果暂时无法确认：{error}"
                ),
                retryable: false,
                result_unknown: true,
            });
        }

        return Err(notion_database_create_http_error(status, payload.ok()));
    }
}

fn notion_database_create_http_error(
    status: StatusCode,
    payload: Option<Value>,
) -> NotionDatabaseCreateError {
    let api_message = payload
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("Notion API 请求失败");
    let prefix = match status {
        StatusCode::UNAUTHORIZED => "Notion Token 无效或已失效",
        StatusCode::FORBIDDEN => "Notion Integration 没有访问目标页面的权限",
        StatusCode::NOT_FOUND => "Notion 目标页面不存在，或尚未共享给 Integration",
        StatusCode::TOO_MANY_REQUESTS => "Notion API 请求过于频繁",
        _ if status.is_server_error() => "Notion 服务暂时异常，数据库创建结果无法确认",
        _ => "Notion API 拒绝创建数据库",
    };
    let result_unknown = status.is_server_error() || !status.is_client_error();
    NotionDatabaseCreateError {
        code: if result_unknown {
            "notion_database_create_result_unknown"
        } else {
            "notion_database_create_rejected"
        }
        .to_string(),
        message: format!("{prefix}：{api_message}"),
        retryable: status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error(),
        result_unknown,
    }
}

/// 发送 Notion 请求；命中 429 限流时按 Retry-After 退避后重试。
/// 只重试 429（请求未被处理，重试安全），不重试网络错误或 5xx，
/// 避免“结果未知”场景下重复创建页面。
pub(crate) async fn send_notion_request(builder: reqwest::RequestBuilder) -> Result<Value, String> {
    send_notion_request_typed(builder)
        .await
        .map_err(|error| error.to_string())
}

/// 为需要在 mutation 后执行对账的调用保留结构化的“结果未知”语义。
/// 网络中断、超时、成功响应无法解析以及非客户端 HTTP 状态均可能表示远端已处理请求。
pub(crate) async fn send_notion_request_typed(
    builder: reqwest::RequestBuilder,
) -> Result<Value, NotionRequestError> {
    let mut attempt: u32 = 0;
    loop {
        let request = builder.try_clone().ok_or_else(|| NotionRequestError {
            message: "Notion 请求构造失败。".to_string(),
            result_unknown: false,
        })?;
        let response = request.send().await.map_err(|error| NotionRequestError {
            message: notion_network_error(&error),
            result_unknown: true,
        })?;
        if response.status() == StatusCode::TOO_MANY_REQUESTS
            && attempt < NOTION_RATE_LIMIT_MAX_RETRIES
        {
            let delay_seconds = retry_after_seconds(&response)
                .unwrap_or(u64::from(attempt) + 1)
                .clamp(1, NOTION_RATE_LIMIT_MAX_DELAY_SECONDS);
            tokio::time::sleep(std::time::Duration::from_secs(delay_seconds)).await;
            attempt += 1;
            continue;
        }
        return parse_notion_response_typed(response).await;
    }
}

fn retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn notion_request_error_from_parts(
    status: StatusCode,
    payload: Result<Value, String>,
) -> Result<Value, NotionRequestError> {
    let payload = payload.map_err(|error| NotionRequestError {
        message: format!("Notion 响应内容无法解析：{error}"),
        result_unknown: status.is_success() || !status.is_client_error(),
    })?;
    if status.is_success() {
        return Ok(payload);
    }

    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Notion API 请求失败");
    let code = payload
        .get("code")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let prefix = match status {
        StatusCode::UNAUTHORIZED => "Notion Token 无效或已失效",
        StatusCode::FORBIDDEN => "Notion Integration 没有访问目标页面的权限",
        StatusCode::NOT_FOUND => "Notion 目标页面或数据库不存在，或尚未共享给 Integration",
        StatusCode::TOO_MANY_REQUESTS => "Notion API 请求过于频繁",
        _ if status.is_server_error() => "Notion 服务暂时异常",
        _ => "Notion API 请求失败",
    };
    let diagnostic = code
        .map(|code| format!("（HTTP {}，code: {code}）", status.as_u16()))
        .unwrap_or_else(|| format!("（HTTP {}）", status.as_u16()));
    Err(NotionRequestError {
        message: format!("{prefix}{diagnostic}：{message}"),
        result_unknown: !status.is_client_error(),
    })
}

async fn parse_notion_response_typed(
    response: reqwest::Response,
) -> Result<Value, NotionRequestError> {
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string());
    notion_request_error_from_parts(status, payload)
}

#[cfg(test)]
mod tests {
    use crate::export::{
        assets::{ExportAsset, ExportAssetKind},
        document::{ExportDocument, ExportSourceKind},
        targets::NotionParentType,
    };

    use super::{
        analyze_database_value, create_page_payload, exported_at_to_notion_date,
        is_cover_related_error, mapped_property_name, markdown_to_blocks,
        notion_database_create_http_error, notion_network_error_message, notion_object_id_and_url,
        notion_request_error_from_parts, page_cover_contains_url, page_cover_is_empty,
        page_files_property_contains_url, page_files_property_is_empty, property_mapping_warning,
        reading_database_payload, schema_fingerprint, split_text,
        workspace_database_followup_blocks, workspace_homepage_payload, NotionDatabaseSchema,
        NotionExportOptions, NotionPropertyMapping, NotionPropertySummary, MAX_BLOCK_TEXT_LENGTH,
    };

    #[test]
    fn notion_network_errors_include_actionable_proxy_guidance() {
        assert_eq!(
            notion_network_error_message(
                "无法建立网络连接",
                "error sending request for url (https://api.notion.com/v1/databases/example)"
            ),
            "无法连接 Notion API（无法建立网络连接）。请检查网络、系统代理或 VPN 后重试。诊断：error sending request for url (https://api.notion.com/v1/databases/example)"
        );
    }

    #[test]
    fn database_create_http_errors_classify_known_and_unknown_results() {
        let rejected = notion_database_create_http_error(
            reqwest::StatusCode::BAD_REQUEST,
            Some(serde_json::json!({ "message": "invalid parent" })),
        );
        assert!(!rejected.result_unknown);
        assert!(!rejected.retryable);
        assert_eq!(rejected.code, "notion_database_create_rejected");

        let throttled = notion_database_create_http_error(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some(serde_json::json!({ "message": "rate limited" })),
        );
        assert!(!throttled.result_unknown);
        assert!(throttled.retryable);

        let server_error = notion_database_create_http_error(
            reqwest::StatusCode::BAD_GATEWAY,
            Some(serde_json::json!({ "message": "upstream failed" })),
        );
        assert!(server_error.result_unknown);
        assert!(server_error.retryable);
        assert_eq!(server_error.code, "notion_database_create_result_unknown");
    }

    #[test]
    fn general_request_errors_preserve_unknown_result_semantics() {
        let rejected = notion_request_error_from_parts(
            reqwest::StatusCode::BAD_REQUEST,
            Ok(serde_json::json!({
                "code": "validation_error",
                "message": "invalid configuration"
            })),
        )
        .unwrap_err();
        assert!(!rejected.result_unknown());
        assert!(rejected.to_string().contains("HTTP 400"));
        assert!(rejected.to_string().contains("validation_error"));

        let server_error = notion_request_error_from_parts(
            reqwest::StatusCode::BAD_GATEWAY,
            Ok(serde_json::json!({ "message": "upstream failed" })),
        )
        .unwrap_err();
        assert!(server_error.result_unknown());
        assert!(server_error.to_string().contains("HTTP 502"));

        let invalid_success = notion_request_error_from_parts(
            reqwest::StatusCode::OK,
            Err("unexpected end of JSON".to_string()),
        )
        .unwrap_err();
        assert!(invalid_success.result_unknown());
    }

    #[test]
    fn standard_database_payload_includes_files_cover_property() {
        let payload = reading_database_payload("parent-page-id", "阅读成果库");

        assert_eq!(
            payload["properties"]["封面"],
            serde_json::json!({ "files": {} })
        );
    }

    #[test]
    fn database_analysis_suggests_cover_files_mapping() {
        let analysis = analyze_database_value(
            "database-id",
            &serde_json::json!({
                "id": "database-id",
                "title": [{ "plain_text": "阅读成果库" }],
                "properties": {
                    "名称": { "id": "title-id", "type": "title", "title": {} },
                    "封面": { "id": "cover-id", "type": "files", "files": {} }
                }
            }),
        );

        assert!(analysis.suggested_mappings.iter().any(|mapping| {
            mapping.logical_field == "cover"
                && mapping.property_id == "cover-id"
                && mapping.property_type == "files"
                && mapping.enabled
        }));
    }

    #[test]
    fn page_create_payload_never_embeds_cover_mutations() {
        let mut document = test_book_document(None);
        document.cover = Some(ExportAsset {
            kind: ExportAssetKind::Cover,
            remote_url: Some("https://example.com/cover.jpg".to_string()),
            local_path: None,
            file_name: None,
            mime_type: None,
        });
        let mut properties = test_template_schema_properties();
        properties.insert(
            "封面".to_string(),
            serde_json::json!({ "type": "files", "files": {} }),
        );
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties,
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert!(payload.get("cover").is_none());
        assert!(payload["properties"].get("封面").is_none());
    }

    #[test]
    fn page_cover_and_files_property_are_detected_independently() {
        let page = serde_json::json!({
            "cover": {
                "type": "external",
                "external": { "url": "https://example.com/page-cover.jpg" }
            },
            "properties": {
                "封面": {
                    "type": "files",
                    "files": [{
                        "name": "封面",
                        "type": "external",
                        "external": { "url": "https://example.com/property-cover.jpg" }
                    }]
                }
            }
        });

        assert!(!page_cover_is_empty(&page));
        assert!(!page_files_property_is_empty(&page, "封面"));
        assert!(page_cover_contains_url(
            &page,
            "https://example.com/page-cover.jpg"
        ));
        assert!(!page_cover_contains_url(
            &page,
            "https://example.com/property-cover.jpg"
        ));
        assert!(page_files_property_contains_url(
            &page,
            "封面",
            "https://example.com/property-cover.jpg"
        ));
        assert!(!page_files_property_contains_url(
            &page,
            "封面",
            "https://example.com/page-cover.jpg"
        ));
    }

    #[test]
    fn markdown_headings_map_to_notion_heading_blocks() {
        let blocks = markdown_to_blocks("# 标题\n\n正文\n\n## 小节");
        assert_eq!(blocks[0]["type"], "heading_1");
        assert_eq!(blocks[1]["type"], "paragraph");
        assert_eq!(blocks[2]["type"], "heading_2");
    }

    #[test]
    fn markdown_common_blocks_map_to_notion_blocks() {
        let blocks = markdown_to_blocks(
            "![封面](https://example.com/cover.jpg)\n\n- 作者：测试\n- 导出时间：100\n\n> 基于本地笔记生成。\n\n1. 第一步\n2. 第二步\n\n```json\n{\"ok\": true}\n```",
        );

        assert_eq!(blocks[0]["type"], "image");
        assert_eq!(
            blocks[0]["image"]["external"]["url"],
            "https://example.com/cover.jpg"
        );
        assert_eq!(blocks[0]["image"]["caption"][0]["text"]["content"], "封面");
        assert_eq!(blocks[1]["type"], "bulleted_list_item");
        assert_eq!(
            blocks[1]["bulleted_list_item"]["rich_text"][0]["text"]["content"],
            "作者：测试"
        );
        assert_eq!(blocks[3]["type"], "quote");
        assert_eq!(
            blocks[3]["quote"]["rich_text"][0]["text"]["content"],
            "基于本地笔记生成。"
        );
        assert_eq!(blocks[4]["type"], "numbered_list_item");
        assert_eq!(blocks[6]["type"], "code");
        assert_eq!(blocks[6]["code"]["language"], "json");
        assert_eq!(
            blocks[6]["code"]["rich_text"][0]["text"]["content"],
            "{\"ok\": true}"
        );
    }

    #[test]
    fn markdown_code_language_uses_safe_notion_fallbacks() {
        let blocks = markdown_to_blocks("```unknown-language\nvalue\n```");

        assert_eq!(blocks[0]["type"], "code");
        assert_eq!(blocks[0]["code"]["language"], "plain text");
    }

    #[test]
    fn local_markdown_images_fall_back_to_paragraph() {
        let blocks = markdown_to_blocks("![封面](book.assets/cover.jpg)");

        assert_eq!(blocks[0]["type"], "paragraph");
    }

    #[test]
    fn long_text_is_split_below_notion_limit() {
        let value = "读".repeat(MAX_BLOCK_TEXT_LENGTH + 20);
        let chunks = split_text(&value, MAX_BLOCK_TEXT_LENGTH);
        assert_eq!(chunks.len(), 2);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.chars().count() <= MAX_BLOCK_TEXT_LENGTH));
    }

    #[test]
    fn page_parent_uses_direct_title_rich_text_array() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "1".to_string(),
            basis_notice: None,
        };
        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "page-id".to_string(),
                parent_type: NotionParentType::Page,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            None,
            None,
        );

        assert!(payload["properties"]["title"].is_array());
    }

    #[test]
    fn database_payload_includes_template_metadata_when_schema_matches() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: Some("作者".to_string()),
            cover: None,
            front_matter: vec![
                meta("bookId", "book-1"),
                meta("promptVersion", "book-review-v3"),
                meta("inputHash", "hash-1"),
                meta("period", "monthly"),
                meta("readingStage", "closing"),
                meta("progress", "72"),
                meta("tagList", "专注,行动"),
                meta("actionCount", "3"),
                meta("candidateCount", "2"),
                meta("highlightCount", "8"),
                meta("thoughtCount", "4"),
                meta("obsidianPath", "C:/vault/wxreadmaster/书籍笔记/测试书籍.md"),
            ],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: test_template_schema_properties(),
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["名称"]["title"][0]["text"]["content"],
            "测试书籍"
        );
        assert_eq!(
            payload["properties"]["作者"]["rich_text"][0]["text"]["content"],
            "作者"
        );
        assert_eq!(
            payload["properties"]["Book ID"]["rich_text"][0]["text"]["content"],
            "book-1"
        );
        assert_eq!(
            payload["properties"]["资产类型"]["select"]["name"],
            "书籍笔记"
        );
        assert_eq!(
            payload["properties"]["来源"]["select"]["name"],
            "wxreadmaster"
        );
        assert_eq!(
            payload["properties"]["导入状态"]["select"]["name"],
            "已导入"
        );
        assert_eq!(
            payload["properties"]["Prompt 版本"]["rich_text"][0]["text"]["content"],
            "book-review-v3"
        );
        assert_eq!(
            payload["properties"]["输入哈希"]["rich_text"][0]["text"]["content"],
            "hash-1"
        );
        assert_eq!(payload["properties"]["周期"]["select"]["name"], "月复盘");
        assert_eq!(
            payload["properties"]["阅读阶段"]["select"]["name"],
            "收束整理"
        );
        assert_eq!(payload["properties"]["进度"]["number"], 72.0);
        assert_eq!(payload["properties"]["行动数"]["number"], 3.0);
        assert_eq!(payload["properties"]["候选书数"]["number"], 2.0);
        assert_eq!(payload["properties"]["划线数"]["number"], 8.0);
        assert_eq!(payload["properties"]["想法数"]["number"], 4.0);
        assert_eq!(
            payload["properties"]["微信读书"]["url"],
            "https://weread.qq.com/web/bookDetail/834428c0c626f6f6b2d31458"
        );
        assert_eq!(
            payload["properties"]["Obsidian 路径"]["rich_text"][0]["text"]["content"],
            "C:/vault/wxreadmaster/书籍笔记/测试书籍.md"
        );
        assert_eq!(
            payload["properties"]["标签"]["multi_select"][0]["name"],
            "专注"
        );
        assert!(payload["properties"]["导出时间"]["date"]["start"]
            .as_str()
            .is_some_and(|value| value.starts_with("1970-01-01T00:01:40")));
    }

    #[test]
    fn database_payload_submits_new_tags_and_stably_deduplicates_values() {
        let mut schema_properties = test_template_schema_properties();
        schema_properties.insert(
            "标签".to_string(),
            serde_json::json!({
                "type": "multi_select",
                "multi_select": {
                    "options": [
                        { "name": "专注" },
                        { "name": "复盘" }
                    ]
                }
            }),
        );
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: schema_properties,
        };
        let mut document = test_book_document(None);
        document.front_matter = vec![meta("tagList", "专注, 行动,专注, ,复盘,行动")];

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: false,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["标签"]["multi_select"],
            serde_json::json!([
                { "name": "专注" },
                { "name": "行动" },
                { "name": "复盘" }
            ])
        );
    }

    #[test]
    fn database_payload_submits_tags_when_multi_select_has_no_options() {
        let mut schema_properties = test_template_schema_properties();
        schema_properties.insert(
            "标签".to_string(),
            serde_json::json!({
                "type": "multi_select",
                "multi_select": { "options": [] }
            }),
        );
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: schema_properties,
        };
        let mut document = test_book_document(None);
        document.front_matter = vec![meta("tagList", "冒烟测试")];

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: false,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["标签"]["multi_select"],
            serde_json::json!([{ "name": "冒烟测试" }])
        );
    }

    #[test]
    fn database_payload_skips_missing_template_properties() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: Some("作者".to_string()),
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let schema = NotionDatabaseSchema {
            title_property: Some("Name".to_string()),
            properties: serde_json::json!({ "Name": { "type": "title", "title": {} } })
                .as_object()
                .expect("schema properties should be an object")
                .clone(),
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("Name"),
            Some(&schema),
        );

        assert!(payload["properties"]["作者"].is_null());
        assert_eq!(
            payload["properties"]["Name"]["title"][0]["text"]["content"],
            "测试书籍"
        );
    }

    #[test]
    fn database_payload_skips_weread_url_without_real_book_id() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::ReadingStatsReview,
            source_id: "monthly-100".to_string(),
            title: "月度复盘".to_string(),
            author: None,
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: test_template_schema_properties(),
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["Book ID"]["rich_text"][0]["text"]["content"],
            "monthly-100"
        );
        assert!(payload["properties"]["微信读书"].is_null());
    }

    #[test]
    fn database_payload_accepts_explicit_weread_url() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookDecision,
            source_id: "scope-1".to_string(),
            title: "选书决策".to_string(),
            author: None,
            cover: None,
            front_matter: vec![meta(
                "wereadUrl",
                "https://weread.qq.com/web/bookDetail/custom",
            )],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: test_template_schema_properties(),
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["微信读书"]["url"],
            "https://weread.qq.com/web/bookDetail/custom"
        );
    }

    #[test]
    fn property_id_mapping_survives_property_rename() {
        let schema = NotionDatabaseSchema {
            title_property: Some("书名（自定义）".to_string()),
            properties: serde_json::json!({
                "书名（自定义）": { "id": "title-id", "type": "title", "title": {} },
                "作者（自定义）": { "id": "author-id", "type": "rich_text", "rich_text": {} },
                "作者": { "id": "legacy-author-id", "type": "rich_text", "rich_text": {} }
            })
            .as_object()
            .expect("schema properties should be an object")
            .clone(),
        };
        let mappings = vec![
            property_mapping("title", "title-id", "名称", "title", true),
            property_mapping("author", "author-id", "作者", "rich_text", true),
        ];
        let document = test_book_document(Some("作者值"));

        assert_eq!(
            mapped_property_name(&schema, &mappings, "author"),
            Some("作者（自定义）".to_string())
        );
        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: mappings,
            },
            Some("书名（自定义）"),
            Some(&schema),
        );

        assert_eq!(
            payload["properties"]["作者（自定义）"]["rich_text"][0]["text"]["content"],
            "作者值"
        );
        assert!(payload["properties"]["作者"].is_null());
    }

    #[test]
    fn configured_mappings_do_not_fall_back_for_unmapped_fields() {
        let mut properties = test_template_schema_properties();
        properties
            .get_mut("名称")
            .and_then(serde_json::Value::as_object_mut)
            .expect("title property should be an object")
            .insert("id".to_string(), serde_json::json!("title-id"));
        properties
            .get_mut("作者")
            .and_then(serde_json::Value::as_object_mut)
            .expect("author property should be an object")
            .insert("id".to_string(), serde_json::json!("author-id"));
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties,
        };
        let mappings = vec![property_mapping("title", "title-id", "名称", "title", true)];
        let document = test_book_document(Some("不应导出的作者"));

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: mappings,
            },
            Some("名称"),
            Some(&schema),
        );

        assert!(payload["properties"]["作者"].is_null());
        assert!(payload["properties"]["Book ID"].is_null());
        assert_eq!(
            payload["properties"]["名称"]["title"][0]["text"]["content"],
            "测试书籍"
        );
    }

    #[test]
    fn disabled_mapping_is_treated_as_do_not_export() {
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: serde_json::json!({
                "名称": { "id": "title-id", "type": "title", "title": {} },
                "作者": { "id": "author-id", "type": "rich_text", "rich_text": {} }
            })
            .as_object()
            .expect("schema properties should be an object")
            .clone(),
        };
        let mappings = vec![
            property_mapping("title", "title-id", "名称", "title", true),
            property_mapping("author", "author-id", "作者", "rich_text", false),
        ];
        let document = test_book_document(Some("不应导出的作者"));

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: mappings,
            },
            Some("名称"),
            Some(&schema),
        );

        assert!(payload["properties"]["作者"].is_null());
    }

    #[test]
    fn optional_mapping_type_change_is_skipped_with_warning() {
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: serde_json::json!({
                "名称": { "id": "title-id", "type": "title", "title": {} },
                "作者": { "id": "author-id", "type": "number", "number": {} }
            })
            .as_object()
            .expect("schema properties should be an object")
            .clone(),
        };
        let mappings = vec![
            property_mapping("title", "title-id", "名称", "title", true),
            property_mapping("author", "author-id", "作者", "rich_text", true),
        ];

        assert_eq!(mapped_property_name(&schema, &mappings, "author"), None);
        let warning = property_mapping_warning(&schema, &mappings)
            .expect("type change should return a warning");
        assert!(warning.contains("作者"));
        assert!(warning.contains("已删除或类型发生变化"));
    }

    #[test]
    fn optional_mapping_deletion_is_skipped_with_warning() {
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: serde_json::json!({
                "名称": { "id": "title-id", "type": "title", "title": {} }
            })
            .as_object()
            .expect("schema properties should be an object")
            .clone(),
        };
        let mappings = vec![
            property_mapping("title", "title-id", "名称", "title", true),
            property_mapping("tags", "tags-id", "标签", "multi_select", true),
        ];

        let warning = property_mapping_warning(&schema, &mappings)
            .expect("deleted mapping should return a warning");
        assert!(warning.contains("标签"));
    }

    #[test]
    fn title_mapping_type_change_cannot_resolve_title_property() {
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties: serde_json::json!({
                "名称": { "id": "title-id", "type": "rich_text", "rich_text": {} }
            })
            .as_object()
            .expect("schema properties should be an object")
            .clone(),
        };
        let mappings = vec![property_mapping("title", "title-id", "名称", "title", true)];

        assert_eq!(mapped_property_name(&schema, &mappings, "title"), None);
    }

    #[test]
    fn database_analysis_classifies_compatibility_and_suggests_mappings() {
        let full = analyze_database_value(
            "fallback-id",
            &serde_json::json!({
                "id": "database-id",
                "url": "https://www.notion.so/database-id",
                "title": [{ "plain_text": "自定义成果库" }],
                "properties": {
                    "Name": { "id": "title-id", "type": "title", "title": {} },
                    "Author": { "id": "author-id", "type": "rich_text", "rich_text": {} },
                    "Book ID": { "id": "book-id", "type": "rich_text", "rich_text": {} },
                    "Progress": { "id": "progress-id", "type": "number", "number": {} },
                    "Tags": { "id": "tags-id", "type": "multi_select", "multi_select": {} }
                }
            }),
        );
        assert_eq!(full.compatibility, "full");
        assert_eq!(full.database_name.as_deref(), Some("自定义成果库"));
        assert!(full
            .suggested_mappings
            .iter()
            .any(|mapping| mapping.logical_field == "title" && mapping.property_id == "title-id"));

        let invalid = analyze_database_value(
            "database-id",
            &serde_json::json!({
                "properties": {
                    "作者": { "id": "author-id", "type": "rich_text", "rich_text": {} }
                }
            }),
        );
        assert_eq!(invalid.compatibility, "invalid");
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.code == "missing_title_property"));
    }

    #[test]
    fn schema_fingerprint_ignores_property_names_and_input_order() {
        let before = vec![
            NotionPropertySummary {
                id: "author-id".to_string(),
                name: "作者".to_string(),
                property_type: "rich_text".to_string(),
            },
            NotionPropertySummary {
                id: "title-id".to_string(),
                name: "名称".to_string(),
                property_type: "title".to_string(),
            },
        ];
        let after_rename_and_reorder = vec![
            NotionPropertySummary {
                id: "title-id".to_string(),
                name: "书名".to_string(),
                property_type: "title".to_string(),
            },
            NotionPropertySummary {
                id: "author-id".to_string(),
                name: "创作者".to_string(),
                property_type: "rich_text".to_string(),
            },
        ];

        assert_eq!(
            schema_fingerprint(&before),
            schema_fingerprint(&after_rename_and_reorder)
        );
    }

    #[test]
    fn unix_exported_at_maps_to_notion_date() {
        let value = exported_at_to_notion_date("100").expect("timestamp should map");

        assert!(value.starts_with("1970-01-01T00:01:40"));
    }

    #[test]
    fn workspace_homepage_payload_contains_cover_navigation_and_title() {
        let payload = workspace_homepage_payload("parent-page", true);
        let children = payload["children"]
            .as_array()
            .expect("children should be an array");

        assert_eq!(payload["parent"]["page_id"], "parent-page");
        assert_eq!(payload["icon"]["emoji"], "📚");
        assert_eq!(
            payload["properties"]["title"][0]["text"]["content"],
            "微信读书知识库"
        );
        assert_eq!(payload["cover"]["type"], "external");
        assert!(children
            .iter()
            .any(|block| block["type"] == "callout"
                && block["callout"]["color"] == "blue_background"));
        assert!(children.iter().any(|block| block["type"] == "quote"));
        assert!(children
            .iter()
            .any(|block| block["heading_2"]["rich_text"][0]["text"]["content"] == "今日驾驶舱"));
        assert!(children
            .iter()
            .any(|block| block["heading_2"]["rich_text"][0]["text"]["content"] == "成果入口"));
    }

    #[test]
    fn workspace_homepage_payload_can_omit_cover() {
        let payload = workspace_homepage_payload("parent-page", false);

        assert!(payload.get("cover").is_none());
    }

    #[test]
    fn workspace_followup_blocks_link_database_url() {
        let blocks = workspace_database_followup_blocks("https://notion.so/database");

        assert!(blocks.iter().any(|block| block["type"] == "bookmark"
            && block["bookmark"]["url"] == "https://notion.so/database"));
        assert!(blocks
            .iter()
            .any(
                |block| block["paragraph"]["rich_text"][0]["text"]["link"]["url"]
                    == "https://notion.so/database"
            ));
        assert!(blocks.iter().any(|block| block["type"] == "toggle"));
        assert!(blocks.iter().any(|block| block["type"] == "to_do"));
    }

    #[test]
    fn reading_database_payload_uses_canonical_title_and_template_schema() {
        let payload = reading_database_payload("home-page", "阅读成果库");

        assert_eq!(payload["parent"]["page_id"], "home-page");
        assert_eq!(payload["title"][0]["text"]["content"], "阅读成果库");
        assert!(payload["properties"]["名称"]["title"].is_object());
        assert!(payload["properties"]["资产类型"]["select"]["options"]
            .as_array()
            .expect("select options should be an array")
            .iter()
            .any(|option| option["name"] == "书籍复盘"));
    }

    #[test]
    fn notion_object_url_falls_back_to_compact_notion_url() {
        let (id, url) = notion_object_id_and_url(
            &serde_json::json!({ "id": "12345678-1234-1234-1234-123456789abc" }),
            "missing id",
        )
        .expect("id should map");

        assert_eq!(id, "12345678-1234-1234-1234-123456789abc");
        assert_eq!(
            url,
            "https://www.notion.so/12345678123412341234123456789abc"
        );
    }

    #[test]
    fn yaml_front_matter_is_not_rendered_into_blocks() {
        let blocks = markdown_to_blocks(
            "---\ndoc_type: wxreadmaster-book-notes\ntitle: \"测试\"\n---\n\n# 标题",
        );

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "heading_1");
    }

    #[test]
    fn obsidian_block_anchors_are_stripped() {
        let blocks = markdown_to_blocks(
            "> 将最重要的事放在最不受打扰的时间。\n\n_划线时间：2026-07-20 12:00:00_ ^b1-28-659-705\n\n^b1-alone",
        );

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "quote");
        assert_eq!(blocks[1]["type"], "paragraph");
        let meta_text = &blocks[1]["paragraph"]["rich_text"][0];
        assert_eq!(
            meta_text["text"]["content"],
            "划线时间：2026-07-20 12:00:00"
        );
        assert_eq!(meta_text["annotations"]["italic"], true);
    }

    #[test]
    fn weread_deep_links_degrade_to_plain_text() {
        let blocks = markdown_to_blocks(
            "> [划线内容](<weread://bestbookmark?bookId=b1&chapterUid=28&rangeStart=659&rangeEnd=705>)",
        );

        let rich_text = &blocks[0]["quote"]["rich_text"];
        assert_eq!(rich_text[0]["text"]["content"], "划线内容");
        assert!(rich_text[0]["text"].get("link").is_none());
    }

    #[test]
    fn https_inline_links_become_notion_links() {
        let blocks = markdown_to_blocks("- 原文：[摘录](https://example.com/a)");

        let rich_text = &blocks[0]["bulleted_list_item"]["rich_text"];
        assert_eq!(rich_text[0]["text"]["content"], "原文：");
        assert_eq!(rich_text[1]["text"]["content"], "摘录");
        assert_eq!(rich_text[1]["text"]["link"]["url"], "https://example.com/a");
    }

    #[test]
    fn inline_bold_and_code_become_annotations() {
        let blocks = markdown_to_blocks("**重点**说明 `代码`");

        let rich_text = &blocks[0]["paragraph"]["rich_text"];
        assert_eq!(rich_text[0]["text"]["content"], "重点");
        assert_eq!(rich_text[0]["annotations"]["bold"], true);
        assert_eq!(rich_text[1]["text"]["content"], "说明 ");
        assert!(rich_text[1].get("annotations").is_none());
        assert_eq!(rich_text[2]["text"]["content"], "代码");
        assert_eq!(rich_text[2]["annotations"]["code"], true);
    }

    #[test]
    fn deep_headings_and_rules_map_to_supported_blocks() {
        let blocks = markdown_to_blocks("#### 小节\n\n---\n\n正文");

        assert_eq!(blocks[0]["type"], "heading_3");
        assert_eq!(blocks[1]["type"], "divider");
        assert_eq!(blocks[2]["type"], "paragraph");
    }

    #[test]
    fn long_inline_content_still_splits_below_notion_limit() {
        let value = "读".repeat(MAX_BLOCK_TEXT_LENGTH + 20);
        let blocks = markdown_to_blocks(&value);

        assert_eq!(blocks.len(), 2);
        assert!(blocks.iter().all(|block| {
            block["paragraph"]["rich_text"]
                .as_array()
                .expect("rich_text should be an array")
                .iter()
                .all(|item| {
                    item["text"]["content"]
                        .as_str()
                        .is_some_and(|content| content.chars().count() <= MAX_BLOCK_TEXT_LENGTH)
                })
        }));
    }

    #[test]
    fn progress_is_scaled_for_percent_formatted_property() {
        let document = ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: None,
            cover: None,
            front_matter: vec![meta("progress", "72")],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        };
        let mut properties = test_template_schema_properties();
        properties.insert(
            "进度".to_string(),
            serde_json::json!({ "type": "number", "number": { "format": "percent" } }),
        );
        let schema = NotionDatabaseSchema {
            title_property: Some("名称".to_string()),
            properties,
        };

        let payload = create_page_payload(
            &document,
            &NotionExportOptions {
                token: "secret".to_string(),
                parent_id: "database-id".to_string(),
                parent_type: NotionParentType::Database,
                use_page_cover: true,
                property_mappings: Vec::new(),
            },
            Some("名称"),
            Some(&schema),
        );

        assert_eq!(payload["properties"]["进度"]["number"], 0.72);
    }

    #[test]
    fn cover_error_classification_only_matches_cover_messages() {
        assert!(is_cover_related_error(
            "Notion API 请求失败：body failed validation: body.cover.external.url should be a valid url."
        ));
        assert!(!is_cover_related_error(
            "Notion API 请求过于频繁：rate limited"
        ));
        assert!(!is_cover_related_error(
            "Notion Token 无效或已失效：API token is invalid."
        ));
    }

    fn test_book_document(author: Option<&str>) -> ExportDocument {
        ExportDocument {
            source_kind: ExportSourceKind::BookNotes,
            source_id: "book-1".to_string(),
            title: "测试书籍".to_string(),
            author: author.map(str::to_string),
            cover: None,
            front_matter: vec![],
            sections: vec![],
            exported_at: "100".to_string(),
            basis_notice: None,
        }
    }

    fn property_mapping(
        logical_field: &str,
        property_id: &str,
        property_name_snapshot: &str,
        property_type: &str,
        enabled: bool,
    ) -> NotionPropertyMapping {
        NotionPropertyMapping {
            logical_field: logical_field.to_string(),
            property_id: property_id.to_string(),
            property_name_snapshot: property_name_snapshot.to_string(),
            property_type: property_type.to_string(),
            enabled,
        }
    }

    fn test_template_schema_properties() -> serde_json::Map<String, serde_json::Value> {
        serde_json::json!({
            "名称": { "type": "title", "title": {} },
            "作者": { "type": "rich_text", "rich_text": {} },
            "Book ID": { "type": "rich_text", "rich_text": {} },
            "资产类型": { "type": "select", "select": {} },
            "来源": { "type": "select", "select": {} },
            "导出时间": { "type": "date", "date": {} },
            "导入状态": { "type": "select", "select": {} },
            "Prompt 版本": { "type": "rich_text", "rich_text": {} },
            "输入哈希": { "type": "rich_text", "rich_text": {} },
            "周期": { "type": "select", "select": {} },
            "阅读阶段": { "type": "select", "select": {} },
            "进度": { "type": "number", "number": {} },
            "标签": { "type": "multi_select", "multi_select": { "options": [
                { "name": "专注" },
                { "name": "行动" }
            ] } },
            "微信读书": { "type": "url", "url": {} },
            "Obsidian 路径": { "type": "rich_text", "rich_text": {} },
            "行动数": { "type": "number", "number": {} },
            "候选书数": { "type": "number", "number": {} },
            "划线数": { "type": "number", "number": {} },
            "想法数": { "type": "number", "number": {} }
        })
        .as_object()
        .expect("schema properties should be an object")
        .clone()
    }

    fn meta(key: &str, value: &str) -> crate::export::document::ExportMetaField {
        crate::export::document::ExportMetaField {
            key: key.to_string(),
            value: value.to_string(),
        }
    }
}
