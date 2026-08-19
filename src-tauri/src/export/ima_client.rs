use std::{
    collections::{HashSet, VecDeque},
    fmt,
    time::Duration,
};

use chrono::{Local, SecondsFormat, Utc};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    db,
    services::ima_credentials::{ImaCredentialService, ImaCredentials},
};

const IMA_API_BASE: &str = "https://ima.qq.com";
pub const IMA_ADAPTER_VERSION: &str = "1.1.9";
const CONNECT_TIMEOUT_SECONDS: u64 = 15;
const REQUEST_TIMEOUT_SECONDS: u64 = 30;
const PAGE_LIMIT: u64 = 20;
const MAX_PAGES: usize = 100;
const MAX_FOLDER_DEPTH: usize = 100;
const MAX_DRIFT_FOLDERS: usize = 1_000;
const KNOWLEDGE_FOLDER_MEDIA_TYPE: i64 = 99;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImaCompatibilityStatus {
    Compatible,
    Incompatible,
    Unconfirmed,
}

pub(crate) fn is_ima_write_compatible(latest_version: Option<&str>) -> bool {
    version_compatibility_status(latest_version) == ImaCompatibilityStatus::Compatible
}

pub(crate) fn ima_compatibility_status(
    latest_version: Option<&str>,
    checked_adapter_version: Option<&str>,
    last_attempt_at: Option<&str>,
    last_success_at: Option<&str>,
) -> ImaCompatibilityStatus {
    let check_is_current = checked_adapter_version == Some(IMA_ADAPTER_VERSION)
        && last_attempt_at.is_some()
        && last_attempt_at == last_success_at;
    if !check_is_current {
        return ImaCompatibilityStatus::Unconfirmed;
    }
    version_compatibility_status(latest_version)
}

fn version_compatibility_status(latest_version: Option<&str>) -> ImaCompatibilityStatus {
    match latest_version.filter(|version| !version.is_empty()) {
        Some(version) if version == IMA_ADAPTER_VERSION => ImaCompatibilityStatus::Compatible,
        Some(_) => ImaCompatibilityStatus::Incompatible,
        None => ImaCompatibilityStatus::Unconfirmed,
    }
}

#[derive(Debug, Clone)]
pub struct ImaClientError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub result_unknown: bool,
    pub business_code: Option<i64>,
}

impl fmt::Display for ImaClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ImaClientError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaNoteFolder {
    pub folder_id: String,
    pub name: String,
    pub parent_folder_id: Option<String>,
    pub folder_type: i64,
    pub note_number: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaKnowledgeBase {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaKnowledgeItem {
    pub id: String,
    pub title: String,
    pub parent_folder_id: Option<String>,
    pub is_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaKnowledgePathFolder {
    pub folder_id: String,
    pub name: String,
    pub parent_folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImaKnowledgeList {
    pub items: Vec<ImaKnowledgeItem>,
    pub current_path: Vec<ImaKnowledgePathFolder>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImaNoteLocation {
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImaKnowledgeLocation {
    pub parent_folder_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImaValidatedExportTargets {
    pub note_folder_id: Option<String>,
    pub knowledge_base_id: Option<String>,
    pub knowledge_base_folder_id: Option<String>,
}

pub struct ImaClient {
    app: AppHandle,
    transport: ImaTransport,
}

struct ImaTransport {
    http: Client,
    credentials: ImaCredentials,
    base_url: String,
}

struct ImaKnowledgeListPage {
    items: Vec<ImaKnowledgeItem>,
    current_path: Vec<ImaKnowledgePathFolder>,
    is_end: bool,
    next_cursor: Option<String>,
}

fn parse_knowledge_items(data: &Value) -> Vec<ImaKnowledgeItem> {
    data.get("knowledge_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let folder_id = string_field(item, "folder_id");
            let media_id = string_field(item, "media_id");
            let is_folder = folder_id.is_some()
                || item.get("media_type").and_then(Value::as_i64)
                    == Some(KNOWLEDGE_FOLDER_MEDIA_TYPE);
            let id = folder_id.or(media_id)?;
            Some(ImaKnowledgeItem {
                id,
                title: string_field(item, "name")
                    .or_else(|| string_field(item, "title"))
                    .unwrap_or_else(|| "未命名条目".to_string()),
                parent_folder_id: string_field(item, "parent_folder_id"),
                is_folder,
            })
        })
        .collect()
}

fn parse_knowledge_path(data: &Value) -> Result<Vec<ImaKnowledgePathFolder>, ImaClientError> {
    let Some(path) = data.get("current_path").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    path.iter()
        .map(|item| {
            let folder_id = string_field(item, "folder_id").ok_or_else(|| {
                knowledge_path_error("Ima 知识库返回的 current_path 包含缺失目录 ID 的节点。")
            })?;
            Ok(ImaKnowledgePathFolder {
                folder_id,
                name: string_field(item, "name").unwrap_or_else(|| "未命名文件夹".to_string()),
                parent_folder_id: string_field(item, "parent_folder_id"),
            })
        })
        .collect()
}

fn canonical_note_folder_id(
    selected_folder_id: &str,
    folders: &[ImaNoteFolder],
) -> Result<Option<String>, ImaClientError> {
    let selected = unique_note_folder(selected_folder_id, folders, "所选 Ima 笔记本")?;
    if selected.folder_type == 1 {
        return Ok(None);
    }

    let mut current_folder_id = selected_folder_id;
    let mut visited = HashSet::new();
    for _ in 0..MAX_FOLDER_DEPTH {
        if !visited.insert(current_folder_id) {
            return Err(target_error(
                "IMA_NOTE_FOLDER_INVALID",
                "所选 Ima 笔记本存在循环父目录，已阻止导出。",
            ));
        }
        let folder = unique_note_folder(current_folder_id, folders, "所选 Ima 笔记本的父目录")?;
        let Some(parent_folder_id) = folder.parent_folder_id.as_deref() else {
            return Ok(Some(selected_folder_id.to_string()));
        };
        current_folder_id = parent_folder_id;
    }
    Err(target_error(
        "IMA_NOTE_FOLDER_INVALID",
        "所选 Ima 笔记本的父目录层级过深，已阻止导出。",
    ))
}

fn unique_note_folder<'a>(
    folder_id: &str,
    folders: &'a [ImaNoteFolder],
    label: &str,
) -> Result<&'a ImaNoteFolder, ImaClientError> {
    let mut matches = folders
        .iter()
        .filter(|folder| folder.folder_id == folder_id);
    let Some(folder) = matches.next() else {
        return Err(target_error(
            "IMA_NOTE_FOLDER_INVALID",
            &format!("{label}已缺失，已阻止导出。"),
        ));
    };
    if matches.next().is_some() {
        return Err(target_error(
            "IMA_NOTE_FOLDER_INVALID",
            &format!("{label}存在重复 ID，已阻止导出。"),
        ));
    }
    Ok(folder)
}

fn validate_knowledge_path(
    current_path: &[ImaKnowledgePathFolder],
    requested_folder_id: &str,
) -> Result<(), ImaClientError> {
    let Some(last) = current_path.last() else {
        return Err(knowledge_path_error(
            "Ima 未返回所选知识库文件夹的 current_path。",
        ));
    };
    if last.folder_id != requested_folder_id {
        return Err(knowledge_path_error(
            "所选 Ima 知识库文件夹已不存在或不属于当前知识库。",
        ));
    }
    if current_path.len() > MAX_FOLDER_DEPTH {
        return Err(knowledge_path_error(
            "Ima 知识库 current_path 的层级过深，已阻止导出。",
        ));
    }

    let mut visited = HashSet::new();
    for (index, folder) in current_path.iter().enumerate() {
        if !visited.insert(folder.folder_id.as_str()) {
            return Err(knowledge_path_error(
                "Ima 知识库 current_path 包含循环目录，已阻止导出。",
            ));
        }
        if let Some(parent) = index
            .checked_sub(1)
            .and_then(|value| current_path.get(value))
        {
            if folder.parent_folder_id.as_deref() != Some(parent.folder_id.as_str()) {
                return Err(knowledge_path_error(
                    "Ima 知识库 current_path 的父目录关系不完整，已阻止导出。",
                ));
            }
        }
    }
    Ok(())
}

impl ImaClient {
    pub fn from_saved_credentials(app: AppHandle) -> Result<Self, ImaClientError> {
        let credentials = ImaCredentialService::new(app.clone())
            .read_credentials()
            .map_err(|error| ImaClientError {
                code: error.code().to_string(),
                message: error.user_message(),
                detail: None,
                result_unknown: false,
                business_code: None,
            })?;
        Self::new(app, credentials)
    }

    pub(crate) fn new(app: AppHandle, credentials: ImaCredentials) -> Result<Self, ImaClientError> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .user_agent(format!(
                "wxreadmaster/{} ima-adapter/{IMA_ADAPTER_VERSION}",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .map_err(|error| ImaClientError {
                code: "IMA_CLIENT_INIT_FAILED".to_string(),
                message: "初始化 Ima 网络客户端失败。".to_string(),
                detail: Some(error.to_string()),
                result_unknown: false,
                business_code: None,
            })?;
        Ok(Self {
            app,
            transport: ImaTransport::with_client(http, credentials, IMA_API_BASE),
        })
    }

    pub(crate) fn credential_scope_fingerprint(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(self.transport.credentials.client_id.len().to_be_bytes());
        digest.update(self.transport.credentials.client_id.as_bytes());
        digest.update(self.transport.credentials.api_key.len().to_be_bytes());
        digest.update(self.transport.credentials.api_key.as_bytes());
        format!("sha256-v1:{:x}", digest.finalize())
    }

    pub async fn list_note_folders(&self) -> Result<Vec<ImaNoteFolder>, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        self.transport.list_note_folders().await
    }

    pub async fn list_addable_knowledge_bases(
        &self,
    ) -> Result<Vec<ImaKnowledgeBase>, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        self.transport.list_addable_knowledge_bases().await
    }

    pub async fn list_knowledge_items(
        &self,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
    ) -> Result<ImaKnowledgeList, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        self.transport
            .list_knowledge_items(knowledge_base_id, folder_id)
            .await
    }

    pub(crate) async fn locate_note(
        &self,
        note_id: &str,
    ) -> Result<Option<ImaNoteLocation>, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        let Some(mut location) = self.transport.locate_note(note_id).await? else {
            return Ok(None);
        };
        let Some(folder_id) = location.folder_id.as_deref() else {
            return Ok(Some(location));
        };
        let folders = self.transport.list_note_folders().await?;
        location.folder_id = canonical_note_folder_id(folder_id, &folders)?;
        Ok(Some(location))
    }

    pub(crate) async fn locate_knowledge_item(
        &self,
        knowledge_base_id: &str,
        media_id: &str,
    ) -> Result<Option<ImaKnowledgeLocation>, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        self.transport
            .locate_knowledge_item(knowledge_base_id, media_id)
            .await
    }

    pub(crate) async fn preflight_knowledge_base_target(
        &self,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
    ) -> Result<Option<String>, ImaClientError> {
        self.check_adapter_compatibility(false).await?;
        let knowledge_base_id = normalize_optional(Some(knowledge_base_id)).ok_or_else(|| {
            target_error("IMA_KNOWLEDGE_BASE_MISSING", "请先选择可写的 Ima 知识库。")
        })?;
        self.transport
            .validate_knowledge_base_target(knowledge_base_id, folder_id)
            .await
    }

    pub(crate) async fn preflight_export_targets(
        &self,
        note_folder_id: Option<&str>,
        knowledge_base_id: Option<&str>,
        knowledge_base_folder_id: Option<&str>,
        publish_to_knowledge_base: bool,
    ) -> Result<ImaValidatedExportTargets, ImaClientError> {
        self.check_adapter_compatibility(false).await?;

        let note_folder_id = self.transport.validate_note_folder(note_folder_id).await?;
        if !publish_to_knowledge_base {
            return Ok(ImaValidatedExportTargets {
                note_folder_id,
                knowledge_base_id: None,
                knowledge_base_folder_id: None,
            });
        }

        let knowledge_base_id = normalize_optional(knowledge_base_id)
            .ok_or_else(|| {
                target_error("IMA_KNOWLEDGE_BASE_MISSING", "请先选择可写的 Ima 知识库。")
            })?
            .to_string();
        let knowledge_base_folder_id = self
            .transport
            .validate_knowledge_base_target(&knowledge_base_id, knowledge_base_folder_id)
            .await?;
        Ok(ImaValidatedExportTargets {
            note_folder_id,
            knowledge_base_id: Some(knowledge_base_id),
            knowledge_base_folder_id,
        })
    }

    pub async fn import_doc(
        &self,
        content: &str,
        folder_id: Option<&str>,
    ) -> Result<String, ImaClientError> {
        self.check_adapter_compatibility(true).await?;
        self.transport.import_doc(content, folder_id).await
    }

    pub async fn append_doc(&self, note_id: &str, content: &str) -> Result<String, ImaClientError> {
        self.check_adapter_compatibility(true).await?;
        self.transport.append_doc(note_id, content).await
    }

    pub async fn add_note_to_knowledge_base(
        &self,
        note_id: &str,
        title: &str,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
    ) -> Result<String, ImaClientError> {
        self.check_adapter_compatibility(true).await?;
        self.transport
            .add_note_to_knowledge_base(note_id, title, knowledge_base_id, folder_id)
            .await
    }

    pub async fn refresh_adapter_compatibility(&self) -> Result<(), ImaClientError> {
        let config_dir = db::default_data_dir(&self.app).map_err(storage_error)?;
        let today = Local::now().format("%Y-%m-%d").to_string();
        let attempted_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
        let mut integration = db::read_integration_config(&config_dir).map_err(storage_error)?;
        integration.ima_update_checked_date = Some(today);
        integration.ima_update_checked_adapter_version = Some(IMA_ADAPTER_VERSION.to_string());
        integration.ima_update_last_attempt_at = Some(attempted_at.clone());
        db::write_integration_config(&config_dir, &integration).map_err(storage_error)?;

        let data = self
            .post_value_without_update_check(
                "openapi/check_skill_update",
                json!({ "version": IMA_ADAPTER_VERSION }),
                false,
            )
            .await?;

        let mut integration = db::read_integration_config(&config_dir).map_err(storage_error)?;
        integration.ima_latest_version = exact_non_empty_string_field(&data, "latest_version");
        integration.ima_release_desc = string_field(&data, "release_desc");
        integration.ima_update_instruction = string_field(&data, "instruction");
        integration.ima_update_last_success_at = Some(attempted_at);
        db::write_integration_config(&config_dir, &integration).map_err(storage_error)
    }

    async fn check_adapter_compatibility(&self, is_write: bool) -> Result<(), ImaClientError> {
        let config_dir = db::default_data_dir(&self.app).map_err(storage_error)?;
        let integration = db::read_integration_config(&config_dir).map_err(storage_error)?;
        let today = Local::now().format("%Y-%m-%d").to_string();
        let should_refresh = integration.ima_update_checked_date.as_deref() != Some(today.as_str())
            || integration.ima_update_checked_adapter_version.as_deref()
                != Some(IMA_ADAPTER_VERSION);
        if should_refresh {
            // Refresh stale metadata before applying the fail-closed write gate.
            let _ = self.refresh_adapter_compatibility().await;
        }

        let integration = db::read_integration_config(&config_dir).map_err(storage_error)?;
        let status = ima_compatibility_status(
            integration.ima_latest_version.as_deref(),
            integration.ima_update_checked_adapter_version.as_deref(),
            integration.ima_update_last_attempt_at.as_deref(),
            integration.ima_update_last_success_at.as_deref(),
        );
        if is_write && status != ImaCompatibilityStatus::Compatible {
            let (code, message) = if status == ImaCompatibilityStatus::Incompatible {
                (
                    "IMA_SKILL_UPDATE_REQUIRED",
                    format!(
                        "本地 Ima 适配器版本与服务端版本不一致（本地 {IMA_ADAPTER_VERSION}，服务端 {}），请按 Ima 官方更新说明处理。",
                        integration.ima_latest_version.as_deref().unwrap_or("未知")
                    ),
                )
            } else {
                (
                    "IMA_COMPATIBILITY_UNCONFIRMED",
                    "尚未确认本地 Ima 适配器与服务端版本兼容，请先刷新适配器版本状态后再写入。"
                        .to_string(),
                )
            };
            return Err(ImaClientError {
                code: code.to_string(),
                message,
                detail: integration.ima_release_desc,
                result_unknown: false,
                business_code: None,
            });
        }
        Ok(())
    }

    async fn post_value_without_update_check(
        &self,
        path: &str,
        body: Value,
        is_write: bool,
    ) -> Result<Value, ImaClientError> {
        self.transport.post_value(path, body, is_write).await
    }
}

impl ImaTransport {
    fn with_client(http: Client, credentials: ImaCredentials, base_url: &str) -> Self {
        Self {
            http,
            credentials,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    async fn list_note_folders(&self) -> Result<Vec<ImaNoteFolder>, ImaClientError> {
        let mut cursor = "0".to_string();
        let mut seen_cursors = HashSet::from([cursor.clone()]);
        let mut folders = Vec::new();
        for _ in 0..MAX_PAGES {
            let data = self
                .post_value(
                    "openapi/note/v1/list_notebook",
                    json!({ "cursor": cursor, "limit": PAGE_LIMIT }),
                    false,
                )
                .await?;
            for item in data
                .get("note_folder_infos")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(folder_id) = string_field(item, "folder_id") else {
                    continue;
                };
                folders.push(ImaNoteFolder {
                    folder_id,
                    name: string_field(item, "name").unwrap_or_else(|| "未命名笔记本".to_string()),
                    parent_folder_id: string_field(item, "parent_folder_id"),
                    folder_type: item.get("folder_type").and_then(Value::as_i64).unwrap_or(0),
                    note_number: item.get("note_number").and_then(Value::as_i64).unwrap_or(0),
                });
            }
            if data.get("is_end").and_then(Value::as_bool).unwrap_or(true) {
                return Ok(folders);
            }
            let next = string_field(&data, "next_cursor").unwrap_or_default();
            if next.is_empty() || !seen_cursors.insert(next.clone()) {
                return Err(pagination_error("Ima 笔记本"));
            }
            cursor = next;
        }
        Err(pagination_error("Ima 笔记本"))
    }

    async fn list_addable_knowledge_bases(&self) -> Result<Vec<ImaKnowledgeBase>, ImaClientError> {
        let mut cursor = String::new();
        let mut seen_cursors = HashSet::from([cursor.clone()]);
        let mut bases = Vec::new();
        for _ in 0..MAX_PAGES {
            let data = self
                .post_value(
                    "openapi/wiki/v1/get_addable_knowledge_base_list",
                    json!({ "cursor": cursor, "limit": 50 }),
                    false,
                )
                .await?;
            for item in data
                .get("addable_knowledge_base_list")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(id) = string_field(item, "id") else {
                    continue;
                };
                bases.push(ImaKnowledgeBase {
                    id,
                    name: string_field(item, "name").unwrap_or_else(|| "未命名知识库".to_string()),
                });
            }
            if data.get("is_end").and_then(Value::as_bool).unwrap_or(true) {
                return Ok(bases);
            }
            let next = string_field(&data, "next_cursor").unwrap_or_default();
            if next.is_empty() || !seen_cursors.insert(next.clone()) {
                return Err(pagination_error("Ima 知识库"));
            }
            cursor = next;
        }
        Err(pagination_error("Ima 知识库"))
    }

    async fn list_knowledge_items(
        &self,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
    ) -> Result<ImaKnowledgeList, ImaClientError> {
        let mut cursor = String::new();
        let mut seen_cursors = HashSet::from([cursor.clone()]);
        let mut items = Vec::new();
        let mut current_path: Option<Vec<ImaKnowledgePathFolder>> = None;
        for _ in 0..MAX_PAGES {
            let page = self
                .get_knowledge_list_page(knowledge_base_id, folder_id, &cursor)
                .await?;
            match &current_path {
                Some(existing) if existing != &page.current_path => {
                    return Err(pagination_path_error());
                }
                None => current_path = Some(page.current_path.clone()),
                _ => {}
            }
            items.extend(page.items);
            if page.is_end {
                return Ok(ImaKnowledgeList {
                    items,
                    current_path: current_path.unwrap_or_default(),
                });
            }
            let next = page.next_cursor.unwrap_or_default();
            if next.is_empty() || !seen_cursors.insert(next.clone()) {
                return Err(pagination_error("Ima 知识库内容"));
            }
            cursor = next;
        }
        Err(pagination_error("Ima 知识库内容"))
    }

    async fn locate_note(&self, note_id: &str) -> Result<Option<ImaNoteLocation>, ImaClientError> {
        let note_id = normalize_optional(Some(note_id))
            .ok_or_else(|| target_error("IMA_NOTE_ID_MISSING", "Ima 笔记 ID 不能为空。"))?;
        let mut cursor = String::new();
        let mut seen_cursors = HashSet::from([cursor.clone()]);
        for _ in 0..MAX_PAGES {
            let data = self
                .post_value(
                    "openapi/note/v1/list_note",
                    json!({
                        "folder_id": "",
                        "sort_type": 0,
                        "cursor": cursor,
                        "limit": PAGE_LIMIT,
                    }),
                    false,
                )
                .await?;
            for item in data
                .get("note_book_list")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if string_field(item, "note_id").as_deref() != Some(note_id) {
                    continue;
                }
                let folder_id = item
                    .get("note_ext_info")
                    .and_then(|value| string_field(value, "folder_id"));
                return Ok(Some(ImaNoteLocation { folder_id }));
            }
            if data.get("is_end").and_then(Value::as_bool).unwrap_or(true) {
                return Ok(None);
            }
            let next = string_field(&data, "next_cursor").unwrap_or_default();
            if next.is_empty() || !seen_cursors.insert(next.clone()) {
                return Err(pagination_error("Ima 笔记"));
            }
            cursor = next;
        }
        Err(pagination_error("Ima 笔记"))
    }

    async fn locate_knowledge_item(
        &self,
        knowledge_base_id: &str,
        media_id: &str,
    ) -> Result<Option<ImaKnowledgeLocation>, ImaClientError> {
        let knowledge_base_id = normalize_optional(Some(knowledge_base_id)).ok_or_else(|| {
            target_error("IMA_KNOWLEDGE_BASE_MISSING", "Ima 知识库 ID 不能为空。")
        })?;
        let media_id = normalize_optional(Some(media_id))
            .ok_or_else(|| target_error("IMA_MEDIA_ID_MISSING", "Ima 知识库资料 ID 不能为空。"))?;
        let mut folders = VecDeque::from([None::<String>]);
        let mut visited = HashSet::new();
        let mut scanned = 0usize;
        while let Some(folder_id) = folders.pop_front() {
            let visit_key = folder_id.clone().unwrap_or_else(|| "root".to_string());
            if !visited.insert(visit_key) {
                continue;
            }
            scanned += 1;
            if scanned > MAX_DRIFT_FOLDERS {
                return Err(pagination_error("Ima 知识库目录"));
            }
            let listing = self
                .list_knowledge_items(knowledge_base_id, folder_id.as_deref())
                .await?;
            for item in listing.items {
                if item.is_folder {
                    if item.id != knowledge_base_id && !visited.contains(&item.id) {
                        folders.push_back(Some(item.id));
                    }
                    continue;
                }
                if item.id == media_id {
                    return Ok(Some(ImaKnowledgeLocation {
                        parent_folder_id: normalize_knowledge_root_id(
                            item.parent_folder_id,
                            knowledge_base_id,
                        ),
                    }));
                }
            }
        }
        Ok(None)
    }

    async fn get_knowledge_list_page(
        &self,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
        cursor: &str,
    ) -> Result<ImaKnowledgeListPage, ImaClientError> {
        let mut body = json!({
            "cursor": cursor,
            "limit": 50,
            "knowledge_base_id": knowledge_base_id,
        });
        if let Some(folder_id) = normalize_optional(folder_id) {
            body["folder_id"] = Value::String(folder_id.to_string());
        }
        let data = self
            .post_value("openapi/wiki/v1/get_knowledge_list", body, false)
            .await?;
        Ok(ImaKnowledgeListPage {
            items: parse_knowledge_items(&data),
            current_path: parse_knowledge_path(&data)?,
            is_end: data.get("is_end").and_then(Value::as_bool).unwrap_or(true),
            next_cursor: string_field(&data, "next_cursor"),
        })
    }

    async fn validate_note_folder(
        &self,
        note_folder_id: Option<&str>,
    ) -> Result<Option<String>, ImaClientError> {
        let Some(note_folder_id) = normalize_optional(note_folder_id) else {
            return Ok(None);
        };
        if note_folder_id == "0" {
            return Err(target_error(
                "IMA_NOTE_FOLDER_INVALID",
                "Ima 笔记本 ID 不能使用分页游标 0。",
            ));
        }
        let folders = self.list_note_folders().await?;
        canonical_note_folder_id(note_folder_id, &folders)
    }

    async fn validate_knowledge_base_target(
        &self,
        knowledge_base_id: &str,
        knowledge_base_folder_id: Option<&str>,
    ) -> Result<Option<String>, ImaClientError> {
        let knowledge_bases = self.list_addable_knowledge_bases().await?;
        if !knowledge_bases
            .iter()
            .any(|knowledge_base| knowledge_base.id == knowledge_base_id)
        {
            return Err(target_error(
                "IMA_KNOWLEDGE_BASE_FORBIDDEN",
                "当前账号无法写入所选 Ima 知识库。",
            ));
        }

        let Some(folder_id) = normalize_optional(knowledge_base_folder_id) else {
            return Ok(None);
        };
        if folder_id == knowledge_base_id {
            return Ok(None);
        }
        let page = self
            .get_knowledge_list_page(knowledge_base_id, Some(folder_id), "")
            .await?;
        validate_knowledge_path(&page.current_path, folder_id)?;
        Ok(Some(folder_id.to_string()))
    }

    async fn import_doc(
        &self,
        content: &str,
        folder_id: Option<&str>,
    ) -> Result<String, ImaClientError> {
        let mut body = json!({ "content_format": 1, "content": content });
        if let Some(folder_id) = normalize_optional(folder_id) {
            body["folder_id"] = Value::String(folder_id.to_string());
        }
        let data = self
            .post_value("openapi/note/v1/import_doc", body, true)
            .await?;
        required_string(&data, "note_id", "Ima 创建笔记响应缺少 note_id。")
    }

    async fn append_doc(&self, note_id: &str, content: &str) -> Result<String, ImaClientError> {
        let data = self
            .post_value(
                "openapi/note/v1/append_doc",
                json!({
                    "note_id": note_id,
                    "content_format": 1,
                    "content": content,
                }),
                true,
            )
            .await?;
        required_string(&data, "note_id", "Ima 追加笔记响应缺少 note_id。")
    }

    async fn add_note_to_knowledge_base(
        &self,
        note_id: &str,
        title: &str,
        knowledge_base_id: &str,
        folder_id: Option<&str>,
    ) -> Result<String, ImaClientError> {
        let mut body = json!({
            "media_type": 11,
            "title": title,
            "knowledge_base_id": knowledge_base_id,
            "note_info": { "content_id": note_id },
        });
        if let Some(folder_id) = normalize_optional(folder_id) {
            body["folder_id"] = Value::String(folder_id.to_string());
        }
        let data = self
            .post_value("openapi/wiki/v1/add_knowledge", body, true)
            .await?;
        required_string(&data, "media_id", "Ima 知识库关联响应缺少 media_id。")
    }

    async fn post_value(
        &self,
        path: &str,
        body: Value,
        is_write: bool,
    ) -> Result<Value, ImaClientError> {
        let response = self
            .http
            .post(format!("{}/{path}", self.base_url))
            .header("ima-openapi-clientid", &self.credentials.client_id)
            .header("ima-openapi-apikey", &self.credentials.api_key)
            .header(
                "ima-openapi-ctx",
                format!("skill_version={IMA_ADAPTER_VERSION}"),
            )
            .json(&body)
            .send()
            .await
            .map_err(|error| ImaClientError {
                code: if error.is_timeout() {
                    "IMA_REQUEST_TIMEOUT"
                } else {
                    "IMA_NETWORK_ERROR"
                }
                .to_string(),
                message: if error.is_timeout() {
                    "Ima 请求超时，远端状态无法确认。".to_string()
                } else {
                    "无法连接 Ima，请检查网络、系统代理或 VPN。".to_string()
                },
                detail: Some(error.to_string()),
                result_unknown: is_write,
                business_code: None,
            })?;
        let status = response.status();
        let payload = response
            .json::<Value>()
            .await
            .map_err(|error| error.to_string());
        parse_response_payload(status, payload, is_write)
    }
}

fn parse_response_payload(
    status: StatusCode,
    payload: Result<Value, String>,
    is_write: bool,
) -> Result<Value, ImaClientError> {
    let payload = payload.map_err(|detail| ImaClientError {
        code: "IMA_RESPONSE_INVALID".to_string(),
        message: "Ima 返回了无法解析的响应。".to_string(),
        detail: Some(detail),
        result_unknown: is_write && status.is_success(),
        business_code: None,
    })?;
    if !status.is_success() {
        return Err(http_error(status));
    }
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        return Err(ImaClientError {
            code: ima_business_error_code(code).to_string(),
            message: string_field(&payload, "msg").unwrap_or_else(|| "Ima 请求失败。".to_string()),
            detail: None,
            result_unknown: false,
            business_code: Some(code),
        });
    }
    Ok(payload.get("data").cloned().unwrap_or_else(|| json!({})))
}

fn required_string(data: &Value, field: &str, message: &str) -> Result<String, ImaClientError> {
    string_field(data, field).ok_or_else(|| ImaClientError {
        code: "IMA_RESPONSE_INVALID".to_string(),
        message: message.to_string(),
        detail: None,
        result_unknown: true,
        business_code: None,
    })
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn exact_non_empty_string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn normalize_knowledge_root_id(value: Option<String>, knowledge_base_id: &str) -> Option<String> {
    value
        .filter(|value| value != knowledge_base_id)
        .and_then(|value| normalize_optional(Some(&value)).map(str::to_string))
}

fn storage_error(error: String) -> ImaClientError {
    ImaClientError {
        code: "IMA_CONFIG_UNAVAILABLE".to_string(),
        message: "无法读取或保存 Ima 配置。".to_string(),
        detail: Some(error),
        result_unknown: false,
        business_code: None,
    }
}

fn http_error(status: StatusCode) -> ImaClientError {
    ImaClientError {
        code: if status == StatusCode::TOO_MANY_REQUESTS {
            "IMA_RATE_LIMITED".to_string()
        } else {
            format!("IMA_HTTP_{}", status.as_u16())
        },
        message: format!("Ima 请求失败：HTTP {status}。"),
        detail: None,
        result_unknown: false,
        business_code: None,
    }
}

fn pagination_error(label: &str) -> ImaClientError {
    ImaClientError {
        code: "IMA_PAGINATION_INVALID".to_string(),
        message: format!("{label}分页游标异常，已停止读取。"),
        detail: None,
        result_unknown: false,
        business_code: None,
    }
}

fn pagination_path_error() -> ImaClientError {
    ImaClientError {
        code: "IMA_PAGINATION_INVALID".to_string(),
        message: "Ima 知识库分页返回的 current_path 不一致，已停止读取。".to_string(),
        detail: None,
        result_unknown: false,
        business_code: None,
    }
}

fn target_error(code: &str, message: &str) -> ImaClientError {
    ImaClientError {
        code: code.to_string(),
        message: message.to_string(),
        detail: None,
        result_unknown: false,
        business_code: None,
    }
}

fn knowledge_path_error(message: &str) -> ImaClientError {
    target_error("IMA_KNOWLEDGE_BASE_FOLDER_INVALID", message)
}

fn ima_business_error_code(code: i64) -> &'static str {
    match code {
        20002 | 110021 => "IMA_RATE_LIMITED",
        20004 => "IMA_AUTH_FAILED",
        100009 | 210009 => "IMA_CONTENT_TOO_LARGE",
        310001 | 210035 => "IMA_NOTE_FOLDER_INVALID",
        210004 => "IMA_STORAGE_FULL",
        210005 | 210006 | 210034 => "IMA_NOTE_UNAVAILABLE",
        210008 => "IMA_NOTE_CONFLICT",
        210011 | 110030 => "IMA_KNOWLEDGE_BASE_FORBIDDEN",
        210036 => "IMA_KNOWLEDGE_ADD_FAILED",
        210001 | 110001 | 110002 | 110012 => "IMA_REQUEST_INVALID",
        110010 | 110013 => "IMA_REMOTE_TEMPORARY",
        110020 => "IMA_CONTENT_REJECTED",
        _ => "IMA_REMOTE_ERROR",
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };

    use reqwest::Client;
    use reqwest::StatusCode;
    use serde_json::json;

    use super::{
        canonical_note_folder_id, ima_compatibility_status, is_ima_write_compatible,
        normalize_optional, parse_knowledge_items, parse_response_payload, required_string,
        validate_knowledge_path, ImaCompatibilityStatus, ImaCredentials, ImaKnowledgePathFolder,
        ImaNoteFolder, ImaTransport, IMA_ADAPTER_VERSION,
    };

    #[derive(Debug)]
    struct CapturedRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: serde_json::Value,
    }

    struct MockResponse {
        status: u16,
        body: String,
    }

    fn test_transport(base_url: &str) -> ImaTransport {
        let http = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("test HTTP client should build");
        ImaTransport::with_client(
            http,
            ImaCredentials {
                client_id: "test-client-id".to_string(),
                api_key: "test-api-key".to_string(),
            },
            base_url,
        )
    }

    fn spawn_mock_server(
        responses: Vec<MockResponse>,
    ) -> (
        String,
        Arc<Mutex<Vec<CapturedRequest>>>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock server should bind");
        listener
            .set_nonblocking(true)
            .expect("mock server should be nonblocking");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let server = thread::spawn(move || {
            for response in responses {
                let deadline = Instant::now() + Duration::from_secs(2);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(connection) => break connection,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("mock request should arrive: {error}"),
                    }
                };
                let request = read_request(&mut stream);
                captured.lock().unwrap().push(request);
                let reason = match response.status {
                    200 => "OK",
                    429 => "Too Many Requests",
                    500 => "Internal Server Error",
                    _ => "Test Response",
                };
                let wire = format!(
                    "HTTP/1.1 {} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.body.len(),
                    response.body
                );
                stream
                    .write_all(wire.as_bytes())
                    .expect("mock response should write");
            }
        });
        (url, requests, server)
    }

    fn spawn_silent_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("silent server should bind");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().expect("timeout request should arrive");
            thread::sleep(Duration::from_millis(250));
        });
        (url, server)
    }

    fn read_request(stream: &mut TcpStream) -> CapturedRequest {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("mock stream timeout should set");
        let mut raw = Vec::new();
        let mut expected_len = None;
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut chunk = [0_u8; 4096];
            let read = match stream.read(&mut chunk) {
                Ok(read) => read,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("mock request should read: {error}"),
            };
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&chunk[..read]);
            if expected_len.is_none() {
                if let Some(header_end) = raw.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&raw[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            (name.eq_ignore_ascii_case("content-length"))
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    expected_len = Some(header_end + 4 + content_length);
                }
            }
            if expected_len.is_some_and(|length| raw.len() >= length) {
                break;
            }
        }
        let header_end = raw
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .expect("mock request should include headers");
        let headers_text = String::from_utf8_lossy(&raw[..header_end]);
        let mut lines = headers_text.lines();
        let request_line = lines.next().expect("mock request line should exist");
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().unwrap_or_default().to_string();
        let path = request_parts.next().unwrap_or_default().to_string();
        let headers = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.to_ascii_lowercase(), value.trim().to_string()))
            })
            .collect();
        let body =
            serde_json::from_slice(&raw[header_end + 4..]).expect("mock body should be JSON");
        CapturedRequest {
            method,
            path,
            headers,
            body,
        }
    }

    #[test]
    fn optional_ids_drop_blank_values() {
        assert_eq!(normalize_optional(Some(" value ")), Some("value"));
        assert_eq!(normalize_optional(Some("  ")), None);
    }

    #[test]
    fn knowledge_list_parses_media_type_99_folder_entries() {
        let data = json!({
            "knowledge_list": [
                {
                    "media_id": "folder-1",
                    "media_type": 99,
                    "title": "想法",
                    "parent_folder_id": "root"
                },
                {
                    "media_id": "note-1",
                    "media_type": 11,
                    "title": "阅读笔记",
                    "parent_folder_id": "root"
                }
            ]
        });

        let items = parse_knowledge_items(&data);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "folder-1");
        assert_eq!(items[0].title, "想法");
        assert!(items[0].is_folder);
        assert!(!items[1].is_folder);
    }

    #[test]
    fn note_folder_preflight_normalizes_root_and_rejects_broken_parent_chains() {
        let folders = vec![
            ImaNoteFolder {
                folder_id: "root".to_string(),
                name: "全部笔记".to_string(),
                parent_folder_id: None,
                folder_type: 1,
                note_number: 0,
            },
            ImaNoteFolder {
                folder_id: "child".to_string(),
                name: "微信读书".to_string(),
                parent_folder_id: Some("root".to_string()),
                folder_type: 0,
                note_number: 0,
            },
        ];

        assert_eq!(canonical_note_folder_id("root", &folders).unwrap(), None);
        assert_eq!(
            canonical_note_folder_id("child", &folders).unwrap(),
            Some("child".to_string())
        );

        let broken = vec![ImaNoteFolder {
            folder_id: "child".to_string(),
            name: "微信读书".to_string(),
            parent_folder_id: Some("missing".to_string()),
            folder_type: 0,
            note_number: 0,
        }];
        let error = canonical_note_folder_id("child", &broken).unwrap_err();
        assert_eq!(error.code, "IMA_NOTE_FOLDER_INVALID");

        let duplicated = vec![
            ImaNoteFolder {
                folder_id: "child".to_string(),
                name: "微信读书".to_string(),
                parent_folder_id: None,
                folder_type: 0,
                note_number: 0,
            },
            ImaNoteFolder {
                folder_id: "child".to_string(),
                name: "重复目录".to_string(),
                parent_folder_id: None,
                folder_type: 0,
                note_number: 0,
            },
        ];
        let error = canonical_note_folder_id("child", &duplicated).unwrap_err();
        assert_eq!(error.code, "IMA_NOTE_FOLDER_INVALID");
    }

    #[test]
    fn knowledge_path_preflight_requires_a_complete_acyclic_parent_chain() {
        let valid = vec![
            ImaKnowledgePathFolder {
                folder_id: "root".to_string(),
                name: "根目录".to_string(),
                parent_folder_id: None,
            },
            ImaKnowledgePathFolder {
                folder_id: "target".to_string(),
                name: "阅读笔记".to_string(),
                parent_folder_id: Some("root".to_string()),
            },
        ];
        validate_knowledge_path(&valid, "target").unwrap();

        let mut broken = valid.clone();
        broken[1].parent_folder_id = Some("missing".to_string());
        let error = validate_knowledge_path(&broken, "target").unwrap_err();
        assert_eq!(error.code, "IMA_KNOWLEDGE_BASE_FOLDER_INVALID");

        let cyclic = vec![valid[0].clone(), valid[0].clone()];
        let error = validate_knowledge_path(&cyclic, "root").unwrap_err();
        assert_eq!(error.code, "IMA_KNOWLEDGE_BASE_FOLDER_INVALID");
    }

    #[test]
    fn response_payload_extracts_data_on_success() {
        let result = parse_response_payload(
            StatusCode::OK,
            Ok(json!({ "code": 0, "data": { "note_id": "note-1" } })),
            true,
        )
        .unwrap();

        assert_eq!(result, json!({ "note_id": "note-1" }));
    }

    #[test]
    fn response_payload_maps_business_and_http_errors_without_retry_signal() {
        let business_error = parse_response_payload(
            StatusCode::OK,
            Ok(json!({ "code": 20002, "msg": "请求过于频繁" })),
            true,
        )
        .unwrap_err();
        assert_eq!(business_error.code, "IMA_RATE_LIMITED");
        assert_eq!(business_error.business_code, Some(20002));
        assert!(!business_error.result_unknown);

        let http_error = parse_response_payload(
            StatusCode::TOO_MANY_REQUESTS,
            Ok(json!({ "code": 0 })),
            true,
        )
        .unwrap_err();
        assert_eq!(http_error.code, "IMA_RATE_LIMITED");
        assert!(!http_error.result_unknown);
    }

    #[test]
    fn invalid_success_payload_marks_write_result_as_unknown() {
        let error = parse_response_payload(StatusCode::OK, Err("invalid json".to_string()), true)
            .unwrap_err();

        assert_eq!(error.code, "IMA_RESPONSE_INVALID");
        assert!(error.result_unknown);
    }

    #[test]
    fn missing_resource_id_is_a_response_error() {
        let error = required_string(&json!({}), "note_id", "缺少 note_id").unwrap_err();

        assert_eq!(error.code, "IMA_RESPONSE_INVALID");
        assert!(error.result_unknown);
        assert_eq!(error.message, "缺少 note_id");
    }

    #[test]
    fn write_compatibility_requires_exact_non_empty_version_match() {
        assert!(!is_ima_write_compatible(None));
        assert!(!is_ima_write_compatible(Some("")));
        assert!(is_ima_write_compatible(Some("1.1.9")));
        assert!(!is_ima_write_compatible(Some("1.1.8")));
        assert!(!is_ima_write_compatible(Some("1.1.10")));
        assert!(!is_ima_write_compatible(Some("v1.1.9")));
        assert!(!is_ima_write_compatible(Some(" 1.1.9 ")));
        assert!(!is_ima_write_compatible(Some("not-a-version")));
    }

    #[test]
    fn compatibility_status_requires_a_current_successful_check() {
        assert_eq!(
            ima_compatibility_status(
                Some("1.1.9"),
                Some(IMA_ADAPTER_VERSION),
                Some("attempt-1"),
                Some("attempt-1"),
            ),
            ImaCompatibilityStatus::Compatible,
        );
        assert_eq!(
            ima_compatibility_status(
                Some("1.1.8"),
                Some(IMA_ADAPTER_VERSION),
                Some("attempt-1"),
                Some("attempt-1"),
            ),
            ImaCompatibilityStatus::Incompatible,
        );
        assert_eq!(
            ima_compatibility_status(
                Some("1.1.9"),
                Some("1.1.8"),
                Some("attempt-2"),
                Some("attempt-2"),
            ),
            ImaCompatibilityStatus::Unconfirmed,
        );
        assert_eq!(
            ima_compatibility_status(
                Some("1.1.9"),
                Some(IMA_ADAPTER_VERSION),
                Some("attempt-2"),
                Some("attempt-1"),
            ),
            ImaCompatibilityStatus::Unconfirmed,
        );
        assert_eq!(
            ima_compatibility_status(
                None,
                Some(IMA_ADAPTER_VERSION),
                Some("attempt-1"),
                Some("attempt-1"),
            ),
            ImaCompatibilityStatus::Unconfirmed,
        );
    }

    #[test]
    fn business_codes_map_to_stable_internal_codes() {
        let cases = [
            (20002, "IMA_RATE_LIMITED"),
            (110021, "IMA_RATE_LIMITED"),
            (20004, "IMA_AUTH_FAILED"),
            (100009, "IMA_CONTENT_TOO_LARGE"),
            (210009, "IMA_CONTENT_TOO_LARGE"),
            (310001, "IMA_NOTE_FOLDER_INVALID"),
            (210035, "IMA_NOTE_FOLDER_INVALID"),
            (210004, "IMA_STORAGE_FULL"),
            (210005, "IMA_NOTE_UNAVAILABLE"),
            (210006, "IMA_NOTE_UNAVAILABLE"),
            (210034, "IMA_NOTE_UNAVAILABLE"),
            (210008, "IMA_NOTE_CONFLICT"),
            (210011, "IMA_KNOWLEDGE_BASE_FORBIDDEN"),
            (110030, "IMA_KNOWLEDGE_BASE_FORBIDDEN"),
            (210036, "IMA_KNOWLEDGE_ADD_FAILED"),
            (210001, "IMA_REQUEST_INVALID"),
            (110001, "IMA_REQUEST_INVALID"),
            (110002, "IMA_REQUEST_INVALID"),
            (110012, "IMA_REQUEST_INVALID"),
            (110010, "IMA_REMOTE_TEMPORARY"),
            (110013, "IMA_REMOTE_TEMPORARY"),
            (110020, "IMA_CONTENT_REJECTED"),
            (999999, "IMA_REMOTE_ERROR"),
        ];

        for (business_code, expected_code) in cases {
            let error = parse_response_payload(
                StatusCode::OK,
                Ok(json!({ "code": business_code, "msg": "failed" })),
                true,
            )
            .unwrap_err();
            assert_eq!(error.code, expected_code);
            assert_eq!(error.business_code, Some(business_code));
            assert!(!error.result_unknown);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_sends_required_headers_path_and_import_body() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: r#"{"code":0,"data":{"note_id":"note-1"}}"#.to_string(),
        }]);
        let transport = test_transport(&format!("{base_url}/"));

        let note_id = transport
            .import_doc("## 中文 😀", Some(" folder-7 "))
            .await
            .expect("import should succeed");

        assert_eq!(note_id, "note-1");
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/openapi/note/v1/import_doc");
        assert_eq!(
            request.headers.get("ima-openapi-clientid"),
            Some(&"test-client-id".to_string())
        );
        assert_eq!(
            request.headers.get("ima-openapi-apikey"),
            Some(&"test-api-key".to_string())
        );
        assert_eq!(
            request.headers.get("ima-openapi-ctx"),
            Some(&format!("skill_version={IMA_ADAPTER_VERSION}"))
        );
        assert_eq!(request.body["content_format"], 1);
        assert_eq!(request.body["content"], "## 中文 😀");
        assert_eq!(request.body["folder_id"], "folder-7");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_builds_append_body_with_note_id() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: r#"{"code":0,"data":{"note_id":"note-1"}}"#.to_string(),
        }]);
        let transport = test_transport(&base_url);

        let note_id = transport
            .append_doc("note-1", "\n## 下一章")
            .await
            .expect("append should succeed");

        assert_eq!(note_id, "note-1");
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        let request = &requests[0];
        assert_eq!(request.path, "/openapi/note/v1/append_doc");
        assert_eq!(request.body["note_id"], "note-1");
        assert_eq!(request.body["content_format"], 1);
        assert_eq!(request.body["content"], "\n## 下一章");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drift_note_lookup_returns_the_current_notebook() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: r#"{"code":0,"data":{"note_book_list":[{"note_id":"note-1","note_ext_info":{"folder_id":"folder-2"}}],"is_end":true}}"#.to_string(),
        }]);
        let transport = test_transport(&base_url);

        let location = transport
            .locate_note("note-1")
            .await
            .expect("note lookup should succeed")
            .expect("note should be found");

        assert_eq!(location.folder_id.as_deref(), Some("folder-2"));
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].path, "/openapi/note/v1/list_note");
        assert_eq!(requests[0].body["folder_id"], "");
        assert_eq!(requests[0].body["cursor"], "");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn drift_knowledge_lookup_walks_nested_folders() {
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"knowledge_list":[{"folder_id":"folder-1","name":"阅读"}],"current_path":[],"is_end":true}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"knowledge_list":[{"media_id":"media-1","title":"阅读笔记","parent_folder_id":"folder-1"}],"current_path":[{"folder_id":"folder-1","name":"阅读"}],"is_end":true}}"#.to_string(),
            },
        ]);
        let transport = test_transport(&base_url);

        let location = transport
            .locate_knowledge_item("kb-1", "media-1")
            .await
            .expect("knowledge lookup should succeed")
            .expect("knowledge item should be found");

        assert_eq!(location.parent_folder_id.as_deref(), Some("folder-1"));
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["knowledge_base_id"], "kb-1");
        assert_eq!(requests[1].body["folder_id"], "folder-1");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_paginates_with_next_cursor_and_preserves_items() {
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"note_folder_infos":[{"folder_id":"folder-1","name":"第一本"}],"is_end":false,"next_cursor":"cursor-2"}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"note_folder_infos":[{"folder_id":"folder-2","name":"第二本"}],"is_end":true}}"#.to_string(),
            },
        ]);
        let transport = test_transport(&base_url);

        let folders = transport
            .list_note_folders()
            .await
            .expect("paginated folders should succeed");

        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].folder_id, "folder-1");
        assert_eq!(folders[1].folder_id, "folder-2");
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["cursor"], "0");
        assert_eq!(requests[0].body["limit"], 20);
        assert_eq!(requests[1].body["cursor"], "cursor-2");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pagination_rejects_a_cursor_cycle_without_returning_partial_items() {
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"note_folder_infos":[{"folder_id":"folder-1","name":"第一本"}],"is_end":false,"next_cursor":"cursor-2"}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"note_folder_infos":[{"folder_id":"folder-2","name":"第二本"}],"is_end":false,"next_cursor":"0"}}"#.to_string(),
            },
        ]);
        let transport = test_transport(&base_url);

        let error = transport
            .list_note_folders()
            .await
            .expect_err("cursor cycles must fail the complete read");

        assert_eq!(error.code, "IMA_PAGINATION_INVALID");
        server.join().expect("mock server should finish");
        assert_eq!(requests.lock().unwrap().len(), 2);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn knowledge_browse_preserves_a_consistent_current_path_across_pages() {
        let path = r#"[{"folder_id":"root","name":"根目录"},{"folder_id":"target","name":"阅读笔记","parent_folder_id":"root"}]"#;
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: format!(
                    r#"{{"code":0,"data":{{"knowledge_list":[{{"folder_id":"child","name":"子目录","parent_folder_id":"target"}}],"current_path":{path},"is_end":false,"next_cursor":"cursor-2"}}}}"#
                ),
            },
            MockResponse {
                status: 200,
                body: format!(
                    r#"{{"code":0,"data":{{"knowledge_list":[{{"media_id":"media-1","title":"笔记","parent_folder_id":"target"}}],"current_path":{path},"is_end":true}}}}"#
                ),
            },
        ]);
        let transport = test_transport(&base_url);

        let result = transport
            .list_knowledge_items("kb-1", Some("target"))
            .await
            .expect("knowledge pages should preserve the path");

        assert_eq!(result.items.len(), 2);
        assert_eq!(result.current_path.len(), 2);
        assert_eq!(result.current_path[1].folder_id, "target");
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["folder_id"], "target");
        assert_eq!(requests[1].body["cursor"], "cursor-2");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn knowledge_browse_rejects_path_changes_between_pages() {
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"knowledge_list":[],"current_path":[{"folder_id":"target","name":"原目录"}],"is_end":false,"next_cursor":"cursor-2"}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"knowledge_list":[],"current_path":[{"folder_id":"other","name":"其他目录"}],"is_end":true}}"#.to_string(),
            },
        ]);
        let transport = test_transport(&base_url);

        let error = transport
            .list_knowledge_items("kb-1", Some("target"))
            .await
            .expect_err("path changes must discard the paginated result");

        assert_eq!(error.code, "IMA_PAGINATION_INVALID");
        server.join().expect("mock server should finish");
        assert_eq!(requests.lock().unwrap().len(), 2);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn target_preflight_normalizes_roots_and_validates_nested_knowledge_folders() {
        let (base_url, requests, server) = spawn_mock_server(vec![
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"note_folder_infos":[{"folder_id":"all-notes","name":"全部笔记","folder_type":1}],"is_end":true}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"addable_knowledge_base_list":[{"id":"kb-1","name":"阅读知识库"}],"is_end":true}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"knowledge_list":[],"current_path":[{"folder_id":"root","name":"根目录"},{"folder_id":"target","name":"阅读笔记","parent_folder_id":"root"}],"is_end":true}}"#.to_string(),
            },
            MockResponse {
                status: 200,
                body: r#"{"code":0,"data":{"addable_knowledge_base_list":[{"id":"kb-1","name":"阅读知识库"}],"is_end":true}}"#.to_string(),
            },
        ]);
        let transport = test_transport(&base_url);

        let note_folder = transport
            .validate_note_folder(Some("all-notes"))
            .await
            .expect("the total notebook should map to root");
        let knowledge_folder = transport
            .validate_knowledge_base_target("kb-1", Some("target"))
            .await
            .expect("the nested folder should validate");
        let knowledge_root = transport
            .validate_knowledge_base_target("kb-1", Some("kb-1"))
            .await
            .expect("the knowledge base ID should map to root");

        assert_eq!(note_folder, None);
        assert_eq!(knowledge_folder, Some("target".to_string()));
        assert_eq!(knowledge_root, None);
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[2].body["folder_id"], "target");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_builds_knowledge_association_with_note_id() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: r#"{"code":0,"data":{"media_id":"media-1"}}"#.to_string(),
        }]);
        let transport = test_transport(&base_url);

        let media_id = transport
            .add_note_to_knowledge_base("note-1", "书籍笔记", "kb-1", Some(" kb-folder-2 "))
            .await
            .expect("knowledge association should succeed");

        assert_eq!(media_id, "media-1");
        server.join().expect("mock server should finish");
        let requests = requests.lock().unwrap();
        let request = &requests[0];
        assert_eq!(request.path, "/openapi/wiki/v1/add_knowledge");
        assert_eq!(request.body["media_type"], 11);
        assert_eq!(request.body["title"], "书籍笔记");
        assert_eq!(request.body["knowledge_base_id"], "kb-1");
        assert_eq!(request.body["note_info"]["content_id"], "note-1");
        assert_eq!(request.body["folder_id"], "kb-folder-2");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_maps_business_error_without_implicit_retry() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: r#"{"code":20002,"msg":"请求过于频繁"}"#.to_string(),
        }]);
        let transport = test_transport(&base_url);

        let error = transport
            .import_doc("内容", None)
            .await
            .expect_err("business error should fail");

        assert_eq!(error.code, "IMA_RATE_LIMITED");
        assert_eq!(error.business_code, Some(20002));
        assert!(!error.result_unknown);
        server.join().expect("mock server should finish");
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_maps_invalid_json_as_unknown_for_writes() {
        let (base_url, requests, server) = spawn_mock_server(vec![MockResponse {
            status: 200,
            body: "not-json".to_string(),
        }]);
        let transport = test_transport(&base_url);

        let error = transport
            .import_doc("内容", None)
            .await
            .expect_err("invalid response should fail");

        assert_eq!(error.code, "IMA_RESPONSE_INVALID");
        assert!(error.result_unknown);
        server.join().expect("mock server should finish");
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn transport_timeout_marks_write_result_as_unknown() {
        let (base_url, server) = spawn_silent_server();
        let http = Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(40))
            .build()
            .expect("timeout HTTP client should build");
        let transport = ImaTransport::with_client(
            http,
            ImaCredentials {
                client_id: "test-client-id".to_string(),
                api_key: "test-api-key".to_string(),
            },
            &base_url,
        );

        let error = transport
            .import_doc("内容", None)
            .await
            .expect_err("timeout should fail");

        assert_eq!(error.code, "IMA_REQUEST_TIMEOUT");
        assert!(error.result_unknown);
        server.join().expect("silent server should finish");
    }
}
