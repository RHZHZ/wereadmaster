use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(mobile)]
use tauri::plugin::mobile::PluginInvokeError;
#[cfg(mobile)]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.imageartifactmobile";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_image_artifact_mobile);

type Result<T> = std::result::Result<T, ImageArtifactCommandError>;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArtifactCapabilities {
    can_save_to_album: bool,
    can_share_image: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArtifactPayload {
    file_name: String,
    png_data_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArtifactDeliveryResult {
    file_name: String,
    source: String,
    cancelled: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArtifactCommandError {
    code: String,
    message: String,
    detail: Option<String>,
}

impl ImageArtifactCommandError {
    fn unavailable() -> Self {
        Self {
            code: "image_artifact_mobile_unavailable".to_string(),
            message: "当前环境不支持原生图片保存或分享。".to_string(),
            detail: None,
        }
    }

    #[cfg(mobile)]
    fn native_failed(error: PluginInvokeError) -> Self {
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                code: response
                    .code
                    .unwrap_or_else(|| "image_artifact_native_failed".to_string()),
                message: response
                    .message
                    .unwrap_or_else(|| "原生图片能力调用失败。".to_string()),
                detail: None,
            },
            other => Self {
                code: "image_artifact_native_failed".to_string(),
                message: "原生图片能力调用失败。".to_string(),
                detail: Some(other.to_string()),
            },
        }
    }
}

pub struct ImageArtifactMobile<R: Runtime> {
    #[cfg(mobile)]
    mobile_plugin_handle: Option<PluginHandle<R>>,
    #[cfg(not(mobile))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> ImageArtifactMobile<R> {
    fn unavailable() -> Self {
        Self {
            #[cfg(mobile)]
            mobile_plugin_handle: None,
            #[cfg(not(mobile))]
            _marker: std::marker::PhantomData,
        }
    }

    #[cfg(mobile)]
    fn mobile(handle: PluginHandle<R>) -> Self {
        Self {
            mobile_plugin_handle: Some(handle),
        }
    }

    #[cfg(mobile)]
    fn mobile_handle(&self) -> Result<&PluginHandle<R>> {
        self.mobile_plugin_handle
            .as_ref()
            .ok_or_else(ImageArtifactCommandError::unavailable)
    }

    fn run_mobile<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        #[cfg(mobile)]
        {
            return self
                .mobile_handle()?
                .run_mobile_plugin(command, payload)
                .map_err(ImageArtifactCommandError::native_failed);
        }

        #[cfg(not(mobile))]
        {
            let _ = (command, payload);
            Err(ImageArtifactCommandError::unavailable())
        }
    }
}

pub trait ImageArtifactMobileExt<R: Runtime> {
    fn image_artifact_mobile(&self) -> &ImageArtifactMobile<R>;
}

impl<R: Runtime, T: Manager<R>> ImageArtifactMobileExt<R> for T {
    fn image_artifact_mobile(&self) -> &ImageArtifactMobile<R> {
        self.state::<ImageArtifactMobile<R>>().inner()
    }
}

#[tauri::command]
fn get_capabilities<R: Runtime>(app: tauri::AppHandle<R>) -> Result<ImageArtifactCapabilities> {
    app.image_artifact_mobile()
        .run_mobile("getCapabilities", serde_json::json!({}))
}

#[tauri::command]
fn save_image_to_album<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
    png_data_url: String,
) -> Result<ImageArtifactDeliveryResult> {
    app.image_artifact_mobile().run_mobile(
        "saveImageToAlbum",
        ImageArtifactPayload {
            file_name,
            png_data_url,
        },
    )
}

#[tauri::command]
fn share_image<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
    png_data_url: String,
) -> Result<ImageArtifactDeliveryResult> {
    app.image_artifact_mobile().run_mobile(
        "shareImage",
        ImageArtifactPayload {
            file_name,
            png_data_url,
        },
    )
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("image-artifact-mobile")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin(PLUGIN_IDENTIFIER, "ImageArtifactMobilePlugin")?;
                app.manage(ImageArtifactMobile::mobile(handle));
            }

            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_image_artifact_mobile)?;
                app.manage(ImageArtifactMobile::mobile(handle));
            }

            #[cfg(not(mobile))]
            app.manage(ImageArtifactMobile::<R>::unavailable());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_capabilities,
            save_image_to_album,
            share_image,
        ])
        .build()
}
