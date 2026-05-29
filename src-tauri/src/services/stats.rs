use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::{
    db,
    errors::AppError,
    mappers::stats::{empty_reading_stats, map_reading_stats_response, ReadingStatsRecord},
    repositories::{
        cache::RawCacheRepository,
        sync_state::{SyncStateRecord, SyncStateRepository},
    },
    services::{
        sync_timing::with_sync_timing,
        weread_gateway::{WereadApi, WereadGateway},
    },
};

const STATS_SECTION: &str = "stats";
const STATS_CACHE_NAMESPACE: &str = "stats";
const DEFAULT_STATS_MODE: &str = "monthly";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatsResponse {
    pub stats: ReadingStatsRecord,
    pub sync_state: Option<SyncStateRecord>,
    pub source: ReadingStatsResponseSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadingStatsResponseSource {
    Cache,
    Synced,
    Empty,
}

pub struct StatsService {
    app: AppHandle,
}

impl StatsService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn sync_reading_stats(
        &self,
        mode: Option<String>,
        base_time: Option<i64>,
    ) -> Result<ReadingStatsResponse, AppError> {
        let mode = normalize_stats_mode(mode)?;
        let base_time = normalize_base_time(&mode, base_time)?;
        let started_at = current_unix_seconds();
        self.mark_syncing(&started_at).await?;

        let gateway = WereadGateway::new(self.app.clone());
        match with_sync_timing(
            "stats.network",
            gateway.call(
                WereadApi::ReadingStats,
                build_reading_stats_params(&mode, base_time),
            ),
        )
        .await
        {
            Ok(raw) => {
                with_sync_timing(
                    "stats.persist",
                    self.persist_synced_stats(raw, mode, base_time),
                )
                .await
            }
            Err(error) => {
                let attempted_at = current_unix_seconds();
                self.mark_failed(&attempted_at, error.code(), &error.user_message())
                    .await?;
                Err(error)
            }
        }
    }

    pub async fn get_reading_stats(
        &self,
        mode: Option<String>,
        base_time: Option<i64>,
    ) -> Result<ReadingStatsResponse, AppError> {
        let mode = normalize_stats_mode(mode)?;
        let base_time = normalize_base_time(&mode, base_time)?;
        let app = self.app.clone();
        with_sync_timing(
            "stats.read_cache",
            tauri::async_runtime::spawn_blocking(
                move || -> Result<ReadingStatsResponse, AppError> {
                    let connection = db::open_connection(&app).map_err(AppError::Storage)?;
                    let cached_stats = match base_time {
                        Some(base_time) => read_reading_stats(&connection, &mode, base_time)?,
                        None => read_latest_reading_stats(&connection, &mode)?,
                    };
                    let source = if cached_stats.is_some() {
                        ReadingStatsResponseSource::Cache
                    } else {
                        ReadingStatsResponseSource::Empty
                    };
                    let stats = cached_stats
                        .unwrap_or_else(|| empty_reading_stats(&mode, base_time.unwrap_or(0)));
                    let sync_state = SyncStateRepository::new(&connection)
                        .get(STATS_SECTION)
                        .map_err(AppError::from)?;

                    Ok(ReadingStatsResponse {
                        stats,
                        sync_state,
                        source,
                    })
                },
            ),
        )
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?
    }
}

fn build_reading_stats_params(mode: &str, base_time: Option<i64>) -> Value {
    let mut params = Map::new();
    params.insert("mode".to_string(), json!(mode));

    let request_base_time = if mode == "overall" {
        0
    } else {
        base_time.unwrap_or(0)
    };
    params.insert("baseTime".to_string(), json!(request_base_time));

    Value::Object(params)
}

fn normalize_stats_mode(mode: Option<String>) -> Result<String, AppError> {
    let normalized = mode
        .as_deref()
        .unwrap_or(DEFAULT_STATS_MODE)
        .trim()
        .to_ascii_lowercase();

    match normalized.as_str() {
        "weekly" | "monthly" | "annually" | "overall" => Ok(normalized),
        _ => Err(AppError::InvalidPayload(
            "统计周期仅支持 weekly、monthly、annually、overall。".to_string(),
        )),
    }
}

fn normalize_base_time(mode: &str, base_time: Option<i64>) -> Result<Option<i64>, AppError> {
    if let Some(value) = base_time {
        if value < 0 {
            return Err(AppError::InvalidPayload(
                "baseTime 必须是非负 Unix 时间戳。".to_string(),
            ));
        }
    }

    if mode == "overall" {
        Ok(Some(0))
    } else if base_time == Some(0) {
        Ok(None)
    } else {
        Ok(base_time)
    }
}

fn upsert_reading_stats(
    connection: &rusqlite::Connection,
    stats: &ReadingStatsRecord,
    updated_at: &str,
) -> Result<(), AppError> {
    let mut statement = connection
        .prepare(
            "
            INSERT INTO reading_stats (
                mode,
                base_time,
                total_read_time_seconds,
                read_days,
                raw_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(mode, base_time) DO UPDATE SET
                total_read_time_seconds = excluded.total_read_time_seconds,
                read_days = excluded.read_days,
                raw_json = excluded.raw_json,
                updated_at = excluded.updated_at
            ",
        )
        .map_err(AppError::from)?;

    statement
        .execute(rusqlite::params![
            &stats.mode,
            stats.base_time,
            stats.total_read_time_seconds,
            stats.read_days,
            stats.raw.to_string(),
            updated_at
        ])
        .map_err(AppError::from)?;

    Ok(())
}

fn read_reading_stats(
    connection: &rusqlite::Connection,
    mode: &str,
    base_time: i64,
) -> Result<Option<ReadingStatsRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT mode, base_time, raw_json
            FROM reading_stats
            WHERE mode = ?1 AND base_time = ?2
            ",
            rusqlite::params![mode, base_time],
            map_reading_stats_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn read_latest_reading_stats(
    connection: &rusqlite::Connection,
    mode: &str,
) -> Result<Option<ReadingStatsRecord>, AppError> {
    connection
        .query_row(
            "
            SELECT mode, base_time, raw_json
            FROM reading_stats
            WHERE mode = ?1
            ORDER BY updated_at DESC, base_time DESC
            LIMIT 1
            ",
            [mode],
            map_reading_stats_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn map_reading_stats_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReadingStatsRecord> {
    let mode: String = row.get(0)?;
    let base_time: i64 = row.get(1)?;
    let raw_json: String = row.get(2)?;
    let raw = serde_json::from_str::<Value>(&raw_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(map_reading_stats_response(&mode, &raw, Some(base_time)))
}

fn stats_cache_key(mode: &str, base_time: i64) -> String {
    format!("{mode}:{base_time}")
}

impl StatsService {
    async fn persist_synced_stats(
        &self,
        raw: Value,
        mode: String,
        base_time: Option<i64>,
    ) -> Result<ReadingStatsResponse, AppError> {
        let app = self.app.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<ReadingStatsResponse, AppError> {
            let completed_at = current_unix_seconds();
            let mut connection = db::open_connection(&app).map_err(AppError::Storage)?;
            let stats = map_reading_stats_response(&mode, &raw, base_time);
            let transaction = connection.transaction().map_err(AppError::from)?;
            upsert_reading_stats(&transaction, &stats, &completed_at)?;
            RawCacheRepository::new(&transaction)
                .put_json(
                    STATS_CACHE_NAMESPACE,
                    &stats_cache_key(&stats.mode, stats.base_time),
                    &raw,
                    &completed_at,
                )
                .map_err(AppError::from)?;
            SyncStateRepository::new(&transaction)
                .mark_success(STATS_SECTION, &completed_at)
                .map_err(AppError::from)?;
            transaction.commit().map_err(AppError::from)?;

            Ok(ReadingStatsResponse {
                stats,
                sync_state: SyncStateRepository::new(&connection)
                    .get(STATS_SECTION)
                    .map_err(AppError::from)?,
                source: ReadingStatsResponseSource::Synced,
            })
        })
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?
    }

    async fn mark_syncing(&self, started_at: &str) -> Result<(), AppError> {
        let app = self.app.clone();
        let started_at = started_at.to_string();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
            let connection = db::open_connection(&app).map_err(AppError::Storage)?;
            SyncStateRepository::new(&connection)
                .mark_syncing(STATS_SECTION, &started_at)
                .map_err(AppError::from)
        })
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?
    }

    async fn mark_failed(
        &self,
        attempted_at: &str,
        error_code: &str,
        error_message: &str,
    ) -> Result<(), AppError> {
        let app = self.app.clone();
        let attempted_at = attempted_at.to_string();
        let error_code = error_code.to_string();
        let error_message = error_message.to_string();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
            let connection = db::open_connection(&app).map_err(AppError::Storage)?;
            SyncStateRepository::new(&connection)
                .mark_failed(STATS_SECTION, &attempted_at, &error_code, &error_message)
                .map_err(AppError::from)
        })
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?
    }
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

    use crate::{db::initialize_schema, mappers::stats::map_reading_stats_response};

    use super::{
        build_reading_stats_params, normalize_base_time, normalize_stats_mode,
        read_latest_reading_stats, read_reading_stats, upsert_reading_stats,
    };

    #[test]
    fn stats_mode_validation_defaults_and_rejects_custom_periods() {
        assert_eq!(
            normalize_stats_mode(None).expect("default should be valid"),
            "monthly"
        );
        assert_eq!(
            normalize_stats_mode(Some("WEEKLY".to_string())).expect("weekly should normalize"),
            "weekly"
        );
        assert!(normalize_stats_mode(Some("custom".to_string())).is_err());
    }

    #[test]
    fn overall_base_time_is_always_zero() {
        assert_eq!(
            normalize_base_time("overall", Some(123)).expect("overall should normalize"),
            Some(0)
        );
        assert_eq!(
            normalize_base_time("monthly", Some(0)).expect("zero current period should normalize"),
            None
        );
        assert!(normalize_base_time("monthly", Some(-1)).is_err());
    }

    #[test]
    fn current_period_sync_payload_sends_base_time_zero() {
        assert_eq!(
            build_reading_stats_params("monthly", None),
            json!({
                "mode": "monthly",
                "baseTime": 0
            })
        );
        assert_eq!(
            build_reading_stats_params("annually", None),
            json!({
                "mode": "annually",
                "baseTime": 0
            })
        );
        assert_eq!(
            build_reading_stats_params("overall", Some(0)),
            json!({
                "mode": "overall",
                "baseTime": 0
            })
        );
    }

    #[test]
    fn reading_stats_persistence_upserts_and_reads_latest() {
        let connection = Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let old_stats = map_reading_stats_response(
            "monthly",
            &json!({ "baseTime": 100, "totalReadTime": 60, "readDays": 1 }),
            None,
        );
        let latest_stats = map_reading_stats_response(
            "monthly",
            &json!({ "baseTime": 200, "totalReadTime": 120, "readDays": 2 }),
            None,
        );

        upsert_reading_stats(&connection, &old_stats, "100").expect("old stats should save");
        upsert_reading_stats(&connection, &latest_stats, "200").expect("latest stats should save");

        let exact = read_reading_stats(&connection, "monthly", 100)
            .expect("stats should query")
            .expect("exact stats should exist");
        let latest = read_latest_reading_stats(&connection, "monthly")
            .expect("stats should query")
            .expect("latest stats should exist");

        assert_eq!(exact.total_read_time_seconds, Some(60));
        assert_eq!(latest.base_time, 200);
        assert_eq!(latest.total_read_time_seconds, Some(120));
    }
}
