import { describe, expect, it } from "vitest";
import {
  createReadingAssetLinkPair,
  createReadingAssetLinkPairFromSourceVersionPair,
  findReadingAssetLinkPair,
  readReadingAssetLinks,
  removeReadingAssetLinkPair,
  setReadingAssetLinkPairLinked,
  upsertReadingAssetLinkPair,
  writeReadingAssetLinks,
  type ReadingAssetLinkPair
} from "./reading-asset-links";
import type { SourceItemKey } from "./source-item-keys";
import type { SourceVersionPair } from "./source-version-matches";

const NOW = "2026-05-28T10:00:00.000Z";
const STORAGE_KEY = "wxreadmaster.readingAssetLinks.v1";

describe("reading asset links", () => {
  it("从疑似版本对创建手动关联，并固定本地和微信来源顺序", () => {
    const link = createReadingAssetLinkPairFromSourceVersionPair({
      local: { source: "local", sourceId: "same-id" },
      weread: { source: "weread", sourceId: "same-id" },
      matchBy: "title-author"
    } satisfies SourceVersionPair, NOW);

    expect(link).toEqual({
      id: "reading-asset-link:local:same-id|weread:same-id",
      assetId: "reading-asset:local:same-id|weread:same-id",
      local: { source: "local", sourceId: "same-id" },
      weread: { source: "weread", sourceId: "same-id" },
      linkedBy: "user",
      createdAt: NOW
    });
  });

  it("拒绝裸 bookId、非法来源和空来源 ID", () => {
    expect(
      createReadingAssetLinkPair({
        local: { source: "weread", sourceId: "same-id" } as SourceItemKey,
        weread: { source: "weread", sourceId: "same-id" },
        now: NOW
      })
    ).toBeUndefined();

    expect(
      createReadingAssetLinkPair({
        local: { source: "local", sourceId: "   " },
        weread: { source: "weread", sourceId: "same-id" },
        now: NOW
      })
    ).toBeUndefined();

    const storage = createMemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          local: "same-id",
          weread: { source: "weread", sourceId: "same-id" },
          linkedBy: "user",
          createdAt: NOW
        },
        {
          local: { source: "remote", sourceId: "same-id" },
          weread: { source: "weread", sourceId: "same-id" },
          linkedBy: "user",
          createdAt: NOW
        }
      ])
    );

    expect(readReadingAssetLinks(storage)).toEqual([]);
  });

  it("重复写入同一本地和微信版本时不产生重复关联", () => {
    const link = makeLink("local-1", "weread-1");

    expect(upsertReadingAssetLinkPair([link], link)).toEqual([link]);
    expect(writeReadingAssetLinks(undefined, [link, link])).toEqual([link]);
  });

  it("按本地和微信来源版本查找已有关联", () => {
    const link = makeLink("local-1", "weread-1");

    expect(findReadingAssetLinkPair([link], link)).toEqual(link);
    expect(findReadingAssetLinkPair([link], makeLink("local-2", "weread-1"))).toBeUndefined();
    expect(findReadingAssetLinkPair([link], undefined)).toBeUndefined();
  });

  it("通过单一纯函数切换关联状态，避免页面逻辑分叉", () => {
    const pair = makeSourceVersionPair("local-1", "weread-1");
    const linked = setReadingAssetLinkPairLinked([], pair, true);

    expect(linked).toHaveLength(1);
    expect(linked?.[0]).toMatchObject({
      id: "reading-asset-link:local:local-1|weread:weread-1",
      assetId: "reading-asset:local:local-1|weread:weread-1",
      local: { source: "local", sourceId: "local-1" },
      weread: { source: "weread", sourceId: "weread-1" },
      linkedBy: "user"
    });
    expect(linked?.[0]?.createdAt).toEqual(expect.any(String));
    expect(setReadingAssetLinkPairLinked(linked!, pair, true)).toEqual(linked);
    expect(setReadingAssetLinkPairLinked(linked!, pair, false)).toEqual([]);
  });

  it("取消关联只删除指定版本对，保留其他关联", () => {
    const first = makeLink("local-1", "weread-1");
    const second = makeLink("local-2", "weread-2");

    expect(removeReadingAssetLinkPair([first, second], first)).toEqual([second]);
  });

  it("关联记录不保留笔记、进度或 AI 内容字段", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "external-id",
          assetId: "external-asset-id",
          local: { source: "local", sourceId: "local-1" },
          weread: { source: "weread", sourceId: "weread-1" },
          linkedBy: "user",
          createdAt: NOW,
          highlights: [{ text: "不应进入关联记录" }],
          progressPercent: 42,
          aiAnswer: "不应进入关联记录"
        }
      ])
    );

    const [link] = readReadingAssetLinks(storage);

    expect(link).toEqual(makeLink("local-1", "weread-1"));
    expect(link && "highlights" in link).toBe(false);
    expect(link && "progressPercent" in link).toBe(false);
    expect(link && "aiAnswer" in link).toBe(false);
  });
});

function makeLink(localId: string, wereadId: string): ReadingAssetLinkPair {
  const link = createReadingAssetLinkPair({
    local: { source: "local", sourceId: localId },
    weread: { source: "weread", sourceId: wereadId },
    now: NOW
  });

  if (!link) {
    throw new Error("测试数据应生成有效关联");
  }

  return link;
}

function makeSourceVersionPair(localId: string, wereadId: string): SourceVersionPair {
  return {
    local: { source: "local", sourceId: localId },
    weread: { source: "weread", sourceId: wereadId },
    matchBy: "title-author"
  };
}

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}
