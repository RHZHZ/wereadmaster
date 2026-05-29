import { describe, expect, it } from "vitest";
import type { LocalBook } from "./local-reader-types";
import type { ShelfEntry } from "./types";
import {
  buildLikelySourceVersionPair,
  findLikelyLocalBookMatch,
  findLikelyWereadBookMatch
} from "./source-version-matches";

describe("source version matches", () => {
  it("匹配本地书对应的微信电子书版本", () => {
    const match = findLikelyWereadBookMatch(
      { title: " 小王子 ", author: "圣埃克苏佩里" },
      [
        makeShelfEntry("weread-1", "book", "《小王子》", "圣埃克苏佩里"),
        makeShelfEntry("album-1", "album", "小王子", "播音")
      ]
    );

    expect(match?.id).toBe("weread-1");
  });

  it("同名候选存在作者缺失时优先匹配作者一致版本", () => {
    const match = findLikelyWereadBookMatch(
      { title: "小王子", author: "圣埃克苏佩里" },
      [
        makeShelfEntry("weread-unknown", "book", "小王子"),
        makeShelfEntry("weread-exact", "book", "《小王子》", "圣埃克苏佩里")
      ]
    );

    expect(match?.id).toBe("weread-exact");
  });

  it("同名同作者存在多个候选时不提示疑似版本", () => {
    expect(
      findLikelyWereadBookMatch(
        { title: "小王子", author: "圣埃克苏佩里" },
        [
          makeShelfEntry("weread-1", "book", "小王子", "圣埃克苏佩里"),
          makeShelfEntry("weread-2", "book", "《小王子》", "圣埃克苏佩里")
        ]
      )
    ).toBeUndefined();

    expect(
      findLikelyLocalBookMatch(makeShelfEntry("weread-1", "book", "小王子", "圣埃克苏佩里"), [
        makeLocalBook("local-1", "小王子", "圣埃克苏佩里"),
        makeLocalBook("local-2", "《小王子》", "圣埃克苏佩里")
      ])
    ).toBeUndefined();
  });

  it("同名且作者缺失产生多个候选时不提示疑似版本", () => {
    expect(
      findLikelyWereadBookMatch(
        { title: "小王子" },
        [
          makeShelfEntry("weread-1", "book", "小王子"),
          makeShelfEntry("weread-2", "book", "《小王子》")
        ]
      )
    ).toBeUndefined();

    expect(
      findLikelyLocalBookMatch(makeShelfEntry("weread-1", "book", "小王子"), [
        makeLocalBook("local-1", "小王子"),
        makeLocalBook("local-2", "《小王子》")
      ])
    ).toBeUndefined();
  });

  it("同名候选同时存在作者冲突和作者缺失时不使用缺失作者兜底", () => {
    expect(
      findLikelyWereadBookMatch(
        { title: "小王子", author: "作者甲" },
        [
          makeShelfEntry("weread-1", "book", "小王子", "作者乙"),
          makeShelfEntry("weread-2", "book", "小王子")
        ]
      )
    ).toBeUndefined();

    expect(
      findLikelyLocalBookMatch(makeShelfEntry("weread-1", "book", "小王子", "作者甲"), [
        makeLocalBook("local-1", "小王子", "作者乙"),
        makeLocalBook("local-2", "小王子")
      ])
    ).toBeUndefined();
  });

  it("匹配微信书对应的本地图书版本", () => {
    const match = findLikelyLocalBookMatch(
      makeShelfEntry("weread-1", "book", "《小王子》", "圣埃克苏佩里"),
      [makeLocalBook("local-1", "小王子", "圣埃克苏佩里")]
    );

    expect(match?.id).toBe("local-1");
  });

  it("生成跨来源版本对时使用 source key 而不是裸 bookId", () => {
    expect(
      buildLikelySourceVersionPair(
        makeLocalBook("same-id", "小王子", "圣埃克苏佩里"),
        makeShelfEntry("same-id", "book", "《小王子》", "圣埃克苏佩里")
      )
    ).toEqual({
      local: { source: "local", sourceId: "same-id" },
      weread: { source: "weread", sourceId: "same-id" },
      matchBy: "title-author"
    });
  });

  it("作者冲突时不提示同一本书版本", () => {
    expect(
      findLikelyWereadBookMatch(
        { title: "小王子", author: "作者甲" },
        [makeShelfEntry("weread-1", "book", "小王子", "作者乙")]
      )
    ).toBeUndefined();

    expect(
      findLikelyLocalBookMatch(
        makeShelfEntry("weread-1", "book", "小王子", "作者甲"),
        [makeLocalBook("local-1", "小王子", "作者乙")]
      )
    ).toBeUndefined();

    expect(
      buildLikelySourceVersionPair(
        makeLocalBook("local-1", "小王子", "作者甲"),
        makeShelfEntry("weread-1", "book", "小王子", "作者乙")
      )
    ).toBeUndefined();
  });

  it("不会把有声书或文章收藏当作图书版本", () => {
    expect(
      findLikelyWereadBookMatch(
        { title: "小王子", author: "圣埃克苏佩里" },
        [
          makeShelfEntry("album-1", "album", "小王子", "圣埃克苏佩里"),
          makeShelfEntry("mp-1", "mp", "小王子", "圣埃克苏佩里")
        ]
      )
    ).toBeUndefined();

    expect(
      findLikelyLocalBookMatch(
        makeShelfEntry("album-1", "album", "小王子", "圣埃克苏佩里"),
        [makeLocalBook("local-1", "小王子", "圣埃克苏佩里")]
      )
    ).toBeUndefined();
  });
});

function makeShelfEntry(
  id: string,
  type: ShelfEntry["type"],
  title: string,
  author?: string
): ShelfEntry {
  return {
    id,
    type,
    title,
    author,
    isTop: false,
    isSecret: false
  };
}

function makeLocalBook(id: string, title: string, author?: string): LocalBook {
  return {
    id,
    source: "local",
    title,
    author,
    format: "txt",
    fileHash: `${id}-hash`,
    fileSize: 1024,
    storagePath: `local-reader/${id}.txt`,
    importedAt: "2026-05-27T08:00:00.000Z",
    updatedAt: "2026-05-27T08:00:00.000Z"
  };
}
