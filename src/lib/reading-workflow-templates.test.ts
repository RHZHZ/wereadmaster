import { describe, expect, test } from "vitest";
import { readingWorkflowTemplates } from "./reading-workflow-templates";

describe("reading workflow templates", () => {
  test("keeps the first batch small and action-oriented", () => {
    expect(readingWorkflowTemplates).toHaveLength(4);
    expect(readingWorkflowTemplates.map((template) => template.id)).toEqual([
      "bookReview",
      "currentBookGuide",
      "periodReview",
      "bookDecision"
    ]);
  });

  test("declares input boundary and output for every template", () => {
    for (const template of readingWorkflowTemplates) {
      expect(template.inputScope.trim()).not.toBe("");
      expect(template.output.trim()).not.toBe("");
      expect(template.actionLabel.trim()).not.toBe("");
    }
  });
});

