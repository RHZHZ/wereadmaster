import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AiActionFeedbackChecklist } from "./AiActionFeedbackChecklist";

describe("AiActionFeedbackChecklist", () => {
  test("renders optional action breakdown control", () => {
    const markup = renderToStaticMarkup(
      <AiActionFeedbackChecklist
        title="下一步行动"
        ariaLabel="下一步行动"
        icon={null}
        items={[{ id: "action-1", text: "整理 3 条摘录" }]}
        emptyText="暂无行动"
        feedbackByItemId={{}}
        onFeedbackChange={() => undefined}
        onAskItem={() => undefined}
        askItemLabel="拆解"
      />
    );

    expect(markup).toContain("下一步行动");
    expect(markup).toContain("整理 3 条摘录");
    expect(markup).toContain("拆解");
  });
});
