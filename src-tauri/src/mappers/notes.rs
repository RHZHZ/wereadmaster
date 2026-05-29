use std::cmp::Ordering;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookBookRecord {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub review_count: i64,
    pub note_count: i64,
    pub bookmark_count: i64,
    pub total_note_count: i64,
    pub reading_progress: Option<i64>,
    pub marked_status: Option<i64>,
    pub sort: Option<i64>,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookOverviewPage {
    pub books: Vec<NotebookBookRecord>,
    pub total_book_count: i64,
    pub total_note_count: i64,
    pub has_more: bool,
    pub next_last_sort: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteChapterRecord {
    pub book_id: String,
    pub chapter_uid: i64,
    pub chapter_idx: i64,
    pub title: String,
    pub word_count: Option<i64>,
    pub level: i64,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRecord {
    pub bookmark_id: String,
    pub book_id: String,
    pub chapter_uid: Option<i64>,
    pub chapter_title: Option<String>,
    pub mark_text: String,
    pub create_time: Option<i64>,
    #[serde(rename = "range")]
    pub range_text: Option<String>,
    pub deep_link: Option<String>,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThoughtRecord {
    pub review_id: String,
    pub book_id: String,
    pub content: String,
    pub abstract_text: Option<String>,
    pub create_time: Option<i64>,
    pub star: Option<i64>,
    pub chapter_name: Option<String>,
    pub chapter_uid: Option<i64>,
    #[serde(rename = "range")]
    pub range_text: Option<String>,
    pub deep_link: Option<String>,
    pub is_finish: Option<bool>,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkListRecord {
    pub book: Option<NotebookBookRecord>,
    pub chapters: Vec<NoteChapterRecord>,
    pub highlights: Vec<HighlightRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MineReviewsPage {
    pub thoughts: Vec<ThoughtRecord>,
    pub total_count: i64,
    pub has_more: bool,
    pub synckey: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterNoteGroup {
    pub chapter_uid: Option<i64>,
    pub title: String,
    pub highlights: Vec<HighlightRecord>,
    pub thoughts: Vec<ThoughtRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookNotesRecord {
    pub book_id: String,
    pub book: Option<NotebookBookRecord>,
    pub highlights: Vec<HighlightRecord>,
    pub thoughts: Vec<ThoughtRecord>,
    pub chapters: Vec<NoteChapterRecord>,
    pub chapter_groups: Vec<ChapterNoteGroup>,
    pub bookmark_count: i64,
    pub exportable_count: usize,
    pub bookmark_content_notice: String,
}

pub fn map_notebook_overview_page(value: &Value) -> NotebookOverviewPage {
    let books = value
        .get("books")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(map_notebook_book)
        .collect::<Vec<_>>();

    NotebookOverviewPage {
        total_book_count: integer_field(value, "totalBookCount").unwrap_or(books.len() as i64),
        total_note_count: integer_field(value, "totalNoteCount")
            .unwrap_or_else(|| books.iter().map(|book| book.total_note_count).sum()),
        has_more: boolish_field(value, "hasMore"),
        next_last_sort: books.last().and_then(|book| book.sort),
        books,
    }
}

pub fn map_bookmark_list_response(book_id: &str, value: &Value) -> BookmarkListRecord {
    let chapters = value
        .get("chapters")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|chapter| map_note_chapter(book_id, chapter))
        .collect::<Vec<_>>();
    let highlights = value
        .get("updated")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|highlight| map_highlight(book_id, &chapters, highlight))
        .collect::<Vec<_>>();

    BookmarkListRecord {
        book: value
            .get("book")
            .and_then(|book| map_book_info(book_id, book)),
        chapters,
        highlights,
    }
}

pub fn map_mine_reviews_page(book_id: &str, value: &Value) -> MineReviewsPage {
    let thoughts = value
        .get("reviews")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|review| map_thought(book_id, review))
        .collect::<Vec<_>>();

    MineReviewsPage {
        total_count: integer_field(value, "totalCount").unwrap_or(thoughts.len() as i64),
        has_more: boolish_field(value, "hasMore"),
        synckey: integer_field(value, "synckey"),
        thoughts,
    }
}

pub fn build_book_notes_record(
    book_id: &str,
    book: Option<NotebookBookRecord>,
    highlights: Vec<HighlightRecord>,
    thoughts: Vec<ThoughtRecord>,
    chapters: Vec<NoteChapterRecord>,
) -> BookNotesRecord {
    let bookmark_count = book.as_ref().map(|book| book.bookmark_count).unwrap_or(0);
    let exportable_count = highlights.len() + thoughts.len();
    let chapter_groups = group_notes_by_chapter(&chapters, &highlights, &thoughts);

    BookNotesRecord {
        book_id: book_id.to_string(),
        book,
        highlights,
        thoughts,
        chapters,
        chapter_groups,
        bookmark_count,
        exportable_count,
        bookmark_content_notice:
            "当前微信读书接口只提供书签数量，不提供书签内容；导出仅包含划线和想法/点评。"
                .to_string(),
    }
}

pub fn group_notes_by_chapter(
    chapters: &[NoteChapterRecord],
    highlights: &[HighlightRecord],
    thoughts: &[ThoughtRecord],
) -> Vec<ChapterNoteGroup> {
    let mut groups = chapters
        .iter()
        .map(|chapter| ChapterNoteGroup {
            chapter_uid: Some(chapter.chapter_uid),
            title: chapter.title.clone(),
            highlights: Vec::new(),
            thoughts: Vec::new(),
        })
        .collect::<Vec<_>>();

    for highlight in highlights {
        let title = highlight
            .chapter_title
            .clone()
            .unwrap_or_else(|| "未分章节".to_string());
        let index = find_or_create_group(&mut groups, highlight.chapter_uid, &title);
        groups[index].highlights.push(highlight.clone());
    }

    for thought in thoughts {
        let title = thought
            .chapter_name
            .clone()
            .unwrap_or_else(|| "整本书想法/书评".to_string());
        let index = find_or_create_group(&mut groups, thought.chapter_uid, &title);
        groups[index].thoughts.push(thought.clone());
    }

    let mut visible_groups = groups
        .into_iter()
        .filter(|group| !group.highlights.is_empty() || !group.thoughts.is_empty())
        .collect::<Vec<_>>();

    for group in &mut visible_groups {
        group.highlights.sort_by(compare_highlight_position);
        group.thoughts.sort_by(compare_thought_position);
    }

    visible_groups.sort_by(|left, right| compare_chapter_group_order(left, right, chapters));
    visible_groups
}

fn map_notebook_book(value: &Value) -> Option<NotebookBookRecord> {
    let book_id = string_field(value, "bookId").or_else(|| {
        value
            .get("book")
            .and_then(|book| string_field(book, "bookId"))
    })?;
    let book_info = value.get("book").unwrap_or(value);
    let review_count = non_negative_count(value, "reviewCount");
    let note_count = non_negative_count(value, "noteCount");
    let bookmark_count = non_negative_count(value, "bookmarkCount");

    Some(NotebookBookRecord {
        book_id,
        title: string_field(book_info, "title").unwrap_or_else(|| "未命名书籍".to_string()),
        author: string_field(book_info, "author"),
        cover: string_field(book_info, "cover"),
        review_count,
        note_count,
        bookmark_count,
        total_note_count: review_count + note_count + bookmark_count,
        reading_progress: integer_field(value, "readingProgress"),
        marked_status: integer_field(value, "markedStatus"),
        sort: integer_field(value, "sort"),
        raw_json: value.to_string(),
    })
}

fn map_book_info(book_id: &str, value: &Value) -> Option<NotebookBookRecord> {
    let normalized_book_id = string_field(value, "bookId").unwrap_or_else(|| book_id.to_string());

    Some(NotebookBookRecord {
        book_id: normalized_book_id,
        title: string_field(value, "title").unwrap_or_else(|| "未命名书籍".to_string()),
        author: string_field(value, "author"),
        cover: string_field(value, "cover"),
        review_count: 0,
        note_count: 0,
        bookmark_count: 0,
        total_note_count: 0,
        reading_progress: integer_field(value, "readingProgress"),
        marked_status: integer_field(value, "markedStatus"),
        sort: integer_field(value, "sort"),
        raw_json: value.to_string(),
    })
}

fn map_note_chapter(book_id: &str, value: &Value) -> Option<NoteChapterRecord> {
    let chapter_uid = integer_field(value, "chapterUid")?;

    Some(NoteChapterRecord {
        book_id: string_field(value, "bookId").unwrap_or_else(|| book_id.to_string()),
        chapter_uid,
        chapter_idx: integer_field(value, "chapterIdx").unwrap_or(0),
        title: string_field(value, "title").unwrap_or_else(|| "未命名章节".to_string()),
        word_count: integer_field(value, "wordCount"),
        level: integer_field(value, "level").unwrap_or(1),
        raw_json: value.to_string(),
    })
}

fn map_highlight(
    book_id: &str,
    chapters: &[NoteChapterRecord],
    value: &Value,
) -> Option<HighlightRecord> {
    if integer_field(value, "type").is_some_and(|note_type| note_type != 1) {
        return None;
    }

    let bookmark_id = string_field(value, "bookmarkId")?;
    let mark_text = string_field(value, "markText")?;
    let normalized_book_id = string_field(value, "bookId").unwrap_or_else(|| book_id.to_string());
    let chapter_uid = integer_field(value, "chapterUid");
    let chapter_title = chapter_uid.and_then(|uid| {
        chapters
            .iter()
            .find(|chapter| chapter.chapter_uid == uid)
            .map(|chapter| chapter.title.clone())
    });
    let deep_link = chapter_uid
        .map(|uid| format!("weread://reading?bId={normalized_book_id}&chapterUid={uid}"));

    Some(HighlightRecord {
        bookmark_id,
        book_id: normalized_book_id,
        chapter_uid,
        chapter_title,
        mark_text,
        create_time: integer_field(value, "createTime"),
        range_text: string_field(value, "range"),
        deep_link,
        raw_json: value.to_string(),
    })
}

fn map_thought(book_id: &str, value: &Value) -> Option<ThoughtRecord> {
    let first = object_child(value, "review").unwrap_or(value);
    let source = object_child(first, "review").unwrap_or(first);
    let review_id = string_field(source, "reviewId").or_else(|| string_field(value, "reviewId"))?;
    let content =
        string_field(source, "content").or_else(|| string_field(source, "htmlContent"))?;
    let normalized_book_id = string_field(source, "bookId")
        .or_else(|| {
            source
                .get("book")
                .and_then(|book| string_field(book, "bookId"))
        })
        .unwrap_or_else(|| book_id.to_string());
    let chapter_uid = integer_field(source, "chapterUid");
    let deep_link = chapter_uid
        .map(|uid| format!("weread://reading?bId={normalized_book_id}&chapterUid={uid}"));

    Some(ThoughtRecord {
        review_id,
        book_id: normalized_book_id,
        content,
        abstract_text: string_field(source, "abstract"),
        create_time: integer_field(source, "createTime"),
        star: integer_field(source, "star").filter(|star| *star >= 0),
        chapter_name: string_field(source, "chapterName")
            .or_else(|| string_field(source, "chapterTitle")),
        chapter_uid,
        range_text: string_field(source, "range"),
        deep_link,
        is_finish: source.get("isFinish").map(boolish_value),
        raw_json: value.to_string(),
    })
}

fn find_or_create_group(
    groups: &mut Vec<ChapterNoteGroup>,
    chapter_uid: Option<i64>,
    title: &str,
) -> usize {
    if let Some(uid) = chapter_uid {
        if let Some(index) = groups
            .iter()
            .position(|group| group.chapter_uid == Some(uid))
        {
            return index;
        }
    }

    if let Some(index) = groups
        .iter()
        .position(|group| group.title == title && group.chapter_uid.is_none())
    {
        return index;
    }

    groups.push(ChapterNoteGroup {
        chapter_uid,
        title: title.to_string(),
        highlights: Vec::new(),
        thoughts: Vec::new(),
    });

    groups.len() - 1
}

fn compare_chapter_group_order(
    left: &ChapterNoteGroup,
    right: &ChapterNoteGroup,
    chapters: &[NoteChapterRecord],
) -> Ordering {
    chapter_group_sort_key(left, chapters).cmp(&chapter_group_sort_key(right, chapters))
}

fn chapter_group_sort_key<'group>(
    group: &'group ChapterNoteGroup,
    chapters: &[NoteChapterRecord],
) -> (i64, i64, i64, &'group str) {
    if let Some(uid) = group.chapter_uid {
        if let Some((index, chapter)) = chapters
            .iter()
            .enumerate()
            .find(|(_, chapter)| chapter.chapter_uid == uid)
        {
            return (0, chapter.chapter_idx, index as i64, group.title.as_str());
        }

        return (1, uid, 0, group.title.as_str());
    }

    (2, i64::MAX, 0, group.title.as_str())
}

fn compare_highlight_position(left: &HighlightRecord, right: &HighlightRecord) -> Ordering {
    note_sort_key(&left.range_text, left.create_time, &left.bookmark_id).cmp(&note_sort_key(
        &right.range_text,
        right.create_time,
        &right.bookmark_id,
    ))
}

fn compare_thought_position(left: &ThoughtRecord, right: &ThoughtRecord) -> Ordering {
    note_sort_key(&left.range_text, left.create_time, &left.review_id).cmp(&note_sort_key(
        &right.range_text,
        right.create_time,
        &right.review_id,
    ))
}

fn note_sort_key<'id>(
    range_text: &Option<String>,
    create_time: Option<i64>,
    id: &'id str,
) -> (i64, i64, &'id str) {
    (
        range_start(range_text).unwrap_or(i64::MAX),
        create_time.unwrap_or(i64::MAX),
        id,
    )
}

fn range_start(range_text: &Option<String>) -> Option<i64> {
    range_text
        .as_deref()?
        .split(|character: char| !character.is_ascii_digit())
        .find(|part| !part.is_empty())?
        .parse()
        .ok()
}

fn object_child<'value>(value: &'value Value, key: &str) -> Option<&'value Value> {
    value.get(key).filter(|child| child.is_object())
}

fn non_negative_count(value: &Value, key: &str) -> i64 {
    integer_field(value, key).unwrap_or(0).max(0)
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|field| match field {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        group_notes_by_chapter, map_bookmark_list_response, map_mine_reviews_page,
        map_notebook_overview_page, HighlightRecord, NoteChapterRecord, ThoughtRecord,
    };

    #[test]
    fn notebook_total_count_uses_reviews_highlights_and_bookmarks() {
        let page = map_notebook_overview_page(&json!({
            "books": [{
                "bookId": "b1",
                "book": { "title": "书名" },
                "reviewCount": 3,
                "noteCount": 4,
                "bookmarkCount": 2,
                "sort": 100
            }],
            "hasMore": 1
        }));

        assert_eq!(page.books[0].total_note_count, 9);
        assert_eq!(page.next_last_sort, Some(100));
    }

    #[test]
    fn bookmark_list_filters_bookmark_content_and_maps_chapters() {
        let record = map_bookmark_list_response(
            "b1",
            &json!({
                "chapters": [{ "chapterUid": 7, "chapterIdx": 1, "title": "第一章" }],
                "updated": [
                    { "bookmarkId": "h1", "bookId": "b1", "chapterUid": 7, "markText": "划线", "type": 1 },
                    { "bookmarkId": "bookmark", "bookId": "b1", "markText": "书签", "type": 0 }
                ]
            }),
        );

        assert_eq!(record.highlights.len(), 1);
        assert_eq!(
            record.highlights[0].chapter_title,
            Some("第一章".to_string())
        );
    }

    #[test]
    fn mine_reviews_maps_nested_review_content() {
        let page = map_mine_reviews_page(
            "b1",
            &json!({
                "reviews": [{
                    "review": {
                        "reviewId": "r1",
                        "content": "想法",
                        "star": -1,
                        "abstract": "依附原文",
                        "chapterName": "第一章",
                        "chapterUid": 7,
                        "range": "12-34"
                    }
                }],
                "hasMore": 0
            }),
        );

        assert_eq!(page.thoughts.len(), 1);
        assert_eq!(page.thoughts[0].star, None);
        assert_eq!(page.thoughts[0].chapter_name, Some("第一章".to_string()));
        assert_eq!(page.thoughts[0].abstract_text, Some("依附原文".to_string()));
        assert_eq!(page.thoughts[0].chapter_uid, Some(7));
        assert_eq!(page.thoughts[0].range_text, Some("12-34".to_string()));
    }

    #[test]
    fn chapter_groups_follow_chapter_order_and_note_position() {
        let chapters = vec![
            chapter(550, 3, "后记"),
            chapter(424, 1, "第一章"),
            chapter(548, 2, "第二章"),
        ];
        let highlights = vec![
            highlight("h550-late", Some(550), "后记", Some("900-920"), Some(1)),
            highlight("h424", Some(424), "第一章", Some("30-40"), Some(2)),
            highlight("h550-early", Some(550), "后记", Some("100-120"), Some(3)),
        ];
        let thoughts = vec![thought("t548", Some(548), "第二章", Some("50-60"), Some(4))];

        let groups = group_notes_by_chapter(&chapters, &highlights, &thoughts);

        assert_eq!(
            groups
                .iter()
                .map(|group| group.chapter_uid)
                .collect::<Vec<_>>(),
            vec![Some(424), Some(548), Some(550)]
        );
        assert_eq!(
            groups[2]
                .highlights
                .iter()
                .map(|highlight| highlight.bookmark_id.as_str())
                .collect::<Vec<_>>(),
            vec!["h550-early", "h550-late"]
        );
    }

    #[test]
    fn chapter_groups_fall_back_to_chapter_uid_when_chapter_catalog_is_missing() {
        let highlights = vec![
            highlight("h550", Some(550), "后记", Some("900-920"), Some(1)),
            highlight("h424", Some(424), "第一章", Some("30-40"), Some(2)),
        ];

        let groups = group_notes_by_chapter(&[], &highlights, &[]);

        assert_eq!(
            groups
                .iter()
                .map(|group| group.chapter_uid)
                .collect::<Vec<_>>(),
            vec![Some(424), Some(550)]
        );
    }

    fn chapter(chapter_uid: i64, chapter_idx: i64, title: &str) -> NoteChapterRecord {
        NoteChapterRecord {
            book_id: "b1".to_string(),
            chapter_uid,
            chapter_idx,
            title: title.to_string(),
            word_count: None,
            level: 1,
            raw_json: "{}".to_string(),
        }
    }

    fn highlight(
        bookmark_id: &str,
        chapter_uid: Option<i64>,
        chapter_title: &str,
        range_text: Option<&str>,
        create_time: Option<i64>,
    ) -> HighlightRecord {
        HighlightRecord {
            bookmark_id: bookmark_id.to_string(),
            book_id: "b1".to_string(),
            chapter_uid,
            chapter_title: Some(chapter_title.to_string()),
            mark_text: "划线".to_string(),
            create_time,
            range_text: range_text.map(str::to_string),
            deep_link: None,
            raw_json: "{}".to_string(),
        }
    }

    fn thought(
        review_id: &str,
        chapter_uid: Option<i64>,
        chapter_name: &str,
        range_text: Option<&str>,
        create_time: Option<i64>,
    ) -> ThoughtRecord {
        ThoughtRecord {
            review_id: review_id.to_string(),
            book_id: "b1".to_string(),
            content: "想法".to_string(),
            abstract_text: None,
            create_time,
            star: None,
            chapter_name: Some(chapter_name.to_string()),
            chapter_uid,
            range_text: range_text.map(str::to_string),
            deep_link: None,
            is_finish: None,
            raw_json: "{}".to_string(),
        }
    }
}
