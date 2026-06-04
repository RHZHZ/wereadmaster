import { describe, expect, test } from "vitest";
import {
  formatArtifactCopiedMessage,
  formatArtifactCreatedMessage,
  formatArtifactExportedMessage,
  getReadingArtifactLabel
} from "./reading-artifacts";

describe("reading artifacts", () => {
  test("formats stable artifact labels", () => {
    expect(getReadingArtifactLabel("book-review-markdown")).toBe("复盘文档");
    expect(getReadingArtifactLabel("action-checklist")).toBe("行动清单");
    expect(getReadingArtifactLabel("reflection-questions")).toBe("复盘问题");
  });

  test("formats created, copied and exported messages", () => {
    expect(formatArtifactCreatedMessage("note-card-image", { fileName: "card.png" })).toBe(
      "已生成：摘录卡片（card.png）"
    );
    expect(formatArtifactCopiedMessage("action-checklist")).toBe("已复制：行动清单");
    expect(
      formatArtifactExportedMessage("book-review-markdown", {
        fileName: "summary.md",
        path: "D:/exports/summary.md"
      })
    ).toBe("已导出：复盘文档（summary.md），路径：D:/exports/summary.md");
  });
});
