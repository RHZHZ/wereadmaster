import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookshelfResponse } from "../lib/reading-api";
import { MinePage } from "./MinePage";

describe("mine page status and settings links", () => {
  it("labels the bookshelf book count honestly and points proxy setup to account settings", () => {
    const onOpenSettings = vi.fn();
    const markup = renderToStaticMarkup(
      <MinePage
        credentialStatus={{ hasCredential: true }}
        bookshelf={createBookshelfResponse()}
        isSyncing={false}
        onSync={() => undefined}
        onOpenStats={() => undefined}
        onOpenDiscovery={() => undefined}
        onOpenSettings={onOpenSettings}
        onOpenLocalLibrary={() => undefined}
      />
    );

    expect(markup).toContain("书籍");
    expect(markup).toContain("6 本书");
    expect(markup).toContain("微信读书代理设置");
    expect(markup).toContain("配置 Android 微信读书同步代理");
    expect(markup).not.toContain("代理与网络诊断");
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});

function createBookshelfResponse(): BookshelfResponse {
  return {
    snapshot: {
      entries: [],
      archives: [],
      summary: {
        totalVisibleEntries: 8,
        bookCount: 6,
        albumCount: 1,
        mpCount: 1,
        publicCount: 7,
        secretCount: 1,
      },
    },
    syncState: {
      section: "shelf",
      status: "success",
      lastSuccessAt: "2026-08-01T12:00:00.000Z",
    },
  };
}
