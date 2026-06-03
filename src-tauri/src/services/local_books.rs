use std::{
    fs::{self, File},
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::ZipArchive;

use crate::{db, errors::AppError};

const LOCAL_BOOKS_DIR: &str = "local-books";
const LOCAL_BOOK_SOURCE: &str = "local";
const SUPPORTED_FORMATS_MESSAGE: &str = "目前仅支持导入 EPUB、TXT 或 Markdown 文件。";
const TXT_EMPTY_ERROR_MESSAGE: &str = "当前 TXT 文件未提取到可阅读正文。";
const MARKDOWN_EMPTY_ERROR_MESSAGE: &str = "当前 Markdown 文件未提取到可阅读正文。";
const EPUB_PARSE_ERROR_MESSAGE: &str = "当前 EPUB 文件无法解析正文，请确认文件未损坏。";
const LOCAL_BOOK_SOURCE_TOO_LARGE_ERROR_MESSAGE: &str = "当前文件超过 100 MB，暂不支持导入。";
const LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE: &str = "当前图书正文过大，暂不支持直接阅读。";
const MAX_LOCAL_BOOK_SOURCE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_LOCAL_BOOK_TEXT_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Debug, Default)]
struct LocalBookMetadata {
    title: Option<String>,
    author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBookRecord {
    pub id: String,
    pub source: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub file_hash: String,
    pub file_size: i64,
    pub storage_path: String,
    pub cover_path: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalBookInput {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalBookResult {
    pub book: LocalBookRecord,
    pub was_already_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadingProgressRecord {
    pub book_id: String,
    pub locator: String,
    pub progress_percent: i64,
    pub read_time_seconds: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBookTextRecord {
    pub book_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalReadingProgressInput {
    pub book_id: String,
    pub locator: String,
    pub progress_percent: i64,
    pub read_time_seconds: Option<i64>,
}

pub struct LocalBooksService {
    app: AppHandle,
}

impl LocalBooksService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn import_book(
        &self,
        input: ImportLocalBookInput,
    ) -> Result<ImportLocalBookResult, AppError> {
        let source_path = normalize_import_path(&input.file_path)?;
        let data_dir = db::active_data_dir(&self.app).map_err(AppError::Storage)?;
        let mut connection = self.open_connection()?;

        import_local_book_with_result_into(
            &mut connection,
            &data_dir,
            &source_path,
            &current_unix_seconds(),
        )
    }

    pub fn list_books(&self) -> Result<Vec<LocalBookRecord>, AppError> {
        let connection = self.open_connection()?;
        read_local_books(&connection)
    }

    pub fn get_book(&self, book_id: String) -> Result<Option<LocalBookRecord>, AppError> {
        let normalized_book_id = normalize_required("bookId", &book_id, 160)?;
        let connection = self.open_connection()?;
        read_local_book(&connection, &normalized_book_id)
    }

    pub fn get_text(&self, book_id: String) -> Result<LocalBookTextRecord, AppError> {
        let normalized_book_id = normalize_required("bookId", &book_id, 160)?;
        let data_dir = db::active_data_dir(&self.app).map_err(AppError::Storage)?;
        let connection = self.open_connection()?;

        read_local_book_text(&connection, &data_dir, &normalized_book_id)
    }

    pub fn get_progress(
        &self,
        book_id: String,
    ) -> Result<Option<LocalReadingProgressRecord>, AppError> {
        let normalized_book_id = normalize_required("bookId", &book_id, 160)?;
        let connection = self.open_connection()?;
        read_local_reading_progress(&connection, &normalized_book_id)
    }

    pub fn save_progress(
        &self,
        input: SaveLocalReadingProgressInput,
    ) -> Result<LocalReadingProgressRecord, AppError> {
        let mut connection = self.open_connection()?;
        save_local_reading_progress(&mut connection, input, &current_unix_seconds())
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn import_local_book_into(
    connection: &mut rusqlite::Connection,
    data_dir: &Path,
    source_path: &Path,
    imported_at: &str,
) -> Result<LocalBookRecord, AppError> {
    import_local_book_with_result_into(connection, data_dir, source_path, imported_at)
        .map(|result| result.book)
}

fn import_local_book_with_result_into(
    connection: &mut rusqlite::Connection,
    data_dir: &Path,
    source_path: &Path,
    imported_at: &str,
) -> Result<ImportLocalBookResult, AppError> {
    let format = local_book_format(source_path)?;
    validate_import_source_size(&format, source_path)?;
    let (file_hash, file_size) = hash_file(source_path)?;

    if let Some(book) = read_local_book_by_hash(connection, &file_hash)? {
        let book = repair_existing_book_source(connection, data_dir, source_path, &book)?;
        return Ok(ImportLocalBookResult {
            book,
            was_already_imported: true,
        });
    }

    match format.as_str() {
        "txt" => {
            read_txt_book_text(source_path)?;
        }
        "epub" => {
            read_epub_book_text(source_path)?;
        }
        "markdown" => {
            read_markdown_book_text(source_path)?;
        }
        _ => {}
    }

    let book_id = local_book_id(&file_hash);
    let storage_path = canonical_local_book_storage_path(&book_id, &format)?;
    let target_path = data_dir.join(relative_path_buf(&storage_path));
    copy_local_book_source(source_path, &target_path)?;

    let fallback_title = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::trim)
        .filter(|stem| !stem.is_empty())
        .unwrap_or("未命名图书")
        .chars()
        .take(160)
        .collect::<String>();
    let metadata = match format.as_str() {
        "epub" => read_epub_metadata(source_path).unwrap_or_default(),
        "markdown" => read_markdown_metadata(source_path).unwrap_or_default(),
        _ => LocalBookMetadata::default(),
    };
    let title = metadata.title.unwrap_or(fallback_title);
    let author = metadata.author;
    let original_file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source")
        .chars()
        .take(240)
        .collect::<String>();
    let original_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.trim_start_matches('.').to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
        .unwrap_or_else(|| format.clone());

    let persist_result = (|| -> Result<(), AppError> {
        let transaction = connection.transaction().map_err(AppError::from)?;
        transaction
            .execute(
                "
                INSERT INTO local_books (
                    id,
                    title,
                    author,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    cover_path,
                    imported_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?8)
                ",
                rusqlite::params![
                    &book_id,
                    &title,
                    &author,
                    &format,
                    &file_hash,
                    file_size,
                    &storage_path,
                    imported_at
                ],
            )
            .map_err(AppError::from)?;
        transaction
            .execute(
                "
                INSERT INTO local_book_files (
                    id,
                    book_id,
                    original_file_name,
                    original_extension,
                    mime_type,
                    storage_path,
                    file_hash,
                    file_size,
                    imported_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
                rusqlite::params![
                    format!("{book_id}:source"),
                    &book_id,
                    &original_file_name,
                    &original_extension,
                    mime_type_for_format(&format),
                    &storage_path,
                    &file_hash,
                    file_size,
                    imported_at
                ],
            )
            .map_err(AppError::from)?;
        transaction.commit().map_err(AppError::from)?;

        Ok(())
    })();

    if let Err(error) = persist_result {
        cleanup_failed_import_copy(&target_path);
        return Err(error);
    }

    let book = read_local_book(connection, &book_id)?.ok_or_else(|| {
        AppError::Storage("local book import did not return a persisted row".to_string())
    })?;

    Ok(ImportLocalBookResult {
        book,
        was_already_imported: false,
    })
}

fn repair_existing_book_source(
    connection: &mut rusqlite::Connection,
    data_dir: &Path,
    source_path: &Path,
    book: &LocalBookRecord,
) -> Result<LocalBookRecord, AppError> {
    let canonical_storage_path = canonical_local_book_storage_path(&book.id, &book.format)?;
    let should_repair_storage_path = book.storage_path != canonical_storage_path;
    let target_storage_path = if should_repair_storage_path {
        canonical_storage_path
    } else {
        book.storage_path.clone()
    };
    let target_path = resolve_local_book_storage_path(data_dir, &target_storage_path)?;
    if target_path.is_file() && stored_book_source_matches(&target_path, book) {
        return repair_existing_book_storage_path(connection, book, &target_storage_path);
    }

    copy_local_book_source(source_path, &target_path)?;

    match repair_existing_book_storage_path(connection, book, &target_storage_path) {
        Ok(repaired_book) => Ok(repaired_book),
        Err(error) => {
            cleanup_failed_import_copy(&target_path);
            Err(error)
        }
    }
}

fn stored_book_source_matches(target_path: &Path, book: &LocalBookRecord) -> bool {
    let Ok(metadata) = fs::metadata(target_path) else {
        return false;
    };
    if !metadata.is_file() || i64::try_from(metadata.len()).ok() != Some(book.file_size) {
        return false;
    }

    hash_file(target_path)
        .map(|(file_hash, _)| file_hash == book.file_hash)
        .unwrap_or(false)
}

fn copy_local_book_source(source_path: &Path, target_path: &Path) -> Result<(), AppError> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Storage(error.to_string()))?;
    }

    let temporary_path = temporary_copy_path(target_path, "tmp");
    fs::copy(source_path, &temporary_path).map_err(|error| {
        cleanup_transient_copy_path(&temporary_path);
        AppError::Storage(error.to_string())
    })?;

    if !target_path.exists() {
        return fs::rename(&temporary_path, target_path).map_err(|error| {
            let _ = fs::remove_file(&temporary_path);
            AppError::Storage(error.to_string())
        });
    }

    let backup_path = temporary_copy_path(target_path, "bak");
    fs::rename(target_path, &backup_path).map_err(|error| {
        cleanup_transient_copy_path(&temporary_path);
        AppError::Storage(error.to_string())
    })?;

    fs::rename(&temporary_path, target_path).map_err(|error| {
        let _ = fs::rename(&backup_path, target_path);
        cleanup_transient_copy_path(&temporary_path);
        cleanup_transient_copy_path(&backup_path);
        AppError::Storage(error.to_string())
    })?;

    cleanup_transient_copy_path(&backup_path);

    Ok(())
}

fn temporary_copy_path(target_path: &Path, marker: &str) -> PathBuf {
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    target_path.with_file_name(format!(
        ".{file_name}.{marker}-{}-{nonce}",
        std::process::id()
    ))
}

fn repair_existing_book_storage_path(
    connection: &mut rusqlite::Connection,
    book: &LocalBookRecord,
    repaired_storage_path: &str,
) -> Result<LocalBookRecord, AppError> {
    if book.storage_path == repaired_storage_path {
        return Ok(book.clone());
    }

    {
        let transaction = connection.transaction().map_err(AppError::from)?;
        transaction
            .execute(
                "
                UPDATE local_books
                SET storage_path = ?1
                WHERE id = ?2
                ",
                rusqlite::params![repaired_storage_path, &book.id],
            )
            .map_err(AppError::from)?;
        transaction
            .execute(
                "
                UPDATE local_book_files
                SET storage_path = ?1
                WHERE book_id = ?2 AND file_hash = ?3
                ",
                rusqlite::params![repaired_storage_path, &book.id, &book.file_hash],
            )
            .map_err(AppError::from)?;
        transaction.commit().map_err(AppError::from)?;
    }

    read_local_book(connection, &book.id)?.ok_or_else(|| {
        AppError::Storage("local book repair did not return a persisted row".to_string())
    })
}

fn read_local_books(connection: &rusqlite::Connection) -> Result<Vec<LocalBookRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                id,
                title,
                author,
                format,
                file_hash,
                file_size,
                storage_path,
                cover_path,
                imported_at,
                updated_at
            FROM local_books
            ORDER BY updated_at DESC, title ASC, id ASC
            ",
        )
        .map_err(AppError::from)?;

    let books = statement
        .query_map([], map_local_book_row)
        .map_err(AppError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)?;

    Ok(books)
}

fn read_local_book(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<LocalBookRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT
                id,
                title,
                author,
                format,
                file_hash,
                file_size,
                storage_path,
                cover_path,
                imported_at,
                updated_at
            FROM local_books
            WHERE id = ?1
            ",
            [book_id],
            map_local_book_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn read_local_book_by_hash(
    connection: &rusqlite::Connection,
    file_hash: &str,
) -> Result<Option<LocalBookRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT
                id,
                title,
                author,
                format,
                file_hash,
                file_size,
                storage_path,
                cover_path,
                imported_at,
                updated_at
            FROM local_books
            WHERE file_hash = ?1
            ",
            [file_hash],
            map_local_book_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn map_local_book_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalBookRecord> {
    Ok(LocalBookRecord {
        id: row.get(0)?,
        source: LOCAL_BOOK_SOURCE.to_string(),
        title: row.get(1)?,
        author: row.get(2)?,
        format: row.get(3)?,
        file_hash: row.get(4)?,
        file_size: row.get(5)?,
        storage_path: row.get(6)?,
        cover_path: row.get(7)?,
        imported_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn read_local_book_text(
    connection: &rusqlite::Connection,
    data_dir: &Path,
    book_id: &str,
) -> Result<LocalBookTextRecord, AppError> {
    let book = read_local_book(connection, book_id)?
        .ok_or_else(|| AppError::InvalidPayload("本地图书不存在。".to_string()))?;

    let source_path = resolve_local_book_storage_path(data_dir, &book.storage_path)?;
    let content = match book.format.as_str() {
        "txt" => read_txt_book_text(&source_path)?,
        "epub" => read_epub_book_text(&source_path)?,
        "markdown" => read_markdown_book_text(&source_path)?,
        _ => {
            return Err(AppError::InvalidPayload(
                SUPPORTED_FORMATS_MESSAGE.to_string(),
            ))
        }
    };

    Ok(LocalBookTextRecord {
        book_id: book.id,
        content,
    })
}

fn read_txt_book_text(source_path: &Path) -> Result<String, AppError> {
    let content = read_utf8_text_source(
        source_path,
        "当前 TXT 文件不是 UTF-8 编码，暂无法直接阅读。",
    )?;
    if content.trim().is_empty() {
        return Err(AppError::InvalidPayload(
            TXT_EMPTY_ERROR_MESSAGE.to_string(),
        ));
    }

    Ok(content)
}

fn read_markdown_book_text(source_path: &Path) -> Result<String, AppError> {
    let content = read_utf8_text_source(
        source_path,
        "当前 Markdown 文件不是 UTF-8 文本，暂不支持导入。",
    )?;
    let (_, body) = parse_markdown_document(&content);
    if body.trim().is_empty() {
        return Err(AppError::InvalidPayload(
            MARKDOWN_EMPTY_ERROR_MESSAGE.to_string(),
        ));
    }

    Ok(body)
}

fn read_utf8_text_source(source_path: &Path, encoding_message: &str) -> Result<String, AppError> {
    validate_text_source_size(source_path)?;
    let bytes = fs::read(source_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            AppError::InvalidPayload("本地图书源文件不存在，请重新导入。".to_string())
        } else {
            AppError::Storage(error.to_string())
        }
    })?;

    String::from_utf8(bytes).map_err(|_| AppError::InvalidPayload(encoding_message.to_string()))
}

fn read_epub_book_text(source_path: &Path) -> Result<String, AppError> {
    let file = File::open(source_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            AppError::InvalidPayload("本地图书源文件不存在，请重新导入。".to_string())
        } else {
            AppError::Storage(error.to_string())
        }
    })?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| AppError::InvalidPayload(EPUB_PARSE_ERROR_MESSAGE.to_string()))?;
    let package_path = read_epub_package_path(&mut archive)?;
    let package = read_zip_entry_to_string(&mut archive, &package_path)?;
    let chapter_paths = read_epub_chapter_paths(&package_path, &package);
    if chapter_paths.is_empty() {
        return Err(AppError::InvalidPayload(
            EPUB_PARSE_ERROR_MESSAGE.to_string(),
        ));
    }

    let mut sections = Vec::new();
    let mut total_text_bytes = 0_usize;
    for chapter_path in chapter_paths {
        if let Ok(chapter) = read_zip_entry_to_string(&mut archive, &chapter_path) {
            let text = html_to_plain_text(&chapter);
            if !text.is_empty() {
                total_text_bytes = total_text_bytes
                    .saturating_add(text.len())
                    .saturating_add(if sections.is_empty() { 0 } else { 2 });
                if total_text_bytes > MAX_LOCAL_BOOK_TEXT_BYTES as usize {
                    return Err(AppError::InvalidPayload(
                        LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE.to_string(),
                    ));
                }
                sections.push(text);
            }
        }
    }

    let content = sections.join("\n\n");
    if content.trim().is_empty() {
        return Err(AppError::InvalidPayload(
            "当前 EPUB 文件未提取到可阅读正文。".to_string(),
        ));
    }

    Ok(content)
}

fn read_epub_metadata(source_path: &Path) -> Result<LocalBookMetadata, AppError> {
    let file = File::open(source_path).map_err(|error| AppError::Storage(error.to_string()))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| AppError::InvalidPayload(EPUB_PARSE_ERROR_MESSAGE.to_string()))?;
    let package_path = read_epub_package_path(&mut archive)?;
    let package = read_zip_entry_to_string(&mut archive, &package_path)?;

    Ok(LocalBookMetadata {
        title: extract_xml_text(&package, "title", 160),
        author: extract_xml_text(&package, "creator", 120),
    })
}

fn read_markdown_metadata(source_path: &Path) -> Result<LocalBookMetadata, AppError> {
    let content = read_utf8_text_source(
        source_path,
        "当前 Markdown 文件不是 UTF-8 文本，暂不支持导入。",
    )?;
    let (metadata, _) = parse_markdown_document(&content);

    Ok(metadata)
}

fn parse_markdown_document(content: &str) -> (LocalBookMetadata, String) {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let Some(front_matter_start) = content
        .strip_prefix("---\n")
        .map(|rest| content.len() - rest.len())
        .or_else(|| {
            content
                .strip_prefix("---\r\n")
                .map(|rest| content.len() - rest.len())
        })
    else {
        return (LocalBookMetadata::default(), content.to_string());
    };

    let mut line_start = front_matter_start;
    for line in content[front_matter_start..].split_inclusive('\n') {
        let line_end = line_start + line.len();
        let line_text = line.trim_end_matches(['\r', '\n']).trim();
        if line_text == "---" {
            let front_matter = &content[front_matter_start..line_start];
            let body = &content[line_end..];
            return (parse_markdown_front_matter(front_matter), body.to_string());
        }
        line_start = line_end;
    }

    (LocalBookMetadata::default(), content.to_string())
}

fn parse_markdown_front_matter(front_matter: &str) -> LocalBookMetadata {
    let mut metadata = LocalBookMetadata::default();

    for line in front_matter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = normalize_markdown_front_matter_value(value);
        match key.trim().to_ascii_lowercase().as_str() {
            "title" => metadata.title = normalize_metadata_text(&value, 160),
            "author" => metadata.author = normalize_metadata_text(&value, 120),
            _ => {}
        }
    }

    metadata
}

fn normalize_markdown_front_matter_value(value: &str) -> String {
    let trimmed = value.trim();
    let unquoted = if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };

    unquoted.trim().to_string()
}

fn read_epub_package_path(archive: &mut ZipArchive<File>) -> Result<String, AppError> {
    let container = read_zip_entry_to_string(archive, "META-INF/container.xml")?;
    for tag in find_xml_tags(&container, "rootfile") {
        if let Some(path) = extract_xml_attr(tag, "full-path")
            .and_then(|value| normalize_zip_path(&percent_decode_path(&value)))
        {
            return Ok(path);
        }
    }

    Err(AppError::InvalidPayload(
        EPUB_PARSE_ERROR_MESSAGE.to_string(),
    ))
}

fn read_epub_chapter_paths(package_path: &str, package: &str) -> Vec<String> {
    let mut manifest = std::collections::HashMap::new();
    for tag in find_xml_tags(package, "item") {
        let id = extract_xml_attr(tag, "id");
        let href = extract_xml_attr(tag, "href");
        let media_type = extract_xml_attr(tag, "media-type").unwrap_or_default();
        if let (Some(id), Some(href)) = (id, href) {
            let is_chapter = media_type == "application/xhtml+xml"
                || media_type == "text/html"
                || href.ends_with(".xhtml")
                || href.ends_with(".html")
                || href.ends_with(".htm");
            if is_chapter {
                if let Some(path) = resolve_epub_href(package_path, &href) {
                    manifest.insert(id, path);
                }
            }
        }
    }

    let mut paths = Vec::new();
    for tag in find_xml_tags(package, "itemref") {
        if let Some(idref) = extract_xml_attr(tag, "idref") {
            if let Some(path) = manifest.get(&idref) {
                paths.push(path.clone());
            }
        }
    }

    if paths.is_empty() {
        paths = manifest.into_values().collect();
        paths.sort();
    }

    dedupe_preserving_order(paths)
}

fn read_zip_entry_to_string(
    archive: &mut ZipArchive<File>,
    path: &str,
) -> Result<String, AppError> {
    let mut file = archive
        .by_name(path)
        .map_err(|_| AppError::InvalidPayload(EPUB_PARSE_ERROR_MESSAGE.to_string()))?;
    if file.size() > MAX_LOCAL_BOOK_TEXT_BYTES {
        return Err(AppError::InvalidPayload(
            LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE.to_string(),
        ));
    }
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|_| {
        AppError::InvalidPayload("EPUB 内部正文不是 UTF-8/XHTML 文本。".to_string())
    })?;
    Ok(content)
}

fn find_xml_tags<'a>(source: &'a str, tag_name: &str) -> Vec<&'a str> {
    let lower = source.to_ascii_lowercase();
    let pattern = format!("<{}", tag_name.to_ascii_lowercase());
    let mut tags = Vec::new();
    let mut cursor = 0;

    while let Some(offset) = lower[cursor..].find(&pattern) {
        let start = cursor + offset;
        let next = lower[start + pattern.len()..].chars().next();
        if !matches!(next, Some(' ' | '\n' | '\r' | '\t' | '/' | '>')) {
            cursor = start + pattern.len();
            continue;
        }

        if let Some(end_offset) = lower[start..].find('>') {
            let end = start + end_offset + 1;
            tags.push(&source[start..end]);
            cursor = end;
        } else {
            break;
        }
    }

    tags
}

fn extract_xml_text(source: &str, tag_name: &str, max_len: usize) -> Option<String> {
    let lower = source.to_ascii_lowercase();
    let tag_name = tag_name.to_ascii_lowercase();
    let mut cursor = 0;

    while let Some(offset) = lower[cursor..].find('<') {
        let start = cursor + offset;
        let after_open = start + 1;
        let Some(name_end_offset) = lower[after_open..]
            .find(|value: char| value.is_whitespace() || value == '/' || value == '>')
        else {
            break;
        };
        let name_end = after_open + name_end_offset;
        let raw_tag_name = &source[after_open..name_end];
        let local_name = raw_tag_name
            .rsplit_once(':')
            .map(|(_, name)| name)
            .unwrap_or(raw_tag_name)
            .to_ascii_lowercase();

        if local_name != tag_name || raw_tag_name.starts_with('/') {
            cursor = name_end;
            continue;
        }

        let Some(open_end_offset) = lower[name_end..].find('>') else {
            break;
        };
        let content_start = name_end + open_end_offset + 1;
        let close_tag = format!("</{}>", raw_tag_name.to_ascii_lowercase());
        let fallback_close_tag = format!("</{}>", tag_name);
        let Some(close_offset) = lower[content_start..]
            .find(&close_tag)
            .or_else(|| lower[content_start..].find(&fallback_close_tag))
        else {
            cursor = content_start;
            continue;
        };
        let content = &source[content_start..content_start + close_offset];

        return normalize_metadata_text(content, max_len);
    }

    None
}

fn extract_xml_attr(tag: &str, attr_name: &str) -> Option<String> {
    let mut rest = tag;
    while let Some(index) = rest.find(attr_name) {
        let before = rest[..index].chars().last();
        let after = &rest[index + attr_name.len()..];
        if before.is_some_and(is_xml_attr_name_char) {
            rest = after;
            continue;
        }

        let mut value = after.trim_start();
        if !value.starts_with('=') {
            rest = after;
            continue;
        }

        value = value[1..].trim_start();
        let quote = value.chars().next()?;
        if quote != '"' && quote != '\'' {
            rest = after;
            continue;
        }

        let value_start = quote.len_utf8();
        let value_body = &value[value_start..];
        let value_end = value_body.find(quote)?;
        return Some(decode_html_entities(&value_body[..value_end]));
    }

    None
}

fn normalize_metadata_text(value: &str, max_len: usize) -> Option<String> {
    let mut text = String::new();
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    let normalized = decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.is_empty() {
        None
    } else {
        Some(normalized.chars().take(max_len).collect())
    }
}

fn is_xml_attr_name_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, ':' | '_' | '-')
}

fn resolve_epub_href(package_path: &str, href: &str) -> Option<String> {
    let href = href.split('#').next()?.trim().replace('\\', "/");
    let href = percent_decode_path(&href);
    let combined = if href.starts_with('/') {
        href.trim_start_matches('/').to_string()
    } else if let Some((base_dir, _)) = package_path.rsplit_once('/') {
        format!("{base_dir}/{href}")
    } else {
        href
    };

    normalize_zip_path(&combined)
}

fn normalize_zip_path(path: &str) -> Option<String> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop()?;
            continue;
        }
        if part.contains('\\') || part.contains(':') {
            return None;
        }
        parts.push(part);
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn percent_decode_path(value: &str) -> String {
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

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn html_to_plain_text(source: &str) -> String {
    let mut output = String::new();
    let mut text = String::new();
    let mut chars = source.chars().peekable();
    let mut skipped_tag: Option<String> = None;

    while let Some(character) = chars.next() {
        if character != '<' {
            if skipped_tag.is_none() {
                text.push(character);
            }
            continue;
        }

        append_text_segment(&mut output, &mut text);

        let mut tag = String::new();
        for tag_character in chars.by_ref() {
            if tag_character == '>' {
                break;
            }
            tag.push(tag_character);
        }

        let tag_name = html_tag_name(&tag);
        if tag_name.is_empty() || tag_name.starts_with('!') || tag_name.starts_with('?') {
            continue;
        }

        let is_closing = tag.trim_start().starts_with('/');
        if let Some(skipped) = skipped_tag.as_deref() {
            if is_closing && tag_name == skipped {
                skipped_tag = None;
            }
            continue;
        }

        if !is_closing && matches!(tag_name.as_str(), "head" | "script" | "style" | "svg") {
            skipped_tag = Some(tag_name);
            continue;
        }

        if is_html_block_tag(&tag_name) {
            append_newline(&mut output);
        }
    }

    append_text_segment(&mut output, &mut text);
    normalize_extracted_text(&output)
}

fn append_text_segment(output: &mut String, text: &mut String) {
    let decoded = decode_html_entities(text);
    text.clear();
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return;
    }

    if output
        .chars()
        .last()
        .is_some_and(|value| !value.is_whitespace())
        && collapsed
            .chars()
            .next()
            .is_some_and(|value| value.is_ascii_alphanumeric())
    {
        output.push(' ');
    }
    output.push_str(&collapsed);
}

fn append_newline(output: &mut String) {
    if output.ends_with("\n\n") || output.is_empty() {
        return;
    }
    if !output.ends_with('\n') {
        output.push('\n');
    }
    output.push('\n');
}

fn html_tag_name(tag: &str) -> String {
    tag.trim_start()
        .trim_start_matches('/')
        .split(|value: char| value.is_whitespace() || value == '/' || value == '>')
        .next()
        .unwrap_or_default()
        .split(':')
        .next_back()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_html_block_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "address"
            | "article"
            | "aside"
            | "blockquote"
            | "br"
            | "caption"
            | "div"
            | "figcaption"
            | "figure"
            | "footer"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "hr"
            | "li"
            | "main"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "table"
            | "tbody"
            | "td"
            | "th"
            | "thead"
            | "tr"
            | "ul"
    )
}

fn normalize_extracted_text(text: &str) -> String {
    text.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        let after_ampersand = &rest[start + 1..];
        if let Some(end) = after_ampersand.find(';') {
            let entity = &after_ampersand[..end];
            if let Some(decoded) = decode_html_entity(entity) {
                output.push(decoded);
                rest = &after_ampersand[end + 1..];
                continue;
            }
        }

        output.push('&');
        rest = after_ampersand;
    }
    output.push_str(rest);
    output
}

fn decode_html_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "apos" => Some('\''),
        "gt" => Some('>'),
        "lt" => Some('<'),
        "nbsp" => Some(' '),
        "quot" => Some('"'),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn dedupe_preserving_order(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn read_local_reading_progress(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> Result<Option<LocalReadingProgressRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT
                book_id,
                locator,
                progress_percent,
                read_time_seconds,
                updated_at
            FROM local_reading_progress
            WHERE book_id = ?1
            ",
            [book_id],
            map_local_reading_progress_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn save_local_reading_progress(
    connection: &mut rusqlite::Connection,
    input: SaveLocalReadingProgressInput,
    updated_at: &str,
) -> Result<LocalReadingProgressRecord, AppError> {
    let book_id = normalize_required("bookId", &input.book_id, 160)?;
    let locator = normalize_required("locator", &input.locator, 1000)?;
    if !(0..=100).contains(&input.progress_percent) {
        return Err(AppError::InvalidPayload(
            "progressPercent 必须在 0 到 100 之间。".to_string(),
        ));
    }
    let read_time_seconds = input.read_time_seconds.unwrap_or(0);
    if read_time_seconds < 0 {
        return Err(AppError::InvalidPayload(
            "readTimeSeconds 不能小于 0。".to_string(),
        ));
    }
    if read_local_book(connection, &book_id)?.is_none() {
        return Err(AppError::InvalidPayload("本地图书不存在。".to_string()));
    }

    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute(
            "
            INSERT INTO local_reading_progress (
                book_id,
                locator,
                progress_percent,
                read_time_seconds,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(book_id) DO UPDATE SET
                locator = excluded.locator,
                progress_percent = excluded.progress_percent,
                read_time_seconds = excluded.read_time_seconds,
                updated_at = excluded.updated_at
            ",
            rusqlite::params![
                &book_id,
                &locator,
                input.progress_percent,
                read_time_seconds,
                updated_at
            ],
        )
        .map_err(AppError::from)?;
    transaction
        .execute(
            "
            UPDATE local_books
            SET updated_at = ?2
            WHERE id = ?1
            ",
            rusqlite::params![&book_id, updated_at],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;

    read_local_reading_progress(connection, &book_id)?.ok_or_else(|| {
        AppError::Storage("local reading progress upsert did not return a row".to_string())
    })
}

fn map_local_reading_progress_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<LocalReadingProgressRecord> {
    Ok(LocalReadingProgressRecord {
        book_id: row.get(0)?,
        locator: row.get(1)?,
        progress_percent: row.get(2)?,
        read_time_seconds: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn normalize_import_path(file_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = file_path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("filePath 不能为空。".to_string()));
    }
    let path = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path).map_err(|_| {
        AppError::InvalidPayload("请选择存在且可读取的 EPUB、TXT 或 Markdown 文件。".to_string())
    })?;
    if !metadata.is_file() {
        return Err(AppError::InvalidPayload(
            "请选择 EPUB、TXT 或 Markdown 文件，而不是文件夹。".to_string(),
        ));
    }
    local_book_format(&path)?;

    Ok(path)
}

fn local_book_format(path: &Path) -> Result<String, AppError> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.trim_start_matches('.').to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
        .ok_or_else(|| AppError::InvalidPayload(SUPPORTED_FORMATS_MESSAGE.to_string()))?;

    match extension.as_str() {
        "epub" | "txt" => Ok(extension),
        "md" | "markdown" => Ok("markdown".to_string()),
        _ => Err(AppError::InvalidPayload(
            SUPPORTED_FORMATS_MESSAGE.to_string(),
        )),
    }
}

fn validate_text_source_size(path: &Path) -> Result<(), AppError> {
    let metadata = fs::metadata(path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            AppError::InvalidPayload("本地图书源文件不存在，请重新导入。".to_string())
        } else {
            AppError::Storage(error.to_string())
        }
    })?;
    if metadata.len() > MAX_LOCAL_BOOK_TEXT_BYTES {
        return Err(AppError::InvalidPayload(
            LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE.to_string(),
        ));
    }

    Ok(())
}

fn validate_import_source_size(format: &str, path: &Path) -> Result<(), AppError> {
    let metadata = fs::metadata(path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            AppError::InvalidPayload("本地图书源文件不存在，请重新导入。".to_string())
        } else {
            AppError::Storage(error.to_string())
        }
    })?;
    let source_size = metadata.len();

    if matches!(format, "txt" | "markdown") && source_size > MAX_LOCAL_BOOK_TEXT_BYTES {
        return Err(AppError::InvalidPayload(
            LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE.to_string(),
        ));
    }

    if source_size > MAX_LOCAL_BOOK_SOURCE_BYTES {
        return Err(AppError::InvalidPayload(
            LOCAL_BOOK_SOURCE_TOO_LARGE_ERROR_MESSAGE.to_string(),
        ));
    }

    Ok(())
}

fn hash_file(path: &Path) -> Result<(String, i64), AppError> {
    let metadata = fs::metadata(path).map_err(|error| AppError::Storage(error.to_string()))?;
    let source_size = metadata.len();
    if source_size > MAX_LOCAL_BOOK_SOURCE_BYTES {
        return Err(AppError::InvalidPayload(
            LOCAL_BOOK_SOURCE_TOO_LARGE_ERROR_MESSAGE.to_string(),
        ));
    }
    let file_size = i64::try_from(source_size)
        .map_err(|_| AppError::InvalidPayload("文件过大，暂不支持导入。".to_string()))?;
    let mut file = File::open(path).map_err(|error| AppError::Storage(error.to_string()))?;
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| AppError::Storage(error.to_string()))?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    Ok((format!("fnv1a64-{hash:016x}-{file_size}"), file_size))
}

fn local_book_id(file_hash: &str) -> String {
    format!("local_{}", file_hash.replace('-', "_"))
}

fn canonical_local_book_storage_path(book_id: &str, format: &str) -> Result<String, AppError> {
    let book_id = book_id.trim();
    if book_id.is_empty()
        || book_id.contains('/')
        || book_id.contains('\\')
        || book_id.contains(':')
        || book_id == "."
        || book_id == ".."
    {
        return Err(AppError::InvalidPayload(
            "本地图书存储路径无效。".to_string(),
        ));
    }
    if !matches!(format, "epub" | "txt" | "markdown") {
        return Err(AppError::InvalidPayload(
            SUPPORTED_FORMATS_MESSAGE.to_string(),
        ));
    }

    let extension = if format == "markdown" { "md" } else { format };

    Ok(format!("{LOCAL_BOOKS_DIR}/{book_id}/source.{extension}"))
}

fn mime_type_for_format(format: &str) -> Option<&'static str> {
    match format {
        "epub" => Some("application/epub+zip"),
        "txt" => Some("text/plain"),
        "markdown" => Some("text/markdown"),
        _ => None,
    }
}

fn relative_path_buf(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn resolve_local_book_storage_path(
    data_dir: &Path,
    storage_path: &str,
) -> Result<PathBuf, AppError> {
    let trimmed = storage_path.trim();
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts.len() < 3 || parts.first() != Some(&LOCAL_BOOKS_DIR) {
        return Err(AppError::InvalidPayload(
            "本地图书存储路径无效。".to_string(),
        ));
    }

    let mut relative_path = PathBuf::new();
    for part in parts {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.contains('\\')
            || part.contains(':')
        {
            return Err(AppError::InvalidPayload(
                "本地图书存储路径无效。".to_string(),
            ));
        }
        relative_path.push(part);
    }

    Ok(data_dir.join(relative_path))
}

fn cleanup_failed_import_copy(target_path: &Path) {
    cleanup_transient_copy_path(target_path);

    if let Some(parent) = target_path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn cleanup_transient_copy_path(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let _ = fs::remove_dir_all(path);
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
}

fn normalize_required(field_name: &str, value: &str, max_len: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload(format!("{field_name} 不能为空。")));
    }
    if trimmed.chars().count() > max_len {
        return Err(AppError::InvalidPayload(format!("{field_name} 过长。")));
    }

    Ok(trimmed.to_string())
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{
        import_local_book_into, import_local_book_with_result_into, normalize_import_path,
        read_local_book, read_local_book_text, read_local_books, save_local_reading_progress,
        SaveLocalReadingProgressInput,
    };
    use crate::db::initialize_schema;

    #[test]
    fn import_local_book_copies_file_and_persists_metadata() {
        let temp_root = temp_dir("local-book-import");
        let source_path = temp_root.join("source").join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(source_path.parent().expect("source parent should exist"))
            .expect("source parent should be created");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n内容").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");

        assert_eq!(book.title, "样例书");
        assert_eq!(book.source, "local");
        assert!(book.id.starts_with("local_"));
        assert_eq!(book.format, "txt");
        assert_eq!(book.file_size, 16);
        assert!(data_dir
            .join(super::relative_path_buf(&book.storage_path))
            .is_file());
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let file_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM local_book_files", [], |row| {
                row.get(0)
            })
            .expect("file count should read");
        assert_eq!(file_count, 1);

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_cleans_copied_file_when_database_persist_fails() {
        let temp_root = temp_dir("local-book-import-cleanup");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n内容").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute_batch(
                "
                CREATE TRIGGER fail_local_book_file_insert
                BEFORE INSERT ON local_book_files
                BEGIN
                    SELECT RAISE(ABORT, 'forced local book file failure');
                END;
                ",
            )
            .expect("failure trigger should be installed");
        let (file_hash, _) = super::hash_file(&source_path).expect("file should hash");
        let book_id = super::local_book_id(&file_hash);
        let target_path = data_dir.join(super::relative_path_buf(&format!(
            "local-books/{book_id}/source.txt"
        )));

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("database failure should abort import");

        assert_eq!(error.code(), "local_storage_error");
        assert!(
            !target_path.exists(),
            "copied source should be removed after failed persistence"
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_returns_existing_record_for_same_file_hash() {
        let temp_root = temp_dir("local-book-dedupe");
        let source_path = temp_root.join("样例书.epub");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        write_minimal_epub(&source_path);
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let second =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200")
                .expect("second import should return existing book");

        assert!(!first.was_already_imported);
        assert!(second.was_already_imported);
        assert_eq!(first.book.id, second.book.id);
        assert_eq!(second.book.source, "local");
        assert_eq!(second.book.imported_at, "100");
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_repairs_missing_stored_source_for_existing_hash() {
        let temp_root = temp_dir("local-book-dedupe-repair");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let stored_path = data_dir.join(super::relative_path_buf(&first.book.storage_path));
        std::fs::remove_file(&stored_path).expect("stored source file should be removable");

        let second =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200")
                .expect("second import should repair existing source");
        let text = read_local_book_text(&connection, &data_dir, &first.book.id)
            .expect("repaired source text should read");

        assert!(second.was_already_imported);
        assert_eq!(second.book.id, first.book.id);
        assert!(stored_path.is_file());
        assert_eq!(text.content, "第一章\n本地阅读内容");
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_repairs_corrupted_stored_source_for_existing_hash() {
        let temp_root = temp_dir("local-book-dedupe-corrupt-repair");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let stored_path = data_dir.join(super::relative_path_buf(&first.book.storage_path));
        std::fs::write(&stored_path, "被污染的本地源文件")
            .expect("stored source should be corrupted");

        let second =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200")
                .expect("second import should repair corrupted source");
        let text = read_local_book_text(&connection, &data_dir, &first.book.id)
            .expect("repaired source text should read");

        assert!(second.was_already_imported);
        assert_eq!(second.book.id, first.book.id);
        assert_eq!(text.content, "第一章\n本地阅读内容");
        assert_no_transient_copy_files(stored_path.parent().expect("stored parent should exist"));
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_repairs_directory_polluted_stored_source_without_leaving_backup() {
        let temp_root = temp_dir("local-book-dedupe-directory-repair");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let stored_path = data_dir.join(super::relative_path_buf(&first.book.storage_path));
        std::fs::remove_file(&stored_path).expect("stored source file should be removable");
        std::fs::create_dir(&stored_path).expect("stored source path should be polluted as dir");

        let second =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200")
                .expect("second import should repair directory-polluted source");
        let text = read_local_book_text(&connection, &data_dir, &first.book.id)
            .expect("repaired source text should read");

        assert!(second.was_already_imported);
        assert_eq!(second.book.id, first.book.id);
        assert!(stored_path.is_file());
        assert_eq!(text.content, "第一章\n本地阅读内容");
        assert_no_transient_copy_files(stored_path.parent().expect("stored parent should exist"));
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_repairs_invalid_stored_source_path_for_existing_hash() {
        let temp_root = temp_dir("local-book-dedupe-path-repair");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let canonical_storage_path =
            super::canonical_local_book_storage_path(&first.book.id, &first.book.format)
                .expect("canonical path should build");
        let canonical_path = data_dir.join(super::relative_path_buf(&canonical_storage_path));
        std::fs::remove_file(&canonical_path).expect("canonical source file should be removable");
        connection
            .execute(
                "UPDATE local_books SET storage_path = ?1 WHERE id = ?2",
                rusqlite::params!["../bad/source.txt", &first.book.id],
            )
            .expect("book storage path should be corrupted for test");
        connection
            .execute(
                "UPDATE local_book_files SET storage_path = ?1 WHERE book_id = ?2",
                rusqlite::params!["../bad/source.txt", &first.book.id],
            )
            .expect("file storage path should be corrupted for test");

        let second =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200")
                .expect("second import should repair storage path");
        let file_storage_path = connection
            .query_row(
                "SELECT storage_path FROM local_book_files WHERE book_id = ?1",
                [&first.book.id],
                |row| row.get::<_, String>(0),
            )
            .expect("file storage path should read");
        let text = read_local_book_text(&connection, &data_dir, &first.book.id)
            .expect("repaired source text should read");

        assert!(second.was_already_imported);
        assert_eq!(second.book.id, first.book.id);
        assert_eq!(second.book.storage_path, canonical_storage_path);
        assert_eq!(file_storage_path, canonical_storage_path);
        assert!(canonical_path.is_file());
        assert_eq!(text.content, "第一章\n本地阅读内容");

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_cleans_repaired_copy_when_storage_path_repair_fails() {
        let temp_root = temp_dir("local-book-dedupe-path-repair-cleanup");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "100")
                .expect("first import should succeed");
        let canonical_storage_path =
            super::canonical_local_book_storage_path(&first.book.id, &first.book.format)
                .expect("canonical path should build");
        let canonical_path = data_dir.join(super::relative_path_buf(&canonical_storage_path));
        std::fs::remove_file(&canonical_path).expect("canonical source file should be removable");
        connection
            .execute(
                "UPDATE local_books SET storage_path = ?1 WHERE id = ?2",
                rusqlite::params!["../bad/source.txt", &first.book.id],
            )
            .expect("book storage path should be corrupted for test");
        connection
            .execute(
                "UPDATE local_book_files SET storage_path = ?1 WHERE book_id = ?2",
                rusqlite::params!["../bad/source.txt", &first.book.id],
            )
            .expect("file storage path should be corrupted for test");
        connection
            .execute_batch(
                "
                CREATE TRIGGER fail_local_book_storage_repair
                BEFORE UPDATE OF storage_path ON local_books
                BEGIN
                    SELECT RAISE(FAIL, 'storage repair blocked');
                END;
                ",
            )
            .expect("repair failure trigger should be created");

        let result =
            import_local_book_with_result_into(&mut connection, &data_dir, &source_path, "200");

        assert!(result.is_err());
        assert!(!canonical_path.exists());
        assert_no_transient_copy_files(
            canonical_path
                .parent()
                .expect("canonical parent should exist"),
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_uses_epub_metadata_when_available() {
        let temp_root = temp_dir("local-book-epub-metadata");
        let source_path = temp_root.join("fallback-name.epub");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        write_minimal_epub(&source_path);
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");

        assert_eq!(book.title, "星际散步 & 晚风");
        assert_eq!(book.author.as_deref(), Some("作者甲"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_reads_markdown_front_matter_and_body() {
        let temp_root = temp_dir("local-book-markdown");
        let source_path = temp_root.join("fallback-name.md");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(
            &source_path,
            "---\ntitle: Markdown 书\nauthor: 作者乙\n---\n# 第一章\n正文内容",
        )
        .expect("markdown source should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("markdown book should import");
        let text = read_local_book_text(&connection, &data_dir, &book.id)
            .expect("markdown text should read");
        let file_record = connection
            .query_row(
                "SELECT original_extension, mime_type FROM local_book_files WHERE book_id = ?1",
                [&book.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .expect("local book file should read");

        assert_eq!(book.title, "Markdown 书");
        assert_eq!(book.author.as_deref(), Some("作者乙"));
        assert_eq!(book.format, "markdown");
        assert!(book.storage_path.ends_with("/source.md"));
        assert_eq!(text.content, "# 第一章\n正文内容");
        assert_eq!(file_record.0, "md");
        assert_eq!(file_record.1.as_deref(), Some("text/markdown"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_supports_markdown_extension_fallback_title() {
        let temp_root = temp_dir("local-book-markdown-extension");
        let source_path = temp_root.join("长文档.markdown");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "## 章节\n正文内容")
            .expect("markdown source should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("markdown book should import");
        let original_extension: String = connection
            .query_row(
                "SELECT original_extension FROM local_book_files WHERE book_id = ?1",
                [&book.id],
                |row| row.get(0),
            )
            .expect("local book original extension should read");

        assert_eq!(book.title, "长文档");
        assert_eq!(book.format, "markdown");
        assert!(book.storage_path.ends_with("/source.md"));
        assert_eq!(original_extension, "markdown");

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_unsupported_format() {
        let temp_root = temp_dir("local-book-format");
        let source_path = temp_root.join("样例书.pdf");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "pdf").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let result = import_local_book_into(&mut connection, &data_dir, &source_path, "100");

        assert!(result.is_err());

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_oversized_source_file_without_persisting_record() {
        let temp_root = temp_dir("local-book-oversized-source");
        let source_path = temp_root.join("超大书.epub");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        let file = std::fs::File::create(&source_path).expect("source file should be created");
        file.set_len(super::MAX_LOCAL_BOOK_SOURCE_BYTES + 1)
            .expect("source file size should be set");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("oversized source should not import");

        assert_eq!(
            error.user_message(),
            super::LOCAL_BOOK_SOURCE_TOO_LARGE_ERROR_MESSAGE
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn normalize_import_path_rejects_missing_file_with_recovery_message() {
        let temp_root = temp_dir("local-book-missing-import");
        let source_path = temp_root.join("丢失的书.txt");

        let error = normalize_import_path(source_path.to_string_lossy().as_ref())
            .expect_err("missing file should be rejected");

        assert_eq!(
            error.user_message(),
            "请选择存在且可读取的 EPUB、TXT 或 Markdown 文件。"
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn local_book_id_uses_local_namespace_prefix() {
        let id = super::local_book_id("fnv1a64-abc-12");

        assert_eq!(id, "local_fnv1a64_abc_12");
    }

    #[test]
    fn read_local_book_text_returns_utf8_txt_content() {
        let temp_root = temp_dir("local-book-text");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");

        let text = read_local_book_text(&connection, &data_dir, &book.id)
            .expect("text content should read");

        assert_eq!(text.book_id, book.id);
        assert_eq!(text.content, "第一章\n本地阅读内容");

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn read_local_book_text_reports_missing_stored_source_file() {
        let temp_root = temp_dir("local-book-missing-source");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "第一章\n本地阅读内容")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");
        let stored_path = data_dir.join(super::relative_path_buf(&book.storage_path));
        std::fs::remove_file(stored_path).expect("stored source file should be removable");

        let error = read_local_book_text(&connection, &data_dir, &book.id)
            .expect_err("missing stored file should return a recovery error");

        assert_eq!(error.user_message(), "本地图书源文件不存在，请重新导入。");

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_non_utf8_txt_without_persisting_record() {
        let temp_root = temp_dir("local-book-non-utf8");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, [0xff, 0xfe, 0xfd]).expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("non UTF-8 TXT should not import");

        assert_eq!(
            error.user_message(),
            "当前 TXT 文件不是 UTF-8 编码，暂无法直接阅读。"
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_empty_txt_without_persisting_record() {
        let temp_root = temp_dir("local-book-empty-txt");
        let source_path = temp_root.join("空白书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, " \n\t ").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("empty TXT should not import");

        assert_eq!(error.user_message(), super::TXT_EMPTY_ERROR_MESSAGE);
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_non_utf8_markdown_without_persisting_record() {
        let temp_root = temp_dir("local-book-non-utf8-markdown");
        let source_path = temp_root.join("样例文档.md");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, [0xff, 0xfe, 0xfd]).expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("non UTF-8 Markdown should not import");

        assert_eq!(
            error.user_message(),
            "当前 Markdown 文件不是 UTF-8 文本，暂不支持导入。"
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_empty_markdown_without_persisting_record() {
        let temp_root = temp_dir("local-book-empty-markdown");
        let source_path = temp_root.join("空白文档.md");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "---\ntitle: 空白\n---\n \n\t ")
            .expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("empty Markdown should not import");

        assert_eq!(error.user_message(), super::MARKDOWN_EMPTY_ERROR_MESSAGE);
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_oversized_txt_without_persisting_record() {
        let temp_root = temp_dir("local-book-oversized-txt");
        let source_path = temp_root.join("超大书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        let file = std::fs::File::create(&source_path).expect("source file should be created");
        file.set_len(super::MAX_LOCAL_BOOK_TEXT_BYTES + 1)
            .expect("source file size should be set");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("oversized TXT should not import");

        assert_eq!(
            error.user_message(),
            super::LOCAL_BOOK_TEXT_TOO_LARGE_ERROR_MESSAGE
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn read_local_book_text_extracts_epub_spine_content() {
        let temp_root = temp_dir("local-book-epub-text");
        let source_path = temp_root.join("样例书.epub");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        write_minimal_epub(&source_path);
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");

        let text =
            read_local_book_text(&connection, &data_dir, &book.id).expect("epub text should read");

        assert_eq!(text.book_id, book.id);
        assert!(text.content.contains("第一章"));
        assert!(text.content.contains("EPUB 正文"));
        assert!(text.content.contains("内容&想法"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn import_local_book_rejects_broken_epub_without_persisting_record() {
        let temp_root = temp_dir("local-book-broken-epub");
        let source_path = temp_root.join("样例书.epub");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "not-a-zip").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let error = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect_err("broken EPUB should not import");

        assert_eq!(
            error.user_message(),
            "当前 EPUB 文件无法解析正文，请确认文件未损坏。"
        );
        assert_eq!(
            read_local_books(&connection)
                .expect("books should list")
                .len(),
            0
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn local_reading_progress_upserts_for_existing_local_book() {
        let temp_root = temp_dir("local-book-progress");
        let source_path = temp_root.join("样例书.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&source_path, "content").expect("source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let book = import_local_book_into(&mut connection, &data_dir, &source_path, "100")
            .expect("book should import");

        let progress = save_local_reading_progress(
            &mut connection,
            SaveLocalReadingProgressInput {
                book_id: book.id.clone(),
                locator: "text:0:4".to_string(),
                progress_percent: 12,
                read_time_seconds: Some(30),
            },
            "110",
        )
        .expect("progress should save");

        assert_eq!(progress.locator, "text:0:4");
        assert_eq!(progress.progress_percent, 12);
        assert_eq!(progress.read_time_seconds, 30);
        assert_eq!(
            read_local_book(&connection, &book.id)
                .expect("book should read")
                .expect("book should exist")
                .updated_at,
            "110"
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn local_reading_progress_updates_recent_reading_order() {
        let temp_root = temp_dir("local-book-progress-order");
        let first_source_path = temp_root.join("第一本.txt");
        let second_source_path = temp_root.join("第二本.txt");
        let data_dir = temp_root.join("data");
        std::fs::create_dir_all(&data_dir).expect("data dir should be created");
        std::fs::write(&first_source_path, "first").expect("first source file should be written");
        std::fs::write(&second_source_path, "second")
            .expect("second source file should be written");
        let mut connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let first = import_local_book_into(&mut connection, &data_dir, &first_source_path, "100")
            .expect("first book should import");
        let second = import_local_book_into(&mut connection, &data_dir, &second_source_path, "105")
            .expect("second book should import");

        save_local_reading_progress(
            &mut connection,
            SaveLocalReadingProgressInput {
                book_id: first.id.clone(),
                locator: "text:1:2".to_string(),
                progress_percent: 20,
                read_time_seconds: Some(60),
            },
            "110",
        )
        .expect("progress should save");

        let books = read_local_books(&connection).expect("books should list");
        assert_eq!(books[0].id, first.id);
        assert_eq!(books[1].id, second.id);

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "wxreadmaster-{name}-{}-{unique}",
            std::process::id()
        ))
    }

    fn assert_no_transient_copy_files(directory: &std::path::Path) {
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => panic!("directory should be readable: {error}"),
        };
        let has_transient_copy = entries.filter_map(Result::ok).any(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|file_name| file_name.contains(".tmp-") || file_name.contains(".bak-"))
                .unwrap_or(false)
        });

        assert!(!has_transient_copy);
    }

    fn write_minimal_epub(path: &std::path::Path) {
        let file = std::fs::File::create(path).expect("epub file should be created");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        zip.start_file("mimetype", options)
            .expect("mimetype should start");
        zip.write_all(b"application/epub+zip")
            .expect("mimetype should write");
        zip.start_file("META-INF/container.xml", options)
            .expect("container should start");
        zip.write_all(
            br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .expect("container should write");
        zip.start_file("OPS/content.opf", options)
            .expect("opf should start");
        zip.write_all(
            (r#"<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>星际散步 &amp; 晚风</dc:title>
    <dc:creator>作者甲</dc:creator>
  </metadata>
  <manifest>
    <item id="chapter-1" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>"#)
                .as_bytes(),
        )
        .expect("opf should write");
        zip.start_file("OPS/Text/chapter-1.xhtml", options)
            .expect("chapter should start");
        zip.write_all(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>忽略标题</title><style>body { color: red; }</style></head>
  <body>
    <h1>第一章</h1>
    <p>EPUB 正文 <strong>内容</strong>&amp;想法</p>
  </body>
</html>"#
                .as_bytes(),
        )
        .expect("chapter should write");
        zip.finish().expect("epub zip should finish");
    }
}
