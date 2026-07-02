use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookDetailRecord {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub deep_link: Option<String>,
    pub translator: Option<String>,
    pub cover: Option<String>,
    pub intro: Option<String>,
    pub category: Option<String>,
    pub publisher: Option<String>,
    pub publish_time: Option<String>,
    pub isbn: Option<String>,
    pub word_count: Option<i64>,
    pub rating_percent: Option<i64>,
    pub rating_count: Option<i64>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgressRecord {
    pub book_id: String,
    pub chapter_uid: Option<i64>,
    pub chapter_offset: Option<i64>,
    pub progress_percent: i64,
    pub updated_at: Option<i64>,
    pub record_reading_time_seconds: Option<i64>,
    pub finish_time: Option<i64>,
    pub is_started: bool,
    pub is_finished: bool,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRecord {
    pub book_id: String,
    pub chapter_uid: i64,
    pub chapter_idx: i64,
    pub title: String,
    pub word_count: Option<i64>,
    pub level: i64,
    pub price: Option<i64>,
    pub paid: Option<bool>,
    pub is_mp_chapter: Option<bool>,
    pub raw_json: String,
}

pub fn map_book_detail_response(book_id: &str, value: &Value) -> BookDetailRecord {
    let source = value.get("book").unwrap_or(value);

    BookDetailRecord {
        book_id: string_field(source, "bookId").unwrap_or_else(|| book_id.to_string()),
        title: string_field(source, "title").unwrap_or_else(|| "未命名书籍".to_string()),
        author: string_field(source, "author"),
        deep_link: string_field(source, "deepLink").or_else(|| string_field(value, "deepLink")),
        translator: string_field(source, "translator"),
        cover: string_field(source, "cover"),
        intro: string_field(source, "intro"),
        category: string_field(source, "category"),
        publisher: string_field(source, "publisher"),
        publish_time: string_field(source, "publishTime"),
        isbn: string_field(source, "isbn"),
        word_count: integer_field(source, "wordCount"),
        rating_percent: integer_field(source, "newRating"),
        rating_count: integer_field(source, "newRatingCount"),
        raw_json: value.to_string(),
    }
}

pub fn map_progress_response(book_id: &str, value: &Value) -> ReadingProgressRecord {
    let source = value.get("book").unwrap_or(value);
    let progress_percent = clamp_percent(integer_field(source, "progress").unwrap_or(0));
    let finish_time = integer_field(source, "finishTime");
    let reading_time_seconds = integer_field(source, "readingTime")
        .map(|seconds| seconds.max(0))
        .or_else(|| integer_field(source, "recordReadingTime").map(|seconds| seconds.max(0)));

    ReadingProgressRecord {
        book_id: string_field(source, "bookId").unwrap_or_else(|| book_id.to_string()),
        chapter_uid: integer_field(source, "chapterUid"),
        chapter_offset: integer_field(source, "chapterOffset"),
        progress_percent,
        updated_at: integer_field(source, "updateTime"),
        record_reading_time_seconds: reading_time_seconds,
        finish_time,
        is_started: boolish_field(source, "isStartReading") || progress_percent > 0,
        is_finished: progress_percent == 100 && finish_time.unwrap_or(0) > 0,
        raw_json: value.to_string(),
    }
}

pub fn map_chapters_response(book_id: &str, value: &Value) -> Vec<ChapterRecord> {
    value
        .get("chapters")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|chapter| map_chapter(book_id, chapter))
        .collect()
}

fn map_chapter(book_id: &str, value: &Value) -> Option<ChapterRecord> {
    let chapter_uid = integer_field(value, "chapterUid")?;

    Some(ChapterRecord {
        book_id: book_id.to_string(),
        chapter_uid,
        chapter_idx: integer_field(value, "chapterIdx").unwrap_or(0),
        title: string_field(value, "title").unwrap_or_else(|| "未命名章节".to_string()),
        word_count: integer_field(value, "wordCount"),
        level: integer_field(value, "level").unwrap_or(1),
        price: integer_field(value, "price"),
        paid: value.get("paid").map(boolish_value),
        is_mp_chapter: value.get("isMPChapter").map(boolish_value),
        raw_json: value.to_string(),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|field| match field {
        Value::String(text) if !text.trim().is_empty() => Some(text.to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
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

fn clamp_percent(value: i64) -> i64 {
    value.clamp(0, 100)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{map_book_detail_response, map_chapters_response, map_progress_response};

    #[test]
    fn book_detail_mapper_reads_deep_link_without_fallback() {
        let detail = map_book_detail_response(
            "b1",
            &json!({
                "book": {
                    "bookId": "b1",
                    "title": "书名",
                    "deepLink": "weread://book/info-from-api"
                }
            }),
        );

        assert_eq!(
            detail.deep_link,
            Some("weread://book/info-from-api".to_string())
        );

        let missing = map_book_detail_response("b1", &json!({ "book": { "bookId": "b1" } }));
        assert_eq!(missing.deep_link, None);
    }

    #[test]
    fn progress_one_means_one_percent_not_finished() {
        let progress = map_progress_response(
            "b1",
            &json!({
                "book": {
                    "bookId": "b1",
                    "progress": 1,
                    "isStartReading": 1,
                    "recordReadingTime": 3600
                }
            }),
        );

        assert_eq!(progress.progress_percent, 1);
        assert!(progress.is_started);
        assert!(!progress.is_finished);
    }

    #[test]
    fn progress_prefers_reading_time_for_total_duration() {
        let progress = map_progress_response(
            "b1",
            &json!({
                "book": {
                    "bookId": "b1",
                    "progress": 42,
                    "readingTime": 331205,
                    "recordReadingTime": 0
                }
            }),
        );

        assert_eq!(progress.record_reading_time_seconds, Some(331205));
    }

    #[test]
    fn progress_falls_back_to_record_reading_time_when_reading_time_is_missing() {
        let progress = map_progress_response(
            "b1",
            &json!({
                "book": {
                    "bookId": "b1",
                    "progress": 42,
                    "recordReadingTime": 3600
                }
            }),
        );

        assert_eq!(progress.record_reading_time_seconds, Some(3600));
    }

    #[test]
    fn progress_requires_hundred_and_finish_time_to_be_finished() {
        let unfinished = map_progress_response("b1", &json!({ "book": { "progress": 100 } }));
        let finished = map_progress_response(
            "b1",
            &json!({ "book": { "progress": 100, "finishTime": 1_700_000_000 } }),
        );

        assert!(!unfinished.is_finished);
        assert!(finished.is_finished);
    }

    #[test]
    fn chapters_skip_entries_without_uid() {
        let chapters = map_chapters_response(
            "b1",
            &json!({
                "chapters": [
                    { "chapterUid": 10, "chapterIdx": 1, "title": "第一章", "level": 1, "paid": 1 },
                    { "chapterIdx": 2, "title": "缺少 UID" }
                ]
            }),
        );

        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].chapter_uid, 10);
        assert_eq!(chapters[0].paid, Some(true));
    }
}
