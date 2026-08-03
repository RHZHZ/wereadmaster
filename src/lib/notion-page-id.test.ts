import { describe, expect, test } from "vitest";

import { parseNotionObjectId, parseNotionPageId } from "./notion-page-id";

describe("parseNotionObjectId", () => {
  test("accepts dashed and compact object ids", () => {
    expect(parseNotionObjectId("3a39daca-95bb-81f3-914d-dd14259a58ed")).toBe(
      "3a39daca-95bb-81f3-914d-dd14259a58ed",
    );
    expect(parseNotionObjectId("3a39daca95bb81f3914ddd14259a58ed")).toBe(
      "3a39daca-95bb-81f3-914d-dd14259a58ed",
    );
  });

  test("extracts ids from Notion page and database URLs", () => {
    expect(
      parseNotionObjectId(
        "https://www.notion.so/Books-Tracker-3a39daca95bb81f3914ddd14259a58ed?pvs=4",
      ),
    ).toBe("3a39daca-95bb-81f3-914d-dd14259a58ed");
    expect(
      parseNotionObjectId(
        "https://www.notion.so/3a39daca95bb81f3914ddd14259a58ed?v=8a8a#collection",
      ),
    ).toBe("3a39daca-95bb-81f3-914d-dd14259a58ed");
  });

  test("keeps the page parser as a compatibility alias", () => {
    expect(parseNotionPageId("3a39daca95bb81f3914ddd14259a58ed")).toBe(
      "3a39daca-95bb-81f3-914d-dd14259a58ed",
    );
  });

  test("rejects missing or ambiguous ids", () => {
    expect(parseNotionObjectId("https://www.notion.so/Books-Tracker")).toBeUndefined();
    expect(
      parseNotionObjectId(
        "3a39daca95bb81f3914ddd14259a58ed 0a39daca95bb81f3914ddd14259a58ed",
      ),
    ).toBeUndefined();
  });
});
