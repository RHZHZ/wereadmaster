use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatsRecord {
    pub mode: String,
    pub base_time: i64,
    pub read_days: Option<i64>,
    pub total_read_time_seconds: Option<i64>,
    pub day_average_read_time_seconds: Option<i64>,
    pub compare: Option<f64>,
    pub buckets: Vec<ReadingTimeBucketRecord>,
    pub longest_items: Vec<ReadingRankItemRecord>,
    pub categories: Vec<ReadingCategoryRecord>,
    #[serde(rename = "raw")]
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeBucketRecord {
    pub start_time: i64,
    pub read_time_seconds: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingRankItemRecord {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    #[serde(rename = "type")]
    pub item_type: String,
    pub read_time_seconds: i64,
    pub record_reading_time_seconds: Option<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingCategoryRecord {
    pub category_id: Option<String>,
    pub title: String,
    pub parent_category_id: Option<String>,
    pub parent_title: Option<String>,
    pub value: Option<f64>,
    pub reading_time_seconds: Option<i64>,
    pub reading_count: Option<i64>,
    pub category_type: Option<i64>,
}

pub fn map_reading_stats_response(
    mode: &str,
    value: &Value,
    fallback_base_time: Option<i64>,
) -> ReadingStatsRecord {
    ReadingStatsRecord {
        mode: mode.to_string(),
        base_time: integer_field(value, "baseTime").unwrap_or_else(|| {
            if mode == "overall" {
                0
            } else {
                fallback_base_time.unwrap_or(0)
            }
        }),
        read_days: non_negative_integer_field(value, "readDays"),
        total_read_time_seconds: non_negative_integer_field(value, "totalReadTime"),
        day_average_read_time_seconds: non_negative_integer_field(value, "dayAverageReadTime"),
        compare: float_field(value, "compare"),
        buckets: map_time_buckets(value.get("readTimes")),
        longest_items: map_rank_items(value.get("readLongest")),
        categories: map_categories(value.get("preferCategory")),
        raw: value.clone(),
    }
}

pub fn empty_reading_stats(mode: &str, base_time: i64) -> ReadingStatsRecord {
    ReadingStatsRecord {
        mode: mode.to_string(),
        base_time: if mode == "overall" { 0 } else { base_time },
        read_days: None,
        total_read_time_seconds: None,
        day_average_read_time_seconds: None,
        compare: None,
        buckets: Vec::new(),
        longest_items: Vec::new(),
        categories: Vec::new(),
        raw: Value::Null,
    }
}

fn map_time_buckets(value: Option<&Value>) -> Vec<ReadingTimeBucketRecord> {
    let Some(Value::Object(buckets)) = value else {
        return Vec::new();
    };

    let mut records = buckets
        .iter()
        .filter_map(|(key, value)| {
            Some(ReadingTimeBucketRecord {
                start_time: key.parse::<i64>().ok()?,
                read_time_seconds: integer_value(value)?.max(0),
            })
        })
        .collect::<Vec<_>>();
    records.sort_by_key(|bucket| bucket.start_time);

    records
}

fn map_rank_items(value: Option<&Value>) -> Vec<ReadingRankItemRecord> {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(map_rank_item)
        .collect()
}

fn map_rank_item(value: &Value) -> Option<ReadingRankItemRecord> {
    let album = value.get("albumInfo").filter(|source| source.is_object());
    let book = value.get("book").filter(|source| source.is_object());
    let source = album.or(book).unwrap_or(value);
    let item_type = if album.is_some() { "album" } else { "book" };
    let title = first_string_field(source, &["title", "name", "albumName", "bookName"])
        .or_else(|| first_string_field(value, &["title", "name", "albumName", "bookName"]))
        .unwrap_or_else(|| fallback_rank_title(item_type).to_string());
    let id = if item_type == "album" {
        first_string_field(source, &["albumId", "id", "bookId"])
            .or_else(|| first_string_field(value, &["albumId", "id", "bookId"]))
    } else {
        first_string_field(source, &["bookId", "id"])
            .or_else(|| first_string_field(value, &["bookId", "id"]))
    }
    .unwrap_or_else(|| title.clone());

    Some(ReadingRankItemRecord {
        id,
        title,
        author: first_string_field(source, &["author", "authorName"])
            .or_else(|| first_string_field(value, &["author", "authorName"])),
        cover: first_string_field(source, &["cover", "coverUrl"])
            .or_else(|| first_string_field(value, &["cover", "coverUrl"])),
        item_type: item_type.to_string(),
        read_time_seconds: non_negative_integer_field(value, "readTime").unwrap_or(0),
        record_reading_time_seconds: non_negative_integer_field(value, "recordReadingTime"),
        tags: string_array_field(value, "tags"),
    })
}

fn fallback_rank_title(item_type: &str) -> &'static str {
    if item_type == "album" {
        return "有声内容";
    }

    "未命名书籍"
}

fn map_categories(value: Option<&Value>) -> Vec<ReadingCategoryRecord> {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(map_category)
        .collect()
}

fn map_category(value: &Value) -> Option<ReadingCategoryRecord> {
    let title = string_field(value, "categoryTitle")
        .or_else(|| string_field(value, "title"))
        .or_else(|| string_field(value, "name"))?;

    Some(ReadingCategoryRecord {
        category_id: string_field(value, "categoryId"),
        title,
        parent_category_id: string_field(value, "parentCategoryId"),
        parent_title: string_field(value, "parentCategoryTitle"),
        value: float_field(value, "val"),
        reading_time_seconds: non_negative_integer_field(value, "readingTime"),
        reading_count: non_negative_integer_field(value, "readingCount"),
        category_type: integer_field(value, "categoryType"),
    })
}

fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(string_value)
        .collect()
}

fn first_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_field(value, key))
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(string_value)
}

fn string_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn non_negative_integer_field(value: &Value, key: &str) -> Option<i64> {
    integer_field(value, key).map(|number| number.max(0))
}

fn integer_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(integer_value)
}

fn integer_value(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.parse::<i64>().ok(),
        _ => None,
    }
}

fn float_field(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|field| match field {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{empty_reading_stats, map_reading_stats_response};

    #[test]
    fn stats_mapper_keeps_total_read_time_as_authoritative_seconds() {
        let stats = map_reading_stats_response(
            "monthly",
            &json!({
                "baseTime": 1704067200,
                "totalReadTime": 120,
                "readTimes": {
                    "1704067200": 999,
                    "1704153600": 1
                },
                "dayAverageReadTime": 30,
                "readDays": 2
            }),
            None,
        );

        assert_eq!(stats.total_read_time_seconds, Some(120));
        assert_eq!(stats.day_average_read_time_seconds, Some(30));
        assert_eq!(stats.read_days, Some(2));
        assert_eq!(stats.buckets.len(), 2);
        assert_eq!(stats.buckets[0].read_time_seconds, 999);
    }

    #[test]
    fn stats_mapper_normalizes_rank_items_and_categories() {
        let stats = map_reading_stats_response(
            "weekly",
            &json!({
                "readLongest": [{
                    "book": { "bookId": "b1", "title": "书名", "author": "作者", "cover": "cover" },
                    "readTime": 600,
                    "recordReadingTime": 30,
                    "tags": ["笔记最多"]
                }, {
                    "albumInfo": { "albumId": "a1", "name": "有声书", "authorName": "主播" },
                    "readTime": 900
                }],
                "preferCategory": [{
                    "categoryId": 1,
                    "categoryTitle": "文学",
                    "parentCategoryTitle": "出版",
                    "val": 0.8,
                    "readingTime": 3600,
                    "readingCount": 3,
                    "categoryType": 0
                }]
            }),
            None,
        );

        assert_eq!(stats.longest_items.len(), 2);
        assert_eq!(stats.longest_items[0].item_type, "book");
        assert_eq!(stats.longest_items[0].read_time_seconds, 600);
        assert_eq!(stats.longest_items[0].record_reading_time_seconds, Some(30));
        assert_eq!(stats.longest_items[1].item_type, "album");
        assert_eq!(stats.categories[0].category_id, Some("1".to_string()));
        assert_eq!(stats.categories[0].reading_time_seconds, Some(3600));
    }

    #[test]
    fn stats_mapper_uses_outer_album_title_when_album_info_has_only_identity() {
        let stats = map_reading_stats_response(
            "monthly",
            &json!({
                "readLongest": [{
                    "albumInfo": { "albumId": "a1" },
                    "albumName": "中国通史",
                    "readTime": 6120
                }]
            }),
            None,
        );

        assert_eq!(stats.longest_items.len(), 1);
        assert_eq!(stats.longest_items[0].item_type, "album");
        assert_eq!(stats.longest_items[0].title, "中国通史");
    }

    #[test]
    fn stats_mapper_labels_empty_album_rank_item_as_audio_content() {
        let stats = map_reading_stats_response(
            "monthly",
            &json!({
                "readLongest": [{
                    "albumInfo": {},
                    "readTime": 6135,
                    "tags": ["单日阅读最久"]
                }]
            }),
            None,
        );

        assert_eq!(stats.longest_items.len(), 1);
        assert_eq!(stats.longest_items[0].item_type, "album");
        assert_eq!(stats.longest_items[0].title, "有声内容");
    }

    #[test]
    fn empty_overall_stats_forces_base_time_zero() {
        let stats = empty_reading_stats("overall", 123);

        assert_eq!(stats.base_time, 0);
        assert!(stats.buckets.is_empty());
    }
}
