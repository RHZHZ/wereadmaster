import { describe, expect, test } from "vitest";

import { parseNotionPageId } from "./notion-page-id";

describe("parseNotionPageId", () => {
  test("accepts dashed and compact page ids", () => {
    expect(parseNotionPageId("3a39daca-95bb-81f3-914d-dd14259a58ed")).toBe(
      "3a39daca-95bb-81f3-914d-dd14259a58ed",
    );
    expect(parseNotionPageId("3a39daca95bb81f3914ddd14259a58ed")).toBe(
      "3a39daca-95bb-81f3-914d-dd14259a58ed",
    );
  });

  test("extracts the page id from a Notion page URL", () => {
    expect(
      parseNotionPageId(
        "https://www.notion.so/Books-Tracker-3a39daca95bb81f3914ddd14259a58ed?pvs=4",
      ),
    ).toBe("3a39daca-95bb-81f3-914d-dd14259a58ed");
  });

  test("rejects missing or ambiguous ids", () => {
    expect(parseNotionPageId("https://www.notion.so/Books-Tracker")).toBeUndefined();
    expect(
      parseNotionPageId(
        "3a39daca95bb81f3914ddd14259a58ed 0a39daca95bb81f3914ddd14259a58ed",
      ),
    ).toBeUndefined();
  });
});
