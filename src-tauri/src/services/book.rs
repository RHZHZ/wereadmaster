use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::{
    db,
    errors::AppError,
    mappers::book::{
        map_book_detail_response, map_chapters_response, map_progress_response, BookDetailRecord,
        ChapterRecord, ReadingProgressRecord,
    },
    repositories::cache::RawCacheRepository,
    services::weread_gateway::{WereadApi, WereadGateway},
};

const BOOK_CACHE_NAMESPACE: &str = "book";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetailResponse {
    pub detail: BookDetailRecord,
    pub progress: ReadingProgressRecord,
    pub chapters: Vec<ChapterRecord>,
    pub deep_link: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBookLinkResult {
    pub opened: bool,
    pub deep_link: String,
    pub message: Option<String>,
}

pub struct BookService {
    app: AppHandle,
}

impl BookService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn get_book_detail(&self, book_id: String) -> Result<BookDetailResponse, AppError> {
        let normalized_book_id = normalize_book_id(&book_id)?;
        let gateway = WereadGateway::new(self.app.clone())?;

        let detail_raw = gateway
            .call(
                WereadApi::BookInfo,
                json!({ "bookId": &normalized_book_id }),
            )
            .await?;
        let progress_raw = gateway
            .call(
                WereadApi::BookProgress,
                json!({ "bookId": &normalized_book_id }),
            )
            .await?;
        let chapters_raw = gateway
            .call(
                WereadApi::BookChapters,
                json!({ "bookId": &normalized_book_id }),
            )
            .await?;

        let detail = map_book_detail_response(&normalized_book_id, &detail_raw);
        let progress = map_progress_response(&normalized_book_id, &progress_raw);
        let chapters = map_chapters_response(&normalized_book_id, &chapters_raw);
        let updated_at = current_unix_seconds();

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(AppError::from)?;
        upsert_book_detail(&transaction, &detail, &updated_at)?;
        upsert_book_progress(&transaction, &progress, &updated_at)?;
        replace_chapters(&transaction, &normalized_book_id, &chapters)?;
        RawCacheRepository::new(&transaction)
            .put_json(
                BOOK_CACHE_NAMESPACE,
                &format!("{normalized_book_id}:info"),
                &detail_raw,
                &updated_at,
            )
            .map_err(AppError::from)?;
        RawCacheRepository::new(&transaction)
            .put_json(
                BOOK_CACHE_NAMESPACE,
                &format!("{normalized_book_id}:progress"),
                &progress_raw,
                &updated_at,
            )
            .map_err(AppError::from)?;
        RawCacheRepository::new(&transaction)
            .put_json(
                BOOK_CACHE_NAMESPACE,
                &format!("{normalized_book_id}:chapters"),
                &chapters_raw,
                &updated_at,
            )
            .map_err(AppError::from)?;
        transaction.commit().map_err(AppError::from)?;

        Ok(BookDetailResponse {
            detail,
            progress,
            chapters,
            deep_link: reading_deep_link(&normalized_book_id, None),
        })
    }

    pub fn open_book_link(
        &self,
        book_id: String,
        chapter_uid: Option<i64>,
    ) -> Result<OpenBookLinkResult, AppError> {
        let normalized_book_id = normalize_book_id(&book_id)?;
        let deep_link = reading_deep_link(&normalized_book_id, chapter_uid);
        let result = open_deep_link(&deep_link);

        Ok(OpenBookLinkResult {
            opened: result.is_ok(),
            deep_link,
            message: result.err(),
        })
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn upsert_book_detail(
    connection: &rusqlite::Connection,
    detail: &BookDetailRecord,
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "
            INSERT INTO book_details (
                book_id,
                title,
                author,
                cover,
                category,
                intro,
                raw_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(book_id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                cover = excluded.cover,
                category = excluded.category,
                intro = excluded.intro,
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at
            ",
            rusqlite::params![
                &detail.book_id,
                &detail.title,
                &detail.author,
                &detail.cover,
                &detail.category,
                &detail.intro,
                &detail.raw_json,
                updated_at
            ],
        )
        .map_err(AppError::from)?;

    Ok(())
}

fn upsert_book_progress(
    connection: &rusqlite::Connection,
    progress: &ReadingProgressRecord,
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "
            INSERT INTO book_progress (
                book_id,
                progress_percent,
                chapter_uid,
                record_reading_time_seconds,
                finish_time,
                raw_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(book_id) DO UPDATE SET
                progress_percent = excluded.progress_percent,
                chapter_uid = excluded.chapter_uid,
                record_reading_time_seconds = excluded.record_reading_time_seconds,
                finish_time = excluded.finish_time,
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at
            ",
            rusqlite::params![
                &progress.book_id,
                progress.progress_percent,
                progress.chapter_uid,
                progress.record_reading_time_seconds,
                progress.finish_time,
                &progress.raw_json,
                updated_at
            ],
        )
        .map_err(AppError::from)?;

    Ok(())
}

fn replace_chapters(
    connection: &rusqlite::Connection,
    book_id: &str,
    chapters: &[ChapterRecord],
) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM chapters WHERE book_id = ?1", [book_id])
        .map_err(AppError::from)?;

    for chapter in chapters {
        connection
            .execute(
                "
                INSERT INTO chapters (
                    book_id,
                    chapter_uid,
                    chapter_idx,
                    title,
                    level,
                    word_count,
                    raw_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                rusqlite::params![
                    &chapter.book_id,
                    chapter.chapter_uid,
                    chapter.chapter_idx,
                    &chapter.title,
                    chapter.level,
                    chapter.word_count,
                    &chapter.raw_json
                ],
            )
            .map_err(AppError::from)?;
    }

    Ok(())
}

fn normalize_book_id(book_id: &str) -> Result<String, AppError> {
    let trimmed = book_id.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("bookId 不能为空。".to_string()));
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(AppError::InvalidPayload(
            "bookId 只能包含字母、数字、下划线或连字符。".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

fn reading_deep_link(book_id: &str, chapter_uid: Option<i64>) -> String {
    match chapter_uid {
        Some(uid) => format!("weread://reading?bId={book_id}&chapterUid={uid}"),
        None => format!("weread://reading?bId={book_id}"),
    }
}

#[cfg(target_os = "windows")]
fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", deep_link])
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(target_os = "macos")]
fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(deep_link)
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(target_os = "linux")]
fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(deep_link)
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn open_deep_link(_deep_link: &str) -> Result<(), String> {
    Err("当前系统暂不支持自动打开微信读书。".to_string())
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use crate::{
        db::initialize_schema,
        mappers::book::{map_book_detail_response, map_chapters_response, map_progress_response},
    };

    use super::{replace_chapters, upsert_book_detail, upsert_book_progress};

    #[test]
    fn book_cache_writes_detail_progress_and_chapters() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let detail = map_book_detail_response(
            "b1",
            &json!({ "bookId": "b1", "title": "书名", "author": "作者" }),
        );
        let progress = map_progress_response(
            "b1",
            &json!({ "book": { "bookId": "b1", "progress": 45, "chapterUid": 7 } }),
        );
        let chapters = map_chapters_response(
            "b1",
            &json!({ "chapters": [{ "chapterUid": 7, "chapterIdx": 1, "title": "第一章" }] }),
        );

        upsert_book_detail(&connection, &detail, "100").expect("detail should save");
        upsert_book_progress(&connection, &progress, "100").expect("progress should save");
        replace_chapters(&connection, "b1", &chapters).expect("chapters should save");

        let saved_title: String = connection
            .query_row(
                "SELECT title FROM book_details WHERE book_id = 'b1'",
                [],
                |row| row.get(0),
            )
            .expect("title should query");
        let saved_progress: i64 = connection
            .query_row(
                "SELECT progress_percent FROM book_progress WHERE book_id = 'b1'",
                [],
                |row| row.get(0),
            )
            .expect("progress should query");
        let saved_reading_time: Option<i64> = connection
            .query_row(
                "SELECT record_reading_time_seconds FROM book_progress WHERE book_id = 'b1'",
                [],
                |row| row.get(0),
            )
            .expect("reading time should query");
        let saved_chapter_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE book_id = 'b1'",
                [],
                |row| row.get(0),
            )
            .expect("chapter count should query");

        assert_eq!(saved_title, "书名");
        assert_eq!(saved_progress, 45);
        assert_eq!(saved_reading_time, None);
        assert_eq!(saved_chapter_count, 1);
    }
}
