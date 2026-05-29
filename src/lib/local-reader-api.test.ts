import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

import { invoke } from "@tauri-apps/api/core";
import { importLocalBook } from "./local-reader-api";
import type { ImportLocalBookResult } from "./local-reader-types";

const invokeMock = vi.mocked(invoke);

describe("local reader API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("__TAURI__", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns import status from the desktop import command", async () => {
    const result: ImportLocalBookResult = {
      book: {
        id: "local_abc",
        source: "local",
        title: "小王子",
        author: "圣埃克苏佩里",
        format: "epub",
        fileHash: "fnv1a64-abc",
        fileSize: 1024,
        storagePath: "local-books/local_abc/source.epub",
        importedAt: "2026-05-28T10:00:00+08:00",
        updatedAt: "2026-05-28T10:00:00+08:00"
      },
      wasAlreadyImported: true
    };
    invokeMock.mockResolvedValue(result);

    await expect(importLocalBook({ filePath: "D:/Books/小王子.epub" })).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("import_local_book", {
      input: { filePath: "D:/Books/小王子.epub" }
    });
  });
});
