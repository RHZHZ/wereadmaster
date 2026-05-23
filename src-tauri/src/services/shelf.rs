use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::{
    db,
    errors::AppError,
    mappers::shelf::{map_shelf_response, BookshelfSnapshot, ShelfEntryRecord},
    repositories::{
        cache::RawCacheRepository,
        sync_state::{SyncStateRecord, SyncStateRepository},
    },
    services::weread_gateway::{WereadApi, WereadGateway},
};

const SHELF_SECTION: &str = "shelf";
const SHELF_CACHE_KEY: &str = "latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookshelfResponse {
    pub snapshot: BookshelfSnapshot,
    pub sync_state: Option<SyncStateRecord>,
}

pub struct ShelfService {
    app: AppHandle,
}

impl ShelfService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub async fn sync_shelf(&self) -> Result<BookshelfResponse, AppError> {
        let started_at = current_unix_seconds();
        let mut connection = self.open_connection()?;
        {
            let sync_repository = SyncStateRepository::new(&connection);
            sync_repository
                .mark_syncing(SHELF_SECTION, &started_at)
                .map_err(AppError::from)?;
        }

        let gateway = WereadGateway::new(self.app.clone());
        let response = gateway.call(WereadApi::SyncShelf, json!({})).await;

        match response {
            Ok(raw) => {
                let completed_at = current_unix_seconds();
                let snapshot = map_shelf_response(&raw);
                let transaction = connection.transaction().map_err(AppError::from)?;
                replace_shelf_entries(&transaction, &snapshot.entries, &completed_at)?;
                RawCacheRepository::new(&transaction)
                    .put_json(SHELF_SECTION, SHELF_CACHE_KEY, &raw, &completed_at)
                    .map_err(AppError::from)?;
                SyncStateRepository::new(&transaction)
                    .mark_success(SHELF_SECTION, &completed_at)
                    .map_err(AppError::from)?;
                transaction.commit().map_err(AppError::from)?;

                Ok(BookshelfResponse {
                    snapshot,
                    sync_state: SyncStateRepository::new(&connection)
                        .get(SHELF_SECTION)
                        .map_err(AppError::from)?,
                })
            }
            Err(error) => {
                let attempted_at = current_unix_seconds();
                SyncStateRepository::new(&connection)
                    .mark_failed(
                        SHELF_SECTION,
                        &attempted_at,
                        error.code(),
                        &error.user_message(),
                    )
                    .map_err(AppError::from)?;

                Err(error)
            }
        }
    }

    pub fn get_bookshelf(&self) -> Result<BookshelfResponse, AppError> {
        let connection = self.open_connection()?;
        let entries = read_shelf_entries(&connection)?;
        let snapshot = BookshelfSnapshot {
            summary: crate::mappers::shelf::summarize_entries(&entries),
            entries,
        };
        let sync_state = SyncStateRepository::new(&connection)
            .get(SHELF_SECTION)
            .map_err(AppError::from)?;

        Ok(BookshelfResponse {
            snapshot,
            sync_state,
        })
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

pub(crate) fn replace_shelf_entries(
    connection: &rusqlite::Connection,
    entries: &[ShelfEntryRecord],
    updated_at: &str,
) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM shelf_entries", [])
        .map_err(AppError::from)?;

    for entry in entries {
        connection
            .execute(
                "
                INSERT INTO shelf_entries (
                    id,
                    type,
                    title,
                    author,
                    cover,
                    category,
                    is_top,
                    is_secret,
                    is_finished,
                    last_read_at,
                    raw_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                rusqlite::params![
                    &entry.id,
                    &entry.entry_type,
                    &entry.title,
                    &entry.author,
                    &entry.cover,
                    &entry.category,
                    bool_to_int(entry.is_top),
                    bool_to_int(entry.is_secret),
                    entry.is_finished.map(bool_to_int),
                    entry.last_read_at,
                    &entry.raw_json,
                    updated_at
                ],
            )
            .map_err(AppError::from)?;
    }

    Ok(())
}

pub(crate) fn read_shelf_entries(
    connection: &rusqlite::Connection,
) -> Result<Vec<ShelfEntryRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                id,
                type,
                title,
                author,
                cover,
                category,
                is_top,
                is_secret,
                is_finished,
                last_read_at,
                raw_json
            FROM shelf_entries
            ORDER BY is_top DESC, last_read_at DESC, title ASC
            ",
        )
        .map_err(AppError::from)?;

    let entries = statement
        .query_map([], |row| {
            let is_finished: Option<i64> = row.get(8)?;

            Ok(ShelfEntryRecord {
                id: row.get(0)?,
                entry_type: row.get(1)?,
                title: row.get(2)?,
                author: row.get(3)?,
                cover: row.get(4)?,
                category: row.get(5)?,
                is_top: row.get::<_, i64>(6)? == 1,
                is_secret: row.get::<_, i64>(7)? == 1,
                is_finished: is_finished.map(|value| value == 1),
                last_read_at: row.get(9)?,
                raw_json: row.get(10)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)?;

    Ok(entries)
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
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
    use crate::{db::initialize_schema, mappers::shelf::map_shelf_response};

    use super::{read_shelf_entries, replace_shelf_entries};

    #[test]
    fn replace_shelf_entries_persists_all_entry_types() {
        let connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let snapshot = map_shelf_response(&serde_json::json!({
            "books": [{ "bookId": "b1", "title": "书", "secret": 0 }],
            "albums": [{
                "albumInfo": { "albumId": "a1", "name": "听书" },
                "albumInfoExtra": { "secret": 1 }
            }],
            "mp": { "title": "文章收藏" }
        }));

        replace_shelf_entries(&connection, &snapshot.entries, "100")
            .expect("entries should persist");
        let entries = read_shelf_entries(&connection).expect("entries should read");

        assert_eq!(entries.len(), 3);
        assert_eq!(
            crate::mappers::shelf::summarize_entries(&entries).total_visible_entries,
            3
        );
    }
}
