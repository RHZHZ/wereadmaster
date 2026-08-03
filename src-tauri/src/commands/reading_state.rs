use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::reading_state::{
        ReadingItemMeta, ReadingItemPatch, ReadingItemState, ReadingStateService,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCommandError {
    code: String,
    message: String,
    detail: Option<String>,
}

impl From<AppError> for AppCommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
            detail: error.diagnostic_message(),
        }
    }
}

#[tauri::command]
pub fn list_reading_item_states(app: AppHandle) -> Result<Vec<ReadingItemState>, AppCommandError> {
    ReadingStateService::new(app)
        .list_states()
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_reading_item_state(
    app: AppHandle,
    item_id: String,
) -> Result<Option<ReadingItemState>, AppCommandError> {
    ReadingStateService::new(app)
        .get_state(item_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn patch_reading_item_state(
    app: AppHandle,
    item_id: String,
    patch: ReadingItemPatch,
    meta: Option<ReadingItemMeta>,
) -> Result<ReadingItemState, AppCommandError> {
    ReadingStateService::new(app)
        .patch_state(item_id, patch, meta)
        .map_err(Into::into)
}

#[tauri::command]
pub fn remove_reading_item_state(
    app: AppHandle,
    item_id: String,
) -> Result<Option<ReadingItemState>, AppCommandError> {
    ReadingStateService::new(app)
        .remove_state(item_id)
        .map_err(Into::into)
}
