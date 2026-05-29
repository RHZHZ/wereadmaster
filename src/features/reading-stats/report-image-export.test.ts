import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/reading-api", () => ({
  exportReportImage: vi.fn()
}));

import { exportReportImage } from "../../lib/reading-api";
import { exportCanvasAsReportImage } from "./report-image-export";

const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalBtoa = globalThis.btoa;

const exportReportImageMock = vi.mocked(exportReportImage);

let appendSpy: ReturnType<typeof vi.fn>;
let anchorClickSpy: ReturnType<typeof vi.fn>;
let anchorRemoveSpy: ReturnType<typeof vi.fn>;
let createdAnchor: { download: string; href: string };

describe("exportCanvasAsReportImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportReportImageMock.mockReset();
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

    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn(() => undefined);
    globalThis.btoa = vi.fn(() => "cG9zdGVy");
  });

  afterEach(() => {
    if (typeof originalDocument === "undefined") {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      globalThis.document = originalDocument;
    }

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    if (typeof originalBtoa === "undefined") {
      Reflect.deleteProperty(globalThis, "btoa");
    } else {
      globalThis.btoa = originalBtoa;
    }

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    vi.restoreAllMocks();
  });

  it("uses browser download when Tauri runtime is unavailable", async () => {
    const result = await exportCanvasAsReportImage(makeCanvas(), "2026-05-report", "生成失败。");

    expect(result).toEqual({
      fileName: "2026-05-report.png",
      source: "browserDownload"
    });
    expect(exportReportImageMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(createdAnchor.download).toBe("2026-05-report.png");
    expect(createdAnchor.href).toBe("blob:report");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
  });

  it("uses the application export directory in Tauri runtime", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    exportReportImageMock.mockResolvedValue({
      fileName: "2026-05-report.png",
      path: "D:/ReadingExports/2026-05-report.png",
      exportedAt: "1800000000"
    });

    const result = await exportCanvasAsReportImage(makeCanvas(), "2026-05-report", "生成失败。");

    expect(result).toEqual({
      fileName: "2026-05-report.png",
      path: "D:/ReadingExports/2026-05-report.png",
      exportedAt: "1800000000",
      source: "exportDir"
    });
    expect(exportReportImageMock).toHaveBeenCalledTimes(1);
    expect(exportReportImageMock.mock.calls[0]?.[0]).toBe("2026-05-report.png");
    expect(exportReportImageMock.mock.calls[0]?.[1]).toContain("base64,");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });
});

function makeCanvas(): HTMLCanvasElement {
  return {
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob(["poster"], { type: "image/png" }))
    )
  } as unknown as HTMLCanvasElement;
}
