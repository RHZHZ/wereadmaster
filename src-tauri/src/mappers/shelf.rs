use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfEntryRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub category: Option<String>,
    pub is_top: bool,
    pub is_secret: bool,
    pub is_finished: Option<bool>,
    pub last_read_at: Option<i64>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookshelfSummaryRecord {
    pub total_visible_entries: usize,
    pub book_count: usize,
    pub album_count: usize,
    pub mp_count: usize,
    pub public_count: usize,
    pub secret_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfArchiveRecord {
    pub id: String,
    pub name: String,
    pub book_ids: Vec<String>,
    pub matched_entry_count: usize,
    pub missing_book_count: usize,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookshelfSnapshot {
    pub entries: Vec<ShelfEntryRecord>,
    pub archives: Vec<ShelfArchiveRecord>,
    pub summary: BookshelfSummaryRecord,
}

pub fn map_shelf_response(value: &Value) -> BookshelfSnapshot {
    let books = value
        .get("books")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let albums = value
        .get("albums")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mp = value.get("mp").filter(|entry| !entry.is_null());

    let mut entries = Vec::with_capacity(books.len() + albums.len() + usize::from(mp.is_some()));

    for book in books {
        if let Some(entry) = map_book_entry(book) {
            entries.push(entry);
        }
    }

    for album in albums {
        if let Some(entry) = map_album_entry(album) {
            entries.push(entry);
        }
    }

    if let Some(mp_entry) = mp {
        entries.push(map_mp_entry(mp_entry));
    }

    let summary = summarize_entries(&entries);
    let archives = map_archive_entries(value, &entries);

    BookshelfSnapshot {
        entries,
        archives,
        summary,
    }
}

pub fn summarize_entries(entries: &[ShelfEntryRecord]) -> BookshelfSummaryRecord {
    let book_count = entries
        .iter()
        .filter(|entry| entry.entry_type == "book")
        .count();
    let album_count = entries
        .iter()
        .filter(|entry| entry.entry_type == "album")
        .count();
    let mp_count = entries
        .iter()
        .filter(|entry| entry.entry_type == "mp")
        .count();
    let secret_count = entries.iter().filter(|entry| entry.is_secret).count();

    BookshelfSummaryRecord {
        total_visible_entries: book_count + album_count + mp_count,
        book_count,
        album_count,
        mp_count,
        public_count: entries.len().saturating_sub(secret_count),
        secret_count,
    }
}

fn map_book_entry(value: &Value) -> Option<ShelfEntryRecord> {
    let id = string_field(value, "bookId")?;

    Some(ShelfEntryRecord {
        id,
        entry_type: "book".to_string(),
        title: string_field(value, "title").unwrap_or_else(|| "未命名书籍".to_string()),
        author: string_field(value, "author"),
        cover: string_field(value, "cover"),
        category: string_field(value, "category"),
        is_top: boolish_field(value, "isTop"),
        is_secret: boolish_field(value, "secret"),
        is_finished: value.get("finishReading").map(boolish_value),
        last_read_at: integer_field(value, "readUpdateTime"),
        raw_json: value.to_string(),
    })
}

fn map_album_entry(value: &Value) -> Option<ShelfEntryRecord> {
    let album_info = value.get("albumInfo").unwrap_or(value);
    let album_extra = value.get("albumInfoExtra");
    let id = string_field(album_info, "albumId")?;

    Some(ShelfEntryRecord {
        id,
        entry_type: "album".to_string(),
        title: string_field(album_info, "name").unwrap_or_else(|| "未命名有声书".to_string()),
        author: string_field(album_info, "authorName"),
        cover: string_field(album_info, "cover"),
        category: string_field(album_info, "category"),
        is_top: album_extra
            .map(|extra| boolish_field(extra, "isTop"))
            .unwrap_or(false),
        is_secret: album_extra
            .map(|extra| boolish_field(extra, "secret"))
            .unwrap_or(false),
        is_finished: album_info.get("finish").map(boolish_value),
        last_read_at: album_extra.and_then(|extra| integer_field(extra, "lectureReadUpdateTime")),
        raw_json: value.to_string(),
    })
}

fn map_mp_entry(value: &Value) -> ShelfEntryRecord {
    ShelfEntryRecord {
        id: string_field(value, "bookId")
            .or_else(|| string_field(value, "id"))
            .unwrap_or_else(|| "mp".to_string()),
        entry_type: "mp".to_string(),
        title: string_field(value, "title").unwrap_or_else(|| "文章收藏".to_string()),
        author: None,
        cover: string_field(value, "cover"),
        category: Some("文章收藏".to_string()),
        is_top: boolish_field(value, "isTop"),
        is_secret: true,
        is_finished: None,
        last_read_at: integer_field(value, "updateTime")
            .or_else(|| integer_field(value, "readUpdateTime")),
        raw_json: value.to_string(),
    }
}

fn map_archive_entries(value: &Value, entries: &[ShelfEntryRecord]) -> Vec<ShelfArchiveRecord> {
    let book_entry_ids = entries
        .iter()
        .filter(|entry| entry.entry_type == "book")
        .map(|entry| entry.id.as_str())
        .collect::<HashSet<_>>();

    value
        .get("archive")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .enumerate()
        .filter_map(|(index, archive)| map_archive_entry(index, archive, &book_entry_ids))
        .collect()
}

fn map_archive_entry(
    index: usize,
    value: &Value,
    book_entry_ids: &HashSet<&str>,
) -> Option<ShelfArchiveRecord> {
    if !value.is_object() {
        return None;
    }

    let name = string_field(value, "name").unwrap_or_else(|| "未命名书单".to_string());
    let book_ids = book_ids_field(value, "bookIds");
    let unique_book_ids = book_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let matched_entry_count = unique_book_ids
        .iter()
        .filter(|book_id| book_entry_ids.contains(**book_id))
        .count();
    let missing_book_count = unique_book_ids.len().saturating_sub(matched_entry_count);

    Some(ShelfArchiveRecord {
        id: archive_id(index, &name),
        name,
        book_ids,
        matched_entry_count,
        missing_book_count,
        raw_json: value.to_string(),
    })
}

fn archive_id(index: usize, name: &str) -> String {
    let mut normalized = String::new();

    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
        } else if (character.is_whitespace() || character == '-' || character == '_')
            && !normalized.ends_with('-')
        {
            normalized.push('-');
        }
    }

    let normalized = normalized.trim_matches('-');
    let slug = if normalized.is_empty() {
        "unnamed"
    } else {
        normalized
    };

    format!("archive:{index}:{slug}")
}

fn book_ids_field(value: &Value, key: &str) -> Vec<String> {
    let Some(items) = value.get(key).and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut book_ids = Vec::new();

    for item in items {
        let Some(book_id) = string_value(item) else {
            continue;
        };

        if seen.insert(book_id.clone()) {
            book_ids.push(book_id);
        }
    }

    book_ids
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(string_value)
}

fn string_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn integer_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|field| match field {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.parse::<i64>().ok(),
        _ => None,
    })
}

fn boolish_field(value: &Value, key: &str) -> bool {
    value.get(key).map(boolish_value).unwrap_or(false)
}

fn boolish_value(value: &Value) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_i64() == Some(1),
        Value::String(text) => text == "1" || text.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::map_shelf_response;

    #[test]
    fn map_shelf_response_counts_books_albums_and_mp() {
        let snapshot = map_shelf_response(&json!({
            "books": [
                { "bookId": "b1", "title": "书一", "secret": 0 },
                { "bookId": "b2", "title": "书二", "secret": 1 }
            ],
            "albums": [
                {
                    "albumInfo": { "albumId": "a1", "name": "有声书", "finish": 1 },
                    "albumInfoExtra": { "secret": 0, "isTop": 1 }
                }
            ],
            "mp": { "title": "文章收藏" }
        }));

        assert_eq!(snapshot.entries.len(), 4);
        assert!(snapshot.archives.is_empty());
        assert_eq!(snapshot.summary.total_visible_entries, 4);
        assert_eq!(snapshot.summary.book_count, 2);
        assert_eq!(snapshot.summary.album_count, 1);
        assert_eq!(snapshot.summary.mp_count, 1);
        assert_eq!(snapshot.summary.public_count, 2);
        assert_eq!(snapshot.summary.secret_count, 2);
    }

    #[test]
    fn map_shelf_response_uses_albums_without_book_info_probe() {
        let snapshot = map_shelf_response(&json!({
            "books": [],
            "albums": [
                {
                    "albumInfo": { "albumId": 42, "name": "听书专辑", "authorName": "作者" },
                    "albumInfoExtra": { "lectureReadUpdateTime": 1700000000 }
                }
            ]
        }));

        let album = snapshot.entries.first().expect("album should map");

        assert_eq!(album.id, "42");
        assert_eq!(album.entry_type, "album");
        assert_eq!(album.title, "听书专辑");
        assert_eq!(album.last_read_at, Some(1_700_000_000));
    }

    #[test]
    fn map_shelf_response_preserves_archive_metadata() {
        let snapshot = map_shelf_response(&json!({
            "books": [
                { "bookId": "b1", "title": "书一" },
                { "bookId": "b2", "title": "书二" }
            ],
            "albums": [{
                "albumInfo": { "albumId": "b3", "name": "听书专辑" }
            }],
            "archive": [
                { "name": "待读书单", "bookIds": ["b1", "b1", "b3", "missing"] },
                { "name": "待读书单", "bookIds": [2, "b2"] }
            ]
        }));

        assert_eq!(snapshot.archives.len(), 2);
        assert_eq!(snapshot.archives[0].id, "archive:0:unnamed");
        assert_eq!(snapshot.archives[0].name, "待读书单");
        assert_eq!(snapshot.archives[0].book_ids, vec!["b1", "b3", "missing"]);
        assert_eq!(snapshot.archives[0].matched_entry_count, 1);
        assert_eq!(snapshot.archives[0].missing_book_count, 2);
        assert_eq!(snapshot.archives[1].id, "archive:1:unnamed");
        assert_eq!(snapshot.archives[1].book_ids, vec!["2", "b2"]);
        assert_eq!(snapshot.archives[1].matched_entry_count, 1);
        assert_eq!(snapshot.archives[1].missing_book_count, 1);
    }
}
