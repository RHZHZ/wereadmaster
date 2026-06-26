use std::fmt::Write;

use chrono::{Datelike, Local, Timelike};

use crate::{
    mappers::notes::{BookNotesRecord, ChapterNoteGroup, HighlightRecord, ThoughtRecord},
    services::ai::{
        AiFeedbackExportRecord, AiResponseFormatKind, AiReviewFeedbackExport,
        BookAiSummaryResponse, BookDecision, BookDecisionResponse, ReadingPersona, ReadingRoute,
        ReadingRouteBookStep, ReadingRouteCheckpoint, ReadingRouteResponse,
        ReadingStatsAiReviewResponse,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BookAiSummaryMarkdownOptions {
    pub include_action_feedback: bool,
    pub include_reflection_feedback: bool,
    pub include_representative_quotes: bool,
}

impl Default for BookAiSummaryMarkdownOptions {
    fn default() -> Self {
        Self {
            include_action_feedback: true,
            include_reflection_feedback: true,
            include_representative_quotes: true,
        }
    }
}

pub fn serialize_book_notes_markdown(notes: &BookNotesRecord, exported_at: &str) -> String {
    let title = notes
        .book
        .as_ref()
        .map(|book| book.title.as_str())
        .unwrap_or(notes.book_id.as_str());
    let author = notes
        .book
        .as_ref()
        .and_then(|book| book.author.as_deref())
        .unwrap_or("未知作者");
    let cover = notes.book.as_ref().and_then(|book| book.cover.as_deref());
    let reading_progress = notes
        .book
        .as_ref()
        .and_then(|book| book.reading_progress)
        .map(format_reading_progress);
    let exported_at_label = unix_seconds_string_label(exported_at);

    let mut markdown = String::new();
    write_book_notes_front_matter(
        &mut markdown,
        notes,
        title,
        author,
        cover,
        reading_progress.as_deref(),
        &exported_at_label,
    );
    let _ = writeln!(markdown, "# {}", heading_text(title));
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 元数据");
    let _ = writeln!(markdown);
    if let Some(cover) = cover {
        let _ = writeln!(markdown, "![封面]({})", cover);
        let _ = writeln!(markdown);
    }
    let _ = writeln!(markdown, "- 书籍 ID：{}", inline_text(&notes.book_id));
    let _ = writeln!(markdown, "- 作者：{}", inline_text(author));
    if let Some(progress) = reading_progress.as_deref() {
        let _ = writeln!(markdown, "- 阅读进度：{progress}");
    }
    let _ = writeln!(markdown, "- 导出时间：{exported_at_label}");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "## 统计");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 划线：{} 条", notes.highlights.len());
    let _ = writeln!(markdown, "- 想法/点评：{} 条", notes.thoughts.len());
    let _ = writeln!(
        markdown,
        "- 书签：{} 条（只统计数量，当前接口不提供书签内容）",
        notes.bookmark_count
    );
    let _ = writeln!(markdown, "- 可导出内容：{} 条", notes.exportable_count);
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "> {}", notes.bookmark_content_notice);
    let _ = writeln!(markdown);

    if notes.exportable_count == 0 {
        let _ = writeln!(markdown, "当前没有可导出的划线或想法/点评。");
        return markdown;
    }

    for group in &notes.chapter_groups {
        write_group(&mut markdown, group);
    }

    markdown
}

pub fn serialize_book_ai_summary_markdown(
    book_id: &str,
    title: &str,
    author: Option<&str>,
    response: &BookAiSummaryResponse,
    exported_at: &str,
    review_feedback: Option<&AiReviewFeedbackExport>,
) -> String {
    serialize_book_ai_summary_markdown_with_options(
        book_id,
        title,
        author,
        response,
        exported_at,
        review_feedback,
        BookAiSummaryMarkdownOptions::default(),
    )
}

pub fn serialize_book_ai_summary_markdown_with_options(
    book_id: &str,
    title: &str,
    author: Option<&str>,
    response: &BookAiSummaryResponse,
    exported_at: &str,
    review_feedback: Option<&AiReviewFeedbackExport>,
    options: BookAiSummaryMarkdownOptions,
) -> String {
    let summary = &response.summary;
    let mut markdown = String::new();
    let _ = writeln!(markdown, "# {} AI 总结", heading_text(title));
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 书籍 ID：{}", inline_text(book_id));
    let _ = writeln!(
        markdown,
        "- 作者：{}",
        inline_text(author.unwrap_or("未知作者"))
    );
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(
        markdown,
        "- 生成时间：{}",
        inline_text(&summary.generated_at)
    );
    let _ = writeln!(
        markdown,
        "- Prompt 版本：{}",
        inline_text(&summary.prompt_version)
    );
    write_response_format_meta(&mut markdown, summary.response_format);
    if let Some(provider_model) = response.provider_model.as_deref() {
        let _ = writeln!(markdown, "- 模型：{}", inline_text(provider_model));
    }
    if let Some(cached_updated_at) = response.cached_updated_at.as_deref() {
        let _ = writeln!(markdown, "- 缓存更新：{}", inline_text(cached_updated_at));
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "> {}", inline_text(&summary.basis_notice));
    if let Some(error_message) = response.error_message.as_deref() {
        let _ = writeln!(markdown, ">");
        let _ = writeln!(markdown, "> {}", inline_text(error_message));
    }
    let _ = writeln!(markdown);
    write_export_boundary_section(
        &mut markdown,
        "本地 AI 复盘缓存和本地反馈状态",
        &[
            "复盘概览、关键观点、行动项和复盘问题",
            "按导出设置包含的行动反馈、复盘问题反馈和代表性摘录",
        ],
        &[
            "未生成复盘的书",
            "微信读书 API Key、AI API Key、数据库路径和原始接口响应",
        ],
        "导出不会同步微信读书远端，也不会自动生成新的 AI 复盘。",
    );

    write_paragraph_section(&mut markdown, "概览", &summary.overview);
    write_string_list_section(
        &mut markdown,
        "主题标签",
        &summary.theme_tags,
        "这次总结没有提取到稳定主题标签。",
    );
    write_string_list_section(
        &mut markdown,
        "关键观点",
        &summary.key_ideas,
        "这次总结没有提取到明确关键观点。",
    );
    write_string_list_section(
        &mut markdown,
        "我的关注点",
        &summary.my_focus,
        "当前笔记还不足以判断稳定关注点。",
    );
    write_string_list_section(
        &mut markdown,
        "行动项",
        &summary.action_items,
        "这次总结没有生成行动项。",
    );
    if options.include_action_feedback {
        if let Some(feedback) = review_feedback {
            write_ai_feedback_section(
                &mut markdown,
                "行动反馈记录",
                &summary.action_items,
                &feedback.action_items,
                action_feedback_status_label,
            );
        }
    }

    if options.include_representative_quotes {
        let _ = writeln!(markdown, "## 代表性摘录");
        let _ = writeln!(markdown);
        if summary.representative_quotes.is_empty() {
            let _ = writeln!(markdown, "这次总结没有返回可核对的代表性摘录。");
            let _ = writeln!(markdown);
        } else {
            for (index, item) in summary.representative_quotes.iter().enumerate() {
                let _ = writeln!(markdown, "### 摘录 {}", index + 1);
                let _ = writeln!(markdown);
                for line in item.quote.lines() {
                    let _ = writeln!(markdown, "> {}", line.trim());
                }
                let _ = writeln!(markdown);
                let _ = writeln!(markdown, "- 理由：{}", inline_text(&item.reason));
                if let Some(chapter) = item.chapter.as_deref() {
                    let _ = writeln!(markdown, "- 章节：{}", inline_text(chapter));
                }
                let _ = writeln!(markdown, "- 笔记类型：{}", inline_text(&item.note_type));
                let _ = writeln!(markdown);
            }
        }
    }

    write_string_list_section(
        &mut markdown,
        "复盘问题",
        &summary.reflection_questions,
        "这次总结没有生成复盘问题。",
    );
    if options.include_reflection_feedback {
        if let Some(feedback) = review_feedback {
            write_ai_feedback_section(
                &mut markdown,
                "复盘问题反馈记录",
                &summary.reflection_questions,
                &feedback.reflection_questions,
                reflection_feedback_status_label,
            );
        }
    }

    let _ = writeln!(markdown, "## 来源统计");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 划线：{} 条",
        summary.source_stats.highlight_count
    );
    let _ = writeln!(
        markdown,
        "- 想法/点评：{} 条",
        summary.source_stats.thought_count
    );
    let _ = writeln!(
        markdown,
        "- 书签：{} 条",
        summary.source_stats.bookmark_count
    );
    let _ = writeln!(
        markdown,
        "- 章节：{} 个",
        summary.source_stats.chapter_count
    );
    let _ = writeln!(
        markdown,
        "- 纳入总结的划线：{} 条",
        summary.source_stats.included_highlight_count
    );
    let _ = writeln!(
        markdown,
        "- 纳入总结的想法：{} 条",
        summary.source_stats.included_thought_count
    );

    markdown
}

pub fn serialize_reading_stats_review_markdown(
    response: &ReadingStatsAiReviewResponse,
    reading_persona: Option<&ReadingPersona>,
    exported_at: &str,
) -> String {
    let review = &response.review;
    let mut markdown = String::new();
    let _ = writeln!(
        markdown,
        "# {}",
        heading_text(&reading_review_title(&response.mode, response.base_time))
    );
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 周期：{}",
        inline_text(&reading_review_period_label(&response.mode))
    );
    let _ = writeln!(
        markdown,
        "- 周期基点：{}",
        inline_text(&reading_review_anchor_label(
            &response.mode,
            response.base_time
        ))
    );
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(
        markdown,
        "- 生成时间：{}",
        inline_text(&review.generated_at)
    );
    let _ = writeln!(
        markdown,
        "- Prompt 版本：{}",
        inline_text(&review.prompt_version)
    );
    write_response_format_meta(&mut markdown, review.response_format);
    if let Some(provider_model) = response.provider_model.as_deref() {
        let _ = writeln!(markdown, "- 模型：{}", inline_text(provider_model));
    }
    if let Some(cached_updated_at) = response.cached_updated_at.as_deref() {
        let _ = writeln!(markdown, "- 缓存更新：{}", inline_text(cached_updated_at));
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "> {}", inline_text(&review.basis_notice));
    if let Some(error_message) = response.error_message.as_deref() {
        let _ = writeln!(markdown, ">");
        let _ = writeln!(markdown, "> {}", inline_text(error_message));
    }
    let _ = writeln!(markdown);
    write_export_boundary_section(
        &mut markdown,
        "本地结构化阅读统计缓存和本地规则生成的阅读倾向数据",
        &["周期概览、节奏洞察、偏好洞察、重点内容和下一步行动"],
        &["笔记正文、书籍全文、原始接口响应、API Key 和数据库路径"],
        "导出只写出本地已有阅读报告缓存，不会同步微信读书远端，也不会重新生成 AI 复盘。",
    );

    write_paragraph_section(&mut markdown, "概览", &review.overview);
    write_string_list_section(
        &mut markdown,
        "节奏洞察",
        &review.rhythm_insights,
        "这次复盘没有输出节奏洞察。",
    );
    write_string_list_section(
        &mut markdown,
        "偏好洞察",
        &review.preference_insights,
        "这次复盘没有输出偏好洞察。",
    );
    write_string_list_section(
        &mut markdown,
        "重点内容",
        &review.focus_items,
        "这次复盘没有输出重点内容。",
    );
    write_string_list_section(
        &mut markdown,
        "下一步行动",
        &review.next_actions,
        "这次复盘没有输出行动建议。",
    );
    write_reading_persona_section(&mut markdown, reading_persona);

    let _ = writeln!(markdown, "## 数据依据");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 阅读天数：{} 天",
        review.source_stats.read_days.unwrap_or(0)
    );
    if let Some(total_read_time_seconds) = review.source_stats.total_read_time_seconds {
        let _ = writeln!(
            markdown,
            "- 总阅读时长：{}",
            format_duration(total_read_time_seconds)
        );
    }
    if let Some(day_average_read_time_seconds) = review.source_stats.day_average_read_time_seconds {
        let _ = writeln!(
            markdown,
            "- 日均阅读时长：{}",
            format_duration(day_average_read_time_seconds)
        );
    }
    let _ = writeln!(
        markdown,
        "- 趋势分桶：{} 个",
        review.source_stats.bucket_count
    );
    let _ = writeln!(
        markdown,
        "- 最长阅读内容：{} 项",
        review.source_stats.longest_item_count
    );
    let _ = writeln!(
        markdown,
        "- 分类偏好：{} 项",
        review.source_stats.category_count
    );

    markdown
}

fn write_reading_persona_section(markdown: &mut String, reading_persona: Option<&ReadingPersona>) {
    let Some(persona) = reading_persona else {
        return;
    };
    if persona.status == "insufficient" {
        return;
    }

    let is_provisional = persona.status == "provisional";
    let title = if is_provisional {
        "阅读倾向（临时）"
    } else {
        "阅读人格"
    };
    let dimension_label = if is_provisional {
        "当前倾向"
    } else {
        "人格类型"
    };
    let dimensions = if is_provisional {
        persona.dimensions.iter().take(2).collect::<Vec<_>>()
    } else {
        persona.dimensions.iter().collect::<Vec<_>>()
    };
    let evidence = if is_provisional {
        persona.evidence.iter().take(2).cloned().collect::<Vec<_>>()
    } else {
        persona.evidence.clone()
    };

    let _ = writeln!(markdown, "## {title}");
    let _ = writeln!(markdown);
    if let Some(display_title) = persona.display_title.as_deref() {
        let _ = writeln!(
            markdown,
            "- {dimension_label}：{}",
            inline_text(display_title)
        );
    }
    if let Some(summary) = persona.summary.as_deref() {
        let _ = writeln!(markdown, "- 说明：{}", inline_text(summary));
    }
    let _ = writeln!(markdown);

    if !dimensions.is_empty() {
        let _ = writeln!(markdown, "### 维度解释");
        let _ = writeln!(markdown);
        for item in dimensions {
            let _ = writeln!(
                markdown,
                "- {}：{}",
                inline_text(&item.label),
                inline_text(&item.basis)
            );
        }
        let _ = writeln!(markdown);
    }

    write_string_list_section(
        markdown,
        "观察证据",
        &evidence,
        "当前还没有足够证据支撑这一判断。",
    );

    if let Some(suggestion) = persona.suggestion.as_deref() {
        let _ = writeln!(markdown, "### 温和建议");
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "- {}", inline_text(suggestion));
        let _ = writeln!(markdown);
    }

    let _ = writeln!(markdown, "> {}", inline_text(&persona.basis_notice));
    let _ = writeln!(markdown);
}

pub fn serialize_reading_route_markdown(
    response: &ReadingRouteResponse,
    exported_at: &str,
) -> String {
    let route = &response.route;
    let is_cross_book_route = route.source_stats.candidate_count > 0;
    let mut markdown = String::new();
    let title = route
        .books
        .first()
        .map(|book| book.title.as_str())
        .unwrap_or(response.book_id.as_str());

    let _ = writeln!(
        markdown,
        "# {} {}",
        heading_text(title),
        if is_cross_book_route {
            "跨书阅读路线图"
        } else {
            "阅读指南"
        }
    );
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 书籍 ID：{}", inline_text(&response.book_id));
    let _ = writeln!(markdown, "- Scope：{}", inline_text(&response.scope_id));
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(markdown, "- 生成时间：{}", inline_text(&route.generated_at));
    let _ = writeln!(
        markdown,
        "- Prompt 版本：{}",
        inline_text(&route.prompt_version)
    );
    write_response_format_meta(&mut markdown, route.response_format);
    if let Some(provider_model) = response.provider_model.as_deref() {
        let _ = writeln!(markdown, "- 模型：{}", inline_text(provider_model));
    }
    if let Some(cached_updated_at) = response.cached_updated_at.as_deref() {
        let _ = writeln!(markdown, "- 缓存更新：{}", inline_text(cached_updated_at));
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "> {}", inline_text(&route.basis_notice));
    if let Some(error_message) = response.error_message.as_deref() {
        let _ = writeln!(markdown, ">");
        let _ = writeln!(markdown, "> {}", inline_text(error_message));
    }
    let _ = writeln!(markdown);
    write_export_boundary_section(
        &mut markdown,
        "当前书、用户确认的候选书、已生成资产引用和本地统计信号",
        &["指南总览、推进任务、复盘点、下一步行动和来源统计"],
        &["未选择的候选书、书籍全文、远端写回和后台阅读安排"],
        "导出只写出本地已有阅读指南缓存，不会重新调用 AI，也不会自动调整阅读计划。",
    );

    write_paragraph_section(
        &mut markdown,
        if is_cross_book_route {
            "路线总览"
        } else {
            "指南总览"
        },
        &route.route_overview,
    );

    write_reading_route_steps(&mut markdown, route, is_cross_book_route);

    if is_cross_book_route {
        let _ = writeln!(markdown, "## 依赖关系");
        let _ = writeln!(markdown);
        if route.dependencies.is_empty() {
            let _ = writeln!(markdown, "这条路线没有强制前后依赖。");
            let _ = writeln!(markdown);
        } else {
            for item in &route.dependencies {
                let _ = writeln!(
                    markdown,
                    "- {} -> {}：{}",
                    inline_text(&item.from_book_id),
                    inline_text(&item.to_book_id),
                    inline_text(&item.reason)
                );
            }
            let _ = writeln!(markdown);
        }
    }

    let _ = writeln!(markdown, "## 复盘点");
    let _ = writeln!(markdown);
    if route.review_checkpoints.is_empty() {
        let _ = writeln!(
            markdown,
            "{}",
            if is_cross_book_route {
                "这次路线没有生成复盘点。"
            } else {
                "这次指南没有生成复盘点。"
            }
        );
        let _ = writeln!(markdown);
    } else {
        for item in &route.review_checkpoints {
            let _ = writeln!(markdown, "### {}", heading_text(&item.timing));
            let _ = writeln!(markdown);
            let _ = writeln!(markdown, "- 问题：{}", inline_text(&item.question));
            if is_cross_book_route {
                let _ = writeln!(
                    markdown,
                    "- 建议输出：{}",
                    inline_text(&item.suggested_output)
                );
            } else {
                let _ = writeln!(
                    markdown,
                    "- 输出：{}",
                    inline_text(&clean_checkpoint_output(&item.suggested_output))
                );
                let _ = writeln!(
                    markdown,
                    "- 验收：{}",
                    inline_text(&checkpoint_acceptance_text(item))
                );
            }
            let _ = writeln!(markdown);
        }
    }

    if is_cross_book_route {
        write_string_list_section(
            &mut markdown,
            "下一步行动",
            &route.next_actions,
            "这次路线没有生成下一步行动。",
        );
    } else {
        write_single_book_next_actions(&mut markdown, &route.next_actions);
    }

    let _ = writeln!(markdown, "## 来源统计");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 当前书：{} 本",
        route.source_stats.current_book_count
    );
    let _ = writeln!(
        markdown,
        "- 候选书：{} 本",
        route.source_stats.candidate_count
    );
    let _ = writeln!(
        markdown,
        "- 已生成复盘：{} 份",
        route.source_stats.summary_count
    );
    let _ = writeln!(
        markdown,
        "- 统计信号：{} 项",
        route.source_stats.stats_signal_count
    );
    let _ = writeln!(
        markdown,
        "- 本地状态：{} 项",
        route.source_stats.local_status_count
    );

    markdown
}

pub fn serialize_book_decision_markdown(
    response: &BookDecisionResponse,
    exported_at: &str,
) -> String {
    let decision = &response.decision;
    let title = decision
        .top_candidates
        .first()
        .map(|book| book.title.as_str())
        .unwrap_or("下一本书取舍");
    let mut markdown = String::new();

    let _ = writeln!(markdown, "# {} 选书决策", heading_text(title));
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- Scope：{}", inline_text(&response.scope_id));
    let _ = writeln!(markdown, "- 导出时间：{exported_at}");
    let _ = writeln!(
        markdown,
        "- 生成时间：{}",
        inline_text(&decision.generated_at)
    );
    let _ = writeln!(
        markdown,
        "- Prompt 版本：{}",
        inline_text(&decision.prompt_version)
    );
    write_response_format_meta(&mut markdown, decision.response_format);
    if let Some(provider_model) = response.provider_model.as_deref() {
        let _ = writeln!(markdown, "- 模型：{}", inline_text(provider_model));
    }
    if let Some(cached_updated_at) = response.cached_updated_at.as_deref() {
        let _ = writeln!(markdown, "- 缓存更新：{}", inline_text(cached_updated_at));
    }
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "> {}", inline_text(&decision.basis_notice));
    if let Some(error_message) = response.error_message.as_deref() {
        let _ = writeln!(markdown, ">");
        let _ = writeln!(markdown, "> {}", inline_text(error_message));
    }
    let _ = writeln!(markdown);
    write_export_boundary_section(
        &mut markdown,
        "本地候选书架、已生成资产引用和本地统计信号",
        &["推荐结论、推荐顺序、暂缓项、下一步行动和来源统计"],
        &["输入范围外的书籍推荐、远端写回、API Key 和数据库路径"],
        "导出只写出本地已有选书决策缓存，不会重新调用 AI，也不会修改候选书架。",
    );

    write_paragraph_section(&mut markdown, "推荐结论", &decision.decision_overview);
    write_book_decision_candidates(&mut markdown, decision);
    write_string_list_section(
        &mut markdown,
        "下一步行动",
        &decision.next_actions,
        "这次选书决策没有生成下一步行动。",
    );
    write_book_decision_source_stats(&mut markdown, decision);

    markdown
}

fn write_book_decision_candidates(markdown: &mut String, decision: &BookDecision) {
    let _ = writeln!(markdown, "## 推荐顺序");
    let _ = writeln!(markdown);
    if decision.top_candidates.is_empty() {
        let _ = writeln!(markdown, "这次选书决策没有返回可展示候选。");
        let _ = writeln!(markdown);
    } else {
        for candidate in &decision.top_candidates {
            let _ = writeln!(
                markdown,
                "### {}. {}",
                candidate.rank.max(1),
                heading_text(&candidate.title)
            );
            let _ = writeln!(markdown);
            if let Some(author) = candidate.author.as_deref() {
                let _ = writeln!(markdown, "- 作者：{}", inline_text(author));
            }
            let _ = writeln!(
                markdown,
                "- 为什么现在读：{}",
                inline_text(&candidate.why_now)
            );
            let _ = writeln!(markdown, "- 取舍理由：{}", inline_text(&candidate.tradeoff));
            let _ = writeln!(
                markdown,
                "- 预计投入：{}",
                inline_text(&candidate.estimated_effort)
            );
            let _ = writeln!(
                markdown,
                "- 前置动作：{}",
                inline_text(&candidate.prerequisite_action)
            );
            let _ = writeln!(
                markdown,
                "- 复盘触发点：{}",
                inline_text(&candidate.review_trigger)
            );
            let _ = writeln!(markdown, "- 数据依据：{}", inline_text(&candidate.basis));
            let _ = writeln!(markdown);
        }
    }

    let _ = writeln!(markdown, "## 暂缓项");
    let _ = writeln!(markdown);
    if decision.deferred_candidates.is_empty() {
        let _ = writeln!(markdown, "这次没有明确暂缓项。");
        let _ = writeln!(markdown);
    } else {
        for candidate in &decision.deferred_candidates {
            let _ = writeln!(
                markdown,
                "- {}：{}",
                inline_text(&candidate.title),
                inline_text(&candidate.reason)
            );
        }
        let _ = writeln!(markdown);
    }
}

fn write_response_format_meta(
    markdown: &mut String,
    response_format: Option<AiResponseFormatKind>,
) {
    if let Some(response_format) = response_format {
        let _ = writeln!(
            markdown,
            "- 结构化约束：{}",
            inline_text(response_format.as_str())
        );
    }
}

fn write_export_boundary_section(
    markdown: &mut String,
    source: &str,
    includes: &[&str],
    excludes: &[&str],
    behavior: &str,
) {
    let _ = writeln!(markdown, "## 数据边界");
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "- 数据来源：{}", inline_text(source));
    let _ = writeln!(markdown, "- 包含：{}", inline_text(&includes.join("；")));
    let _ = writeln!(markdown, "- 不包含：{}", inline_text(&excludes.join("；")));
    let _ = writeln!(markdown, "- 导出行为：{}", inline_text(behavior));
    let _ = writeln!(markdown);
}

fn write_book_decision_source_stats(markdown: &mut String, decision: &BookDecision) {
    let _ = writeln!(markdown, "## 来源统计");
    let _ = writeln!(markdown);
    let _ = writeln!(
        markdown,
        "- 候选书：{} 本",
        decision.source_stats.candidate_count
    );
    let _ = writeln!(
        markdown,
        "- 已生成复盘：{} 份",
        decision.source_stats.summary_count
    );
    let _ = writeln!(
        markdown,
        "- 统计信号：{} 项",
        decision.source_stats.stats_signal_count
    );
    let _ = writeln!(
        markdown,
        "- 本地状态：{} 项",
        decision.source_stats.local_status_count
    );
}

fn write_reading_route_steps(
    markdown: &mut String,
    route: &ReadingRoute,
    is_cross_book_route: bool,
) {
    let _ = writeln!(
        markdown,
        "## {}",
        if is_cross_book_route {
            "阅读顺序"
        } else {
            "推进任务"
        }
    );
    let _ = writeln!(markdown);
    if route.books.is_empty() {
        let _ = writeln!(
            markdown,
            "{}",
            if is_cross_book_route {
                "这次路线没有返回可展示书籍。"
            } else {
                "这次指南没有返回可展示任务。"
            }
        );
        let _ = writeln!(markdown);
        return;
    }

    for (index, book) in route.books.iter().enumerate() {
        let order = if book.order == 0 {
            index + 1
        } else {
            book.order
        };
        let _ = writeln!(markdown, "### {}. {}", order, heading_text(&book.title));
        let _ = writeln!(markdown);
        if let Some(author) = book.author.as_deref() {
            let _ = writeln!(markdown, "- 作者：{}", inline_text(author));
        }
        let _ = writeln!(markdown, "- 角色：{}", inline_text(&book.role));
        if is_cross_book_route {
            let _ = writeln!(
                markdown,
                "- 阅读目的：{}",
                inline_text(&book.reading_purpose)
            );
        } else {
            let _ = writeln!(
                markdown,
                "- 阅读任务：{}",
                inline_text(&single_book_reading_task(book, route))
            );
        }
        let _ = writeln!(
            markdown,
            "- 预计投入：{}",
            inline_text(&book.estimated_effort)
        );
        if let Some(local_status) = book.local_status.as_deref() {
            let _ = writeln!(markdown, "- 本地状态：{}", inline_text(local_status));
        }
        let _ = writeln!(markdown, "- 数据依据：{}", inline_text(&book.basis));
        let _ = writeln!(markdown);
    }
}

fn single_book_reading_task(book: &ReadingRouteBookStep, route: &ReadingRoute) -> String {
    let mut values = route
        .next_actions
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    values.push(book.basis.as_str());
    values.push(book.reading_purpose.as_str());

    if let Some(reading_range) = extract_chapter_range(&values) {
        return prefix_action(&reading_range, "读完");
    }

    let reading_purpose = clean_guide_text(&book.reading_purpose);
    if reading_purpose.is_empty() {
        "完成下一段关键阅读".to_string()
    } else {
        reading_purpose
    }
}

fn write_single_book_next_actions(markdown: &mut String, actions: &[String]) {
    let _ = writeln!(markdown, "## 下一步行动");
    let _ = writeln!(markdown);

    if actions.is_empty() {
        let _ = writeln!(markdown, "这次指南没有生成下一步行动。");
        let _ = writeln!(markdown);
        return;
    }

    for action in actions {
        let (title, done) = action_detail(action);
        let _ = writeln!(markdown, "- {}", inline_text(&title));
        let _ = writeln!(markdown, "  - 完成标准：{}", inline_text(&done));
    }
    let _ = writeln!(markdown);
}

fn clean_checkpoint_output(value: &str) -> String {
    trim_sentence_end(&strip_checkpoint_verb(&clean_guide_text(value)))
}

fn checkpoint_acceptance_text(checkpoint: &ReadingRouteCheckpoint) -> String {
    let requirement = extract_requirement_after_comma(&checkpoint.suggested_output);
    if requirement.is_empty() {
        return "能直接指导下一次阅读。".to_string();
    }

    ensure_chinese_period(&requirement)
}

fn action_detail(value: &str) -> (String, String) {
    let segments = split_guide_segments(value);
    let title = segments.first().cloned().unwrap_or_default();
    let done = strip_leading_and(
        &segments
            .iter()
            .skip(1)
            .cloned()
            .collect::<Vec<_>>()
            .join("，"),
    );

    (
        trim_sentence_end(&title),
        ensure_chinese_period(if done.is_empty() {
            "完成后立即保存为本书复盘记录"
        } else {
            &done
        }),
    )
}

fn extract_requirement_after_comma(value: &str) -> String {
    let segments = split_guide_segments(value);
    if segments.len() < 2 {
        return String::new();
    }

    strip_checkpoint_verb(&strip_leading_and(
        &segments
            .iter()
            .skip(1)
            .cloned()
            .collect::<Vec<_>>()
            .join("，"),
    ))
}

fn split_guide_segments(value: &str) -> Vec<String> {
    clean_guide_text(value)
        .split(|character| matches!(character, '，' | ',' | '；' | ';'))
        .map(trim_sentence_end)
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn extract_chapter_range(values: &[&str]) -> Option<String> {
    let mut first_match = None;

    for value in values {
        let text = clean_guide_text(value);
        if let Some(chapter_range) = find_chapter_range(&text) {
            if chapter_range.contains('到')
                || chapter_range.contains('至')
                || chapter_range.contains('-')
                || chapter_range.contains('—')
                || chapter_range.contains('~')
            {
                return Some(chapter_range);
            }
            first_match.get_or_insert(chapter_range);
        }
    }

    first_match
}

fn find_chapter_range(value: &str) -> Option<String> {
    let chars = value.chars().collect::<Vec<_>>();
    for index in 0..chars.len() {
        if chars[index] == '第' {
            if let Some((chapter_range, _)) = parse_chapter_range_at(&chars, index) {
                return Some(chapter_range);
            }
        }
    }

    None
}

fn parse_chapter_range_at(chars: &[char], start: usize) -> Option<(String, usize)> {
    let (first, mut cursor) = parse_chapter_ref(chars, start, true)?;
    cursor = skip_whitespace(chars, cursor);
    let Some(separator) = chars.get(cursor).copied() else {
        return Some((first, cursor));
    };

    if !is_chapter_separator(separator) {
        return Some((first, cursor));
    }

    cursor = skip_whitespace(chars, cursor + 1);
    let Some((second, end)) = parse_chapter_ref(chars, cursor, false) else {
        return Some((first, cursor));
    };

    Some((format!("{first}{separator}{second}"), end))
}

fn parse_chapter_ref(
    chars: &[char],
    start: usize,
    require_prefix: bool,
) -> Option<(String, usize)> {
    let mut cursor = start;
    if chars.get(cursor).copied() == Some('第') {
        cursor += 1;
    } else if require_prefix {
        return None;
    }

    cursor = skip_whitespace(chars, cursor);
    let mut number = String::new();
    while let Some(character) = chars.get(cursor).copied() {
        if is_chapter_number(character) {
            number.push(character);
            cursor += 1;
        } else if character.is_whitespace() {
            cursor += 1;
        } else {
            break;
        }
    }

    cursor = skip_whitespace(chars, cursor);
    let unit = chars
        .get(cursor)
        .copied()
        .filter(|unit| is_chapter_unit(*unit))?;
    if number.is_empty() {
        return None;
    }

    Some((format!("第 {number} {unit}"), cursor + 1))
}

fn skip_whitespace(chars: &[char], mut cursor: usize) -> usize {
    while chars
        .get(cursor)
        .copied()
        .is_some_and(|character| character.is_whitespace())
    {
        cursor += 1;
    }

    cursor
}

fn is_chapter_number(character: char) -> bool {
    character.is_ascii_digit() || "一二三四五六七八九十百零〇两".contains(character)
}

fn is_chapter_unit(character: char) -> bool {
    "章节回篇部".contains(character)
}

fn is_chapter_separator(character: char) -> bool {
    matches!(character, '到' | '至' | '-' | '—' | '~')
}

fn prefix_action(value: &str, action: &str) -> String {
    if value.starts_with(action) || value.starts_with("完成") {
        value.to_string()
    } else {
        format!("{action}{value}")
    }
}

fn clean_guide_text(value: &str) -> String {
    let mut text = inline_text(value);
    for phrase in ["整书复盘沉淀", "持续推进"] {
        text = text.replace(phrase, "");
    }
    text = remove_bounded_phrase(&text, "建立稳定", "习惯", 16);
    text = remove_bounded_phrase(&text, "可复用", "模板", 16);
    trim_sentence_end(&text.replace("  ", " "))
}

fn remove_bounded_phrase(
    value: &str,
    start_text: &str,
    end_text: &str,
    max_chars: usize,
) -> String {
    let mut text = value.to_string();

    while let Some(start) = text.find(start_text) {
        let Some(relative_end) = text[start..].find(end_text) else {
            break;
        };
        let end = start + relative_end + end_text.len();
        if text[start..end].chars().count() > max_chars {
            break;
        }
        text.replace_range(start..end, "");
    }

    text
}

fn strip_checkpoint_verb(value: &str) -> String {
    let text = value.trim();
    for verb in ["写", "整理", "列出", "输出", "完成", "沉淀"] {
        if let Some(rest) = text.strip_prefix(verb) {
            return rest.trim().to_string();
        }
    }

    text.to_string()
}

fn strip_leading_and(value: &str) -> String {
    value.trim().trim_start_matches('并').trim().to_string()
}

fn trim_sentence_end(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(|character| matches!(character, '，' | ',' | '；' | ';' | '。'))
        .trim()
        .to_string()
}

fn ensure_chinese_period(value: &str) -> String {
    let text = value.trim();
    if text.ends_with('。') || text.ends_with('！') || text.ends_with('？') {
        text.to_string()
    } else {
        format!("{text}。")
    }
}

fn write_group(markdown: &mut String, group: &ChapterNoteGroup) {
    let _ = writeln!(markdown, "## {}", heading_text(&group.title));
    let _ = writeln!(markdown);

    if !group.highlights.is_empty() {
        let _ = writeln!(markdown, "### 划线");
        let _ = writeln!(markdown);

        for highlight in &group.highlights {
            write_highlight(markdown, highlight);
        }
    }

    if !group.thoughts.is_empty() {
        let _ = writeln!(markdown, "### 想法/点评");
        let _ = writeln!(markdown);

        for thought in &group.thoughts {
            write_thought(markdown, thought);
        }
    }
}

fn write_highlight(markdown: &mut String, highlight: &HighlightRecord) {
    let deep_link = highlight_deep_link(highlight);
    let block_id = highlight_block_id(highlight);
    let lines = highlight
        .mark_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    for (index, text) in lines.iter().enumerate() {
        if index == 0 {
            if let Some(link) = deep_link.as_deref() {
                let _ = writeln!(markdown, "> [{}](<{}>)", text, link);
            } else {
                let _ = writeln!(markdown, "> {}", text);
            }
        } else {
            let _ = writeln!(markdown, "> {}", text);
        }
    }

    let mut wrote_block_id = false;
    if let Some(create_time) = highlight.create_time {
        let time_label = unix_seconds_label(create_time);
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "_划线时间：{time_label}_ ^{block_id}");
        wrote_block_id = true;
    }

    if let Some(range) = &highlight.range_text {
        let _ = writeln!(markdown);
        if wrote_block_id {
            let _ = writeln!(markdown, "_位置：{}_", inline_text(range));
        } else {
            let _ = writeln!(markdown, "_位置：{}_ ^{block_id}", inline_text(range));
            wrote_block_id = true;
        }
    }

    if !wrote_block_id {
        let _ = writeln!(markdown);
        let _ = writeln!(markdown, "^{}", block_id);
    }
    let _ = writeln!(markdown);
}

fn write_thought(markdown: &mut String, thought: &ThoughtRecord) {
    if let Some(abstract_text) = thought.abstract_text.as_deref() {
        let link = thought_deep_link(thought);
        if let Some(link) = link.as_deref() {
            let _ = writeln!(
                markdown,
                "- 原文：[{}](<{}>)",
                inline_text(abstract_text),
                link
            );
        } else {
            let _ = writeln!(markdown, "- 原文：{}", inline_text(abstract_text));
        }
        let _ = writeln!(markdown, "  - 想法：{}", inline_text(&thought.content));
    } else {
        let _ = writeln!(markdown, "- {}", inline_text(&thought.content));
    }

    if let Some(star) = thought.star {
        let _ = writeln!(markdown, "  - 评分：{star}");
    }

    if let Some(range) = thought.range_text.as_deref() {
        let _ = writeln!(markdown, "  - 位置：{}", inline_text(range));
    }

    if let Some(create_time) = thought.create_time {
        let _ = writeln!(
            markdown,
            "  - 创建时间：{}",
            unix_seconds_label(create_time)
        );
    }

    if thought.is_finish == Some(true) {
        let _ = writeln!(markdown, "  - 状态：读完点评");
    }

    let _ = writeln!(markdown);
}

fn write_paragraph_section(markdown: &mut String, title: &str, content: &str) {
    let _ = writeln!(markdown, "## {}", heading_text(title));
    let _ = writeln!(markdown);
    let _ = writeln!(markdown, "{}", inline_text(content));
    let _ = writeln!(markdown);
}

fn write_string_list_section(
    markdown: &mut String,
    title: &str,
    items: &[String],
    empty_text: &str,
) {
    let _ = writeln!(markdown, "## {}", heading_text(title));
    let _ = writeln!(markdown);

    if items.is_empty() {
        let _ = writeln!(markdown, "{}", inline_text(empty_text));
        let _ = writeln!(markdown);
        return;
    }

    for item in items {
        let _ = writeln!(markdown, "- {}", inline_text(item));
    }
    let _ = writeln!(markdown);
}

fn write_ai_feedback_section(
    markdown: &mut String,
    title: &str,
    items: &[String],
    feedback_by_item_id: &std::collections::HashMap<String, AiFeedbackExportRecord>,
    status_label: fn(&str) -> &'static str,
) {
    let _ = writeln!(markdown, "## {}", heading_text(title));
    let _ = writeln!(markdown);

    let mut has_feedback = false;
    for (index, item) in items.iter().enumerate() {
        let item_id = ai_feedback_item_id(item, index);
        let Some(feedback) = feedback_by_item_id.get(&item_id) else {
            continue;
        };

        has_feedback = true;
        let _ = writeln!(markdown, "{}. {}", index + 1, inline_text(item));
        let _ = writeln!(markdown, "   - 状态：{}", status_label(&feedback.status));
        if let Some(note) = feedback
            .note
            .as_deref()
            .filter(|note| !note.trim().is_empty())
        {
            let _ = writeln!(markdown, "   - 记录：");
            for line in note.lines() {
                if line.trim().is_empty() {
                    let _ = writeln!(markdown, "     ");
                } else {
                    let _ = writeln!(markdown, "     {}", inline_text(line));
                }
            }
        }
        let _ = writeln!(markdown);
    }

    if !has_feedback {
        let _ = writeln!(markdown, "暂无反馈记录。");
        let _ = writeln!(markdown);
    }
}

fn ai_feedback_item_id(text: &str, index: usize) -> String {
    format!("{index}:{}", inline_text(text))
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

fn write_book_notes_front_matter(
    markdown: &mut String,
    notes: &BookNotesRecord,
    title: &str,
    author: &str,
    cover: Option<&str>,
    reading_progress: Option<&str>,
    exported_at: &str,
) {
    let _ = writeln!(markdown, "---");
    let _ = writeln!(markdown, "doc_type: wxreadmaster-book-notes");
    let _ = writeln!(markdown, "bookId: {}", yaml_string(&notes.book_id));
    let _ = writeln!(markdown, "title: {}", yaml_string(title));
    let _ = writeln!(markdown, "author: {}", yaml_string(author));
    let _ = writeln!(markdown, "reviewCount: {}", notes.thoughts.len());
    let _ = writeln!(markdown, "noteCount: {}", notes.highlights.len());
    let _ = writeln!(markdown, "bookmarkCount: {}", notes.bookmark_count);
    if let Some(cover) = cover {
        let _ = writeln!(markdown, "cover: {}", yaml_string(cover));
    }
    if let Some(progress) = reading_progress {
        let _ = writeln!(markdown, "progress: {}", yaml_string(progress));
    }
    let _ = writeln!(markdown, "exportedAt: {}", yaml_string(exported_at));
    let _ = writeln!(markdown, "---");
    let _ = writeln!(markdown);
}

fn heading_text(value: &str) -> String {
    inline_text(value).replace('#', "\\#")
}

fn inline_text(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn yaml_string(value: &str) -> String {
    format!(
        "\"{}\"",
        inline_text(value)
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}

fn format_reading_progress(progress: i64) -> String {
    format!("{}%", progress.clamp(0, 100))
}

fn unix_seconds_string_label(value: &str) -> String {
    value
        .parse::<i64>()
        .ok()
        .map(unix_seconds_label)
        .unwrap_or_else(|| inline_text(value))
}

fn unix_seconds_label(timestamp: i64) -> String {
    let Some(datetime) = chrono::DateTime::from_timestamp(timestamp, 0) else {
        return timestamp.to_string();
    };
    let local = datetime.with_timezone(&Local);

    format!(
        "{}-{:02}-{:02} {:02}:{:02}:{:02}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second()
    )
}

fn highlight_deep_link(highlight: &HighlightRecord) -> Option<String> {
    if let (Some(chapter_uid), Some((range_start, range_end))) = (
        highlight.chapter_uid,
        parse_range_bounds(highlight.range_text.as_deref()),
    ) {
        return Some(format!(
            "weread://bestbookmark?bookId={}&chapterUid={chapter_uid}&rangeStart={range_start}&rangeEnd={range_end}",
            highlight.book_id
        ));
    }

    highlight.deep_link.clone()
}

fn thought_deep_link(thought: &ThoughtRecord) -> Option<String> {
    if let (Some(chapter_uid), Some((range_start, range_end))) = (
        thought.chapter_uid,
        parse_range_bounds(thought.range_text.as_deref()),
    ) {
        return Some(format!(
            "weread://bestbookmark?bookId={}&chapterUid={chapter_uid}&rangeStart={range_start}&rangeEnd={range_end}",
            thought.book_id
        ));
    }

    thought.deep_link.clone()
}

fn highlight_block_id(highlight: &HighlightRecord) -> String {
    if let (Some(chapter_uid), Some((range_start, range_end))) = (
        highlight.chapter_uid,
        parse_range_bounds(highlight.range_text.as_deref()),
    ) {
        return format!(
            "{}-{chapter_uid}-{range_start}-{range_end}",
            sanitize_block_id(&highlight.book_id)
        );
    }

    format!(
        "{}-{}",
        sanitize_block_id(&highlight.book_id),
        sanitize_block_id(&highlight.bookmark_id)
    )
}

fn parse_range_bounds(range: Option<&str>) -> Option<(i64, i64)> {
    let range = range?;
    let numbers = range
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();

    let [.., start, end] = numbers.as_slice() else {
        return None;
    };

    Some((*start, *end))
}

fn sanitize_block_id(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        "note".to_string()
    } else {
        sanitized
    }
}

fn reading_review_title(mode: &str, base_time: i64) -> String {
    if mode == "overall" || base_time <= 0 {
        return "长期阅读画像".to_string();
    }

    let Some(datetime) = chrono::DateTime::from_timestamp(base_time, 0) else {
        return match mode {
            "weekly" => "周度阅读复盘".to_string(),
            "annually" => "年度阅读复盘".to_string(),
            _ => "月度阅读复盘".to_string(),
        };
    };
    let local = datetime.with_timezone(&Local);

    match mode {
        "weekly" => format!(
            "{}-{:02}-{:02} 当周阅读复盘",
            local.year(),
            local.month(),
            local.day()
        ),
        "annually" => format!("{} 年度阅读复盘", local.year()),
        _ => format!("{} 年 {} 月阅读复盘", local.year(), local.month()),
    }
}

fn reading_review_period_label(mode: &str) -> String {
    match mode {
        "weekly" => "周度".to_string(),
        "annually" => "年度".to_string(),
        "overall" => "总计".to_string(),
        _ => "月度".to_string(),
    }
}

fn reading_review_anchor_label(mode: &str, base_time: i64) -> String {
    if mode == "overall" || base_time <= 0 {
        return "全部历史".to_string();
    }

    let Some(datetime) = chrono::DateTime::from_timestamp(base_time, 0) else {
        return base_time.to_string();
    };
    let local = datetime.with_timezone(&Local);

    match mode {
        "weekly" => format!("{}-{:02}-{:02}", local.year(), local.month(), local.day()),
        "annually" => format!("{}年", local.year()),
        _ => format!("{}年{:02}月", local.year(), local.month()),
    }
}

fn format_duration(seconds: i64) -> String {
    let normalized_seconds = seconds.max(0);
    let hours = normalized_seconds / 3600;
    let minutes = (normalized_seconds % 3600) / 60;
    let remain_seconds = normalized_seconds % 60;

    if hours > 0 && minutes > 0 {
        format!("{hours}小时{minutes}分钟")
    } else if hours > 0 {
        format!("{hours}小时")
    } else if minutes > 0 {
        format!("{minutes}分钟")
    } else {
        format!("{remain_seconds}秒")
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        mappers::notes::{
            build_book_notes_record, HighlightRecord, NotebookBookRecord, ThoughtRecord,
        },
        services::ai::{
            AiFeedbackExportRecord, AiResponseFormatKind, AiReviewFeedbackExport,
            BookAiRepresentativeQuote, BookAiSummary, BookAiSummaryResponse, BookAiSummarySource,
            BookAiSummarySourceStats, BookDecision, BookDecisionDeferredCandidate,
            BookDecisionResponse, BookDecisionSourceStats, BookDecisionTopCandidate,
            ReadingPersona, ReadingPersonaDimension, ReadingRoute, ReadingRouteBookStep,
            ReadingRouteCheckpoint, ReadingRouteResponse, ReadingRouteSourceStats,
            ReadingStatsAiReview, ReadingStatsAiReviewResponse, ReadingStatsAiReviewSourceStats,
        },
    };
    use std::collections::HashMap;

    use super::{
        serialize_book_ai_summary_markdown, serialize_book_ai_summary_markdown_with_options,
        serialize_book_decision_markdown, serialize_book_notes_markdown,
        serialize_reading_route_markdown, serialize_reading_stats_review_markdown,
        BookAiSummaryMarkdownOptions,
    };

    #[test]
    fn markdown_export_keeps_bookmarks_as_count_only() {
        let book = NotebookBookRecord {
            book_id: "b1".to_string(),
            title: "书名".to_string(),
            author: Some("作者".to_string()),
            cover: Some("https://example.com/cover.jpg".to_string()),
            review_count: 1,
            note_count: 1,
            bookmark_count: 2,
            total_note_count: 4,
            reading_progress: Some(37),
            marked_status: None,
            sort: None,
            raw_json: "{}".to_string(),
        };
        let notes = build_book_notes_record(
            "b1",
            Some(book),
            vec![HighlightRecord {
                bookmark_id: "h1".to_string(),
                book_id: "b1".to_string(),
                chapter_uid: None,
                chapter_title: None,
                mark_text: "划线内容".to_string(),
                create_time: None,
                range_text: None,
                deep_link: None,
                raw_json: "{}".to_string(),
            }],
            vec![ThoughtRecord {
                review_id: "r1".to_string(),
                book_id: "b1".to_string(),
                content: "想法内容".to_string(),
                abstract_text: None,
                create_time: None,
                star: None,
                chapter_name: None,
                chapter_uid: None,
                range_text: None,
                deep_link: None,
                is_finish: None,
                raw_json: "{}".to_string(),
            }],
            vec![],
        );

        let markdown = serialize_book_notes_markdown(&notes, "100");

        assert!(markdown.contains("书签：2 条"));
        assert!(markdown.contains("doc_type: wxreadmaster-book-notes"));
        assert!(markdown.contains("cover: \"https://example.com/cover.jpg\""));
        assert!(markdown.contains("progress: \"37%\""));
        assert!(markdown.contains("![封面](https://example.com/cover.jpg)"));
        assert!(markdown.contains("当前微信读书接口只提供书签数量"));
        assert!(markdown.contains("划线内容"));
        assert!(markdown.contains("想法内容"));
    }

    #[test]
    fn markdown_export_uses_human_time_deep_link_and_block_id() {
        let notes = build_book_notes_record(
            "b1",
            None,
            vec![HighlightRecord {
                bookmark_id: "h1".to_string(),
                book_id: "b1".to_string(),
                chapter_uid: Some(28),
                chapter_title: Some("第一章".to_string()),
                mark_text: "划线内容".to_string(),
                create_time: Some(1_706_692_800),
                range_text: Some("659-705".to_string()),
                deep_link: Some("weread://reading?bId=b1&chapterUid=28".to_string()),
                raw_json: "{}".to_string(),
            }],
            vec![ThoughtRecord {
                review_id: "r1".to_string(),
                book_id: "b1".to_string(),
                content: "想法内容".to_string(),
                abstract_text: Some("依附原文".to_string()),
                create_time: Some(1_706_692_860),
                star: None,
                chapter_name: Some("第一章".to_string()),
                chapter_uid: Some(28),
                range_text: Some("900-920".to_string()),
                deep_link: Some("weread://reading?bId=b1&chapterUid=28".to_string()),
                is_finish: None,
                raw_json: "{}".to_string(),
            }],
            vec![],
        );

        let markdown = serialize_book_notes_markdown(&notes, "1706692800");

        assert!(markdown.contains("exportedAt: \""));
        assert!(markdown.contains(
            "[划线内容](<weread://bestbookmark?bookId=b1&chapterUid=28&rangeStart=659&rangeEnd=705>)"
        ));
        assert!(markdown.contains("^b1-28-659-705"));
        assert!(markdown.contains("_划线时间："));
        assert!(markdown.contains("原文：[依附原文](<weread://bestbookmark?bookId=b1&chapterUid=28&rangeStart=900&rangeEnd=920>)"));
        assert!(markdown.contains("  - 想法：想法内容"));
        assert!(!markdown.contains("_划线时间：1706692800_"));
        assert!(!markdown.contains("创建时间：1706692860"));
    }

    #[test]
    fn book_ai_summary_markdown_export_contains_sections() {
        let response = BookAiSummaryResponse {
            book_id: "b1".to_string(),
            prompt_version: "book-notes-summary-v3".to_string(),
            input_hash: "hash".to_string(),
            provider_model: Some("gpt-4o-mini".to_string()),
            source: BookAiSummarySource::Cache,
            summary: BookAiSummary {
                overview: "围绕专注和复盘展开。".to_string(),
                key_ideas: vec!["关键观点".to_string()],
                my_focus: vec!["我的关注点".to_string()],
                action_items: vec!["行动项".to_string()],
                theme_tags: vec!["专注".to_string()],
                representative_quotes: vec![BookAiRepresentativeQuote {
                    quote: "原文摘录".to_string(),
                    reason: "可核对".to_string(),
                    chapter: Some("第一章".to_string()),
                    note_type: "划线".to_string(),
                }],
                reflection_questions: vec!["复盘问题".to_string()],
                reading_stage: None,
                source_stats: BookAiSummarySourceStats {
                    highlight_count: 1,
                    thought_count: 1,
                    bookmark_count: 0,
                    chapter_count: 1,
                    included_highlight_count: 1,
                    included_thought_count: 1,
                },
                generated_at: "100".to_string(),
                prompt_version: "book-notes-summary-v3".to_string(),
                response_format: Some(AiResponseFormatKind::JsonSchema),
                basis_notice: "基于本地笔记生成。".to_string(),
                feedback_outcome_summary: None,
            },
            cached_updated_at: Some("120".to_string()),
            error_message: None,
        };

        let markdown = serialize_book_ai_summary_markdown(
            "b1",
            "深度工作",
            Some("卡尔"),
            &response,
            "130",
            None,
        );

        assert!(markdown.contains("# 深度工作 AI 总结"));
        assert!(markdown.contains("## 关键观点"));
        assert!(markdown.contains("## 代表性摘录"));
        assert!(markdown.contains("原文摘录"));
        assert!(markdown.contains("## 数据边界"));
        assert!(markdown.contains("导出不会同步微信读书远端"));
        assert!(markdown.contains("## 来源统计"));
        assert!(markdown.contains("- 结构化约束：json_schema"));
    }

    #[test]
    fn book_ai_summary_markdown_export_includes_local_feedback_when_provided() {
        let response = BookAiSummaryResponse {
            book_id: "b1".to_string(),
            prompt_version: "book-notes-summary-v3".to_string(),
            input_hash: "hash".to_string(),
            provider_model: None,
            source: BookAiSummarySource::Cache,
            summary: BookAiSummary {
                overview: "围绕专注和复盘展开。".to_string(),
                key_ideas: vec![],
                my_focus: vec![],
                action_items: vec!["写一页复盘".to_string()],
                theme_tags: vec![],
                representative_quotes: vec![],
                reflection_questions: vec!["你如何定义成功？".to_string()],
                reading_stage: None,
                source_stats: BookAiSummarySourceStats {
                    highlight_count: 1,
                    thought_count: 1,
                    bookmark_count: 0,
                    chapter_count: 1,
                    included_highlight_count: 1,
                    included_thought_count: 1,
                },
                generated_at: "100".to_string(),
                prompt_version: "book-notes-summary-v3".to_string(),
                response_format: Some(AiResponseFormatKind::JsonSchema),
                basis_notice: "基于本地笔记生成。".to_string(),
                feedback_outcome_summary: None,
            },
            cached_updated_at: None,
            error_message: None,
        };
        let mut action_items = HashMap::new();
        action_items.insert(
            "0:写一页复盘".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("第一段\n\n第二段".to_string()),
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        let mut reflection_questions = HashMap::new();
        reflection_questions.insert(
            "0:你如何定义成功？".to_string(),
            AiFeedbackExportRecord {
                status: "skipped".to_string(),
                note: None,
                updated_at: "2024-01-02T00:00:00.000Z".to_string(),
            },
        );

        let markdown = serialize_book_ai_summary_markdown(
            "b1",
            "深度工作",
            None,
            &response,
            "130",
            Some(&AiReviewFeedbackExport {
                action_items,
                reflection_questions,
            }),
        );

        assert!(markdown.contains("## 行动反馈记录"));
        assert!(markdown.contains("- 状态：已完成"));
        assert!(markdown.contains("第一段"));
        assert!(markdown.contains("第二段"));
        assert!(markdown.contains("## 复盘问题反馈记录"));
        assert!(markdown.contains("- 状态：暂不答"));
    }

    #[test]
    fn book_ai_summary_markdown_export_can_omit_optional_sections() {
        let response = BookAiSummaryResponse {
            book_id: "b1".to_string(),
            prompt_version: "book-notes-summary-v3".to_string(),
            input_hash: "hash".to_string(),
            provider_model: None,
            source: BookAiSummarySource::Cache,
            summary: BookAiSummary {
                overview: "围绕专注和复盘展开。".to_string(),
                key_ideas: vec![],
                my_focus: vec![],
                action_items: vec!["写一页复盘".to_string()],
                theme_tags: vec![],
                representative_quotes: vec![BookAiRepresentativeQuote {
                    quote: "原文摘录".to_string(),
                    reason: "可核对".to_string(),
                    chapter: Some("第一章".to_string()),
                    note_type: "划线".to_string(),
                }],
                reflection_questions: vec!["你如何定义成功？".to_string()],
                reading_stage: None,
                source_stats: BookAiSummarySourceStats {
                    highlight_count: 1,
                    thought_count: 1,
                    bookmark_count: 0,
                    chapter_count: 1,
                    included_highlight_count: 1,
                    included_thought_count: 1,
                },
                generated_at: "100".to_string(),
                prompt_version: "book-notes-summary-v3".to_string(),
                response_format: Some(AiResponseFormatKind::JsonObject),
                basis_notice: "基于本地笔记生成。".to_string(),
                feedback_outcome_summary: None,
            },
            cached_updated_at: None,
            error_message: None,
        };
        let mut action_items = HashMap::new();
        action_items.insert(
            "0:写一页复盘".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已完成".to_string()),
                updated_at: "2024-01-01T00:00:00.000Z".to_string(),
            },
        );
        let mut reflection_questions = HashMap::new();
        reflection_questions.insert(
            "0:你如何定义成功？".to_string(),
            AiFeedbackExportRecord {
                status: "completed".to_string(),
                note: Some("已回答".to_string()),
                updated_at: "2024-01-02T00:00:00.000Z".to_string(),
            },
        );

        let markdown = serialize_book_ai_summary_markdown_with_options(
            "b1",
            "深度工作",
            None,
            &response,
            "130",
            Some(&AiReviewFeedbackExport {
                action_items,
                reflection_questions,
            }),
            BookAiSummaryMarkdownOptions {
                include_action_feedback: true,
                include_reflection_feedback: false,
                include_representative_quotes: false,
            },
        );

        assert!(markdown.contains("## 行动反馈记录"));
        assert!(markdown.contains("已完成"));
        assert!(!markdown.contains("## 复盘问题反馈记录"));
        assert!(!markdown.contains("已回答"));
        assert!(!markdown.contains("## 代表性摘录"));
        assert!(!markdown.contains("原文摘录"));
    }

    #[test]
    fn reading_stats_review_markdown_export_contains_sections() {
        let response = ReadingStatsAiReviewResponse {
            mode: "monthly".to_string(),
            base_time: 1_725_955_200,
            prompt_version: "reading-stats-review-v1".to_string(),
            input_hash: "hash".to_string(),
            provider_model: Some("gpt-4o-mini".to_string()),
            source: BookAiSummarySource::Cache,
            review: ReadingStatsAiReview {
                overview: "本月节奏稳定。".to_string(),
                rhythm_insights: vec!["节奏洞察".to_string()],
                preference_insights: vec!["偏好洞察".to_string()],
                focus_items: vec!["重点内容".to_string()],
                next_actions: vec!["行动建议".to_string()],
                reading_persona: None,
                source_stats: ReadingStatsAiReviewSourceStats {
                    mode: "monthly".to_string(),
                    base_time: 1_725_955_200,
                    read_days: Some(12),
                    total_read_time_seconds: Some(7_200),
                    day_average_read_time_seconds: Some(600),
                    bucket_count: 3,
                    longest_item_count: 1,
                    category_count: 2,
                },
                generated_at: "100".to_string(),
                prompt_version: "reading-stats-review-v1".to_string(),
                response_format: Some(AiResponseFormatKind::JsonSchema),
                basis_notice: "基于结构化阅读统计生成。".to_string(),
            },
            cached_updated_at: Some("120".to_string()),
            error_message: Some("当前统计已变化。".to_string()),
        };
        let persona = ReadingPersona {
            status: "complete".to_string(),
            code: Some("INFJ".to_string()),
            label: Some("历史共情者".to_string()),
            display_title: Some("INFJ 型读者 · 历史共情者".to_string()),
            palette_group: Some("NF".to_string()),
            accent_tone: Some("rose".to_string()),
            basis_notice: "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。".to_string(),
            dimensions: vec![
                ReadingPersonaDimension {
                    axis: "energy".to_string(),
                    key: "I".to_string(),
                    label: "主题深度".to_string(),
                    strength: "strong".to_string(),
                    basis: "注意力更集中在少数主线和作者上，说明这一周期更接近持续深挖。"
                        .to_string(),
                },
                ReadingPersonaDimension {
                    axis: "information".to_string(),
                    key: "N".to_string(),
                    label: "概念想象".to_string(),
                    strength: "medium".to_string(),
                    basis: "主题偏向历史和文学，说明这段时间更在意概念、背景和长期脉络。"
                        .to_string(),
                },
            ],
            evidence: vec![
                "历史 是当前投入最多的主题，约占分类投入的 63%。".to_string(),
                "本周期活跃阅读 12 天，稳定分布的高活跃时间段约占 58%。".to_string(),
            ],
            confidence: Some(0.81),
            summary: Some("这一周期更像围绕历史主线持续推进。".to_string()),
            suggestion: Some("下个周期可以补一本文学短书，增加横向参照。".to_string()),
        };

        let markdown = serialize_reading_stats_review_markdown(&response, Some(&persona), "130");

        assert!(markdown.contains("# 2024 年 9 月阅读复盘"));
        assert!(markdown.contains("- 周期：月度"));
        assert!(markdown.contains("- 周期基点：2024年09月"));
        assert!(markdown.contains("## 节奏洞察"));
        assert!(markdown.contains("## 下一步行动"));
        assert!(markdown.contains("## 阅读人格"));
        assert!(markdown.contains("INFJ 型读者 · 历史共情者"));
        assert!(markdown.contains("### 维度解释"));
        assert!(markdown.contains("### 温和建议"));
        assert!(markdown.contains("当前统计已变化。"));
        assert!(markdown.contains("## 数据边界"));
        assert!(markdown.contains("本地结构化阅读统计缓存"));
        assert!(markdown.contains("## 数据依据"));
        assert!(markdown.contains("- 结构化约束：json_schema"));
    }

    #[test]
    fn reading_stats_review_markdown_export_skips_insufficient_persona_section() {
        let response = ReadingStatsAiReviewResponse {
            mode: "monthly".to_string(),
            base_time: 1_725_955_200,
            prompt_version: "reading-stats-review-v2".to_string(),
            input_hash: "hash".to_string(),
            provider_model: None,
            source: BookAiSummarySource::Cache,
            review: ReadingStatsAiReview {
                overview: "样本较少。".to_string(),
                rhythm_insights: vec![],
                preference_insights: vec![],
                focus_items: vec![],
                next_actions: vec![],
                reading_persona: None,
                source_stats: ReadingStatsAiReviewSourceStats {
                    mode: "monthly".to_string(),
                    base_time: 1_725_955_200,
                    read_days: Some(1),
                    total_read_time_seconds: Some(600),
                    day_average_read_time_seconds: Some(600),
                    bucket_count: 1,
                    longest_item_count: 1,
                    category_count: 1,
                },
                generated_at: "100".to_string(),
                prompt_version: "reading-stats-review-v2".to_string(),
                response_format: Some(AiResponseFormatKind::JsonSchema),
                basis_notice: "基于结构化阅读统计生成。".to_string(),
            },
            cached_updated_at: None,
            error_message: None,
        };
        let persona = ReadingPersona {
            status: "insufficient".to_string(),
            code: None,
            label: None,
            display_title: None,
            palette_group: None,
            accent_tone: None,
            basis_notice: "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。".to_string(),
            dimensions: vec![],
            evidence: vec![],
            confidence: None,
            summary: Some("本期阅读样本较少，继续阅读后再生成阅读人格。".to_string()),
            suggestion: None,
        };

        let markdown = serialize_reading_stats_review_markdown(&response, Some(&persona), "130");

        assert!(!markdown.contains("## 阅读人格"));
        assert!(!markdown.contains("## 阅读倾向（临时）"));
    }

    #[test]
    fn reading_route_markdown_export_uses_guide_language() {
        let response = ReadingRouteResponse {
            book_id: "book_deep_work".to_string(),
            scope_id: "book_deep_work".to_string(),
            prompt_version: "reading-route-v2.1".to_string(),
            input_hash: "hash".to_string(),
            provider_model: Some("gpt-4o-mini".to_string()),
            source: BookAiSummarySource::Cache,
            route: ReadingRoute {
                route_overview: "先完成当前书阅读，再做一次可输出的复盘。".to_string(),
                books: vec![ReadingRouteBookStep {
                    book_id: "book_deep_work".to_string(),
                    title: "深度工作".to_string(),
                    author: Some("卡尔".to_string()),
                    order: 1,
                    role: "当前书".to_string(),
                    reading_purpose:
                        "建立稳定长读习惯并完成整书复盘沉淀，避免碎片化阅读影响专注力训练。"
                            .to_string(),
                    estimated_effort: "2 个 45 分钟阅读时段".to_string(),
                    local_status: Some("待复盘".to_string()),
                    basis: "当前进度 42%，优先完成第 2 章到第 3 章的核心方法阅读。".to_string(),
                }],
                dependencies: vec![],
                review_checkpoints: vec![ReadingRouteCheckpoint {
                    timing: "读完第 3 章后".to_string(),
                    question: "哪些干扰最常打断你的深度工作？".to_string(),
                    suggested_output: "写 3 条干扰清单，并为每条补 1 个阻断动作。".to_string(),
                }],
                next_actions: vec![
                    "今天安排 45 分钟读完第 2 章，并标出 3 条可以直接实践的专注规则。".to_string(),
                ],
                reading_stage: None,
                source_stats: ReadingRouteSourceStats {
                    current_book_count: 1,
                    candidate_count: 0,
                    summary_count: 1,
                    stats_signal_count: 0,
                    local_status_count: 1,
                },
                generated_at: "100".to_string(),
                prompt_version: "reading-route-v2.1".to_string(),
                response_format: Some(AiResponseFormatKind::JsonSchema),
                basis_notice: "基于当前书生成。".to_string(),
                feedback_outcome_summary: None,
            },
            cached_updated_at: Some("120".to_string()),
            error_message: None,
        };

        let markdown = serialize_reading_route_markdown(&response, "130");

        assert!(markdown.contains("# 深度工作 阅读指南"));
        assert!(markdown.contains("## 指南总览"));
        assert!(markdown.contains("## 推进任务"));
        assert!(markdown.contains("- 阅读任务：读完第 2 章到第 3 章"));
        assert!(markdown.contains("- 输出：3 条干扰清单，并为每条补 1 个阻断动作"));
        assert!(markdown.contains("- 验收：为每条补 1 个阻断动作。"));
        assert!(markdown.contains("- 今天安排 45 分钟读完第 2 章"));
        assert!(markdown.contains("  - 完成标准：标出 3 条可以直接实践的专注规则。"));
        assert!(!markdown.contains("..."));
        assert!(!markdown.contains("…"));
        assert!(!markdown.contains("阅读路线"));
        assert!(!markdown.contains("路线总览"));
        assert!(!markdown.contains("## 阅读顺序"));
        assert!(markdown.contains("## 数据边界"));
        assert!(markdown.contains("未选择的候选书"));
        assert!(markdown.contains("- 结构化约束：json_schema"));
    }

    #[test]
    fn book_decision_markdown_export_contains_decision_sections() {
        let response = BookDecisionResponse {
            scope_id: "book-a|book-b".to_string(),
            prompt_version: "book-decision-v1".to_string(),
            input_hash: "hash".to_string(),
            provider_model: Some("gpt-4o-mini".to_string()),
            source: BookAiSummarySource::Cache,
            decision: BookDecision {
                decision_overview: "先读深度工作，因为它能承接当前专注主题。".to_string(),
                top_candidates: vec![BookDecisionTopCandidate {
                    book_id: "book-a".to_string(),
                    title: "深度工作".to_string(),
                    author: Some("卡尔".to_string()),
                    rank: 1,
                    why_now: "最近阅读主题仍围绕专注和输出。".to_string(),
                    tradeoff: "比长期大部头启动成本更低。".to_string(),
                    estimated_effort: "2 个 45 分钟阅读时段".to_string(),
                    prerequisite_action: "先读完第 2 章。".to_string(),
                    review_trigger: "读完后写 3 条干扰清单。".to_string(),
                    basis: "候选书与近期主题匹配。".to_string(),
                }],
                deferred_candidates: vec![BookDecisionDeferredCandidate {
                    book_id: "book-b".to_string(),
                    title: "长期主义".to_string(),
                    reason: "当前更适合低启动成本任务。".to_string(),
                }],
                next_actions: vec!["今天安排 45 分钟读第 2 章。".to_string()],
                source_stats: BookDecisionSourceStats {
                    candidate_count: 2,
                    summary_count: 1,
                    stats_signal_count: 1,
                    local_status_count: 2,
                },
                generated_at: "100".to_string(),
                prompt_version: "book-decision-v1".to_string(),
                response_format: Some(AiResponseFormatKind::JsonObject),
                basis_notice: "只基于本地候选和结构化信号生成。".to_string(),
            },
            cached_updated_at: Some("120".to_string()),
            error_message: None,
        };

        let markdown = serialize_book_decision_markdown(&response, "130");

        assert!(markdown.contains("# 深度工作 选书决策"));
        assert!(markdown.contains("## 推荐结论"));
        assert!(markdown.contains("## 推荐顺序"));
        assert!(markdown.contains("### 1. 深度工作"));
        assert!(markdown.contains("- 为什么现在读：最近阅读主题仍围绕专注和输出。"));
        assert!(markdown.contains("## 暂缓项"));
        assert!(markdown.contains("- 长期主义：当前更适合低启动成本任务。"));
        assert!(markdown.contains("## 下一步行动"));
        assert!(markdown.contains("今天安排 45 分钟读第 2 章。"));
        assert!(markdown.contains("## 数据边界"));
        assert!(markdown.contains("输入范围外的书籍推荐"));
        assert!(markdown.contains("## 来源统计"));
        assert!(markdown.contains("- 结构化约束：json_object"));
    }
}
