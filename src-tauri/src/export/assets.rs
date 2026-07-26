use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportAssetKind {
    Cover,
    InlineImage,
    Attachment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportAsset {
    pub kind: ExportAssetKind,
    pub remote_url: Option<String>,
    pub local_path: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}
