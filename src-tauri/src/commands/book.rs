use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::book::{BookDetailResponse, BookService, OpenBookLinkResult},
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
pub async fn get_book_detail(
    app: AppHandle,
    book_id: String,
) -> Result<BookDetailResponse, AppCommandError> {
    BookService::new(app)
        .get_book_detail(book_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn open_book_in_weread(
    app: AppHandle,
    book_id: String,
    chapter_uid: Option<i64>,
) -> Result<OpenBookLinkResult, AppCommandError> {
    BookService::new(app)
        .open_book_link(book_id, chapter_uid)
        .map_err(Into::into)
}
