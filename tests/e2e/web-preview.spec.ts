import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

type PreviewFixture = {
  schemaVersion: number;
  [key: string]: unknown;
};

function readPreviewFixture(relativePath: string): PreviewFixture {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
  ) as PreviewFixture;
}

const currentPreviewFixture = readPreviewFixture(
  "../../src/lib/fixtures/reading-preview-v3-current.json"
);
const futurePreviewFixture = readPreviewFixture(
  "../../src/lib/fixtures/reading-preview-future-unknown.json"
);
const legacyPreviewFixture = readPreviewFixture(
  "../../src/lib/fixtures/reading-preview-v2-legacy.json"
);

const mutationCommands = [
  "patch_reading_item_state",
  "remove_reading_item_state",
  "summarize_book_decision"
];

const previewCases = [
  {
    fixture: legacyPreviewFixture,
    visibleTitles: ["旧格式候选", "旧格式待整理"],
    hiddenTitles: [],
    candidateCount: "1",
    organizeCount: "1"
  },
  {
    fixture: currentPreviewFixture,
    visibleTitles: ["三维状态示例"],
    hiddenTitles: [],
    candidateCount: "1",
    organizeCount: "1"
  },
  {
    fixture: futurePreviewFixture,
    visibleTitles: [],
    hiddenTitles: ["未来枚举示例"],
    candidateCount: "0",
    organizeCount: "0"
  }
];

test.describe("Web Preview 只读 smoke", () => {
  for (const previewCase of previewCases) {
    const { fixture } = previewCase;

    test(`loads schema ${fixture.schemaVersion} conservatively without Tauri mutations`, async ({ page }) => {
      const runtimeErrors: string[] = [];
      let previewRequestCount = 0;

      page.on("pageerror", (error) => {
        runtimeErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(message.text());
        }
      });

      await page.route("**/.codex-temp/reading-preview-data.json*", async (route) => {
        previewRequestCount += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(fixture)
        });
      });
      await page.addInitScript(() => {
        delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__;
        delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      });

      const previewResponse = page.waitForResponse((response) =>
        response.url().includes("/.codex-temp/reading-preview-data.json")
      );
      await page.goto("/");
      const response = await previewResponse;
      expect(response.ok()).toBe(true);
      expect(response.status()).toBe(200);

      await expect(page.getByLabel("应用窗口控制").getByText("个人阅读管理")).toBeVisible();
      await expect(page.getByText("先连接微信读书")).toHaveCount(0);
      await expect(page.getByText("已连接本地阅读工作台")).toBeVisible();

      const candidateColumn = page.getByLabel("本地候选", { exact: true });
      const organizeColumn = page.getByLabel("待整理", { exact: true });
      await expect(candidateColumn.locator(".dashboard-queue-column-head span")).toHaveText(
        previewCase.candidateCount
      );
      await expect(organizeColumn.locator(".dashboard-queue-column-head span")).toHaveText(
        previewCase.organizeCount
      );

      for (const title of previewCase.visibleTitles) {
        await expect(page.getByText(title).first()).toBeVisible();
      }
      for (const title of previewCase.hiddenTitles) {
        await expect(page.getByText(title)).toHaveCount(0);
      }

      expect(previewRequestCount).toBeGreaterThan(0);
      expect(runtimeErrors.filter((message) => mutationCommands.some((command) => message.includes(command)))).toEqual([]);
    });
  }
});
