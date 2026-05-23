export type ExportErrorKind =
  | "directory_unwritable"
  | "path_missing"
  | "file_in_use"
  | "serialization_failed"
  | "permission_denied"
  | "unknown";

export type ExportErrorDescriptor = {
  kind: ExportErrorKind;
  title: string;
  summary: string;
  recoveryHint: string;
};

const EXPORT_ERROR_DESCRIPTORS: Record<ExportErrorKind, ExportErrorDescriptor> = {
  directory_unwritable: {
    kind: "directory_unwritable",
    title: "导出目录不可写",
    summary: "当前导出目录暂时无法写入文件。",
    recoveryHint: "请检查导出目录是否存在、是否有写入权限，或稍后重试。"
  },
  path_missing: {
    kind: "path_missing",
    title: "导出目录不可用",
    summary: "当前导出目录不存在，或目标路径已经失效。",
    recoveryHint: "请返回设置检查导出保存位置，确认目录仍然有效。"
  },
  file_in_use: {
    kind: "file_in_use",
    title: "导出文件被占用",
    summary: "目标文件或目录中的文件正被其他程序使用。",
    recoveryHint: "请关闭正在占用该文件的编辑器或同步工具后重试。"
  },
  serialization_failed: {
    kind: "serialization_failed",
    title: "导出内容生成失败",
    summary: "本地 Markdown 内容在写入前生成失败。",
    recoveryHint: "请返回选择范围后重试；如果持续失败，再检查该复盘缓存内容。"
  },
  permission_denied: {
    kind: "permission_denied",
    title: "没有导出权限",
    summary: "当前环境拒绝本次导出写入。",
    recoveryHint: "请确认应用对目标目录有访问权限，或改用其他导出位置。"
  },
  unknown: {
    kind: "unknown",
    title: "导出失败",
    summary: "本次导出没有完成。",
    recoveryHint: "可以先直接重试；如果仍然失败，再返回设置或重新选择导出范围。"
  }
};

export function classifyExportError(message: string): ExportErrorDescriptor {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("not writable") ||
    normalized.includes("不可写") ||
    normalized.includes("写入失败") ||
    normalized.includes("failed to write")
  ) {
    return EXPORT_ERROR_DESCRIPTORS.directory_unwritable;
  }

  if (
    normalized.includes("not found") ||
    normalized.includes("不存在") ||
    normalized.includes("路径失效") ||
    normalized.includes("no such file") ||
    normalized.includes("directory does not exist")
  ) {
    return EXPORT_ERROR_DESCRIPTORS.path_missing;
  }

  if (
    normalized.includes("being used") ||
    normalized.includes("used by another process") ||
    normalized.includes("被占用") ||
    normalized.includes("另一个程序")
  ) {
    return EXPORT_ERROR_DESCRIPTORS.file_in_use;
  }

  if (
    normalized.includes("serialize") ||
    normalized.includes("serialization") ||
    normalized.includes("序列化") ||
    normalized.includes("markdown")
  ) {
    return EXPORT_ERROR_DESCRIPTORS.serialization_failed;
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("access is denied") ||
    normalized.includes("无权限") ||
    normalized.includes("权限")
  ) {
    return EXPORT_ERROR_DESCRIPTORS.permission_denied;
  }

  return EXPORT_ERROR_DESCRIPTORS.unknown;
}
