use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::reading_state::{ReadingItemState, ReadingItemStateInput, ReadingStateService},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCommandError {
    code: String,
    message: String,
}

impl From<AppError> for AppCommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.user_message(),
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
pub fn upsert_reading_item_state(
    app: AppHandle,
    input: ReadingItemStateInput,
) -> Result<ReadingItemState, AppCommandError> {
    ReadingStateService::new(app)
        .upsert_state(input)
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
