use reqwest::{Client, StatusCode};
use serde_json::{json, Map, Value};

use super::{document::ExportDocument, targets::NotionParentType};

const NOTION_API_BASE: &str = "https://api.notion.com/v1";
const NOTION_API_VERSION: &str = "2022-06-28";
const MAX_BLOCK_TEXT_LENGTH: usize = 1_900;
const MAX_BLOCKS_PER_REQUEST: usize = 100;
const MAX_RICH_TEXT_ITEMS_PER_BLOCK: usize = 100;
const NOTION_REQUEST_TIMEOUT_SECONDS: u64 = 30;
const NOTION_RATE_LIMIT_MAX_RETRIES: u32 = 3;
const NOTION_RATE_LIMIT_MAX_DELAY_SECONDS: u64 = 15;
const WORKSPACE_PAGE_TITLE: &str = "微信读书知识库";
const READING_DATABASE_TITLE: &str = "阅读成果库";
const WORKSPACE_PAGE_COVER_URL: &str =
    "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1600&q=80";

#[derive(Debug, Clone)]
pub struct NotionExportOptions {
    pub token: String,
    pub parent_id: String,
    pub parent_type: NotionParentType,
    pub use_page_cover: bool,
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

#[derive(Debug, Clone)]
pub struct NotionReadingWorkspaceTemplateOutput {
    pub home_page_id: String,
    pub home_page_url: String,
    pub database_id: String,
    pub database_url: String,
    pub title: String,
    pub warning: Option<String>,
}

pub async fn export_document(
    document: &ExportDocument,
    markdown: &str,
    options: &NotionExportOptions,
    prebuilt_blocks: Option<&[Value]>,
) -> Result<NotionExportOutput, String> {
    let client = Client::new();
    let database_schema = match options.parent_type {
        NotionParentType::Page => None,
        NotionParentType::Database => Some(database_schema(&client, options).await?),
    };
    let title_property = database_schema
        .as_ref()
        .and_then(|schema| schema.title_property.as_deref());
    if options.parent_type == NotionParentType::Database && title_property.is_none() {
        return Err("目标 Notion 数据库缺少标题属性。".to_string());
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
    let mut payload =
        create_page_payload(document, options, title_property, database_schema.as_ref());
    if !first_blocks.is_empty() {
        payload["children"] = Value::Array(first_blocks);
    }

    let has_cover = payload.get("cover").is_some();
    let (page, warning) = match create_page(&client, options, &payload).await {
        Ok(page) => (page, None),
        Err(cover_error) if has_cover && is_cover_related_error(&cover_error) => {
            payload.as_object_mut().map(|value| value.remove("cover"));
            let page = create_page(&client, options, &payload).await?;
            (
                page,
                Some(format!(
                    "Notion 封面写入失败，正文已无封面导入：{cover_error}"
                )),
            )
        }
        Err(error) => return Err(error),
    };
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
    let mut warning = warning;
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
                warning = Some(match warning {
                    Some(existing) => format!("{existing}；{addition}"),
                    None => addition,
                });
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

pub async fn create_reading_library_template(
    token: &str,
    parent_page_id: &str,
) -> Result<NotionReadingLibraryTemplateOutput, String> {
    let options = NotionExportOptions {
        token: token.to_string(),
        parent_id: parent_page_id.to_string(),
        parent_type: NotionParentType::Page,
        use_page_cover: false,
    };
    let client = Client::new();
    let database = create_reading_database(&client, &options, READING_DATABASE_TITLE).await?;
    let (database_id, url) =
        notion_object_id_and_url(&database, "Notion 数据库创建成功，但响应缺少数据库 ID。")?;

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
    };
    let client = Client::new();
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

async fn create_reading_database(
    client: &Client,
    options: &NotionExportOptions,
    title: &str,
) -> Result<Value, String> {
    let payload = reading_database_payload(&options.parent_id, title);
    send_notion_request(
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

async fn database_schema(
    client: &Client,
    options: &NotionExportOptions,
) -> Result<NotionDatabaseSchema, String> {
    let database = send_notion_request(notion_request(
        client,
        options,
        reqwest::Method::GET,
        &format!("/databases/{}", options.parent_id),
    ))
    .await?;
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
                append_template_page_properties(&mut values, schema, document);
            }
            Value::Object(values)
        }
        None => json!({ "title": rich_text(&document.title) }),
    };
    let mut payload = json!({ "parent": parent, "properties": properties });
    if options.use_page_cover {
        if let Some(url) = document
            .cover
            .as_ref()
            .and_then(|asset| asset.remote_url.as_deref())
        {
            payload["cover"] = json!({ "type": "external", "external": { "url": url } });
        }
    }
    payload
}

fn append_template_page_properties(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    document: &ExportDocument,
) {
    insert_rich_text_property(values, schema, "作者", document.author.as_deref());
    let actual_book_id = meta_value(document, "bookId");
    let display_book_id = actual_book_id.or(Some(&document.source_id));
    insert_rich_text_property(values, schema, "Book ID", display_book_id);
    insert_rich_text_property(values, schema, "Scope ID", meta_value(document, "scope"));
    insert_select_property(
        values,
        schema,
        "资产类型",
        Some(source_kind_label(document.source_kind)),
    );
    insert_select_property(values, schema, "来源", Some("wxreadmaster"));
    insert_date_property(
        values,
        schema,
        "导出时间",
        exported_at_to_notion_date(&document.exported_at),
    );
    insert_status_like_property(values, schema, "导入状态", Some("已导入"));
    insert_rich_text_property(
        values,
        schema,
        "Prompt 版本",
        meta_value(document, "promptVersion"),
    );
    insert_rich_text_property(
        values,
        schema,
        "输入哈希",
        meta_value(document, "inputHash"),
    );
    insert_select_property(
        values,
        schema,
        "周期",
        meta_value(document, "period").map(period_label),
    );
    insert_select_property(
        values,
        schema,
        "阅读阶段",
        meta_value(document, "readingStageLabel")
            .or_else(|| meta_value(document, "readingStage").map(reading_stage_label)),
    );
    insert_progress_property(values, schema, "进度", meta_number(document, "progress"));
    insert_number_property(
        values,
        schema,
        "行动数",
        meta_number(document, "actionCount"),
    );
    insert_number_property(
        values,
        schema,
        "候选书数",
        meta_number(document, "candidateCount"),
    );
    insert_number_property(
        values,
        schema,
        "划线数",
        meta_number(document, "highlightCount"),
    );
    insert_number_property(
        values,
        schema,
        "想法数",
        meta_number(document, "thoughtCount"),
    );
    insert_number_property(
        values,
        schema,
        "书签数",
        meta_number(document, "bookmarkCount"),
    );
    insert_number_property(
        values,
        schema,
        "可导出数",
        meta_number(document, "exportableCount"),
    );
    insert_multi_select_property(values, schema, "标签", meta_csv_values(document, "tagList"));
    insert_url_property(
        values,
        schema,
        "微信读书",
        meta_value(document, "wereadUrl")
            .map(str::to_string)
            .or_else(|| actual_book_id.and_then(weread_book_url)),
    );
    insert_rich_text_property(
        values,
        schema,
        "Obsidian 路径",
        meta_value(document, "obsidianPath"),
    );
}

fn reading_library_template_properties() -> Value {
    json!({
        "名称": { "title": {} },
        "作者": { "rich_text": {} },
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
        "标签": { "multi_select": {} },
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

fn insert_select_property(
    values: &mut Map<String, Value>,
    schema: &NotionDatabaseSchema,
    name: &str,
    value: Option<&str>,
) {
    if !property_type_matches(schema, name, "select") {
        return;
    }
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    values.insert(name.to_string(), json!({ "select": { "name": value } }));
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
                .map(str::to_string)
                .collect()
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

fn notion_request(
    client: &Client,
    options: &NotionExportOptions,
    method: reqwest::Method,
    path: &str,
) -> reqwest::RequestBuilder {
    client
        .request(method, format!("{NOTION_API_BASE}{path}"))
        .bearer_auth(&options.token)
        .header("Notion-Version", NOTION_API_VERSION)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .timeout(std::time::Duration::from_secs(
            NOTION_REQUEST_TIMEOUT_SECONDS,
        ))
}

/// 发送 Notion 请求；命中 429 限流时按 Retry-After 退避后重试。
/// 只重试 429（请求未被处理，重试安全），不重试网络错误或 5xx，
/// 避免“结果未知”场景下重复创建页面。
async fn send_notion_request(builder: reqwest::RequestBuilder) -> Result<Value, String> {
    let mut attempt: u32 = 0;
    loop {
        let request = builder
            .try_clone()
            .ok_or_else(|| "Notion 请求构造失败。".to_string())?;
        let response = request.send().await.map_err(|error| error.to_string())?;
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
        return parse_notion_response(response).await;
    }
}

fn retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

async fn parse_notion_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;
    if status.is_success() {
        return Ok(payload);
    }

    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Notion API 请求失败");
    let prefix = match status {
        StatusCode::UNAUTHORIZED => "Notion Token 无效或已失效",
        StatusCode::FORBIDDEN => "Notion Integration 没有访问目标页面的权限",
        StatusCode::NOT_FOUND => "Notion 目标页面或数据库不存在，或尚未共享给 Integration",
        StatusCode::TOO_MANY_REQUESTS => "Notion API 请求过于频繁",
        _ => "Notion API 请求失败",
    };
    Err(format!("{prefix}：{message}"))
}

#[cfg(test)]
mod tests {
    use crate::export::{
        document::{ExportDocument, ExportSourceKind},
        targets::NotionParentType,
    };

    use super::{
        create_page_payload, exported_at_to_notion_date, is_cover_related_error,
        markdown_to_blocks, notion_object_id_and_url, reading_database_payload, split_text,
        workspace_database_followup_blocks, workspace_homepage_payload, NotionDatabaseSchema,
        NotionExportOptions, MAX_BLOCK_TEXT_LENGTH,
    };

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
            "标签": { "type": "multi_select", "multi_select": {} },
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
