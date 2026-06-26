use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::shelf::{BookshelfResponse, ShelfService},
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
pub async fn sync_shelf(app: AppHandle) -> Result<BookshelfResponse, AppCommandError> {
    ShelfService::new(app)
        .sync_shelf()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_bookshelf(app: AppHandle) -> Result<BookshelfResponse, AppCommandError> {
    ShelfService::new(app)
        .get_bookshelf()
        .await
        .map_err(Into::into)
}
