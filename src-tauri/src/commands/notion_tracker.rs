use serde::Serialize;
use tauri::AppHandle;

use crate::{
    export::notion_tracker::{
        analyze_tracker_template, connect_tracker_template, load_tracker_config,
        ConnectNotionTrackerResult, NotionTrackerConfig, TrackerTemplateAnalysis,
    },
    services::notion_credentials::NotionCredentialService,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionTrackerCommandError {
    code: String,
    message: String,
}

fn tracker_error(code: &str, message: impl Into<String>) -> NotionTrackerCommandError {
    NotionTrackerCommandError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn read_token(app: &AppHandle) -> Result<String, NotionTrackerCommandError> {
    NotionCredentialService::new(app.clone())
        .read_token()
        .map_err(|error| NotionTrackerCommandError {
            code: error.code().to_string(),
            message: error.user_message(),
        })
}

/// 只读分析模板首页：不产生任何 Notion 写入。
#[tauri::command]
pub async fn analyze_notion_tracker_template(
    app: AppHandle,
    parent_page_id: String,
) -> Result<TrackerTemplateAnalysis, NotionTrackerCommandError> {
    let token = read_token(&app)?;
    analyze_tracker_template(&token, &parent_page_id)
        .await
        .map_err(|message| tracker_error("notion_tracker_analyze_failed", message))
}

/// 用户确认后执行连接：补 Book ID 属性、建/复用阅读成果库、加 Relation，
/// 保存映射配置并把默认 Notion 导出目标切换到阅读成果库。
#[tauri::command]
pub async fn connect_notion_tracker_template(
    app: AppHandle,
    parent_page_id: String,
    book_library_id: String,
) -> Result<ConnectNotionTrackerResult, NotionTrackerCommandError> {
    let token = read_token(&app)?;
    connect_tracker_template(&app, &token, &parent_page_id, &book_library_id)
        .await
        .map_err(|message| tracker_error("notion_tracker_connect_failed", message))
}

#[tauri::command]
pub fn get_notion_tracker_config(
    app: AppHandle,
) -> Result<Option<NotionTrackerConfig>, NotionTrackerCommandError> {
    load_tracker_config(&app)
        .map_err(|message| tracker_error("notion_tracker_config_failed", message))
}
