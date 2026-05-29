import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewPreferenceSection } from "./ReviewPreferenceSection";

describe("ReviewPreferenceSection", () => {
  it("renders preference bubbles as interactive triggers", () => {
    const markup = renderToStaticMarkup(
      <ReviewPreferenceSection
        aiItems={["你最近把更多时间投向了历史与人物主题。"]}
        categories={[
          {
            categoryId: "history",
            title: "历史读物",
            parentTitle: "历史",
            readingTimeSeconds: 7200
          },
          {
            categoryId: "essay",
            title: "人物传记",
            parentTitle: "人文社科",
            readingTimeSeconds: 3600
          }
        ]}
      />
    );

    expect(markup).toContain("review-preference-map");
    expect(markup).toContain("review-preference-bubble");
    expect(markup).toContain("历史读物");
    expect(markup).toContain("AI 偏好解释");
  });
});
