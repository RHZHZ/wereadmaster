use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WereadSourceLocation {
    pub book_id: String,
    pub chapter_uid: Option<i64>,
    pub range: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WereadSourcePrecision {
    Range,
    Chapter,
    Book,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WereadSourceLink {
    pub deep_link: String,
    pub precision: WereadSourcePrecision,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWereadSourceResult {
    pub opened: bool,
    pub deep_link: String,
    pub precision: WereadSourcePrecision,
    pub warning: Option<String>,
}

pub fn normalize_book_id(book_id: &str) -> Result<String, AppError> {
    let trimmed = book_id.trim();

    if trimmed.is_empty() {
        return Err(AppError::InvalidPayload("bookId 不能为空。".to_string()));
    }

    if trimmed.len() > 128 {
        return Err(AppError::InvalidPayload(
            "bookId 长度不能超过 128 个字符。".to_string(),
        ));
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(AppError::InvalidPayload(
            "bookId 只能包含字母、数字、下划线或连字符。".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

pub fn build_weread_reading_link(
    book_id: &str,
    chapter_uid: Option<i64>,
) -> Result<String, AppError> {
    let normalized_book_id = normalize_book_id(book_id)?;
    validate_chapter_uid(chapter_uid)?;

    Ok(match chapter_uid {
        Some(uid) => {
            format!("weread://reading?bId={normalized_book_id}&chapterUid={uid}")
        }
        None => format!("weread://reading?bId={normalized_book_id}"),
    })
}

pub fn build_weread_source_link(
    book_id: &str,
    chapter_uid: Option<i64>,
    range: Option<&str>,
) -> Result<WereadSourceLink, AppError> {
    let normalized_book_id = normalize_book_id(book_id)?;
    validate_chapter_uid(chapter_uid)?;

    if let (Some(uid), Some(raw_range)) = (chapter_uid, range) {
        if let Some((range_start, range_end)) = parse_range_bounds(raw_range) {
            return Ok(WereadSourceLink {
                deep_link: format!(
                    "weread://bestbookmark?bookId={normalized_book_id}&chapterUid={uid}&rangeStart={range_start}&rangeEnd={range_end}"
                ),
                precision: WereadSourcePrecision::Range,
                warning: None,
            });
        }
    }

    let had_invalid_range = range.is_some_and(|value| parse_range_bounds(value).is_none());
    let (deep_link, precision, warning) = match chapter_uid {
        Some(uid) => (
            format!("weread://reading?bId={normalized_book_id}&chapterUid={uid}"),
            WereadSourcePrecision::Chapter,
            had_invalid_range.then(|| "原文范围无效，已降级为章节定位。".to_string()),
        ),
        None => (
            format!("weread://reading?bId={normalized_book_id}"),
            WereadSourcePrecision::Book,
            range.map(|_| "缺少章节信息，已降级为书籍定位。".to_string()),
        ),
    };

    Ok(WereadSourceLink {
        deep_link,
        precision,
        warning,
    })
}

pub fn open_weread_source(
    location: WereadSourceLocation,
) -> Result<OpenWereadSourceResult, AppError> {
    let source_link = build_weread_source_link(
        &location.book_id,
        location.chapter_uid,
        location.range.as_deref(),
    )?;
    let open_result = open_deep_link(&source_link.deep_link);
    let warning = merge_warnings(source_link.warning, open_result.as_ref().err().cloned());

    Ok(OpenWereadSourceResult {
        opened: open_result.is_ok(),
        deep_link: source_link.deep_link,
        precision: source_link.precision,
        warning,
    })
}

fn validate_chapter_uid(chapter_uid: Option<i64>) -> Result<(), AppError> {
    if chapter_uid.is_some_and(|uid| uid < 0) {
        return Err(AppError::InvalidPayload(
            "chapterUid 必须是非负整数。".to_string(),
        ));
    }

    Ok(())
}

fn parse_range_bounds(range: &str) -> Option<(u64, u64)> {
    let numbers = range
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(2)
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;

    let [range_start, range_end] = numbers.as_slice() else {
        return None;
    };

    (*range_end > *range_start).then_some((*range_start, *range_end))
}

fn merge_warnings(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) => Some(format!("{first} {second}")),
        (Some(warning), None) | (None, Some(warning)) => Some(warning),
        (None, None) => None,
    }
}

#[cfg(target_os = "windows")]
pub fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", deep_link])
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(target_os = "macos")]
pub fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(deep_link)
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(target_os = "linux")]
pub fn open_deep_link(deep_link: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(deep_link)
        .status()
        .map_err(|_| "无法打开微信读书，请确认已安装微信读书客户端。".to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法打开微信读书，请确认已安装微信读书客户端。".to_string())
            }
        })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn open_deep_link(_deep_link: &str) -> Result<(), String> {
    Err("当前系统暂不支持自动打开微信读书。".to_string())
}

#[cfg(test)]
mod tests {
    use super::{build_weread_source_link, normalize_book_id, WereadSourcePrecision};

    #[test]
    fn builds_range_source_link_when_location_is_complete() {
        let result = build_weread_source_link("book_1", Some(28), Some("659-705"))
            .expect("complete location should build");

        assert_eq!(result.precision, WereadSourcePrecision::Range);
        assert_eq!(
            result.deep_link,
            "weread://bestbookmark?bookId=book_1&chapterUid=28&rangeStart=659&rangeEnd=705"
        );
        assert_eq!(result.warning, None);
    }

    #[test]
    fn extracts_range_bounds_from_decorated_text() {
        let result =
            build_weread_source_link("book-1", Some(2), Some("rangeStart=120&rangeEnd=160"))
                .expect("decorated range should build");

        assert_eq!(result.precision, WereadSourcePrecision::Range);
        assert!(result.deep_link.contains("rangeStart=120&rangeEnd=160"));
    }

    #[test]
    fn invalid_range_degrades_to_chapter_with_warning() {
        let result = build_weread_source_link("book1", Some(7), Some("160-120"))
            .expect("invalid range should degrade");

        assert_eq!(result.precision, WereadSourcePrecision::Chapter);
        assert_eq!(result.deep_link, "weread://reading?bId=book1&chapterUid=7");
        assert_eq!(
            result.warning.as_deref(),
            Some("原文范围无效，已降级为章节定位。")
        );
    }

    #[test]
    fn missing_chapter_degrades_to_book() {
        let result = build_weread_source_link("book1", None, Some("120-160"))
            .expect("missing chapter should degrade");

        assert_eq!(result.precision, WereadSourcePrecision::Book);
        assert_eq!(result.deep_link, "weread://reading?bId=book1");
        assert_eq!(
            result.warning.as_deref(),
            Some("缺少章节信息，已降级为书籍定位。")
        );
    }

    #[test]
    fn missing_range_uses_chapter_without_warning() {
        let result = build_weread_source_link("book1", Some(7), None)
            .expect("chapter location should build");

        assert_eq!(result.precision, WereadSourcePrecision::Chapter);
        assert_eq!(result.warning, None);
    }

    #[test]
    fn rejects_empty_or_unsafe_book_id() {
        assert!(normalize_book_id(" ").is_err());
        assert!(normalize_book_id("book/1").is_err());
        assert!(normalize_book_id(&"a".repeat(129)).is_err());
    }

    #[test]
    fn rejects_negative_chapter_uid() {
        assert!(build_weread_source_link("book1", Some(-1), Some("120-160")).is_err());
    }
}
