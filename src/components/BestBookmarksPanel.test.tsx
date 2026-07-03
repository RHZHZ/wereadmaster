import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BestBookmarksPanel } from "./BestBookmarksPanel";

describe("BestBookmarksPanel", () => {
  it("renders initial state without fetched content", () => {
    const markup = renderToStaticMarkup(
      <BestBookmarksPanel
        isLoading={false}
        hasRequested={false}
        onLoad={() => undefined}
      />
    );

    expect(markup).toContain("热门划线");
    expect(markup).toContain("来自微信读书公开内容，不属于你的个人划线。");
    expect(markup).toContain("尚未加载公开热门划线");
    expect(markup).toContain("加载热门划线");
  });

  it("renders best bookmarks as public content", () => {
    const markup = renderToStaticMarkup(
      <BestBookmarksPanel
        result={{
          bookId: "b1",
          chapterUid: 0,
          totalCount: 20,
          items: [
            {
              bookmarkId: "bookmark-1",
              bookId: "b1",
              chapterUid: 101,
              chapterTitle: "第一章",
              range: "393-401",
              markText: "值得反复划线的句子。",
              totalCount: 88
            }
          ]
        }}
        isLoading={false}
        hasRequested={true}
        onLoad={() => undefined}
        onLoadReadReviews={() => undefined}
      />
    );

    expect(markup).toContain("读者共同划过的句子");
    expect(markup).toContain("第一章");
    expect(markup).toContain("88 人划过");
    expect(markup).toContain("值得反复划线的句子。");
    expect(markup).toContain("查看共读想法");
  });

  it("limits best bookmarks to five visible items", () => {
    const markup = renderToStaticMarkup(
      <BestBookmarksPanel
        result={{
          bookId: "b1",
          chapterUid: 0,
          items: Array.from({ length: 6 }, (_, index) => ({
            bookmarkId: `bookmark-${index + 1}`,
            bookId: "b1",
            chapterUid: 101,
            chapterTitle: "第一章",
            range: `${index}-${index + 1}`,
            markText: `热门划线 ${index + 1}`
          }))
        }}
        isLoading={false}
        hasRequested={true}
        onLoad={() => undefined}
      />
    );

    expect(markup).toContain("热门划线 5");
    expect(markup).not.toContain("热门划线 6");
  });

  it("renders read reviews only for the selected best bookmark", () => {
    const markup = renderToStaticMarkup(
      <BestBookmarksPanel
        result={{
          bookId: "b1",
          chapterUid: 0,
          items: [
            {
              bookmarkId: "bookmark-1",
              bookId: "b1",
              chapterUid: 101,
              chapterTitle: "第一章",
              range: "393-401",
              markText: "值得反复划线的句子。",
              totalCount: 88
            }
          ]
        }}
        readReviewsByBookmarkId={{
          "bookmark-1": {
            bookId: "b1",
            chapterUid: 101,
            range: "393-401",
            hasMore: false,
            reviews: [
              {
                reviewId: "rr1",
                content: "这段确实是全书关键。",
                author: {
                  name: "读者乙"
                }
              }
            ]
          }
        }}
        isLoading={false}
        hasRequested={true}
        onLoad={() => undefined}
      />
    );

    expect(markup).toContain("共读想法");
    expect(markup).toContain("不属于你的个人笔记");
    expect(markup).toContain("读者乙");
    expect(markup).toContain("这段确实是全书关键。");
  });

  it("keeps upgrade-required errors as a dedicated notice", () => {
    const markup = renderToStaticMarkup(
      <BestBookmarksPanel
        isLoading={false}
        hasRequested={true}
        error={{
          code: "upgrade_required",
          message: "微信读书 Skill 需要升级。",
          detail: "请替换 SKILL.md 后重试。"
        }}
        onLoad={() => undefined}
      />
    );

    expect(markup).toContain("微信读书 Skill 需要升级");
    expect(markup).toContain("请替换 SKILL.md 后重试。");
  });
});
