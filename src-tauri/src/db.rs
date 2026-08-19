use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::atomic_file;

pub const DATABASE_FILE_NAME: &str = "reading-cache.sqlite3";
pub const DATA_DIRECTORY_CONFIG_FILE_NAME: &str = "local-data-directory.json";
const SQLITE_BUSY_TIMEOUT_MS: u64 = 5_000;
const READING_STATE_PRE_MIGRATION_BACKUP_DIR: &str = "reading-state-v1-pre-migration";
const LOCAL_DATA_BACKUP_MANIFEST_FILE: &str = "manifest.json";
const LOCAL_DATA_BACKUP_KIND: &str = "wxreadmaster-local-data-backup";
const LOCAL_DATA_BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalDataBackupManifest {
    kind: String,
    schema_version: u32,
    exported_at: String,
    database_file: String,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionPropertyMappingConfig {
    pub logical_field: String,
    pub property_id: String,
    pub property_name_snapshot: String,
    pub property_type: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionDatabaseConnectionConfig {
    pub database_id: String,
    pub database_name: Option<String>,
    pub database_url: Option<String>,
    pub title_property_id: String,
    pub title_property_name_snapshot: String,
    #[serde(default)]
    pub mappings: Vec<NotionPropertyMappingConfig>,
    pub schema_checked_at: String,
    pub schema_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImaAssetRouteConfig {
    pub note_folder_id: Option<String>,
    pub knowledge_base_id: Option<String>,
    pub knowledge_base_folder_id: Option<String>,
    pub publish_to_knowledge_base: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DataDirectoryConfig {
    custom_data_dir: Option<String>,
    custom_export_dir: Option<String>,
    weread_proxy_url: Option<String>,
    obsidian_vault_dir: Option<String>,
    obsidian_attachment_mode: Option<String>,
    obsidian_open_after_export: Option<bool>,
    notion_parent_id: Option<String>,
    notion_parent_type: Option<String>,
    notion_cover_mode: Option<String>,
    notion_database_connection: Option<NotionDatabaseConnectionConfig>,
    ima_note_folder_id: Option<String>,
    ima_knowledge_base_id: Option<String>,
    ima_knowledge_base_folder_id: Option<String>,
    ima_publish_to_knowledge_base: Option<bool>,
    #[serde(default)]
    ima_asset_routes: BTreeMap<String, ImaAssetRouteConfig>,
    ima_update_checked_date: Option<String>,
    ima_update_checked_adapter_version: Option<String>,
    ima_update_last_attempt_at: Option<String>,
    ima_update_last_success_at: Option<String>,
    ima_latest_version: Option<String>,
    ima_release_desc: Option<String>,
    ima_update_instruction: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct IntegrationConfig {
    pub obsidian_vault_dir: Option<String>,
    pub obsidian_attachment_mode: Option<String>,
    pub obsidian_open_after_export: bool,
    pub notion_parent_id: Option<String>,
    pub notion_parent_type: Option<String>,
    pub notion_cover_mode: Option<String>,
    pub notion_database_connection: Option<NotionDatabaseConnectionConfig>,
    pub ima_note_folder_id: Option<String>,
    pub ima_knowledge_base_id: Option<String>,
    pub ima_knowledge_base_folder_id: Option<String>,
    pub ima_publish_to_knowledge_base: bool,
    pub ima_asset_routes: BTreeMap<String, ImaAssetRouteConfig>,
    pub ima_update_checked_date: Option<String>,
    pub ima_update_checked_adapter_version: Option<String>,
    pub ima_update_last_attempt_at: Option<String>,
    pub ima_update_last_success_at: Option<String>,
    pub ima_latest_version: Option<String>,
    pub ima_release_desc: Option<String>,
    pub ima_update_instruction: Option<String>,
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

pub fn read_weread_proxy_url_config(config_dir: &Path) -> Result<Option<String>, String> {
    let config = read_data_directory_config(config_dir)?;

    Ok(config
        .weread_proxy_url
        .filter(|proxy_url| !proxy_url.trim().is_empty()))
}

pub fn write_weread_proxy_url_config(
    config_dir: &Path,
    proxy_url: Option<&str>,
) -> Result<(), String> {
    let mut config = read_data_directory_config(config_dir)?;
    config.weread_proxy_url = proxy_url.map(str::to_string);

    write_data_directory_config(config_dir, config)
}

pub fn read_integration_config(config_dir: &Path) -> Result<IntegrationConfig, String> {
    let config = read_data_directory_config(config_dir)?;
    Ok(IntegrationConfig {
        obsidian_vault_dir: config.obsidian_vault_dir,
        obsidian_attachment_mode: config.obsidian_attachment_mode,
        obsidian_open_after_export: config.obsidian_open_after_export.unwrap_or(false),
        notion_parent_id: config.notion_parent_id,
        notion_parent_type: config.notion_parent_type,
        notion_cover_mode: config.notion_cover_mode,
        notion_database_connection: config.notion_database_connection,
        ima_note_folder_id: config.ima_note_folder_id,
        ima_knowledge_base_id: config.ima_knowledge_base_id,
        ima_knowledge_base_folder_id: config.ima_knowledge_base_folder_id,
        ima_publish_to_knowledge_base: config.ima_publish_to_knowledge_base.unwrap_or(false),
        ima_asset_routes: config.ima_asset_routes,
        ima_update_checked_date: config.ima_update_checked_date,
        ima_update_checked_adapter_version: config.ima_update_checked_adapter_version,
        ima_update_last_attempt_at: config.ima_update_last_attempt_at,
        ima_update_last_success_at: config.ima_update_last_success_at,
        ima_latest_version: config.ima_latest_version,
        ima_release_desc: config.ima_release_desc,
        ima_update_instruction: config.ima_update_instruction,
    })
}

pub fn write_integration_config(
    config_dir: &Path,
    integration: &IntegrationConfig,
) -> Result<(), String> {
    let mut config = read_data_directory_config(config_dir)?;
    config.obsidian_vault_dir = integration.obsidian_vault_dir.clone();
    config.obsidian_attachment_mode = integration.obsidian_attachment_mode.clone();
    config.obsidian_open_after_export = Some(integration.obsidian_open_after_export);
    config.notion_parent_id = integration.notion_parent_id.clone();
    config.notion_parent_type = integration.notion_parent_type.clone();
    config.notion_cover_mode = integration.notion_cover_mode.clone();
    config.notion_database_connection = integration.notion_database_connection.clone();
    config.ima_note_folder_id = integration.ima_note_folder_id.clone();
    config.ima_knowledge_base_id = integration.ima_knowledge_base_id.clone();
    config.ima_knowledge_base_folder_id = integration.ima_knowledge_base_folder_id.clone();
    config.ima_publish_to_knowledge_base = Some(integration.ima_publish_to_knowledge_base);
    config.ima_asset_routes = integration.ima_asset_routes.clone();
    config.ima_update_checked_date = integration.ima_update_checked_date.clone();
    config.ima_update_checked_adapter_version =
        integration.ima_update_checked_adapter_version.clone();
    config.ima_update_last_attempt_at = integration.ima_update_last_attempt_at.clone();
    config.ima_update_last_success_at = integration.ima_update_last_success_at.clone();
    config.ima_latest_version = integration.ima_latest_version.clone();
    config.ima_release_desc = integration.ima_release_desc.clone();
    config.ima_update_instruction = integration.ima_update_instruction.clone();
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

    if config.custom_data_dir.is_none()
        && config.custom_export_dir.is_none()
        && config.weread_proxy_url.is_none()
        && config.obsidian_vault_dir.is_none()
        && config.obsidian_attachment_mode.is_none()
        && config.obsidian_open_after_export.is_none()
        && config.notion_parent_id.is_none()
        && config.notion_parent_type.is_none()
        && config.notion_cover_mode.is_none()
        && config.notion_database_connection.is_none()
        && config.ima_note_folder_id.is_none()
        && config.ima_knowledge_base_id.is_none()
        && config.ima_knowledge_base_folder_id.is_none()
        && config.ima_publish_to_knowledge_base.is_none()
        && config.ima_asset_routes.is_empty()
        && config.ima_update_checked_date.is_none()
        && config.ima_update_checked_adapter_version.is_none()
        && config.ima_update_last_attempt_at.is_none()
        && config.ima_update_last_success_at.is_none()
        && config.ima_latest_version.is_none()
        && config.ima_release_desc.is_none()
        && config.ima_update_instruction.is_none()
    {
        if config_path.exists() {
            fs::remove_file(config_path).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    atomic_file::write_bytes(&config_path, content.as_bytes()).map_err(|error| error.to_string())
}

pub fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    ensure_reading_state_pre_migration_backup(&path, &connection)?;
    initialize_schema(&connection).map_err(|error| error.to_string())?;

    Ok(connection)
}

fn ensure_reading_state_pre_migration_backup(
    database_path: &Path,
    connection: &Connection,
) -> Result<Option<PathBuf>, String> {
    if !reading_state_dimensions_need_migration(connection).map_err(|error| error.to_string())? {
        return Ok(None);
    }

    let data_dir = database_path
        .parent()
        .ok_or_else(|| "本地数据库路径缺少父目录。".to_string())?;
    let backup_dir = data_dir
        .join("backups")
        .join(READING_STATE_PRE_MIGRATION_BACKUP_DIR);
    let backup_database_path = backup_dir.join(DATABASE_FILE_NAME);
    let manifest_path = backup_dir.join(LOCAL_DATA_BACKUP_MANIFEST_FILE);

    if backup_dir.exists() {
        if backup_database_path.is_file() && manifest_path.is_file() {
            validate_pre_migration_backup(&backup_dir)?;
            return Ok(Some(backup_dir));
        }
        return Err("阅读状态迁移前备份目录已存在但内容不完整，已停止迁移以避免覆盖。".to_string());
    }

    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|error| error.to_string())?;
    fs::copy(database_path, &backup_database_path).map_err(|error| error.to_string())?;
    let manifest = LocalDataBackupManifest {
        kind: LOCAL_DATA_BACKUP_KIND.to_string(),
        schema_version: LOCAL_DATA_BACKUP_SCHEMA_VERSION,
        exported_at: current_unix_seconds_string(),
        database_file: DATABASE_FILE_NAME.to_string(),
        files: vec![DATABASE_FILE_NAME.to_string()],
    };
    let content = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(&manifest_path, content).map_err(|error| error.to_string())?;
    validate_pre_migration_backup(&backup_dir)?;

    Ok(Some(backup_dir))
}

fn reading_state_dimensions_need_migration(connection: &Connection) -> SqliteResult<bool> {
    let table_exists: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'reading_item_states'
        )",
        [],
        |row| row.get(0),
    )?;
    if !table_exists {
        return Ok(false);
    }

    let columns = table_columns(connection, "reading_item_states")?;
    if !columns.iter().any(|column| column == "life_status") {
        return Ok(true);
    }

    connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM reading_item_states WHERE life_status IS NULL
        )",
        [],
        |row| row.get(0),
    )
}

fn validate_pre_migration_backup(backup_dir: &Path) -> Result<(), String> {
    let manifest_content = fs::read_to_string(backup_dir.join(LOCAL_DATA_BACKUP_MANIFEST_FILE))
        .map_err(|error| error.to_string())?;
    let manifest = serde_json::from_str::<LocalDataBackupManifest>(&manifest_content)
        .map_err(|error| error.to_string())?;
    if manifest.kind != LOCAL_DATA_BACKUP_KIND
        || manifest.schema_version != LOCAL_DATA_BACKUP_SCHEMA_VERSION
        || manifest.database_file != DATABASE_FILE_NAME
        || manifest.files != vec![DATABASE_FILE_NAME.to_string()]
    {
        return Err("阅读状态迁移前备份 manifest 不合法。".to_string());
    }

    let backup_database_path = backup_dir.join(DATABASE_FILE_NAME);
    if !backup_database_path.is_file() {
        return Err("阅读状态迁移前备份缺少数据库文件。".to_string());
    }
    let backup = Connection::open(&backup_database_path).map_err(|error| error.to_string())?;
    let table_exists: bool = backup
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'reading_item_states'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !table_exists {
        return Err("阅读状态迁移前备份缺少 reading_item_states。".to_string());
    }

    Ok(())
}

fn current_unix_seconds_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
        .to_string()
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

        CREATE TABLE IF NOT EXISTS retrieval_documents (
            id TEXT PRIMARY KEY NOT NULL,
            source_type TEXT NOT NULL CHECK(source_type IN (
                'highlight', 'thought', 'ai_asset_summary', 'local_reader_note'
            )),
            source_id TEXT NOT NULL,
            book_id TEXT NOT NULL,
            chapter_uid INTEGER,
            chapter_title TEXT,
            title TEXT,
            content TEXT NOT NULL,
            normalized_content TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            source_updated_at TEXT NOT NULL,
            indexed_at TEXT NOT NULL,
            deleted_at TEXT,
            UNIQUE(source_type, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_retrieval_documents_book_type
            ON retrieval_documents(book_id, source_type, deleted_at);

        CREATE INDEX IF NOT EXISTS idx_retrieval_documents_hash
            ON retrieval_documents(content_hash);

        CREATE TABLE IF NOT EXISTS retrieval_index_profiles (
            id TEXT PRIMARY KEY NOT NULL,
            provider_kind TEXT NOT NULL,
            model_id TEXT NOT NULL,
            dimensions INTEGER NOT NULL CHECK(dimensions > 0),
            distance_metric TEXT NOT NULL CHECK(distance_metric = 'cosine'),
            normalization_version TEXT NOT NULL,
            chunking_version TEXT NOT NULL,
            content_hash_version TEXT NOT NULL,
            provider_base_url_hash TEXT,
            provider_label TEXT,
            consent_confirmed_at TEXT,
            status TEXT NOT NULL CHECK(status IN (
                'building', 'ready', 'failed', 'cancelled', 'superseded'
            )),
            total_document_count INTEGER NOT NULL DEFAULT 0 CHECK(total_document_count >= 0),
            indexed_document_count INTEGER NOT NULL DEFAULT 0 CHECK(
                indexed_document_count >= 0 AND indexed_document_count <= total_document_count
            ),
            cancel_requested_at TEXT,
            last_started_at TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            CHECK(
                status <> 'ready'
                OR indexed_document_count = total_document_count
            )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_retrieval_index_profiles_one_ready
            ON retrieval_index_profiles(status)
            WHERE status = 'ready';

        CREATE INDEX IF NOT EXISTS idx_retrieval_index_profiles_updated
            ON retrieval_index_profiles(status, updated_at);

        CREATE TABLE IF NOT EXISTS retrieval_embeddings (
            profile_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            dimensions INTEGER NOT NULL CHECK(dimensions > 0),
            vector_blob BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(profile_id, document_id),
            FOREIGN KEY(profile_id) REFERENCES retrieval_index_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(document_id) REFERENCES retrieval_documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_retrieval_embeddings_document
            ON retrieval_embeddings(document_id, profile_id);

        CREATE INDEX IF NOT EXISTS idx_retrieval_embeddings_profile_hash
            ON retrieval_embeddings(profile_id, content_hash);

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

        CREATE TABLE IF NOT EXISTS note_synthesis_jobs (
            id TEXT PRIMARY KEY NOT NULL,
            book_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
                'queued', 'snapshotting', 'batching', 'summarizing', 'merging',
                'completed', 'partial', 'failed', 'cancelled'
            )),
            source_snapshot_hash TEXT NOT NULL,
            total_count INTEGER NOT NULL CHECK(total_count >= 0),
            processed_count INTEGER NOT NULL DEFAULT 0 CHECK(
                processed_count >= 0 AND processed_count <= total_count
            ),
            batch_count INTEGER NOT NULL DEFAULT 0 CHECK(batch_count >= 0),
            completed_batch_count INTEGER NOT NULL DEFAULT 0 CHECK(
                completed_batch_count >= 0 AND completed_batch_count <= batch_count
            ),
            failed_batch_count INTEGER NOT NULL DEFAULT 0 CHECK(
                failed_batch_count >= 0 AND failed_batch_count <= batch_count
            ),
            batch_prompt_version TEXT NOT NULL,
            merge_prompt_version TEXT NOT NULL,
            batching_version TEXT NOT NULL,
            provider_base_url_hash TEXT NOT NULL,
            provider_model TEXT NOT NULL,
            consent_confirmed_at TEXT NOT NULL,
            consent_provider_label TEXT NOT NULL,
            result_feature TEXT,
            result_prompt_version TEXT,
            result_input_hash TEXT,
            cancel_requested_at TEXT,
            last_started_at TEXT,
            finished_at TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(completed_batch_count + failed_batch_count <= batch_count),
            CHECK(
                (status = 'completed'
                    AND processed_count = total_count
                    AND completed_batch_count = batch_count
                    AND failed_batch_count = 0
                    AND result_feature IS NOT NULL
                    AND result_prompt_version IS NOT NULL
                    AND result_input_hash IS NOT NULL)
                OR
                (status <> 'completed'
                    AND result_feature IS NULL
                    AND result_prompt_version IS NULL
                    AND result_input_hash IS NULL)
            )
        );

        CREATE INDEX IF NOT EXISTS idx_note_synthesis_jobs_book_status
            ON note_synthesis_jobs(book_id, status, updated_at);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_note_synthesis_jobs_one_active_book
            ON note_synthesis_jobs(book_id)
            WHERE status IN (
                'queued', 'snapshotting', 'batching', 'summarizing', 'merging', 'partial'
            );

        CREATE TABLE IF NOT EXISTS note_synthesis_job_items (
            job_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK(source_type IN ('highlight', 'thought')),
            content_hash TEXT NOT NULL,
            chapter_uid INTEGER,
            chapter_title TEXT,
            title TEXT,
            content_snapshot TEXT NOT NULL,
            source_updated_at TEXT NOT NULL,
            batch_index INTEGER,
            audit_status TEXT NOT NULL CHECK(audit_status IN (
                'pending', 'processed', 'skipped_empty', 'skipped_duplicate', 'failed'
            )),
            audit_reason TEXT,
            processed_at TEXT,
            PRIMARY KEY(job_id, document_id),
            FOREIGN KEY(job_id) REFERENCES note_synthesis_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_note_synthesis_job_items_batch
            ON note_synthesis_job_items(job_id, batch_index, document_id);

        CREATE TABLE IF NOT EXISTS note_synthesis_batches (
            job_id TEXT NOT NULL,
            batch_index INTEGER NOT NULL CHECK(batch_index >= 0),
            status TEXT NOT NULL CHECK(status IN (
                'pending', 'running', 'completed', 'failed', 'cancelled'
            )),
            chapter_uid INTEGER,
            source_types_json TEXT NOT NULL,
            source_count INTEGER NOT NULL CHECK(source_count >= 0),
            input_hash TEXT NOT NULL,
            output_json TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
            last_started_at TEXT,
            completed_at TEXT,
            error_code TEXT,
            error_message TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(job_id, batch_index),
            FOREIGN KEY(job_id) REFERENCES note_synthesis_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_note_synthesis_batches_status
            ON note_synthesis_batches(job_id, status, batch_index);

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

        CREATE TABLE IF NOT EXISTS ai_assistant_threads (
            id TEXT PRIMARY KEY NOT NULL,
            scope TEXT NOT NULL,
            entity_id TEXT,
            title TEXT NOT NULL,
            context_summary_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_assistant_threads_updated
            ON ai_assistant_threads(updated_at);

        CREATE TABLE IF NOT EXISTS ai_assistant_messages (
            id TEXT PRIMARY KEY NOT NULL,
            thread_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'answered', 'failed')),
            used_context_json TEXT NOT NULL,
            output_json TEXT,
            prompt_version TEXT,
            input_hash TEXT,
            provider_model TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES ai_assistant_threads(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_thread_created
            ON ai_assistant_messages(thread_id, created_at);

        CREATE TABLE IF NOT EXISTS ai_assistant_preferences (
            key TEXT PRIMARY KEY NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

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

        CREATE TABLE IF NOT EXISTS ima_export_records (
            id TEXT PRIMARY KEY NOT NULL,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            destination_scope TEXT NOT NULL,
            title TEXT NOT NULL,
            ima_note_id TEXT,
            ima_media_id TEXT,
            status TEXT NOT NULL CHECK(status IN (
                'attempting', 'succeeded', 'partial', 'failed', 'unknown', 'abandoned'
            )),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ima_export_records_dedupe
            ON ima_export_records(source_kind, source_id, content_hash, destination_scope, status);

        CREATE TABLE IF NOT EXISTS ima_export_attempts (
            export_id TEXT PRIMARY KEY NOT NULL,
            record_id TEXT NOT NULL,
            snapshot_markdown TEXT NOT NULL,
            snapshot_hash TEXT NOT NULL,
            chunk_count INTEGER NOT NULL CHECK(chunk_count > 0),
            status TEXT NOT NULL CHECK(status IN (
                'attempting', 'succeeded', 'partial', 'failed', 'unknown', 'abandoned'
            )),
            last_completed_stage TEXT,
            uncertain_stage TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(record_id) REFERENCES ima_export_records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ima_export_chunks (
            export_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
            chunker_version TEXT NOT NULL,
            start_byte INTEGER NOT NULL CHECK(start_byte >= 0),
            end_byte INTEGER NOT NULL CHECK(end_byte >= start_byte),
            chunk_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
                'pending', 'attempting', 'succeeded', 'failed', 'unknown'
            )),
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
            last_error_code TEXT,
            PRIMARY KEY(export_id, chunk_index),
            FOREIGN KEY(export_id) REFERENCES ima_export_attempts(export_id) ON DELETE CASCADE
        );
        ",
    )?;
    add_column_if_missing(connection, "thoughts", "abstract_text", "TEXT")?;
    add_column_if_missing(connection, "thoughts", "chapter_uid", "INTEGER")?;
    add_column_if_missing(connection, "thoughts", "range_text", "TEXT")?;
    add_column_if_missing(connection, "thoughts", "deep_link", "TEXT")?;
    add_column_if_missing(connection, "ai_assistant_messages", "output_json", "TEXT")?;
    ensure_retrieval_profile_schema(connection)?;
    ensure_retrieval_fts_schema(connection)?;
    ensure_local_books_support_markdown(connection)?;
    ensure_local_reading_progress_schema(connection)?;
    ensure_reading_item_dimensions(connection)?;

    Ok(())
}

fn ensure_retrieval_profile_schema(connection: &Connection) -> SqliteResult<()> {
    let columns = table_columns(connection, "retrieval_index_profiles")?;
    let current = [
        "provider_base_url_hash",
        "provider_label",
        "consent_confirmed_at",
        "cancel_requested_at",
        "last_started_at",
    ]
    .iter()
    .all(|column| columns.iter().any(|existing| existing == column));

    if !current {
        let profile_count =
            connection.query_row("SELECT COUNT(*) FROM retrieval_index_profiles", [], |row| {
                row.get::<_, i64>(0)
            })?;
        let embedding_count =
            connection.query_row("SELECT COUNT(*) FROM retrieval_embeddings", [], |row| {
                row.get::<_, i64>(0)
            })?;

        connection.pragma_update(None, "foreign_keys", "OFF")?;
        let migration = connection.execute_batch(
            "BEGIN IMMEDIATE;
             ALTER TABLE retrieval_embeddings RENAME TO retrieval_embeddings_before_remote;
             ALTER TABLE retrieval_index_profiles RENAME TO retrieval_index_profiles_before_remote;

             CREATE TABLE retrieval_index_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                provider_kind TEXT NOT NULL,
                model_id TEXT NOT NULL,
                dimensions INTEGER NOT NULL CHECK(dimensions > 0),
                distance_metric TEXT NOT NULL CHECK(distance_metric = 'cosine'),
                normalization_version TEXT NOT NULL,
                chunking_version TEXT NOT NULL,
                content_hash_version TEXT NOT NULL,
                provider_base_url_hash TEXT,
                provider_label TEXT,
                consent_confirmed_at TEXT,
                status TEXT NOT NULL CHECK(status IN (
                    'building', 'ready', 'failed', 'cancelled', 'superseded'
                )),
                total_document_count INTEGER NOT NULL DEFAULT 0 CHECK(total_document_count >= 0),
                indexed_document_count INTEGER NOT NULL DEFAULT 0 CHECK(
                    indexed_document_count >= 0 AND indexed_document_count <= total_document_count
                ),
                cancel_requested_at TEXT,
                last_started_at TEXT,
                error_code TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                CHECK(
                    status <> 'ready'
                    OR indexed_document_count = total_document_count
                )
             );

             INSERT INTO retrieval_index_profiles (
                id, provider_kind, model_id, dimensions, distance_metric,
                normalization_version, chunking_version, content_hash_version,
                status, total_document_count, indexed_document_count,
                error_code, error_message, created_at, updated_at, completed_at
             )
             SELECT id, provider_kind, model_id, dimensions, distance_metric,
                normalization_version, chunking_version, content_hash_version,
                status, total_document_count, indexed_document_count,
                error_code, error_message, created_at, updated_at, completed_at
             FROM retrieval_index_profiles_before_remote;

             CREATE TABLE retrieval_embeddings (
                profile_id TEXT NOT NULL,
                document_id TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                dimensions INTEGER NOT NULL CHECK(dimensions > 0),
                vector_blob BLOB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(profile_id, document_id),
                FOREIGN KEY(profile_id) REFERENCES retrieval_index_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY(document_id) REFERENCES retrieval_documents(id) ON DELETE CASCADE
             );

             INSERT INTO retrieval_embeddings (
                profile_id, document_id, content_hash, dimensions, vector_blob,
                created_at, updated_at
             )
             SELECT profile_id, document_id, content_hash, dimensions, vector_blob,
                created_at, updated_at
             FROM retrieval_embeddings_before_remote;

             DROP TABLE retrieval_embeddings_before_remote;
             DROP TABLE retrieval_index_profiles_before_remote;

             CREATE UNIQUE INDEX idx_retrieval_index_profiles_one_ready
                ON retrieval_index_profiles(status)
                WHERE status = 'ready';
             CREATE INDEX idx_retrieval_index_profiles_updated
                ON retrieval_index_profiles(status, updated_at);
             CREATE INDEX idx_retrieval_embeddings_document
                ON retrieval_embeddings(document_id, profile_id);
             CREATE INDEX idx_retrieval_embeddings_profile_hash
                ON retrieval_embeddings(profile_id, content_hash);
             COMMIT;",
        );
        if let Err(error) = migration {
            let _ = connection.execute_batch("ROLLBACK;");
            let _ = connection.pragma_update(None, "foreign_keys", "ON");
            return Err(error);
        }
        connection.pragma_update(None, "foreign_keys", "ON")?;

        let migrated_profile_count =
            connection.query_row("SELECT COUNT(*) FROM retrieval_index_profiles", [], |row| {
                row.get::<_, i64>(0)
            })?;
        let migrated_embedding_count =
            connection.query_row("SELECT COUNT(*) FROM retrieval_embeddings", [], |row| {
                row.get::<_, i64>(0)
            })?;
        if migrated_profile_count != profile_count || migrated_embedding_count != embedding_count {
            return Err(rusqlite::Error::InvalidParameterName(
                "retrieval profile migration changed row counts".to_string(),
            ));
        }
    }

    connection.execute(
        "UPDATE retrieval_index_profiles
         SET status = 'cancelled',
             error_code = COALESCE(error_code, 'superseded_build'),
             error_message = COALESCE(error_message, '已有更新的向量索引构建任务。')
         WHERE status = 'building'
           AND id NOT IN (
             SELECT id FROM retrieval_index_profiles
             WHERE status = 'building'
             ORDER BY updated_at DESC, id DESC
             LIMIT 1
           )",
        [],
    )?;
    connection.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_retrieval_index_profiles_one_building
            ON retrieval_index_profiles(status)
            WHERE status = 'building';",
    )?;

    let foreign_key_errors = connection.query_row(
        "SELECT COUNT(*) FROM pragma_foreign_key_check('retrieval_embeddings')",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if foreign_key_errors != 0 {
        return Err(rusqlite::Error::InvalidParameterName(
            "retrieval profile migration failed foreign key check".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn ensure_retrieval_fts_schema(connection: &Connection) -> SqliteResult<bool> {
    let fts5_available = connection
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS temp.retrieval_fts5_probe USING fts5(content);\
             DROP TABLE IF EXISTS temp.retrieval_fts5_probe;",
        )
        .is_ok();
    if !fts5_available {
        return Ok(false);
    }

    connection.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_documents_fts USING fts5(
            document_id UNINDEXED,
            title_tokens,
            chapter_tokens,
            content_tokens,
            tokenize = 'unicode61'
        );",
    )?;
    Ok(true)
}

pub(crate) fn retrieval_fts_available(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'retrieval_documents_fts'
            )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false)
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
        if !sql
            .to_ascii_lowercase()
            .contains("book_id text primary key")
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

pub(crate) struct ReadingItemDimensionBackfill {
    pub item_kind: String,
    pub is_candidate: bool,
    pub candidate_source: Option<String>,
    pub life_status: String,
    pub organize_status: String,
    pub user_note: Option<String>,
    pub source_meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStateMigrationSummary {
    pub total_rows_before: u64,
    pub pending_rows: u64,
    pub scanned: u64,
    pub updated: u64,
    pub unchanged: u64,
    pub backup_rows: u64,
    pub by_legacy_type: BTreeMap<String, u64>,
    pub by_life_status: BTreeMap<String, u64>,
    pub by_organize_status: BTreeMap<String, u64>,
    pub invalid_rows: u64,
}

const AI_RECOMMENDATION_NOTE_MARKER: &str = "来自 AI 阅读助手推荐";
const AI_CONFIRMED_NOTE_MARKER: &str = "已通过微信读书搜索确认";
const ABSORBED_REVIEW_NOTE: &str = "用户已确认吸收本书复盘";

pub(crate) fn derive_reading_item_dimensions(
    item_id: &str,
    item_type: &str,
    status: &str,
    note: Option<&str>,
) -> ReadingItemDimensionBackfill {
    let trimmed_note = note.map(str::trim).filter(|value| !value.is_empty());
    let is_light = item_type == "album" || item_type == "mp";
    let is_candidate_row = item_type == "candidate" && status == "toRead";
    let is_light_candidate = is_light && status == "toRead";
    let is_candidate = is_candidate_row || is_light_candidate;

    let has_ai_marker =
        trimmed_note.is_some_and(|value| value.contains(AI_RECOMMENDATION_NOTE_MARKER));
    let has_confirmed_marker =
        trimmed_note.is_some_and(|value| value.contains(AI_CONFIRMED_NOTE_MARKER));
    let is_shelf_note = trimmed_note
        .is_some_and(|value| value.starts_with("书架") && value.ends_with("保存的本地候选"));

    let candidate_source = if !is_candidate {
        None
    } else if is_light_candidate {
        Some("light".to_string())
    } else if has_confirmed_marker {
        Some("ai_confirmed".to_string())
    } else if item_id.starts_with("ai-rec-") || has_ai_marker {
        Some("ai_unconfirmed".to_string())
    } else {
        Some("weread".to_string())
    };

    let saved_from = match trimmed_note {
        Some("发现页保存的本地候选") => Some("discovery"),
        Some("书籍详情页保存的本地候选") => Some("detail"),
        Some(_) if is_shelf_note => Some("shelf"),
        Some(_) if has_ai_marker || has_confirmed_marker => Some("assistant"),
        _ => None,
    };

    let ai_reason = if has_ai_marker || has_confirmed_marker {
        trimmed_note.map(str::to_string)
    } else {
        None
    };

    let is_system_note = matches!(
        trimmed_note,
        Some("发现页保存的本地候选")
            | Some("书籍详情页保存的本地候选")
            | Some(ABSORBED_REVIEW_NOTE)
    ) || is_shelf_note
        || has_ai_marker
        || has_confirmed_marker;

    let user_note = match trimmed_note {
        Some(value) if !is_system_note => Some(value.to_string()),
        _ => None,
    };

    let source_meta = if saved_from.is_some() || ai_reason.is_some() {
        let mut object = serde_json::Map::new();
        if let Some(saved_from) = saved_from {
            object.insert(
                "savedFrom".to_string(),
                serde_json::Value::String(saved_from.to_string()),
            );
        }
        if let Some(ai_reason) = &ai_reason {
            object.insert(
                "aiReason".to_string(),
                serde_json::Value::String(ai_reason.clone()),
            );
        }
        serde_json::to_string(&serde_json::Value::Object(object)).ok()
    } else {
        None
    };

    ReadingItemDimensionBackfill {
        item_kind: if item_type == "candidate" {
            "book".to_string()
        } else {
            item_type.to_string()
        },
        is_candidate,
        candidate_source,
        life_status: if is_candidate_row {
            "want".to_string()
        } else {
            "none".to_string()
        },
        organize_status: match status {
            "reviewing" => "to_organize",
            "organized" => "organized",
            _ => "none",
        }
        .to_string(),
        user_note,
        source_meta,
    }
}

fn ensure_reading_item_dimensions(connection: &Connection) -> SqliteResult<()> {
    migrate_reading_item_dimensions(connection).map(|_| ())
}

fn migrate_reading_item_dimensions(
    connection: &Connection,
) -> SqliteResult<ReadingStateMigrationSummary> {
    add_column_if_missing(connection, "reading_item_states", "item_kind", "TEXT")?;
    add_column_if_missing(connection, "reading_item_states", "is_candidate", "INTEGER")?;
    add_column_if_missing(
        connection,
        "reading_item_states",
        "candidate_source",
        "TEXT",
    )?;
    add_column_if_missing(connection, "reading_item_states", "life_status", "TEXT")?;
    add_column_if_missing(connection, "reading_item_states", "finished_source", "TEXT")?;
    add_column_if_missing(connection, "reading_item_states", "organize_status", "TEXT")?;
    add_column_if_missing(connection, "reading_item_states", "user_note", "TEXT")?;
    add_column_if_missing(connection, "reading_item_states", "source_meta", "TEXT")?;

    let total_rows_before = count_reading_item_rows(connection, None)?;
    let pending_rows = count_reading_item_rows(connection, Some("life_status IS NULL"))?;
    let existing_backup_rows = existing_reading_state_backup_rows(connection)?;
    let backup_existed = existing_backup_rows.is_some();
    let mut summary = ReadingStateMigrationSummary {
        total_rows_before,
        pending_rows,
        scanned: 0,
        updated: 0,
        unchanged: 0,
        backup_rows: existing_backup_rows.unwrap_or(0),
        by_legacy_type: BTreeMap::new(),
        by_life_status: BTreeMap::new(),
        by_organize_status: BTreeMap::new(),
        invalid_rows: 0,
    };

    if pending_rows == 0 {
        return Ok(summary);
    }

    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS reading_item_states_backup_v1 AS
         SELECT * FROM reading_item_states WHERE 0",
    )?;
    if !backup_existed {
        connection.execute(
            "INSERT INTO reading_item_states_backup_v1
             SELECT * FROM reading_item_states WHERE life_status IS NULL",
            [],
        )?;
    }
    summary.backup_rows = count_reading_item_rows_in_backup(connection)?;

    struct LegacyReadingItemRow {
        item_id: String,
        item_type: String,
        status: String,
        note: Option<String>,
    }

    let mut statement = connection.prepare(
        "SELECT item_id, item_type, status, note FROM reading_item_states WHERE life_status IS NULL",
    )?;
    let legacy_rows = statement
        .query_map([], |row| {
            Ok(LegacyReadingItemRow {
                item_id: row.get(0)?,
                item_type: row.get(1)?,
                status: row.get(2)?,
                note: row.get(3)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;
    drop(statement);

    summary.scanned = legacy_rows.len() as u64;
    for row in &legacy_rows {
        *summary
            .by_legacy_type
            .entry(row.item_type.clone())
            .or_default() += 1;
        let dimensions = derive_reading_item_dimensions(
            &row.item_id,
            &row.item_type,
            &row.status,
            row.note.as_deref(),
        );
        *summary
            .by_life_status
            .entry(dimensions.life_status.clone())
            .or_default() += 1;
        *summary
            .by_organize_status
            .entry(dimensions.organize_status.clone())
            .or_default() += 1;
        if !is_valid_reading_item_backfill(&dimensions) {
            summary.invalid_rows += 1;
        }
    }

    let pending_item_ids = legacy_rows
        .iter()
        .map(|row| row.item_id.clone())
        .collect::<Vec<_>>();
    assert_reading_state_migration_preconditions(&summary, connection, &pending_item_ids)?;

    let migration: SqliteResult<u64> = (|| {
        connection.execute_batch("BEGIN IMMEDIATE;")?;
        let mut updated = 0_u64;
        for row in &legacy_rows {
            let dimensions = derive_reading_item_dimensions(
                &row.item_id,
                &row.item_type,
                &row.status,
                row.note.as_deref(),
            );
            updated += connection.execute(
                "UPDATE reading_item_states SET
                    item_kind = ?2,
                    is_candidate = ?3,
                    candidate_source = ?4,
                    life_status = ?5,
                    organize_status = ?6,
                    user_note = ?7,
                    source_meta = ?8
                 WHERE item_id = ?1 AND life_status IS NULL",
                rusqlite::params![
                    &row.item_id,
                    &dimensions.item_kind,
                    dimensions.is_candidate as i64,
                    &dimensions.candidate_source,
                    &dimensions.life_status,
                    &dimensions.organize_status,
                    &dimensions.user_note,
                    &dimensions.source_meta
                ],
            )? as u64;
        }
        assert_reading_state_migration_postconditions(
            connection,
            summary.total_rows_before,
            summary.scanned,
            updated,
        )?;
        connection.execute_batch("COMMIT;")?;
        Ok(updated)
    })();

    match migration {
        Ok(updated) => summary.updated = updated,
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }
    summary.unchanged = summary.scanned.saturating_sub(summary.updated);

    Ok(summary)
}

fn count_reading_item_rows(connection: &Connection, condition: Option<&str>) -> SqliteResult<u64> {
    let sql = match condition {
        Some(condition) => format!("SELECT COUNT(*) FROM reading_item_states WHERE {condition}"),
        None => "SELECT COUNT(*) FROM reading_item_states".to_string(),
    };
    connection
        .query_row(&sql, [], |row| row.get::<_, i64>(0))
        .map(|count| count.max(0) as u64)
}

fn existing_reading_state_backup_rows(connection: &Connection) -> SqliteResult<Option<u64>> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'reading_item_states_backup_v1'
        )",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(None);
    }
    count_reading_item_rows_in_backup(connection).map(Some)
}

fn count_reading_item_rows_in_backup(connection: &Connection) -> SqliteResult<u64> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM reading_item_states_backup_v1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
}

fn is_valid_reading_item_backfill(dimensions: &ReadingItemDimensionBackfill) -> bool {
    matches!(
        dimensions.item_kind.as_str(),
        "book" | "album" | "mp" | "localBook"
    ) && matches!(
        dimensions.life_status.as_str(),
        "none" | "want" | "reading" | "paused" | "finished" | "dropped"
    ) && matches!(
        dimensions.organize_status.as_str(),
        "none" | "to_organize" | "organized"
    ) && (!dimensions.is_candidate || dimensions.candidate_source.is_some())
        && dimensions.source_meta.as_deref().map_or(true, |value| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(value).is_ok()
        })
}

fn assert_reading_state_migration_preconditions(
    summary: &ReadingStateMigrationSummary,
    connection: &Connection,
    pending_item_ids: &[String],
) -> SqliteResult<()> {
    if summary.pending_rows != summary.scanned {
        return Err(migration_invariant_error("pendingRows must equal scanned"));
    }
    if summary.invalid_rows != 0 {
        return Err(migration_invariant_error("invalidRows must be zero"));
    }
    if summary.backup_rows != summary.pending_rows {
        return Err(migration_invariant_error(
            "backupRows must equal pendingRows",
        ));
    }

    for item_id in pending_item_ids {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM reading_item_states_backup_v1 WHERE item_id = ?1
            )",
            [item_id],
            |record| record.get(0),
        )?;
        if !exists {
            return Err(migration_invariant_error(
                "backup must cover every pending itemId",
            ));
        }
    }

    Ok(())
}

fn assert_reading_state_migration_postconditions(
    connection: &Connection,
    total_rows_before: u64,
    scanned: u64,
    updated: u64,
) -> SqliteResult<()> {
    let total_rows_after = count_reading_item_rows(connection, None)?;
    if total_rows_after != total_rows_before {
        return Err(migration_invariant_error(
            "reading item row count changed during migration",
        ));
    }
    let unchanged = scanned.saturating_sub(updated);
    if scanned != updated + unchanged {
        return Err(migration_invariant_error(
            "scanned must equal updated plus unchanged",
        ));
    }
    let pending_rows_after = count_reading_item_rows(connection, Some("life_status IS NULL"))?;
    if pending_rows_after != 0 {
        return Err(migration_invariant_error(
            "pending rows must be zero after migration",
        ));
    }
    Ok(())
}

fn migration_invariant_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(format!(
        "reading item state migration invariant failed: {message}"
    ))
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
        derive_reading_item_dimensions, ensure_reading_item_dimensions,
        ensure_reading_state_pre_migration_backup, initialize_schema,
        migrate_reading_item_dimensions, read_custom_export_directory_config,
        reading_state_dimensions_need_migration, table_columns,
        write_custom_export_directory_config, DATABASE_FILE_NAME, SQLITE_BUSY_TIMEOUT_MS,
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
                    'retrieval_documents',
                    'retrieval_index_profiles',
                    'retrieval_embeddings',
                    'reading_stats',
                    'raw_cache',
                    'ai_outputs',
                    'note_synthesis_jobs',
                    'note_synthesis_job_items',
                    'note_synthesis_batches',
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

        assert_eq!(table_count, 22);
        assert!(super::retrieval_fts_available(&connection));

        initialize_schema(&connection).expect("schema should initialize idempotently");
        assert!(super::retrieval_fts_available(&connection));
    }

    #[test]
    fn retrieval_vector_schema_enforces_complete_single_ready_profile() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let insert_profile = |id: &str, status: &str, total: i64, indexed: i64| {
            connection.execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at
                 ) VALUES (?1, 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    ?2, ?3, ?4, '100', '100')",
                rusqlite::params![id, status, total, indexed],
            )
        };

        insert_profile("profile-ready", "building", 2, 2)
            .expect("complete building profile should insert");
        connection
            .execute(
                "UPDATE retrieval_index_profiles
                 SET status = 'ready', completed_at = '101'
                 WHERE id = 'profile-ready'",
                [],
            )
            .expect("complete profile should become ready");
        assert!(insert_profile("profile-second-ready", "ready", 0, 0).is_err());

        insert_profile("profile-incomplete", "building", 2, 1)
            .expect("incomplete building profile should insert");
        assert!(connection
            .execute(
                "UPDATE retrieval_index_profiles SET status = 'ready'
                 WHERE id = 'profile-incomplete'",
                [],
            )
            .is_err());
    }

    #[test]
    fn initialize_schema_migrates_m3a_profiles_without_losing_embeddings() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE retrieval_documents (
                    id TEXT PRIMARY KEY NOT NULL,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    book_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    normalized_content TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    source_updated_at TEXT NOT NULL,
                    indexed_at TEXT NOT NULL,
                    deleted_at TEXT
                 );
                 CREATE TABLE retrieval_index_profiles (
                    id TEXT PRIMARY KEY NOT NULL,
                    provider_kind TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    dimensions INTEGER NOT NULL CHECK(dimensions > 0),
                    distance_metric TEXT NOT NULL CHECK(distance_metric = 'cosine'),
                    normalization_version TEXT NOT NULL,
                    chunking_version TEXT NOT NULL,
                    content_hash_version TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN (
                        'building', 'ready', 'failed', 'superseded'
                    )),
                    total_document_count INTEGER NOT NULL DEFAULT 0,
                    indexed_document_count INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT
                 );
                 CREATE TABLE retrieval_embeddings (
                    profile_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    dimensions INTEGER NOT NULL,
                    vector_blob BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(profile_id, document_id),
                    FOREIGN KEY(profile_id) REFERENCES retrieval_index_profiles(id) ON DELETE CASCADE,
                    FOREIGN KEY(document_id) REFERENCES retrieval_documents(id) ON DELETE CASCADE
                 );
                 INSERT INTO retrieval_documents (
                    id, source_type, source_id, book_id, content, normalized_content,
                    metadata_json, content_hash, source_updated_at, indexed_at
                 ) VALUES ('note:highlight:h1', 'highlight', 'h1', 'book-1',
                    '正文', '正文', '{}', 'sha256-v1:hash', '100', '100');
                 INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at, completed_at
                 ) VALUES ('profile-ready', 'deterministic-test', 'fixture-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'ready', 1, 1, '100', '101', '101');
                 INSERT INTO retrieval_embeddings (
                    profile_id, document_id, content_hash, dimensions, vector_blob,
                    created_at, updated_at
                 ) VALUES ('profile-ready', 'note:highlight:h1', 'sha256-v1:hash', 2,
                    X'0000803F00000000', '100', '100');",
            )
            .expect("legacy M3A schema should initialize");

        initialize_schema(&connection).expect("legacy M3A schema should migrate");
        initialize_schema(&connection).expect("remote profile migration should be idempotent");

        let profile = connection
            .query_row(
                "SELECT status, provider_base_url_hash, cancel_requested_at
                 FROM retrieval_index_profiles WHERE id = 'profile-ready'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("migrated profile should read");
        assert_eq!(profile, ("ready".to_string(), None, None));
        let embedding_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM retrieval_embeddings", [], |row| {
                row.get(0)
            })
            .expect("migrated embedding count should read");
        let foreign_key_errors: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check should run");
        assert_eq!(embedding_count, 1);
        assert_eq!(foreign_key_errors, 0);
        assert!(connection
            .execute(
                "INSERT INTO retrieval_index_profiles (
                    id, provider_kind, model_id, dimensions, distance_metric,
                    normalization_version, chunking_version, content_hash_version,
                    status, total_document_count, indexed_document_count,
                    created_at, updated_at
                 ) VALUES ('profile-cancelled', 'openai-compatible', 'embed-v1', 2, 'cosine',
                    'retrieval-text-v1', 'document-v1', 'sha256-v1',
                    'cancelled', 1, 0, '102', '102')",
                [],
            )
            .is_ok());
    }

    #[test]
    fn retrieval_embeddings_cascade_with_profile_and_document() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO retrieval_documents (
                    id, source_type, source_id, book_id, content, normalized_content,
                    metadata_json, content_hash, source_updated_at, indexed_at
                 ) VALUES ('note:highlight:h1', 'highlight', 'h1', 'book-1',
                    '正文', '正文', '{}', 'sha256-v1:hash', '100', '100')",
                [],
            )
            .expect("document should insert");
        for (profile_id, status) in [
            ("profile-delete", "building"),
            ("document-delete", "failed"),
        ] {
            connection
                .execute(
                    "INSERT INTO retrieval_index_profiles (
                        id, provider_kind, model_id, dimensions, distance_metric,
                        normalization_version, chunking_version, content_hash_version,
                        status, total_document_count, indexed_document_count,
                        created_at, updated_at
                     ) VALUES (?1, 'deterministic-test', 'fixture-v1', 2, 'cosine',
                        'retrieval-text-v1', 'document-v1', 'sha256-v1',
                        ?2, 1, 1, '100', '100')",
                    rusqlite::params![profile_id, status],
                )
                .expect("profile should insert");
            connection
                .execute(
                    "INSERT INTO retrieval_embeddings (
                        profile_id, document_id, content_hash, dimensions, vector_blob,
                        created_at, updated_at
                     ) VALUES (?1, 'note:highlight:h1', 'sha256-v1:hash', 2,
                        X'0000000000000000', '100', '100')",
                    [profile_id],
                )
                .expect("embedding should insert");
        }

        connection
            .execute(
                "DELETE FROM retrieval_index_profiles WHERE id = 'profile-delete'",
                [],
            )
            .expect("profile should delete");
        let after_profile_delete: i64 = connection
            .query_row("SELECT COUNT(*) FROM retrieval_embeddings", [], |row| {
                row.get(0)
            })
            .expect("embedding count should read");
        assert_eq!(after_profile_delete, 1);

        connection
            .execute(
                "DELETE FROM retrieval_documents WHERE id = 'note:highlight:h1'",
                [],
            )
            .expect("document should delete");
        let after_document_delete: i64 = connection
            .query_row("SELECT COUNT(*) FROM retrieval_embeddings", [], |row| {
                row.get(0)
            })
            .expect("embedding count should read");
        assert_eq!(after_document_delete, 0);
    }

    #[test]
    fn note_synthesis_schema_enforces_single_active_job_and_valid_counts() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let insert_job = |id: &str, book_id: &str, status: &str| {
            connection.execute(
                "INSERT INTO note_synthesis_jobs (
                    id, book_id, status, source_snapshot_hash, total_count, processed_count,
                    batch_count, completed_batch_count, failed_batch_count,
                    batch_prompt_version, merge_prompt_version, batching_version,
                    provider_base_url_hash, provider_model, consent_confirmed_at,
                    consent_provider_label, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'snapshot', 2, 0, 1, 0, 0,
                    'batch-v1', 'merge-v1', 'batching-v1', 'provider', 'model',
                    '1', 'Provider', '1', '1')",
                rusqlite::params![id, book_id, status],
            )
        };

        insert_job("job-1", "book-1", "summarizing").expect("first active job should insert");
        assert!(insert_job("job-2", "book-1", "queued").is_err());
        insert_job("job-3", "book-2", "failed").expect("failed job should insert");
        insert_job("job-4", "book-2", "queued").expect("new active job after failed should insert");
        assert!(connection
            .execute(
                "UPDATE note_synthesis_jobs SET processed_count = 3 WHERE id = 'job-1'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET status = 'completed', processed_count = total_count,
                     completed_batch_count = batch_count, failed_batch_count = 0
                 WHERE id = 'job-1'",
                [],
            )
            .is_err());
        connection
            .execute(
                "UPDATE note_synthesis_jobs
                 SET status = 'completed', processed_count = total_count,
                     completed_batch_count = batch_count, failed_batch_count = 0,
                     result_feature = 'book-notes-summary',
                     result_prompt_version = 'book-notes-summary-full-v1',
                     result_input_hash = 'result-hash'
                 WHERE id = 'job-1'",
                [],
            )
            .expect("completed job with full result reference should update");
    }

    #[test]
    fn note_synthesis_snapshot_items_cascade_with_job() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO note_synthesis_jobs (
                    id, book_id, status, source_snapshot_hash, total_count, processed_count,
                    batch_count, completed_batch_count, failed_batch_count,
                    batch_prompt_version, merge_prompt_version, batching_version,
                    provider_base_url_hash, provider_model, consent_confirmed_at,
                    consent_provider_label, created_at, updated_at
                 ) VALUES ('job-1', 'book-1', 'queued', 'snapshot', 1, 0, 1, 0, 0,
                    'batch-v1', 'merge-v1', 'batching-v1', 'provider', 'model',
                    '1', 'Provider', '1', '1')",
                [],
            )
            .expect("job should insert");
        connection
            .execute(
                "INSERT INTO note_synthesis_job_items (
                    job_id, document_id, source_type, content_hash, content_snapshot,
                    source_updated_at, batch_index, audit_status
                 ) VALUES ('job-1', 'note:highlight:h1', 'highlight', 'hash', '正文',
                    '1', 0, 'pending')",
                [],
            )
            .expect("snapshot item should insert");
        connection
            .execute(
                "INSERT INTO note_synthesis_batches (
                    job_id, batch_index, status, source_types_json, source_count,
                    input_hash, updated_at
                 ) VALUES ('job-1', 0, 'pending', '[\"highlight\"]', 1, 'input', '1')",
                [],
            )
            .expect("batch should insert");

        connection
            .execute("DELETE FROM note_synthesis_jobs WHERE id = 'job-1'", [])
            .expect("job should delete");
        let item_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_synthesis_job_items", [], |row| {
                row.get(0)
            })
            .expect("item count should read");
        let batch_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_synthesis_batches", [], |row| {
                row.get(0)
            })
            .expect("batch count should read");
        assert_eq!((item_count, batch_count), (0, 0));
    }

    #[test]
    fn retrieval_fts_schema_is_queryable() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");

        connection
            .execute(
                "INSERT INTO retrieval_documents_fts (
                    document_id, title_tokens, chapter_tokens, content_tokens
                ) VALUES ('note:highlight:h1', '深度 工作', '第一章', '深度 工作 专注')",
                [],
            )
            .expect("fts row should insert");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM retrieval_documents_fts
                 WHERE retrieval_documents_fts MATCH '深度'",
                [],
                |row| row.get(0),
            )
            .expect("fts query should run");

        assert_eq!(count, 1);
    }

    fn create_legacy_reading_item_schema(connection: &Connection) {
        connection
            .execute_batch(
                "CREATE TABLE reading_item_states (
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
                );",
            )
            .expect("legacy reading item schema should create");
    }

    fn insert_legacy_reading_item(
        connection: &Connection,
        item_id: &str,
        item_type: &str,
        status: &str,
        note: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO reading_item_states (
                    item_id, item_type, status, title, note, created_at, updated_at
                ) VALUES (?1, ?2, ?3, '书', ?4, '100', '100')",
                rusqlite::params![item_id, item_type, status, note],
            )
            .expect("legacy reading item should insert");
    }

    #[test]
    fn reading_state_pre_migration_backup_is_created_once_and_contains_legacy_rows() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-reading-state-pre-migration-{}",
            super::current_unix_seconds_string()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temporary data dir should create");
        let database_path = temp_root.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&database_path).expect("legacy database should open");
        create_legacy_reading_item_schema(&connection);
        insert_legacy_reading_item(&connection, "c1", "candidate", "toRead", None);
        assert!(reading_state_dimensions_need_migration(&connection)
            .expect("migration need should be detected"));

        let first_backup = ensure_reading_state_pre_migration_backup(&database_path, &connection)
            .expect("pre-migration backup should create")
            .expect("backup path should be returned");
        let first_backup_size = std::fs::metadata(first_backup.join(DATABASE_FILE_NAME))
            .expect("backup database should exist")
            .len();
        let second_backup = ensure_reading_state_pre_migration_backup(&database_path, &connection)
            .expect("existing backup should validate")
            .expect("existing backup path should return");
        assert_eq!(second_backup, first_backup);
        assert_eq!(
            std::fs::metadata(first_backup.join(DATABASE_FILE_NAME))
                .expect("backup database should still exist")
                .len(),
            first_backup_size
        );

        let backup = Connection::open(first_backup.join(DATABASE_FILE_NAME))
            .expect("backup database should open");
        let backup_title: String = backup
            .query_row(
                "SELECT title FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| row.get(0),
            )
            .expect("legacy backup row should read");
        assert_eq!(backup_title, "书");
        drop(backup);
        drop(connection);
        std::fs::remove_dir_all(temp_root).expect("temporary data dir should remove");
    }

    #[test]
    fn reading_state_pre_migration_backup_skips_current_schema() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-reading-state-current-schema-{}",
            super::current_unix_seconds_string()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temporary data dir should create");
        let database_path = temp_root.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&database_path).expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let backup = ensure_reading_state_pre_migration_backup(&database_path, &connection)
            .expect("current schema check should succeed");

        assert!(backup.is_none());
        drop(connection);
        std::fs::remove_dir_all(temp_root).expect("temporary data dir should remove");
    }

    #[test]
    fn reading_state_pre_migration_backup_rejects_incomplete_existing_directory() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-reading-state-incomplete-backup-{}",
            super::current_unix_seconds_string()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temporary data dir should create");
        let database_path = temp_root.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&database_path).expect("legacy database should open");
        create_legacy_reading_item_schema(&connection);
        insert_legacy_reading_item(&connection, "c1", "candidate", "toRead", None);
        let backup_dir = temp_root
            .join("backups")
            .join(super::READING_STATE_PRE_MIGRATION_BACKUP_DIR);
        std::fs::create_dir_all(&backup_dir).expect("incomplete backup dir should create");
        std::fs::write(backup_dir.join("unexpected.tmp"), b"partial")
            .expect("partial marker should write");

        let error = ensure_reading_state_pre_migration_backup(&database_path, &connection)
            .expect_err("incomplete backup must stop migration");

        assert!(error.contains("内容不完整"));
        assert!(!backup_dir.join(DATABASE_FILE_NAME).exists());
        drop(connection);
        std::fs::remove_dir_all(temp_root).expect("temporary data dir should remove");
    }

    #[test]
    fn reading_state_pre_migration_backup_can_restore_and_reupgrade_legacy_database() {
        let temp_root = std::env::temp_dir().join(format!(
            "wxreadmaster-reading-state-restore-reupgrade-{}",
            super::current_unix_seconds_string()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("temporary data dir should create");
        let database_path = temp_root.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&database_path).expect("legacy database should open");
        create_legacy_reading_item_schema(&connection);
        insert_legacy_reading_item(
            &connection,
            "c1",
            "candidate",
            "toRead",
            Some("发现页保存的本地候选"),
        );
        let backup_dir = ensure_reading_state_pre_migration_backup(&database_path, &connection)
            .expect("pre-migration backup should create")
            .expect("backup path should return");
        initialize_schema(&connection).expect("first upgrade should succeed");
        let first_life_status: String = connection
            .query_row(
                "SELECT life_status FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| row.get(0),
            )
            .expect("upgraded row should read");
        assert_eq!(first_life_status, "want");
        drop(connection);

        std::fs::copy(backup_dir.join(DATABASE_FILE_NAME), &database_path)
            .expect("legacy database should restore from backup");
        let restored = Connection::open(&database_path).expect("restored database should open");
        assert!(reading_state_dimensions_need_migration(&restored)
            .expect("restored database should need migration"));
        let restored_columns = table_columns(&restored, "reading_item_states")
            .expect("restored legacy columns should read");
        assert!(!restored_columns
            .iter()
            .any(|column| column == "life_status"));
        let reused_backup = ensure_reading_state_pre_migration_backup(&database_path, &restored)
            .expect("existing backup should be reused")
            .expect("backup path should return");
        assert_eq!(reused_backup, backup_dir);
        initialize_schema(&restored).expect("restored database should re-upgrade");
        let reupgraded: (String, String) = restored
            .query_row(
                "SELECT life_status, organize_status
                 FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("re-upgraded row should read");
        assert_eq!(reupgraded, ("want".to_string(), "none".to_string()));

        drop(restored);
        std::fs::remove_dir_all(temp_root).expect("temporary data dir should remove");
    }

    #[test]
    fn reading_item_dimensions_backfill_maps_legacy_rows() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_legacy_reading_item(
            &connection,
            "c1",
            "candidate",
            "toRead",
            Some("发现页保存的本地候选"),
        );
        insert_legacy_reading_item(
            &connection,
            "a1",
            "album",
            "toRead",
            Some("书架有声书保存的本地候选"),
        );
        insert_legacy_reading_item(&connection, "b1", "book", "reviewing", None);
        insert_legacy_reading_item(
            &connection,
            "ai-rec-1",
            "candidate",
            "toRead",
            Some("来自 AI 阅读助手推荐。理由：适合入门"),
        );
        insert_legacy_reading_item(&connection, "b2", "book", "organized", Some("我的私人备注"));

        ensure_reading_item_dimensions(&connection).expect("backfill should run");

        let (is_candidate, candidate_source, life_status, source_meta): (
            i64,
            Option<String>,
            String,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT is_candidate, candidate_source, life_status, source_meta
                 FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("candidate row should read");
        assert_eq!(is_candidate, 1);
        assert_eq!(candidate_source.as_deref(), Some("weread"));
        assert_eq!(life_status, "want");
        assert!(source_meta
            .expect("source meta should exist")
            .contains("discovery"));

        let light_source: Option<String> = connection
            .query_row(
                "SELECT candidate_source FROM reading_item_states WHERE item_id = 'a1'",
                [],
                |row| row.get(0),
            )
            .expect("album row should read");
        assert_eq!(light_source.as_deref(), Some("light"));

        let organize_status: String = connection
            .query_row(
                "SELECT organize_status FROM reading_item_states WHERE item_id = 'b1'",
                [],
                |row| row.get(0),
            )
            .expect("reviewing row should read");
        assert_eq!(organize_status, "to_organize");

        let ai_source: Option<String> = connection
            .query_row(
                "SELECT candidate_source FROM reading_item_states WHERE item_id = 'ai-rec-1'",
                [],
                |row| row.get(0),
            )
            .expect("ai row should read");
        assert_eq!(ai_source.as_deref(), Some("ai_unconfirmed"));

        let user_note: Option<String> = connection
            .query_row(
                "SELECT user_note FROM reading_item_states WHERE item_id = 'b2'",
                [],
                |row| row.get(0),
            )
            .expect("noted row should read");
        assert_eq!(user_note.as_deref(), Some("我的私人备注"));

        let dimensions = derive_reading_item_dimensions(
            "c9",
            "candidate",
            "toRead",
            Some("来自 AI 阅读助手推荐。已通过微信读书搜索确认。"),
        );
        assert_eq!(dimensions.candidate_source.as_deref(), Some("ai_confirmed"));
    }

    #[test]
    fn reading_item_dimensions_backfill_is_idempotent_and_backs_up_once() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_legacy_reading_item(&connection, "c1", "candidate", "toRead", None);

        let first_summary =
            migrate_reading_item_dimensions(&connection).expect("first backfill should run");
        assert_eq!(first_summary.total_rows_before, 1);
        assert_eq!(first_summary.pending_rows, 1);
        assert_eq!(first_summary.scanned, 1);
        assert_eq!(first_summary.updated, 1);
        assert_eq!(first_summary.unchanged, 0);
        assert_eq!(first_summary.backup_rows, 1);
        assert_eq!(first_summary.invalid_rows, 0);
        assert_eq!(first_summary.by_legacy_type.get("candidate"), Some(&1));
        assert_eq!(first_summary.by_life_status.get("want"), Some(&1));
        assert_eq!(first_summary.by_organize_status.get("none"), Some(&1));

        connection
            .execute(
                "UPDATE reading_item_states SET organize_status = 'organized' WHERE item_id = 'c1'",
                [],
            )
            .expect("manual update should apply");

        let second_summary =
            migrate_reading_item_dimensions(&connection).expect("second run should be a no-op");
        assert_eq!(second_summary.total_rows_before, 1);
        assert_eq!(second_summary.pending_rows, 0);
        assert_eq!(second_summary.scanned, 0);
        assert_eq!(second_summary.updated, 0);
        assert_eq!(second_summary.unchanged, 0);
        assert_eq!(second_summary.backup_rows, 1);

        let organize_status: String = connection
            .query_row(
                "SELECT organize_status FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| row.get(0),
            )
            .expect("row should read");
        assert_eq!(organize_status, "organized");

        let backup_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM reading_item_states_backup_v1",
                [],
                |row| row.get(0),
            )
            .expect("backup table should read");
        assert_eq!(backup_count, 1);
    }

    #[test]
    fn reading_item_dimensions_backfill_rejects_stale_backup_without_pending_coverage() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_legacy_reading_item(&connection, "c1", "candidate", "toRead", None);
        connection
            .execute_batch(
                "CREATE TABLE reading_item_states_backup_v1 AS
                 SELECT * FROM reading_item_states WHERE 0",
            )
            .expect("stale backup table should create");

        let error = migrate_reading_item_dimensions(&connection)
            .expect_err("empty existing backup must not be overwritten silently");

        assert!(error
            .to_string()
            .contains("backupRows must equal pendingRows"));
        let life_status: Option<String> = connection
            .query_row(
                "SELECT life_status FROM reading_item_states WHERE item_id = 'c1'",
                [],
                |row| row.get(0),
            )
            .expect("legacy row should remain readable");
        assert!(life_status.is_none());
    }

    #[test]
    fn reading_item_dimensions_backfill_rejects_unknown_item_type_without_updates() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        initialize_schema(&connection).expect("schema should initialize");
        insert_legacy_reading_item(&connection, "x1", "futureType", "toRead", None);

        let error = migrate_reading_item_dimensions(&connection)
            .expect_err("unknown item kind must stop the migration");

        assert!(error.to_string().contains("invalidRows must be zero"));
        let life_status: Option<String> = connection
            .query_row(
                "SELECT life_status FROM reading_item_states WHERE item_id = 'x1'",
                [],
                |row| row.get(0),
            )
            .expect("legacy row should remain readable");
        assert!(life_status.is_none());
        let backup_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM reading_item_states_backup_v1",
                [],
                |row| row.get(0),
            )
            .expect("backup row should exist for recovery");
        assert_eq!(backup_count, 1);
    }

    #[test]
    fn initialize_schema_migrates_ai_assistant_messages_output_json() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        connection
            .execute_batch(
                "
                CREATE TABLE ai_assistant_threads (
                    id TEXT PRIMARY KEY NOT NULL,
                    scope TEXT NOT NULL,
                    entity_id TEXT,
                    title TEXT NOT NULL,
                    context_summary_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE ai_assistant_messages (
                    id TEXT PRIMARY KEY NOT NULL,
                    thread_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending', 'answered', 'failed')),
                    used_context_json TEXT NOT NULL,
                    prompt_version TEXT,
                    input_hash TEXT,
                    provider_model TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(thread_id) REFERENCES ai_assistant_threads(id) ON DELETE CASCADE
                );
                ",
            )
            .expect("legacy assistant schema should be created");

        initialize_schema(&connection).expect("schema should migrate");

        let columns =
            table_columns(&connection, "ai_assistant_messages").expect("columns should read");
        assert!(columns.iter().any(|column| column == "output_json"));
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

        assert!(
            super::table_references(&connection, "local_reading_progress", "local_books")
                .expect("progress foreign key should read")
        );
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
