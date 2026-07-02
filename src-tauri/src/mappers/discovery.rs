use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryBookRecord {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub intro: Option<String>,
    pub category: Option<String>,
    pub publisher: Option<String>,
    pub rating_percent: Option<i64>,
    pub rating_count: Option<i64>,
    pub rating_title: Option<String>,
    pub reading_count: Option<i64>,
    pub soldout: Option<bool>,
    pub search_idx: Option<i64>,
    pub deep_link: Option<String>,
    pub reason: Option<String>,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchGroupRecord {
    pub title: String,
    pub scope: Option<i64>,
    pub scope_count: Option<i64>,
    pub current_count: Option<i64>,
    pub books: Vec<DiscoveryBookRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchBooksRecord {
    pub sid: Option<String>,
    pub scope: i64,
    pub has_more: bool,
    pub next_max_idx: Option<i64>,
    pub groups: Vec<SearchGroupRecord>,
    pub results: Vec<DiscoveryBookRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationRecord {
    pub books: Vec<DiscoveryBookRecord>,
    pub has_more: bool,
    pub next_max_idx: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarBooksRecord {
    pub session_id: Option<String>,
    pub books: Vec<DiscoveryBookRecord>,
    pub has_more: bool,
    pub next_max_idx: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAuthorRecord {
    pub user_vid: Option<String>,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBookRecord {
    pub book_id: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicReviewRecord {
    pub idx: Option<i64>,
    pub review_id: String,
    pub content: String,
    pub html_content: Option<String>,
    pub star: Option<i64>,
    pub star_level: Option<i64>,
    pub is_finish: Option<bool>,
    pub create_time: Option<i64>,
    pub chapter_name: Option<String>,
    pub author: Option<ReviewAuthorRecord>,
    pub book: Option<ReviewBookRecord>,
    #[serde(skip_serializing)]
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicReviewsRecord {
    pub book_id: String,
    pub review_list_type: i64,
    pub total_count: Option<i64>,
    pub recent_total_count: Option<i64>,
    pub has_more: bool,
    pub has_5_star: bool,
    pub has_1_star: bool,
    pub has_recent: bool,
    pub friend_comment_count: Option<i64>,
    pub friend_unique_count: Option<i64>,
    pub synckey: Option<i64>,
    pub next_max_idx: Option<i64>,
    pub reviews: Vec<PublicReviewRecord>,
}

pub fn map_search_books_response(scope: i64, value: &Value) -> SearchBooksRecord {
    let groups = value
        .get("results")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .map(map_search_group)
        .collect::<Vec<_>>();
    let results = groups
        .iter()
        .flat_map(|group| group.books.iter().cloned())
        .collect::<Vec<_>>();
    let next_max_idx = results.iter().filter_map(|book| book.search_idx).max();

    SearchBooksRecord {
        sid: string_field(value, "sid"),
        scope,
        has_more: boolish_field(value, "hasMore"),
        next_max_idx,
        groups,
        results,
    }
}

pub fn map_recommendations_response(value: &Value) -> RecommendationRecord {
    let books = value
        .get("books")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|book| map_discovery_book(book.get("bookInfo").unwrap_or(book), Some(book)))
        .collect::<Vec<_>>();
    let next_max_idx = books.iter().filter_map(|book| book.search_idx).max();

    RecommendationRecord {
        books,
        has_more: boolish_field(value, "hasMore"),
        next_max_idx,
    }
}

pub fn map_similar_books_response(value: &Value) -> SimilarBooksRecord {
    let source = value.get("booksimilar").unwrap_or(value);
    let books = source
        .get("books")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(map_similar_book)
        .collect::<Vec<_>>();
    let next_max_idx = books.iter().filter_map(|book| book.search_idx).max();

    SimilarBooksRecord {
        session_id: string_field(source, "sessionId"),
        books,
        has_more: boolish_field(source, "hasMore") || boolish_field(value, "hasMore"),
        next_max_idx,
    }
}

pub fn map_public_reviews_response(
    book_id: &str,
    review_list_type: i64,
    value: &Value,
) -> PublicReviewsRecord {
    let reviews = value
        .get("reviews")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(map_public_review)
        .collect::<Vec<_>>();
    let next_max_idx = reviews.iter().filter_map(|review| review.idx).max();

    PublicReviewsRecord {
        book_id: book_id.to_string(),
        review_list_type,
        total_count: non_negative_integer_field(value, "reviewsCnt"),
        recent_total_count: non_negative_integer_field(value, "recentTotalCnt"),
        has_more: boolish_field(value, "reviewsHasMore"),
        has_5_star: boolish_field(value, "reviewsHas5Star"),
        has_1_star: boolish_field(value, "reviewsHas1Star"),
        has_recent: boolish_field(value, "reviewsHasRecent"),
        friend_comment_count: non_negative_integer_field(value, "friendCommentCount"),
        friend_unique_count: non_negative_integer_field(value, "friendUniqueCount"),
        synckey: non_negative_integer_field(value, "synckey"),
        next_max_idx,
        reviews,
    }
}

fn map_search_group(value: &Value) -> SearchGroupRecord {
    let books = value
        .get("books")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|book| map_discovery_book(book.get("bookInfo").unwrap_or(book), Some(book)))
        .collect::<Vec<_>>();

    SearchGroupRecord {
        title: string_field(value, "title").unwrap_or_else(|| "搜索结果".to_string()),
        scope: integer_field(value, "scope"),
        scope_count: non_negative_integer_field(value, "scopeCount"),
        current_count: non_negative_integer_field(value, "currentCount"),
        books,
    }
}

fn map_similar_book(value: &Value) -> Option<DiscoveryBookRecord> {
    let book = value
        .get("book")
        .and_then(|book| book.get("bookInfo"))
        .or_else(|| value.get("bookInfo"))
        .unwrap_or(value);
    let mut record = map_discovery_book(book, Some(value))?;

    if record.search_idx.is_none() {
        record.search_idx = non_negative_integer_field(value, "idx");
    }

    Some(record)
}

fn map_discovery_book(value: &Value, wrapper: Option<&Value>) -> Option<DiscoveryBookRecord> {
    let wrapper = wrapper.unwrap_or(value);
    let book_id = string_field(value, "bookId").or_else(|| string_field(wrapper, "bookId"))?;
    let rating_detail = value
        .get("newRatingDetail")
        .or_else(|| wrapper.get("newRatingDetail"))
        .or_else(|| value.get("ratingDetail"))
        .or_else(|| wrapper.get("ratingDetail"));

    Some(DiscoveryBookRecord {
        book_id,
        title: string_field(value, "title").unwrap_or_else(|| "未命名书籍".to_string()),
        author: string_field(value, "author"),
        cover: string_field(value, "cover"),
        intro: string_field(value, "intro"),
        category: string_field(value, "category"),
        publisher: string_field(value, "publisher"),
        rating_percent: first_non_negative_integer_field(
            wrapper,
            value,
            &["newRating", "ratingPercent", "rating"],
        ),
        rating_count: first_non_negative_integer_field(
            wrapper,
            value,
            &["newRatingCount", "ratingCount"],
        ),
        rating_title: rating_detail.and_then(|detail| string_field(detail, "title")),
        reading_count: non_negative_integer_field(wrapper, "readingCount")
            .or_else(|| non_negative_integer_field(value, "readingCount")),
        soldout: value.get("soldout").map(boolish_value),
        search_idx: non_negative_integer_field(wrapper, "searchIdx")
            .or_else(|| non_negative_integer_field(wrapper, "idx")),
        deep_link: string_field(value, "deepLink").or_else(|| string_field(wrapper, "deepLink")),
        reason: string_field(wrapper, "reason").or_else(|| string_field(value, "reason")),
        raw_json: wrapper.to_string(),
    })
}

fn map_public_review(value: &Value) -> Option<PublicReviewRecord> {
    let container = value.get("review").unwrap_or(value);
    let source = container.get("review").unwrap_or(container);
    let review_id = string_field(container, "reviewId")
        .or_else(|| string_field(source, "reviewId"))
        .or_else(|| string_field(value, "reviewId"))?;
    let content =
        string_field(source, "content").or_else(|| string_field(source, "htmlContent"))?;
    let star = integer_field(source, "star").filter(|value| *value >= 0);

    Some(PublicReviewRecord {
        idx: non_negative_integer_field(value, "idx"),
        review_id,
        content,
        html_content: string_field(source, "htmlContent"),
        star,
        star_level: star.map(review_star_level),
        is_finish: source.get("isFinish").map(boolish_value),
        create_time: non_negative_integer_field(source, "createTime"),
        chapter_name: string_field(source, "chapterName"),
        author: source.get("author").map(map_review_author),
        book: source.get("book").map(map_review_book),
        raw_json: value.to_string(),
    })
}

fn map_review_author(value: &Value) -> ReviewAuthorRecord {
    ReviewAuthorRecord {
        user_vid: string_field(value, "userVid"),
        name: string_field(value, "name"),
        avatar: string_field(value, "avatar"),
    }
}

fn map_review_book(value: &Value) -> ReviewBookRecord {
    ReviewBookRecord {
        book_id: string_field(value, "bookId"),
        title: string_field(value, "title"),
        author: string_field(value, "author"),
    }
}

fn review_star_level(star: i64) -> i64 {
    (star / 20).clamp(0, 5)
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

fn first_non_negative_integer_field(wrapper: &Value, value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        non_negative_integer_field(wrapper, key).or_else(|| non_negative_integer_field(value, key))
    })
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
        map_public_reviews_response, map_recommendations_response, map_search_books_response,
        map_similar_books_response,
    };

    #[test]
    fn search_mapper_preserves_groups_and_next_cursor() {
        let record = map_search_books_response(
            0,
            &json!({
                "sid": "s1",
                "hasMore": 1,
                "results": [{
                    "title": "电子书",
                    "scope": 10,
                    "scopeCount": 9,
                    "currentCount": 1,
                    "books": [{
                        "searchIdx": 7,
                        "readingCount": 88,
                        "newRating": 92,
                        "newRatingCount": 1000,
                        "bookInfo": {
                            "bookId": "b1",
                            "title": "书名",
                            "author": "作者",
                            "soldout": 1,
                            "newRatingDetail": { "title": "神作" }
                        }
                    }]
                }]
            }),
        );

        assert_eq!(record.sid, Some("s1".to_string()));
        assert!(record.has_more);
        assert_eq!(record.next_max_idx, Some(7));
        assert_eq!(record.groups[0].scope, Some(10));
        assert_eq!(record.results[0].rating_percent, Some(92));
        assert_eq!(record.results[0].soldout, Some(true));
    }

    #[test]
    fn search_mapper_reads_book_info_deep_link() {
        let record = map_search_books_response(
            10,
            &json!({
                "results": [{
                    "title": "电子书",
                    "books": [{
                        "bookInfo": {
                            "bookId": "b1",
                            "title": "书名",
                            "deepLink": "weread://book/search-result"
                        }
                    }]
                }]
            }),
        );

        assert_eq!(
            record.results[0].deep_link,
            Some("weread://book/search-result".to_string())
        );
    }

    #[test]
    fn recommendation_mapper_reads_reason_and_cursor() {
        let record = map_recommendations_response(&json!({
            "books": [{
                "bookId": "b1",
                "title": "推荐书",
                "reason": "因为你读过相关主题",
                "searchIdx": 12
            }]
        }));

        assert_eq!(record.books.len(), 1);
        assert_eq!(
            record.books[0].reason,
            Some("因为你读过相关主题".to_string())
        );
        assert_eq!(record.next_max_idx, Some(12));
    }

    #[test]
    fn recommendation_mapper_accepts_alternate_rating_fields() {
        let record = map_recommendations_response(&json!({
            "books": [{
                "bookId": "b1",
                "title": "推荐书",
                "rating": 87,
                "ratingCount": 3200,
                "ratingDetail": { "title": "力荐" }
            }]
        }));

        assert_eq!(record.books[0].rating_percent, Some(87));
        assert_eq!(record.books[0].rating_count, Some(3200));
        assert_eq!(record.books[0].rating_title, Some("力荐".to_string()));
    }

    #[test]
    fn recommendation_mapper_reads_rating_from_book_info() {
        let record = map_recommendations_response(&json!({
            "books": [{
                "reason": "你读过相近主题",
                "bookInfo": {
                    "bookId": "b1",
                    "title": "推荐书",
                    "newRating": 91,
                    "newRatingCount": 9800,
                    "newRatingDetail": { "title": "神作" }
                }
            }]
        }));

        assert_eq!(record.books[0].rating_percent, Some(91));
        assert_eq!(record.books[0].rating_count, Some(9800));
        assert_eq!(record.books[0].rating_title, Some("神作".to_string()));
        assert_eq!(record.books[0].reason, Some("你读过相近主题".to_string()));
    }

    #[test]
    fn similar_mapper_reads_session_and_nested_book_info() {
        let record = map_similar_books_response(&json!({
            "booksimilar": {
                "sessionId": "session-1",
                "books": [{
                    "idx": 5,
                    "book": {
                        "bookInfo": {
                            "bookId": "b2",
                            "title": "相似书",
                            "author": "作者"
                        }
                    }
                }]
            }
        }));

        assert_eq!(record.session_id, Some("session-1".to_string()));
        assert_eq!(record.books[0].book_id, "b2");
        assert_eq!(record.next_max_idx, Some(5));
    }

    #[test]
    fn public_reviews_mapper_converts_star_to_level() {
        let record = map_public_reviews_response(
            "b1",
            1,
            &json!({
                "reviewsCnt": 10,
                "reviewsHasMore": 1,
                "synckey": 100,
                "reviews": [{
                    "idx": 3,
                    "review": {
                        "reviewId": "r1",
                        "review": {
                            "content": "很好",
                            "star": 100,
                            "isFinish": 1,
                            "author": { "userVid": "u1", "name": "读者" },
                            "book": { "bookId": "b1", "title": "书名" }
                        }
                    }
                }]
            }),
        );

        assert!(record.has_more);
        assert_eq!(record.synckey, Some(100));
        assert_eq!(record.next_max_idx, Some(3));
        assert_eq!(record.reviews[0].star_level, Some(5));
        assert_eq!(
            record.reviews[0]
                .author
                .as_ref()
                .and_then(|author| author.name.clone()),
            Some("读者".to_string())
        );
    }
}
