//! 微信读书 Web 链接工具。
//!
//! 微信读书网页端（weread.qq.com/web/bookDetail、/web/reader）不接受原始
//! bookId，需要先做一次公开已知的 hash 变换。该变换依赖 MD5；为避免引入
//! 额外依赖，本模块内置一份 RFC 1321 的最小实现，仅用于生成链接。

/// 由真实 bookId 生成微信读书 Web 书籍详情页链接。
/// `local*` / `preview-*` 等本地伪 ID 返回 None，避免生成伪链接。
pub fn weread_book_detail_url(book_id: &str) -> Option<String> {
    let book_id = book_id.trim();
    if book_id.is_empty() || book_id.starts_with("local") || book_id.starts_with("preview-") {
        return None;
    }
    Some(format!(
        "https://weread.qq.com/web/bookDetail/{}",
        weread_book_hash(book_id)
    ))
}

/// 微信读书 bookId -> Web book hash（社区通用的 calcBookStrId 变换）。
fn weread_book_hash(book_id: &str) -> String {
    let digest = md5_hex(book_id.as_bytes());
    let mut result = digest[0..3].to_string();
    let (code, transformed) = transform_book_id(book_id);
    result.push_str(code);
    result.push('2');
    result.push_str(&digest[digest.len() - 2..]);
    for (index, part) in transformed.iter().enumerate() {
        let mut length_hex = format!("{:x}", part.len());
        if length_hex.len() == 1 {
            length_hex.insert(0, '0');
        }
        result.push_str(&length_hex);
        result.push_str(part);
        if index < transformed.len() - 1 {
            result.push('g');
        }
    }
    if result.len() < 20 {
        result.push_str(&digest[0..20 - result.len()]);
    }
    let checksum = md5_hex(result.as_bytes());
    result.push_str(&checksum[0..3]);
    result
}

fn transform_book_id(book_id: &str) -> (&'static str, Vec<String>) {
    if book_id.bytes().all(|byte| byte.is_ascii_digit()) {
        let mut parts = Vec::new();
        let bytes = book_id.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            let end = (index + 9).min(bytes.len());
            let value = book_id[index..end].parse::<u64>().unwrap_or(0);
            parts.push(format!("{value:x}"));
            index = end;
        }
        ("3", parts)
    } else {
        let hex = book_id
            .chars()
            .map(|character| format!("{:x}", character as u32))
            .collect::<String>();
        ("4", vec![hex])
    }
}

/// RFC 1321 MD5，输出小写十六进制。仅用于链接 hash，不用于任何安全场景。
fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    let mut message = input.to_vec();
    let bit_length = (input.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_le_bytes());

    for chunk in message.chunks(64) {
        let mut words = [0u32; 16];
        for (index, word) in words.iter_mut().enumerate() {
            *word = u32::from_le_bytes([
                chunk[4 * index],
                chunk[4 * index + 1],
                chunk[4 * index + 2],
                chunk[4 * index + 3],
            ]);
        }
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for round in 0..64 {
            let (f, g) = match round / 16 {
                0 => ((b & c) | (!b & d), round),
                1 => ((d & b) | (!d & c), (5 * round + 1) % 16),
                2 => (b ^ c ^ d, (3 * round + 5) % 16),
                _ => (c ^ (b | !d), (7 * round) % 16),
            };
            let rotated = a
                .wrapping_add(f)
                .wrapping_add(K[round])
                .wrapping_add(words[g])
                .rotate_left(S[round]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut output = String::with_capacity(32);
    for value in [a0, b0, c0, d0] {
        for byte in value.to_le_bytes() {
            output.push_str(&format!("{byte:02x}"));
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{md5_hex, weread_book_detail_url, weread_book_hash};

    #[test]
    fn md5_matches_reference_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex(b"book-1"), "834feba16ee53314277b995adfd0538c");
    }

    #[test]
    fn book_hash_matches_weread_web_examples() {
        // 与微信读书网页端实际链接一致的公开样例（如《人生》813420）。
        assert_eq!(weread_book_hash("813420"), "97632f805c696c9763e21c8");
        assert_eq!(weread_book_hash("26224578"), "49432a00719027c2494c108");
        assert_eq!(weread_book_hash("3300028078"), "c5c32170813ab7177g0181ae");
        assert_eq!(
            weread_book_hash("12345678901234567890"),
            "fd832710775bcd15g06bc614eg025a1f7"
        );
        assert_eq!(weread_book_hash("book-1"), "834428c0c626f6f6b2d31458");
        assert_eq!(
            weread_book_hash("CB_abc123"),
            "d0a42201243425f616263313233122"
        );
    }

    #[test]
    fn local_and_preview_ids_do_not_get_urls() {
        assert_eq!(weread_book_detail_url("local-1"), None);
        assert_eq!(weread_book_detail_url("preview-9"), None);
        assert_eq!(weread_book_detail_url("  "), None);
        assert_eq!(
            weread_book_detail_url("813420").as_deref(),
            Some("https://weread.qq.com/web/bookDetail/97632f805c696c9763e21c8")
        );
    }
}
