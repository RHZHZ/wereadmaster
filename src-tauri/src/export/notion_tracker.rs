//! Books Tracker 模板深度接入（P0：Books Tracker by VPM 专用适配器）。
//!
//! 分析阶段只读：发现模板首页下的子数据库、识别 Book Library 候选、
//! 生成字段映射预览与将要执行的外部变更清单。连接阶段在用户确认后
//! 才写入 Notion：补 `wxreadmaster Book ID` 属性、创建或复用
//! `阅读成果库`、新增 `关联书籍` Relation，并把映射按 Notion
//! property id 保存到独立配置文件（用户改字段显示名不破坏接入）。
//! 模板原有书库、公式、视图一律不改动。

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::db;

use super::notion::{
    create_reading_database, notion_client, notion_request, send_notion_request,
    NotionExportOptions,
};
use super::targets::NotionParentType;

const TRACKER_CONFIG_FILE: &str = "notion-tracker.json";
const BOOK_ID_PROPERTY_NAME: &str = "wxreadmaster Book ID";
const RELATION_PROPERTY_NAME: &str = "关联书籍";
const OUTCOMES_DATABASE_TITLE: &str = "阅读成果库";
const EXCLUDED_LIBRARY_TITLES: [&str; 1] = ["database [do not remove this]"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerPropertyRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatusMapping {
    pub to_read: Option<String>,
    pub reading: Option<String>,
    pub completed: Option<String>,
    pub archived: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatusPreview {
    pub property: TrackerPropertyRef,
    pub kind: String,
    pub options: Vec<String>,
    pub mapping: TrackerStatusMapping,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerFieldMappingPreview {
    pub title_property: Option<TrackerPropertyRef>,
    pub author_property: Option<TrackerPropertyRef>,
    pub status: Option<TrackerStatusPreview>,
    pub progress_property: Option<TrackerPropertyRef>,
    pub cover_property: Option<TrackerPropertyRef>,
    pub book_id_property: Option<TrackerPropertyRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerDatabaseSummary {
    pub database_id: String,
    pub title: String,
    pub url: Option<String>,
    pub is_book_library_candidate: bool,
    pub is_outcomes_database: bool,
    pub has_book_id_property: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerTemplateAnalysis {
    pub parent_page_id: String,
    pub databases: Vec<TrackerDatabaseSummary>,
    pub selected_book_library_id: Option<String>,
    pub field_mapping: Option<TrackerFieldMappingPreview>,
    pub existing_outcomes_database_id: Option<String>,
    pub planned_changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionTrackerConfig {
    pub parent_page_id: String,
    pub book_library_id: String,
    pub title_property: TrackerPropertyRef,
    pub book_id_property: TrackerPropertyRef,
    pub author_property: Option<TrackerPropertyRef>,
    pub status_property: Option<TrackerPropertyRef>,
    pub status_kind: Option<String>,
    #[serde(default)]
    pub status_mapping: TrackerStatusMapping,
    pub progress_property: Option<TrackerPropertyRef>,
    pub cover_property: Option<TrackerPropertyRef>,
    pub outcomes_database_id: String,
    pub relation_property: Option<TrackerPropertyRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectNotionTrackerResult {
    pub config: NotionTrackerConfig,
    pub book_library_url: Option<String>,
    pub outcomes_database_url: Option<String>,
    pub created_outcomes_database: bool,
    pub added_book_id_property: bool,
    pub added_relation_property: bool,
}

/// 只读分析模板首页：发现子数据库并生成候选与变更预览，不产生任何写入。
pub async fn analyze_tracker_template(
    token: &str,
    parent_page_id: &str,
) -> Result<TrackerTemplateAnalysis, String> {
    let options = page_options(token, parent_page_id);
    let client = notion_client()?;
    let child_databases = list_child_databases(&client, &options, parent_page_id).await?;
    if child_databases.is_empty() {
        return Err(
            "该页面下没有发现任何数据库。请确认粘贴的是模板首页链接，且页面已共享给 Integration。"
                .to_string(),
        );
    }

    let mut databases = Vec::new();
    let mut facts_by_id = Vec::new();
    let mut existing_outcomes_database_id = None;
    for database_id in child_databases {
        let database = send_notion_request(notion_request(
            &client,
            &options,
            reqwest::Method::GET,
            &format!("/databases/{database_id}"),
        ))
        .await?;
        let title = database_title(&database);
        let properties = database
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let facts = analyze_database_schema(&title, &properties);
        if facts.is_outcomes_database && existing_outcomes_database_id.is_none() {
            existing_outcomes_database_id = Some(database_id.clone());
        }
        databases.push(TrackerDatabaseSummary {
            database_id: database_id.clone(),
            title,
            url: database
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string),
            is_book_library_candidate: facts.is_book_library_candidate,
            is_outcomes_database: facts.is_outcomes_database,
            has_book_id_property: facts.book_id_property.is_some(),
        });
        facts_by_id.push((database_id, facts));
    }

    let candidate_ids = databases
        .iter()
        .filter(|database| database.is_book_library_candidate)
        .map(|database| database.database_id.clone())
        .collect::<Vec<_>>();
    let selected_book_library_id = if candidate_ids.len() == 1 {
        Some(candidate_ids[0].clone())
    } else {
        None
    };
    let field_mapping = selected_book_library_id.as_deref().and_then(|selected| {
        facts_by_id
            .iter()
            .find(|(database_id, _)| database_id == selected)
            .map(|(_, facts)| facts.to_mapping_preview())
    });

    let planned_changes = planned_changes(
        selected_book_library_id.is_some(),
        field_mapping
            .as_ref()
            .map(|mapping| mapping.book_id_property.is_some())
            .unwrap_or(false),
        existing_outcomes_database_id.is_some(),
    );

    Ok(TrackerTemplateAnalysis {
        parent_page_id: parent_page_id.to_string(),
        databases,
        selected_book_library_id,
        field_mapping,
        existing_outcomes_database_id,
        planned_changes,
    })
}

/// 用户确认后执行连接：只做清单中声明的三类写入，并保存映射配置。
pub async fn connect_tracker_template(
    app: &AppHandle,
    token: &str,
    parent_page_id: &str,
    book_library_id: &str,
) -> Result<ConnectNotionTrackerResult, String> {
    let options = page_options(token, parent_page_id);
    let client = notion_client()?;

    let library = send_notion_request(notion_request(
        &client,
        &options,
        reqwest::Method::GET,
        &format!("/databases/{book_library_id}"),
    ))
    .await?;
    let library_title = database_title(&library);
    let library_url = library
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string);
    let properties = library
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let facts = analyze_database_schema(&library_title, &properties);
    let title_property = facts
        .title_property
        .clone()
        .ok_or_else(|| "所选书库缺少标题属性，无法作为 Book Library 接入。".to_string())?;

    let mut added_book_id_property = false;
    let book_id_property = match facts.book_id_property.clone() {
        Some(property) => property,
        None => {
            let updated = send_notion_request(
                notion_request(
                    &client,
                    &options,
                    reqwest::Method::PATCH,
                    &format!("/databases/{book_library_id}"),
                )
                .json(&json!({
                    "properties": { BOOK_ID_PROPERTY_NAME: { "rich_text": {} } }
                })),
            )
            .await?;
            added_book_id_property = true;
            property_ref_by_name(&updated, BOOK_ID_PROPERTY_NAME)
                .ok_or_else(|| "已在书库新增 Book ID 属性，但响应中未找到该属性。".to_string())?
        }
    };

    // 串行探测已有成果库，找到第一个即停（模板首页数据库数量很小）。
    let sibling_ids = list_child_databases(&client, &options, parent_page_id)
        .await?
        .into_iter()
        .filter(|database_id| database_id.as_str() != book_library_id)
        .collect::<Vec<_>>();
    let mut outcomes_database: Option<(String, Value)> = None;
    for database_id in sibling_ids {
        let database = send_notion_request(notion_request(
            &client,
            &options,
            reqwest::Method::GET,
            &format!("/databases/{database_id}"),
        ))
        .await?;
        let title = database_title(&database);
        let properties = database
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if analyze_database_schema(&title, &properties).is_outcomes_database {
            outcomes_database = Some((database_id, database));
            break;
        }
    }

    let mut created_outcomes_database = false;
    let (outcomes_database_id, outcomes_value) = match outcomes_database {
        Some(found) => found,
        None => {
            let created =
                create_reading_database(&client, &options, OUTCOMES_DATABASE_TITLE).await?;
            created_outcomes_database = true;
            let database_id = created
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "阅读成果库创建成功，但响应缺少数据库 ID。".to_string())?
                .to_string();
            (database_id, created)
        }
    };
    let outcomes_url = outcomes_value
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string);

    let mut added_relation_property = false;
    let relation_property =
        match property_ref_of_type(&outcomes_value, RELATION_PROPERTY_NAME, "relation") {
            Some(property) => Some(property),
            None => {
                let updated = send_notion_request(
                    notion_request(
                        &client,
                        &options,
                        reqwest::Method::PATCH,
                        &format!("/databases/{outcomes_database_id}"),
                    )
                    .json(&json!({
                        "properties": {
                            RELATION_PROPERTY_NAME: {
                                "relation": {
                                    "database_id": book_library_id,
                                    "single_property": {}
                                }
                            }
                        }
                    })),
                )
                .await?;
                added_relation_property = true;
                property_ref_by_name(&updated, RELATION_PROPERTY_NAME)
            }
        };

    let config = NotionTrackerConfig {
        parent_page_id: parent_page_id.to_string(),
        book_library_id: book_library_id.to_string(),
        title_property,
        book_id_property,
        author_property: facts.author_property.clone(),
        status_property: facts
            .status_preview
            .as_ref()
            .map(|status| status.property.clone()),
        status_kind: facts
            .status_preview
            .as_ref()
            .map(|status| status.kind.clone()),
        status_mapping: facts
            .status_preview
            .as_ref()
            .map(|status| status.mapping.clone())
            .unwrap_or_default(),
        progress_property: facts.progress_property.clone(),
        cover_property: facts.cover_property.clone(),
        outcomes_database_id: outcomes_database_id.clone(),
        relation_property,
    };
    save_tracker_config(app, &config)?;

    // 连接成功后，把默认 Notion 导出目标切换到阅读成果库；封面策略保持用户设置。
    let config_dir = db::default_data_dir(app)?;
    let mut integration = db::read_integration_config(&config_dir)?;
    integration.notion_parent_id = Some(outcomes_database_id.clone());
    integration.notion_parent_type = Some(NotionParentType::Database.as_config_value().to_string());
    db::write_integration_config(&config_dir, &integration)?;

    Ok(ConnectNotionTrackerResult {
        config,
        book_library_url: library_url,
        outcomes_database_url: outcomes_url,
        created_outcomes_database,
        added_book_id_property,
        added_relation_property,
    })
}

pub fn load_tracker_config(app: &AppHandle) -> Result<Option<NotionTrackerConfig>, String> {
    let path = tracker_config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str::<NotionTrackerConfig>(&raw)
        .map(Some)
        .map_err(|error| format!("Books Tracker 配置解析失败：{error}"))
}

pub fn save_tracker_config(app: &AppHandle, config: &NotionTrackerConfig) -> Result<(), String> {
    let path = tracker_config_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(&path, raw).map_err(|error| error.to_string())
}

fn tracker_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(db::default_data_dir(app)?.join(TRACKER_CONFIG_FILE))
}

fn page_options(token: &str, parent_page_id: &str) -> NotionExportOptions {
    NotionExportOptions {
        token: token.to_string(),
        parent_id: parent_page_id.to_string(),
        parent_type: NotionParentType::Page,
        use_page_cover: false,
        property_mappings: Vec::new(),
    }
}

/// 分页列出页面下的子数据库块（child_database 的块 ID 即数据库 ID）。
async fn list_child_databases(
    client: &reqwest::Client,
    options: &NotionExportOptions,
    page_id: &str,
) -> Result<Vec<String>, String> {
    let mut database_ids = Vec::new();
    let mut start_cursor: Option<String> = None;
    loop {
        let mut path = format!("/blocks/{page_id}/children?page_size=100");
        if let Some(cursor) = start_cursor.as_deref() {
            path.push_str(&format!("&start_cursor={cursor}"));
        }
        let response =
            send_notion_request(notion_request(client, options, reqwest::Method::GET, &path))
                .await?;
        for block in response
            .get("results")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            if block.get("type").and_then(Value::as_str) == Some("child_database") {
                if let Some(block_id) = block.get("id").and_then(Value::as_str) {
                    database_ids.push(block_id.to_string());
                }
            }
        }
        let has_more = response
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        start_cursor = response
            .get("next_cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if !has_more || start_cursor.is_none() {
            break;
        }
    }
    Ok(database_ids)
}

fn database_title(database: &Value) -> String {
    database
        .get("title")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("plain_text").and_then(Value::as_str))
                .collect::<String>()
        })
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| "未命名数据库".to_string())
}

#[derive(Debug, Clone, Default)]
struct DatabaseSchemaFacts {
    title_property: Option<TrackerPropertyRef>,
    author_property: Option<TrackerPropertyRef>,
    status_preview: Option<TrackerStatusPreview>,
    progress_property: Option<TrackerPropertyRef>,
    cover_property: Option<TrackerPropertyRef>,
    book_id_property: Option<TrackerPropertyRef>,
    is_outcomes_database: bool,
    is_book_library_candidate: bool,
}

impl DatabaseSchemaFacts {
    fn to_mapping_preview(&self) -> TrackerFieldMappingPreview {
        TrackerFieldMappingPreview {
            title_property: self.title_property.clone(),
            author_property: self.author_property.clone(),
            status: self.status_preview.clone(),
            progress_property: self.progress_property.clone(),
            cover_property: self.cover_property.clone(),
            book_id_property: self.book_id_property.clone(),
        }
    }
}

/// 纯函数：从数据库标题与属性表推断字段映射与候选性。
fn analyze_database_schema(title: &str, properties: &Map<String, Value>) -> DatabaseSchemaFacts {
    let mut facts = DatabaseSchemaFacts::default();
    let mut has_asset_type_property = false;
    let mut has_export_time_property = false;

    for (name, value) in properties {
        let Some(kind) = value.get("type").and_then(Value::as_str) else {
            continue;
        };
        let property_ref = TrackerPropertyRef {
            id: value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: name.clone(),
        };
        let lowered = name.trim().to_lowercase();
        match kind {
            "title" => facts.title_property = Some(property_ref),
            "rich_text" => {
                if name == BOOK_ID_PROPERTY_NAME {
                    facts.book_id_property = Some(property_ref);
                } else if facts.author_property.is_none()
                    && matches!(lowered.as_str(), "author" | "authors" | "作者")
                {
                    facts.author_property = Some(property_ref);
                }
            }
            "select" | "status" => {
                if lowered == "资产类型" {
                    has_asset_type_property = true;
                }
                if facts.status_preview.is_none()
                    && matches!(
                        lowered.as_str(),
                        "status" | "reading status" | "状态" | "阅读状态"
                    )
                {
                    let options = property_options(value, kind);
                    facts.status_preview = Some(TrackerStatusPreview {
                        property: property_ref,
                        kind: kind.to_string(),
                        mapping: suggest_status_mapping(&options),
                        options,
                    });
                }
            }
            "number" => {
                if facts.progress_property.is_none()
                    && matches!(lowered.as_str(), "progress" | "进度" | "阅读进度")
                {
                    facts.progress_property = Some(property_ref);
                }
            }
            "files" => {
                if facts.cover_property.is_none()
                    && matches!(lowered.as_str(), "cover" | "covers" | "封面")
                {
                    facts.cover_property = Some(property_ref);
                }
            }
            "date" => {
                if lowered == "导出时间" {
                    has_export_time_property = true;
                }
            }
            _ => {}
        }
    }

    facts.is_outcomes_database = title.trim() == OUTCOMES_DATABASE_TITLE
        || (has_asset_type_property && has_export_time_property);
    facts.is_book_library_candidate = !facts.is_outcomes_database
        && facts.title_property.is_some()
        && !EXCLUDED_LIBRARY_TITLES.contains(&title.trim().to_lowercase().as_str())
        && (library_name_hint(title)
            || facts.author_property.is_some()
            || facts.status_preview.is_some());
    facts
}

fn library_name_hint(title: &str) -> bool {
    let lowered = title.trim().to_lowercase();
    ["book", "library", "shelf", "tracker", "书", "藏书", "书架"]
        .iter()
        .any(|hint| lowered.contains(hint))
}

fn property_options(value: &Value, kind: &str) -> Vec<String> {
    value
        .get(kind)
        .and_then(|inner| inner.get("options"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|option| option.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

/// 只在选项名可安全识别时建议映射；识别不了的槽位保持 None（导出时不写状态）。
fn suggest_status_mapping(options: &[String]) -> TrackerStatusMapping {
    let mut mapping = TrackerStatusMapping::default();
    for option in options {
        let lowered = option.trim().to_lowercase();
        let slot = if matches!(
            lowered.as_str(),
            "to read" | "want to read" | "待读" | "想读" | "计划阅读"
        ) {
            &mut mapping.to_read
        } else if matches!(
            lowered.as_str(),
            "reading" | "in progress" | "在读" | "阅读中"
        ) {
            &mut mapping.reading
        } else if matches!(
            lowered.as_str(),
            "completed" | "finished" | "done" | "已读" | "读完" | "完成"
        ) {
            &mut mapping.completed
        } else if matches!(
            lowered.as_str(),
            "archived" | "abandoned" | "已归档" | "归档" | "弃读"
        ) {
            &mut mapping.archived
        } else {
            continue;
        };
        if slot.is_none() {
            *slot = Some(option.clone());
        }
    }
    mapping
}

fn planned_changes(
    has_selected_library: bool,
    library_has_book_id: bool,
    has_existing_outcomes: bool,
) -> Vec<String> {
    let mut changes = Vec::new();
    if has_selected_library && !library_has_book_id {
        changes.push(format!(
            "在书库中新增「{BOOK_ID_PROPERTY_NAME}」属性（幂等写入键）。"
        ));
    }
    if has_existing_outcomes {
        changes.push("复用模板中已有的「阅读成果库」。".to_string());
    } else {
        changes.push("在模板首页下创建「阅读成果库」。".to_string());
    }
    changes.push(format!(
        "在阅读成果库中新增「{RELATION_PROPERTY_NAME}」Relation（若缺失），指向所选书库。"
    ));
    changes.push(
        "后续导出会在书库创建或更新书卡；模板原有书籍、评分、分类、公式与视图不会删除或改写。"
            .to_string(),
    );
    changes
}

fn property_ref_by_name(database: &Value, name: &str) -> Option<TrackerPropertyRef> {
    database
        .get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| properties.get(name))
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .map(|id| TrackerPropertyRef {
            id: id.to_string(),
            name: name.to_string(),
        })
}

fn property_ref_of_type(
    database: &Value,
    name: &str,
    expected: &str,
) -> Option<TrackerPropertyRef> {
    let properties = database.get("properties").and_then(Value::as_object)?;
    let value = properties.get(name)?;
    if value.get("type").and_then(Value::as_str) != Some(expected) {
        return None;
    }
    value
        .get("id")
        .and_then(Value::as_str)
        .map(|id| TrackerPropertyRef {
            id: id.to_string(),
            name: name.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::{
        analyze_database_schema, planned_changes, suggest_status_mapping, NotionTrackerConfig,
        TrackerPropertyRef, TrackerStatusMapping,
    };

    fn properties(value: Value) -> Map<String, Value> {
        value.as_object().expect("properties object").clone()
    }

    #[test]
    fn book_library_schema_is_detected_with_field_mapping() {
        let facts = analyze_database_schema(
            "Book Library",
            &properties(json!({
                "Name": { "id": "title", "type": "title", "title": {} },
                "Author": { "id": "auth", "type": "rich_text", "rich_text": {} },
                "Status": {
                    "id": "stat",
                    "type": "select",
                    "select": { "options": [
                        { "name": "To read" },
                        { "name": "Reading" },
                        { "name": "Completed" }
                    ] }
                },
                "Progress": { "id": "prog", "type": "number", "number": {} },
                "Cover": { "id": "cov", "type": "files", "files": {} }
            })),
        );

        assert!(facts.is_book_library_candidate);
        assert!(!facts.is_outcomes_database);
        assert_eq!(
            facts.title_property.as_ref().map(|p| p.name.as_str()),
            Some("Name")
        );
        assert_eq!(
            facts.author_property.as_ref().map(|p| p.id.as_str()),
            Some("auth")
        );
        let status = facts.status_preview.expect("status preview");
        assert_eq!(status.kind, "select");
        assert_eq!(status.mapping.to_read.as_deref(), Some("To read"));
        assert_eq!(status.mapping.reading.as_deref(), Some("Reading"));
        assert_eq!(status.mapping.completed.as_deref(), Some("Completed"));
        assert_eq!(status.mapping.archived, None);
        assert_eq!(
            facts.progress_property.as_ref().map(|p| p.name.as_str()),
            Some("Progress")
        );
        assert_eq!(
            facts.cover_property.as_ref().map(|p| p.name.as_str()),
            Some("Cover")
        );
        assert!(facts.book_id_property.is_none());
    }

    #[test]
    fn outcomes_database_is_not_a_library_candidate() {
        let facts = analyze_database_schema(
            "阅读成果库",
            &properties(json!({
                "名称": { "id": "title", "type": "title", "title": {} },
                "资产类型": { "id": "kind", "type": "select", "select": { "options": [] } },
                "导出时间": { "id": "time", "type": "date", "date": {} }
            })),
        );

        assert!(facts.is_outcomes_database);
        assert!(!facts.is_book_library_candidate);

        let renamed = analyze_database_schema(
            "我的成果表",
            &properties(json!({
                "名称": { "id": "title", "type": "title", "title": {} },
                "资产类型": { "id": "kind", "type": "select", "select": { "options": [] } },
                "导出时间": { "id": "time", "type": "date", "date": {} }
            })),
        );
        assert!(renamed.is_outcomes_database);
    }

    #[test]
    fn do_not_remove_database_is_excluded() {
        let facts = analyze_database_schema(
            "Database [Do Not Remove This]",
            &properties(json!({
                "Name": { "id": "title", "type": "title", "title": {} },
                "Author": { "id": "auth", "type": "rich_text", "rich_text": {} }
            })),
        );

        assert!(!facts.is_book_library_candidate);
    }

    #[test]
    fn existing_book_id_property_is_recognized() {
        let facts = analyze_database_schema(
            "Bookshelf",
            &properties(json!({
                "Name": { "id": "title", "type": "title", "title": {} },
                "wxreadmaster Book ID": { "id": "bid", "type": "rich_text", "rich_text": {} }
            })),
        );

        assert_eq!(
            facts.book_id_property.as_ref().map(|p| p.id.as_str()),
            Some("bid")
        );
    }

    #[test]
    fn unknown_status_options_stay_unmapped() {
        let mapping = suggest_status_mapping(&[
            "Someday".to_string(),
            "阅读中".to_string(),
            "弃读".to_string(),
        ]);

        assert_eq!(mapping.to_read, None);
        assert_eq!(mapping.reading.as_deref(), Some("阅读中"));
        assert_eq!(mapping.completed, None);
        assert_eq!(mapping.archived.as_deref(), Some("弃读"));
    }

    #[test]
    fn planned_changes_describe_confirmed_writes_only() {
        let changes = planned_changes(true, false, false);
        assert!(changes
            .iter()
            .any(|change| change.contains("wxreadmaster Book ID")));
        assert!(changes
            .iter()
            .any(|change| change.contains("创建「阅读成果库」")));

        let reuse = planned_changes(true, true, true);
        assert!(reuse.iter().any(|change| change.contains("复用")));
        assert!(!reuse
            .iter()
            .any(|change| change.contains("新增「wxreadmaster Book ID」")));
    }

    #[test]
    fn tracker_config_round_trips_through_json() {
        let config = NotionTrackerConfig {
            parent_page_id: "page-1".to_string(),
            book_library_id: "library-1".to_string(),
            title_property: TrackerPropertyRef {
                id: "title".to_string(),
                name: "Name".to_string(),
            },
            book_id_property: TrackerPropertyRef {
                id: "bid".to_string(),
                name: "wxreadmaster Book ID".to_string(),
            },
            author_property: None,
            status_property: None,
            status_kind: None,
            status_mapping: TrackerStatusMapping::default(),
            progress_property: None,
            cover_property: None,
            outcomes_database_id: "outcomes-1".to_string(),
            relation_property: None,
        };

        let raw = serde_json::to_string(&config).expect("serialize");
        let parsed: NotionTrackerConfig = serde_json::from_str(&raw).expect("deserialize");
        assert_eq!(parsed, config);
    }
}
