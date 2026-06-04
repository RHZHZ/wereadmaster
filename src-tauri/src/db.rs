use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const DATABASE_FILE_NAME: &str = "reading-cache.sqlite3";
pub const DATA_DIRECTORY_CONFIG_FILE_NAME: &str = "local-data-directory.json";
const SQLITE_BUSY_TIMEOUT_MS: u64 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DataDirectoryConfig {
    custom_data_dir: Option<String>,
    custom_export_dir: Option<String>,
}

pub fn default_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    Ok(data_dir)
}

pub fn active_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let default_dir = default_data_dir(app)?;
    let data_dir = read_custom_data_directory_config(&default_dir)?.unwrap_or(default_dir);
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    Ok(data_dir)
}

pub fn default_export_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(active_data_dir(app)?.join("exports"))
}

pub fn active_export_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let default_dir = default_data_dir(app)?;
    let export_dir =
        read_custom_export_directory_config(&default_dir)?.unwrap_or(default_export_dir(app)?);
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;

    Ok(export_dir)
}

pub fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = active_data_dir(app)?;

    Ok(data_dir.join(DATABASE_FILE_NAME))
}

pub fn read_custom_data_directory_config(config_dir: &Path) -> Result<Option<PathBuf>, String> {
    let config_path = config_dir.join(DATA_DIRECTORY_CONFIG_FILE_NAME);
    if !config_path.is_file() {
        return Ok(None);
    }

    let config = read_data_directory_config(config_dir)?;

    Ok(config
        .custom_data_dir
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from))
}

pub fn write_custom_data_directory_config(
    config_dir: &Path,
    custom_data_dir: Option<&Path>,
) -> Result<(), String> {
    let mut config = read_data_directory_config(config_dir)?;
    config.custom_data_dir = custom_data_dir.map(|data_dir| data_dir.display().to_string());

    write_data_directory_config(config_dir, config)
}

pub fn read_custom_export_directory_config(config_dir: &Path) -> Result<Option<PathBuf>, String> {
    let config = read_data_directory_config(config_dir)?;

    Ok(config
        .custom_export_dir
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from))
}

pub fn write_custom_export_directory_config(
    config_dir: &Path,
    custom_export_dir: Option<&Path>,
) -> Result<(), String> {
    let mut config = read_data_directory_config(config_dir)?;
    config.custom_export_dir = custom_export_dir.map(|export_dir| export_dir.display().to_string());

    write_data_directory_config(config_dir, config)
}

fn read_data_directory_config(config_dir: &Path) -> Result<DataDirectoryConfig, String> {
    let config_path = config_dir.join(DATA_DIRECTORY_CONFIG_FILE_NAME);
    if !config_path.is_file() {
        return Ok(DataDirectoryConfig::default());
    }

    let content = fs::read_to_string(&config_path).map_err(|error| error.to_string())?;
    serde_json::from_str::<DataDirectoryConfig>(&content).map_err(|error| error.to_string())
}

fn write_data_directory_config(
    config_dir: &Path,
    config: DataDirectoryConfig,
) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let config_path = config_dir.join(DATA_DIRECTORY_CONFIG_FILE_NAME);

    if config.custom_data_dir.is_none() && config.custom_export_dir.is_none() {
        if config_path.exists() {
            fs::remove_file(config_path).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(config_path, content).map_err(|error| error.to_string())
}

pub fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    initialize_schema(&connection).map_err(|error| error.to_string())?;

    Ok(connection)
}

pub fn initialize_schema(connection: &Connection) -> SqliteResult<()> {
    connection.busy_timeout(Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let _ = connection.pragma_update(None, "journal_mode", "WAL");
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sync_state (
            section TEXT PRIMARY KEY NOT NULL,
            status TEXT NOT NULL,
            last_success_at TEXT,
            last_attempt_at TEXT,
            error_code TEXT,
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS shelf_entries (
            id TEXT PRIMARY KEY NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            category TEXT,
            is_top INTEGER NOT NULL DEFAULT 0,
            is_secret INTEGER NOT NULL DEFAULT 0,
            is_finished INTEGER,
            last_read_at INTEGER,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shelf_archives (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            book_ids_json TEXT NOT NULL,
            matched_entry_count INTEGER NOT NULL DEFAULT 0,
            missing_book_count INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS book_details (
            book_id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            category TEXT,
            intro TEXT,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS book_progress (
            book_id TEXT PRIMARY KEY NOT NULL,
            progress_percent INTEGER NOT NULL,
            chapter_uid INTEGER,
            record_reading_time_seconds INTEGER,
            finish_time INTEGER,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
            book_id TEXT NOT NULL,
            chapter_uid INTEGER NOT NULL,
            chapter_idx INTEGER NOT NULL,
            title TEXT NOT NULL,
            level INTEGER NOT NULL,
            word_count INTEGER,
            raw_json TEXT NOT NULL,
            PRIMARY KEY(book_id, chapter_uid)
        );

        CREATE TABLE IF NOT EXISTS notebook_books (
            book_id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            review_count INTEGER NOT NULL DEFAULT 0,
            note_count INTEGER NOT NULL DEFAULT 0,
            bookmark_count INTEGER NOT NULL DEFAULT 0,
            total_note_count INTEGER NOT NULL DEFAULT 0,
            sort INTEGER,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS highlights (
            bookmark_id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            chapter_uid INTEGER,
            chapter_title TEXT,
            mark_text TEXT NOT NULL,
            create_time INTEGER,
            range_text TEXT,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS thoughts (
            review_id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            content TEXT NOT NULL,
            abstract_text TEXT,
            create_time INTEGER,
            star INTEGER,
            chapter_name TEXT,
            chapter_uid INTEGER,
            range_text TEXT,
            deep_link TEXT,
            is_finish INTEGER,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reading_stats (
            mode TEXT NOT NULL,
            base_time INTEGER NOT NULL,
            total_read_time_seconds INTEGER,
            read_days INTEGER,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(mode, base_time)
        );

        CREATE TABLE IF NOT EXISTS raw_cache (
            namespace TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(namespace, cache_key)
        );

        CREATE TABLE IF NOT EXISTS ai_outputs (
            feature TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            output_json TEXT NOT NULL,
            source_count INTEGER,
            provider_model TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(feature, scope_id, prompt_version, input_hash)
        );

        CREATE TABLE IF NOT EXISTS ai_feedback_records (
            feature TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            item_kind TEXT NOT NULL,
            item_id TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(feature, scope_id, input_hash, item_kind, item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_feedback_records_scope_updated
            ON ai_feedback_records(feature, scope_id, updated_at);

        CREATE TABLE IF NOT EXISTS local_books (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            format TEXT NOT NULL CHECK(format IN ('epub', 'txt', 'markdown')),
            file_hash TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            storage_path TEXT NOT NULL,
            cover_path TEXT,
            imported_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(file_hash)
        );

        CREATE TABLE IF NOT EXISTS local_book_files (
            id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            original_file_name TEXT NOT NULL,
            original_extension TEXT NOT NULL,
            mime_type TEXT,
            storage_path TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            imported_at TEXT NOT NULL,
            FOREIGN KEY(book_id) REFERENCES local_books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS local_reading_progress (
            book_id TEXT PRIMARY KEY NOT NULL,
            locator TEXT NOT NULL,
            progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
            read_time_seconds INTEGER NOT NULL DEFAULT 0 CHECK(read_time_seconds >= 0),
            updated_at TEXT NOT NULL,
            FOREIGN KEY(book_id) REFERENCES local_books(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_local_books_updated
            ON local_books(updated_at);

        CREATE TABLE IF NOT EXISTS reading_item_states (
            item_id TEXT PRIMARY KEY NOT NULL,
            item_type TEXT NOT NULL,
            status TEXT NOT NULL,
            title TEXT,
            author TEXT,
            cover TEXT,
            category TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;
    add_column_if_missing(connection, "thoughts", "abstract_text", "TEXT")?;
    add_column_if_missing(connection, "thoughts", "chapter_uid", "INTEGER")?;
    add_column_if_missing(connection, "thoughts", "range_text", "TEXT")?;
    add_column_if_missing(connection, "thoughts", "deep_link", "TEXT")?;
    ensure_local_books_support_markdown(connection)?;
    ensure_local_reading_progress_schema(connection)?;

    Ok(())
}

fn ensure_local_reading_progress_schema(connection: &Connection) -> SqliteResult<()> {
    let table_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_reading_progress'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if let Some(sql) = table_sql.as_deref() {
        if !sql.to_ascii_lowercase().contains("book_id text primary key")
            || !table_references(connection, "local_reading_progress", "local_books")?
        {
            return rebuild_local_reading_progress_table(connection);
        }
    }

    add_column_if_missing(
        connection,
        "local_reading_progress",
        "locator",
        "TEXT NOT NULL DEFAULT 'text:0:0'",
    )?;
    add_column_if_missing(
        connection,
        "local_reading_progress",
        "progress_percent",
        "INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100)",
    )?;
    add_column_if_missing(
        connection,
        "local_reading_progress",
        "read_time_seconds",
        "INTEGER NOT NULL DEFAULT 0 CHECK(read_time_seconds >= 0)",
    )?;
    add_column_if_missing(
        connection,
        "local_reading_progress",
        "updated_at",
        "TEXT NOT NULL DEFAULT '0'",
    )
}

fn rebuild_local_reading_progress_table(connection: &Connection) -> SqliteResult<()> {
    let columns = table_columns(connection, "local_reading_progress")?;
    let has_book_id = columns.iter().any(|name| name == "book_id");
    let locator_expr = if columns.iter().any(|name| name == "locator") {
        "COALESCE(NULLIF(locator, ''), 'text:0:0')"
    } else {
        "'text:0:0'"
    };
    let progress_expr = if columns.iter().any(|name| name == "progress_percent") {
        "MIN(100, MAX(0, COALESCE(progress_percent, 0)))"
    } else {
        "0"
    };
    let read_time_expr = if columns.iter().any(|name| name == "read_time_seconds") {
        "MAX(0, COALESCE(read_time_seconds, 0))"
    } else {
        "0"
    };
    let updated_at_expr = if columns.iter().any(|name| name == "updated_at") {
        "COALESCE(NULLIF(updated_at, ''), '0')"
    } else {
        "'0'"
    };
    let book_id_expr = if has_book_id { "book_id" } else { "NULL" };
    let source_filter = if has_book_id {
        "
        WHERE book_id IS NOT NULL
            AND book_id != ''
            AND EXISTS (
                SELECT 1
                FROM local_books
                WHERE local_books.id = local_reading_progress_before_migration.book_id
            )
        "
    } else {
        "WHERE 0"
    };

    let migration = connection.execute_batch(&format!(
        "
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;

        ALTER TABLE local_reading_progress RENAME TO local_reading_progress_before_migration;

        CREATE TABLE local_reading_progress (
            book_id TEXT PRIMARY KEY NOT NULL,
            locator TEXT NOT NULL,
            progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
            read_time_seconds INTEGER NOT NULL DEFAULT 0 CHECK(read_time_seconds >= 0),
            updated_at TEXT NOT NULL,
            FOREIGN KEY(book_id) REFERENCES local_books(id) ON DELETE CASCADE
        );

        INSERT OR REPLACE INTO local_reading_progress (
            book_id,
            locator,
            progress_percent,
            read_time_seconds,
            updated_at
        )
        SELECT
            {book_id_expr},
            {locator_expr},
            {progress_expr},
            {read_time_expr},
            {updated_at_expr}
        FROM local_reading_progress_before_migration
        {source_filter};

        DROP TABLE local_reading_progress_before_migration;

        COMMIT;
        PRAGMA foreign_keys = ON;
        "
    ));

    if let Err(error) = migration {
        let _ = connection.execute_batch("ROLLBACK; PRAGMA foreign_keys = ON;");
        return Err(error);
    }

    Ok(())
}

fn ensure_local_books_support_markdown(connection: &Connection) -> SqliteResult<()> {
    let table_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_books'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if match table_sql.as_deref() {
        Some(sql) => sql.contains("'markdown'"),
        None => true,
    } {
        return Ok(());
    }

    let migration = connection.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;

        ALTER TABLE local_book_files RENAME TO local_book_files_before_markdown;
        ALTER TABLE local_books RENAME TO local_books_before_markdown;

        CREATE TABLE local_books (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            format TEXT NOT NULL CHECK(format IN ('epub', 'txt', 'markdown')),
            file_hash TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            storage_path TEXT NOT NULL,
            cover_path TEXT,
            imported_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(file_hash)
        );

        CREATE TABLE local_book_files (
            id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            original_file_name TEXT NOT NULL,
            original_extension TEXT NOT NULL,
            mime_type TEXT,
            storage_path TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            imported_at TEXT NOT NULL,
            FOREIGN KEY(book_id) REFERENCES local_books(id) ON DELETE CASCADE
        );

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
        FROM local_books_before_markdown;

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
        SELECT
            id,
            book_id,
            original_file_name,
            original_extension,
            mime_type,
            storage_path,
            file_hash,
            file_size,
            imported_at
        FROM local_book_files_before_markdown;

        DROP TABLE local_book_files_before_markdown;
        DROP TABLE local_books_before_markdown;

        CREATE INDEX IF NOT EXISTS idx_local_books_updated
            ON local_books(updated_at);

        COMMIT;
        PRAGMA foreign_keys = ON;
        ",
    );

    if let Err(error) = migration {
        let _ = connection.execute_batch("ROLLBACK; PRAGMA foreign_keys = ON;");
        return Err(error);
    }

    Ok(())
}

fn add_column_if_missing(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    column_type: &str,
) -> SqliteResult<()> {
    let columns = table_columns(connection, table_name)?;

    if columns.iter().any(|name| name == column_name) {
        return Ok(());
    }

    connection.execute(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"),
        [],
    )?;

    Ok(())
}

fn table_columns(connection: &Connection, table_name: &str) -> SqliteResult<Vec<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(columns)
}

fn table_references(
    connection: &Connection,
    table_name: &str,
    referenced_table_name: &str,
) -> SqliteResult<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA foreign_key_list({table_name})"))?;
    let referenced_tables = statement
        .query_map([], |row| row.get::<_, String>(2))?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(referenced_tables
        .iter()
        .any(|table| table == referenced_table_name))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{
        initialize_schema, read_custom_export_directory_config, SQLITE_BUSY_TIMEOUT_MS,
        write_custom_export_directory_config,
    };

    #[test]
    fn initialize_schema_creates_core_tables() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");

        initialize_schema(&connection).expect("schema should initialize");

        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
                    'sync_state',
                    'shelf_entries',
                    'book_details',
                    'book_progress',
                    'chapters',
                    'notebook_books',
                    'highlights',
                    'thoughts',
                    'reading_stats',
                    'raw_cache',
                    'ai_outputs',
                    'ai_feedback_records',
                    'local_books',
                    'local_book_files',
                    'local_reading_progress',
                    'reading_item_states'
                )",
                [],
                |row| row.get(0),
            )
            .expect("table count should be readable");

        assert_eq!(table_count, 16);
    }

    #[test]
    fn initialize_schema_sets_busy_timeout() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");

        initialize_schema(&connection).expect("schema should initialize");

        let timeout_ms: i64 = connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("busy timeout should read");

        assert_eq!(timeout_ms, SQLITE_BUSY_TIMEOUT_MS as i64);
    }

    #[test]
    fn local_books_enforce_file_hash_deduplication() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");

        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ",
                rusqlite::params![
                    "local_1",
                    "本地图书",
                    "epub",
                    "hash-1",
                    128,
                    "local-books/local_1/source.epub",
                    "100"
                ],
            )
            .expect("first local book should insert");

        let duplicate = connection.execute(
            "
            INSERT INTO local_books (
                id,
                title,
                format,
                file_hash,
                file_size,
                storage_path,
                imported_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            ",
            rusqlite::params![
                "local_2",
                "重复图书",
                "epub",
                "hash-1",
                128,
                "local-books/local_2/source.epub",
                "101"
            ],
        );

        assert!(duplicate.is_err());
    }

    #[test]
    fn local_books_allow_markdown_format() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");

        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ",
                rusqlite::params![
                    "local_markdown",
                    "Markdown 文档",
                    "markdown",
                    "hash-md",
                    256,
                    "local-books/local_markdown/source.md",
                    "100"
                ],
            )
            .expect("markdown local book should insert");

        let format: String = connection
            .query_row(
                "SELECT format FROM local_books WHERE id = 'local_markdown'",
                [],
                |row| row.get(0),
            )
            .expect("format should read");

        assert_eq!(format, "markdown");
    }

    #[test]
    fn initialize_schema_rebuilds_legacy_local_reading_progress_without_conflict_key() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE local_books (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    format TEXT NOT NULL CHECK(format IN ('epub', 'txt', 'markdown')),
                    file_hash TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    storage_path TEXT NOT NULL,
                    cover_path TEXT,
                    imported_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(file_hash)
                );
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (
                    'local_old',
                    '旧本地图书',
                    'txt',
                    'hash-old',
                    128,
                    'local-books/local_old/source.txt',
                    '100',
                    '100'
                );
                CREATE TABLE local_reading_progress (
                    book_id TEXT NOT NULL,
                    locator TEXT,
                    progress_percent INTEGER
                );
                INSERT INTO local_reading_progress (
                    book_id,
                    locator,
                    progress_percent
                )
                VALUES (
                    'local_old',
                    'text:20:100',
                    20
                );
                INSERT INTO local_reading_progress (
                    book_id,
                    locator,
                    progress_percent
                )
                VALUES (
                    'missing_local',
                    'text:30:100',
                    30
                );
                ",
            )
            .expect("legacy schema should be created");

        initialize_schema(&connection).expect("schema should migrate");

        connection
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
                rusqlite::params!["local_old", "text:50:100", 50, 12, "120"],
            )
            .expect("migrated progress table should support upsert");

        let row: (String, i64, i64, String) = connection
            .query_row(
                "
                SELECT locator, progress_percent, read_time_seconds, updated_at
                FROM local_reading_progress
                WHERE book_id = 'local_old'
                ",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("migrated progress should read");
        let missing_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_reading_progress WHERE book_id = 'missing_local'",
                [],
                |row| row.get(0),
            )
            .expect("orphan progress count should read");

        assert_eq!(row, ("text:50:100".to_string(), 50, 12, "120".to_string()));
        assert_eq!(missing_count, 0);
    }

    #[test]
    fn initialize_schema_rebuilds_local_reading_progress_with_stale_book_foreign_key() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = OFF;
                CREATE TABLE local_books (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    format TEXT NOT NULL CHECK(format IN ('epub', 'txt', 'markdown')),
                    file_hash TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    storage_path TEXT NOT NULL,
                    cover_path TEXT,
                    imported_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(file_hash)
                );
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (
                    'local_old',
                    '旧本地图书',
                    'txt',
                    'hash-old',
                    128,
                    'local-books/local_old/source.txt',
                    '100',
                    '100'
                );
                CREATE TABLE local_reading_progress (
                    book_id TEXT PRIMARY KEY NOT NULL,
                    locator TEXT NOT NULL,
                    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
                    read_time_seconds INTEGER NOT NULL DEFAULT 0 CHECK(read_time_seconds >= 0),
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(book_id) REFERENCES local_books_before_markdown(id) ON DELETE CASCADE
                );
                INSERT INTO local_reading_progress (
                    book_id,
                    locator,
                    progress_percent,
                    read_time_seconds,
                    updated_at
                )
                VALUES (
                    'local_old',
                    'text:20:100',
                    20,
                    8,
                    '110'
                );
                PRAGMA foreign_keys = ON;
                ",
            )
            .expect("stale progress schema should be created");

        initialize_schema(&connection).expect("schema should migrate stale progress foreign key");

        assert!(super::table_references(
            &connection,
            "local_reading_progress",
            "local_books"
        )
        .expect("progress foreign key should read"));
        assert!(!super::table_references(
            &connection,
            "local_reading_progress",
            "local_books_before_markdown"
        )
        .expect("stale progress foreign key should read"));
        connection
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
                rusqlite::params!["local_old", "text:70:100", 70, 20, "120"],
            )
            .expect("rebuilt progress table should support upsert");

        let row: (String, i64, i64, String) = connection
            .query_row(
                "
                SELECT locator, progress_percent, read_time_seconds, updated_at
                FROM local_reading_progress
                WHERE book_id = 'local_old'
                ",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("migrated progress should read");
        let foreign_key_error_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check should run");

        assert_eq!(row, ("text:70:100".to_string(), 70, 20, "120".to_string()));
        assert_eq!(foreign_key_error_count, 0);
    }

    #[test]
    fn initialize_schema_migrates_existing_local_books_constraint_for_markdown() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE local_books (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    format TEXT NOT NULL CHECK(format IN ('epub', 'txt')),
                    file_hash TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    storage_path TEXT NOT NULL,
                    cover_path TEXT,
                    imported_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(file_hash)
                );
                CREATE TABLE local_book_files (
                    id TEXT PRIMARY KEY NOT NULL,
                    book_id TEXT NOT NULL,
                    original_file_name TEXT NOT NULL,
                    original_extension TEXT NOT NULL,
                    mime_type TEXT,
                    storage_path TEXT NOT NULL,
                    file_hash TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    imported_at TEXT NOT NULL,
                    FOREIGN KEY(book_id) REFERENCES local_books(id) ON DELETE CASCADE
                );
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (
                    'local_old',
                    '旧本地图书',
                    'txt',
                    'hash-old',
                    128,
                    'local-books/local_old/source.txt',
                    '100',
                    '100'
                );
                INSERT INTO local_book_files (
                    id,
                    book_id,
                    original_file_name,
                    original_extension,
                    storage_path,
                    file_hash,
                    file_size,
                    imported_at
                )
                VALUES (
                    'local_old_file',
                    'local_old',
                    '旧本地图书.txt',
                    'txt',
                    'local-books/local_old/source.txt',
                    'hash-old',
                    128,
                    '100'
                );
                ",
            )
            .expect("old schema should be created");

        initialize_schema(&connection).expect("schema should migrate");
        connection
            .execute(
                "
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ",
                rusqlite::params![
                    "local_markdown",
                    "Markdown 文档",
                    "markdown",
                    "hash-md",
                    256,
                    "local-books/local_markdown/source.md",
                    "101"
                ],
            )
            .expect("markdown local book should insert after migration");

        let old_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_books WHERE id = 'local_old'",
                [],
                |row| row.get(0),
            )
            .expect("old local book should read");
        let file_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_book_files WHERE book_id = 'local_old'",
                [],
                |row| row.get(0),
            )
            .expect("old local book file should read");
        let foreign_key_error_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check should run");

        assert_eq!(old_count, 1);
        assert_eq!(file_count, 1);
        assert_eq!(foreign_key_error_count, 0);
    }

    #[test]
    fn local_books_are_isolated_from_weread_shelf_ids() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");

        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id,
                    type,
                    title,
                    raw_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                rusqlite::params!["shared-id", "book", "微信读书版本", "{}", "100"],
            )
            .expect("weread shelf entry should insert");
        connection
            .execute(
                "
                INSERT INTO local_books (
                    id,
                    title,
                    format,
                    file_hash,
                    file_size,
                    storage_path,
                    imported_at,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ",
                rusqlite::params![
                    "shared-id",
                    "本地版本",
                    "txt",
                    "hash-2",
                    64,
                    "local-books/shared-id/source.txt",
                    "101"
                ],
            )
            .expect("local book should not conflict with weread shelf id");

        let weread_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM shelf_entries WHERE id = 'shared-id'",
                [],
                |row| row.get(0),
            )
            .expect("weread count should read");
        let local_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_books WHERE id = 'shared-id'",
                [],
                |row| row.get(0),
            )
            .expect("local count should read");

        assert_eq!(weread_count, 1);
        assert_eq!(local_count, 1);
    }

    #[test]
    fn custom_export_directory_config_round_trips() {
        let temp_root = std::env::temp_dir().join("wxreadmaster-export-dir-config-test");
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        let export_dir = temp_root.join("exports-target");

        write_custom_export_directory_config(&temp_root, Some(&export_dir))
            .expect("custom export directory should persist");
        let loaded = read_custom_export_directory_config(&temp_root)
            .expect("custom export directory should load")
            .expect("custom export directory should be configured");

        assert_eq!(loaded, export_dir);

        write_custom_export_directory_config(&temp_root, None)
            .expect("custom export directory config should clear");
        assert!(read_custom_export_directory_config(&temp_root)
            .expect("custom export directory config should load")
            .is_none());

        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
