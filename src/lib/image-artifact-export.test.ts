import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));
import {
  blobToDataUrl,
  canvasToPngBlob,
  downloadCanvasAsPng,
  ensurePngFileName,
  getImageArtifactCapabilities,
  hasTauriRuntime,
  resolveImageArtifactCapabilities,
  saveCanvasAsPngToAlbum,
  shareCanvasAsPng
} from "./image-artifact-export";

const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalBtoa = globalThis.btoa;
const originalFileReader = globalThis.FileReader;

let appendSpy: ReturnType<typeof vi.fn>;
let anchorClickSpy: ReturnType<typeof vi.fn>;
let anchorRemoveSpy: ReturnType<typeof vi.fn>;
let createdAnchor: { download: string; href: string };

describe("image artifact export helpers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;

    appendSpy = vi.fn();
    anchorClickSpy = vi.fn();
    anchorRemoveSpy = vi.fn();
    createdAnchor = { download: "", href: "" };

    globalThis.document = {
      body: {
        append: appendSpy
      },
      createElement: vi.fn((tagName: string) => {
        if (tagName !== "a") {
          throw new Error(`Unexpected element request: ${tagName}`);
        }

        return {
          get download() {
            return createdAnchor.download;
          },
          set download(value: string) {
            createdAnchor.download = value;
          },
          get href() {
            return createdAnchor.href;
          },
          set href(value: string) {
            createdAnchor.href = value;
          },
          click: anchorClickSpy,
          remove: anchorRemoveSpy
        };
      })
    } as unknown as Document;

    URL.createObjectURL = vi.fn(() => "blob:image-artifact");
    URL.revokeObjectURL = vi.fn(() => undefined);
    globalThis.btoa = vi.fn(() => "cG5n");
    Reflect.deleteProperty(globalThis, "FileReader");
    installNavigatorMock(undefined);
  });

  afterEach(() => {
    if (typeof originalDocument === "undefined") {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      globalThis.document = originalDocument;
    }

    installNavigatorMock(originalNavigator);

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    if (typeof originalBtoa === "undefined") {
      Reflect.deleteProperty(globalThis, "btoa");
    } else {
      globalThis.btoa = originalBtoa;
    }

    if (typeof originalFileReader === "undefined") {
      Reflect.deleteProperty(globalThis, "FileReader");
    } else {
      globalThis.FileReader = originalFileReader;
    }

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    vi.clearAllMocks();
  });

  it("normalizes PNG file names", () => {
    expect(ensurePngFileName(" report ")).toBe("report.png");
    expect(ensurePngFileName("report.PNG")).toBe("report.PNG");
    expect(ensurePngFileName("   ")).toBe("reading-report.png");
  });

  it("converts a canvas to a PNG blob", async () => {
    await expect(canvasToPngBlob(makeCanvas(), "生成失败。")).resolves.toEqual(
      new Blob(["png"], { type: "image/png" })
    );
  });

  it("rejects when a canvas cannot create a PNG blob", async () => {
    await expect(canvasToPngBlob(makeCanvas(null), "生成失败。")).rejects.toThrow("生成失败。");
  });

  it("downloads a canvas as PNG and revokes the temporary URL", async () => {
    const fileName = await downloadCanvasAsPng(makeCanvas(), "note-card", "生成失败。");

    expect(fileName).toBe("note-card.png");
    expect(createdAnchor.download).toBe("note-card.png");
    expect(createdAnchor.href).toBe("blob:image-artifact");
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-artifact");
  });

  it("encodes a blob as a data URL without FileReader", async () => {
    const dataUrl = await blobToDataUrl(new Blob(["png"], { type: "image/png" }));

    expect(dataUrl).toBe("data:image/png;base64,cG5n");
    expect(globalThis.btoa).toHaveBeenCalledTimes(1);
  });

  it("detects Tauri runtime markers", () => {
    expect(hasTauriRuntime()).toBe(false);

    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(hasTauriRuntime()).toBe(true);

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    expect(hasTauriRuntime()).toBe(true);
  });

  it("detects image artifact capabilities", () => {
    installNavigatorMock({
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);

    expect(getImageArtifactCapabilities()).toEqual({
      canSaveToAlbum: false,
      canShareImage: true,
      canExportFile: false,
      canBrowserDownload: true
    });
  });

  it("resolves native image artifact capabilities on Android", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      canSaveToAlbum: true,
      canShareImage: true
    });

    await expect(resolveImageArtifactCapabilities()).resolves.toEqual({
      canSaveToAlbum: true,
      canShareImage: true,
      canExportFile: true,
      canBrowserDownload: true
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|get_capabilities", {});
  });

  it("resolves native image artifact capabilities on iOS", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      canSaveToAlbum: true,
      canShareImage: true
    });

    await expect(resolveImageArtifactCapabilities()).resolves.toEqual({
      canSaveToAlbum: true,
      canShareImage: true,
      canExportFile: true,
      canBrowserDownload: true
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|get_capabilities", {});
  });

  it("saves a canvas as PNG to the native mobile photo album", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      fileName: "saved-card.png",
      source: "album",
      cancelled: false
    });

    const result = await saveCanvasAsPngToAlbum(makeCanvas(), "saved-card", "生成失败。");

    expect(result).toEqual({
      fileName: "saved-card.png",
      source: "album"
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|save_image_to_album", {
      fileName: "saved-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("saves a canvas as PNG to the iOS photo album", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      fileName: "saved-card.png",
      source: "album",
      cancelled: false
    });

    const result = await saveCanvasAsPngToAlbum(makeCanvas(), "saved-card", "生成失败。");

    expect(result).toEqual({
      fileName: "saved-card.png",
      source: "album"
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|save_image_to_album", {
      fileName: "saved-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to native mobile share when album saving fails", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke)
      .mockRejectedValueOnce({ message: "保存到相册失败。" })
      .mockResolvedValueOnce({
        fileName: "saved-card.png",
        source: "shareSheet",
        cancelled: false
      });

    const result = await saveCanvasAsPngToAlbum(makeCanvas(), "saved-card", "生成失败。");

    expect(result).toEqual({
      fileName: "saved-card.png",
      source: "shareSheet"
    });
    expect(vi.mocked(invoke)).toHaveBeenNthCalledWith(1, "plugin:image-artifact-mobile|save_image_to_album", {
      fileName: "saved-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(vi.mocked(invoke)).toHaveBeenNthCalledWith(2, "plugin:image-artifact-mobile|share_image", {
      fileName: "saved-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to browser download when album saving is requested outside Android", async () => {
    installNavigatorMock({} as Navigator);

    const result = await saveCanvasAsPngToAlbum(makeCanvas(), "saved-card", "生成失败。");

    expect(result).toEqual({
      fileName: "saved-card.png",
      source: "browserDownload"
    });
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdAnchor.download).toBe("saved-card.png");
  });

  it("shares a canvas as PNG when the environment supports share files", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn(() => true);
    installNavigatorMock({
      share: shareMock,
      canShare: canShareMock
    } as unknown as Navigator);

    const result = await shareCanvasAsPng(makeCanvas(), "share-card", "生成失败。");

    expect(result).toEqual({
      fileName: "share-card.png",
      source: "shareSheet"
    });
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(canShareMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shares a canvas through the Android native bridge", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      fileName: "share-card.png",
      source: "shareSheet",
      cancelled: false
    });

    const result = await shareCanvasAsPng(makeCanvas(), "share-card", "生成失败。");

    expect(result).toEqual({
      fileName: "share-card.png",
      source: "shareSheet"
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|share_image", {
      fileName: "share-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shares a canvas through the iOS native bridge", async () => {
    installNavigatorMock({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      share: vi.fn(),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.mocked(invoke).mockResolvedValue({
      fileName: "share-card.png",
      source: "shareSheet",
      cancelled: false
    });

    const result = await shareCanvasAsPng(makeCanvas(), "share-card", "生成失败。");

    expect(result).toEqual({
      fileName: "share-card.png",
      source: "shareSheet"
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("plugin:image-artifact-mobile|share_image", {
      fileName: "share-card.png",
      pngDataUrl: "data:image/png;base64,cG5n"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to browser download when share is unavailable", async () => {
    installNavigatorMock({} as Navigator);

    const result = await shareCanvasAsPng(makeCanvas(), "share-card", "生成失败。");

    expect(result).toEqual({
      fileName: "share-card.png",
      source: "browserDownload"
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

function makeCanvas(
  blob: Blob | null | undefined = new Blob(["png"], { type: "image/png" })
): HTMLCanvasElement {
  return {
    toBlob: vi.fn((callback: BlobCallback) => callback(blob ?? null))
  } as unknown as HTMLCanvasElement;
}

function installNavigatorMock(nextNavigator?: Navigator) {
  if (typeof nextNavigator === "undefined") {
    Reflect.deleteProperty(globalThis, "navigator");
    return;
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: nextNavigator,
    writable: true
  });
}
