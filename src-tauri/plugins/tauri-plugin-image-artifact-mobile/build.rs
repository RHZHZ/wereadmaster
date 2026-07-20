const COMMANDS: &[&str] = &["get_capabilities", "save_image_to_album", "share_image"];

const ANDROID_FILE_PROVIDER_BLOCK: &str = r#"<provider
  android:name="androidx.core.content.FileProvider"
  android:authorities="${applicationId}.fileprovider"
  android:exported="false"
  android:grantUriPermissions="true">
  <meta-data
    android:name="android.support.FILE_PROVIDER_PATHS"
    android:resource="@xml/file_paths" />
</provider>"#;

const ANDROID_FILE_PATHS_XML: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<!-- image-artifact-mobile-file-paths. AUTO-GENERATED. DO NOT REMOVE. Source: tauri-plugin-image-artifact-mobile/build.rs -->
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <cache-path name="image_artifacts" path="image-artifacts/" />
</paths>
"#;

#[cfg(target_os = "macos")]
const IOS_PHOTO_LIBRARY_ADD_USAGE_DESCRIPTION: &str =
    "用于将你生成的阅读报告或笔记图片保存到相册。";

#[cfg(target_os = "macos")]
const IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION: &str =
    "用于在旧版 iOS 上将你生成的阅读报告或笔记图片保存到相册。";

fn main() {
    ensure_android_app_configuration();
    ensure_ios_info_plist_configuration();

    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}

fn ensure_android_app_configuration() {
    println!("cargo:rerun-if-env-changed=TAURI_ANDROID_PROJECT_PATH");

    let Some(project_path) =
        std::env::var_os("TAURI_ANDROID_PROJECT_PATH").map(std::path::PathBuf::from)
    else {
        return;
    };

    let manifest_path = project_path
        .join("app")
        .join("src")
        .join("main")
        .join("AndroidManifest.xml");
    let file_paths = project_path
        .join("app")
        .join("src")
        .join("main")
        .join("res")
        .join("xml")
        .join("file_paths.xml");

    println!("cargo:rerun-if-changed={}", manifest_path.display());
    println!("cargo:rerun-if-changed={}", file_paths.display());

    if let Err(error) = tauri_plugin::mobile::update_android_manifest(
        "image-artifact-mobile-file-provider",
        "application",
        ANDROID_FILE_PROVIDER_BLOCK.to_string(),
    ) {
        panic!("failed to update Android manifest for image artifact sharing: {error}");
    }

    if let Some(parent) = file_paths.parent() {
        std::fs::create_dir_all(parent)
            .expect("failed to create Android image artifact FileProvider resource directory");
    }

    let existing = std::fs::read_to_string(&file_paths).ok();
    if existing.as_deref() != Some(ANDROID_FILE_PATHS_XML) {
        std::fs::write(&file_paths, ANDROID_FILE_PATHS_XML)
            .expect("failed to write Android image artifact FileProvider paths");
    }
}

#[cfg(target_os = "macos")]
fn ensure_ios_info_plist_configuration() {
    println!("cargo:rerun-if-env-changed=TAURI_IOS_PROJECT_PATH");
    println!("cargo:rerun-if-env-changed=TAURI_IOS_APP_NAME");

    if let Err(error) = tauri_plugin::mobile::update_info_plist(|info_plist| {
        insert_ios_usage_description(
            info_plist,
            "NSPhotoLibraryAddUsageDescription",
            IOS_PHOTO_LIBRARY_ADD_USAGE_DESCRIPTION,
        );
        insert_ios_usage_description(
            info_plist,
            "NSPhotoLibraryUsageDescription",
            IOS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
        );
    }) {
        panic!("failed to update iOS Info.plist for image artifact album saving: {error}");
    }
}

#[cfg(target_os = "macos")]
fn insert_ios_usage_description(info_plist: &mut plist::Dictionary, key: &str, description: &str) {
    info_plist
        .entry(key.to_string())
        .or_insert_with(|| plist::Value::String(description.to_string()));
}

#[cfg(not(target_os = "macos"))]
fn ensure_ios_info_plist_configuration() {}
