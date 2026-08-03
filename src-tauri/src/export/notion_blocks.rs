//! 阅读成果的 Notion 原生块构建器。
//!
//! 按《notion-page-content-template-design》从结构化数据直接生成块树，
//! 不再经过 Markdown 中间态：原文用 quote、自我文本用 callout、次要元信息
//! 以同块灰字呈现；行动项用可勾选的 to_do，复盘问题用折叠块，空节省略，
//! 元数据不重复正文输出（数据库属性已承载）。

use chrono::{Datelike, Local, Timelike};
use serde_json::{json, Value};

use crate::mappers::notes::{BookNotesRecord, ChapterNoteGroup, HighlightRecord, ThoughtRecord};
use crate::services::ai::{
    AiFeedbackExportRecord, BookDecisionResponse, ReadingPersona, ReadingRouteResponse,
    ReadingStatsAiReview, ReadingStatsAiReviewResponse,
};

use super::markdown::{format_duration, reading_review_anchor_label, reading_review_period_label};

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
    pub action_feedback: Option<&'a std::collections::HashMap<String, AiFeedbackExportRecord>>,
    pub reflection_questions: &'a [String],
    pub reflection_feedback: Option<&'a std::collections::HashMap<String, AiFeedbackExportRecord>>,
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
        for (index, item) in input.action_items.iter().enumerate() {
            let feedback = input
                .action_feedback
                .and_then(|feedback| feedback.get(&review_feedback_item_id(item, index)));
            let mut runs = chunked_text_runs(&normalize_multiline(item));
            append_review_feedback_runs(&mut runs, feedback, action_feedback_status_label);
            blocks.push(json!({
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": runs,
                    "checked": feedback.is_some_and(|record| record.status == "completed")
                }
            }));
        }
    }

    if !input.reflection_questions.is_empty() {
        blocks.push(heading_2_block("复盘问题"));
        for (index, question) in input.reflection_questions.iter().enumerate() {
            let feedback = input
                .reflection_feedback
                .and_then(|feedback| feedback.get(&review_feedback_item_id(question, index)));
            let answer = feedback
                .and_then(|record| record.note.as_deref())
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(normalize_multiline)
                .unwrap_or_else(|| "在这里写下你的回答。".to_string());
            let mut children = vec![paragraph_block(vec![text_run(
                &answer,
                if feedback.is_some() {
                    TextTone::Plain
                } else {
                    TextTone::Gray
                },
            )])];
            if let Some(record) = feedback {
                children.push(paragraph_block(vec![text_run(
                    &format!(
                        "状态：{} · 更新于 {}",
                        reflection_feedback_status_label(&record.status),
                        exported_at_label(&record.updated_at)
                    ),
                    TextTone::Gray,
                )]));
            }
            blocks.push(json!({
                "object": "block",
                "type": "toggle",
                "toggle": {
                    "rich_text": chunked_text_runs(&normalize_multiline(question)),
                    "children": children
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

/// 从阅读统计复盘生成 Notion 页面正文块（黄色系）。
pub fn build_reading_stats_review_blocks(
    response: &ReadingStatsAiReviewResponse,
    persona: Option<&ReadingPersona>,
    exported_at: &str,
) -> Vec<Value> {
    let review = &response.review;
    let mut blocks = Vec::new();

    let mut overview_runs = chunked_text_runs(&normalize_multiline(&review.overview));
    if overview_runs.is_empty() {
        overview_runs.push(text_run("这次复盘没有生成概览。", TextTone::Plain));
    }
    let mut meta_parts = vec![
        reading_review_period_label(&response.mode),
        reading_review_anchor_label(&response.mode, response.base_time),
        format!("生成于 {}", exported_at_label(&review.generated_at)),
    ];
    if let Some(model) = response
        .provider_model
        .as_deref()
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
            "icon": { "type": "emoji", "emoji": "📈" },
            "color": "yellow_background"
        }
    }));

    push_stats_tiles(&mut blocks, review);
    push_review_list_section(
        &mut blocks,
        "节奏洞察",
        &review.rhythm_insights,
        "bulleted_list_item",
    );
    push_review_list_section(
        &mut blocks,
        "偏好洞察",
        &review.preference_insights,
        "bulleted_list_item",
    );
    push_review_list_section(
        &mut blocks,
        "重点内容",
        &review.focus_items,
        "bulleted_list_item",
    );
    push_to_do_section(&mut blocks, "下一步行动", &review.next_actions);
    push_reading_persona_blocks(&mut blocks, persona);

    blocks.push(divider_block());
    blocks.push(notice_quote(&review.basis_notice));
    if let Some(error_message) = response
        .error_message
        .as_deref()
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        blocks.push(notice_quote(error_message));
    }
    blocks.push(paragraph_block(vec![text_run(
        &format!(
            "导出于 {} · Prompt {} · 趋势分桶 {} · 分类偏好 {}",
            exported_at_label(exported_at),
            review.prompt_version,
            review.source_stats.bucket_count,
            review.source_stats.category_count
        ),
        TextTone::Gray,
    )]));
    blocks
}

fn push_stats_tiles(blocks: &mut Vec<Value>, review: &ReadingStatsAiReview) {
    let mut tiles = Vec::new();
    if let Some(read_days) = review.source_stats.read_days.filter(|days| *days > 0) {
        tiles.push(format!("🕘 阅读 {read_days} 天"));
    }
    if let Some(total) = review
        .source_stats
        .total_read_time_seconds
        .filter(|value| *value > 0)
    {
        tiles.push(format!("📚 总时长 {}", format_duration(total)));
    }
    if let Some(average) = review
        .source_stats
        .day_average_read_time_seconds
        .filter(|value| *value > 0)
    {
        tiles.push(format!("✍️ 日均 {}", format_duration(average)));
    }
    if tiles.is_empty() {
        return;
    }
    if tiles.len() == 1 {
        blocks.push(stat_tile_callout(&tiles[0]));
        return;
    }
    let columns = tiles
        .iter()
        .map(|tile| {
            json!({
                "object": "block",
                "type": "column",
                "column": { "children": [stat_tile_callout(tile)] }
            })
        })
        .collect::<Vec<_>>();
    blocks.push(json!({
        "object": "block",
        "type": "column_list",
        "column_list": { "children": columns }
    }));
}

fn stat_tile_callout(text: &str) -> Value {
    json!({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": vec![text_run(text, TextTone::Plain)],
            "icon": { "type": "emoji", "emoji": "📊" },
            "color": "gray_background"
        }
    })
}

fn push_reading_persona_blocks(blocks: &mut Vec<Value>, persona: Option<&ReadingPersona>) {
    let Some(persona) = persona else {
        return;
    };
    if persona.status == "insufficient" {
        return;
    }
    let is_provisional = persona.status == "provisional";
    blocks.push(heading_2_block(if is_provisional {
        "阅读倾向（临时）"
    } else {
        "阅读人格"
    }));

    let mut runs = Vec::new();
    if let Some(display_title) = persona
        .display_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        runs.extend(chunked_text_runs(display_title));
    }
    if let Some(summary) = persona
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let prefix = if runs.is_empty() { "" } else { "\n" };
        runs.push(text_run(
            &format!("{prefix}{}", normalize_multiline(summary)),
            TextTone::Gray,
        ));
    }
    if !runs.is_empty() {
        blocks.push(json!({
            "object": "block",
            "type": "callout",
            "callout": {
                "rich_text": runs,
                "icon": { "type": "emoji", "emoji": "🎭" },
                "color": "gray_background"
            }
        }));
    }

    let dimensions = if is_provisional {
        persona.dimensions.iter().take(2).collect::<Vec<_>>()
    } else {
        persona.dimensions.iter().collect::<Vec<_>>()
    };
    for dimension in dimensions {
        let mut dimension_runs = chunked_text_runs(&normalize_multiline(&dimension.label));
        dimension_runs.push(text_run(
            &format!("\n{}", normalize_multiline(&dimension.basis)),
            TextTone::Gray,
        ));
        blocks.push(json!({
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": { "rich_text": dimension_runs }
        }));
    }

    if let Some(suggestion) = persona
        .suggestion
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        blocks.push(paragraph_block(vec![text_run(
            &format!("温和建议：{}", normalize_multiline(suggestion)),
            TextTone::Gray,
        )]));
    }
}

/// 从阅读路线/指南生成 Notion 页面正文块（橙色系）。
pub fn build_reading_route_blocks(
    response: &ReadingRouteResponse,
    exported_at: &str,
) -> Vec<Value> {
    let route = &response.route;
    let is_cross_book_route = route.source_stats.candidate_count > 0;
    let mut blocks = Vec::new();

    let mut overview_runs = chunked_text_runs(&normalize_multiline(&route.route_overview));
    if overview_runs.is_empty() {
        overview_runs.push(text_run("这次没有生成路线总览。", TextTone::Plain));
    }
    let mut meta_parts = vec![
        if is_cross_book_route {
            "跨书阅读路线".to_string()
        } else {
            "单书阅读指南".to_string()
        },
        format!("生成于 {}", exported_at_label(&route.generated_at)),
    ];
    if let Some(model) = response
        .provider_model
        .as_deref()
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
            "icon": { "type": "emoji", "emoji": "🗺️" },
            "color": "orange_background"
        }
    }));

    if !route.books.is_empty() {
        blocks.push(heading_2_block("推进顺序"));
        for step in &route.books {
            let mut headline = format!("《{}》", step.title.trim());
            if let Some(author) = step
                .author
                .as_deref()
                .map(str::trim)
                .filter(|author| !author.is_empty())
            {
                headline.push_str(&format!(" · {author}"));
            }
            let role = step.role.trim();
            if !role.is_empty() {
                headline.push_str(&format!(" · {role}"));
            }
            let effort = step.estimated_effort.trim();
            if !effort.is_empty() {
                headline.push_str(&format!(" · 预计 {effort}"));
            }
            let mut runs = chunked_text_runs(&headline);
            let mut detail_parts = Vec::new();
            let purpose = normalize_multiline(&step.reading_purpose);
            if !purpose.is_empty() {
                detail_parts.push(purpose);
            }
            if let Some(status) = step
                .local_status
                .as_deref()
                .map(str::trim)
                .filter(|status| !status.is_empty())
            {
                detail_parts.push(format!("本地状态 {status}"));
            }
            if !detail_parts.is_empty() {
                runs.push(text_run(
                    &format!("\n{}", detail_parts.join(" · ")),
                    TextTone::Gray,
                ));
            }
            blocks.push(json!({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": { "rich_text": runs }
            }));
        }
    }

    if is_cross_book_route && !route.dependencies.is_empty() {
        blocks.push(heading_2_block("依赖关系"));
        for dependency in &route.dependencies {
            blocks.push(json!({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": chunked_text_runs(&format!(
                        "{} → {}：{}",
                        dependency.from_book_id.trim(),
                        dependency.to_book_id.trim(),
                        normalize_multiline(&dependency.reason)
                    ))
                }
            }));
        }
    }

    if !route.review_checkpoints.is_empty() {
        blocks.push(heading_2_block("复盘点"));
        for checkpoint in &route.review_checkpoints {
            let mut runs = chunked_text_runs(&format!(
                "{}：{}",
                checkpoint.timing.trim(),
                normalize_multiline(&checkpoint.question)
            ));
            let suggested = normalize_multiline(&checkpoint.suggested_output);
            if !suggested.is_empty() {
                runs.push(text_run(&format!("\n建议输出 {suggested}"), TextTone::Gray));
            }
            blocks.push(json!({
                "object": "block",
                "type": "to_do",
                "to_do": { "rich_text": runs, "checked": false }
            }));
        }
    }

    push_to_do_section(&mut blocks, "下一步行动", &route.next_actions);

    blocks.push(divider_block());
    blocks.push(notice_quote(&route.basis_notice));
    if let Some(error_message) = response
        .error_message
        .as_deref()
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        blocks.push(notice_quote(error_message));
    }
    blocks.push(paragraph_block(vec![text_run(
        &format!(
            "导出于 {} · Prompt {} · 当前书 {} · 候选书 {} · 已生成复盘 {}",
            exported_at_label(exported_at),
            route.prompt_version,
            route.source_stats.current_book_count,
            route.source_stats.candidate_count,
            route.source_stats.summary_count
        ),
        TextTone::Gray,
    )]));
    blocks
}

/// 从选书决策生成 Notion 页面正文块（紫色系）。结论先行：
/// 第一屏就是"选了哪本 + 依据"，论证与暂缓项在后。
pub fn build_book_decision_blocks(
    response: &BookDecisionResponse,
    exported_at: &str,
) -> Vec<Value> {
    let decision = &response.decision;
    let mut blocks = Vec::new();

    let mut overview_runs = chunked_text_runs(&normalize_multiline(&decision.decision_overview));
    if overview_runs.is_empty() {
        overview_runs.push(text_run("这次没有生成推荐结论。", TextTone::Plain));
    }
    let mut meta_parts = vec![format!(
        "生成于 {}",
        exported_at_label(&decision.generated_at)
    )];
    if let Some(model) = response
        .provider_model
        .as_deref()
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
            "icon": { "type": "emoji", "emoji": "🧩" },
            "color": "purple_background"
        }
    }));

    if !decision.top_candidates.is_empty() {
        blocks.push(heading_2_block("推荐顺序"));
        for candidate in &decision.top_candidates {
            let mut headline = format!("{}. 《{}》", candidate.rank.max(1), candidate.title.trim());
            if let Some(author) = candidate
                .author
                .as_deref()
                .map(str::trim)
                .filter(|author| !author.is_empty())
            {
                headline.push_str(&format!(" · {author}"));
            }
            blocks.push(heading_3_block(&headline));

            let mut why_runs = chunked_text_runs(&normalize_multiline(&candidate.why_now));
            let mut tradeoff_parts = Vec::new();
            let tradeoff = normalize_multiline(&candidate.tradeoff);
            if !tradeoff.is_empty() {
                tradeoff_parts.push(format!("取舍 {tradeoff}"));
            }
            let effort = candidate.estimated_effort.trim();
            if !effort.is_empty() {
                tradeoff_parts.push(format!("预计投入 {effort}"));
            }
            if !tradeoff_parts.is_empty() {
                why_runs.push(text_run(
                    &format!("\n{}", tradeoff_parts.join(" · ")),
                    TextTone::Gray,
                ));
            }
            if !why_runs.is_empty() {
                blocks.push(paragraph_block(why_runs));
            }

            let prerequisite = normalize_multiline(&candidate.prerequisite_action);
            if !prerequisite.is_empty() {
                blocks.push(json!({
                    "object": "block",
                    "type": "to_do",
                    "to_do": {
                        "rich_text": chunked_text_runs(&format!("前置动作：{prerequisite}")),
                        "checked": false
                    }
                }));
            }
            let trigger = normalize_multiline(&candidate.review_trigger);
            if !trigger.is_empty() {
                blocks.push(paragraph_block(vec![text_run(
                    &format!("复盘触发：{trigger}"),
                    TextTone::Gray,
                )]));
            }
        }
    }

    if !decision.deferred_candidates.is_empty() {
        let children = decision
            .deferred_candidates
            .iter()
            .map(|candidate| {
                json!({
                    "object": "block",
                    "type": "bulleted_list_item",
                    "bulleted_list_item": {
                        "rich_text": chunked_text_runs(&format!(
                            "《{}》：{}",
                            candidate.title.trim(),
                            normalize_multiline(&candidate.reason)
                        ))
                    }
                })
            })
            .collect::<Vec<_>>();
        blocks.push(json!({
            "object": "block",
            "type": "toggle",
            "toggle": {
                "rich_text": vec![text_run(
                    &format!("暂缓候选（{} 本）", decision.deferred_candidates.len()),
                    TextTone::Plain,
                )],
                "children": children
            }
        }));
    }

    push_to_do_section(&mut blocks, "下一步行动", &decision.next_actions);

    blocks.push(divider_block());
    blocks.push(notice_quote(&decision.basis_notice));
    if let Some(error_message) = response
        .error_message
        .as_deref()
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        blocks.push(notice_quote(error_message));
    }
    blocks.push(paragraph_block(vec![text_run(
        &format!(
            "导出于 {} · Prompt {} · 候选 {} · 参考复盘 {}",
            exported_at_label(exported_at),
            decision.prompt_version,
            decision.source_stats.candidate_count,
            decision.source_stats.summary_count
        ),
        TextTone::Gray,
    )]));
    blocks
}

fn push_to_do_section(blocks: &mut Vec<Value>, title: &str, items: &[String]) {
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
            "type": "to_do",
            "to_do": { "rich_text": runs, "checked": false }
        }));
    }
}

fn heading_3_block(title: &str) -> Value {
    json!({
        "object": "block",
        "type": "heading_3",
        "heading_3": { "rich_text": vec![text_run(title, TextTone::Plain)] }
    })
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

fn append_review_feedback_runs(
    runs: &mut Vec<Value>,
    feedback: Option<&AiFeedbackExportRecord>,
    status_label: fn(&str) -> &'static str,
) {
    let Some(feedback) = feedback else {
        return;
    };
    let mut detail = format!("\n状态：{}", status_label(&feedback.status));
    if let Some(note) = feedback
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
    {
        detail.push_str(&format!(" · {}", normalize_multiline(note)));
    }
    detail.push_str(&format!(
        " · 更新于 {}",
        exported_at_label(&feedback.updated_at)
    ));
    runs.push(text_run(&detail, TextTone::Gray));
}

fn review_feedback_item_id(text: &str, index: usize) -> String {
    format!("{index}:{}", normalize_multiline(text).replace('\n', " "))
}

fn action_feedback_status_label(status: &str) -> &'static str {
    match status {
        "completed" => "已完成",
        "skipped" => "暂不做",
        "notApplicable" => "不适合",
        _ => "待处理",
    }
}

fn reflection_feedback_status_label(status: &str) -> &'static str {
    match status {
        "completed" => "已回答",
        "skipped" => "暂不答",
        "notApplicable" => "不适合",
        _ => "待思考",
    }
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

    use crate::services::ai::{
        AiFeedbackExportRecord, BookAiSummarySource, BookDecision, BookDecisionDeferredCandidate,
        BookDecisionResponse, BookDecisionSourceStats, BookDecisionTopCandidate, ReadingPersona,
        ReadingRoute, ReadingRouteBookStep, ReadingRouteCheckpoint, ReadingRouteResponse,
        ReadingRouteSourceStats, ReadingStatsAiReview, ReadingStatsAiReviewResponse,
        ReadingStatsAiReviewSourceStats,
    };

    use super::{
        build_book_decision_blocks, build_book_notes_blocks, build_book_review_blocks,
        build_reading_route_blocks, build_reading_stats_review_blocks, range_sort_key, snippet,
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
            action_feedback: None,
            reflection_questions: &questions,
            reflection_feedback: None,
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
    fn review_blocks_include_saved_action_and_reflection_feedback() {
        let action_items = vec!["整理师承关系图。".to_string()];
        let questions = vec!["哪条规矩最值得借鉴到工作里？".to_string()];
        let mut action_feedback = std::collections::HashMap::new();
        action_feedback.insert(
            "0:整理师承关系图。".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已经整理到知识库。".to_string()),
                updated_at: "1785082496".to_string(),
            },
        );
        let mut reflection_feedback = std::collections::HashMap::new();
        reflection_feedback.insert(
            "0:哪条规矩最值得借鉴到工作里？".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("先定义边界，再提高执行速度。".to_string()),
                updated_at: "1785082496".to_string(),
            },
        );

        let blocks = build_book_review_blocks(&BookReviewBlocksInput {
            author: Some("云峰"),
            overview: "全书围绕规矩展开。",
            theme_tags: &[],
            key_ideas: &[],
            my_focus: &[],
            action_items: &action_items,
            action_feedback: Some(&action_feedback),
            reflection_questions: &questions,
            reflection_feedback: Some(&reflection_feedback),
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

        let to_do = blocks
            .iter()
            .find(|block| block["type"] == "to_do")
            .expect("to_do block");
        assert_eq!(to_do["to_do"]["checked"], true);
        let action_text = to_do["to_do"]["rich_text"]
            .as_array()
            .expect("action rich text")
            .iter()
            .filter_map(|run| run["text"]["content"].as_str())
            .collect::<String>();
        assert!(action_text.contains("状态：已完成"));
        assert!(action_text.contains("已经整理到知识库"));

        let toggle = blocks
            .iter()
            .find(|block| block["type"] == "toggle")
            .expect("toggle block");
        let answer = toggle["toggle"]["children"][0]["paragraph"]["rich_text"][0]["text"]
            ["content"]
            .as_str()
            .expect("saved reflection answer");
        assert_eq!(answer, "先定义边界，再提高执行速度。");
        let status = toggle["toggle"]["children"][1]["paragraph"]["rich_text"][0]["text"]
            ["content"]
            .as_str()
            .expect("reflection status");
        assert!(status.contains("状态：已回答"));
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
            action_feedback: None,
            reflection_questions: &[],
            reflection_feedback: None,
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
    fn stats_review_blocks_use_tiles_todos_and_persona() {
        let response = ReadingStatsAiReviewResponse {
            mode: "monthly".to_string(),
            base_time: 1_752_940_800,
            prompt_version: "reading-stats-review-v2".to_string(),
            input_hash: "hash".to_string(),
            provider_model: Some("deepseek-v4-flash".to_string()),
            source: BookAiSummarySource::Cache,
            review: ReadingStatsAiReview {
                overview: "本月阅读节奏稳定。".to_string(),
                rhythm_insights: vec!["晚间阅读占比高。".to_string()],
                preference_insights: Vec::new(),
                focus_items: Vec::new(),
                next_actions: vec!["下月安排一次主题精读。".to_string()],
                reading_persona: None,
                source_stats: ReadingStatsAiReviewSourceStats {
                    mode: "monthly".to_string(),
                    base_time: 1_752_940_800,
                    read_days: Some(21),
                    total_read_time_seconds: Some(77_400),
                    day_average_read_time_seconds: Some(3_685),
                    bucket_count: 30,
                    longest_item_count: 5,
                    category_count: 6,
                },
                generated_at: "1784437649".to_string(),
                prompt_version: "reading-stats-review-v2".to_string(),
                response_format: None,
                basis_notice: "基于本地统计缓存生成。".to_string(),
            },
            cached_updated_at: None,
            error_message: None,
        };
        let persona = ReadingPersona {
            status: "provisional".to_string(),
            code: None,
            label: None,
            display_title: Some("夜间深读者".to_string()),
            palette_group: None,
            accent_tone: None,
            basis_notice: "样本仍在积累。".to_string(),
            dimensions: Vec::new(),
            evidence: Vec::new(),
            confidence: None,
            summary: Some("更偏向连续长时段阅读。".to_string()),
            suggestion: None,
        };

        let blocks = build_reading_stats_review_blocks(&response, Some(&persona), "1785082496");

        assert_eq!(blocks[0]["type"], "callout");
        assert_eq!(blocks[0]["callout"]["icon"]["emoji"], "📈");
        assert_eq!(blocks[0]["callout"]["color"], "yellow_background");
        assert_eq!(blocks[1]["type"], "column_list");
        assert_eq!(
            blocks[1]["column_list"]["children"]
                .as_array()
                .expect("columns")
                .len(),
            3
        );
        let types = blocks
            .iter()
            .map(|block| block["type"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(types.contains(&"to_do".to_string()));
        assert!(blocks.iter().any(|block| {
            block["type"] == "heading_2"
                && block["heading_2"]["rich_text"][0]["text"]["content"] == "阅读倾向（临时）"
        }));
    }

    #[test]
    fn route_blocks_order_books_and_checkpoint_todos() {
        let response = ReadingRouteResponse {
            book_id: "book-1".to_string(),
            scope_id: "scope-1".to_string(),
            prompt_version: "reading-route-v2.1".to_string(),
            input_hash: "hash".to_string(),
            provider_model: None,
            source: BookAiSummarySource::Cache,
            route: ReadingRoute {
                route_overview: "先补背景，再进主线。".to_string(),
                books: vec![ReadingRouteBookStep {
                    book_id: "book-1".to_string(),
                    title: "深度工作".to_string(),
                    author: Some("卡尔·纽波特".to_string()),
                    order: 1,
                    role: "主线".to_string(),
                    reading_purpose: "建立专注工作的框架。".to_string(),
                    estimated_effort: "2 周".to_string(),
                    local_status: Some("在读".to_string()),
                    basis: "当前进度 40%。".to_string(),
                }],
                dependencies: Vec::new(),
                review_checkpoints: vec![ReadingRouteCheckpoint {
                    timing: "第 1 周末".to_string(),
                    question: "深度时段是否稳定发生？".to_string(),
                    suggested_output: "一页时间块复盘。".to_string(),
                }],
                next_actions: vec!["明早安排 90 分钟深度时段。".to_string()],
                reading_stage: None,
                source_stats: ReadingRouteSourceStats {
                    current_book_count: 1,
                    candidate_count: 0,
                    summary_count: 1,
                    stats_signal_count: 2,
                    local_status_count: 1,
                },
                generated_at: "1784437649".to_string(),
                prompt_version: "reading-route-v2.1".to_string(),
                response_format: None,
                basis_notice: "基于本地缓存生成。".to_string(),
                feedback_outcome_summary: None,
            },
            cached_updated_at: None,
            error_message: None,
        };

        let blocks = build_reading_route_blocks(&response, "1785082496");

        assert_eq!(blocks[0]["callout"]["icon"]["emoji"], "🗺️");
        assert_eq!(blocks[0]["callout"]["color"], "orange_background");
        let step = blocks
            .iter()
            .find(|block| block["type"] == "numbered_list_item")
            .expect("book step");
        let step_text = step["numbered_list_item"]["rich_text"][0]["text"]["content"]
            .as_str()
            .expect("step text");
        assert!(step_text.contains("《深度工作》"));
        assert!(step_text.contains("预计 2 周"));
        let checkpoint = blocks
            .iter()
            .find(|block| {
                block["type"] == "to_do"
                    && block["to_do"]["rich_text"][0]["text"]["content"]
                        .as_str()
                        .is_some_and(|text| text.contains("第 1 周末"))
            })
            .expect("checkpoint to_do");
        assert!(checkpoint["to_do"]["rich_text"][1]["text"]["content"]
            .as_str()
            .is_some_and(|text| text.contains("建议输出")));
    }

    #[test]
    fn decision_blocks_lead_with_conclusion_and_fold_deferred() {
        let response = BookDecisionResponse {
            scope_id: "scope-1".to_string(),
            prompt_version: "book-decision-v1".to_string(),
            input_hash: "hash".to_string(),
            provider_model: None,
            source: BookAiSummarySource::Cache,
            decision: BookDecision {
                decision_overview: "下一本读《深度工作》。".to_string(),
                top_candidates: vec![BookDecisionTopCandidate {
                    book_id: "book-1".to_string(),
                    title: "深度工作".to_string(),
                    author: Some("卡尔·纽波特".to_string()),
                    rank: 1,
                    why_now: "与当前专注力议题直接相关。".to_string(),
                    tradeoff: "牺牲一次休闲阅读窗口。".to_string(),
                    estimated_effort: "2 周".to_string(),
                    prerequisite_action: "清空周一晚的日程。".to_string(),
                    review_trigger: "读完第三章后。".to_string(),
                    basis: "近期统计显示晚间时段最稳定。".to_string(),
                }],
                deferred_candidates: vec![BookDecisionDeferredCandidate {
                    book_id: "book-2".to_string(),
                    title: "禅与摩托车维修艺术".to_string(),
                    reason: "主题偏散，等专注议题收束后再读。".to_string(),
                }],
                next_actions: vec!["把《深度工作》加入本周计划。".to_string()],
                source_stats: BookDecisionSourceStats {
                    candidate_count: 2,
                    summary_count: 1,
                    stats_signal_count: 2,
                    local_status_count: 2,
                },
                reference_factors: Some(vec!["recent".to_string(), "finished".to_string()]),
                recent_reading_window_days: Some(60),
                generated_at: "1784437649".to_string(),
                prompt_version: "book-decision-v1".to_string(),
                response_format: None,
                basis_notice: "基于本地候选书架生成。".to_string(),
            },
            cached_updated_at: None,
            error_message: None,
        };

        let blocks = build_book_decision_blocks(&response, "1785082496");

        assert_eq!(blocks[0]["callout"]["icon"]["emoji"], "🧩");
        assert_eq!(blocks[0]["callout"]["color"], "purple_background");
        assert!(blocks.iter().any(|block| {
            block["type"] == "heading_3"
                && block["heading_3"]["rich_text"][0]["text"]["content"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("1. 《深度工作》"))
        }));
        assert!(blocks.iter().any(|block| {
            block["type"] == "to_do"
                && block["to_do"]["rich_text"][0]["text"]["content"]
                    .as_str()
                    .is_some_and(|text| text.contains("前置动作"))
        }));
        let toggle = blocks
            .iter()
            .find(|block| block["type"] == "toggle")
            .expect("deferred toggle");
        assert_eq!(
            toggle["toggle"]["children"]
                .as_array()
                .expect("children")
                .len(),
            1
        );
        assert!(toggle["toggle"]["rich_text"][0]["text"]["content"]
            .as_str()
            .is_some_and(|text| text.contains("暂缓候选（1 本）")));
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
