import { exportReportImage } from "../../lib/reading-api";

export type ReportImageExportResult = {
  fileName: string;
  path?: string;
  exportedAt?: string;
  source: "exportDir" | "browserDownload";
};

export async function exportCanvasAsReportImage(
  canvas: HTMLCanvasElement,
  fileName: string,
  errorMessage: string
): Promise<ReportImageExportResult> {
  const blob = await canvasToPngBlob(canvas, errorMessage);
  const pngFileName = ensurePngFileName(fileName);

  if (hasTauriRuntime()) {
    const response = await exportReportImage(pngFileName, await blobToDataUrl(blob));
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

function canvasToPngBlob(canvas: HTMLCanvasElement, errorMessage: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error(errorMessage));
    }, "image/png");
  });
}

function ensurePngFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "reading-report.png";
  }

  return trimmed.toLowerCase().endsWith(".png") ? trimmed : `${trimmed}.png`;
}

function hasTauriRuntime(): boolean {
  const runtime = globalThis as Record<string, unknown>;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error("阅读报告图片编码失败。"));
      };
      reader.onerror = () => reject(new Error("阅读报告图片编码失败。"));
      reader.readAsDataURL(blob);
    });
  }

  if (typeof btoa !== "function") {
    throw new Error("当前环境不支持阅读报告图片编码。");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }

  return `data:${blob.type || "image/png"};base64,${btoa(chunks.join(""))}`;
}
