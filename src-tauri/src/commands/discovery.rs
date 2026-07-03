use serde::Serialize;
use tauri::AppHandle;

use crate::{
    errors::AppError,
    services::discovery::{
        BestBookmarksResponse, DiscoveryService, PublicReviewsResponse, ReadReviewsResponse,
        RecommendationsResponse, SearchBooksResponse, SimilarBooksResponse,
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
pub async fn search_books(
    app: AppHandle,
    keyword: String,
    scope: Option<i64>,
    max_idx: Option<i64>,
    count: Option<i64>,
) -> Result<SearchBooksResponse, AppCommandError> {
    DiscoveryService::new(app)
        .search_books(keyword, scope, max_idx, count)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_recommendations(
    app: AppHandle,
    count: Option<i64>,
    max_idx: Option<i64>,
) -> Result<RecommendationsResponse, AppCommandError> {
    DiscoveryService::new(app)
        .get_recommendations(count, max_idx)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_similar_books(
    app: AppHandle,
    book_id: String,
    count: Option<i64>,
    max_idx: Option<i64>,
    session_id: Option<String>,
) -> Result<SimilarBooksResponse, AppCommandError> {
    DiscoveryService::new(app)
        .get_similar_books(book_id, count, max_idx, session_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_public_reviews(
    app: AppHandle,
    book_id: String,
    review_list_type: Option<i64>,
    count: Option<i64>,
    max_idx: Option<i64>,
    synckey: Option<i64>,
) -> Result<PublicReviewsResponse, AppCommandError> {
    DiscoveryService::new(app)
        .get_public_reviews(book_id, review_list_type, count, max_idx, synckey)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_best_bookmarks(
    app: AppHandle,
    book_id: String,
    chapter_uid: Option<i64>,
    synckey: Option<i64>,
) -> Result<BestBookmarksResponse, AppCommandError> {
    DiscoveryService::new(app)
        .get_best_bookmarks(book_id, chapter_uid, synckey)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_read_reviews(
    app: AppHandle,
    book_id: String,
    chapter_uid: i64,
    range: String,
    count: Option<i64>,
    max_idx: Option<i64>,
    synckey: Option<i64>,
) -> Result<ReadReviewsResponse, AppCommandError> {
    DiscoveryService::new(app)
        .get_read_reviews(book_id, chapter_uid, range, count, max_idx, synckey)
        .await
        .map_err(Into::into)
}
