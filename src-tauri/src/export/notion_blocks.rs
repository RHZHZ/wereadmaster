//! 书籍笔记的 Notion 原生块构建器。
//!
//! 按《notion-page-content-template-design》从结构化笔记直接生成块树，
//! 不再经过 Markdown 中间态：划线用 quote、想法用 callout、次要元信息
//! 以同块灰字呈现，划线与想法在章节内按位置混排（原文在前、想法紧随）。

use chrono::{Datelike, Local, Timelike};
use serde_json::{json, Value};

use crate::mappers::notes::{BookNotesRecord, ChapterNoteGroup, HighlightRecord, ThoughtRecord};

/// 章节数达到该值时在摘要后输出目录块。
const TOC_MIN_CHAPTERS: usize = 4;
/// 单条 rich_text 文本的安全长度（Notion 上限 2000 字符）。
const MAX_TEXT_RUN_CHARS: usize = 1_900;
/// 想法关联原文摘句的最大展示长度。
const ABSTRACT_SNIPPET_MAX_CHARS: usize = 30;

/// 从书籍笔记生成 Notion 页面正文块。
/// 输出为扁平块序列（无嵌套 children），可直接按 100 块/批追加。
pub fn build_book_notes_blocks(notes: &BookNotesRecord, exported_at: &str) -> Vec<Value> {
    let mut blocks = Vec::new();
    blocks.push(summary_callout(notes, exported_at));

    if notes.exportable_count == 0 {
        blocks.push(paragraph_block(vec![text_run(
            "当前没有可导出的划线或想法/点评。",
            TextTone::Plain,
        )]));
        blocks.push(notice_quote(&notes.bookmark_content_notice));
        return blocks;
    }

    if notes.chapter_groups.len() >= TOC_MIN_CHAPTERS {
        blocks.push(json!({
            "object": "block",
            "type": "table_of_contents",
            "table_of_contents": {}
        }));
    }

    for group in &notes.chapter_groups {
        push_chapter_blocks(&mut blocks, group);
    }

    blocks.push(divider_block());
    blocks.push(notice_quote(&notes.bookmark_content_notice));
    blocks
}

fn summary_callout(notes: &BookNotesRecord, exported_at: &str) -> Value {
    let mut headline = format!(
        "{} 章 · 划线 {} · 想法 {}",
        notes.chapter_groups.len(),
        notes.highlights.len(),
        notes.thoughts.len()
    );
    if let Some(progress) = notes.book.as_ref().and_then(|book| book.reading_progress) {
        headline.push_str(&format!(" · 进度 {}%", progress.clamp(0, 100)));
    }

    let mut meta_parts = Vec::new();
    if let Some(author) = notes
        .book
        .as_ref()
        .and_then(|book| book.author.as_deref())
        .map(str::trim)
        .filter(|author| !author.is_empty())
    {
        meta_parts.push(format!("作者 {author}"));
    }
    meta_parts.push(format!(
        "基于本地缓存导出于 {}",
        exported_at_label(exported_at)
    ));

    let runs = vec![
        text_run(&headline, TextTone::Plain),
        text_run(&format!("\n{}", meta_parts.join(" · ")), TextTone::Gray),
    ];
    json!({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": runs,
            "icon": { "type": "emoji", "emoji": "🧭" },
            "color": "green_background"
        }
    })
}

fn push_chapter_blocks(blocks: &mut Vec<Value>, group: &ChapterNoteGroup) {
    let title = group.title.trim();
    let title = if title.is_empty() {
        "未命名章节"
    } else {
        title
    };
    blocks.push(heading_2_block(title));

    for entry in ordered_entries(group) {
        match entry {
            NoteEntry::Highlight(highlight) => blocks.push(highlight_quote(highlight)),
            NoteEntry::Thought(thought) => blocks.push(thought_callout(thought)),
        }
    }
}

/// AI 复盘页块构建输入。与 `services::ai` 的结构解耦，便于独立测试。
pub struct BookReviewBlocksInput<'a> {
    pub author: Option<&'a str>,
    pub overview: &'a str,
    pub theme_tags: &'a [String],
    pub key_ideas: &'a [String],
    pub my_focus: &'a [String],
    pub action_items: &'a [String],
    pub reflection_questions: &'a [String],
    pub quotes: Vec<ReviewQuoteBlocksInput<'a>>,
    pub basis_notice: &'a str,
    pub error_message: Option<&'a str>,
    pub generated_at: &'a str,
    pub exported_at: &'a str,
    pub provider_model: Option<&'a str>,
    pub prompt_version: &'a str,
    pub highlight_count: usize,
    pub included_highlight_count: usize,
    pub thought_count: usize,
    pub included_thought_count: usize,
}

pub struct ReviewQuoteBlocksInput<'a> {
    pub quote: &'a str,
    pub reason: &'a str,
    pub chapter: Option<&'a str>,
    pub note_type: &'a str,
}

/// 从 AI 复盘生成 Notion 页面正文块：结论先行的概览 callout、
/// 编号观点、可勾选行动项、折叠复盘问题、带灰字依据的摘录，
/// 元数据不再重复正文输出（数据库属性已承载），空节直接省略。
pub fn build_book_review_blocks(input: &BookReviewBlocksInput<'_>) -> Vec<Value> {
    let mut blocks = Vec::new();

    let mut overview_runs = chunked_text_runs(&normalize_multiline(input.overview));
    if overview_runs.is_empty() {
        overview_runs.push(text_run("这次总结没有生成概览。", TextTone::Plain));
    }
    let mut meta_parts = Vec::new();
    if let Some(author) = input
        .author
        .map(str::trim)
        .filter(|author| !author.is_empty())
    {
        meta_parts.push(format!("作者 {author}"));
    }
    meta_parts.push(format!("生成于 {}", exported_at_label(input.generated_at)));
    if let Some(model) = input
        .provider_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        meta_parts.push(model.to_string());
    }
    overview_runs.push(text_run(
        &format!("\n{}", meta_parts.join(" · ")),
        TextTone::Gray,
    ));
    blocks.push(json!({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": overview_runs,
            "icon": { "type": "emoji", "emoji": "🧠" },
            "color": "blue_background"
        }
    }));

    if !input.theme_tags.is_empty() {
        blocks.push(paragraph_block(vec![text_run(
            &format!("主题标签：{}", input.theme_tags.join(" · ")),
            TextTone::Gray,
        )]));
    }

    push_review_list_section(
        &mut blocks,
        "关键观点",
        input.key_ideas,
        "numbered_list_item",
    );
    push_review_list_section(
        &mut blocks,
        "我的关注点",
        input.my_focus,
        "bulleted_list_item",
    );

    if !input.action_items.is_empty() {
        blocks.push(heading_2_block("行动项"));
        for item in input.action_items {
            blocks.push(json!({
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": chunked_text_runs(&normalize_multiline(item)),
                    "checked": false
                }
            }));
        }
    }

    if !input.reflection_questions.is_empty() {
        blocks.push(heading_2_block("复盘问题"));
        for question in input.reflection_questions {
            blocks.push(json!({
                "object": "block",
                "type": "toggle",
                "toggle": {
                    "rich_text": chunked_text_runs(&normalize_multiline(question)),
                    "children": [paragraph_block(vec![text_run(
                        "在这里写下你的回答。",
                        TextTone::Gray,
                    )])]
                }
            }));
        }
    }

    if !input.quotes.is_empty() {
        blocks.push(heading_2_block("代表性摘录"));
        for quote in &input.quotes {
            let mut quote_runs = chunked_text_runs(&normalize_multiline(quote.quote));
            let mut parts = Vec::new();
            let reason = quote.reason.trim();
            if !reason.is_empty() {
                parts.push(format!("理由 {}", normalize_multiline(reason)));
            }
            if let Some(chapter) = quote
                .chapter
                .map(str::trim)
                .filter(|chapter| !chapter.is_empty())
            {
                parts.push(format!("章节 {chapter}"));
            }
            let note_type = quote.note_type.trim();
            if !note_type.is_empty() {
                parts.push(note_type.to_string());
            }
            if !parts.is_empty() {
                quote_runs.push(text_run(
                    &format!("\n‹{}›", parts.join(" · ")),
                    TextTone::Gray,
                ));
            }
            blocks.push(json!({
                "object": "block",
                "type": "quote",
                "quote": { "rich_text": quote_runs }
            }));
        }
    }

    blocks.push(divider_block());
    blocks.push(notice_quote(input.basis_notice));
    if let Some(error_message) = input
        .error_message
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        blocks.push(notice_quote(error_message));
    }
    blocks.push(paragraph_block(vec![text_run(
        &format!(
            "导出于 {} · Prompt {} · 纳入划线 {}/{} · 纳入想法 {}/{}",
            exported_at_label(input.exported_at),
            input.prompt_version,
            input.included_highlight_count,
            input.highlight_count,
            input.included_thought_count,
            input.thought_count
        ),
        TextTone::Gray,
    )]));
    blocks
}

fn push_review_list_section(blocks: &mut Vec<Value>, title: &str, items: &[String], kind: &str) {
    if items.is_empty() {
        return;
    }
    blocks.push(heading_2_block(title));
    for item in items {
        let runs = chunked_text_runs(&normalize_multiline(item));
        if runs.is_empty() {
            continue;
        }
        blocks.push(json!({
            "object": "block",
            "type": kind,
            kind: { "rich_text": runs }
        }));
    }
}

fn heading_2_block(title: &str) -> Value {
    json!({
        "object": "block",
        "type": "heading_2",
        "heading_2": { "rich_text": vec![text_run(title, TextTone::Plain)] }
    })
}

enum NoteEntry<'a> {
    Highlight(&'a HighlightRecord),
    Thought(&'a ThoughtRecord),
}

/// 章节内按位置混排：range 起点升序；同位置时划线在前、想法紧随；
/// 无 range 的条目保持原顺序排在章节末尾。
fn ordered_entries(group: &ChapterNoteGroup) -> Vec<NoteEntry<'_>> {
    let mut entries = Vec::with_capacity(group.highlights.len() + group.thoughts.len());
    for (index, highlight) in group.highlights.iter().enumerate() {
        entries.push((
            range_sort_key(highlight.range_text.as_deref()),
            index,
            NoteEntry::Highlight(highlight),
        ));
    }
    let thought_offset = group.highlights.len();
    for (index, thought) in group.thoughts.iter().enumerate() {
        entries.push((
            range_sort_key(thought.range_text.as_deref()),
            thought_offset + index,
            NoteEntry::Thought(thought),
        ));
    }
    entries.sort_by_key(|(key, order, _)| (*key, *order));
    entries.into_iter().map(|(_, _, entry)| entry).collect()
}

/// 取 range 文本中的第一个数字作为章节内排序键；无数字返回 u64::MAX。
fn range_sort_key(range: Option<&str>) -> u64 {
    let Some(range) = range else {
        return u64::MAX;
    };
    let digits = range
        .chars()
        .skip_while(|character| !character.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .take(12)
        .collect::<String>();
    digits.parse::<u64>().unwrap_or(u64::MAX)
}

fn highlight_quote(highlight: &HighlightRecord) -> Value {
    let mut runs = chunked_text_runs(&normalize_multiline(&highlight.mark_text));
    if let Some(meta) = highlight_meta_label(highlight) {
        runs.push(text_run(&format!("\n{meta}"), TextTone::Gray));
    }
    json!({
        "object": "block",
        "type": "quote",
        "quote": { "rich_text": runs }
    })
}

fn highlight_meta_label(highlight: &HighlightRecord) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(range) = highlight
        .range_text
        .as_deref()
        .map(str::trim)
        .filter(|range| !range.is_empty())
    {
        parts.push(format!("位置 {range}"));
    }
    if let Some(create_time) = highlight.create_time {
        parts.push(unix_seconds_minute_label(create_time));
    }
    (!parts.is_empty()).then(|| format!("‹{}›", parts.join(" · ")))
}

fn thought_callout(thought: &ThoughtRecord) -> Value {
    let mut runs = chunked_text_runs(&normalize_multiline(&thought.content));
    if let Some(meta) = thought_meta_label(thought) {
        runs.push(text_run(&format!("\n{meta}"), TextTone::Gray));
    }
    let emoji = if thought.is_finish == Some(true) {
        "🏁"
    } else {
        "💭"
    };
    json!({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": runs,
            "icon": { "type": "emoji", "emoji": emoji },
            "color": "gray_background"
        }
    })
}

fn thought_meta_label(thought: &ThoughtRecord) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(abstract_text) = thought
        .abstract_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!(
            "关联原文「{}」",
            snippet(
                &normalize_multiline(abstract_text),
                ABSTRACT_SNIPPET_MAX_CHARS
            )
        ));
    }
    if let Some(star) = thought.star {
        parts.push(format!("评分 {star}"));
    }
    if let Some(create_time) = thought.create_time {
        parts.push(unix_seconds_minute_label(create_time));
    }
    if thought.is_finish == Some(true) {
        parts.push("读完点评".to_string());
    }
    (!parts.is_empty()).then(|| format!("‹{}›", parts.join(" · ")))
}

fn notice_quote(notice: &str) -> Value {
    let notice = notice.trim();
    let notice = if notice.is_empty() {
        "本页由 wxreadmaster 基于本地缓存导出。"
    } else {
        notice
    };
    json!({
        "object": "block",
        "type": "quote",
        "quote": { "rich_text": vec![text_run(notice, TextTone::Gray)] }
    })
}

fn paragraph_block(runs: Vec<Value>) -> Value {
    json!({
        "object": "block",
        "type": "paragraph",
        "paragraph": { "rich_text": runs }
    })
}

fn divider_block() -> Value {
    json!({
        "object": "block",
        "type": "divider",
        "divider": {}
    })
}

enum TextTone {
    Plain,
    Gray,
}

fn text_run(content: &str, tone: TextTone) -> Value {
    match tone {
        TextTone::Plain => json!({ "type": "text", "text": { "content": content } }),
        TextTone::Gray => json!({
            "type": "text",
            "text": { "content": content },
            "annotations": { "color": "gray" }
        }),
    }
}

/// 将长文本按 Notion 单条 rich_text 上限切分为多个纯文本片段。
fn chunked_text_runs(content: &str) -> Vec<Value> {
    if content.is_empty() {
        return Vec::new();
    }
    content
        .chars()
        .collect::<Vec<_>>()
        .chunks(MAX_TEXT_RUN_CHARS)
        .map(|chunk| text_run(&chunk.iter().collect::<String>(), TextTone::Plain))
        .collect()
}

fn normalize_multiline(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn snippet(value: &str, max_chars: usize) -> String {
    let flattened = value.replace('\n', " ");
    let mut characters = flattened.chars();
    let head = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn exported_at_label(exported_at: &str) -> String {
    exported_at
        .trim()
        .parse::<i64>()
        .ok()
        .map(unix_seconds_minute_label)
        .unwrap_or_else(|| exported_at.trim().to_string())
}

fn unix_seconds_minute_label(timestamp: i64) -> String {
    let Some(datetime) = chrono::DateTime::from_timestamp(timestamp, 0) else {
        return timestamp.to_string();
    };
    let local = datetime.with_timezone(&Local);
    format!(
        "{}-{:02}-{:02} {:02}:{:02}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute()
    )
}

#[cfg(test)]
mod tests {
    use crate::mappers::notes::{
        BookNotesRecord, ChapterNoteGroup, HighlightRecord, NotebookBookRecord, ThoughtRecord,
    };

    use super::{
        build_book_notes_blocks, build_book_review_blocks, range_sort_key, snippet,
        BookReviewBlocksInput, ReviewQuoteBlocksInput,
    };

    fn highlight(text: &str, range: Option<&str>) -> HighlightRecord {
        HighlightRecord {
            bookmark_id: "bm-1".to_string(),
            book_id: "book-1".to_string(),
            chapter_uid: Some(1),
            chapter_title: Some("第一章".to_string()),
            mark_text: text.to_string(),
            create_time: Some(1_753_000_000),
            range_text: range.map(str::to_string),
            deep_link: None,
            raw_json: String::new(),
        }
    }

    fn thought(text: &str, range: Option<&str>, is_finish: bool) -> ThoughtRecord {
        ThoughtRecord {
            review_id: "rv-1".to_string(),
            book_id: "book-1".to_string(),
            content: text.to_string(),
            abstract_text: Some("被评注的原文片段".to_string()),
            create_time: Some(1_753_000_100),
            star: None,
            chapter_name: Some("第一章".to_string()),
            chapter_uid: Some(1),
            range_text: range.map(str::to_string),
            deep_link: None,
            is_finish: Some(is_finish),
            raw_json: String::new(),
        }
    }

    fn notes(groups: Vec<ChapterNoteGroup>, exportable_count: usize) -> BookNotesRecord {
        let highlights = groups
            .iter()
            .flat_map(|group| group.highlights.clone())
            .collect::<Vec<_>>();
        let thoughts = groups
            .iter()
            .flat_map(|group| group.thoughts.clone())
            .collect::<Vec<_>>();
        BookNotesRecord {
            book_id: "book-1".to_string(),
            book: Some(NotebookBookRecord {
                book_id: "book-1".to_string(),
                title: "测试书籍".to_string(),
                author: Some("作者甲".to_string()),
                cover: None,
                review_count: 0,
                note_count: 0,
                bookmark_count: 0,
                total_note_count: 0,
                reading_progress: Some(72),
                marked_status: None,
                sort: None,
                raw_json: String::new(),
            }),
            highlights,
            thoughts,
            chapters: Vec::new(),
            chapter_groups: groups,
            bookmark_count: 2,
            exportable_count,
            bookmark_content_notice: "书签仅计数，正文未包含。".to_string(),
        }
    }

    #[test]
    fn summary_toc_and_notice_frame_the_page() {
        let groups = (1..=4)
            .map(|index| ChapterNoteGroup {
                chapter_uid: Some(index),
                title: format!("第 {index} 章"),
                highlights: vec![highlight("原文", Some("100-120"))],
                thoughts: Vec::new(),
            })
            .collect::<Vec<_>>();
        let blocks = build_book_notes_blocks(&notes(groups, 4), "1753000000");

        assert_eq!(blocks[0]["type"], "callout");
        let headline = blocks[0]["callout"]["rich_text"][0]["text"]["content"]
            .as_str()
            .expect("headline should be text");
        assert!(headline.contains("4 章"));
        assert!(headline.contains("进度 72%"));
        assert_eq!(
            blocks[0]["callout"]["rich_text"][1]["annotations"]["color"],
            "gray"
        );
        assert_eq!(blocks[1]["type"], "table_of_contents");
        assert_eq!(blocks[blocks.len() - 2]["type"], "divider");
        assert_eq!(blocks[blocks.len() - 1]["type"], "quote");
    }

    #[test]
    fn highlights_and_thoughts_interleave_by_range() {
        let group = ChapterNoteGroup {
            chapter_uid: Some(1),
            title: "第一章".to_string(),
            highlights: vec![
                highlight("后面的划线", Some("200-220")),
                highlight("前面的划线", Some("100-120")),
            ],
            thoughts: vec![thought("中间的想法", Some("150-160"), false)],
        };
        let blocks = build_book_notes_blocks(&notes(vec![group], 3), "1753000000");

        assert_eq!(blocks[1]["type"], "heading_2");
        assert_eq!(blocks[2]["type"], "quote");
        assert_eq!(
            blocks[2]["quote"]["rich_text"][0]["text"]["content"],
            "前面的划线"
        );
        assert_eq!(blocks[3]["type"], "callout");
        assert_eq!(blocks[3]["callout"]["icon"]["emoji"], "💭");
        assert_eq!(blocks[4]["type"], "quote");
        assert_eq!(
            blocks[4]["quote"]["rich_text"][0]["text"]["content"],
            "后面的划线"
        );
    }

    #[test]
    fn meta_lines_are_gray_and_single_block() {
        let group = ChapterNoteGroup {
            chapter_uid: Some(1),
            title: "第一章".to_string(),
            highlights: vec![highlight("原文内容", Some("100-120"))],
            thoughts: vec![thought("读完的总结", None, true)],
        };
        let blocks = build_book_notes_blocks(&notes(vec![group], 2), "1753000000");

        let quote_runs = blocks[2]["quote"]["rich_text"]
            .as_array()
            .expect("quote runs");
        assert_eq!(quote_runs.len(), 2);
        assert_eq!(quote_runs[1]["annotations"]["color"], "gray");
        let quote_meta = quote_runs[1]["text"]["content"]
            .as_str()
            .expect("meta text");
        assert!(quote_meta.contains("位置 100-120"));

        assert_eq!(blocks[3]["callout"]["icon"]["emoji"], "🏁");
        let callout_meta = blocks[3]["callout"]["rich_text"][1]["text"]["content"]
            .as_str()
            .expect("callout meta");
        assert!(callout_meta.contains("关联原文「被评注的原文片段」"));
        assert!(callout_meta.contains("读完点评"));
    }

    #[test]
    fn empty_notes_render_placeholder_and_notice() {
        let blocks = build_book_notes_blocks(&notes(Vec::new(), 0), "1753000000");

        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[1]["type"], "paragraph");
        assert_eq!(blocks[2]["type"], "quote");
    }

    #[test]
    fn review_blocks_lead_with_overview_and_use_actionable_types() {
        let theme_tags = vec!["盗墓".to_string(), "师徒".to_string()];
        let key_ideas = vec!["规矩先于胆量。".to_string()];
        let action_items = vec!["整理师承关系图。".to_string()];
        let questions = vec!["哪条规矩最值得借鉴到工作里？".to_string()];
        let blocks = build_book_review_blocks(&BookReviewBlocksInput {
            author: Some("云峰"),
            overview: "全书围绕北派盗墓的师承与规矩展开。",
            theme_tags: &theme_tags,
            key_ideas: &key_ideas,
            my_focus: &[],
            action_items: &action_items,
            reflection_questions: &questions,
            quotes: vec![ReviewQuoteBlocksInput {
                quote: "灯灭不摸金。",
                reason: "全书规矩体系的核心。",
                chapter: Some("第三章"),
                note_type: "划线",
            }],
            basis_notice: "基于本地笔记生成，不代表整本书全部内容。",
            error_message: None,
            generated_at: "1784437649",
            exported_at: "1785082496",
            provider_model: Some("deepseek-v4-flash"),
            prompt_version: "book-notes-summary-v3",
            highlight_count: 86,
            included_highlight_count: 8,
            thought_count: 14,
            included_thought_count: 4,
        });

        assert_eq!(blocks[0]["type"], "callout");
        assert_eq!(blocks[0]["callout"]["icon"]["emoji"], "🧠");
        assert_eq!(blocks[0]["callout"]["color"], "blue_background");
        let overview_meta = blocks[0]["callout"]["rich_text"][1]["text"]["content"]
            .as_str()
            .expect("overview meta");
        assert!(overview_meta.contains("作者 云峰"));
        assert!(overview_meta.contains("deepseek-v4-flash"));
        assert!(!overview_meta.contains("1784437649"));

        let types = blocks
            .iter()
            .map(|block| block["type"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(types.contains(&"to_do".to_string()));
        assert!(types.contains(&"toggle".to_string()));
        assert!(types.contains(&"quote".to_string()));
        assert!(!types.contains(&"bulleted_list_item".to_string()));

        let to_do = blocks
            .iter()
            .find(|block| block["type"] == "to_do")
            .expect("to_do block");
        assert_eq!(to_do["to_do"]["checked"], false);

        let toggle = blocks
            .iter()
            .find(|block| block["type"] == "toggle")
            .expect("toggle block");
        assert_eq!(
            toggle["toggle"]["children"][0]["paragraph"]["rich_text"][0]["annotations"]["color"],
            "gray"
        );

        let quote = blocks
            .iter()
            .find(|block| {
                block["type"] == "quote"
                    && block["quote"]["rich_text"]
                        .as_array()
                        .is_some_and(|runs| runs.len() > 1)
            })
            .expect("representative quote");
        let quote_meta = quote["quote"]["rich_text"][1]["text"]["content"]
            .as_str()
            .expect("quote meta");
        assert!(quote_meta.contains("理由"));
        assert!(quote_meta.contains("章节 第三章"));

        let source_line = blocks[blocks.len() - 1]["paragraph"]["rich_text"][0]["text"]["content"]
            .as_str()
            .expect("source line");
        assert!(source_line.contains("纳入划线 8/86"));
        assert!(source_line.contains("Prompt book-notes-summary-v3"));
    }

    #[test]
    fn review_blocks_skip_empty_sections() {
        let blocks = build_book_review_blocks(&BookReviewBlocksInput {
            author: None,
            overview: "只有概览。",
            theme_tags: &[],
            key_ideas: &[],
            my_focus: &[],
            action_items: &[],
            reflection_questions: &[],
            quotes: Vec::new(),
            basis_notice: "基于本地笔记生成。",
            error_message: None,
            generated_at: "1784437649",
            exported_at: "1785082496",
            provider_model: None,
            prompt_version: "book-notes-summary-v3",
            highlight_count: 0,
            included_highlight_count: 0,
            thought_count: 0,
            included_thought_count: 0,
        });

        assert!(blocks
            .iter()
            .all(|block| block["type"] != "heading_2" && block["type"] != "to_do"));
        assert_eq!(blocks[0]["type"], "callout");
        assert_eq!(blocks[1]["type"], "divider");
    }

    #[test]
    fn range_keys_and_snippets_are_stable() {
        assert_eq!(range_sort_key(Some("210-260")), 210);
        assert_eq!(range_sort_key(Some("位置 33,40")), 33);
        assert_eq!(range_sort_key(Some("无数字")), u64::MAX);
        assert_eq!(range_sort_key(None), u64::MAX);
        assert_eq!(snippet("短句", 30), "短句");
        assert_eq!(
            snippet(&"长".repeat(40), 30),
            format!("{}…", "长".repeat(30))
        );
    }
}
