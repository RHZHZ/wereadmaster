import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicReviewsPanel } from "./PublicReviewsPanel";

describe("PublicReviewsPanel", () => {
  it("renders public reviews as external public content", () => {
    const markup = renderToStaticMarkup(
      <PublicReviewsPanel
        result={{
          bookId: "b1",
          reviewListType: 0,
          hasMore: false,
          has5Star: true,
          has1Star: false,
          hasRecent: true,
          reviews: [
            {
              reviewId: "r1",
              content: "值得继续读的一本书。",
              starLevel: 5,
              chapterName: "第一章",
              author: {
                name: "读者甲"
              }
            }
          ]
        }}
        isLoading={false}
        onRefresh={() => undefined}
      />
    );

    expect(markup).toContain("公开点评");
    expect(markup).toContain("来自微信读书公开内容，不计入个人笔记。");
    expect(markup).toContain("读者甲");
    expect(markup).toContain("五星");
    expect(markup).toContain("值得继续读的一本书。");
  });

  it("renders filters, all loaded reviews, pagination and a local pagination error", () => {
    const markup = renderToStaticMarkup(
      <PublicReviewsPanel
        result={{
          bookId: "b1",
          reviewListType: 3,
          hasMore: true,
          has5Star: true,
          has1Star: true,
          hasRecent: true,
          reviews: Array.from({ length: 6 }, (_, index) => ({
            reviewId: `r${index + 1}`,
            content: `公开点评 ${index + 1}`
          }))
        }}
        reviewListType={3}
        isLoading={false}
        paginationError={{
          code: "network_error",
          message: "网络暂时不可用"
        }}
        onReviewListTypeChange={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );

    expect(markup).toContain('aria-label="点评筛选"');
    expect(markup).toContain('aria-pressed="true">最新');
    expect(markup).toContain("推荐");
    expect(markup).toContain("不行");
    expect(markup).toContain("一般");
    expect(markup).toContain("公开点评 6");
    expect(markup).toContain("加载更多点评");
    expect(markup).toContain("更多点评加载失败：网络暂时不可用");
  });

  it("keeps upgrade-required errors as a dedicated notice", () => {
    const markup = renderToStaticMarkup(
      <PublicReviewsPanel
        isLoading={false}
        error={{
          code: "upgrade_required",
          message: "微信读书 Skill 需要升级。",
          detail: "请替换 SKILL.md 后重试。"
        }}
        onRefresh={() => undefined}
      />
    );

    expect(markup).toContain("微信读书 Skill 需要升级");
    expect(markup).toContain("请替换 SKILL.md 后重试。");
  });
});

