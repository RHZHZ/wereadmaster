import { describe, expect, it } from "vitest";
import type { LocalBook } from "./local-reader-types";
import type { ShelfEntry } from "./types";
import {
  areSourceItemKeysEqual,
  createSourceItemKey,
  parseSourceItemKey,
  serializeSourceItemKey,
  sourceItemKeyFromLocalBook,
  sourceItemKeyFromWereadEntry
} from "./source-item-keys";

describe("source item keys", () => {
  it("为本地书和微信书生成不同来源 key", () => {
    expect(sourceItemKeyFromLocalBook(makeLocalBook("same-id"))).toEqual({
      source: "local",
      sourceId: "same-id"
    });
    expect(sourceItemKeyFromWereadEntry(makeShelfEntry("same-id"))).toEqual({
      source: "weread",
      sourceId: "same-id"
    });
  });

  it("序列化和解析包含特殊字符的来源 ID", () => {
    const key = createSourceItemKey("local", " local:demo/book ");

    expect(key).toEqual({ source: "local", sourceId: "local:demo/book" });
    const serialized = serializeSourceItemKey(key!);
    expect(serialized).toBe("local:local%3Ademo%2Fbook");
    expect(parseSourceItemKey(serialized!)).toEqual(key);
  });

  it("拒绝裸 bookId、未知来源和空来源 ID", () => {
    expect(parseSourceItemKey("822995")).toBeUndefined();
    expect(parseSourceItemKey("remote:822995")).toBeUndefined();
    expect(parseSourceItemKey("weread:")).toBeUndefined();
    expect(createSourceItemKey("local", "   ")).toBeUndefined();
  });

  it("按来源和来源 ID 比较 key", () => {
    expect(
      areSourceItemKeysEqual(
        { source: "local", sourceId: "same-id" },
        { source: "weread", sourceId: "same-id" }
      )
    ).toBe(false);
    expect(
      areSourceItemKeysEqual(
        { source: "local", sourceId: "same-id" },
        { source: "local", sourceId: "same-id" }
      )
    ).toBe(true);
  });
});

function makeLocalBook(id: string): LocalBook {
  return {
    id,
    source: "local",
    title: "小王子",
    author: "圣埃克苏佩里",
    format: "txt",
    fileHash: `${id}-hash`,
    fileSize: 1024,
    storagePath: `local-reader/${id}.txt`,
    importedAt: "2026-05-27T08:00:00.000Z",
    updatedAt: "2026-05-27T08:00:00.000Z"
  };
}

function makeShelfEntry(id: string): ShelfEntry {
  return {
    id,
    type: "book",
    title: "小王子",
    author: "圣埃克苏佩里",
    isTop: false,
    isSecret: false
  };
}
