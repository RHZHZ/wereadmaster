use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{db, errors::AppError};

const VALID_STATUSES: &[&str] = &["toRead", "reading", "reviewing", "organized"];
const VALID_ITEM_TYPES: &[&str] = &["book", "album", "mp", "candidate"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemState {
    pub item_id: String,
    pub item_type: String,
    pub status: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub category: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemStateInput {
    pub item_id: String,
    pub item_type: String,
    pub status: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub category: Option<String>,
    pub note: Option<String>,
}

pub struct ReadingStateService {
    app: AppHandle,
}

impl ReadingStateService {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn list_states(&self) -> Result<Vec<ReadingItemState>, AppError> {
        let connection = self.open_connection()?;
        read_states(&connection)
    }

    pub fn get_state(&self, item_id: String) -> Result<Option<ReadingItemState>, AppError> {
        let normalized_item_id = normalize_required("itemId", &item_id, 128)?;
        let connection = self.open_connection()?;
        read_state(&connection, &normalized_item_id)
    }

    pub fn upsert_state(&self, input: ReadingItemStateInput) -> Result<ReadingItemState, AppError> {
        let normalized = normalize_input(input)?;
        let connection = self.open_connection()?;
        upsert_state(&connection, normalized)
    }

    pub fn remove_state(&self, item_id: String) -> Result<Option<ReadingItemState>, AppError> {
        let normalized_item_id = normalize_required("itemId", &item_id, 128)?;
        let connection = self.open_connection()?;
        let current = read_state(&connection, &normalized_item_id)?;

        if current.is_some() {
            connection
                .execute(
                    "DELETE FROM reading_item_states WHERE item_id = ?1",
                    [&normalized_item_id],
                )
                .map_err(AppError::from)?;
        }

        Ok(current)
    }

    fn open_connection(&self) -> Result<rusqlite::Connection, AppError> {
        db::open_connection(&self.app).map_err(AppError::Storage)
    }
}

fn read_states(connection: &rusqlite::Connection) -> Result<Vec<ReadingItemState>, AppError> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                item_id,
                item_type,
                status,
                title,
                author,
                cover,
                category,
                note,
                created_at,
                updated_at
            FROM reading_item_states
            ORDER BY updated_at DESC, title ASC, item_id ASC
            ",
        )
        .map_err(AppError::from)?;

    let states = statement
        .query_map([], map_state_row)
        .map_err(AppError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)?;

    Ok(states)
}

fn read_state(
    connection: &rusqlite::Connection,
    item_id: &str,
) -> Result<Option<ReadingItemState>, AppError> {
    connection
        .query_row(
            "
            SELECT
                item_id,
                item_type,
                status,
                title,
                author,
                cover,
                category,
                note,
                created_at,
                updated_at
            FROM reading_item_states
            WHERE item_id = ?1
            ",
            [item_id],
            map_state_row,
        )
        .optional()
        .map_err(AppError::from)
}

fn upsert_state(
    connection: &rusqlite::Connection,
    input: ReadingItemStateInput,
) -> Result<ReadingItemState, AppError> {
    let now = current_unix_seconds();
    connection
        .execute(
            "
            INSERT INTO reading_item_states (
                item_id,
                item_type,
                status,
                title,
                author,
                cover,
                category,
                note,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
            ON CONFLICT(item_id) DO UPDATE SET
                item_type = excluded.item_type,
                status = excluded.status,
                title = excluded.title,
                author = excluded.author,
                cover = excluded.cover,
                category = excluded.category,
                note = excluded.note,
                updated_at = excluded.updated_at
            ",
            rusqlite::params![
                &input.item_id,
                &input.item_type,
                &input.status,
                &input.title,
                &input.author,
                &input.cover,
                &input.category,
                &input.note,
                &now
            ],
        )
        .map_err(AppError::from)?;

    read_state(connection, &input.item_id)?.ok_or_else(|| {
        AppError::Storage("reading item state upsert did not return a row".to_string())
    })
}

fn map_state_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReadingItemState> {
    Ok(ReadingItemState {
        item_id: row.get(0)?,
        item_type: row.get(1)?,
        status: row.get(2)?,
        title: row.get(3)?,
        author: row.get(4)?,
        cover: row.get(5)?,
        category: row.get(6)?,
        note: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn normalize_input(input: ReadingItemStateInput) -> Result<ReadingItemStateInput, AppError> {
    let item_id = normalize_required("itemId", &input.item_id, 128)?;
    let item_type = normalize_choice("itemType", &input.item_type, VALID_ITEM_TYPES)?;
    let status = normalize_choice("status", &input.status, VALID_STATUSES)?;

    Ok(ReadingItemStateInput {
        item_id,
        item_type,
        status,
        title: normalize_optional(input.title, 160),
        author: normalize_optional(input.author, 120),
        cover: normalize_optional(input.cover, 500),
        category: normalize_optional(input.category, 120),
        note: normalize_optional(input.note, 500),
    })
}

fn normalize_required(field_name: &str, value: &str, max_len: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload(format!("{field_name} 不能为空。")));
    }

    if trimmed.len() > max_len {
        return Err(AppError::InvalidPayload(format!("{field_name} 过长。")));
    }

    Ok(trimmed.to_string())
}

fn normalize_choice(
    field_name: &str,
    value: &str,
    valid_values: &[&str],
) -> Result<String, AppError> {
    let normalized = normalize_required(field_name, value, 40)?;
    if !valid_values.contains(&normalized.as_str()) {
        return Err(AppError::InvalidPayload(format!(
            "{field_name} 只能是 {}。",
            valid_values.join("、")
        )));
    }

    Ok(normalized)
}

fn normalize_optional(value: Option<String>, max_len: usize) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .map(|item| item.chars().take(max_len).collect())
}

fn current_unix_seconds() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use crate::{
        db::initialize_schema,
        mappers::shelf::map_shelf_response,
        services::shelf::{read_shelf_entries, replace_shelf_entries},
    };

    use super::{read_states, upsert_state, ReadingItemStateInput};

    #[test]
    fn reading_item_state_upserts_and_lists() {
        let connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");

        let state = upsert_state(
            &connection,
            ReadingItemStateInput {
                item_id: "book-1".to_string(),
                item_type: "book".to_string(),
                status: "toRead".to_string(),
                title: Some("深度工作".to_string()),
                author: Some("卡尔".to_string()),
                cover: None,
                category: Some("效率".to_string()),
                note: Some("先读前三章".to_string()),
            },
        )
        .expect("state should upsert");

        assert_eq!(state.item_id, "book-1");
        assert_eq!(state.status, "toRead");
        assert_eq!(
            read_states(&connection).expect("states should list").len(),
            1
        );
    }

    #[test]
    fn reading_item_state_survives_shelf_replacement() {
        let connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        let snapshot = map_shelf_response(&serde_json::json!({
            "books": [{ "bookId": "book-1", "title": "深度工作", "secret": 0 }]
        }));
        replace_shelf_entries(&connection, &snapshot.entries, "100")
            .expect("shelf entries should persist");
        upsert_state(
            &connection,
            ReadingItemStateInput {
                item_id: "book-1".to_string(),
                item_type: "book".to_string(),
                status: "reviewing".to_string(),
                title: Some("深度工作".to_string()),
                author: None,
                cover: None,
                category: None,
                note: None,
            },
        )
        .expect("state should upsert");
        let next_snapshot = map_shelf_response(&serde_json::json!({
            "books": [{ "bookId": "book-2", "title": "新书", "secret": 0 }]
        }));

        replace_shelf_entries(&connection, &next_snapshot.entries, "120")
            .expect("shelf entries should replace");

        assert_eq!(
            read_shelf_entries(&connection)
                .expect("shelf entries should read")
                .len(),
            1
        );
        let states = read_states(&connection).expect("states should list");
        assert_eq!(states.len(), 1);
        assert_eq!(states[0].item_id, "book-1");
        assert_eq!(states[0].status, "reviewing");
    }
}
