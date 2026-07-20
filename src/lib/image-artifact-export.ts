import { invoke } from "@tauri-apps/api/core";

export function hasTauriRuntime(): boolean {
  const runtime = globalThis as Record<string, unknown>;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}

export type ImageArtifactCapabilities = {
  canSaveToAlbum: boolean;
  canShareImage: boolean;
  canExportFile: boolean;
  canBrowserDownload: boolean;
};

export type ImageArtifactDeliveryResult = {
  fileName: string;
  source: "album" | "shareSheet" | "browserDownload";
  cancelled?: boolean;
};

type ImageArtifactNativeCapabilitiesResponse = {
  canSaveToAlbum?: unknown;
  canShareImage?: unknown;
};

type ImageArtifactNativeDeliveryResponse = {
  fileName?: unknown;
  source?: unknown;
  cancelled?: unknown;
};

const IMAGE_ARTIFACT_MOBILE_PLUGIN = "plugin:image-artifact-mobile";

export function getImageArtifactCapabilities(): ImageArtifactCapabilities {
  return {
    canSaveToAlbum: false,
    canShareImage: isNativeMobileTauriRuntime() || canShareImageFiles(),
    canExportFile: hasTauriRuntime(),
    canBrowserDownload: typeof document !== "undefined"
  };
}

export async function resolveImageArtifactCapabilities(): Promise<ImageArtifactCapabilities> {
  const fallback = getImageArtifactCapabilities();
  if (!isNativeMobileTauriRuntime()) {
    return fallback;
  }

  try {
    const response = await invokeImageArtifactNativeCommand<ImageArtifactNativeCapabilitiesResponse>(
      "get_capabilities"
    );

    return {
      ...fallback,
      canSaveToAlbum: Boolean(response.canSaveToAlbum),
      canShareImage: Boolean(response.canShareImage) || fallback.canShareImage
    };
  } catch {
    return fallback;
  }
}

export async function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  errorMessage: string
): Promise<Blob> {
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

export function ensurePngFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "reading-report.png";
  }

  return trimmed.toLowerCase().endsWith(".png") ? trimmed : `${trimmed}.png`;
}

export async function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  fileName: string,
  errorMessage: string
): Promise<string> {
  const blob = await canvasToPngBlob(canvas, errorMessage);
  const pngFileName = ensurePngFileName(fileName);
  downloadBlob(blob, pngFileName);
  return pngFileName;
}

export async function shareCanvasAsPng(
  canvas: HTMLCanvasElement,
  fileName: string,
  errorMessage: string
): Promise<ImageArtifactDeliveryResult> {
  const blob = await canvasToPngBlob(canvas, errorMessage);
  const pngFileName = ensurePngFileName(fileName);

  return shareBlobAsPng(blob, pngFileName);
}

export async function saveCanvasAsPngToAlbum(
  canvas: HTMLCanvasElement,
  fileName: string,
  errorMessage: string
): Promise<ImageArtifactDeliveryResult> {
  const blob = await canvasToPngBlob(canvas, errorMessage);
  const pngFileName = ensurePngFileName(fileName);

  if (!isNativeMobileTauriRuntime()) {
    return shareBlobAsPng(blob, pngFileName);
  }

  try {
    return await saveBlobAsPngToAlbum(blob, pngFileName);
  } catch {
    return shareBlobAsPng(blob, pngFileName);
  }
}

async function shareBlobAsPng(
  blob: Blob,
  pngFileName: string
): Promise<ImageArtifactDeliveryResult> {
  if (isNativeMobileTauriRuntime()) {
    try {
      const pngDataUrl = await blobToDataUrl(
        blob,
        "图片编码失败。",
        "当前环境不支持图片编码。"
      );
      const response = await invokeImageArtifactNativeCommand<ImageArtifactNativeDeliveryResponse>(
        "share_image",
        {
          fileName: pngFileName,
          pngDataUrl
        }
      );

      return {
        fileName: stringValue(response.fileName) || pngFileName,
        source: "shareSheet",
        cancelled: Boolean(response.cancelled) || undefined
      };
    } catch (error) {
      const nativeError = normalizeImageArtifactNativeError(error, "打开系统分享失败。");
      if (isShareCancelled(nativeError)) {
        return {
          fileName: pngFileName,
          source: "shareSheet",
          cancelled: true
        };
      }
    }
  }

  if (typeof File === "undefined") {
    downloadBlob(blob, pngFileName);
    return {
      fileName: pngFileName,
      source: "browserDownload"
    };
  }

  const file = new File([blob], pngFileName, {
    type: blob.type || "image/png"
  });

  if (canShareImageFiles(file)) {
    try {
      await navigator.share({
        files: [file],
        title: pngFileName
      });
      return {
        fileName: pngFileName,
        source: "shareSheet"
      };
    } catch (error) {
      if (isShareCancelled(error)) {
        return {
          fileName: pngFileName,
          source: "shareSheet",
          cancelled: true
        };
      }
    }
  }

  downloadBlob(blob, pngFileName);
  return {
    fileName: pngFileName,
    source: "browserDownload"
  };
}

async function saveBlobAsPngToAlbum(
  blob: Blob,
  pngFileName: string
): Promise<ImageArtifactDeliveryResult> {
  const pngDataUrl = await blobToDataUrl(
    blob,
    "图片编码失败。",
    "当前环境不支持图片编码。"
  );

  try {
    const response = await invokeImageArtifactNativeCommand<ImageArtifactNativeDeliveryResponse>(
      "save_image_to_album",
      {
        fileName: pngFileName,
        pngDataUrl
      }
    );

    return {
      fileName: stringValue(response.fileName) || pngFileName,
      source: "album",
      cancelled: Boolean(response.cancelled) || undefined
    };
  } catch (error) {
    throw normalizeImageArtifactNativeError(error, "保存到相册失败。");
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function blobToDataUrl(
  blob: Blob,
  errorMessage = "图片编码失败。",
  unsupportedMessage = errorMessage
): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error(errorMessage));
      };
      reader.onerror = () => reject(new Error(errorMessage));
      reader.readAsDataURL(blob);
    });
  }

  if (typeof btoa !== "function") {
    throw new Error(unsupportedMessage);
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

function canShareImageFiles(file?: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }

  if (typeof File === "undefined") {
    return false;
  }

  const probeFile =
    file ??
    new File([new Blob(["png"], { type: "image/png" })], "image-artifact.png", {
      type: "image/png"
    });

  const navigatorWithShare = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (typeof navigatorWithShare.canShare !== "function") {
    return true;
  }

  try {
    return navigatorWithShare.canShare({ files: [probeFile] });
  } catch {
    return false;
  }
}

function isShareCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { name, message } = error as { name?: string; message?: string };
  return name === "AbortError" || message === "AbortError" || message?.includes("AbortError") === true;
}

function isAndroidTauriRuntime(): boolean {
  return (
    hasTauriRuntime() &&
    typeof navigator !== "undefined" &&
    /Android/i.test(navigator.userAgent)
  );
}

function isIosTauriRuntime(): boolean {
  if (!hasTauriRuntime() || typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return true;
  }

  const navigatorWithPlatform = navigator as Navigator & {
    platform?: string;
    maxTouchPoints?: number;
  };

  return (
    navigatorWithPlatform.platform === "MacIntel" &&
    (navigatorWithPlatform.maxTouchPoints ?? 0) > 1
  );
}

function isNativeMobileTauriRuntime(): boolean {
  return isAndroidTauriRuntime() || isIosTauriRuntime();
}

async function invokeImageArtifactNativeCommand<T>(
  command: string,
  payload?: Record<string, unknown>
): Promise<T> {
  return invoke<T>(`${IMAGE_ARTIFACT_MOBILE_PLUGIN}|${command}`, payload ?? {});
}

function normalizeImageArtifactNativeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === "object") {
    const value = error as { message?: unknown };
    const message = typeof value.message === "string" && value.message.trim() ? value.message : fallbackMessage;
    return new Error(message);
  }

  return new Error(fallbackMessage);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
