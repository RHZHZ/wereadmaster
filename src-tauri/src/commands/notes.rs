use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    export::bulk::BulkExportPreflight,
    mappers::notes::BookNotesRecord,
    services::notes::{
        BulkExportRequest, BulkExportResponse, ExportBookNotesMarkdownResponse,
        NotebookOverviewResponse, NotesService,
    },
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
pub async fn get_notebook_overview(
    app: AppHandle,
    count: Option<i64>,
) -> Result<NotebookOverviewResponse, AppCommandError> {
    NotesService::new(app)
        .get_notebook_overview(count)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_book_notes(
    app: AppHandle,
    book_id: String,
) -> Result<BookNotesRecord, AppCommandError> {
    NotesService::new(app)
        .get_book_notes(book_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn export_book_notes_markdown(
    app: AppHandle,
    book_id: String,
) -> Result<ExportBookNotesMarkdownResponse, AppCommandError> {
    NotesService::new(app)
        .export_book_notes_markdown(book_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn preflight_bulk_export(
    app: AppHandle,
    selected_book_ids: Option<Vec<String>>,
    exclude_without_exportable_notes: Option<bool>,
) -> Result<BulkExportPreflight, AppCommandError> {
    NotesService::new(app)
        .preflight_bulk_export(
            selected_book_ids,
            exclude_without_exportable_notes.unwrap_or(true),
        )
        .map_err(Into::into)
}

#[tauri::command]
pub async fn export_bulk_notes(
    app: AppHandle,
    request: BulkExportRequest,
) -> Result<BulkExportResponse, AppCommandError> {
    NotesService::new(app)
        .export_bulk_notes(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn cancel_bulk_export(app: AppHandle) -> Result<(), AppCommandError> {
    NotesService::new(app)
        .cancel_bulk_export()
        .map_err(Into::into)
}
