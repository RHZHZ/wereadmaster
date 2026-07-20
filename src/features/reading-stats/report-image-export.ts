import { exportReportImage } from "../../lib/reading-api";
import {
  blobToDataUrl,
  canvasToPngBlob,
  downloadBlob,
  ensurePngFileName,
  hasTauriRuntime
} from "../../lib/image-artifact-export";

export type ReportImageExportResult = {
  fileName: string;
  path?: string;
  exportedAt?: string;
  source: "album" | "exportDir" | "browserDownload";
};

export async function exportCanvasAsReportImage(
  canvas: HTMLCanvasElement,
  fileName: string,
  errorMessage: string
): Promise<ReportImageExportResult> {
  const blob = await canvasToPngBlob(canvas, errorMessage);
  const pngFileName = ensurePngFileName(fileName);

  if (hasTauriRuntime()) {
    const response = await exportReportImage(
      pngFileName,
      await blobToDataUrl(
        blob,
        "阅读报告图片编码失败。",
        "当前环境不支持阅读报告图片编码。"
      )
    );
    return {
      fileName: response.fileName,
      path: response.path,
      exportedAt: response.exportedAt,
      source: "exportDir"
    };
  }

  downloadBlob(blob, pngFileName);
  return {
    fileName: pngFileName,
    source: "browserDownload"
  };
}
