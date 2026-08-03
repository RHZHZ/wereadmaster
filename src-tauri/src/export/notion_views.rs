use std::collections::BTreeMap;

use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::notion::{
    notion_client, notion_request_with_version, send_notion_request, send_notion_request_typed,
    NOTION_VIEWS_API_VERSION,
};

const VIEW_PAGE_SIZE: u32 = 100;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum NotionStandardViewKey {
    Recent,
    Notes,
    ReviewQueue,
    Reviews,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotionDefaultViewStatus {
    Created,
    Updated,
    Reused,
    Skipped,
    Conflict,
    Failed,
    Unknown,
}

impl NotionDefaultViewStatus {
    pub fn is_ready(self) -> bool {
        matches!(self, Self::Created | Self::Updated | Self::Reused)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionDefaultViewResult {
    pub key: NotionStandardViewKey,
    pub name: String,
    #[serde(rename = "type")]
    pub view_type: String,
    pub status: NotionDefaultViewStatus,
    pub view_id: Option<String>,
    pub url: Option<String>,
    pub managed_config_fingerprint: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionDatabaseContext {
    pub database_id: String,
    pub data_source_id: String,
    pub properties: BTreeMap<String, NotionViewProperty>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionViewProperty {
    pub id: String,
    pub name: String,
    pub property_type: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone)]
struct StandardViewDefinition {
    key: NotionStandardViewKey,
    name: &'static str,
    filter: Option<Value>,
    sorts: Vec<Value>,
    configuration: Value,
    warning: Option<String>,
}

#[derive(Debug, Clone)]
struct RemoteView {
    id: String,
    database_id: String,
    data_source_id: Option<String>,
    name: Option<String>,
    view_type: String,
    url: Option<String>,
    filter: Option<Value>,
    sorts: Vec<Value>,
    configuration: Option<Value>,
}

pub async fn discover_database_context(
    token: &str,
    database_id: &str,
) -> Result<NotionDatabaseContext, String> {
    let client = notion_client()?;
    let database = send_notion_request(notion_request_with_version(
        &client,
        token,
        Method::GET,
        &format!("/databases/{database_id}"),
        NOTION_VIEWS_API_VERSION,
    ))
    .await?;
    let returned_database_id = database
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion 数据库发现响应缺少 database ID。".to_string())?;
    if normalize_notion_id(returned_database_id) != normalize_notion_id(database_id) {
        return Err("Notion 数据库发现响应与目标 database ID 不一致。".to_string());
    }
    let data_sources = database
        .get("data_sources")
        .and_then(Value::as_array)
        .ok_or_else(|| "Notion 数据库响应缺少 data_sources。".to_string())?;
    if data_sources.len() != 1 {
        return Err(format!(
            "标准成果库应只有一个 data source，当前发现 {} 个，已停止自动初始化视图。",
            data_sources.len()
        ));
    }
    let data_source_id = data_sources[0]
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Notion 数据库响应中的 data source 缺少 ID。".to_string())?
        .to_string();
    let data_source = send_notion_request(notion_request_with_version(
        &client,
        token,
        Method::GET,
        &format!("/data_sources/{data_source_id}"),
        NOTION_VIEWS_API_VERSION,
    ))
    .await?;
    if normalize_notion_id(
        data_source
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ) != normalize_notion_id(&data_source_id)
    {
        return Err("Notion data source 响应与目标 data source ID 不一致。".to_string());
    }
    let properties = parse_properties(&data_source)?;
    Ok(NotionDatabaseContext {
        database_id: returned_database_id.to_string(),
        data_source_id,
        properties,
    })
}

pub async fn reconcile_standard_views(
    token: &str,
    context: &NotionDatabaseContext,
    previous: &[NotionDefaultViewResult],
) -> Vec<NotionDefaultViewResult> {
    let definitions = build_standard_view_definitions(context);
    let client = match notion_client() {
        Ok(client) => client,
        Err(error) => {
            return definitions
                .into_iter()
                .map(|definition| failed_result(&definition, error.clone(), false))
                .collect();
        }
    };
    let mut remote = match retrieve_all_database_views(&client, token, &context.database_id).await {
        Ok(views) => views,
        Err(error) => {
            return definitions
                .into_iter()
                .map(|definition| failed_result(&definition, error.clone(), false))
                .collect();
        }
    };
    let previous_by_key = previous
        .iter()
        .map(|result| (result.key, result))
        .collect::<BTreeMap<_, _>>();
    let mut results = Vec::with_capacity(definitions.len());

    for definition in definitions {
        if let Some(warning) = definition
            .warning
            .as_deref()
            .filter(|warning| warning.starts_with("SKIP:"))
        {
            results.push(NotionDefaultViewResult {
                key: definition.key,
                name: definition.name.to_string(),
                view_type: "table".to_string(),
                status: NotionDefaultViewStatus::Skipped,
                view_id: None,
                url: None,
                managed_config_fingerprint: Some(definition_fingerprint(&definition)),
                warning: Some(warning.trim_start_matches("SKIP:").trim().to_string()),
            });
            continue;
        }

        let managed_id = previous_by_key
            .get(&definition.key)
            .and_then(|result| result.view_id.as_deref());
        if let Some(view) = managed_id.and_then(|id| remote.iter().find(|view| view.id == id)) {
            if view_matches_context(view, context) && view_equivalent(view, &definition) {
                results.push(result_from_remote(
                    &definition,
                    view,
                    NotionDefaultViewStatus::Reused,
                ));
                continue;
            }
            results.push(conflict_result(
                &definition,
                Some(view),
                "已记录的推荐视图被修改，应用不会静默覆盖。",
            ));
            continue;
        }

        let same_name = remote
            .iter()
            .filter(|view| {
                view_matches_context(view, context)
                    && view.name.as_deref().is_some_and(|name| {
                        normalize_view_name(name) == normalize_view_name(definition.name)
                    })
            })
            .collect::<Vec<_>>();
        if same_name.len() > 1 {
            results.push(conflict_result(
                &definition,
                None,
                "发现多个同名视图，已拒绝任选一个接管。",
            ));
            continue;
        }
        if let Some(view) = same_name.first().copied() {
            if view_equivalent(view, &definition) {
                results.push(result_from_remote(
                    &definition,
                    view,
                    NotionDefaultViewStatus::Reused,
                ));
            } else {
                results.push(conflict_result(
                    &definition,
                    Some(view),
                    "同名视图的类型或配置不同，已保留远端现状。",
                ));
            }
            continue;
        }

        if definition.key == NotionStandardViewKey::Recent {
            let default_candidates = remote
                .iter()
                .filter(|view| {
                    view_matches_context(view, context)
                        && view.view_type == "table"
                        && view.name.as_deref() == Some("Default view")
                })
                .collect::<Vec<_>>();
            if default_candidates.len() != 1 {
                results.push(conflict_result(
                    &definition,
                    None,
                    "无法唯一识别 Notion 自动生成的 Default view，已停止自动接管。",
                ));
                continue;
            }
            let target = default_candidates[0];
            let payload = update_view_payload(&definition);
            let mutation = send_notion_request_typed(
                notion_request_with_version(
                    &client,
                    token,
                    Method::PATCH,
                    &format!("/views/{}", target.id),
                    NOTION_VIEWS_API_VERSION,
                )
                .json(&payload),
            )
            .await;
            match mutation {
                Ok(value) => match parse_remote_view(&value) {
                    Ok(view) if view_equivalent(&view, &definition) => {
                        replace_remote(&mut remote, view.clone());
                        results.push(result_from_remote(
                            &definition,
                            &view,
                            NotionDefaultViewStatus::Updated,
                        ));
                    }
                    Ok(view) => results.push(conflict_result(
                        &definition,
                        Some(&view),
                        "Notion 返回的默认视图配置与期望不一致。",
                    )),
                    Err(error) => results.push(failed_result(&definition, error, true)),
                },
                Err(error) => {
                    let reconciled =
                        retrieve_all_database_views(&client, token, &context.database_id)
                            .await
                            .ok()
                            .and_then(|views| {
                                views.into_iter().find(|view| {
                                    view.id == target.id && view_equivalent(view, &definition)
                                })
                            });
                    if let Some(view) = reconciled {
                        replace_remote(&mut remote, view.clone());
                        results.push(result_from_remote(
                            &definition,
                            &view,
                            NotionDefaultViewStatus::Updated,
                        ));
                    } else {
                        results.push(failed_result(
                            &definition,
                            format!("更新默认视图后无法确认结果：{error}"),
                            error.result_unknown(),
                        ));
                    }
                }
            }
            continue;
        }

        let payload = create_view_payload(context, &definition);
        let mutation = send_notion_request_typed(
            notion_request_with_version(
                &client,
                token,
                Method::POST,
                "/views",
                NOTION_VIEWS_API_VERSION,
            )
            .json(&payload),
        )
        .await;
        match mutation {
            Ok(value) => match parse_remote_view(&value) {
                Ok(view) if view_equivalent(&view, &definition) => {
                    replace_remote(&mut remote, view.clone());
                    results.push(result_from_remote(
                        &definition,
                        &view,
                        NotionDefaultViewStatus::Created,
                    ));
                }
                Ok(view) => results.push(conflict_result(
                    &definition,
                    Some(&view),
                    "Notion 返回的新视图配置与期望不一致。",
                )),
                Err(error) => results.push(failed_result(&definition, error, true)),
            },
            Err(error) => {
                let reconciled = retrieve_all_database_views(&client, token, &context.database_id)
                    .await
                    .ok()
                    .and_then(|views| {
                        views.into_iter().find(|view| {
                            view_matches_context(view, context)
                                && view.name.as_deref() == Some(definition.name)
                                && view_equivalent(view, &definition)
                        })
                    });
                if let Some(view) = reconciled {
                    replace_remote(&mut remote, view.clone());
                    results.push(result_from_remote(
                        &definition,
                        &view,
                        NotionDefaultViewStatus::Created,
                    ));
                } else {
                    results.push(failed_result(
                        &definition,
                        format!("创建视图后无法确认结果：{error}"),
                        error.result_unknown(),
                    ));
                }
            }
        }
    }
    results
}

pub fn view_results_complete(results: &[NotionDefaultViewResult]) -> bool {
    results.len() == 4 && results.iter().all(|result| result.status.is_ready())
}

fn parse_properties(data_source: &Value) -> Result<BTreeMap<String, NotionViewProperty>, String> {
    let source = data_source
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| "Notion data source 响应缺少 properties。".to_string())?;
    let mut properties = BTreeMap::new();
    for (name, value) in source {
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(property_type) = value.get("type").and_then(Value::as_str) else {
            continue;
        };
        let options = value
            .get(property_type)
            .and_then(|config| config.get("options"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        properties.insert(
            name.clone(),
            NotionViewProperty {
                id: id.to_string(),
                name: name.clone(),
                property_type: property_type.to_string(),
                options,
            },
        );
    }
    Ok(properties)
}

fn build_standard_view_definitions(context: &NotionDatabaseContext) -> Vec<StandardViewDefinition> {
    let exported_at = compatible_property(context, "导出时间", &["date"]);
    let asset_type = compatible_property(context, "资产类型", &["select", "status"]);
    let tags = compatible_property(context, "标签", &["multi_select"]);
    let import_status = compatible_property(context, "导入状态", &["select", "status"]);
    let action_count = compatible_property(context, "行动数", &["number"]);
    let fallback_sorts = || {
        exported_at
            .map(|property| vec![property_sort(property, "descending")])
            .unwrap_or_else(|| {
                vec![json!({ "timestamp": "created_time", "direction": "descending" })]
            })
    };

    let recent_warning = exported_at.is_none().then(|| {
        "缺少“导出时间”，Default view 更新不支持时间戳排序，最近导入将不设置排序。".to_string()
    });
    let recent_sorts = exported_at
        .map(|property| vec![property_sort(property, "descending")])
        .unwrap_or_default();

    let notes_filter = asset_type.and_then(|property| {
        property
            .options
            .iter()
            .any(|option| option == "书籍笔记")
            .then(|| select_filter(property, "书籍笔记"))
    });
    let notes_warning = notes_filter
        .is_none()
        .then(|| "SKIP:缺少可用的“资产类型=书籍笔记”字段或选项，已跳过书籍笔记视图。".to_string());

    let mut review_conditions = Vec::new();
    if tags.is_some_and(|property| property.options.iter().any(|option| option == "待复盘")) {
        review_conditions.push(json!({
            "property": tags.unwrap().id,
            "multi_select": { "contains": "待复盘" }
        }));
    }
    if import_status
        .is_some_and(|property| property.options.iter().any(|option| option == "待整理"))
    {
        review_conditions.push(select_filter(import_status.unwrap(), "待整理"));
    }
    let review_filter = match review_conditions.len() {
        0 => None,
        1 => review_conditions.into_iter().next(),
        _ => Some(json!({ "or": review_conditions })),
    };
    let review_warning = review_filter
        .is_none()
        .then(|| "SKIP:缺少“标签=待复盘”和“导入状态=待整理”条件，已跳过待复盘视图。".to_string());
    let mut review_sorts = Vec::new();
    if let Some(property) = action_count {
        review_sorts.push(property_sort(property, "descending"));
    }
    review_sorts.extend(fallback_sorts());

    let review_asset_names = ["书籍复盘", "阅读统计复盘", "阅读路线", "选书决策"];
    let reviews_filter = asset_type.and_then(|property| {
        review_asset_names
            .iter()
            .all(|expected| property.options.iter().any(|option| option == expected))
            .then(|| {
                json!({
                    "or": review_asset_names
                        .iter()
                        .map(|name| select_filter(property, name))
                        .collect::<Vec<_>>()
                })
            })
    });
    let reviews_warning = reviews_filter
        .is_none()
        .then(|| "SKIP:缺少完整的复盘资产类型选项，已跳过复盘与报告视图。".to_string());

    vec![
        StandardViewDefinition {
            key: NotionStandardViewKey::Recent,
            name: "最近导入",
            filter: None,
            sorts: recent_sorts,
            configuration: table_configuration(
                context,
                &["名称", "资产类型", "作者", "导出时间", "导入状态", "标签"],
            ),
            warning: recent_warning,
        },
        StandardViewDefinition {
            key: NotionStandardViewKey::Notes,
            name: "书籍笔记",
            filter: notes_filter,
            sorts: fallback_sorts(),
            configuration: table_configuration(
                context,
                &[
                    "名称",
                    "作者",
                    "导出时间",
                    "划线数",
                    "想法数",
                    "书签数",
                    "标签",
                    "微信读书",
                ],
            ),
            warning: notes_warning,
        },
        StandardViewDefinition {
            key: NotionStandardViewKey::ReviewQueue,
            name: "待复盘",
            filter: review_filter,
            sorts: review_sorts,
            configuration: table_configuration(
                context,
                &[
                    "名称",
                    "资产类型",
                    "作者",
                    "导入状态",
                    "行动数",
                    "标签",
                    "导出时间",
                ],
            ),
            warning: review_warning,
        },
        StandardViewDefinition {
            key: NotionStandardViewKey::Reviews,
            name: "复盘与报告",
            filter: reviews_filter,
            sorts: fallback_sorts(),
            configuration: table_configuration(
                context,
                &[
                    "名称",
                    "资产类型",
                    "作者",
                    "导出时间",
                    "周期",
                    "行动数",
                    "导入状态",
                    "标签",
                ],
            ),
            warning: reviews_warning,
        },
    ]
}

fn compatible_property<'a>(
    context: &'a NotionDatabaseContext,
    name: &str,
    types: &[&str],
) -> Option<&'a NotionViewProperty> {
    context
        .properties
        .get(name)
        .filter(|property| types.contains(&property.property_type.as_str()))
}

fn select_filter(property: &NotionViewProperty, value: &str) -> Value {
    json!({
        "property": property.id,
        property.property_type.clone(): { "equals": value }
    })
}

fn property_sort(property: &NotionViewProperty, direction: &str) -> Value {
    json!({ "property": property.id, "direction": direction })
}

fn table_configuration(context: &NotionDatabaseContext, names: &[&str]) -> Value {
    let properties = names
        .iter()
        .filter_map(|name| context.properties.get(*name))
        .map(|property| {
            let mut value = json!({ "property_id": property.id, "visible": true, "wrap": true });
            if property.property_type == "title" {
                value["width"] = json!(320);
            }
            value
        })
        .collect::<Vec<_>>();
    json!({
        "type": "table",
        "properties": properties,
        "wrap_cells": true,
        "show_vertical_lines": false
    })
}

fn create_view_payload(
    context: &NotionDatabaseContext,
    definition: &StandardViewDefinition,
) -> Value {
    let mut payload = Map::new();
    payload.insert("database_id".to_string(), json!(context.database_id));
    payload.insert("data_source_id".to_string(), json!(context.data_source_id));
    payload.insert("name".to_string(), json!(definition.name));
    payload.insert("type".to_string(), json!("table"));
    payload.insert("sorts".to_string(), json!(definition.sorts));
    payload.insert(
        "configuration".to_string(),
        definition.configuration.clone(),
    );
    payload.insert("position".to_string(), json!({ "type": "end" }));
    if let Some(filter) = &definition.filter {
        payload.insert("filter".to_string(), filter.clone());
    }
    Value::Object(payload)
}

fn update_view_payload(definition: &StandardViewDefinition) -> Value {
    let mut payload = Map::new();
    payload.insert("name".to_string(), json!(definition.name));
    payload.insert(
        "filter".to_string(),
        definition.filter.clone().unwrap_or(Value::Null),
    );
    payload.insert("sorts".to_string(), json!(definition.sorts));
    payload.insert(
        "configuration".to_string(),
        definition.configuration.clone(),
    );
    Value::Object(payload)
}

async fn retrieve_all_database_views(
    client: &Client,
    token: &str,
    database_id: &str,
) -> Result<Vec<RemoteView>, String> {
    let mut cursor: Option<String> = None;
    let mut ids = Vec::new();
    loop {
        let mut query = vec![
            ("database_id", database_id.to_string()),
            ("page_size", VIEW_PAGE_SIZE.to_string()),
        ];
        if let Some(cursor) = cursor.as_deref() {
            query.push(("start_cursor", cursor.to_string()));
        }
        let response = send_notion_request(
            notion_request_with_version(
                client,
                token,
                Method::GET,
                "/views",
                NOTION_VIEWS_API_VERSION,
            )
            .query(&query),
        )
        .await?;
        ensure_view_list_request_complete(&response)?;
        let results = response
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(|| "Notion 视图列表响应缺少 results。".to_string())?;
        for result in results {
            let id = result
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Notion 视图引用缺少 ID。".to_string())?;
            ids.push(id.to_string());
        }
        if !response
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            break;
        }
        cursor = response
            .get("next_cursor")
            .and_then(Value::as_str)
            .map(str::to_string);
        if cursor.is_none() {
            return Err("Notion 视图列表标记了更多结果，但缺少 next_cursor。".to_string());
        }
    }

    let mut views = Vec::with_capacity(ids.len());
    for id in ids {
        let value = send_notion_request(notion_request_with_version(
            client,
            token,
            Method::GET,
            &format!("/views/{id}"),
            NOTION_VIEWS_API_VERSION,
        ))
        .await?;
        views.push(parse_remote_view(&value)?);
    }
    Ok(views)
}

fn ensure_view_list_request_complete(response: &Value) -> Result<(), String> {
    let Some(request_status) = response.get("request_status") else {
        return Ok(());
    };
    let status_type = request_status
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion 视图列表响应的 request_status 缺少 type。".to_string())?;
    match status_type {
        "complete" => Ok(()),
        "incomplete" => Err(
            "Notion 视图列表尚未生成完整结果，已停止自动创建或更新视图，请稍后重试。".to_string(),
        ),
        other => Err(format!(
            "Notion 视图列表返回未知 request_status：{other}，已停止自动修改视图。"
        )),
    }
}

fn parse_remote_view(value: &Value) -> Result<RemoteView, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion View 响应缺少 ID。".to_string())?;
    let database_id = value
        .get("parent")
        .and_then(|parent| parent.get("database_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion View 响应缺少 parent.database_id。".to_string())?;
    let view_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Notion View 响应缺少 type。".to_string())?;
    Ok(RemoteView {
        id: id.to_string(),
        database_id: database_id.to_string(),
        data_source_id: value
            .get("data_source_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string),
        view_type: view_type.to_string(),
        url: value.get("url").and_then(Value::as_str).map(str::to_string),
        filter: value
            .get("filter")
            .filter(|value| !value.is_null())
            .cloned(),
        sorts: value
            .get("sorts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        configuration: value
            .get("configuration")
            .filter(|value| !value.is_null())
            .cloned(),
    })
}

fn view_matches_context(view: &RemoteView, context: &NotionDatabaseContext) -> bool {
    normalize_notion_id(&view.database_id) == normalize_notion_id(&context.database_id)
        && view.data_source_id.as_deref().is_some_and(|id| {
            normalize_notion_id(id) == normalize_notion_id(&context.data_source_id)
        })
}

fn view_equivalent(view: &RemoteView, definition: &StandardViewDefinition) -> bool {
    view.view_type == "table"
        && view
            .name
            .as_deref()
            .is_some_and(|name| normalize_view_name(name) == normalize_view_name(definition.name))
        && managed_fingerprint(
            view.filter.as_ref(),
            &view.sorts,
            view.configuration.as_ref(),
        ) == definition_fingerprint(definition)
}

fn definition_fingerprint(definition: &StandardViewDefinition) -> String {
    managed_fingerprint(
        definition.filter.as_ref(),
        &definition.sorts,
        Some(&definition.configuration),
    )
}

fn managed_fingerprint(
    filter: Option<&Value>,
    sorts: &[Value],
    configuration: Option<&Value>,
) -> String {
    let canonical = json!({
        "filter": filter.map(canonical_filter).unwrap_or(Value::Null),
        "sorts": sorts.iter().map(canonical_sort).collect::<Vec<_>>(),
        "configuration": canonical_table_configuration(configuration)
    });
    let serialized = serde_json::to_string(&canonical).unwrap_or_default();
    let hash = serialized
        .bytes()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            hash.wrapping_mul(0x100000001b3) ^ u64::from(byte)
        });
    format!("{hash:016x}")
}

fn canonical_filter(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_filter).collect()),
        Value::Object(object) => {
            let mut canonical = Map::new();
            for (key, value) in object {
                if key.ends_with("_name") {
                    continue;
                }
                canonical.insert(
                    key.clone(),
                    if key == "property" {
                        canonical_property_id_value(value)
                    } else {
                        canonical_filter(value)
                    },
                );
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

fn canonical_sort(value: &Value) -> Value {
    json!({
        "property": value
            .get("property")
            .map(canonical_property_id_value)
            .unwrap_or(Value::Null),
        "timestamp": value.get("timestamp").cloned().unwrap_or(Value::Null),
        "direction": value.get("direction").cloned().unwrap_or(Value::Null)
    })
}

fn canonical_property_id_value(value: &Value) -> Value {
    value
        .as_str()
        .map(|value| json!(decode_notion_property_id(value)))
        .unwrap_or_else(|| value.clone())
}

fn decode_notion_property_id(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn canonical_table_configuration(configuration: Option<&Value>) -> Value {
    let Some(configuration) = configuration else {
        return Value::Null;
    };
    let properties = configuration
        .get("properties")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("visible").and_then(Value::as_bool) != Some(false))
                .map(|item| {
                    let mut value = Map::new();
                    if let Some(property_id) = item.get("property_id") {
                        value.insert(
                            "property_id".to_string(),
                            canonical_property_id_value(property_id),
                        );
                    }
                    if let Some(width) = item.get("width") {
                        value.insert("width".to_string(), width.clone());
                    }
                    value.insert(
                        "visible".to_string(),
                        canonical_optional_bool(item, "visible", true),
                    );
                    value.insert(
                        "wrap".to_string(),
                        canonical_optional_bool(item, "wrap", true),
                    );
                    Value::Object(value)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "type": configuration.get("type").cloned().unwrap_or_else(|| json!("table")),
        "properties": properties,
        "wrap_cells": canonical_optional_bool(configuration, "wrap_cells", true),
        "show_vertical_lines": canonical_optional_bool(
            configuration,
            "show_vertical_lines",
            false,
        )
    })
}

fn canonical_optional_bool(object: &Value, key: &str, default: bool) -> Value {
    object
        .get(key)
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| json!(default))
}

fn result_from_remote(
    definition: &StandardViewDefinition,
    view: &RemoteView,
    status: NotionDefaultViewStatus,
) -> NotionDefaultViewResult {
    NotionDefaultViewResult {
        key: definition.key,
        name: definition.name.to_string(),
        view_type: "table".to_string(),
        status,
        view_id: Some(view.id.clone()),
        url: view.url.clone(),
        managed_config_fingerprint: Some(definition_fingerprint(definition)),
        warning: definition.warning.clone(),
    }
}

fn conflict_result(
    definition: &StandardViewDefinition,
    view: Option<&RemoteView>,
    warning: &str,
) -> NotionDefaultViewResult {
    NotionDefaultViewResult {
        key: definition.key,
        name: definition.name.to_string(),
        view_type: "table".to_string(),
        status: NotionDefaultViewStatus::Conflict,
        view_id: view.map(|view| view.id.clone()),
        url: view.and_then(|view| view.url.clone()),
        managed_config_fingerprint: Some(definition_fingerprint(definition)),
        warning: Some(warning.to_string()),
    }
}

fn failed_result(
    definition: &StandardViewDefinition,
    warning: String,
    unknown: bool,
) -> NotionDefaultViewResult {
    NotionDefaultViewResult {
        key: definition.key,
        name: definition.name.to_string(),
        view_type: "table".to_string(),
        status: if unknown {
            NotionDefaultViewStatus::Unknown
        } else {
            NotionDefaultViewStatus::Failed
        },
        view_id: None,
        url: None,
        managed_config_fingerprint: Some(definition_fingerprint(definition)),
        warning: Some(warning),
    }
}

fn replace_remote(views: &mut Vec<RemoteView>, updated: RemoteView) {
    if let Some(existing) = views.iter_mut().find(|view| view.id == updated.id) {
        *existing = updated;
    } else {
        views.push(updated);
    }
}

fn normalize_view_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn normalize_notion_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> NotionDatabaseContext {
        let properties = [
            ("名称", "title", vec![]),
            ("作者", "rich_text", vec![]),
            (
                "资产类型",
                "select",
                vec![
                    "书籍笔记",
                    "书籍复盘",
                    "阅读统计复盘",
                    "阅读路线",
                    "选书决策",
                ],
            ),
            ("导出时间", "date", vec![]),
            ("导入状态", "select", vec!["待整理", "已导入"]),
            ("标签", "multi_select", vec!["待复盘"]),
            ("行动数", "number", vec![]),
            ("划线数", "number", vec![]),
            ("想法数", "number", vec![]),
            ("书签数", "number", vec![]),
            ("微信读书", "url", vec![]),
            ("周期", "select", vec![]),
        ]
        .into_iter()
        .map(|(name, property_type, options)| {
            (
                name.to_string(),
                NotionViewProperty {
                    id: format!("{name}-id"),
                    name: name.to_string(),
                    property_type: property_type.to_string(),
                    options: options.into_iter().map(str::to_string).collect(),
                },
            )
        })
        .collect();
        NotionDatabaseContext {
            database_id: "database-id".to_string(),
            data_source_id: "data-source-id".to_string(),
            properties,
        }
    }

    #[test]
    fn standard_definitions_have_stable_order_and_table_type() {
        let definitions = build_standard_view_definitions(&context());
        assert_eq!(
            definitions
                .iter()
                .map(|definition| definition.key)
                .collect::<Vec<_>>(),
            vec![
                NotionStandardViewKey::Recent,
                NotionStandardViewKey::Notes,
                NotionStandardViewKey::ReviewQueue,
                NotionStandardViewKey::Reviews,
            ]
        );
        assert!(definitions
            .iter()
            .all(|definition| definition.configuration["type"] == "table"));
    }

    #[test]
    fn review_queue_uses_compound_or_and_property_ids() {
        let definitions = build_standard_view_definitions(&context());
        let review = definitions
            .iter()
            .find(|definition| definition.key == NotionStandardViewKey::ReviewQueue)
            .unwrap();
        let conditions = review.filter.as_ref().unwrap()["or"].as_array().unwrap();
        assert_eq!(conditions.len(), 2);
        assert!(conditions.iter().all(|condition| condition["property"]
            .as_str()
            .is_some_and(|property| property.ends_with("-id"))));
    }

    #[test]
    fn reviews_use_four_select_conditions() {
        let definitions = build_standard_view_definitions(&context());
        let reviews = definitions
            .iter()
            .find(|definition| definition.key == NotionStandardViewKey::Reviews)
            .unwrap();
        assert_eq!(
            reviews.filter.as_ref().unwrap()["or"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
    }

    #[test]
    fn missing_exported_at_falls_back_for_created_views_but_not_default_update() {
        let mut context = context();
        context.properties.remove("导出时间");
        let definitions = build_standard_view_definitions(&context);
        assert!(definitions[0].sorts.is_empty());
        assert_eq!(definitions[1].sorts[0]["timestamp"], "created_time");
        assert!(definitions[0].warning.is_some());
    }

    #[test]
    fn missing_asset_type_skips_dependent_views() {
        let mut context = context();
        context.properties.remove("资产类型");
        let definitions = build_standard_view_definitions(&context);
        assert!(definitions[1]
            .warning
            .as_deref()
            .unwrap()
            .starts_with("SKIP:"));
        assert!(definitions[3]
            .warning
            .as_deref()
            .unwrap()
            .starts_with("SKIP:"));
    }

    #[test]
    fn incomplete_view_list_fails_closed_before_mutation() {
        let response = json!({
            "request_status": { "type": "incomplete" },
            "results": [],
            "has_more": false
        });
        let error = ensure_view_list_request_complete(&response)
            .expect_err("incomplete list should stop reconciliation");
        assert!(error.contains("尚未生成完整结果"));
    }

    #[test]
    fn complete_or_legacy_view_list_can_continue() {
        assert!(ensure_view_list_request_complete(&json!({
            "request_status": { "type": "complete" }
        }))
        .is_ok());
        assert!(ensure_view_list_request_complete(&json!({ "results": [] })).is_ok());
    }

    #[test]
    fn managed_fingerprint_ignores_response_property_names() {
        let definition = build_standard_view_definitions(&context()).remove(0);
        let mut response_configuration = definition.configuration.clone();
        for property in response_configuration["properties"].as_array_mut().unwrap() {
            property["property_name"] = json!("renamed convenience value");
        }
        assert_eq!(
            definition_fingerprint(&definition),
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&response_configuration)
            )
        );
    }

    #[test]
    fn managed_fingerprint_accepts_omitted_table_boolean_defaults() {
        let definition = build_standard_view_definitions(&context()).remove(0);
        let mut response_configuration = definition.configuration.clone();
        response_configuration
            .as_object_mut()
            .unwrap()
            .remove("wrap_cells");
        response_configuration
            .as_object_mut()
            .unwrap()
            .remove("show_vertical_lines");
        for property in response_configuration["properties"].as_array_mut().unwrap() {
            property.as_object_mut().unwrap().remove("visible");
            property.as_object_mut().unwrap().remove("wrap");
        }

        assert_eq!(
            definition_fingerprint(&definition),
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&response_configuration)
            )
        );
    }

    #[test]
    fn managed_fingerprint_accepts_real_view_response_normalization() {
        let definition = build_standard_view_definitions(&context()).remove(2);
        let mut response_configuration = definition.configuration.clone();
        response_configuration
            .as_object_mut()
            .unwrap()
            .remove("wrap_cells");
        response_configuration
            .as_object_mut()
            .unwrap()
            .remove("show_vertical_lines");
        for property in response_configuration["properties"].as_array_mut().unwrap() {
            property.as_object_mut().unwrap().remove("visible");
            property.as_object_mut().unwrap().remove("wrap");
            let id = property["property_id"].as_str().unwrap();
            property["property_id"] = json!(decode_notion_property_id(id));
            property["property_name"] = json!("response convenience name");
        }
        response_configuration["properties"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "property_id": "not-managed-id",
                "visible": false,
                "wrap": true
            }));
        let mut response_filter = definition.filter.clone().unwrap();
        decode_filter_property_ids(&mut response_filter);
        let mut response_sorts = definition.sorts.clone();
        for sort in &mut response_sorts {
            let id = sort["property"].as_str().unwrap();
            sort["property"] = json!(decode_notion_property_id(id));
        }

        assert_eq!(
            definition_fingerprint(&definition),
            managed_fingerprint(
                Some(&response_filter),
                &response_sorts,
                Some(&response_configuration)
            )
        );
    }

    #[test]
    fn hidden_expected_property_remains_a_conflict() {
        let definition = build_standard_view_definitions(&context()).remove(0);
        let expected = definition_fingerprint(&definition);
        let mut response_configuration = definition.configuration.clone();
        response_configuration["properties"][0]["visible"] = json!(false);

        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&response_configuration)
            )
        );
    }

    #[test]
    fn malformed_property_id_encoding_is_not_silently_changed() {
        assert_eq!(decode_notion_property_id("Dm%7CR"), "Dm|R");
        assert_eq!(decode_notion_property_id("SG%60m"), "SG`m");
        assert_eq!(decode_notion_property_id("%5Bv%5Bs"), "[v[s");
        assert_eq!(decode_notion_property_id("bad%2"), "bad%2");
        assert_eq!(decode_notion_property_id("bad%GG"), "bad%GG");
    }

    fn decode_filter_property_ids(value: &mut Value) {
        match value {
            Value::Array(items) => {
                for item in items {
                    decode_filter_property_ids(item);
                }
            }
            Value::Object(object) => {
                for (key, value) in object {
                    if key == "property" {
                        if let Some(id) = value.as_str() {
                            *value = json!(decode_notion_property_id(id));
                        }
                    } else {
                        decode_filter_property_ids(value);
                    }
                }
            }
            _ => {}
        }
    }

    #[test]
    fn managed_fingerprint_rejects_non_default_table_boolean_changes() {
        let definition = build_standard_view_definitions(&context()).remove(0);
        let expected = definition_fingerprint(&definition);

        let mut hidden_property = definition.configuration.clone();
        hidden_property["properties"][0]["visible"] = json!(false);
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&hidden_property)
            )
        );

        let mut unexpected_visible_property = definition.configuration.clone();
        unexpected_visible_property["properties"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "property_id": "unexpected-visible-id",
                "visible": true,
                "wrap": true
            }));
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&unexpected_visible_property)
            )
        );

        let mut nowrap_property = definition.configuration.clone();
        nowrap_property["properties"][0]["wrap"] = json!(false);
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&nowrap_property)
            )
        );

        let mut nowrap_cells = definition.configuration.clone();
        nowrap_cells["wrap_cells"] = json!(false);
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&nowrap_cells)
            )
        );

        let mut vertical_lines = definition.configuration.clone();
        vertical_lines["show_vertical_lines"] = json!(true);
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&vertical_lines)
            )
        );
    }

    #[test]
    fn managed_fingerprint_rejects_property_width_id_filter_and_sort_changes() {
        let definition = build_standard_view_definitions(&context()).remove(0);
        let expected = definition_fingerprint(&definition);

        let mut changed_width = definition.configuration.clone();
        changed_width["properties"][0]["width"] = json!(240);
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&changed_width)
            )
        );

        let mut changed_property = definition.configuration.clone();
        changed_property["properties"][0]["property_id"] = json!("different-property-id");
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &definition.sorts,
                Some(&changed_property)
            )
        );

        let changed_filter = json!({ "property": "导入状态-id", "select": { "equals": "待整理" } });
        assert_ne!(
            expected,
            managed_fingerprint(
                Some(&changed_filter),
                &definition.sorts,
                Some(&definition.configuration)
            )
        );

        let changed_sorts = vec![json!({
            "property": "导出时间-id",
            "direction": "ascending"
        })];
        assert_ne!(
            expected,
            managed_fingerprint(
                definition.filter.as_ref(),
                &changed_sorts,
                Some(&definition.configuration)
            )
        );
    }
}
