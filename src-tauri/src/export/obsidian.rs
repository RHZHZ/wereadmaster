use std::{
    fs,
    path::{Path, PathBuf},
};

use reqwest::Client;

use crate::services::settings::ObsidianAttachmentMode;

use super::document::ExportDocument;

const OBSIDIAN_EXPORT_DIR: &str = "wxreadmaster/书籍笔记";
const CENTRAL_ASSETS_DIR: &str = "wxreadmaster/assets";
const COVER_DOWNLOAD_TIMEOUT_SECONDS: u64 = 30;

#[derive(Debug, Clone)]
pub struct ObsidianExportOptions {
    pub vault_dir: PathBuf,
    pub attachment_mode: ObsidianAttachmentMode,
}

#[derive(Debug, Clone)]
pub struct ObsidianExportOutput {
    pub path: PathBuf,
    pub file_count: usize,
    pub warning: Option<String>,
}

pub async fn export_document(
    document: &ExportDocument,
    markdown: &str,
    file_stem: &str,
    options: &ObsidianExportOptions,
) -> Result<ObsidianExportOutput, String> {
    validate_vault_directory(&options.vault_dir)?;

    let notes_dir = options.vault_dir.join(OBSIDIAN_EXPORT_DIR);
    fs::create_dir_all(&notes_dir).map_err(|error| error.to_string())?;
    let note_path = notes_dir.join(format!("{file_stem}.md"));

    let (markdown, cover_written, warning) = match document
        .cover
        .as_ref()
        .and_then(|asset| asset.remote_url.as_deref())
    {
        Some(cover_url) => match materialize_cover(
            cover_url,
            file_stem,
            &notes_dir,
            &options.vault_dir,
            options.attachment_mode,
        )
        .await
        {
            Ok((cover_path, relative_reference)) => (
                replace_cover_reference(markdown, cover_url, &relative_reference),
                Some(cover_path),
                None,
            ),
            Err(error) => (
                markdown.to_string(),
                None,
                Some(format!("封面本地化失败，已保留远程图片：{error}")),
            ),
        },
        None => (markdown.to_string(), None, None),
    };

    fs::write(&note_path, markdown).map_err(|error| error.to_string())?;

    Ok(ObsidianExportOutput {
        path: note_path,
        file_count: 1 + usize::from(cover_written.is_some()),
        warning,
    })
}

fn validate_vault_directory(vault_dir: &Path) -> Result<(), String> {
    if !vault_dir.is_dir() {
        return Err("Obsidian Vault 路径不存在或不是文件夹。".to_string());
    }

    let probe_path = vault_dir.join(".wxreadmaster-write-test");
    fs::write(&probe_path, b"write-test").map_err(|error| error.to_string())?;
    fs::remove_file(probe_path).map_err(|error| error.to_string())
}

async fn materialize_cover(
    cover_url: &str,
    file_stem: &str,
    notes_dir: &Path,
    vault_dir: &Path,
    attachment_mode: ObsidianAttachmentMode,
) -> Result<(PathBuf, String), String> {
    let response = Client::new()
        .get(cover_url)
        .timeout(std::time::Duration::from_secs(
            COVER_DOWNLOAD_TIMEOUT_SECONDS,
        ))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("封面地址返回 HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let extension = cover_extension(cover_url, content_type.as_deref());
    let assets_dir = match attachment_mode {
        ObsidianAttachmentMode::SiblingAssets => notes_dir.join(format!("{file_stem}.assets")),
        ObsidianAttachmentMode::CentralAssets => vault_dir.join(CENTRAL_ASSETS_DIR),
    };
    fs::create_dir_all(&assets_dir).map_err(|error| error.to_string())?;

    let cover_path = assets_dir.join(format!("{file_stem}-cover.{extension}"));
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    fs::write(&cover_path, bytes).map_err(|error| error.to_string())?;

    let relative = relative_path(notes_dir, &cover_path)
        .ok_or_else(|| "无法生成 Obsidian 封面相对路径。".to_string())?;
    Ok((cover_path, relative.to_string_lossy().replace('\\', "/")))
}

fn cover_extension(url: &str, content_type: Option<&str>) -> &'static str {
    match content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
    {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/jpeg" => "jpg",
        _ if url.to_ascii_lowercase().contains(".png") => "png",
        _ if url.to_ascii_lowercase().contains(".webp") => "webp",
        _ if url.to_ascii_lowercase().contains(".gif") => "gif",
        _ => "jpg",
    }
}

fn replace_cover_reference(markdown: &str, remote_url: &str, relative_path: &str) -> String {
    markdown.replace(
        &format!("![封面]({remote_url})"),
        &format!("![封面]({relative_path})"),
    )
}

fn relative_path(from_dir: &Path, target: &Path) -> Option<PathBuf> {
    let from = from_dir.components().collect::<Vec<_>>();
    let target = target.components().collect::<Vec<_>>();
    let common = from
        .iter()
        .zip(target.iter())
        .take_while(|(left, right)| left == right)
        .count();
    if common == 0 {
        return None;
    }

    let mut relative = PathBuf::new();
    for _ in common..from.len() {
        relative.push("..");
    }
    for component in &target[common..] {
        relative.push(component.as_os_str());
    }
    Some(relative)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{cover_extension, relative_path, replace_cover_reference};

    #[test]
    fn cover_reference_uses_relative_obsidian_path() {
        let markdown = "![封面](https://example.com/cover.jpg)";
        assert_eq!(
            replace_cover_reference(
                markdown,
                "https://example.com/cover.jpg",
                "book.assets/cover.jpg"
            ),
            "![封面](book.assets/cover.jpg)"
        );
    }

    #[test]
    fn relative_path_supports_central_assets_directory() {
        let value = relative_path(
            Path::new("C:/vault/wxreadmaster/书籍笔记"),
            Path::new("C:/vault/wxreadmaster/assets/cover.png"),
        )
        .expect("relative path");
        assert_eq!(
            value.to_string_lossy().replace('\\', "/"),
            "../assets/cover.png"
        );
    }

    #[test]
    fn cover_extension_prefers_content_type() {
        assert_eq!(
            cover_extension("https://example.com/cover", Some("image/webp")),
            "webp"
        );
        assert_eq!(
            cover_extension("https://example.com/cover.png", None),
            "png"
        );
    }
}
