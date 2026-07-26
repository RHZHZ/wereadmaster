use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{db, errors::AppError};

const VALID_STATUSES: &[&str] = &["toRead", "reading", "reviewing", "organized"];
const VALID_ITEM_TYPES: &[&str] = &["book", "album", "mp", "candidate"];
const VALID_ITEM_KINDS: &[&str] = &["book", "album", "mp", "localBook"];
const VALID_LIFE_STATUSES: &[&str] = &["none", "want", "reading", "paused", "finished", "dropped"];
const VALID_ORGANIZE_STATUSES: &[&str] = &["none", "to_organize", "organized"];
const VALID_CANDIDATE_SOURCES: &[&str] = &["weread", "ai_unconfirmed", "ai_confirmed", "light"];
const VALID_FINISHED_SOURCES: &[&str] = &["weread_auto", "manual"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemState {
    pub item_id: String,
    pub item_type: String,
    pub status: String,
    pub item_kind: String,
    pub is_candidate: bool,
    pub candidate_source: Option<String>,
    pub life_status: String,
    pub finished_source: Option<String>,
    pub organize_status: String,
    pub user_note: Option<String>,
    pub source_meta: Option<String>,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemPatch {
    pub is_candidate: Option<bool>,
    pub candidate_source: Option<String>,
    pub life_status: Option<String>,
    pub finished_source: Option<String>,
    pub organize_status: Option<String>,
    pub user_note: Option<String>,
    pub clear_user_note: Option<bool>,
    pub source_meta: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItemMeta {
    pub item_kind: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub category: Option<String>,
}

const READING_ITEM_STATE_SELECT: &str = "
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
        updated_at,
        COALESCE(item_kind, CASE WHEN item_type = 'candidate' THEN 'book' ELSE item_type END),
        COALESCE(
            is_candidate,
            CASE WHEN item_type = 'candidate' AND status = 'toRead' THEN 1 ELSE 0 END
        ),
        candidate_source,
        COALESCE(life_status, 'none'),
        finished_source,
        COALESCE(
            organize_status,
            CASE status
                WHEN 'reviewing' THEN 'to_organize'
                WHEN 'organized' THEN 'organized'
                ELSE 'none'
            END
        ),
        user_note,
        source_meta
    FROM reading_item_states
";

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

    pub fn patch_state(
        &self,
        item_id: String,
        patch: ReadingItemPatch,
        meta: Option<ReadingItemMeta>,
    ) -> Result<ReadingItemState, AppError> {
        let connection = self.open_connection()?;
        patch_state(&connection, &item_id, patch, meta)
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
        .prepare(&format!(
            "{READING_ITEM_STATE_SELECT} ORDER BY updated_at DESC, title ASC, item_id ASC"
        ))
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
            &format!("{READING_ITEM_STATE_SELECT} WHERE item_id = ?1"),
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

fn patch_state(
    connection: &rusqlite::Connection,
    item_id: &str,
    patch: ReadingItemPatch,
    meta: Option<ReadingItemMeta>,
) -> Result<ReadingItemState, AppError> {
    let normalized_item_id = normalize_required("itemId", item_id, 128)?;
    let normalized_patch = normalize_patch(patch)?;
    let now = current_unix_seconds();

    if read_state(connection, &normalized_item_id)?.is_none() {
        let meta = meta.ok_or_else(|| {
            AppError::InvalidPayload("该条目尚无本地记录，需要提供 meta 才能创建。".to_string())
        })?;
        let normalized_meta = normalize_meta(meta)?;
        let legacy_item_type = if normalized_meta.item_kind == "localBook" {
            "book".to_string()
        } else {
            normalized_meta.item_kind.clone()
        };

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
                    updated_at,
                    item_kind,
                    is_candidate,
                    life_status,
                    organize_status
                )
                VALUES (?1, ?2, 'toRead', ?3, ?4, ?5, ?6, NULL, ?7, ?7, ?8, 0, 'none', 'none')
                ",
                rusqlite::params![
                    &normalized_item_id,
                    &legacy_item_type,
                    &normalized_meta.title,
                    &normalized_meta.author,
                    &normalized_meta.cover,
                    &normalized_meta.category,
                    &now,
                    &normalized_meta.item_kind
                ],
            )
            .map_err(AppError::from)?;
    }

    let clear_user_note = normalized_patch.clear_user_note.unwrap_or(false);
    connection
        .execute(
            "
            UPDATE reading_item_states SET
                is_candidate     = COALESCE(?2, is_candidate),
                candidate_source = COALESCE(?3, candidate_source),
                life_status      = COALESCE(?4, life_status),
                finished_source  = COALESCE(?5, finished_source),
                organize_status  = COALESCE(?6, organize_status),
                user_note        = CASE WHEN ?7 THEN NULL ELSE COALESCE(?8, user_note) END,
                source_meta      = COALESCE(?9, source_meta),
                updated_at       = ?10
            WHERE item_id = ?1
            ",
            rusqlite::params![
                &normalized_item_id,
                normalized_patch.is_candidate.map(|value| value as i64),
                &normalized_patch.candidate_source,
                &normalized_patch.life_status,
                &normalized_patch.finished_source,
                &normalized_patch.organize_status,
                clear_user_note,
                &normalized_patch.user_note,
                &normalized_patch.source_meta,
                &now
            ],
        )
        .map_err(AppError::from)?;

    read_state(connection, &normalized_item_id)?.ok_or_else(|| {
        AppError::Storage("reading item state patch did not return a row".to_string())
    })
}

pub fn maybe_mark_weread_finished(
    connection: &rusqlite::Connection,
    item_id: &str,
    updated_at: &str,
) -> Result<bool, AppError> {
    let changed = connection
        .execute(
            "
            UPDATE reading_item_states SET
                life_status = 'finished',
                finished_source = 'weread_auto',
                updated_at = ?2
            WHERE item_id = ?1
              AND COALESCE(finished_source, '') != 'manual'
              AND COALESCE(life_status, 'none') NOT IN ('finished', 'dropped')
            ",
            rusqlite::params![item_id, updated_at],
        )
        .map_err(AppError::from)?;

    Ok(changed > 0)
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
        item_kind: row.get(10)?,
        is_candidate: row.get::<_, i64>(11)? != 0,
        candidate_source: row.get(12)?,
        life_status: row.get(13)?,
        finished_source: row.get(14)?,
        organize_status: row.get(15)?,
        user_note: row.get(16)?,
        source_meta: row.get(17)?,
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

fn normalize_patch(patch: ReadingItemPatch) -> Result<ReadingItemPatch, AppError> {
    let life_status =
        normalize_optional_choice("lifeStatus", patch.life_status, VALID_LIFE_STATUSES)?;
    let mut finished_source = normalize_optional_choice(
        "finishedSource",
        patch.finished_source,
        VALID_FINISHED_SOURCES,
    )?;

    if life_status.as_deref() == Some("finished") && finished_source.is_none() {
        finished_source = Some("manual".to_string());
    }

    let source_meta = match normalize_optional(patch.source_meta, 2000) {
        Some(raw) => {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|_| {
                AppError::InvalidPayload("sourceMeta 必须是合法的 JSON。".to_string())
            })?;
            Some(raw)
        }
        None => None,
    };

    Ok(ReadingItemPatch {
        is_candidate: patch.is_candidate,
        candidate_source: normalize_optional_choice(
            "candidateSource",
            patch.candidate_source,
            VALID_CANDIDATE_SOURCES,
        )?,
        life_status,
        finished_source,
        organize_status: normalize_optional_choice(
            "organizeStatus",
            patch.organize_status,
            VALID_ORGANIZE_STATUSES,
        )?,
        user_note: normalize_optional(patch.user_note, 500),
        clear_user_note: patch.clear_user_note,
        source_meta,
    })
}

fn normalize_meta(meta: ReadingItemMeta) -> Result<ReadingItemMeta, AppError> {
    Ok(ReadingItemMeta {
        item_kind: normalize_choice("itemKind", &meta.item_kind, VALID_ITEM_KINDS)?,
        title: normalize_optional(meta.title, 160),
        author: normalize_optional(meta.author, 120),
        cover: normalize_optional(meta.cover, 500),
        category: normalize_optional(meta.category, 120),
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

fn normalize_optional_choice(
    field_name: &str,
    value: Option<String>,
    valid_values: &[&str],
) -> Result<Option<String>, AppError> {
    match normalize_optional(value, 40) {
        Some(candidate) => normalize_choice(field_name, &candidate, valid_values).map(Some),
        None => Ok(None),
    }
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
        errors::AppError,
        mappers::shelf::map_shelf_response,
        services::shelf::{read_shelf_entries, replace_shelf_entries},
    };

    use super::{
        maybe_mark_weread_finished, patch_state, read_state, read_states, upsert_state,
        ReadingItemMeta, ReadingItemPatch, ReadingItemStateInput,
    };

    fn open_test_connection() -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().expect("database should open");
        initialize_schema(&connection).expect("schema should initialize");
        connection
    }

    fn book_meta(title: Option<&str>) -> ReadingItemMeta {
        ReadingItemMeta {
            item_kind: "book".to_string(),
            title: title.map(str::to_string),
            author: None,
            cover: None,
            category: None,
        }
    }

    #[test]
    fn reading_item_state_upserts_and_lists() {
        let connection = open_test_connection();

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
        let connection = open_test_connection();
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

    #[test]
    fn legacy_upsert_rows_read_with_dimension_defaults() {
        let connection = open_test_connection();
        upsert_state(
            &connection,
            ReadingItemStateInput {
                item_id: "cand-1".to_string(),
                item_type: "candidate".to_string(),
                status: "toRead".to_string(),
                title: Some("候选书".to_string()),
                author: None,
                cover: None,
                category: None,
                note: None,
            },
        )
        .expect("state should upsert");

        let state = read_state(&connection, "cand-1")
            .expect("state should read")
            .expect("state should exist");
        assert!(state.is_candidate);
        assert_eq!(state.item_kind, "book");
        assert_eq!(state.life_status, "none");
        assert_eq!(state.organize_status, "none");
    }

    #[test]
    fn patch_creates_row_with_meta_and_defaults() {
        let connection = open_test_connection();

        let state = patch_state(
            &connection,
            "book-9",
            ReadingItemPatch {
                is_candidate: Some(true),
                candidate_source: Some("weread".to_string()),
                ..Default::default()
            },
            Some(book_meta(Some("深度工作"))),
        )
        .expect("patch should create the row");

        assert!(state.is_candidate);
        assert_eq!(state.candidate_source.as_deref(), Some("weread"));
        assert_eq!(state.life_status, "none");
        assert_eq!(state.organize_status, "none");
        assert_eq!(state.title.as_deref(), Some("深度工作"));
    }

    #[test]
    fn patch_without_meta_on_missing_row_fails() {
        let connection = open_test_connection();

        let result = patch_state(&connection, "missing", ReadingItemPatch::default(), None);

        assert!(matches!(result, Err(AppError::InvalidPayload(_))));
    }

    #[test]
    fn patch_updates_one_dimension_without_touching_others() {
        let connection = open_test_connection();
        patch_state(
            &connection,
            "cand-1",
            ReadingItemPatch {
                is_candidate: Some(true),
                candidate_source: Some("weread".to_string()),
                user_note: Some("我的私人备注".to_string()),
                ..Default::default()
            },
            Some(book_meta(Some("候选书"))),
        )
        .expect("candidate should create");

        // 标记待整理不得清除候选身份与备注（B1 回归）。
        let state = patch_state(
            &connection,
            "cand-1",
            ReadingItemPatch {
                organize_status: Some("to_organize".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("organize patch should apply");
        assert!(state.is_candidate);
        assert_eq!(state.user_note.as_deref(), Some("我的私人备注"));
        assert_eq!(state.organize_status, "to_organize");

        // 加入候选不得清除整理状态。
        let state = patch_state(
            &connection,
            "cand-1",
            ReadingItemPatch {
                is_candidate: Some(true),
                ..Default::default()
            },
            None,
        )
        .expect("candidate patch should apply");
        assert_eq!(state.organize_status, "to_organize");

        // 暂缓：退出候选但保留记录与整理状态。
        let state = patch_state(
            &connection,
            "cand-1",
            ReadingItemPatch {
                is_candidate: Some(false),
                life_status: Some("dropped".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("defer patch should apply");
        assert!(!state.is_candidate);
        assert_eq!(state.life_status, "dropped");
        assert_eq!(state.organize_status, "to_organize");
    }

    #[test]
    fn patch_sets_and_clears_user_note() {
        let connection = open_test_connection();
        patch_state(
            &connection,
            "book-1",
            ReadingItemPatch::default(),
            Some(book_meta(Some("书"))),
        )
        .expect("row should create");

        let state = patch_state(
            &connection,
            "book-1",
            ReadingItemPatch {
                user_note: Some("  先读前三章  ".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("note patch should apply");
        assert_eq!(state.user_note.as_deref(), Some("先读前三章"));

        let state = patch_state(
            &connection,
            "book-1",
            ReadingItemPatch {
                clear_user_note: Some(true),
                ..Default::default()
            },
            None,
        )
        .expect("clear patch should apply");
        assert_eq!(state.user_note, None);
    }

    #[test]
    fn patch_rejects_invalid_values() {
        let connection = open_test_connection();
        patch_state(
            &connection,
            "book-1",
            ReadingItemPatch::default(),
            Some(book_meta(None)),
        )
        .expect("row should create");

        let invalid_life_status = patch_state(
            &connection,
            "book-1",
            ReadingItemPatch {
                life_status: Some("done".to_string()),
                ..Default::default()
            },
            None,
        );
        assert!(matches!(
            invalid_life_status,
            Err(AppError::InvalidPayload(_))
        ));

        let invalid_item_kind = patch_state(
            &connection,
            "book-2",
            ReadingItemPatch::default(),
            Some(ReadingItemMeta {
                item_kind: "candidate".to_string(),
                title: None,
                author: None,
                cover: None,
                category: None,
            }),
        );
        assert!(matches!(
            invalid_item_kind,
            Err(AppError::InvalidPayload(_))
        ));

        let invalid_source_meta = patch_state(
            &connection,
            "book-1",
            ReadingItemPatch {
                source_meta: Some("not-json".to_string()),
                ..Default::default()
            },
            None,
        );
        assert!(matches!(
            invalid_source_meta,
            Err(AppError::InvalidPayload(_))
        ));
    }

    #[test]
    fn manual_finished_defaults_finished_source() {
        let connection = open_test_connection();
        patch_state(
            &connection,
            "book-1",
            ReadingItemPatch::default(),
            Some(book_meta(None)),
        )
        .expect("row should create");

        let state = patch_state(
            &connection,
            "book-1",
            ReadingItemPatch {
                life_status: Some("finished".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("finished patch should apply");

        assert_eq!(state.life_status, "finished");
        assert_eq!(state.finished_source.as_deref(), Some("manual"));
    }

    #[test]
    fn weread_finished_marks_but_never_overrides_manual_or_dropped() {
        let connection = open_test_connection();
        for item_id in ["book-1", "book-2", "book-3"] {
            patch_state(
                &connection,
                item_id,
                ReadingItemPatch::default(),
                Some(book_meta(None)),
            )
            .expect("row should create");
        }

        assert!(
            maybe_mark_weread_finished(&connection, "book-1", "200").expect("mark should run")
        );
        let state = read_state(&connection, "book-1")
            .expect("state should read")
            .expect("state should exist");
        assert_eq!(state.life_status, "finished");
        assert_eq!(state.finished_source.as_deref(), Some("weread_auto"));
        assert!(
            !maybe_mark_weread_finished(&connection, "book-1", "201").expect("repeat should run")
        );

        patch_state(
            &connection,
            "book-2",
            ReadingItemPatch {
                life_status: Some("paused".to_string()),
                finished_source: Some("manual".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("manual patch should apply");
        assert!(
            !maybe_mark_weread_finished(&connection, "book-2", "200").expect("mark should run")
        );
        let state = read_state(&connection, "book-2")
            .expect("state should read")
            .expect("state should exist");
        assert_eq!(state.life_status, "paused");

        patch_state(
            &connection,
            "book-3",
            ReadingItemPatch {
                life_status: Some("dropped".to_string()),
                ..Default::default()
            },
            None,
        )
        .expect("dropped patch should apply");
        assert!(
            !maybe_mark_weread_finished(&connection, "book-3", "200").expect("mark should run")
        );

        assert!(!maybe_mark_weread_finished(&connection, "missing", "200")
            .expect("missing row should be a no-op"));
    }
}
