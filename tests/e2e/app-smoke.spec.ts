import { expect, test, type Locator, type Page } from "@playwright/test";
import { auditVisualScroll, type VisualScrollAuditResult } from "./visual-scroll-helpers";

type MockTauriOptions = {
  availableAppUpdate?: boolean;
  hasCredential?: boolean;
  hasAiCredential?: boolean;
  longNoteCardContent?: boolean;
  longBulkExportList?: boolean;
  manyBookReviewSummaries?: boolean;
  bookReviewExportFailure?: boolean;
  bulkExportFailure?: boolean;
  bulkExportCommandFailure?: boolean;
  emptyData?: boolean;
  cachedBookDecision?: boolean;
  staleBookDecision?: boolean;
  internalBookDecisionActions?: boolean;
  manyCandidateBooks?: boolean;
  manyStatsItems?: boolean;
  duplicateDashboardActions?: boolean;
  emptyCandidateStates?: boolean;
  emptyReviewSignals?: boolean;
  noRecentReadingEntries?: boolean;
  failReadingStatsSync?: boolean;
  longStatsAction?: boolean;
  manyReadingAssistantThreads?: boolean;
};

const nowSeconds = 1_725_955_200;

test.describe("个人阅读管理应用 smoke", () => {
  test("首次启动展示设置引导且不暴露密钥", async ({ page }) => {
    await installTauriMock(page, { hasCredential: false });
    await page.goto("/");

    await expect(page.getByLabel("应用窗口控制").getByText("个人阅读管理")).toBeVisible();
    await expect(page.getByLabel("应用窗口控制")).toBeVisible();
    await expect(page.getByLabel("拖动窗口")).toBeVisible();
    await expect(page.getByRole("button", { name: "最小化窗口" })).toBeVisible();
    await expect(page.getByRole("button", { name: "最大化或还原窗口" })).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭窗口" })).toBeVisible();
    await expect(page.locator(".dashboard-status-strip")).toContainText("先连接微信读书");
    await expect(page.getByText("API Key 会保存到本机安全存储")).toBeVisible();
    await expect(page.getByText("sk-e2e-secret")).toHaveCount(0);
    await expect(page.getByLabel("今日可做")).toContainText("先连接微信读书");
    await expect(page.getByLabel("今日可做").locator(".today-action-card")).toHaveCount(1);

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "未保存凭据" })).toBeVisible();
    await expect(page.getByPlaceholder("粘贴 wrk-...，保存后不会再显示")).toBeVisible();
    await openSettingsCategory(page, "AI 设置");
    await expect(page.getByRole("heading", { name: "未配置 AI Provider" })).toBeVisible();
    await expect(page.getByPlaceholder("https://api.openai.com/v1")).toBeVisible();
    await expect(page.getByText("sk-e2e-ai-secret")).toHaveCount(0);
  });

  test("桌面应用壳标题栏下侧边栏和内容区不被裁切", async ({ page }) => {
    await page.setViewportSize({ width: 1195, height: 908 });
    await installTauriMock(page, { hasCredential: false });
    await page.goto("/");

    await expect(page.getByLabel("应用窗口控制")).toBeVisible();
    await expect(page.getByText("API Key 和阅读数据只保存在本机。")).toBeVisible();

    const layout = await page.evaluate(() => {
      const frame = document.querySelector(".app-frame");
      const titlebar = document.querySelector(".app-titlebar");
      const sidebar = document.querySelector(".sidebar");
      const privacyNote = document.querySelector(".privacy-note");
      const workspace = document.querySelector(".workspace");

      if (
        !(frame instanceof HTMLElement) ||
        !(titlebar instanceof HTMLElement) ||
        !(sidebar instanceof HTMLElement) ||
        !(privacyNote instanceof HTMLElement) ||
        !(workspace instanceof HTMLElement)
      ) {
        throw new Error("应用壳布局元素缺失");
      }

      workspace.scrollTop = workspace.scrollHeight;

      return {
        frameBottom: Math.round(frame.getBoundingClientRect().bottom),
        titlebarBottom: Math.round(titlebar.getBoundingClientRect().bottom),
        sidebarTop: Math.round(sidebar.getBoundingClientRect().top),
        sidebarBottom: Math.round(sidebar.getBoundingClientRect().bottom),
        privacyBottom: Math.round(privacyNote.getBoundingClientRect().bottom),
        viewportHeight: window.innerHeight,
        workspaceOverflowY: window.getComputedStyle(workspace).overflowY,
        workspaceScrollTop: Math.round(workspace.scrollTop)
      };
    });

    expect(layout.frameBottom).toBe(layout.viewportHeight);
    expect(layout.sidebarTop).toBe(layout.titlebarBottom);
    expect(layout.sidebarBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.privacyBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.workspaceOverflowY).toBe("auto");
    expect(layout.workspaceScrollTop).toBeGreaterThan(0);
  });

  test("侧边栏和内容区滚动条默认隐藏并在交互时显现", async ({ page }) => {
    await page.setViewportSize({ width: 1195, height: 908 });
    await installTauriMock(page, { hasCredential: false });
    await page.goto("/");

    const readScrollbarOpacity = async (selector: string) =>
      page.locator(selector).evaluate((element) =>
        window.getComputedStyle(element).getPropertyValue("--scrollbar-thumb-opacity").trim()
      );

    await expect(page.locator(".workspace")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(await readScrollbarOpacity(".sidebar")).toBe("0");
    await expect(await readScrollbarOpacity(".workspace")).toBe("0");

    await page.locator(".workspace").hover();
    await expect(await readScrollbarOpacity(".workspace")).toBe("1");

    await page.locator(".sidebar").getByRole("button", { name: "总览" }).focus();
    await expect(await readScrollbarOpacity(".sidebar")).toBe("1");
  });

  test("默认桌面窗口下总览洞察卡保持单行展示", async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 820 });
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("下周期建议")).toContainText("保留固定深度阅读时段");
    await expect(page.locator(".dashboard-recommend-card")).toBeVisible();

    const insightLayout = await page.evaluate(() => {
      const cards = [
        document.querySelector(".dashboard-profile-card"),
        document.querySelector(".dashboard-next-review-card"),
        document.querySelector(".dashboard-recommend-card")
      ];

      return cards.map((card) => {
        const rect = card?.getBoundingClientRect();
        return {
          top: Math.round(rect?.top ?? -1),
          height: Math.round(rect?.height ?? -1)
        };
      });
    });
    expect(new Set(insightLayout.map((card) => card.top)).size).toBe(1);
    expect(new Set(insightLayout.map((card) => card.height)).size).toBe(1);

    const profileEvidenceWhiteSpace = await page
      .locator(".dashboard-profile-dimension")
      .first()
      .evaluate((item) => window.getComputedStyle(item).whiteSpace);
    expect(profileEvidenceWhiteSpace).not.toBe("nowrap");
  });

  test("统计页作者分类和长读书目使用卡片内滚动", async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 820 });
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    await openPrimaryNav(page, "统计");

    await expect(page.getByLabel("作者偏好")).toContainText("刘慈欣");
    await expect(page.getByLabel("分类偏好")).toContainText("历史");
    await expect(page.getByLabel("长读书目")).toContainText("长读样本 12");

    const scrollState = await page.evaluate(() => {
      const readScrollState = (label: string) => {
        const list = document.querySelector(`[aria-label="${label}"] .stats-scroll-list`);
        if (!(list instanceof HTMLElement)) {
          return null;
        }

        const style = window.getComputedStyle(list);
        return {
          canScroll: list.scrollHeight > list.clientHeight,
          overflowY: style.overflowY
        };
      };

      return {
        authors: readScrollState("作者偏好"),
        categories: readScrollState("分类偏好"),
        longest: readScrollState("长读书目")
      };
    });

    expect(scrollState.authors).toEqual({ canScroll: true, overflowY: "auto" });
    expect(scrollState.categories).toEqual({ canScroll: true, overflowY: "auto" });
    expect(scrollState.longest).toEqual({ canScroll: true, overflowY: "auto" });

    const preferenceWidths = await page.evaluate(() => {
      const authorCard = document.querySelector('[aria-label="作者偏好"]');
      const categoryCard = document.querySelector('[aria-label="分类偏好"]');
      const layout = document.querySelector(".stats-layout");

      return {
        author: Math.round(authorCard?.getBoundingClientRect().width ?? 0),
        category: Math.round(categoryCard?.getBoundingClientRect().width ?? 0),
        layout: Math.round(layout?.getBoundingClientRect().width ?? 0)
      };
    });

    expect(preferenceWidths.author).toBeGreaterThanOrEqual(preferenceWidths.layout - 2);
    expect(preferenceWidths.category).toBeGreaterThanOrEqual(preferenceWidths.layout - 2);
  });

  test("统计页总计模式表达长期阅读成果", async ({ page }) => {
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    await openPrimaryNav(page, "统计");
    await page.getByRole("tab", { name: /总计/ }).click();

    await expect(page.getByRole("heading", { name: "长期阅读成果" })).toBeVisible();
    await expect(page.locator(".stats-hero-copy")).toContainText("累计成果");
    await expect(page.getByLabel("统计摘要")).toContainText("累计时长");
    await expect(page.getByLabel("统计摘要")).toContainText("长期阅读天数");
    await expect(page.getByLabel("统计摘要")).toContainText("代表方向");
    await expect(page.getByLabel("统计摘要")).toContainText("长读书目");
    await expect(page.getByLabel("统计摘要")).not.toContainText("自然日均");
    await expect(page.getByLabel("统计摘要")).not.toContainText("环比");
    await expect(page.getByLabel("本地统计解读")).toContainText("长期投入方向");
    await expect(page.getByLabel("本地统计解读")).toContainText("长期代表书目");
    await expect(page.getByLabel("本地统计解读")).not.toContainText("本周期");
    await expect(page.getByLabel("本地统计解读")).not.toContainText("周期变化");
    await expect(page.getByLabel("作者偏好")).toContainText("长期常读作者");
    await expect(page.getByLabel("分类偏好")).toContainText("长期分类投入");
    await expect(page.getByLabel("长读书目")).toContainText("长期长读书目");
  });

  test("移动端阅读报告生成类型步骤可点击并可滚动", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    await openPrimaryNav(page, "统计");
    await page.getByRole("button", { name: "生成阅读报告" }).click();

    const dialog = page.getByRole("dialog", { name: "阅读报告生成" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /下一步：选择月报时间/ })).toBeVisible();

    const overlayLayer = await readOverlayZIndexes(page, ".reading-route-dialog-backdrop");

    expect(overlayLayer.backdrop).toBeGreaterThan(overlayLayer.bottomNav);
    expect(overlayLayer.backdrop).toBeGreaterThan(overlayLayer.assistantLauncher);

    const kindSelectorScroll = await dialog.locator(".monthly-report-kind-selector").evaluate((element) => {
      const selector = element as HTMLElement;
      selector.scrollTop = selector.scrollHeight;
      return {
        canScroll: selector.scrollHeight > selector.clientHeight,
        overflowY: window.getComputedStyle(selector).overflowY,
        scrollTop: Math.round(selector.scrollTop)
      };
    });

    expect(kindSelectorScroll.canScroll).toBe(true);
    expect(kindSelectorScroll.overflowY).toBe("auto");
    expect(kindSelectorScroll.scrollTop).toBeGreaterThan(0);

    const monthlyOption = dialog.locator(".monthly-report-kind-selector button", { hasText: "月报" });
    await monthlyOption.click();
    await expect(monthlyOption).toHaveClass(/is-active/);

    await dialog.getByRole("button", { name: /下一步：选择月报时间/ }).click();
    await expect(dialog.getByLabel("阅读报告周期选择")).toBeVisible();
  });

  test("阅读报告预览三种形态保持居中且移动端无横向溢出", async ({ browser, page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    const desktopDialog = await openMonthlyReportPreview(page);
    await expectReportPreviewModeCentered(desktopDialog, "poster");
    await desktopDialog.getByRole("tab", { name: "轮播报告" }).click();
    await expectReportPreviewModeCentered(desktopDialog, "cards");
    await desktopDialog.getByRole("tab", { name: "16:9 报告" }).click();
    await expectReportPreviewModeCentered(desktopDialog, "wide");

    const mobileContext = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await mobileContext.newPage();

    try {
      await installTauriMock(mobilePage, { manyStatsItems: true });
      await mobilePage.goto("/");

      const mobileDialog = await openMonthlyReportPreview(mobilePage);
      await expectReportPreviewModeCentered(mobileDialog, "poster");
      await mobileDialog.getByRole("tab", { name: "轮播报告" }).tap();
      await expectReportPreviewModeCentered(mobileDialog, "cards");
      await mobileDialog.getByRole("tab", { name: "16:9 报告" }).tap();
      await expectReportPreviewModeCentered(mobileDialog, "wide");
      await mobileDialog.getByRole("button", { name: "下载横版 PNG" }).tap();
      await expect(
        mobilePage.getByLabel("通知").getByText(/已导出：周期阅读报告/)
      ).toBeVisible();
      const toastLayer = await mobilePage.evaluate(() => {
        const backdrop = document.querySelector<HTMLElement>(".reading-route-dialog-backdrop");
        const dialogElement = document.querySelector<HTMLElement>(".monthly-report-poster-dialog");
        const toastViewport = document.querySelector<HTMLElement>(".toast-viewport");
        const toastCard = document.querySelector<HTMLElement>(".toast-card");
        if (!backdrop || !dialogElement || !toastViewport || !toastCard) {
          throw new Error("阅读报告下载提示层级元素缺失");
        }

        const readZIndex = (element: HTMLElement) => Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        const toastRect = toastCard.getBoundingClientRect();
        return {
          backdrop: readZIndex(backdrop),
          dialogTop: Math.round(dialogElement.getBoundingClientRect().top),
          toast: readZIndex(toastViewport),
          toastBottom: Math.round(toastRect.bottom),
          toastTop: Math.round(toastRect.top),
          viewportHeight: window.innerHeight
        };
      });
      expect(toastLayer.toast).toBeGreaterThan(toastLayer.backdrop);
      expect(toastLayer.toastTop).toBeGreaterThanOrEqual(0);
      expect(toastLayer.toastBottom).toBeLessThanOrEqual(toastLayer.viewportHeight);

      const mobileOverflow = await mobilePage.evaluate(() => ({
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }));
      expect(mobileOverflow.hasHorizontalOverflow).toBe(false);
      expect(mobileOverflow.scrollWidth).toBeLessThanOrEqual(mobileOverflow.viewportWidth);
    } finally {
      await mobileContext.close();
    }
  });

  test("移动端阻塞式弹层覆盖阅读助手并保留内容滚动", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page, { longBulkExportList: true });
    await page.goto("/");

    await page.getByLabel("打开 AI 阅读助手").click();
    const assistantPanel = page.getByRole("complementary", { name: "AI 阅读助手" });
    await expect(assistantPanel).toBeVisible();
    const assistantPanelZIndex = await assistantPanel.evaluate((element) =>
      Number.parseInt(window.getComputedStyle(element).zIndex, 10)
    );
    const assistantTouchTargets = await assistantPanel.evaluate((element) => {
      const closeButton = element.querySelector<HTMLElement>('button[aria-label="关闭 AI 阅读助手"]');
      const sendButton = element.querySelector<HTMLElement>(".reading-assistant-send-button");
      if (!closeButton || !sendButton) {
        throw new Error("阅读助手高频操作按钮缺失");
      }

      const closeRect = closeButton.getBoundingClientRect();
      const sendRect = sendButton.getBoundingClientRect();
      return {
        closeHeight: Math.round(closeRect.height),
        closeWidth: Math.round(closeRect.width),
        sendHeight: Math.round(sendRect.height),
        sendWidth: Math.round(sendRect.width)
      };
    });
    expect(assistantTouchTargets.closeWidth).toBeGreaterThanOrEqual(44);
    expect(assistantTouchTargets.closeHeight).toBeGreaterThanOrEqual(44);
    expect(assistantTouchTargets.sendWidth).toBeGreaterThanOrEqual(44);
    expect(assistantTouchTargets.sendHeight).toBeGreaterThanOrEqual(44);
    await assistantPanel.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    const bulkExportDialog = page.getByRole("dialog", { name: "批量导出向导" });
    await expect(bulkExportDialog).toBeVisible();

    const bulkExportLayers = await readOverlayZIndexes(page, ".bulk-export-backdrop");
    expect(bulkExportLayers.backdrop).toBeGreaterThan(assistantPanelZIndex);
    expect(bulkExportLayers.backdrop).toBeGreaterThan(bulkExportLayers.assistantLauncher);
    expect(bulkExportLayers.backdrop).toBeGreaterThan(bulkExportLayers.bottomNav);

    const bulkExportScroll = await bulkExportDialog.locator(".bulk-export-list").evaluate((element) => {
      const list = element as HTMLElement;
      list.scrollTop = list.scrollHeight;
      return {
        canScroll: list.scrollHeight > list.clientHeight,
        overflowY: window.getComputedStyle(list).overflowY,
        scrollTop: Math.round(list.scrollTop)
      };
    });
    expect(bulkExportScroll.canScroll).toBe(true);
    expect(bulkExportScroll.overflowY).toBe("auto");
    expect(bulkExportScroll.scrollTop).toBeGreaterThan(0);
    await bulkExportDialog.getByRole("button", { name: "关闭批量导出向导" }).click();

    await page.getByRole("navigation", { name: "移动端主导航" }).getByRole("button", { name: "书架" }).click();
    await page.getByLabel("书架条目").getByRole("button", { name: /深度工作/ }).click();
    await page.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
    await page
      .getByLabel("本书指南图")
      .getByRole("button", { name: /查看读完第 2 章到第 3 章的完整阅读节点详情/ })
      .click();

    const guideNodeDialog = page.getByRole("dialog", { name: "读完第 2 章到第 3 章" });
    await expect(guideNodeDialog).toBeVisible();
    const guideNodeLayers = await readOverlayZIndexes(page, ".reading-guide-node-dialog-backdrop");
    expect(guideNodeLayers.backdrop).toBeGreaterThan(assistantPanelZIndex);
    expect(guideNodeLayers.backdrop).toBeGreaterThan(guideNodeLayers.assistantLauncher);
    expect(guideNodeLayers.backdrop).toBeGreaterThan(guideNodeLayers.bottomNav);
    await expect(guideNodeDialog.locator(".reading-guide-node-dialog-body")).toHaveCSS("overflow-y", "auto");
    await guideNodeDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(guideNodeDialog).toHaveCount(0);
  });

  test("移动端横屏短视口下设置与阅读报告保持可滚动", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    await openPrimaryNav(page, "设置");
    const settingsDialog = page.getByRole("dialog", { name: "设置" });
    await expect(settingsDialog).toBeVisible();

    const settingsLayout = await settingsDialog.evaluate((dialog) => {
      const content = dialog.querySelector<HTMLElement>(".settings-modal-content");
      const closeButton = dialog.querySelector<HTMLElement>(".settings-modal-close");
      if (!content || !closeButton) {
        throw new Error("设置内容滚动容器或关闭按钮缺失");
      }

      content.scrollTop = content.scrollHeight;
      const rect = dialog.getBoundingClientRect();
      const closeRect = closeButton.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        canScroll: content.scrollHeight > content.clientHeight,
        closeHeight: Math.round(closeRect.height),
        closeWidth: Math.round(closeRect.width),
        height: Math.round(rect.height),
        overflowY: window.getComputedStyle(content).overflowY,
        scrollTop: Math.round(content.scrollTop),
        top: Math.round(rect.top),
        viewportHeight: window.innerHeight
      };
    });

    expect(settingsLayout.top).toBe(0);
    expect(settingsLayout.bottom).toBe(settingsLayout.viewportHeight);
    expect(settingsLayout.height).toBe(settingsLayout.viewportHeight);
    expect(settingsLayout.canScroll).toBe(true);
    expect(settingsLayout.overflowY).toBe("auto");
    expect(settingsLayout.scrollTop).toBeGreaterThan(0);
    expect(settingsLayout.closeWidth).toBeGreaterThanOrEqual(44);
    expect(settingsLayout.closeHeight).toBeGreaterThanOrEqual(44);
    await settingsDialog.getByRole("button", { name: "关闭设置" }).click();

    await openPrimaryNav(page, "统计");
    await page.getByRole("button", { name: "生成阅读报告" }).click();
    const reportDialog = page.getByRole("dialog", { name: "阅读报告生成" });
    await expect(reportDialog).toBeVisible();

    const reportLayout = await reportDialog.evaluate((dialog) => {
      const selector = dialog.querySelector<HTMLElement>(".monthly-report-kind-selector");
      if (!selector) {
        throw new Error("阅读报告类型滚动容器缺失");
      }

      selector.scrollTop = selector.scrollHeight;
      const rect = dialog.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        canScroll: selector.scrollHeight > selector.clientHeight,
        overflowY: window.getComputedStyle(selector).overflowY,
        scrollTop: Math.round(selector.scrollTop),
        top: Math.round(rect.top),
        viewportHeight: window.innerHeight
      };
    });

    expect(reportLayout.top).toBeGreaterThanOrEqual(0);
    expect(reportLayout.bottom).toBeLessThanOrEqual(reportLayout.viewportHeight);
    expect(reportLayout.canScroll).toBe(true);
    expect(reportLayout.overflowY).toBe("auto");
    expect(reportLayout.scrollTop).toBeGreaterThan(0);
    await reportDialog.getByRole("button", { name: /下一步：选择月报时间/ }).click();
    await expect(reportDialog.getByLabel("阅读报告周期选择")).toBeVisible();
  });

  test("触屏设备可发现并使用推荐卡片更多操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    await installTauriMock(mobilePage, { emptyCandidateStates: true });
    await mobilePage.goto("/");
    await openPrimaryNav(mobilePage, "发现");

    const recommendationCard = mobilePage.locator(".recommendation-rail-card", { hasText: "月亮与六便士" });
    const recommendationCopy = recommendationCard.locator(".recommendation-rail-copy");
    const menu = recommendationCard.locator(".recommendation-rail-menu");
    const menuTrigger = recommendationCard.getByRole("button", { name: "月亮与六便士 更多操作" });

    await expect(recommendationCard).toBeVisible();
    await expect(recommendationCopy).toHaveCSS("opacity", "1");
    await expect(recommendationCopy).toContainText("月亮与六便士");
    await expect(recommendationCopy).toContainText("你常读文学和思考类作品");
    await expect(menu).toHaveCSS("opacity", "1");
    await expect(menu).toHaveCSS("pointer-events", "auto");

    const triggerBox = await menuTrigger.boundingBox();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await menuTrigger.tap();
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");
    const recommendationRail = mobilePage.locator(".recommendation-list--rail .recommendation-stack");
    const menuPopover = recommendationCard.getByRole("menu", { name: "月亮与六便士 操作菜单" });
    const saveCandidate = recommendationCard.getByRole("menuitem", { name: "保存候选" });
    const railBox = await recommendationRail.boundingBox();
    const activeTriggerBox = await menuTrigger.boundingBox();
    const popoverBox = await menuPopover.boundingBox();
    expect(popoverBox?.y ?? 0).toBeGreaterThanOrEqual(
      (activeTriggerBox?.y ?? 0) + (activeTriggerBox?.height ?? 0)
    );
    expect(popoverBox?.x ?? 0).toBeGreaterThanOrEqual(railBox?.x ?? 0);
    expect((popoverBox?.x ?? 0) + (popoverBox?.width ?? 0)).toBeLessThanOrEqual(
      (railBox?.x ?? 0) + (railBox?.width ?? 0)
    );
    await expect(saveCandidate).toBeVisible();
    await saveCandidate.tap();

    await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(mobilePage.getByLabel("通知").getByText("已保存《月亮与六便士》到本地候选")).toBeVisible();

    await mobilePage
      .getByRole("navigation", { name: "移动端主导航" })
      .getByRole("button", { name: "书架" })
      .tap();
    const articleCard = mobilePage.locator(".shelf-card--menu-card", { hasText: "文章收藏" });
    const articleMenuTrigger = articleCard.getByRole("button", { name: "文章收藏 更多操作" });
    await expect(articleCard).toBeVisible();
    const articleTriggerBox = await articleMenuTrigger.boundingBox();
    expect(articleTriggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(articleTriggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test("桌面推荐卡片隐藏菜单不截获指针且支持键盘聚焦", async ({ page }) => {
    await installTauriMock(page, { emptyCandidateStates: true });
    await page.goto("/");
    await openPrimaryNav(page, "发现");

    const recommendationCard = page.locator(".recommendation-rail-card", { hasText: "月亮与六便士" });
    const recommendationCopy = recommendationCard.locator(".recommendation-rail-copy");
    const menu = recommendationCard.locator(".recommendation-rail-menu");
    const menuTrigger = recommendationCard.getByRole("button", { name: "月亮与六便士 更多操作" });

    await expect(recommendationCard).toBeVisible();
    await expect(recommendationCopy).toHaveCSS("opacity", "0");
    await expect(menu).toHaveCSS("opacity", "0");
    await expect(menu).toHaveCSS("pointer-events", "none");

    await menuTrigger.focus();
    await expect(recommendationCopy).toHaveCSS("opacity", "1");
    await expect(menu).toHaveCSS("opacity", "1");
    await expect(menu).toHaveCSS("pointer-events", "auto");
  });

  test("触屏设备点击阅读人格插图可查看说明", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    await installTauriMock(mobilePage, { manyStatsItems: true });
    await mobilePage.goto("/");
    await openReadingReviewSubNav(mobilePage, "阅读报告");

    const profileVisual = mobilePage.locator(".review-profile-visual");
    const profileTip = profileVisual.locator(".review-profile-visual-tip");
    await expect(profileVisual).toBeVisible();
    await expect(profileTip).toHaveCSS("opacity", "0");

    await profileVisual.tap();
    await expect(profileTip).toHaveCSS("opacity", "1");
    await context.close();
  });

  test("触屏短视口下 AI 阅读助手输入区和模型菜单保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { hasCredential: true, hasAiCredential: true });
      await mobilePage.goto("/");
      await mobilePage.getByLabel("打开 AI 阅读助手").tap();

      const readingAssistant = mobilePage.getByRole("complementary", { name: "AI 阅读助手" });
      await expect(readingAssistant).toBeVisible();

      const composerLayout = await readingAssistant.evaluate((panel) => {
        const messages = panel.querySelector<HTMLElement>(".reading-assistant-messages");
        const suggestions = panel.querySelector<HTMLElement>(".reading-assistant-suggestions");
        const composer = panel.querySelector<HTMLElement>(".reading-assistant-composer");
        const chip = panel.querySelector<HTMLElement>(".reading-assistant-model-chip");
        const send = panel.querySelector<HTMLElement>(".reading-assistant-send-button");
        if (!messages || !suggestions || !composer || !chip || !send) {
          throw new Error("AI 阅读助手短视口布局元素缺失");
        }

        const panelRect = panel.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const sendRect = send.getBoundingClientRect();

        return {
          chipHeight: Math.round(chipRect.height),
          chipWidth: Math.round(chipRect.width),
          composerBottom: Math.round(composerRect.bottom),
          composerTop: Math.round(composerRect.top),
          messagesHeight: Math.round(messages.getBoundingClientRect().height),
          messagesOverflowY: window.getComputedStyle(messages).overflowY,
          panelBottom: Math.round(panelRect.bottom),
          panelTop: Math.round(panelRect.top),
          sendBottom: Math.round(sendRect.bottom),
          sendHeight: Math.round(sendRect.height),
          sendTop: Math.round(sendRect.top),
          sendWidth: Math.round(sendRect.width),
          suggestionsDisplay: window.getComputedStyle(suggestions).display,
          viewportHeight: window.innerHeight
        };
      });

      expect(composerLayout.panelTop).toBeGreaterThanOrEqual(0);
      expect(composerLayout.panelBottom).toBeLessThanOrEqual(composerLayout.viewportHeight);
      expect(composerLayout.composerTop).toBeGreaterThanOrEqual(composerLayout.panelTop);
      expect(composerLayout.composerBottom).toBeLessThanOrEqual(composerLayout.panelBottom);
      expect(composerLayout.sendTop).toBeGreaterThanOrEqual(composerLayout.panelTop);
      expect(composerLayout.sendBottom).toBeLessThanOrEqual(composerLayout.panelBottom);
      expect(composerLayout.messagesHeight).toBeGreaterThan(0);
      expect(composerLayout.messagesOverflowY).toBe("auto");
      expect(composerLayout.suggestionsDisplay).toBe("none");
      expect(composerLayout.chipWidth).toBeGreaterThanOrEqual(44);
      expect(composerLayout.chipHeight).toBeGreaterThanOrEqual(44);
      expect(composerLayout.sendWidth).toBeGreaterThanOrEqual(44);
      expect(composerLayout.sendHeight).toBeGreaterThanOrEqual(44);

      await readingAssistant.locator(".reading-assistant-model-chip").tap();
      const modelMenu = readingAssistant.getByRole("menu", { name: "当前模型" });
      await expect(modelMenu).toBeVisible();

      const modelMenuLayout = await readingAssistant.evaluate((panel) => {
        const chip = panel.querySelector<HTMLElement>(".reading-assistant-model-chip");
        const menu = panel.querySelector<HTMLElement>(".reading-assistant-model-menu");
        const actions = Array.from(
          panel.querySelectorAll<HTMLElement>(".reading-assistant-model-menu-actions button")
        );
        if (!chip || !menu || actions.length === 0) {
          throw new Error("AI 阅读助手模型菜单元素缺失");
        }

        const panelRect = panel.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        return {
          actionRects: actions.map((action) => {
            const rect = action.getBoundingClientRect();
            return {
              height: Math.round(rect.height),
              width: Math.round(rect.width)
            };
          }),
          menuBottom: Math.round(menuRect.bottom),
          menuLeft: Math.round(menuRect.left),
          menuRight: Math.round(menuRect.right),
          menuTop: Math.round(menuRect.top),
          overlapsChip:
            menuRect.left < chipRect.right &&
            menuRect.right > chipRect.left &&
            menuRect.top < chipRect.bottom &&
            menuRect.bottom > chipRect.top,
          panelBottom: Math.round(panelRect.bottom),
          panelTop: Math.round(panelRect.top),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      });

      expect(modelMenuLayout.menuTop).toBeGreaterThanOrEqual(modelMenuLayout.panelTop);
      expect(modelMenuLayout.menuBottom).toBeLessThanOrEqual(modelMenuLayout.panelBottom);
      expect(modelMenuLayout.menuLeft).toBeGreaterThanOrEqual(0);
      expect(modelMenuLayout.menuRight).toBeLessThanOrEqual(modelMenuLayout.viewportWidth);
      expect(modelMenuLayout.menuBottom).toBeLessThanOrEqual(modelMenuLayout.viewportHeight);
      expect(modelMenuLayout.overlapsChip).toBe(false);
      for (const actionRect of modelMenuLayout.actionRects) {
        expect(actionRect.width).toBeGreaterThanOrEqual(44);
        expect(actionRect.height).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  });

  test("AI 阅读助手按分类列出本地可验证书目", async ({ page }) => {
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);
    await sendReadingAssistantMessage(readingAssistant, "我读过哪些理财类书籍");

    await expect(readingAssistant).toContainText("小狗钱钱");
    await expect(readingAssistant).toContainText("博多·舍费尔");
    await expect(readingAssistant).toContainText("经济理财 · 本地可列 1 本 / 统计 4 本");
    await expect(readingAssistant).toContainText("统计阅读时长 3小时28分钟");
    await expect(readingAssistant).not.toContainText("无法一一列举");

    await readingAssistant.getByRole("button", { name: /小狗钱钱/ }).click();
    await expect(readingAssistant).toHaveCount(0);
    const bookDetailPage = page.getByRole("region", { name: "书籍详情", exact: true });
    await expect(bookDetailPage).toContainText("小狗钱钱");
    await expect(bookDetailPage).toContainText("博多·舍费尔");
  });

  test("AI 阅读助手可编辑最后一条用户消息并重新生成", async ({ page }) => {
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);
    await sendReadingAssistantMessage(readingAssistant, "解释一下我的阅读节奏");
    await expect(readingAssistant).toContainText("阅读节奏说明：当前周期比较稳定。");
    await expect(readingAssistant.locator(".reading-assistant-message.is-pending")).toHaveCount(0);

    await readingAssistant.getByRole("button", { name: "编辑这条消息" }).click();
    const editTextarea = readingAssistant.locator(".reading-assistant-message-edit textarea");
    await expect(editTextarea).toHaveValue("解释一下我的阅读节奏");
    await expect(readingAssistant.locator(".reading-assistant-message-edit-save")).toHaveCount(1);
    await editTextarea.fill("帮我列一个复盘问题");
    await readingAssistant.locator(".reading-assistant-message-edit-save").click();

    await expect(readingAssistant).toContainText("复盘问题说明：先处理一个关键问题。");
    await expect(readingAssistant).toContainText("帮我列一个复盘问题");
    await expect(readingAssistant).not.toContainText("阅读节奏说明：当前周期比较稳定。");
    await expect(readingAssistant).not.toContainText("解释一下我的阅读节奏");

    const args = await getLastInvokeArgs(page, "ask_reading_assistant_stream");
    expect(args.request.request.replaceFromMessageId).toBe("assistant-user-message-edit-original");
  });

  test("AI 阅读助手历史支持搜索、场景筛选和打开对话", async ({ page }) => {
    await installTauriMock(page, { manyStatsItems: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);

    await readingAssistant.getByRole("button", { name: "查看最近对话" }).click();
    await expect(readingAssistant).toContainText("3 / 3 个会话");
    await expect(readingAssistant.getByRole("button", { name: "当前对象" })).toHaveCount(0);
    await expect(readingAssistant).toContainText("深度工作复盘追问");
    await expect(readingAssistant).toContainText("统计阅读节奏");
    await expect(readingAssistant).toContainText("候选书决策");

    await readingAssistant.getByPlaceholder("搜索标题或场景").fill("深度");
    await expect(readingAssistant).toContainText("1 / 3 个会话");
    await expect(readingAssistant).toContainText("深度工作复盘追问");
    await expect(readingAssistant).not.toContainText("候选书决策");

    await readingAssistant.getByPlaceholder("搜索标题或场景").fill("");
    await readingAssistant.getByLabel("按场景筛选").getByRole("button", { name: "统计" }).click();
    await expect(readingAssistant).toContainText("1 / 3 个会话");
    await expect(readingAssistant).toContainText("统计阅读节奏");
    await expect(readingAssistant).not.toContainText("深度工作复盘追问");

    await readingAssistant.getByRole("button", { name: /统计阅读节奏/ }).click();
    await expect(readingAssistant).toContainText("统计历史问题");
    await expect(readingAssistant).toContainText("统计历史回答");
  });

  test("AI 阅读助手历史在 50 个线程下仍可搜索、筛选和打开", async ({ page }) => {
    await installTauriMock(page, { manyReadingAssistantThreads: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);

    await readingAssistant.getByRole("button", { name: "查看最近对话" }).click();
    await expect(readingAssistant).toContainText("50 / 50 个会话");
    const isScrollable = await readingAssistant.locator(".reading-assistant-thread-list").evaluate((list) => {
      return list.scrollHeight > list.clientHeight;
    });
    expect(isScrollable).toBe(true);

    await readingAssistant.getByPlaceholder("搜索标题或场景").fill("压力线程 42");
    await expect(readingAssistant).toContainText("1 / 50 个会话");
    await expect(readingAssistant).toContainText("压力线程 42");

    await readingAssistant.getByPlaceholder("搜索标题或场景").fill("");
    await readingAssistant.getByLabel("按场景筛选").getByRole("button", { name: "统计" }).click();
    await expect(readingAssistant).toContainText("10 / 50 个会话");
    await expect(readingAssistant).toContainText("压力线程 04 统计");

    await readingAssistant.getByRole("button", { name: /压力线程 04 统计/ }).click();
    await expect(readingAssistant).toContainText("压力线程 04 用户问题");
    await expect(readingAssistant).toContainText("压力线程 04 历史回答");
  });

  test("AI 阅读助手历史可只看当前对象对话", async ({ page }) => {
    await installTauriMock(page, { manyReadingAssistantThreads: true });
    await page.goto("/");

    await openDeepWorkDetailForAudit(page);
    await page.getByLabel("打开 AI 阅读助手").click();
    const readingAssistant = page.getByRole("complementary", { name: "AI 阅读助手" });
    await expect(readingAssistant).toBeVisible();

    await readingAssistant.getByRole("button", { name: "查看最近对话" }).click();
    await expect(readingAssistant).toContainText("50 / 50 个会话");

    await readingAssistant.getByRole("button", { name: "当前对象" }).click();
    await expect(readingAssistant).toContainText("5 / 50 个会话");
    await expect(readingAssistant).toContainText("压力线程 02 当前书");
    await expect(readingAssistant).toContainText("压力线程 42 当前书");
    await expect(readingAssistant).not.toContainText("压力线程 07 其他书");
    await expect(readingAssistant).not.toContainText("压力线程 04 统计");
  });

  test("AI 阅读助手模型控件位于输入框并可进入模型设置", async ({ page }) => {
    await installTauriMock(page, { hasCredential: true, hasAiCredential: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);

    await expect(readingAssistant.locator(".reading-assistant-model-status")).toHaveCount(0);
    await expect(readingAssistant.locator(".reading-assistant-composer")).toContainText("gpt-4o-mini");
    await expect(readingAssistant.locator(".reading-assistant-composer")).toContainText("自动");

    await readingAssistant.locator(".reading-assistant-model-chip").click();
    const modelMenu = readingAssistant.getByRole("menu", { name: "当前模型" });
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu).toContainText("当前模型");
    await expect(modelMenu).toContainText("gpt-4o-mini");

    await modelMenu.getByRole("menuitem", { name: "模型设置" }).click();
    await expect(readingAssistant).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await expect(page.locator('input[value="https://api.openai.com/v1"]')).toBeVisible();
    await expect(page.locator('input[value="gpt-4o-mini"]')).toBeVisible();
  });

  test("AI 阅读助手普通问答显示流式增量内容", async ({ page }) => {
    await installTauriMock(page, { hasCredential: true, hasAiCredential: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);
    await sendReadingAssistantMessage(readingAssistant, "测试普通问答流式输出");

    await expect(readingAssistant).toContainText("流式片段");
    await expect(readingAssistant).toContainText("流式片段最终完成。");
    const answerListItems = readingAssistant.locator(".reading-assistant-markdown-lite ol li");
    await expect(answerListItems).toHaveCount(2);
    await expect(answerListItems.nth(1)).toHaveText("保留编号列表");
    await expect(await getInvokeCount(page, "ask_reading_assistant_stream")).toBeGreaterThan(0);
  });

  test("AI 阅读助手生成中禁用模型菜单动作并支持取消生成", async ({ page }) => {
    await installTauriMock(page, { hasCredential: true, hasAiCredential: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);
    await sendReadingAssistantMessage(readingAssistant, "测试长时间生成取消");

    await expect(readingAssistant).toContainText("生成中片段");
    await readingAssistant.locator(".reading-assistant-model-chip").click();
    const modelMenu = readingAssistant.getByRole("menu", { name: "当前模型" });
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu.getByRole("menuitem", { name: "模型设置" })).toBeDisabled();
    await expect(modelMenu.getByRole("menuitem", { name: "刷新状态" })).toBeDisabled();

    await readingAssistant.getByRole("button", { name: "取消生成" }).click();
    await expect(readingAssistant).not.toContainText("生成中片段");
    await expect(readingAssistant).not.toContainText("取消后不应显示");
    await expect(await getInvokeCount(page, "cancel_reading_assistant_stream")).toBe(1);
  });

  test("AI 阅读助手新书推荐支持流式增量和结构化推荐卡片", async ({ page }) => {
    await installTauriMock(page, { hasCredential: true, hasAiCredential: true });
    await page.goto("/");

    const readingAssistant = await openReadingAssistantFromStats(page);
    await sendReadingAssistantMessage(readingAssistant, "测试新书推荐流式输出");

    await expect(readingAssistant).toContainText("新书推荐片段");
    await expect(readingAssistant).toContainText("新书推荐片段最终完成。");
    await expect(readingAssistant.locator(".reading-assistant-recommendation-item")).toContainText(
      "可能性的艺术"
    );
    await expect(readingAssistant.locator(".reading-assistant-recommendation-item")).toContainText(
      "作者甲"
    );
    await expect(readingAssistant).toContainText("为什么推荐");
    await expect(readingAssistant.locator(".reading-assistant-recommendation-footer")).toBeVisible();
    await expect(readingAssistant).toContainText("加入候选");
  });

  test("总览今日可做同一本书只保留一个主动作", async ({ page }) => {
    await installTauriMock(page, { duplicateDashboardActions: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("继续看《深度工作》");
    await expect(todayActions).not.toContainText("复盘《深度工作》");
    await expect(todayActions).toContainText("复盘《代码整洁之道》");

    const actionTitles = await todayActions.locator(".today-action-card strong").allTextContents();
    expect(actionTitles.length).toBeLessThanOrEqual(5);
    expect(actionTitles.filter((title) => title.includes("深度工作"))).toHaveLength(1);
  });

  test("总览以今日最值得做主卡承接最高优先级动作", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const workbench = page.getByLabel("今日阅读工作台");
    const primaryAction = workbench.locator(".daily-workbench-primary");

    await expect(workbench.getByRole("heading", { name: "今日最值得做" })).toBeVisible();
    await expect(primaryAction).toContainText("继续看《深度工作》");
    await expect(primaryAction).toContainText("为什么现在做");
    await expect(primaryAction).toContainText("完成后得到");
    await expect(workbench.getByLabel("备选动作")).toContainText("复盘《代码整洁之道》");
    await expect(workbench.getByLabel("备选动作")).toContainText("执行统计建议");

    const layout = await page.evaluate(() => {
      const workbenchPanel = document.querySelector(".daily-workbench-panel");
      const auxiliaryPanel = document.querySelector(".today-actions-panel");

      if (!(workbenchPanel instanceof HTMLElement) || !(auxiliaryPanel instanceof HTMLElement)) {
        throw new Error("今日阅读工作台布局元素缺失");
      }

      return {
        workbenchTop: Math.round(workbenchPanel.getBoundingClientRect().top),
        auxiliaryTop: Math.round(auxiliaryPanel.getBoundingClientRect().top)
      };
    });

    expect(layout.workbenchTop).toBeLessThan(layout.auxiliaryTop);

    await workbench.getByRole("button", { name: /继续看《深度工作》/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
  });

  test("总览今日工作台在桌面和窄屏下保持可读布局", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("今日阅读工作台")).toContainText("继续看《深度工作》");
    await expectNoHorizontalOverflow(page);

    const desktopLayout = await readDailyWorkbenchLayout(page);
    expect(desktopLayout.primaryGridColumnCount).toBeGreaterThanOrEqual(5);
    expect(desktopLayout.secondaryGridColumnCount).toBe(2);
    expect(desktopLayout.panelLeft).toBeGreaterThanOrEqual(0);
    expect(desktopLayout.panelRight).toBeLessThanOrEqual(desktopLayout.viewportWidth);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("今日阅读工作台")).toBeVisible();
    await expect(page.getByLabel("阅读总览")).toContainText("已连接本地阅读工作台");
    await expectNoHorizontalOverflow(page);

    const mobileLayout = await readDailyWorkbenchLayout(page);
    const mobileDashboardShell = await page.evaluate(() => {
      const heroPanel = document.querySelector(".hero-panel");
      const heroImage = document.querySelector(".hero-panel img");
      const statusStrip = document.querySelector(".dashboard-status-strip");
      const metricGrid = document.querySelector(".metric-grid");
      const firstMetric = document.querySelector(".metric-card");

      if (
        !(heroPanel instanceof HTMLElement) ||
        !(heroImage instanceof HTMLElement) ||
        !(statusStrip instanceof HTMLElement) ||
        !(metricGrid instanceof HTMLElement) ||
        !(firstMetric instanceof HTMLElement)
      ) {
        throw new Error("总览移动端壳层元素缺失");
      }

      return {
        heroHeight: Math.round(heroPanel.getBoundingClientRect().height),
        heroImageDisplay: window.getComputedStyle(heroImage).display,
        statusTop: Math.round(statusStrip.getBoundingClientRect().top),
        metricColumnCount: window
          .getComputedStyle(metricGrid)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
        metricHeight: Math.round(firstMetric.getBoundingClientRect().height),
      };
    });

    expect(mobileDashboardShell.heroImageDisplay).toBe("none");
    expect(mobileDashboardShell.heroHeight).toBeLessThan(260);
    expect(mobileDashboardShell.statusTop).toBeLessThan(520);
    expect(mobileDashboardShell.metricColumnCount).toBe(1);
    expect(mobileDashboardShell.metricHeight).toBeLessThan(96);
    expect(mobileLayout.primaryGridColumnCount).toBe(2);
    expect(mobileLayout.secondaryGridColumnCount).toBe(1);
    expect(mobileLayout.panelLeft).toBeGreaterThanOrEqual(0);
    expect(mobileLayout.panelRight).toBeLessThanOrEqual(mobileLayout.viewportWidth);
    expect(mobileLayout.titleBottom).toBeLessThanOrEqual(mobileLayout.firstDetailTop);
  });

  test("总览今日卡片展示本地来源并可跳转", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const dailyCard = page.getByLabel("今日卡片");
    await expect(dailyCard).toContainText("这周期最值得处理");
    await expect(dailyCard).toContainText("保留固定深度阅读时段");
    await expect(dailyCard).toContainText("本地阅读报告");
    await expect(await getInvokeCount(page, "summarize_reading_stats")).toBe(0);

    const localProgress = page.getByLabel("本地进展", { exact: true });
    await expect(localProgress).toContainText("阅读进度");
    await expect(localProgress).toContainText("待整理");
    await expect(localProgress.locator(".dashboard-local-progress-metric", { hasText: "待复盘" })).toContainText("1");
    await expect(localProgress.locator(".dashboard-local-progress-metric", { hasText: "本地候选" })).toContainText("1");
    await expect(localProgress).toContainText("下一本可整理《代码整洁之道》");

    await dailyCard.getByRole("button", { name: /查看阅读报告/ }).click();
    await expect(page.getByRole("heading", { name: /阅读报告$/ })).toBeVisible();
  });

  test("总览今日卡片空态只给明确同步路径", async ({ page }) => {
    await installTauriMock(page, { emptyData: true });
    await page.goto("/");

    const dailyCard = page.getByLabel("今日卡片");
    await expect(dailyCard).toContainText("先同步书架缓存");
    await expect(dailyCard).toContainText("书架缓存");
    await expect(dailyCard).not.toContainText("阅读风格信号");
    await expect(dailyCard).not.toContainText("稳定深读");
    await expect(page.getByLabel("本地进展", { exact: true })).toContainText("还没有本地进展");
    await expect(page.getByLabel("本地进展", { exact: true })).toContainText("待积累");

    await dailyCard.getByRole("button", { name: "去书架同步" }).click();
    await expect(page.getByLabel("书架为空")).toBeVisible();
  });

  test("总览今日卡片在窄屏下保持单列且不溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("今日卡片")).toContainText("本地阅读报告");
    await expect(page.getByLabel("本地进展", { exact: true })).toContainText("阅读进度");
    await expectNoHorizontalOverflow(page);

    const layout = await readDailyReadingCardLayout(page);
    const progressLayout = await readDashboardLocalProgressLayout(page);
    expect(layout.gridColumnCount).toBe(1);
    expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
    expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.buttonWidth).toBeLessThanOrEqual(layout.cardWidth);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.copyBottom);
    expect(progressLayout.gridColumnCount).toBe(1);
    expect(progressLayout.metricGridColumnCount).toBe(2);
    expect(progressLayout.panelLeft).toBeGreaterThanOrEqual(0);
    expect(progressLayout.panelRight).toBeLessThanOrEqual(progressLayout.viewportWidth);
  });

  test("总览今日可做卡片保持统一尺寸并截断长统计建议", async ({ page }) => {
    await page.setViewportSize({ width: 1660, height: 760 });
    await installTauriMock(page, { longStatsAction: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("执行统计建议");

    const layout = await todayActions.locator(".today-action-card").evaluateAll((cards) => {
      const roundedRects = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
      const statsCard = Array.from(cards).find((card) => card.textContent?.includes("执行统计建议"));
      const statsDescription = statsCard?.querySelector("small");

      if (!(statsCard instanceof HTMLElement) || !(statsDescription instanceof HTMLElement)) {
        throw new Error("缺少执行统计建议卡片");
      }

      const descriptionStyle = window.getComputedStyle(statsDescription);

      return {
        widths: roundedRects.map((rect) => rect.width),
        heights: roundedRects.map((rect) => rect.height),
        statsTitle: statsCard.getAttribute("title"),
        statsDescriptionHeight: Math.round(statsDescription.getBoundingClientRect().height),
        statsDescriptionLineHeight: Math.round(Number.parseFloat(descriptionStyle.lineHeight)),
        statsDescriptionLineClamp: descriptionStyle.getPropertyValue("-webkit-line-clamp"),
        statsDescriptionOverflow: descriptionStyle.overflow
      };
    });

    expect(new Set(layout.widths).size).toBe(1);
    expect(new Set(layout.heights).size).toBe(1);
    expect(layout.statsTitle).toContain("把“长读”变成可复制");
    expect(layout.statsDescriptionLineClamp).toBe("2");
    expect(layout.statsDescriptionOverflow).toBe("hidden");
    expect(layout.statsDescriptionHeight).toBeLessThanOrEqual(layout.statsDescriptionLineHeight * 2 + 2);
  });

  test("总览没有候选书时只给发现页保存候选主路径", async ({ page }) => {
    await installTauriMock(page, { emptyCandidateStates: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("去发现页保存候选");
    await expect(todayActions).not.toContainText("从书架发现相似书");
    await expect(todayActions).not.toContainText("查看候选《月亮与六便士》");
    await expect(page.getByLabel("本地候选")).toContainText("暂无候选书，可在发现页搜索后保存。");
    await expect(page.getByLabel("本地候选").getByRole("button", { name: "去发现" })).toBeVisible();
  });

  test("总览没有复盘信号时只给笔记中心同步主路径", async ({ page }) => {
    await installTauriMock(page, { emptyReviewSignals: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("去笔记中心同步笔记");
    await expect(todayActions).not.toContainText("整理最近笔记");
    await expect(todayActions).not.toContainText("查看书籍复盘");
    await expect(page.getByLabel("待复盘")).toContainText("暂无本地待复盘书籍");
    await expect(page.getByLabel("待复盘").getByRole("button", { name: "查看笔记" })).toBeVisible();
  });

  test("总览 AI 未配置时只给配置 Provider 主路径", async ({ page }) => {
    await installTauriMock(page, { hasAiCredential: false });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("配置 AI Provider");
    await expect(todayActions).not.toContainText("查看书籍复盘");
    await expect(todayActions.locator(".today-action-card").filter({ hasText: "配置 AI Provider" })).toHaveCount(1);

    await todayActions.getByRole("button", { name: /配置 AI Provider/ }).click();
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await openSettingsCategory(page, "AI 设置");
    await expect(page.getByRole("heading", { name: "未配置 AI Provider" })).toBeVisible();
  });

  test("总览将统计建议和已生成选书决策纳入动作排序", async ({ page }) => {
    await installTauriMock(page, { cachedBookDecision: true });
    await page.goto("/");

    await openShelfSubNav(page, "候选书架");
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await selectBookDecisionCandidate(page, "月亮与六便士");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "生成决策" }).click();
    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_book_decision")).toBe(0);

    await openPrimaryNav(page, "总览");
    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("执行选书决策");
    await expect(todayActions).toContainText("月亮与六便士");
    await expect(todayActions).toContainText("执行统计建议");
    await expect(todayActions).toContainText("保留固定深度阅读时段");
    await expect(todayActions).not.toContainText("查看候选《月亮与六便士》");
    await expect(todayActions.locator(".today-action-card")).toHaveCount(5);

    await todayActions.getByRole("button", { name: /执行选书决策/ }).click();
    await expect(page.getByLabel("选书决策结果")).toBeVisible();
  });

  test("总览无最近阅读时提供本书阅读指南入口", async ({ page }) => {
    await installTauriMock(page, { noRecentReadingEntries: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("打开《深度工作》阅读指南");
    await expect(todayActions).not.toContainText("继续看《深度工作》");

    await todayActions.getByRole("button", { name: /打开《深度工作》阅读指南/ }).click();
    await expect(page.getByRole("heading", { name: "围绕《深度工作》规划下一步" })).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_reading_route")).toBe(0);
  });

  test("单本复盘只有显式点击才标记已整理并从总览复盘动作移除", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("今日可做")).toContainText("复盘《代码整洁之道》");

    await openShelfSubNav(page, "微信书架");
    await page.getByLabel("书架条目").getByRole("button", { name: /代码整洁之道/ }).click();
    await expect(page.getByRole("heading", { name: "代码整洁之道" })).toBeVisible();
    await page.getByLabel("本书管理").getByRole("button", { name: /AI 复盘/ }).click();
    await expect(page.getByRole("heading", { name: "《代码整洁之道》AI 复盘" })).toBeVisible();
    await expect(page.getByLabel("复盘整理状态")).toContainText("待整理");
    await expect(page.getByLabel("复盘整理状态")).toContainText("手动标记为已整理");

    const stateUpdateCount = await getInvokeCount(page, "upsert_reading_item_state");
    await page.getByRole("button", { name: "复制完整复盘" }).click();
    await expect(page.getByLabel("通知").getByText("已复制：复盘文档")).toBeVisible();
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCount);

    await page.getByRole("button", { name: "复制行动清单" }).click();
    await expect(page.getByLabel("通知").getByText("已复制：行动清单")).toBeVisible();
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCount);

    await page.getByRole("button", { name: "复制复盘问题" }).click();
    await expect(page.getByLabel("通知").getByText("已复制：复盘问题")).toBeVisible();
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCount);

    await page.getByRole("button", { name: "导出 Markdown" }).click();
    await expect(page.getByLabel("通知").getByText("已导出：复盘文档")).toBeVisible();
    await expect(page.getByText("已导出：复盘文档").first()).toBeVisible();
    await expect(page.getByText("deep-work-ai-summary.md")).toBeVisible();
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCount);

    await page.getByLabel("复盘整理状态").getByRole("button", { name: "标记已整理" }).click();
    await expect(page.getByLabel("通知").getByText("已标记为「已整理」")).toBeVisible();
    await expect(page.getByLabel("复盘整理状态")).toContainText("已整理");
    await expect(page.getByLabel("复盘整理状态").getByRole("button", { name: "标记已整理" })).toHaveCount(0);
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCount + 1);
    await expect(await getLastInvokeArgs(page, "upsert_reading_item_state")).toMatchObject({
      input: {
        itemId: "book-code-review",
        itemType: "book",
        status: "organized",
        title: "代码整洁之道",
        author: "Robert C. Martin",
        note: "用户已确认吸收本书复盘"
      }
    });

    await openPrimaryNav(page, "总览");
    await expect(page.getByLabel("今日可做")).not.toContainText("复盘《代码整洁之道》");
    await expect(page.getByLabel("待复盘")).not.toContainText("代码整洁之道");
  });

  test("复盘中心阅读指南库按书聚合展示并可查看书籍成果详情", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openReadingReviewSubNav(page, "阅读指南");

    await expect(page.getByLabel("阅读指南成果列表")).toBeVisible();
    await expect(page.getByLabel("阅读指南成果状态")).toContainText("书籍");
    await expect(page.getByLabel("阅读指南成果状态")).toContainText("本书指南");
    await expect(page.getByLabel("阅读指南成果状态")).toContainText("跨书路线");
    await expect(page.getByLabel("阅读指南成果状态")).toContainText("最近更新");

    const deepWorkAsset = page.locator(".ai-asset-card").filter({ hasText: "深度工作" });
    await expect(deepWorkAsset).toContainText("书籍复盘");
    await expect(deepWorkAsset).toContainText("本书指南");
    await expect(deepWorkAsset).toContainText("1 条跨书路线");
    await expect(deepWorkAsset).toContainText("建议更新");
    await expect(deepWorkAsset).toContainText("进度 42%");
    await deepWorkAsset.click();

    await expect(page.getByLabel("书籍阅读成果详情")).toBeVisible();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /阅读指南 1/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /跨书路线 2/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /书籍复盘 1/ })).toBeVisible();
    await page.getByRole("tab", { name: /跨书路线 2/ }).click();
    const crossRouteSection = page.getByRole("region", { name: "跨书路线", exact: true });
    await expect(crossRouteSection).toContainText("以本书为起点的跨书路线");
    await expect(crossRouteSection).toContainText("包含本书的其他路线");
    await expect(crossRouteSection).toContainText("深度工作 -> 月亮与六便士 -> 原则");
    await expect(crossRouteSection).toContainText("掌控习惯 -> 深度工作");
    await expect(crossRouteSection).toContainText("跨书路线历史");
    await page.getByLabel("以本书为起点的跨书路线").getByRole("button", { name: "查看路线" }).click();
    await expect(page.getByLabel("AI 结果版本详情")).toContainText("准备更新指南");
    await expect(page.getByLabel("AI 结果版本详情")).not.toContainText("重新生成前应核对");
    await page.getByRole("button", { name: "准备更新指南" }).click();
    await expect(page.getByRole("dialog", { name: "更新前确认" })).toContainText("重新生成前应核对");
    await expect(page.getByRole("dialog", { name: "更新前确认" })).toContainText("暂无下一步行动反馈记录");
    await expect(page.getByRole("dialog", { name: "更新前确认" })).not.toContainText("基于本地缓存");
    await page.getByRole("button", { name: "进入生成页确认更新" }).click();
    await expect(page.getByRole("heading", { name: "围绕《深度工作》规划下一步" })).toBeVisible();
    await expect(page.getByLabel("准备更新上下文")).toContainText("正在准备更新上一版阅读指南");
    await expect(page.getByLabel("准备更新上下文")).toContainText("已恢复上一版候选范围：1 / 1 本候选已纳入。");
    await expect(page.getByLabel("阅读指南输入范围")).toContainText("1 / 1 本候选已纳入");
    await expect(page.getByRole("button", { name: "生成更新版本" })).toBeEnabled();
    await expect(await getInvokeCount(page, "summarize_reading_route")).toBe(0);
    await openReadingReviewSubNav(page, "阅读指南");
    await deepWorkAsset.click();
    await expect(page.getByLabel("书籍阅读成果详情")).toContainText("《深度工作》阅读指南");
    await expect(page.getByLabel("书籍阅读成果详情")).toContainText("查看指南");
    await expect(page.getByLabel("书籍阅读成果详情")).not.toContainText("Scope");

    await page.getByRole("tab", { name: /书籍复盘 1/ }).click();
    await expect(page.getByLabel("书籍阅读成果详情")).toContainText("《深度工作》书籍复盘");
    await expect(page.getByLabel("书籍阅读成果详情")).toContainText("查看复盘");
    await expect(page.getByLabel("书籍阅读成果详情")).not.toContainText("Scope");
    await expect(await getInvokeCount(page, "list_ai_asset_summaries")).toBeGreaterThan(0);
    await expect(await getInvokeCount(page, "get_ai_asset_detail")).toBeGreaterThan(0);
  });

  test("复盘中心书籍复盘详情可将洞察和行动带入 AI 阅读助手", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openReadingReviewSubNav(page, "阅读指南");
    const deepWorkAsset = page.locator(".ai-asset-card").filter({ hasText: "深度工作" });
    await deepWorkAsset.click();
    await page.getByRole("tab", { name: /书籍复盘 1/ }).click();
    await page.getByLabel("当前书籍复盘").getByRole("button", { name: "查看复盘" }).click();

    const detail = page.getByLabel("AI 结果版本详情");
    await expect(detail).toContainText("反馈沉淀");
    await expect(detail.getByLabel("阅读洞察")).toContainText("关注每日复盘和可执行习惯");
    await expect(detail.getByLabel("下一步行动")).toContainText("为阅读和工作分别保留固定深度时段");
    await expect(detail.getByLabel("复盘问题")).toContainText("我每天是否保留了不被打断的深度时段？");

    const assistant = page.getByRole("complementary", { name: "AI 阅读助手" });
    const assistantInput = assistant.getByPlaceholder("问一个阅读问题");

    await detail.getByLabel("阅读洞察").getByRole("button", { name: "问这个问题" }).first().click();
    await expect(assistant).toBeVisible();
    await expect(assistantInput).toHaveValue(/围绕这个复盘问题继续追问/);
    await expect(assistantInput).toHaveValue(/我每天是否保留了不被打断的深度时段？/);
    await expect(assistantInput).toHaveValue(/关联洞察：「关注每日复盘和可执行习惯」/);
    await expect(assistant.getByRole("button", { name: "生成 AI 复盘" })).toHaveCount(0);
    await assistant.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

    await detail.getByLabel("阅读洞察").getByRole("button", { name: "围绕洞察追问" }).first().click();
    await expect(assistant).toBeVisible();
    await expect(assistantInput).toHaveValue(/围绕这条阅读洞察继续追问/);
    await expect(assistantInput).toHaveValue(/关注每日复盘和可执行习惯/);
    await expect(assistant.getByRole("button", { name: "生成 AI 复盘" })).toHaveCount(0);
    await assistant.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

    await detail.getByLabel("反馈沉淀").getByRole("button", { name: "追问" }).click();
    await expect(assistant).toBeVisible();
    await expect(assistantInput).toHaveValue(/围绕当前复盘中的反馈沉淀继续追问/);
    await expect(assistantInput).toHaveValue(/上次反馈已确认固定深度时段有价值/);
    await expect(assistant.getByRole("button", { name: "生成 AI 复盘" })).toHaveCount(0);
    await assistant.getByRole("button", { name: "关闭 AI 阅读助手" }).click();

    await detail.getByLabel("下一步行动").getByRole("button", { name: "拆解" }).click();
    await expect(assistant).toBeVisible();
    await expect(assistantInput).toHaveValue(/围绕这条下一步行动继续拆解/);
    await expect(assistantInput).toHaveValue(/为阅读和工作分别保留固定深度时段/);
    await expect(assistant.getByRole("button", { name: "生成 AI 复盘" })).toHaveCount(0);
  });

  test("桌面端主流程可导航并使用本地命令 mock 数据", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("应用窗口控制").getByText("个人阅读管理")).toBeVisible();
    await expect(page.getByLabel("核心指标").getByText("书架条目")).toBeVisible();
    await expect(page.locator(".dashboard-status-strip")).toContainText("已连接本地阅读工作台");
    await expect(page.locator(".dashboard-status-strip").getByRole("button", { name: "打开设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "今日最值得做" })).toBeVisible();
    await expect(page.getByLabel("今日可做")).toContainText("继续看《深度工作》");
    await expect(page.getByLabel("今日可做")).toContainText("复盘《代码整洁之道》");
    await expect(page.getByLabel("今日可做")).toContainText("查看候选《月亮与六便士》");
    await expect(page.getByLabel("今日可做")).toContainText("查看书籍复盘");
    await expect(page.getByRole("heading", { name: "继续读、待复盘和候选书" })).toBeVisible();
    await expect(page.getByLabel("本地阅读队列")).toContainText("只读取本机缓存和本地整理状态");
    await expect(page.getByLabel("继续读")).toContainText("深度工作");
    await expect(page.getByLabel("待复盘")).toContainText("原则");
    await expect(page.getByLabel("本地候选")).toContainText("月亮与六便士");
    await expect(page.getByLabel("下周期建议")).toContainText("保留固定深度阅读时段");
    await expect(page.getByLabel("下周期建议").getByRole("button", { name: "查看完整复盘" })).toBeVisible();
    await expect(await getInvokeCount(page, "get_latest_reading_stats_review")).toBeGreaterThan(0);
    await expect(await getInvokeCount(page, "summarize_reading_stats")).toBe(0);
    await page.getByLabel("本地候选").getByRole("button", { name: /月亮与六便士/ }).click();
    await expect(page.getByRole("heading", { name: "月亮与六便士" })).toBeVisible();
    await openPrimaryNav(page, "总览");
    await page.getByLabel("今日可做").getByRole("button", { name: /继续看《深度工作》/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByLabel("阅读进度")).toContainText("42%");
    await openPrimaryNav(page, "总览");
    await expect(page.getByRole("heading", { name: "最近打开的内容" })).toBeVisible();
    await expect(page.getByLabel("最近阅读内容").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await page.getByLabel("最近阅读内容").getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByLabel("阅读进度")).toContainText("42%");
    await openPrimaryNav(page, "总览");
    await page.getByRole("button", { name: "折叠侧边栏" }).click();
    await expect(page.locator(".app-frame")).toHaveClass(/sidebar-collapsed/);
    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await expect(page.locator(".app-frame")).not.toHaveClass(/sidebar-collapsed/);

    await openShelfSubNav(page, "微信书架");
    await expect(page.getByLabel("书架子菜单").getByRole("button", { name: "微信书架" })).toBeVisible();
    await expect(page.getByLabel("书架子菜单").getByRole("button", { name: "候选书架" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的微信读书书架" })).toBeVisible();
    await openPrimaryNav(page, "书架");
    await expect(page.getByLabel("书架子菜单")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "我的微信读书书架" })).toBeVisible();
    await openPrimaryNav(page, "书架");
    await expect(page.getByLabel("书架子菜单").getByRole("button", { name: "微信书架" })).toBeVisible();
    const shelfSearchInput = page.getByPlaceholder("按书名、作者或分类筛选书架");
    await shelfSearchInput.evaluate((input) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "dang" }));
      input.value = "dang";
      input.dispatchEvent(new InputEvent("input", { data: "dang", inputType: "insertCompositionText", bubbles: true, isComposing: true }));
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "当" }));
      input.value = "当";
      input.dispatchEvent(new InputEvent("input", { data: "当", inputType: "insertText", bubbles: true, isComposing: false }));
    });
    await expect(shelfSearchInput).toHaveValue("当");
    await expect(shelfSearchInput).not.toHaveValue(/dang/);
    await shelfSearchInput.fill("");
    const shelfEntries = page.getByLabel("书架条目");
    const shelfCategoryFilter = page.getByLabel("书架父分类");
    await shelfCategoryFilter.getByRole("button", { name: "历史" }).click();
    await expect(shelfEntries.getByLabel("中国通史 有声书")).toBeVisible();
    await expect(shelfEntries.getByLabel("深度工作 电子书")).toHaveCount(0);
    await shelfCategoryFilter.getByRole("button", { name: "全部", exact: true }).click();
    await expect(shelfCategoryFilter.getByRole("button", { name: "计算机 2" })).toHaveCount(1);
    await expect(shelfCategoryFilter.getByRole("button", { name: "计算机-编程设计" })).toHaveCount(0);
    await expect(shelfCategoryFilter.getByRole("button", { name: "计算机-人工智能" })).toHaveCount(0);
    await expect(shelfCategoryFilter.getByRole("button", { name: "语言 1" })).toHaveCount(0);
    await page.getByRole("button", { name: /展开更多/ }).click();
    await expect(shelfCategoryFilter.getByRole("button", { name: "语言 1" })).toBeVisible();
    await page.getByRole("button", { name: "收起分类" }).click();
    await shelfCategoryFilter.getByRole("button", { name: "计算机 2" }).click();
    await expect(shelfEntries.getByLabel("代码整洁之道 电子书")).toBeVisible();
    await expect(shelfEntries.getByLabel("人工智能入门 电子书")).toBeVisible();
    await expect(shelfEntries.getByLabel("深度工作 电子书")).toHaveCount(0);
    await expect(shelfEntries.getByLabel("中国通史 有声书")).toHaveCount(0);
    await shelfCategoryFilter.getByRole("button", { name: "全部", exact: true }).click();
    const historyAlbumCard = shelfEntries.getByLabel("中国通史 有声书");
    await historyAlbumCard.getByRole("button", { name: "中国通史 更多操作" }).click();
    await expect(historyAlbumCard.getByRole("menu", { name: "中国通史 操作菜单" })).toBeVisible();
    await historyAlbumCard.getByRole("menuitem", { name: "复制标题" }).click();
    await expect(page.getByLabel("通知").getByText("已复制「中国通史」")).toBeVisible();
    await expect(historyAlbumCard.getByRole("menu", { name: "中国通史 操作菜单" })).toHaveCount(0);
    await historyAlbumCard.getByRole("button", { name: "中国通史 更多操作" }).click();
    await historyAlbumCard.getByRole("menuitem", { name: "去发现页搜索" }).click();
    await expect(page.getByRole("heading", { name: "发现下一本书" })).toBeVisible();
    await expect(page.getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”")).toHaveValue("中国通史");
    await openShelfSubNav(page, "微信书架");
    await historyAlbumCard.getByRole("button", { name: "中国通史 更多操作" }).click();
    await historyAlbumCard.getByRole("menuitem", { name: "保存候选" }).click();
    await expect(page.getByLabel("通知").getByText("已保存《中国通史》到本地候选")).toBeVisible();
    await expect(await getLastInvokeArgs(page, "upsert_reading_item_state")).toMatchObject({
      input: {
        itemId: "album-history",
        itemType: "album",
        status: "toRead",
        title: "中国通史",
        author: "音频节目",
        category: "历史",
        note: "书架有声书保存的本地候选"
      }
    });

    const mpCard = shelfEntries.getByLabel("文章收藏 文章收藏");
    await mpCard.getByRole("button", { name: "文章收藏 更多操作" }).click();
    await expect(mpCard.getByRole("menu", { name: "文章收藏 操作菜单" })).toBeVisible();
    await expect(mpCard.getByRole("menuitem", { name: "保存候选" })).toBeVisible();
    await mpCard.getByRole("menuitem", { name: "保存候选" }).click();
    await expect(page.getByLabel("通知").getByText("已保存《文章收藏》到本地候选")).toBeVisible();
    await expect(page.getByRole("heading", { name: "文章收藏" })).toHaveCount(0);
    await expect(await getLastInvokeArgs(page, "upsert_reading_item_state")).toMatchObject({
      input: {
        itemId: "mp-collection",
        itemType: "mp",
        status: "toRead",
        title: "文章收藏",
        category: "公众号",
        note: "书架文章收藏保存的本地候选"
      }
    });

    await openShelfSubNav(page, "候选书架");
    const candidateEntries = page.getByLabel("候选书架条目");
    await expect(candidateEntries).toContainText("中国通史");
    await expect(candidateEntries).toContainText("有声书");
    await expect(candidateEntries).toContainText("文章收藏");
    await expect(candidateEntries).toContainText("轻管理候选");
    await expect(candidateEntries.getByRole("button", { name: "移除" })).toHaveCount(0);
    const historyCandidateCard = candidateEntries.locator(".candidate-bookshelf-card").filter({ hasText: "中国通史" });
    await expect(historyCandidateCard).toHaveCount(1);
    await expect(historyCandidateCard.locator(".candidate-card-actions")).toHaveCount(0);
    await historyCandidateCard.getByRole("button", { name: "更多候选操作：中国通史" }).click();
    await expect(historyCandidateCard.getByRole("menu", { name: "候选操作" })).toBeVisible();
    await expect(historyCandidateCard.getByRole("menuitem", { name: "移除候选" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(historyCandidateCard.getByRole("menu", { name: "候选操作" })).toHaveCount(0);
    await historyCandidateCard.getByRole("button", { name: "更多候选操作：中国通史" }).click();
    await historyCandidateCard.getByRole("menuitem", { name: "移除候选" }).click();
    await expect(page.getByLabel("通知").getByText("已从候选书架移除《中国通史》")).toBeVisible();
    await expect(historyCandidateCard).toHaveCount(0);
    await openShelfSubNav(page, "微信书架");
    await page.getByLabel("书架条目").getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByLabel("阅读进度")).toContainText("42%");
    await expect(page.getByRole("heading", { name: "2 个章节" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "本书管理" })).toBeVisible();
    await expect(page.getByLabel("本书管理")).not.toContainText("在读");
    await expect(page.getByLabel("本书整理状态")).toContainText("阅读中");
    await expect(page.getByLabel("本书整理状态")).toContainText("微信进度 42%");
    await expect(page.getByLabel("本书整理状态")).toContainText("本书阅读指南");
    const stateUpdateCountBeforeReviewing = await getInvokeCount(page, "upsert_reading_item_state");
    await page.getByLabel("本地整理状态").getByRole("button", { name: /待复盘/ }).click();
    await expect(page.getByLabel("通知").getByText("已标记为「待复盘」")).toBeVisible();
    await expect(page.getByLabel("本书管理")).toContainText("待复盘");
    await expect(page.getByLabel("本书整理状态")).toContainText("下一步是整理这本书");
    await expect(page.getByLabel("本书整理状态")).toContainText("AI 复盘");
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBe(stateUpdateCountBeforeReviewing + 1);
    await page.getByLabel("本书管理").getByRole("button", { name: /查看笔记/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByText("真正有价值的成果，来自长时间无干扰的专注。")).toBeVisible();
    await page.getByRole("button", { name: "返回书籍详情" }).click();
    await page.getByLabel("本书管理").getByRole("button", { name: /AI 复盘/ }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await page.getByRole("button", { name: "返回书籍详情" }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await page.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
    await expect(page.getByRole("heading", { name: "围绕《深度工作》规划下一步" })).toBeVisible();
    await expect(page.getByLabel("AI 阅读指南数据边界")).toHaveCount(0);
    await expect(page.getByLabel("阅读指南输入范围")).not.toContainText("月亮与六便士");
    await expect(page.getByLabel("阅读指南输入范围")).toContainText("当前书：深度工作");
    await expect(page.getByLabel("阅读指南输入范围")).toContainText("0 / 1 本候选已纳入");
    await expect(page.getByLabel("阅读指南输入范围")).not.toContainText("默认输入");
    await page.getByRole("button", { name: "调整输入范围" }).click();
    await expect(page.getByRole("dialog", { name: "调整阅读指南输入范围" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "调整阅读指南输入范围" })).toContainText("月亮与六便士");
    await page.getByRole("dialog", { name: "调整阅读指南输入范围" }).getByRole("button", { name: "关闭" }).click();
    await expect(page.getByRole("dialog", { name: "调整阅读指南输入范围" })).toHaveCount(0);
    await expect(page.getByLabel("本书指南图")).toContainText("读完第 2 章到第 3 章");
    await page.getByLabel("本书指南图").getByRole("button", { name: /查看读完第 2 章到第 3 章的完整阅读节点详情/ }).click();
    const guideNodeDialog = page.getByRole("dialog", { name: "读完第 2 章到第 3 章" });
    await expect(guideNodeDialog).toBeVisible();
    await expect(guideNodeDialog).toContainText("预计投入");
    await expect(guideNodeDialog).toContainText("2 个 45 分钟阅读时段");
    await expect(guideNodeDialog).toContainText("依据");
    await expect(guideNodeDialog).toContainText("当前进度 42%");
    await expect(guideNodeDialog).toContainText("关联行动");
    await expect(guideNodeDialog).toContainText("今天安排 45 分钟读完第 2 章");
    await expect(guideNodeDialog).not.toContainText("记录反馈");
    await guideNodeDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(guideNodeDialog).toHaveCount(0);
    await expect(page.getByLabel("本书指南重点")).toContainText("当前优先级");
    await expect(page.getByLabel("本书指南重点")).toContainText("验证判断");
    await expect(page.getByLabel("本书指南重点")).toContainText("本轮收束");
    await expect(page.getByLabel("本书指南重点")).not.toContainText("带什么问题读");
    await expect(page.getByText("查看指南总览原文")).toBeVisible();
    await expect(page.getByRole("button", { name: "查看完整指南" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "完整阅读指南" })).toHaveCount(0);
    await expect(page.getByLabel("完整阅读指南")).toBeVisible();
    await expect(page.getByLabel("完整阅读指南")).toContainText("推进任务");
    await expect(page.getByLabel("完整阅读指南")).toContainText("核对依据");
    await expect(page.getByLabel("完整阅读指南")).toContainText("围绕《深度工作》核对本轮阅读依据");
    await expect(page.getByLabel("下一步行动卡片列表")).toContainText("今天安排 45 分钟读完第 2 章");
    await expect(page.getByLabel("完整阅读指南")).toContainText("输出：3 条本书行动清单");
    await expect(page.getByLabel("完整阅读指南")).toContainText("验收：为每条补 1 个执行场景。");
    await expect(page.getByLabel("下一步行动卡片列表")).toContainText("完成标准：标出 3 条可以直接实践的专注规则。");
    await expect(page.getByLabel("完整阅读指南")).not.toContainText("...");
    await expect(page.getByLabel("完整阅读指南")).not.toContainText("…");
    await expect(page.getByLabel("复盘点卡片列表")).toBeVisible();
    await expect(page.getByLabel("下一步行动卡片列表")).toBeVisible();
    await expect(page.getByLabel("完整阅读指南").getByRole("heading", { name: "复盘点" })).toBeVisible();
    await expect(page.getByLabel("完整阅读指南").getByRole("heading", { name: "下一步行动" })).toHaveCount(0);
    await expect(page.getByLabel("完整阅读指南")).toContainText("来源统计");
    await expect(page.getByLabel("完整阅读指南")).toContainText("不会写回微信读书");
    const routeDetailLayout = await page.getByLabel("复盘点卡片列表").locator(".reading-route-detail-card-stack").evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        display: style.display,
        columnWidth: style.columnWidth,
        columnGap: style.columnGap,
        overflowX: style.overflowX
      };
    });
    expect(routeDetailLayout.display).toBe("block");
    expect(routeDetailLayout.columnWidth).toBe("300px");
    expect(routeDetailLayout.columnGap).toBe("12px");
    expect(routeDetailLayout.overflowX).toBe("visible");
    await expect(await getInvokeCount(page, "summarize_reading_route")).toBe(0);
    await expect(await getInvokeCount(page, "get_latest_reading_route")).toBeGreaterThan(0);
    await page.getByRole("button", { name: "导出 Markdown" }).click();
    await expect(page.getByText("deep-work-reading-route.md")).toBeVisible();
    await expect(await getInvokeCount(page, "export_reading_route_markdown")).toBe(1);
    await page.getByRole("button", { name: "重新生成" }).click();
    await expect(await getInvokeCount(page, "summarize_reading_route")).toBe(1);
    await page.getByRole("button", { name: "返回书籍详情" }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    const bookDetailCallCount = await getInvokeCount(page, "get_book_detail");

    await openPrimaryNav(page, "笔记");
    await expect(page.getByRole("heading", { name: "划线、想法和书签数量" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "优先整理这些有想法的书" })).toBeVisible();
    const notesSearchInput = page.getByPlaceholder("按书名或作者筛选笔记");
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await notesSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "san" }));
      nativeValueSetter?.call(input, "san");
      input.dispatchEvent(new InputEvent("input", { data: "san", inputType: "insertCompositionText", bubbles: true, isComposing: true }));
    });
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await notesSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "三" }));
      nativeValueSetter?.call(input, "三");
      input.dispatchEvent(new InputEvent("input", { data: "三", inputType: "insertText", bubbles: true, isComposing: false }));
    });
    await expect(notesSearchInput).toHaveValue("三");
    await expect(notesSearchInput).not.toHaveValue(/san/);
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /三体/ })).toBeVisible();
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toHaveCount(0);
    await notesSearchInput.fill("");
    const bulkBookNotesCallCount = await getInvokeCount(page, "get_book_notes");
    await page.getByRole("button", { name: "批量导出" }).click();
    await expect(page.getByRole("dialog", { name: "批量导出向导" })).toBeVisible();
    await expect(page.getByLabel("批量导出预检结果")).toContainText("可直接导出");
    await expect(page.getByLabel("批量导出预检结果")).toContainText("需要同步");
    await expect(page.getByLabel("批量导出书籍预检")).toContainText("需要同步/读取后才能导出。");
    await page.getByRole("button", { name: "开始导出" }).click();
    await expect(page.getByLabel("批量导出报告")).toContainText("wxreadmaster-bulk-export-1725955200");
    await expect(page.getByLabel("批量导出报告")).toContainText("已导出");
    await expect(page.getByLabel("批量导出报告")).toContainText("需要同步/读取后才能导出。");
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(1);
    await expect(await getInvokeCount(page, "get_book_notes")).toBe(bulkBookNotesCallCount);
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(0);
    await page.getByRole("button", { name: "重新预检" }).click();
    await expect(page.getByLabel("导出设置")).toBeVisible();
    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await page.getByRole("button", { name: "开始导出" }).click();
    await expect(page.getByLabel("批量导出报告")).toContainText("已同步缺失笔记并导出 Markdown。");
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(2);
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(0);
    await page.getByRole("button", { name: "重新预检" }).click();
    await expect(page.getByLabel("导出设置")).toBeVisible();
    await page.evaluate(() => {
      window.__e2eDelayBulkExport = true;
    });
    await page.getByRole("button", { name: "开始导出" }).click();
    await expect(page.getByRole("button", { name: "停止后续同步" })).toBeVisible();
    await page.getByRole("button", { name: "停止后续同步" }).click();
    await expect(page.getByLabel("批量导出报告")).toContainText("用户已取消，未开始同步。");
    await expect(await getInvokeCount(page, "cancel_bulk_export")).toBe(1);
    await page.getByRole("button", { name: "关闭批量导出向导" }).click();
    await expect(page.getByRole("dialog", { name: "批量导出向导" })).toHaveCount(0);
    await expect(page.getByLabel("建议复盘").getByRole("button", { name: /三体/ })).toBeVisible();
    await expect(page.getByLabel("建议复盘").getByRole("button", { name: /深度工作/ })).toHaveCount(0);
    await page.getByLabel("建议复盘").getByRole("button", { name: /三体/ }).click();
    await expect(page.getByRole("heading", { name: "三体" })).toBeVisible();
    await page.getByRole("button", { name: "返回笔记中心" }).click();
    await expect(page.getByRole("button", { name: /深度工作/ })).toBeVisible();
    await page.getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
    await expect(page.getByText("真正有价值的成果，来自长时间无干扰的专注。")).toBeVisible();
    await expect(page.getByLabel("复盘输入状态")).toContainText("适合复盘");
    await expect(page.getByLabel("复盘输入状态")).toContainText("这本书已经有可整理输入");
    await expect(page.getByLabel("复盘输入状态")).toContainText("AI 复盘");
    await expect(page.getByRole("heading", { name: "章节视图" })).toBeVisible();
    await expect(page.getByLabel("卡片视图工具")).toHaveCount(0);
    await expect(page.getByLabel("章节视图工具")).toBeVisible();
    await page.getByRole("button", { name: "章节目录" }).click();
    await expect(page.getByLabel("章节快速目录").getByRole("button", { name: /第一章 专注力/ })).toBeVisible();
    await page.getByLabel("第一章 专注力").getByRole("button", { name: /书内章节 第一章 专注力/ }).click();
    await expect(page.getByText("已收起，点击章节标题展开原始划线和想法。")).toBeVisible();
    await page.getByRole("button", { name: /展开全部/ }).click();
    await expect(page.getByText("真正有价值的成果，来自长时间无干扰的专注。")).toBeVisible();
    await page.getByRole("tab", { name: "只看有想法" }).click();
    await expect(page.getByLabel("章节视图工具")).toContainText("1 个章节可浏览");
    await page.getByRole("tab", { name: "卡片" }).click();
    await expect(page.getByRole("heading", { name: "卡片视图" })).toBeVisible();
    await expect(page.getByLabel("卡片视图工具")).toBeVisible();
    await expect(page.getByLabel("笔记卡片").getByText("真正有价值的成果，来自长时间无干扰的专注。")).toBeVisible();
    const noteCardDownload = page.waitForEvent("download");
    await page.getByLabel("笔记卡片").getByRole("button", { name: "导出图片" }).first().click();
    await expect(page.getByLabel("通知").getByText(/已生成：摘录卡片（深度工作-(划线|想法)\.png）/)).toBeVisible();
    await expect(page.locator(".status-message").filter({ hasText: "已生成：摘录卡片" })).toHaveCount(0);
    expect((await noteCardDownload).suggestedFilename()).toMatch(/深度工作-划线\.png|深度工作-想法\.png/);
    const noteGroupDownload = page.waitForEvent("download");
    await page.getByLabel("卡片视图工具").getByRole("button", { name: "导出当前组" }).click();
    await expect(page.getByLabel("通知").getByText("已生成：摘录卡片（深度工作-笔记组合.png）")).toBeVisible();
    await expect(page.locator(".status-message").filter({ hasText: "已生成：摘录卡片" })).toHaveCount(0);
    expect((await noteGroupDownload).suggestedFilename()).toBe("深度工作-笔记组合.png");
    await page.getByRole("tab", { name: "想法" }).click();
    await expect(page.getByLabel("笔记卡片").getByText("这条原则可以直接放进每日阅读复盘。")).toBeVisible();
    await page.getByRole("tab", { name: "最新" }).click();
    await page.getByRole("button", { name: "随机一组" }).click();
    await expect(page.getByText(/已随机抽取 \d+ 条当前笔记/)).toBeVisible();
    await page.getByRole("button", { name: "显示全部" }).click();
    await page.getByRole("tab", { name: "章节", exact: true }).click();
    await expect(page.getByRole("heading", { name: "章节视图" })).toBeVisible();
    await expect(page.getByText("已导出")).toHaveCount(0);
    const assistantSummaryCallCount = await getInvokeCount(page, "summarize_book_notes");
    await page.getByLabel("打开 AI 阅读助手").click();
    const readingAssistant = page.getByRole("complementary", { name: "AI 阅读助手" });
    await expect(readingAssistant).toBeVisible();
    await readingAssistant.getByPlaceholder("问一个阅读问题").fill("基于我的笔记总结重点");
    await readingAssistant.getByRole("button", { name: "发送" }).click();
    await expect(readingAssistant).toContainText("这类笔记总结适合进入单本 AI 复盘");
    await expect(readingAssistant).toContainText("这类笔记总结应进入单本 AI 复盘，不走阅读指南。");
    await readingAssistant.getByRole("button", { name: "生成 AI 复盘" }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(assistantSummaryCallCount);
    await page.getByRole("button", { name: "返回单本笔记" }).click();
    await expect(page.getByRole("heading", { name: "章节视图" })).toBeVisible();
    const noteOverviewCallCount = await getInvokeCount(page, "get_notebook_overview");
    const bookNotesCallCount = await getInvokeCount(page, "get_book_notes");
    await page.getByRole("button", { name: "AI 复盘" }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "主题标签" })).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(0);
    await expect(await getInvokeCount(page, "get_latest_book_notes_summary")).toBeGreaterThan(0);
    await expect(page.getByText("专注", { exact: true })).toBeVisible();
    await expect(page.getByLabel("AI 复盘数据边界")).toContainText("本地缓存");
    await page.getByRole("button", { name: "复制完整复盘" }).click();
    await expect(page.getByText("已复制：复盘文档")).toBeVisible();
    await expect(page.getByLabel("通知").getByText("已复制：复盘文档")).toBeVisible();
    await expect(page.locator(".toast-card").filter({ hasText: "已复制：复盘文档" })).toBeVisible();
    await page.getByLabel("关键观点").getByRole("button", { name: "复制" }).click();
    await expect(page.getByText("已复制「关键观点」")).toBeVisible();
    await expect(page.locator(".status-message").filter({ hasText: "已复制" })).toHaveCount(0);
    await expect(page.getByLabel("下一步行动")).toContainText("已完成 0 / 共 1 项");
    await page.getByLabel("下一步行动").getByRole("button", { name: "记录反馈" }).click();
    await expect(page.getByRole("dialog", { name: "编辑状态与记录" })).toBeVisible();
    await page.getByRole("dialog", { name: "编辑状态与记录" }).getByRole("button", { name: "已完成" }).click();
    await page.getByRole("dialog", { name: "编辑状态与记录" }).getByRole("button", { name: "保存反馈" }).click();
    await expect(page.getByLabel("下一步行动")).toContainText("已完成 1 / 共 1 项");
    await expect(
      page.getByLabel("下一步行动").locator(".ai-action-checklist-text", {
        hasText: "为阅读和工作分别保留固定深度时段"
      })
    ).toHaveClass(/is-completed/);
    await page.getByLabel("下一步行动").getByRole("button", { name: "复制行动清单" }).click();
    await expect(page.getByLabel("通知").getByText("已复制：行动清单")).toBeVisible();
    await expect(page.getByRole("heading", { name: "代表性摘录" })).toBeVisible();
    await expect(page.getByText("直接体现本书笔记的核心关注点。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "复盘问题" })).toBeVisible();
    await expect(page.getByLabel("复盘问题").getByText("我每天是否保留了不被打断的深度时段？")).toBeVisible();
    await page.getByRole("button", { name: "导出 Markdown" }).click();
    await expect(page.getByText("deep-work-ai-summary.md")).toBeVisible();
    await expect(await getInvokeCount(page, "export_book_notes_summary_markdown")).toBe(1);
    await page.getByRole("button", { name: "返回单本笔记" }).click();
    await expect(page.getByRole("heading", { name: "章节视图" })).toBeVisible();
    await page.getByRole("button", { name: "AI 复盘" }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await expect(page.getByLabel("下一步行动")).toContainText("已完成 1 / 共 1 项");
    await page.getByRole("button", { name: "返回单本笔记" }).click();
    await expect(page.getByRole("heading", { name: "章节视图" })).toBeVisible();

    await openPrimaryNav(page, "统计");
    await expect(page.getByRole("heading", { name: /阅读报告$/ })).toBeVisible();
    await expect(page.getByLabel("统计摘要").getByText("总时长")).toBeVisible();
    await expect(page.getByRole("heading", { name: "按天阅读时间" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "这组数据说明什么" })).toBeVisible();
    await expect(page.getByLabel("本地统计解读")).toContainText("投入最多的分类");
    await expect(page.getByLabel("本地统计解读")).toContainText("效率");
    await expect(page.getByLabel("本地统计解读")).toContainText("最长内容占比");
    await expect(page.getByLabel("本地统计解读")).toContainText("节奏集中度");
    await expect(page.getByLabel("本地统计解读")).toContainText("周期变化");
    await expect(page.getByRole("button", { name: "查看完整复盘" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "本周期最长阅读内容" })).toBeVisible();
    await expect(page.getByLabel("读得最多")).toContainText("中国通史");
    await expect(page.getByLabel("读得最多")).toContainText("有声内容");
    await expect(page.getByLabel("读得最多")).not.toContainText("未命名内容");
    await page.getByRole("button", { name: "查看完整复盘" }).click();
    await expect(page.getByRole("heading", { name: /阅读复盘$/ })).toBeVisible();
    await openPrimaryNav(page, "统计");
    await page.getByRole("tab", { name: /总计/ }).click();
    await expect(page.getByRole("heading", { name: "长期阅读成果" })).toBeVisible();
    const statsCallCount = await getInvokeCount(page, "get_reading_stats");

    await openReadingReviewSubNav(page, "书籍复盘");
    await expect(page.locator(".sidebar").getByRole("button", { name: "书籍复盘" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "把单本笔记整理成阅读报告" })).toBeVisible();
    await expect(page.getByLabel("阅读工作流模板")).toContainText("整理一本书");
    await expect(page.getByLabel("阅读工作流模板")).toContainText("决定下一本");
    const reviewAssetProgress = page.getByLabel("复盘进度");
    await expect(reviewAssetProgress).toContainText("复盘进行中");
    await expect(reviewAssetProgress).toContainText("还有书可以生成阅读报告");
    await expect(reviewAssetProgress.getByLabel("复盘指标")).toContainText("已生成");
    await expect(reviewAssetProgress.getByLabel("复盘指标")).toContainText("待整理");
    await expect(reviewAssetProgress).toContainText("最近更新");
    await expect(reviewAssetProgress.getByLabel("复盘下一步")).toContainText("优先生成");
    await expect(reviewAssetProgress.getByLabel("复盘下一步")).toContainText("《三体》");
    await expect(reviewAssetProgress.getByLabel("复盘下一步")).toContainText("3 条想法 · 8 条笔记 · 进度 100%");
    await expect(reviewAssetProgress.getByLabel("复盘下一步").getByRole("button", { name: /开始复盘/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "已生成的阅读报告" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "有笔记但还没整理" })).toBeVisible();
    await expect(page.getByLabel("建议生成复盘").getByRole("button", { name: /三体/ })).toBeVisible();
    await expect(page.getByLabel("建议生成复盘").getByRole("button", { name: /深度工作/ })).toHaveCount(0);
    await reviewAssetProgress.getByLabel("复盘下一步").getByRole("button", { name: /开始复盘/ }).click();
    await expect(page.getByRole("heading", { name: "《三体》AI 复盘" })).toBeVisible();
    await expect(page.getByText("点击“生成复盘”后，会使用当前书笔记生成阅读报告")).toBeVisible();
    await expect(page.getByLabel("AI 复盘数据边界")).toContainText("待生成");
    await expect(page.getByRole("button", { name: "生成复盘" })).toBeEnabled();
    await page.getByRole("button", { name: "返回复盘中心" }).click();
    await expect(page.getByRole("heading", { name: "把单本笔记整理成阅读报告" })).toBeVisible();
    await expect(page.getByText("这本书的笔记集中在深度专注、减少干扰和把原则落到日常复盘。")).toBeVisible();
    await page.getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await page.getByRole("button", { name: "返回复盘中心" }).click();
    await expect(page.getByRole("heading", { name: "把单本笔记整理成阅读报告" })).toBeVisible();
    await openReadingReviewSubNav(page, "阅读报告");
    await expect(page.getByRole("heading", { name: /阅读复盘$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "按阶段看阅读变化" })).toBeVisible();
    await expect(page.getByText("本月阅读集中在少数高投入内容，整体节奏稳定。")).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_reading_stats")).toBe(0);
    await expect(await getInvokeCount(page, "get_latest_reading_stats_review")).toBeGreaterThan(0);
    await expect(page.getByLabel("阅读阶段变化")).toContainText("AI 对照");
    await expect(page.getByText("阅读时间集中在连续的三个分桶。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "本周期更接近哪种阅读状态" })).toBeVisible();
    await expect(page.getByText("你的阅读人格", { exact: true })).toBeVisible();
    await expect(page.getByText("实用经验")).toBeVisible();
    await expect(page.getByText("高峰段")).toBeVisible();
    await expect(page.getByRole("heading", { name: "主题投入结构" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "下一步行动" })).toBeVisible();
    await page.getByRole("button", { name: "导出 Markdown" }).click();
    await expect(page.getByText("monthly-reading-review")).toBeVisible();
    await expect(await getInvokeCount(page, "export_reading_stats_review_markdown")).toBe(1);

    await openPrimaryNav(page, "笔记");
    await expect(page.getByRole("heading", { name: "划线、想法和书签数量" })).toBeVisible();
    await expect(await getInvokeCount(page, "get_notebook_overview")).toBe(noteOverviewCallCount);
    await page.getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByText("真正有价值的成果，来自长时间无干扰的专注。")).toBeVisible();
    await expect(await getInvokeCount(page, "get_book_notes")).toBe(bookNotesCallCount);

    await openShelfSubNav(page, "微信书架");
    await page.getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByLabel("阅读进度")).toContainText("42%");
    await expect(await getInvokeCount(page, "get_book_detail")).toBe(bookDetailCallCount);

    await openPrimaryNav(page, "统计");
    await expect(page.getByRole("heading", { name: /阅读报告$/ })).toBeVisible();
    await expect(await getInvokeCount(page, "get_reading_stats")).toBeGreaterThanOrEqual(statsCallCount);

    await openPrimaryNav(page, "发现");
    await expect(page.getByRole("heading", { name: /下一本书/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "先从自己已经读过的内容继续扩展" })).toBeVisible();
    await expect(page.getByText("先点左侧书架入口")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "深度工作" }).first()).toBeVisible();
    await page.getByRole("button", { name: "深度工作" }).first().click();
    await expect(page.getByRole("heading", { name: "围绕《深度工作》继续找" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "相似书结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "球状闪电" })).toBeVisible();
    await page.getByRole("button", { name: "返回发现" }).click();
    await expect(page.getByRole("heading", { name: /下一本书/ })).toBeVisible();
    const discoverySearchInput = page.getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”");
    await expect(discoverySearchInput).toHaveValue("");
    await page.getByLabel("主题 chips").getByRole("button", { name: "AI" }).click();
    await expect(discoverySearchInput).toHaveValue("AI");
    await page.getByLabel("主题 chips").getByRole("button", { name: "心理学" }).click();
    await expect(discoverySearchInput).toHaveValue("心理学");
    await page.getByRole("button", { name: /^搜索$/ }).click();
    await expect(page.getByRole("heading", { name: "2 条可浏览结果" })).toBeVisible();
    await expect(page.getByLabel("搜索辅助入口")).toBeVisible();
    await expect(page.getByRole("heading", { name: "已保存的下一批书" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "主题和最近搜索" })).toBeVisible();
    await expect(page.getByLabel("选书决策助手")).toHaveCount(0);
    await expect(page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" })).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_book_decision")).toBe(0);
    await page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
    await expect(page.getByRole("heading", { name: "候选书架", exact: true })).toBeVisible();
    await expect(page.getByLabel("候选书架说明")).toContainText("只保存在本机，不写回微信读书");
    await expect(page.getByLabel("候选书架条目")).toContainText("月亮与六便士");
    await expect(page.locator(".sidebar").getByRole("button", { name: "选书决策" })).toHaveCount(0);
    await expect(page.getByLabel("选书决策助手")).toHaveCount(0);
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await expect(page.getByRole("dialog", { name: "调整选书决策输入范围" })).toContainText("步骤 1 / 3");
    await expect(page.getByLabel("本次选书目标")).toContainText("轻松读");
    await expect(page.getByLabel("候选书选择")).toHaveCount(0);
    await page.getByLabel("本次选书目标").getByRole("radio", { name: "推进长期书" }).check();
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("dialog", { name: "调整选书决策输入范围" })).toContainText("步骤 2 / 3");
    await expect(page.getByLabel("候选书选择")).toContainText("月亮与六便士");
    await expect(page.getByLabel("候选书选择")).toContainText("已选 0 / 8");
    await page.getByLabel("候选书选择").getByRole("checkbox", { name: "月亮与六便士" }).check();
    await expect(page.getByLabel("候选书选择")).toContainText("已选 1 / 8");
    await expect(
      page.getByLabel("候选书选择").getByRole("button", { name: "查看《月亮与六便士》详情" })
    ).toHaveCount(0);
    await expect(page.getByLabel("候选书选择").locator(".cover-frame")).toHaveCount(0);
    await expect(page.getByLabel("参考因子选择")).toHaveCount(0);
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("dialog", { name: "调整选书决策输入范围" })).toContainText("步骤 3 / 3");
    const factorSection = page.getByLabel("参考因子选择");
    await expect(factorSection).toContainText("近期阅读上下文");
    await expect(factorSection).toContainText("已读偏好与完成记录");
    await expect(factorSection).toContainText("阅读节奏与投入能力");
    await expect(factorSection).toContainText("近 30 天有 16 本阅读记录");
    await expect(factorSection.getByLabel("近期阅读时间范围")).toHaveValue("auto");
    await factorSection.getByLabel("近期阅读时间范围").selectOption("60");
    await expect(factorSection).toContainText("近 60 天有 16 本阅读记录");
    await expect(factorSection).toContainText("已缓存统计可用");
    await expect(factorSection).toContainText("本次将使用：1 本候选书，0 项参考因子");
    await page.getByLabel("参考因子选择").getByRole("checkbox", { name: "近期阅读上下文" }).check();
    await page.getByLabel("参考因子选择").getByRole("checkbox", { name: "已读偏好与完成记录" }).check();
    await page.getByLabel("参考因子选择").getByRole("checkbox", { name: "阅读节奏与投入能力" }).check();
    await expect(factorSection).toContainText("本次将使用：1 本候选书，3 项参考因子");
    await page.getByRole("button", { name: "生成决策" }).click();
    await expect(page.getByRole("heading", { name: "选书决策", exact: true })).toBeVisible();
    await expect(page.getByLabel("选书决策助手")).toContainText("推荐下一本");
    await expect(page.getByLabel("选书决策助手")).toContainText("月亮与六便士");
    await expect(page.getByLabel("选书决策标题区")).toContainText("新生成");
    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(page.getByLabel("主推荐")).toContainText("为什么现在读");
    await expect(page.getByLabel("取舍对比")).toContainText("取舍理由");
    await expect(page.getByLabel("行动清单")).toContainText("下一步动作");
    await expect(page.getByLabel("依据说明")).toBeVisible();
    await expectBookDecisionTradeoffPillsCompact(page);
    await expect(page.getByLabel("候选书选择")).toHaveCount(0);
    await expect(page.getByLabel("参考因子选择")).toHaveCount(0);
    await expect(page.getByLabel("选书决策输入范围")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出 Markdown" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新生成" })).toBeVisible();
    await expect(await getInvokeCount(page, "summarize_book_decision")).toBe(1);
    await expect(await getLastInvokeArgs(page, "summarize_book_decision")).toMatchObject({
      goal: "推进长期书"
    });
    await page.getByRole("button", { name: "导出 Markdown" }).click();
    await expect(page.getByLabel("选书决策导出结果")).toContainText("已导出");
    await expect(page.getByLabel("选书决策导出结果")).toContainText("book-decision-1725955200.md");
    await expect(await getInvokeCount(page, "export_book_decision_markdown")).toBe(1);
    await page.getByRole("button", { name: "重新生成" }).click();
    await expect(page.getByRole("dialog", { name: "调整选书决策输入范围" })).toContainText("步骤 1 / 3");
    await page.getByRole("button", { name: "取消" }).click();
    await page.reload();
    await openShelfSubNav(page, "候选书架");
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await expect(page.getByLabel("本次选书目标").getByRole("radio", { name: "推进长期书" })).toBeChecked();
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByLabel("候选书选择").getByRole("checkbox", { name: "月亮与六便士" })).toBeChecked();
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByLabel("参考因子选择").getByLabel("近期阅读时间范围")).toHaveValue("60");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("heading", { name: "候选书架", exact: true })).toBeVisible();
    await openPrimaryNav(page, "发现");
    await expect(page.getByRole("heading", { name: /下一本书/ })).toBeVisible();
    await discoverySearchInput.evaluate((input) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "ping" }));
      input.value = "ping";
      input.dispatchEvent(new InputEvent("input", { data: "ping", inputType: "insertCompositionText", bubbles: true, isComposing: true }));
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "平" }));
      input.value = "平";
      input.dispatchEvent(new InputEvent("input", { data: "平", inputType: "insertText", bubbles: true, isComposing: false }));
    });
    await expect(discoverySearchInput).toHaveValue("平");
    await expect(discoverySearchInput).not.toHaveValue(/ping/);
    await page.getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”").fill("三体");
    await page.getByRole("button", { name: /^搜索$/ }).click();
    await expect(page.getByLabel("最近搜索关键词").getByRole("button", { name: "三体" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 条可浏览结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "三体" })).toBeVisible();
    const threeBodySearchCard = page.locator(".search-results .discovery-book-card").filter({
      has: page.getByRole("heading", { name: "三体" })
    });
    await threeBodySearchCard.getByRole("button", { name: "保存候选" }).click();
    await expect(page.getByLabel("通知").getByText("已保存《三体》到本地候选")).toBeVisible();
    await expect(threeBodySearchCard.getByRole("button", { name: "已保存" })).toBeVisible();
    await expect(page.getByLabel("本地候选").getByText("三体")).toBeVisible();
    await expect(await getInvokeCount(page, "upsert_reading_item_state")).toBeGreaterThanOrEqual(1);
    await openShelfSubNav(page, "候选书架");
    await expect(page.getByRole("heading", { name: "候选书架", exact: true })).toBeVisible();
    await expect(page.getByLabel("候选书架条目")).toContainText("三体");
    await openPrimaryNav(page, "统计");
    await openPrimaryNav(page, "发现");
    await expect(page.getByLabel("本地候选").getByText("三体")).toBeVisible();
    await page.getByLabel("最近搜索关键词").getByRole("button", { name: "三体" }).click();
    await expect(discoverySearchInput).toHaveValue("三体");
    await page.getByRole("button", { name: /^搜索$/ }).click();
    await expect(page.getByRole("heading", { name: "2 条可浏览结果" })).toBeVisible();
    await page.locator(".search-results").getByRole("button", { name: "找相似" }).first().click();
    await expect(page.getByRole("heading", { name: "围绕《三体》继续找" })).toBeVisible();
    await expect(page.getByText("相似推荐接口暂时不可用，已改用书名搜索兜底。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 条搜索兜底结果" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "黑暗森林" })).toBeVisible();
    await page.getByRole("button", { name: "返回发现" }).click();
    await expect(page.getByRole("heading", { name: /下一本书/ })).toBeVisible();

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "账户与同步" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "已保存凭据" })).toBeVisible();
    await openSettingsCategory(page, "AI 设置");
    await expect(page.getByRole("heading", { name: "已配置 AI Provider" })).toBeVisible();
    await openSettingsCategory(page, "导出设置");
    await expect(page.getByLabel("导出保存位置")).toContainText("后续导出");
    await openSettingsCategory(page, "高级维护");
    await expect(page.getByLabel("高级维护")).toContainText("本地诊断");
    await expect(page.getByLabel("本地缓存")).toContainText("缓存记录");
    await expect(page.getByLabel("数据库路径")).toHaveCount(0);
    await openSettingsDiagnostics(page);
    await expect(page.getByLabel("数据库路径")).toContainText("app.db");
    await expect(page.getByLabel("同步状态")).toContainText("书架");
    await expect(page.getByLabel("缓存表")).toContainText("本地阅读状态");
    await expect(page.getByLabel("缓存表")).toContainText("AI 阅读成果");
    await page.getByRole("button", { name: "导出诊断信息" }).click();
    await expect(page.getByLabel("通知").getByText(/已导出诊断信息：wxreadmaster-diagnostics-/)).toBeVisible();
    await expect(page.getByText("sk-e2e-secret")).toHaveCount(0);
    await expect(await getInvokeCount(page, "export_diagnostics")).toBe(1);
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await expect(page.getByLabel("数据库路径")).toHaveCount(0);
    await expect(page.getByLabel("本地数据备份")).toContainText("不包含微信读书 API Key");
    await page.getByRole("button", { name: "导出本地备份" }).click();
    await expect(page.getByLabel("通知").getByText(/已导出本地备份：wxreadmaster-backup-/)).toBeVisible();
    await expect(page.getByLabel("本地数据备份")).toContainText("reading-cache.sqlite3");
    await expect(page.getByLabel("本地数据备份")).not.toContainText("ai-credentials.hold");
    await page.getByRole("button", { name: "恢复最近备份" }).click();
    await expect(page.getByRole("dialog", { name: "确认恢复本地备份？" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "确认恢复本地备份？" })).toHaveCount(0);
    await page.getByRole("button", { name: "恢复最近备份" }).click();
    await page.getByRole("button", { name: "确认恢复" }).click();
    await expect(page.getByLabel("通知").getByText("已恢复本地数据备份，请重启应用以确保所有页面重新读取数据库。")).toBeVisible();
    await expect(await getInvokeCount(page, "export_local_data_backup")).toBe(1);
    await expect(await getInvokeCount(page, "restore_local_data_backup")).toBe(1);
    await openSettingsCategory(page, "导出设置");
    await expect(page.getByLabel("导出保存位置")).toContainText("默认目录");
    await page.getByPlaceholder("例如 D:/wxreadmaster-exports").fill("D:/wxreadmaster-exports");
    await page.getByRole("button", { name: "保存导出目录" }).click();
    await expect(page.getByLabel("通知").getByText("导出保存位置已更新，只影响后续导出文件。")).toBeVisible();
    await expect(page.getByLabel("导出保存位置")).toContainText("自定义目录");
    await expect(page.getByLabel("导出保存位置")).toContainText("D:/wxreadmaster-exports");
    await page.getByRole("button", { name: "恢复默认" }).click();
    await expect(page.getByLabel("通知").getByText("已恢复默认导出保存位置。")).toBeVisible();
    await expect(page.getByLabel("导出保存位置")).toContainText("默认目录");
    await expect(await getInvokeCount(page, "save_custom_export_directory")).toBe(1);
    await expect(await getInvokeCount(page, "choose_custom_export_directory")).toBe(0);
    await expect(await getInvokeCount(page, "reset_custom_export_directory")).toBe(1);
    await openSettingsCategory(page, "高级维护");
    await expect(page.getByLabel("本地数据库位置")).toContainText("默认目录");
    await expect(page.getByLabel("本地数据库位置")).toContainText("API Key 和 AI API Key");
    await openSettingsDiagnostics(page);
    await expect(page.getByLabel("数据库路径")).toContainText("最近迁移/恢复错误");
    await expect(page.getByLabel("数据库路径")).toContainText("目标目录不可写");
    await closeSettingsDiagnostics(page);
    await page.getByRole("button", { name: "选择并迁移目录" }).click();
    await expect(page.getByRole("dialog", { name: "确认迁移本地数据目录？" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "确认迁移本地数据目录？" })).toContainText("D:/wxreadmaster-data");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "确认迁移本地数据目录？" })).toHaveCount(0);
    await page.getByRole("button", { name: "选择并迁移目录" }).click();
    await page.getByRole("button", { name: "确认迁移" }).click();
    await expect(page.getByLabel("通知").getByText("本地数据库已迁移，请重启应用后继续使用。API Key 仍保留在本机安全存储中。")).toBeVisible();
    await expect(page.getByLabel("本地数据库位置")).toContainText("自定义目录");
    await expect(page.getByLabel("本地数据库位置")).toContainText("D:/wxreadmaster-data");
    await expect(await getInvokeCount(page, "choose_custom_data_directory")).toBe(2);
    await expect(await getInvokeCount(page, "migrate_local_data_directory")).toBe(1);
    await openSettingsCategory(page, "AI 设置");
    await expect(page.locator('input[value="https://api.openai.com/v1"]')).toBeVisible();
    await expect(page.locator('input[value="gpt-4o-mini"]')).toBeVisible();
    await expect(page.getByPlaceholder("已保存，留空则不更改")).toBeVisible();
    await expect(page.getByText("sk-e2e-ai-secret")).toHaveCount(0);
    await page.locator('input[value="gpt-4o-mini"]').fill("gpt-4.1-mini");
    await page.getByRole("button", { name: "保存 AI 设置" }).click();
    await expect(page.getByLabel("通知").getByText("AI Provider 设置已保存，已保留原有 AI Key。")).toBeVisible();
    await expect(page.locator('input[value="gpt-4.1-mini"]')).toBeVisible();
    await page.getByRole("button", { name: "测试连通性" }).click();
    await expect(page.getByLabel("通知").getByText("AI Provider 连通性测试通过。")).toBeVisible();
    await page.getByPlaceholder("已保存，留空则不更改").fill("sk-new-ai-key-123456");
    await page.getByRole("button", { name: "保存 AI 设置" }).click();
    await expect(page.getByLabel("通知").getByText("AI 设置和新 Key 已保存到本机安全存储。")).toBeVisible();
    await page.getByRole("button", { name: "移除 AI Key" }).click();
    await expect(page.getByRole("dialog", { name: "确认移除 AI API Key？" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "确认移除 AI API Key？" })).toHaveCount(0);
    await page.getByRole("button", { name: "移除 AI Key" }).click();
    await page.getByRole("button", { name: "确认移除" }).click();
    await expect(page.getByLabel("通知").getByText("已移除本机保存的 AI API Key。历史 AI 阅读成果缓存不会被删除。")).toBeVisible();
    await expect(page.locator(".toast-card")).toHaveCount(0);
    await openSettingsCategory(page, "高级维护");
    await openSettingsDiagnostics(page);
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "AI 阅读成果" })).toContainText("3");
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "书架" })).toContainText("4");
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "本地阅读状态" })).toContainText("2");
    await closeSettingsDiagnostics(page);
    await page.getByRole("button", { name: "清除 AI 输出缓存" }).click();
    await expect(page.getByRole("dialog", { name: "确认清除 AI 输出缓存？" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "确认清除 AI 输出缓存？" })).toContainText("本地阅读状态");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "确认清除 AI 输出缓存？" })).toHaveCount(0);
    await page.getByRole("button", { name: "清除 AI 输出缓存" }).click();
    await page.getByRole("button", { name: "确认清除" }).click();
    await expect(
      page.getByLabel("通知").getByText("已清除 3 条 AI 输出缓存，API Key、微信读书缓存和本地阅读状态不受影响。")
    ).toBeVisible();
    await openSettingsDiagnostics(page);
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "AI 阅读成果" })).toContainText("0");
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "书架" })).toContainText("4");
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "本地阅读状态" })).toContainText("2");
    await expect(await getInvokeCount(page, "clear_ai_output_cache")).toBe(1);
    await closeSettingsDiagnostics(page);
    await closeSettingsDialog(page);
    await openPrimaryNav(page, "书籍复盘");
    await expect(page.getByLabel("已生成复盘")).toContainText("深度工作");
    await page.getByRole("button", { name: "导出书籍复盘" }).click();
    const exportDialog = page.getByRole("dialog", { name: "导出书籍复盘" });
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog).toContainText("只导出本地已生成的 AI 复盘");
    await expect(exportDialog.getByRole("button", { name: "下一步" })).toBeDisabled();
    await expect(exportDialog.getByLabel("可导出的书籍复盘")).toContainText("深度工作");
    await expect(exportDialog.getByLabel("可导出的书籍复盘")).toContainText("1 条反馈");
    await exportDialog.getByPlaceholder("按书名、作者或复盘概览筛选").fill("不存在");
    await expect(exportDialog.getByLabel("可导出的书籍复盘")).toContainText("没有匹配的书籍复盘。");
    await exportDialog.getByPlaceholder("按书名、作者或复盘概览筛选").fill("深度");
    await exportDialog.getByRole("checkbox").check();
    await expect(exportDialog).toContainText("已选 1 本");
    await exportDialog.getByRole("button", { name: "下一步" }).click();
    await expect(exportDialog.getByLabel("导出设置确认")).toContainText("将导出你手动选择的 1 本书籍复盘");
    await expect(exportDialog.getByLabel("导出设置确认")).toContainText("不会同步微信读书远端");
    await expect(exportDialog.getByRole("checkbox", { name: /包含行动反馈/ })).toBeChecked();
    await expect(exportDialog.getByRole("checkbox", { name: /包含复盘问题反馈/ })).toBeChecked();
    await expect(exportDialog.getByRole("checkbox", { name: /包含代表性摘录/ })).toBeChecked();
    await exportDialog.getByRole("checkbox", { name: /包含复盘问题反馈/ }).uncheck();
    await exportDialog.getByRole("checkbox", { name: /包含代表性摘录/ }).uncheck();
    await exportDialog.getByRole("button", { name: "开始导出" }).click();
    await expect(exportDialog.getByLabel("书籍复盘导出结果")).toContainText("导出完成");
    await expect(exportDialog.getByLabel("书籍复盘导出结果")).toContainText("深度工作-ai-summary-1725955200.md");
    await exportDialog.getByRole("button", { name: "完成" }).click();
    await expect(exportDialog).toHaveCount(0);
    await expect(page.getByLabel("复盘导出结果")).toContainText("已导出 1 本书籍复盘");
    await expect(page.getByLabel("复盘导出结果")).toContainText("wxreadmaster-book-reviews-1725955200");
    await expect(await getInvokeCount(page, "export_book_notes_summaries_markdown")).toBe(1);
    await expect(await getLastInvokeArgs(page, "export_book_notes_summaries_markdown")).toEqual({
      bookIds: ["book-deep-work"],
      options: {
        includeActionFeedback: true,
        includeReflectionFeedback: false,
        includeRepresentativeQuotes: false
      }
    });
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(0);
    await page.getByLabel("已生成复盘").getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
    await expect(page.getByLabel("AI 复盘数据边界")).toContainText("本地缓存");
    await expect(await getInvokeCount(page, "summarize_book_notes")).toBe(0);
    await openPrimaryNav(page, "设置");
    await openSettingsCategory(page, "高级维护");
    await page.getByRole("button", { name: "清除本地缓存" }).click();
    await expect(page.getByRole("dialog", { name: "确认清除本地缓存？" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "确认清除本地缓存？" })).toHaveCount(0);
    await page.getByRole("button", { name: "清除本地缓存" }).click();
    await page.getByRole("button", { name: "确认清除" }).click();
    await expect(page.getByLabel("通知").getByText("已清除 24 条本地缓存记录，API Key 不受影响。")).toBeVisible();
    await openSettingsDiagnostics(page);
    await expect(page.getByLabel("缓存表")).toContainText("AI 阅读成果");
    await expect(page.getByLabel("缓存表").locator("article", { hasText: "AI 阅读成果" })).toContainText("0");

    await expectNoHorizontalOverflow(page);
  });

  test("选书决策命中本地缓存时直接展示结果", async ({ page }) => {
    await installTauriMock(page, { cachedBookDecision: true });
    await page.goto("/");

    await openPrimaryNav(page, "发现");
    await expect(page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" })).toBeVisible();
    await page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await selectBookDecisionCandidate(page, "月亮与六便士");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "生成决策" }).click();

    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(page.getByLabel("主推荐")).toContainText("月亮与六便士");
    await expect(page.getByLabel("选书决策助手")).toContainText("本地缓存");
    await expect(page.getByLabel("选书决策缓存说明")).toContainText("已使用相同输入的本地缓存，未重新调用 AI");
    await expect(page.getByLabel("选书决策输入范围")).toHaveCount(0);
    await expect(await getInvokeCount(page, "get_latest_book_decision")).toBeGreaterThan(0);
    await expect(await getInvokeCount(page, "summarize_book_decision")).toBe(0);
  });

  test("选书决策展示旧缓存时保留输入变化说明", async ({ page }) => {
    await installTauriMock(page, { staleBookDecision: true });
    await page.goto("/");

    await openPrimaryNav(page, "发现");
    await page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await selectBookDecisionCandidate(page, "月亮与六便士");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "生成决策" }).click();

    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(page.getByLabel("选书决策助手")).toContainText("使用旧缓存");
    await expect(page.getByLabel("选书决策缓存说明")).toContainText("当前候选书或目标与缓存输入不同");
    await expect(page.getByLabel("选书决策缓存说明")).toContainText("点击重新生成");
    await expect(await getInvokeCount(page, "get_latest_book_decision")).toBeGreaterThan(0);
    await expect(await getInvokeCount(page, "summarize_book_decision")).toBe(0);
  });

  test("选书决策行动清单不泄漏内部动作码", async ({ page }) => {
    await installTauriMock(page, { internalBookDecisionActions: true });
    await page.goto("/");

    await openPrimaryNav(page, "发现");
    await page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await selectBookDecisionCandidate(page, "月亮与六便士");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "生成决策" }).click();

    const decisionAssistant = page.getByLabel("选书决策助手");
    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(decisionAssistant).not.toContainText("openDetails");
    await expect(decisionAssistant).not.toContainText("scheduleReadingBlock");
    await expect(decisionAssistant).not.toContainText("postReadReview");
    await expect(page.getByLabel("行动清单")).toContainText("打开《月亮与六便士》详情");
    await expect(page.getByLabel("行动清单")).toContainText("安排一个 30-45 分钟阅读时段");
    await expect(page.getByLabel("行动清单")).toContainText("读完后写 3 条复盘");
    await expect(page.getByLabel("行动清单")).toContainText("已完成 0 / 共 3 项");

    const firstAction = page.getByRole("button", { name: /标记已完成：打开《月亮与六便士》详情/ });
    await expect(firstAction).toHaveAttribute("aria-pressed", "false");
    await firstAction.click();
    await expect(page.getByRole("button", { name: /标记未完成：打开《月亮与六便士》详情/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByLabel("行动清单")).toContainText("已完成 1 / 共 3 项");

    await page.reload();
    await openPrimaryNav(page, "发现");
    await page.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByLabel("候选书选择")).toContainText("已选 1 / 8");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "生成决策" }).click();
    await expect(page.getByLabel("选书决策结果")).toBeVisible();
    await expect(page.getByRole("button", { name: /标记未完成：打开《月亮与六便士》详情/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("选书决策候选池可搜索第九本以后但最多纳入八本", async ({ page }) => {
    await installTauriMock(page, { manyCandidateBooks: true });
    await page.goto("/");

    await openShelfSubNav(page, "候选书架");
    await page.getByRole("button", { name: "推荐下一本" }).click();
    await page.getByRole("button", { name: "下一步" }).click();

    const candidateSection = page.getByLabel("候选书选择");
    await expect(candidateSection).toContainText("已选 0 / 8");
    await expect(candidateSection).toContainText("共 10 本");
    await expect(candidateSection.getByRole("checkbox")).toHaveCount(10);
    await expect(candidateSection.getByRole("checkbox", { name: "追风筝的人" })).toBeVisible();
    await candidateSection.getByRole("button", { name: "选择前 8 本" }).click();
    await expect(candidateSection).toContainText("已选 8 / 8");

    await candidateSection.getByPlaceholder("搜索候选书名或作者").fill("追风");
    await expect(candidateSection.getByRole("checkbox")).toHaveCount(1);
    await expect(candidateSection).toContainText("追风筝的人");
    await candidateSection.getByRole("checkbox", { name: "追风筝的人" }).click();
    await expect(candidateSection).toContainText("最多纳入 8 本，请先取消一本。");
    await expect(candidateSection.getByRole("checkbox", { name: "追风筝的人" })).not.toBeChecked();

    await candidateSection.getByPlaceholder("搜索候选书名或作者").fill("候选书 2");
    await candidateSection.getByRole("checkbox", { name: "候选书 2" }).uncheck();
    await expect(candidateSection).toContainText("已选 7 / 8");
    await candidateSection.getByPlaceholder("搜索候选书名或作者").fill("追风");
    await candidateSection.getByRole("checkbox", { name: "追风筝的人" }).check();
    await expect(candidateSection.getByRole("checkbox", { name: "追风筝的人" })).toBeChecked();
    await expect(candidateSection).toContainText("已选 8 / 8");
  });

  test("笔记页顶部同步和导出操作保持右侧聚合布局", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await expect(page.getByRole("heading", { name: "划线、想法和书签数量" })).toBeVisible();

    const layout = await page.locator(".notes-hero").evaluate((hero) => {
      const syncButton = Array.from(hero.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("同步笔记")
      );
      const bulkExportButton = Array.from(hero.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("批量导出")
      );

      if (!syncButton || !bulkExportButton) {
        throw new Error("笔记页顶部操作按钮缺失");
      }

      const heroRect = hero.getBoundingClientRect();
      const syncRect = syncButton.getBoundingClientRect();
      const bulkExportRect = bulkExportButton.getBoundingClientRect();

      return {
        gap: bulkExportRect.left - syncRect.right,
        yDelta: Math.abs(syncRect.top - bulkExportRect.top),
        rightInset: heroRect.right - bulkExportRect.right
      };
    });

    expect(layout.yDelta).toBeLessThanOrEqual(2);
    expect(layout.gap).toBeGreaterThanOrEqual(8);
    expect(layout.gap).toBeLessThanOrEqual(24);
    expect(layout.rightInset).toBeLessThanOrEqual(28);
  });

  test("笔记页搜索支持中文输入法并筛选书籍", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await expect(page.getByRole("heading", { name: "划线、想法和书签数量" })).toBeVisible();

    const notesSearchInput = page.getByPlaceholder("按书名或作者筛选笔记");
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /三体/ })).toBeVisible();

    await notesSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "shendu" }));
      nativeValueSetter?.call(input, "shendu");
      input.dispatchEvent(
        new InputEvent("input", {
          data: "shendu",
          inputType: "insertCompositionText",
          bubbles: true,
          isComposing: true
        })
      );
    });
    await expect(notesSearchInput).toHaveValue("shendu");
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /三体/ })).toBeVisible();

    await notesSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeValueSetter?.call(input, "深度");
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "深度" }));
      input.dispatchEvent(
        new InputEvent("input", {
          data: "深度",
          inputType: "insertText",
          bubbles: true,
          isComposing: false
        })
      );
    });
    await expect(notesSearchInput).toHaveValue("深度");
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toBeVisible();
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /三体/ })).toHaveCount(0);

    await notesSearchInput.fill("三");
    await expect(notesSearchInput).toHaveValue("三");
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /三体/ })).toBeVisible();
    await expect(page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ })).toHaveCount(0);
  });

  test("批量导出进行中在弹窗顶部显示明确状态", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await expect(page.getByRole("dialog", { name: "批量导出向导" })).toBeVisible();
    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await page.evaluate(() => {
      window.__e2eDelayBulkExportUntilCancel = true;
    });
    await page.getByRole("button", { name: "开始导出" }).click();

    const status = page.getByLabel("批量导出状态");
    await expect(status).toBeVisible();
    await expect(status).toContainText("正在同步缺失笔记并导出");
    await expect(status).toContainText("同步并发 2");
    await expect(status.getByRole("button", { name: "停止后续同步" })).toBeVisible();

    const progress = page.getByLabel("批量导出同步进度");
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("同步进度");
    await expect(progress).toContainText("1 / 2");
    await expect(progress).toContainText("当前：三体");
    await expect(progress).toContainText("已导出 1");
    await expect(progress).toContainText("失败 0");

    const progressStatsLayout = await progress.locator(".bulk-export-progress-stats span").evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        const style = window.getComputedStyle(item);
        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width),
          display: style.display,
          alignSelf: style.alignSelf,
          borderRadius: style.borderRadius
        };
      })
    );

    expect(progressStatsLayout).toHaveLength(4);
    for (const item of progressStatsLayout) {
      expect(item.height).toBeLessThanOrEqual(32);
      expect(item.width / item.height).toBeGreaterThanOrEqual(1.7);
      expect(item.display).toBe("flex");
    }

    await status.getByRole("button", { name: "停止后续同步" }).click();
    await expect(page.getByLabel("批量导出报告")).toContainText("用户已取消，未开始同步。");
  });

  test("批量导出弹窗按设置导出结果分阶段展示", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await expect(page.getByLabel("导出设置")).toBeVisible();
    await expect(page.getByLabel("批量导出书籍预检")).toBeVisible();

    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await page.evaluate(() => {
      window.__e2eDelayBulkExportUntilCancel = true;
    });
    await page.getByRole("button", { name: "开始导出" }).click();

    await expect(page.getByLabel("批量导出状态")).toBeVisible();
    await expect(page.getByLabel("正在预检批量导出")).toHaveCount(0);
    await expect(page.getByLabel("导出设置")).toHaveCount(0);
    await expect(page.getByLabel("批量导出书籍预检")).toHaveCount(0);
    await expect(page.getByLabel("批量导出报告")).toHaveCount(0);

    await page.getByLabel("批量导出状态").getByRole("button", { name: "停止后续同步" }).click();
    await expect(page.getByLabel("批量导出报告")).toBeVisible();
    await expect(page.getByLabel("批量导出状态")).toHaveCount(0);
    await expect(page.getByLabel("正在预检批量导出")).toHaveCount(0);
    await expect(page.getByLabel("导出设置")).toHaveCount(0);
    await expect(page.getByLabel("批量导出书籍预检")).toHaveCount(0);
  });

  test("批量导出同步失败后可单本重试", async ({ page }) => {
    await installTauriMock(page, { bulkExportFailure: true });
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await page.getByRole("button", { name: "开始导出" }).click();

    const report = page.getByLabel("批量导出报告");
    await expect(report).toContainText("三体");
    await expect(report).toContainText("微信读书接口暂时无法连接，请稍后重试。");
    await expect(report.getByRole("button", { name: "重试 三体" })).toBeVisible();
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(1);

    await report.getByRole("button", { name: "重试 三体" }).click();

    await expect(report).toContainText("已同步缺失笔记并导出 Markdown。");
    await expect(report).not.toContainText("深度工作");
    await expect(report.getByRole("button", { name: "重试 三体" })).toHaveCount(0);
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(2);
  });

  test("批量导出命令失败后保留设置并可重试", async ({ page }) => {
    await installTauriMock(page, { bulkExportCommandFailure: true });
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await page.getByRole("button", { name: "开始导出" }).click();

    const report = page.getByLabel("批量导出报告");
    await expect(report).toContainText("导出目录不可写");
    await expect(report).toContainText("导出目录暂时不可写，请稍后重试。");
    await expect(report).toContainText("当前不会丢失预检结果和导出设置");
    await expect(report).toContainText("可以直接重试，也可以返回设置调整策略。");
    await expect(page.getByLabel("导出设置")).toHaveCount(0);
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(1);

    await page.getByRole("button", { name: "返回设置" }).click();
    await expect(page.getByLabel("导出设置")).toBeVisible();
    await expect(page.getByLabel("导出策略").getByText("先同步缺失笔记再导出")).toBeVisible();
    await page.getByRole("button", { name: "开始导出" }).click();

    await expect(report).toContainText("导出完成");
    await expect(report).toContainText("已同步缺失笔记并导出 Markdown。");
    await expect(await getInvokeCount(page, "export_bulk_notes")).toBe(2);
  });

  test("批量导出书籍预检列表独立滚动且操作区保持可见", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installTauriMock(page, { longBulkExportList: true });
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await expect(page.getByLabel("批量导出书籍预检")).toBeVisible();

    const layout = await page.getByRole("dialog", { name: "批量导出向导" }).evaluate((dialog) => {
      const list = dialog.querySelector<HTMLElement>(".bulk-export-list");
      const actions = dialog.querySelector<HTMLElement>(".bulk-export-actions");
      const setup = dialog.querySelector<HTMLElement>(".bulk-export-setup");

      if (!list || !actions || !setup) {
        throw new Error("批量导出列表或操作区缺失");
      }

      const dialogStyle = window.getComputedStyle(dialog);
      const listStyle = window.getComputedStyle(list);
      const dialogRect = dialog.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();

      return {
        dialogOverflowY: dialogStyle.overflowY,
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
        dialogClientHeight: dialog.clientHeight,
        dialogScrollHeight: dialog.scrollHeight,
        setupClientHeight: setup.clientHeight,
        listOverflowY: listStyle.overflowY,
        listScrolls: list.scrollHeight > list.clientHeight + 1,
        listClientHeight: list.clientHeight,
        actionsVisibleInDialog:
          actionsRect.top >= dialogRect.top && actionsRect.bottom <= dialogRect.bottom
      };
    });

    expect(layout.dialogOverflowY).toBe("hidden");
    expect(layout.dialogScrolls, JSON.stringify(layout)).toBe(false);
    expect(layout.listOverflowY).toBe("auto");
    expect(layout.listScrolls).toBe(true);
    expect(layout.listClientHeight).toBeGreaterThanOrEqual(240);
    expect(layout.actionsVisibleInDialog).toBe(true);
  });

  test("批量导出书籍列表随策略显示不同处理状态", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    const preflightList = page.getByLabel("批量导出书籍预检");
    const threeBodyRow = preflightList.locator("article", { hasText: "三体" });

    await expect(threeBodyRow).toContainText("需要同步");
    await expect(threeBodyRow).not.toContainText("将同步");

    await page.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();
    await expect(threeBodyRow).toContainText("将同步");
    await expect(threeBodyRow).toContainText("将按队列读取后导出。");

    await page.getByLabel("导出策略").getByText("只导出选中的书").click();
    await expect(page.getByLabel("导出设置")).toContainText("已选择 0 本");
    await expect(threeBodyRow).toContainText("未选");
    await threeBodyRow.getByRole("checkbox", { name: "选择 三体" }).click();
    await expect(page.getByLabel("导出设置")).toContainText("已选择 1 本");
    await expect(threeBodyRow).toContainText("已选");
  });

  test("书籍复盘导出弹窗在大列表下保持列表滚动且操作区固定", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installTauriMock(page, { manyBookReviewSummaries: true });
    await page.goto("/");

    await openPrimaryNav(page, "书籍复盘");
    await page.getByRole("button", { name: "导出书籍复盘" }).click();
    const dialog = page.getByRole("dialog", { name: "导出书籍复盘" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("可导出的书籍复盘").locator("label")).toHaveCount(18);

    const layout = await dialog.evaluate((element) => {
      const list = element.querySelector<HTMLElement>(".book-review-export-list");
      const actions = element.querySelector<HTMLElement>(".bulk-export-actions");

      if (!list || !actions) {
        throw new Error("复盘导出列表或操作区缺失");
      }

      const dialogStyle = window.getComputedStyle(element);
      const listStyle = window.getComputedStyle(list);
      const dialogRect = element.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();

      return {
        dialogOverflowY: dialogStyle.overflowY,
        dialogScrolls: element.scrollHeight > element.clientHeight + 1,
        listOverflowY: listStyle.overflowY,
        listScrolls: list.scrollHeight > list.clientHeight + 1,
        listClientHeight: list.clientHeight,
        actionsVisibleInDialog:
          actionsRect.top >= dialogRect.top && actionsRect.bottom <= dialogRect.bottom
      };
    });

    expect(layout.dialogOverflowY).toBe("hidden");
    expect(layout.dialogScrolls).toBe(false);
    expect(layout.listOverflowY).toBe("auto");
    expect(layout.listScrolls).toBe(true);
    expect(layout.listClientHeight).toBeGreaterThanOrEqual(260);
    expect(layout.actionsVisibleInDialog).toBe(true);

    await dialog.getByPlaceholder("按书名、作者或复盘概览筛选").fill("复盘样本 18");
    await expect(dialog.getByLabel("可导出的书籍复盘").locator("label")).toHaveCount(1);
    await expect(dialog.getByLabel("可导出的书籍复盘")).toContainText("复盘样本 18");
    await dialog.getByRole("checkbox").check();
    await expect(dialog).toContainText("已选 1 本，当前筛选 1 本");
    await expect(dialog.getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  test("书籍复盘导出弹窗在窄屏下不出现水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 900 });
    await installTauriMock(page, { manyBookReviewSummaries: true });
    await page.goto("/");

    await openPrimaryNav(page, "书籍复盘");
    await page.getByRole("button", { name: "导出书籍复盘" }).click();
    const dialog = page.getByRole("dialog", { name: "导出书籍复盘" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("可导出的书籍复盘").locator("label")).toHaveCount(18);
    await expectNoHorizontalOverflow(page);

    const stackedLayout = await dialog.evaluate((element) => {
      const toolbar = element.querySelector<HTMLElement>(".book-review-export-toolbar");
      const row = element.querySelector<HTMLElement>(".book-review-export-row");
      const meta = element.querySelector<HTMLElement>(".book-review-export-row-meta");

      if (!toolbar || !row || !meta) {
        throw new Error("复盘导出窄屏布局元素缺失");
      }

      return {
        toolbarColumns: window.getComputedStyle(toolbar).gridTemplateColumns,
        rowHasHorizontalOverflow: row.scrollWidth > row.clientWidth + 1,
        metaJustifyItems: window.getComputedStyle(meta).justifyItems
      };
    });

    expect(stackedLayout.toolbarColumns.includes(" ")).toBe(false);
    expect(stackedLayout.rowHasHorizontalOverflow).toBe(false);
    expect(stackedLayout.metaJustifyItems).toBe("start");
  });

  test("书籍复盘导出失败后可在结果步骤重试", async ({ page }) => {
    await installTauriMock(page, { bookReviewExportFailure: true });
    await page.goto("/");

    await openPrimaryNav(page, "书籍复盘");
    await page.getByRole("button", { name: "导出书籍复盘" }).click();
    const dialog = page.getByRole("dialog", { name: "导出书籍复盘" });

    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "下一步" }).click();
    await dialog.getByRole("checkbox", { name: /包含复盘问题反馈/ }).uncheck();
    await dialog.getByRole("button", { name: "开始导出" }).click();

    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("导出目录不可写");
    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("导出目录暂时不可写，请稍后重试。");
    await expect(dialog.getByRole("button", { name: "重试导出" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "返回设置" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "返回选择" })).toBeVisible();

    await dialog.getByRole("button", { name: "重试导出" }).click();
    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("导出完成");
    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("深度工作-ai-summary-1725955200.md");
    await expect(await getInvokeCount(page, "export_book_notes_summaries_markdown")).toBe(2);
    await expect(await getLastInvokeArgs(page, "export_book_notes_summaries_markdown")).toEqual({
      bookIds: ["book-deep-work"],
      options: {
        includeActionFeedback: true,
        includeReflectionFeedback: false,
        includeRepresentativeQuotes: true
      }
    });
  });

  test("书籍复盘导出失败后返回设置和选择时保留已选状态", async ({ page }) => {
    await installTauriMock(page, { bookReviewExportFailure: true });
    await page.goto("/");

    await openPrimaryNav(page, "书籍复盘");
    await page.getByRole("button", { name: "导出书籍复盘" }).click();
    const dialog = page.getByRole("dialog", { name: "导出书籍复盘" });

    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "下一步" }).click();
    await dialog.getByRole("checkbox", { name: /包含复盘问题反馈/ }).uncheck();
    await dialog.getByRole("button", { name: "开始导出" }).click();

    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("导出目录不可写");

    await dialog.getByRole("button", { name: "返回设置" }).click();
    await expect(dialog.getByLabel("导出设置确认")).toContainText("将导出你手动选择的 1 本书籍复盘");
    await expect(dialog.getByRole("checkbox", { name: /包含行动反馈/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /包含复盘问题反馈/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /包含代表性摘录/ })).toBeChecked();

    await dialog.getByRole("checkbox", { name: /包含行动反馈/ }).uncheck();
    await dialog.getByRole("button", { name: "返回选择" }).click();
    await expect(dialog.getByLabel("可导出的书籍复盘").getByRole("checkbox")).toBeChecked();
    await expect(dialog).toContainText("已选 1 本");
    await expect(dialog.getByRole("button", { name: "下一步" })).toBeEnabled();

    await dialog.getByRole("button", { name: "下一步" }).click();
    await expect(dialog.getByRole("checkbox", { name: /包含行动反馈/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /包含复盘问题反馈/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /包含代表性摘录/ })).toBeChecked();
    await dialog.getByRole("button", { name: "开始导出" }).click();

    await expect(dialog.getByLabel("书籍复盘导出结果")).toContainText("导出完成");
    await expect(await getInvokeCount(page, "export_book_notes_summaries_markdown")).toBe(2);
    await expect(await getLastInvokeArgs(page, "export_book_notes_summaries_markdown")).toEqual({
      bookIds: ["book-deep-work"],
      options: {
        includeActionFeedback: false,
        includeReflectionFeedback: false,
        includeRepresentativeQuotes: true
      }
    });
  });

  test("批量导出默认排除无划线想法的书并支持取消过滤", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    const preflightList = page.getByLabel("批量导出书籍预检");
    const excludeOption = page.getByRole("checkbox", { name: /排除无划线\/想法的书/ });

    await expect(excludeOption).toBeChecked();
    await expect(preflightList.locator("article")).toHaveCount(2);
    await expect(preflightList).not.toContainText("只有书签的书");

    await excludeOption.uncheck();
    await expect(excludeOption).not.toBeChecked();
    await expect(preflightList.locator("article")).toHaveCount(3);
    await expect(preflightList).toContainText("只有书签的书");
    await expect(preflightList.locator("article", { hasText: "只有书签的书" })).toContainText("无内容");
  });

  test("批量导出选中策略支持搜索过滤且状态标签不拉伸", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByRole("button", { name: "批量导出" }).click();
    await page.getByLabel("导出策略").getByText("只导出选中的书").click();

    await expect(page.getByLabel("导出设置")).toContainText("已选择 0 本");
    await expect(page.getByRole("button", { name: "开始导出" })).toBeDisabled();
    await expect(page.getByLabel("批量导出书籍预检").locator("article", { hasText: "深度工作" })).toContainText("未选");

    const toolbarLayout = await page.getByLabel("导出设置").evaluate((setup) => {
      const filter = setup.querySelector<HTMLElement>(".bulk-export-filter-option");
      const search = setup.querySelector<HTMLElement>(".search-field");
      const summary = setup.querySelector<HTMLElement>(".bulk-export-selection-summary");

      if (!filter || !search || !summary) {
        throw new Error("选中策略工具栏控件缺失");
      }

      const filterRect = filter.getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();

      return {
        filterTop: Math.round(filterRect.top),
        searchTop: Math.round(searchRect.top),
        summaryTop: Math.round(summaryRect.top),
        filterRight: Math.round(filterRect.right),
        searchLeft: Math.round(searchRect.left),
        searchRight: Math.round(searchRect.right),
        summaryLeft: Math.round(summaryRect.left)
      };
    });

    expect(Math.abs(toolbarLayout.filterTop - toolbarLayout.searchTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(toolbarLayout.searchTop - toolbarLayout.summaryTop)).toBeLessThanOrEqual(2);
    expect(toolbarLayout.filterRight).toBeLessThanOrEqual(toolbarLayout.searchLeft);
    expect(toolbarLayout.searchRight).toBeLessThanOrEqual(toolbarLayout.summaryLeft);

    const bulkSearchInput = page.getByPlaceholder("按书名或作者筛选导出书籍");
    await bulkSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "san" }));
      nativeValueSetter?.call(input, "san");
      input.dispatchEvent(new InputEvent("input", { data: "san", inputType: "insertCompositionText", bubbles: true, isComposing: true }));
    });
    await expect(page.getByLabel("批量导出书籍预检").locator("article")).toHaveCount(2);
    await bulkSearchInput.evaluate((input) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "三" }));
      nativeValueSetter?.call(input, "三");
      input.dispatchEvent(new InputEvent("input", { data: "三", inputType: "insertText", bubbles: true, isComposing: false }));
    });
    await expect(bulkSearchInput).toHaveValue("三");
    await expect(bulkSearchInput).not.toHaveValue(/san/);
    await expect(page.getByLabel("批量导出书籍预检").locator("article")).toHaveCount(1);
    await expect(page.getByLabel("批量导出书籍预检")).toContainText("三体");

    await bulkSearchInput.fill("三体");
    await expect(page.getByLabel("批量导出书籍预检").locator("article")).toHaveCount(1);
    await expect(page.getByLabel("批量导出书籍预检")).toContainText("三体");

    await page.getByLabel("导出策略").getByText("仅导出本地已缓存内容").click();
    await expect(page.getByLabel("批量导出书籍预检").locator("article")).toHaveCount(2);
    await expect(page.getByLabel("批量导出书籍预检")).toContainText("深度工作");
    await expect(page.getByLabel("批量导出书籍预检")).toContainText("三体");

    await page.getByLabel("导出策略").getByText("只导出选中的书").click();
    await expect(page.getByLabel("批量导出书籍预检").locator("article")).toHaveCount(1);

    await page.getByRole("checkbox", { name: "选择 三体" }).click();
    await expect(page.getByLabel("导出设置")).toContainText("已选择 1 本");

    const badgeWidth = await page
      .getByLabel("批量导出书籍预检")
      .locator("article", { hasText: "三体" })
      .locator("em")
      .evaluate((badge) => badge.getBoundingClientRect().width);
    expect(badgeWidth).toBeLessThanOrEqual(72);
  });

  test("窄屏布局不出现水平溢出并保留核心入口", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.getByLabel("应用窗口控制").getByText("个人阅读管理")).toBeVisible();
    await expect(page.getByLabel("阅读总览")).toContainText("已连接本地阅读工作台");
    await expectNoHorizontalOverflow(page);

    await openPrimaryNav(page, "发现");
    await expect(page.getByRole("heading", { name: "在自己的阅读宇宙里找下一本书" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "账户与同步" })).toBeVisible();
    await expect(page.getByLabel("数据库路径")).toHaveCount(0);
    await openSettingsCategory(page, "高级维护");
    await page.getByRole("button", { name: "清除本地缓存" }).click();
    await expect(page.getByRole("dialog", { name: "确认清除本地缓存？" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("触屏短视口下发现页搜索控件保持可触达", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "发现");

      const searchPanel = mobilePage.getByLabel("搜索", { exact: true });
      await expect(searchPanel).toBeVisible();
      await searchPanel.scrollIntoViewIfNeeded();

      const searchLayout = await mobilePage.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(".discovery-search-panel");
        const form = document.querySelector<HTMLElement>(".discovery-search-form");
        const input = document.querySelector<HTMLElement>(".discovery-search-form input");
        const formButtons = Array.from(
          document.querySelectorAll<HTMLElement>(".discovery-search-form button")
        );
        const scopeTabs = document.querySelector<HTMLElement>(".scope-tabs");
        const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
        const workspace = document.querySelector<HTMLElement>(".workspace");
        if (!panel || !form || !input || formButtons.length === 0 || !scopeTabs || !bottomNav || !workspace) {
          throw new Error("发现页搜索短视口布局元素缺失");
        }

        const navRect = bottomNav.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const formRect = form.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const scopeTabsRect = scopeTabs.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();

        return {
          allFormButtonsInsideViewport: formButtons.every((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= window.innerWidth &&
              rect.bottom <= window.innerHeight
            );
          }),
          allFormButtonsTouch: formButtons.every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }),
          formBottom: Math.round(formRect.bottom),
          formTop: Math.round(formRect.top),
          inputLeft: Math.round(inputRect.left),
          inputRight: Math.round(inputRect.right),
          navTop: Math.round(navRect.top),
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
          panelBottom: Math.round(panelRect.bottom),
          panelLeft: Math.round(panelRect.left),
          panelRight: Math.round(panelRect.right),
          panelTop: Math.round(panelRect.top),
          scopeTabsBottom: Math.round(scopeTabsRect.bottom),
          scopeTabsLeft: Math.round(scopeTabsRect.left),
          scopeTabsRight: Math.round(scopeTabsRect.right),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          workspaceBottom: Math.round(workspaceRect.bottom),
          workspaceCanScroll: workspace.scrollHeight > workspace.clientHeight,
          workspacePaddingBottom: Number.parseFloat(window.getComputedStyle(workspace).paddingBottom)
        };
      });

      expect(searchLayout.panelLeft).toBeGreaterThanOrEqual(0);
      expect(searchLayout.panelRight).toBeLessThanOrEqual(searchLayout.viewportWidth);
      expect(searchLayout.formTop).toBeGreaterThanOrEqual(0);
      expect(searchLayout.formBottom).toBeLessThanOrEqual(searchLayout.navTop);
      expect(searchLayout.inputLeft).toBeGreaterThanOrEqual(searchLayout.panelLeft);
      expect(searchLayout.inputRight).toBeLessThanOrEqual(searchLayout.panelRight);
      expect(searchLayout.scopeTabsLeft).toBeGreaterThanOrEqual(searchLayout.panelLeft);
      expect(searchLayout.scopeTabsRight).toBeLessThanOrEqual(searchLayout.panelRight);
      expect(searchLayout.allFormButtonsInsideViewport).toBe(true);
      expect(searchLayout.allFormButtonsTouch).toBe(true);
      expect(searchLayout.overflowX).toBe(false);
      expect(searchLayout.workspaceCanScroll).toBe(true);
      expect(searchLayout.workspaceBottom).toBeLessThanOrEqual(searchLayout.navTop);
      expect(searchLayout.workspacePaddingBottom).toBeGreaterThanOrEqual(28);

      await mobilePage.locator(".scope-tabs").scrollIntoViewIfNeeded();
      await mobilePage.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>(".workspace");
        const scopeTabs = document.querySelector<HTMLElement>(".scope-tabs");
        const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
        if (!workspace || !scopeTabs || !bottomNav) {
          throw new Error("发现页搜索范围滚动元素缺失");
        }

        const overlap = scopeTabs.getBoundingClientRect().bottom - bottomNav.getBoundingClientRect().top;
        if (overlap > 0) {
          workspace.scrollTop += overlap + 12;
        }
      });
      const scopeLayout = await mobilePage.locator(".scope-tabs").evaluate((scopeTabs) => {
        const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
        const scopeButtons = Array.from(scopeTabs.querySelectorAll<HTMLElement>("button"));
        if (!bottomNav || scopeButtons.length === 0) {
          throw new Error("发现页搜索范围布局元素缺失");
        }

        const scopeTabsRect = scopeTabs.getBoundingClientRect();
        const navRect = bottomNav.getBoundingClientRect();
        return {
          allScopeButtonsInsideViewport: scopeButtons.every((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= window.innerWidth &&
              rect.bottom <= window.innerHeight
            );
          }),
          allScopeButtonsTouch: scopeButtons.every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }),
          bottom: Math.round(scopeTabsRect.bottom),
          left: Math.round(scopeTabsRect.left),
          navTop: Math.round(navRect.top),
          right: Math.round(scopeTabsRect.right),
          top: Math.round(scopeTabsRect.top),
          viewportWidth: window.innerWidth
        };
      });

      expect(scopeLayout.left).toBeGreaterThanOrEqual(searchLayout.panelLeft);
      expect(scopeLayout.right).toBeLessThanOrEqual(scopeLayout.viewportWidth);
      expect(scopeLayout.top).toBeGreaterThanOrEqual(0);
      expect(scopeLayout.bottom).toBeLessThanOrEqual(scopeLayout.navTop);
      expect(scopeLayout.allScopeButtonsInsideViewport).toBe(true);
      expect(scopeLayout.allScopeButtonsTouch).toBe(true);

      await mobilePage
        .getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”")
        .fill("心理学");
      await expect(
        mobilePage.getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”")
      ).toHaveValue("心理学");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下设置输入控件保持可触达", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { hasCredential: true, hasAiCredential: true });
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "设置");
      await openSettingsCategory(mobilePage, "AI 设置");

      const dialog = mobilePage.getByRole("dialog", { name: "设置" });
      await expect(dialog).toBeVisible();

      const settingsLayout = await dialog.evaluate((modal) => {
        const content = modal.querySelector<HTMLElement>(".settings-modal-content");
        const closeButton = modal.querySelector<HTMLElement>(".settings-modal-close");
        const aiCard = modal.querySelector<HTMLElement>(".ai-settings-card");
        const credentialControls = Array.from(
          modal.querySelectorAll<HTMLElement>(".ai-settings-card .credential-input input, .ai-settings-card .credential-input select")
        );
        const actionButtons = Array.from(
          modal.querySelectorAll<HTMLElement>(".ai-settings-card .settings-card-actions > button")
        );
        if (!content || !closeButton || !aiCard || credentialControls.length === 0 || actionButtons.length === 0) {
          throw new Error("设置短视口 AI 控件缺失");
        }

        const modalRect = modal.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const closeRect = closeButton.getBoundingClientRect();
        return {
          allActionButtonsTouch: actionButtons.every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }),
          allCredentialControlsTouch: credentialControls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }),
          closeHeight: Math.round(closeRect.height),
          closeWidth: Math.round(closeRect.width),
          contentBottom: Math.round(contentRect.bottom),
          contentCanScroll: content.scrollHeight > content.clientHeight,
          contentOverflowY: window.getComputedStyle(content).overflowY,
          contentTop: Math.round(contentRect.top),
          modalBottom: Math.round(modalRect.bottom),
          modalLeft: Math.round(modalRect.left),
          modalRight: Math.round(modalRect.right),
          modalTop: Math.round(modalRect.top),
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      });

      expect(settingsLayout.modalTop).toBe(0);
      expect(settingsLayout.modalBottom).toBe(settingsLayout.viewportHeight);
      expect(settingsLayout.modalLeft).toBe(0);
      expect(settingsLayout.modalRight).toBe(settingsLayout.viewportWidth);
      expect(settingsLayout.contentTop).toBeGreaterThanOrEqual(0);
      expect(settingsLayout.contentBottom).toBeLessThanOrEqual(settingsLayout.viewportHeight);
      expect(settingsLayout.contentCanScroll).toBe(true);
      expect(settingsLayout.contentOverflowY).toBe("auto");
      expect(settingsLayout.closeWidth).toBeGreaterThanOrEqual(44);
      expect(settingsLayout.closeHeight).toBeGreaterThanOrEqual(44);
      expect(settingsLayout.allCredentialControlsTouch).toBe(true);
      expect(settingsLayout.allActionButtonsTouch).toBe(true);
      expect(settingsLayout.overflowX).toBe(false);

      await mobilePage.locator('input[value="gpt-4o-mini"]').fill("gpt-4.1-mini");
      await expect(mobilePage.locator('input[value="gpt-4.1-mini"]')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下选书决策输入弹窗保持可滚动可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "发现");
      await mobilePage.getByLabel("本地候选").getByRole("button", { name: "去候选书架决策" }).click();
      await expect(mobilePage.getByRole("heading", { name: "候选书架", exact: true })).toBeVisible();
      await mobilePage.getByRole("button", { name: "推荐下一本" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "调整选书决策输入范围" });
      await expect(dialog).toBeVisible();
      const stepOneLayout = await readMobileBlockingDialogLayout(mobilePage, ".book-decision-input-dialog");
      expectMobileBlockingDialogLayout(stepOneLayout);
      expect(stepOneLayout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "下一步" }).click();
      await expect(dialog).toContainText("步骤 2 / 3");
      const stepTwoLayout = await readMobileBlockingDialogLayout(mobilePage, ".book-decision-input-dialog");
      expectMobileBlockingDialogLayout(stepTwoLayout);
      expect(stepTwoLayout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "下一步" }).click();
      await expect(dialog).toContainText("步骤 3 / 3");
      const stepThreeLayout = await readMobileBlockingDialogLayout(mobilePage, ".book-decision-input-dialog");
      expectMobileBlockingDialogLayout(stepThreeLayout);
      expect(stepThreeLayout.undersizedTargets).toEqual([]);

      await dialog.getByLabel("近期阅读时间范围").selectOption("60");
      await expect(dialog).toContainText("近 60 天有 16 本阅读记录");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下阅读指南输入弹窗保持可滚动可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openShelfSubNav(mobilePage, "微信书架");
      await mobilePage.getByLabel("书架条目", { exact: true }).getByRole("button", { name: /深度工作/ }).click();
      await expect(mobilePage.getByLabel("本书管理")).toBeVisible();
      await mobilePage.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
      await expect(mobilePage.getByLabel("阅读指南输入范围")).toBeVisible();
      await mobilePage.getByRole("button", { name: "调整输入范围" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "调整阅读指南输入范围" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileBlockingDialogLayout(mobilePage, ".reading-route-dialog");
      expectMobileBlockingDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "全选候选" }).click();
      await expect(dialog).toContainText("1 / 1 本候选已纳入");
      await dialog.getByRole("button", { name: "完成" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(mobilePage.getByLabel("阅读指南输入范围")).toContainText("1 / 1 本候选已纳入");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下行动反馈编辑弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openShelfSubNav(mobilePage, "微信书架");
      await mobilePage.getByLabel("书架条目", { exact: true }).getByRole("button", { name: /深度工作/ }).click();
      await expect(mobilePage.getByLabel("本书管理")).toBeVisible();
      await mobilePage.getByLabel("本书管理").getByRole("button", { name: /AI 复盘/ }).click();
      await expect(mobilePage.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
      await mobilePage.getByLabel("下一步行动").scrollIntoViewIfNeeded();
      await mobilePage.getByLabel("下一步行动").getByRole("button", { name: "记录反馈" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "编辑状态与记录" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileOverlayDialogLayout(mobilePage, {
        actionsSelector: ".ai-action-feedback-dialog-actions",
        backdropSelector: ".dialog-backdrop",
        dialogSelector: ".ai-action-feedback-dialog"
      });
      expectMobileOverlayDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "已完成" }).click();
      await dialog.getByRole("button", { name: "保存反馈" }).click();
      await expect(mobilePage.getByLabel("下一步行动")).toContainText("已完成 1 / 共 1 项");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下更新前确认弹窗保持可滚动可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openReadingReviewSubNav(mobilePage, "阅读指南");

      const deepWorkAsset = mobilePage.locator(".ai-asset-card").filter({ hasText: "深度工作" });
      await expect(deepWorkAsset).toContainText("建议更新");
      await deepWorkAsset.click();
      await expect(mobilePage.getByLabel("书籍阅读成果详情")).toBeVisible();
      await mobilePage.getByRole("tab", { name: /跨书路线 2/ }).click();
      await mobilePage.getByLabel("以本书为起点的跨书路线").getByRole("button", { name: "查看路线" }).click();
      await expect(mobilePage.getByLabel("AI 结果版本详情")).toContainText("准备更新指南");
      await mobilePage.getByRole("button", { name: "准备更新指南" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "更新前确认" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileOverlayDialogLayout(mobilePage, {
        actionsSelector: ".ai-asset-update-dialog-actions",
        backdropSelector: ".ai-asset-update-dialog-backdrop",
        dialogSelector: ".ai-asset-update-dialog"
      });
      expectMobileOverlayDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "进入生成页确认更新" }).click();
      await expect(mobilePage.getByLabel("准备更新上下文")).toContainText("正在准备更新上一版阅读指南");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下通用确认弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { hasCredential: true, hasAiCredential: true });
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "设置");
      await openSettingsCategory(mobilePage, "高级维护");
      await mobilePage.getByRole("button", { name: "清除 AI 输出缓存" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "确认清除 AI 输出缓存？" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileOverlayDialogLayout(mobilePage, {
        actionsSelector: ".dialog-actions",
        backdropSelector: ".dialog-backdrop",
        dialogSelector: ".confirm-dialog"
      });
      expectMobileOverlayDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "取消" }).click();
      await expect(dialog).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下更新说明弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { availableAppUpdate: true });
      await mobilePage.addInitScript(() => {
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          const nextTimeout = timeout === 5000 ? 0 : timeout;
          return nativeSetTimeout(handler, nextTimeout, ...args);
        }) as typeof window.setTimeout;
      });
      await mobilePage.goto("/");

      const dialog = mobilePage.getByRole("dialog", { name: "1.0.14 已可下载" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileOverlayDialogLayout(mobilePage, {
        actionsSelector: ".update-dialog-actions",
        backdropSelector: ".update-dialog-backdrop",
        dialogSelector: ".update-dialog"
      });
      expectMobileOverlayDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "查看详情" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(mobilePage.getByRole("dialog", { name: "设置" })).toBeVisible();
      await expect(mobilePage.getByRole("region", { name: "应用更新", exact: true })).toContainText("1.0.14");
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下批量导出弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { longBulkExportList: true });
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "笔记");
      await mobilePage.getByRole("button", { name: "批量导出" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "批量导出向导" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("导出策略").getByText("先同步缺失笔记再导出").click();

      const layout = await readMobileFormOverlayDialogLayout(mobilePage, {
        actionsSelector: ".bulk-export-actions",
        backdropSelector: ".bulk-export-backdrop",
        dialogSelector: ".bulk-export-dialog"
      });
      expectMobileOverlayDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await expect(dialog.getByRole("button", { name: "开始导出" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下书籍复盘导出弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { manyBookReviewSummaries: true });
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "书籍复盘");
      await mobilePage.getByRole("button", { name: "导出书籍复盘" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "导出书籍复盘" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("可导出的书籍复盘").locator("label")).toHaveCount(18);

      const selectLayout = await readMobileFormOverlayDialogLayout(mobilePage, {
        actionsSelector: ".bulk-export-actions",
        backdropSelector: ".book-review-export-backdrop",
        dialogSelector: ".book-review-export-dialog"
      });
      expectMobileOverlayDialogLayout(selectLayout);
      expect(selectLayout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "选择当前筛选" }).click();
      await expect(dialog).toContainText("已选 18 本");
      await dialog.getByRole("button", { name: "下一步" }).click();
      const settingsLayout = await readMobileFormOverlayDialogLayout(mobilePage, {
        actionsSelector: ".bulk-export-actions",
        backdropSelector: ".book-review-export-backdrop",
        dialogSelector: ".book-review-export-dialog"
      });
      expectMobileOverlayDialogLayout(settingsLayout);
      expect(settingsLayout.undersizedTargets).toEqual([]);
      await expect(dialog.getByRole("button", { name: "开始导出" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下阅读报告生成弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage, { manyStatsItems: true });
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "统计");
      const reportEntryButton = mobilePage.getByRole("button", { name: "生成阅读报告" });
      const reportEntryButtonRect = await reportEntryButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width)
        };
      });
      expect(reportEntryButtonRect.height).toBeGreaterThanOrEqual(44);
      expect(reportEntryButtonRect.width).toBeGreaterThanOrEqual(44);
      await reportEntryButton.click();

      const dialog = mobilePage.getByRole("dialog", { name: "阅读报告生成" });
      await expect(dialog).toBeVisible();
      const typeLayout = await readMobileBlockingDialogLayout(mobilePage, ".monthly-report-poster-dialog");
      expectMobileBlockingDialogLayout(typeLayout);
      expect(typeLayout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: /下一步：选择月报时间/ }).click();
      await expect(dialog.getByLabel("阅读报告周期选择")).toBeVisible();
      const timeLayout = await readMobileBlockingDialogLayout(mobilePage, ".monthly-report-poster-dialog");
      expectMobileBlockingDialogLayout(timeLayout);
      expect(timeLayout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: "生成报告预览" }).click();
      await expect(dialog.locator(".monthly-report-poster-preview-shell")).toBeVisible();
      const previewLayout = await readMobileBlockingDialogLayout(mobilePage, ".monthly-report-poster-dialog");
      expectMobileBlockingDialogLayout(previewLayout);
      expect(previewLayout.undersizedTargets).toEqual([]);
      await dialog.getByRole("button", { name: "重新选择时间" }).click();
      await expect(dialog.getByLabel("阅读报告周期选择")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("触屏短视口下统计时间跳转弹窗保持可操作", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 390, height: 360 },
      hasTouch: true,
      isMobile: true
    });
    const mobilePage = await context.newPage();

    try {
      await installTauriMock(mobilePage);
      await mobilePage.goto("/");
      await openPrimaryNav(mobilePage, "统计");
      await mobilePage.getByLabel("统计时间锚点").getByRole("button", { name: "跳转" }).click();

      const dialog = mobilePage.getByRole("dialog", { name: "跳到月份" });
      await expect(dialog).toBeVisible();
      const layout = await readMobileStandaloneDialogLayout(mobilePage, {
        backdropSelector: ".reading-route-dialog-backdrop",
        dialogSelector: ".reading-stats-jump-dialog"
      });
      expectMobileStandaloneDialogLayout(layout);
      expect(layout.undersizedTargets).toEqual([]);

      await dialog.getByRole("button", { name: /2026 年/ }).click();
      await dialog.getByRole("button", { name: "1 月", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(mobilePage.getByLabel("统计时间锚点")).toContainText("2026 年 1 月");
    } finally {
      await context.close();
    }
  });

  test("窄屏底部导航承载主入口并收敛低频功能到我的", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page);
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: "移动端主导航" });
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole("button")).toHaveCount(5);
    await expect(bottomNav.getByRole("button", { name: "总览" })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page);

    await bottomNav.getByRole("button", { name: "书架" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("书架");
    await expect(bottomNav.getByRole("button", { name: "书架" })).toHaveAttribute("aria-current", "page");

    await bottomNav.getByRole("button", { name: "笔记" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("笔记");
    await expect(bottomNav.getByRole("button", { name: "笔记" })).toHaveAttribute("aria-current", "page");

    await bottomNav.getByRole("button", { name: "复盘" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("书籍复盘");
    await expect(bottomNav.getByRole("button", { name: "复盘" })).toHaveAttribute("aria-current", "page");

    await bottomNav.getByRole("button", { name: "我的" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("我的");
    await expect(page.getByRole("heading", { name: "本机阅读工作台" })).toBeVisible();
    await expect(page.getByLabel("快捷入口")).toContainText("统计");
    await expect(page.getByLabel("快捷入口")).toContainText("发现");
    await expect(page.getByLabel("快捷入口")).toContainText("设置");
    await expect(page.getByLabel("快捷入口")).toContainText("本地数据");
    await expect(bottomNav.getByRole("button", { name: "我的" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: /统计 阅读时间和偏好/ }).click();
    await expect(page.locator(".topbar h2")).toHaveText("统计");
    await expect(bottomNav.getByRole("button", { name: "我的" })).toHaveAttribute("aria-current", "page");

    await bottomNav.getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: /设置 账户、AI、外观/ }).click();
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    const bottomNavLayout = await page.evaluate(() => {
      const nav = document.querySelector(".bottom-nav");
      const workspace = document.querySelector(".workspace");
      const toastViewport = document.querySelector(".toast-viewport");
      const assistantLauncher = document.querySelector(".reading-assistant-launcher");

      if (
        !(nav instanceof HTMLElement) ||
        !(workspace instanceof HTMLElement) ||
        !(toastViewport instanceof HTMLElement) ||
        !(assistantLauncher instanceof HTMLElement)
      ) {
        throw new Error("移动端底部导航布局元素缺失");
      }

      const navRect = nav.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const assistantLauncherRect = assistantLauncher.getBoundingClientRect();
      const workspacePaddingBottom = Number.parseFloat(
        window.getComputedStyle(workspace).paddingBottom,
      );
      const toastBottom = window.getComputedStyle(toastViewport).bottom;

      return {
        assistantLauncherBottom: Math.round(assistantLauncherRect.bottom),
        assistantLauncherHeight: Math.round(assistantLauncherRect.height),
        assistantLauncherWidth: Math.round(assistantLauncherRect.width),
        navBottom: Math.round(navRect.bottom),
        navHeight: Math.round(navRect.height),
        navTop: Math.round(navRect.top),
        viewportHeight: window.innerHeight,
        workspaceBottom: Math.round(workspaceRect.bottom),
        workspacePaddingBottom,
        toastBottom,
      };
    });

    expect(bottomNavLayout.assistantLauncherWidth).toBeGreaterThanOrEqual(44);
    expect(bottomNavLayout.assistantLauncherHeight).toBeGreaterThanOrEqual(44);
    expect(bottomNavLayout.assistantLauncherBottom).toBeLessThanOrEqual(bottomNavLayout.navTop);
    expect(bottomNavLayout.navBottom).toBe(bottomNavLayout.viewportHeight);
    expect(bottomNavLayout.navHeight).toBeGreaterThanOrEqual(64);
    expect(bottomNavLayout.workspaceBottom).toBeLessThanOrEqual(bottomNavLayout.navTop);
    expect(bottomNavLayout.workspacePaddingBottom).toBeGreaterThanOrEqual(28);
    expect(bottomNavLayout.toastBottom).not.toBe("auto");
  });

  test("触屏窄屏主页面高频控件保留 44px 热区", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page, {
      manyBookReviewSummaries: true,
      manyCandidateBooks: true
    });
    await page.goto("/");
    const bottomNav = page.getByRole("navigation", { name: "移动端主导航" });
    const expectTargetsClear = (targets: Awaited<ReturnType<typeof readVisibleTouchTargets>>) => {
      expect(targets.undersizedTargets).toEqual([]);
      expect(targets.bottomNavBlockedTargets).toEqual([]);
    };
    const scrollWorkspaceToBottom = async () => {
      await page.locator(".workspace").evaluate((workspace) => {
        workspace.scrollTop = workspace.scrollHeight;
      });
    };

    const dashboardTargets = await readVisibleTouchTargets(page, [
      ".dashboard-status-strip .text-button",
      ".dashboard-status-strip .secondary-action",
      ".today-action-card"
    ]);
    expectTargetsClear(dashboardTargets);

    await scrollWorkspaceToBottom();
    const dashboardBottomTargets = await readVisibleTouchTargets(page, [
      ".dashboard-status-strip .text-button",
      ".dashboard-status-strip .secondary-action",
      ".text-button",
      ".secondary-action"
    ]);
    expectTargetsClear(dashboardBottomTargets);

    await bottomNav.getByRole("button", { name: "书架" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("书架");
    const shelfTargets = await readVisibleTouchTargets(page, [
      ".bookshelf-toolbar .sync-button",
      ".bookshelf-filter-tabs button",
      ".bookshelf-search-row .search-field",
      ".bookshelf-results .shelf-card-menu-trigger"
    ]);
    expectTargetsClear(shelfTargets);

    await scrollWorkspaceToBottom();
    const shelfBottomTargets = await readVisibleTouchTargets(page, [
      ".bookshelf-results .shelf-card-menu-trigger",
      ".bookshelf-load-more .secondary-action"
    ]);
    expectTargetsClear(shelfBottomTargets);

    await bottomNav.getByRole("button", { name: "笔记" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("笔记");
    const notesTargets = await readVisibleTouchTargets(page, [
      ".notes-hero-actions .sync-button",
      ".note-list-toolbar-actions .sync-button",
      ".note-list-toolbar-actions .filter-tabs button",
      ".notes-page .search-field"
    ]);
    expectTargetsClear(notesTargets);

    await scrollWorkspaceToBottom();
    const notesBottomTargets = await readVisibleTouchTargets(page, [
      ".notes-page .text-button",
      ".notes-page .secondary-action"
    ]);
    expectTargetsClear(notesBottomTargets);

    await bottomNav.getByRole("button", { name: "复盘" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("书籍复盘");
    const reviewTargets = await readVisibleTouchTargets(page, [
      ".reading-hub-books-toolbar .search-field",
      ".reading-hub-books-toolbar .text-button",
      ".reading-hub-books-toolbar .secondary-action",
      ".reading-workflow-template-card"
    ]);
    expectTargetsClear(reviewTargets);

    await scrollWorkspaceToBottom();
    const reviewBottomTargets = await readVisibleTouchTargets(page, [
      ".reading-hub-page .text-button",
      ".reading-hub-page .secondary-action"
    ]);
    expectTargetsClear(reviewBottomTargets);

    await bottomNav.getByRole("button", { name: "我的" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("我的");
    const mineTargets = await readVisibleTouchTargets(page, [
      ".mine-sync-button",
      ".mine-shortcut-card",
      ".mine-link-item"
    ]);
    expectTargetsClear(mineTargets);
  });

  test("窄屏设置层全屏承载分类并覆盖底部导航", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page);
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: "移动端主导航" });
    await bottomNav.getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: /设置 账户、AI、外观/ }).click();

    const dialog = page.getByRole("dialog", { name: "设置" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("设置分类")).toContainText("账户与同步");
    await expect(page.getByLabel("设置分类")).toContainText("AI 设置");
    await expectNoHorizontalOverflow(page);

    const mobileSettingsLayout = await page.evaluate(() => {
      const dialogElement = document.querySelector(".settings-modal");
      const nav = document.querySelector(".settings-modal-nav");
      const navList = document.querySelector(".settings-modal-nav nav");
      const content = document.querySelector(".settings-modal-content");
      const bottomNavigation = document.querySelector(".bottom-nav");

      if (
        !(dialogElement instanceof HTMLElement) ||
        !(nav instanceof HTMLElement) ||
        !(navList instanceof HTMLElement) ||
        !(content instanceof HTMLElement) ||
        !(bottomNavigation instanceof HTMLElement)
      ) {
        throw new Error("移动端设置层布局元素缺失");
      }

      const dialogRect = dialogElement.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const navStyle = window.getComputedStyle(navList);
      const contentStyle = window.getComputedStyle(content);
      const bottomNavStyle = window.getComputedStyle(bottomNavigation);

      return {
        dialogTop: Math.round(dialogRect.top),
        dialogBottom: Math.round(dialogRect.bottom),
        dialogWidth: Math.round(dialogRect.width),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        navBottom: Math.round(navRect.bottom),
        navOverflowX: navStyle.overflowX,
        contentTop: Math.round(content.getBoundingClientRect().top),
        contentBottom: Math.round(content.getBoundingClientRect().bottom),
        contentOverflowY: contentStyle.overflowY,
        bottomNavZIndex: Number.parseInt(bottomNavStyle.zIndex, 10),
        dialogZIndex: Number.parseInt(window.getComputedStyle(dialogElement.parentElement!).zIndex, 10),
      };
    });

    expect(mobileSettingsLayout.dialogTop).toBe(0);
    expect(mobileSettingsLayout.dialogBottom).toBe(mobileSettingsLayout.viewportHeight);
    expect(mobileSettingsLayout.dialogWidth).toBe(mobileSettingsLayout.viewportWidth);
    expect(mobileSettingsLayout.contentTop).toBeGreaterThanOrEqual(mobileSettingsLayout.navBottom);
    expect(mobileSettingsLayout.contentBottom).toBeLessThanOrEqual(mobileSettingsLayout.viewportHeight);
    expect(["auto", "scroll"]).toContain(mobileSettingsLayout.navOverflowX);
    expect(["auto", "scroll"]).toContain(mobileSettingsLayout.contentOverflowY);
    expect(mobileSettingsLayout.dialogZIndex).toBeGreaterThan(mobileSettingsLayout.bottomNavZIndex);

    await openSettingsCategory(page, "高级维护");
    await expect(page.getByRole("heading", { name: "高级维护" })).toBeVisible();
  });

  test("窄屏书架优先呈现搜索并收敛筛选密度", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page);
    await page.goto("/");

    const bottomNav = page.getByRole("navigation", { name: "移动端主导航" });
    await bottomNav.getByRole("button", { name: "书架" }).click();
    await expect(page.locator(".topbar h2")).toHaveText("书架");
    await expect(page.getByRole("heading", { name: "我的微信读书书架" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const mobileShelfLayout = await page.evaluate(() => {
      const toolbar = document.querySelector(".bookshelf-toolbar");
      const searchRow = document.querySelector(".bookshelf-search-row");
      const filterStack = document.querySelector(".bookshelf-filter-stack");
      const summaryRow = document.querySelector(".shelf-summary-row");
      const typeTabs = document.querySelector(".bookshelf-filter-tabs--type");
      const categoryTabs = document.querySelector(".bookshelf-filter-tabs--category");
      const bookGrid = document.querySelector(".book-grid");
      const firstCard = document.querySelector(".shelf-card");
      const syncButton = document.querySelector(".bookshelf-toolbar .sync-button");

      if (
        !(toolbar instanceof HTMLElement) ||
        !(searchRow instanceof HTMLElement) ||
        !(filterStack instanceof HTMLElement) ||
        !(summaryRow instanceof HTMLElement) ||
        !(typeTabs instanceof HTMLElement) ||
        !(categoryTabs instanceof HTMLElement) ||
        !(bookGrid instanceof HTMLElement) ||
        !(firstCard instanceof HTMLElement) ||
        !(syncButton instanceof HTMLElement)
      ) {
        throw new Error("移动端书架布局元素缺失");
      }

      const countGridColumns = (element: HTMLElement) =>
        window
          .getComputedStyle(element)
          .gridTemplateColumns.split(/\s+/)
          .filter(Boolean).length;

      return {
        toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
        searchTop: Math.round(searchRow.getBoundingClientRect().top),
        filterTop: Math.round(filterStack.getBoundingClientRect().top),
        summaryTop: Math.round(summaryRow.getBoundingClientRect().top),
        typeTabsOverflowX: window.getComputedStyle(typeTabs).overflowX,
        categoryTabsOverflowX: window.getComputedStyle(categoryTabs).overflowX,
        summaryOverflowX: window.getComputedStyle(summaryRow).overflowX,
        bookGridColumnCount: countGridColumns(bookGrid),
        firstCardRight: Math.round(firstCard.getBoundingClientRect().right),
        viewportWidth: window.innerWidth,
        syncButtonHeight: Math.round(syncButton.getBoundingClientRect().height),
      };
    });

    expect(mobileShelfLayout.toolbarTop).toBeLessThan(mobileShelfLayout.searchTop);
    expect(mobileShelfLayout.searchTop).toBeLessThan(mobileShelfLayout.filterTop);
    expect(mobileShelfLayout.filterTop).toBeLessThan(mobileShelfLayout.summaryTop);
    expect(["hidden", "visible", "clip"]).toContain(mobileShelfLayout.typeTabsOverflowX);
    expect(["hidden", "visible", "clip"]).toContain(mobileShelfLayout.categoryTabsOverflowX);
    expect(["hidden", "visible", "clip"]).toContain(mobileShelfLayout.summaryOverflowX);
    expect(mobileShelfLayout.bookGridColumnCount).toBe(1);
    expect(mobileShelfLayout.firstCardRight).toBeLessThanOrEqual(mobileShelfLayout.viewportWidth);
    expect(mobileShelfLayout.syncButtonHeight).toBeGreaterThanOrEqual(44);

    await page.getByPlaceholder("按书名、作者或分类筛选书架").fill("深度");
    await expect(page.getByLabel("书架条目列表")).toContainText("深度工作");
    await expectNoHorizontalOverflow(page);
  });

  test("设置弹窗在桌面视窗内保持相对安全边距", async ({ page }) => {
    const viewport = { width: 1355, height: 944 };
    await page.setViewportSize(viewport);
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "设置");
    const dialog = page.getByRole("dialog", { name: "设置" });
    await expect(dialog).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    if (!dialogBox) {
      throw new Error("设置弹窗未渲染可测量区域");
    }

    expect(dialogBox.x).toBeGreaterThanOrEqual(32);
    expect(dialogBox.y).toBeGreaterThanOrEqual(32);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width - 32);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height - 32);
    await expectNoHorizontalOverflow(page);

    const contentScroll = await page.locator(".settings-modal-content").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY
    }));
    expect(contentScroll.clientHeight).toBeLessThanOrEqual(dialogBox.height);
    expect(["auto", "scroll"]).toContain(contentScroll.overflowY);
  });

  test("设置弹窗窗口控制和卡片操作区不挤占正文行", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

    const closeButtonPlacement = await page
      .getByRole("button", { name: "关闭设置" })
      .evaluate((button) => ({
        isModalDirectAction: button.parentElement?.classList.contains("settings-modal") ?? false,
        parentClassName: button.parentElement?.className ?? ""
      }));
    expect(closeButtonPlacement).toEqual({
      isModalDirectAction: true,
      parentClassName: expect.stringContaining("settings-modal")
    });

    const expectCardAction = async (label: string, requireActionBar = true) => {
      const placement = await page
        .getByRole("button", { name: label })
        .evaluate((button) => ({
          insideCardActionBar: button.closest(".settings-card-actions") !== null,
          insideContentRow: button.closest(".settings-control-row") !== null
        }));
      expect(placement.insideContentRow).toBe(false);
      if (requireActionBar) {
        expect(placement.insideCardActionBar).toBe(true);
      }
    };

    await expectCardAction("保存 API Key");

    await openSettingsCategory(page, "导出设置");
    await expectCardAction("选择导出目录");
    await expectCardAction("保存导出目录");
    await expectCardAction("恢复默认");

    await openSettingsCategory(page, "高级维护");
    await expectCardAction("清除 AI 输出缓存");
    await expectCardAction("清除本地缓存");
    await expectCardAction("展开", false);
    await expectCardAction("导出本地备份");
    await expectCardAction("恢复最近备份");
    await expectCardAction("选择并迁移目录");
  });

  test("外观和使用偏好可持久化并应用到界面", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await installTauriMock(page);
    await page.goto("/");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", "system");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");
    await expectDarkModeSurfaceContrast(page, [
      { label: "跟随系统深色总览指标卡片", locator: page.locator(".metric-card").first() },
      { label: "跟随系统深色今日工作台面板", locator: page.locator(".daily-workbench-panel") },
      { label: "跟随系统深色今日卡片", locator: page.locator(".daily-reading-card") },
      { label: "跟随系统深色今日动作面板", locator: page.locator(".today-actions-panel") },
      { label: "跟随系统深色阅读队列面板", locator: page.locator(".dashboard-queue-panel") },
      { label: "跟随系统深色隐私提示", locator: page.locator(".privacy-note") }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "跟随系统深色侧栏收起按钮", locator: page.locator(".sidebar-toggle") }
    ]);

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await openSettingsCategory(page, "外观偏好");
    await expect(
      page.getByRole("region", { name: "外观与使用偏好", exact: true }).getByRole("heading", { name: "显示与默认行为" })
    ).toBeVisible();
    await page.getByLabel("主题模式").selectOption("dark");
    await page.getByLabel("字体大小").selectOption("large");
    await page.getByLabel("信息密度").selectOption("compact");
    await page.getByLabel("默认启动页").selectOption("stats");
    await page.getByLabel("默认单本笔记视图").selectOption("cards");
    await page.getByLabel("默认统计周期").selectOption("annually");

    await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-font-scale", "large");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-density", "compact");
    await expectDarkModeSurfaceContrast(page, [
      { label: "设置页头部", locator: page.locator(".settings-hero") },
      { label: "设置页弹窗", locator: page.getByRole("dialog", { name: "设置" }) },
      { label: "设置页偏好卡片", locator: page.getByRole("region", { name: "外观与使用偏好", exact: true }) }
    ]);
    await closeSettingsDialog(page);

    await openPrimaryNav(page, "总览");
    await expectDarkModeSurfaceContrast(page, [
      { label: "总览指标卡片", locator: page.locator(".metric-card").first() },
      { label: "今日工作台面板", locator: page.locator(".daily-workbench-panel") },
      { label: "今日卡片", locator: page.locator(".daily-reading-card") },
      { label: "今日动作面板", locator: page.locator(".today-actions-panel") },
      { label: "阅读队列面板", locator: page.locator(".dashboard-queue-panel") }
    ]);

    await openShelfSubNav(page, "微信书架");
    await expectDarkModeSurfaceContrast(page, [
      { label: "书架工具栏", locator: page.locator(".bookshelf-toolbar") },
      { label: "书架卡片", locator: page.locator(".shelf-card").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "书架类型筛选激活项", locator: page.getByLabel("书架筛选").getByRole("tab", { name: "全部" }) },
      { label: "书架类型筛选普通项", locator: page.getByLabel("书架筛选").getByRole("tab", { name: "电子书" }) },
      { label: "书架分类筛选激活项", locator: page.getByLabel("书架父分类").getByRole("button", { name: "全部", exact: true }) },
      { label: "书架分类筛选普通项", locator: page.getByLabel("书架父分类").getByRole("button", { name: /计算机/ }) },
      { label: "书架展开更多按钮", locator: page.locator(".category-filter-toggle") },
      { label: "书架卡片更多按钮", locator: page.locator(".shelf-card-menu-trigger").first() },
      { label: "书架搜索框", locator: page.locator(".bookshelf-search-row .search-field") },
      { label: "书架搜索输入", locator: page.getByPlaceholder("按书名、作者或分类筛选书架") }
    ]);

    await openPrimaryNav(page, "统计");
    await expectDarkModeSurfaceContrast(page, [
      { label: "统计头图", locator: page.locator(".stats-hero") },
      { label: "统计时间锚点", locator: page.getByLabel("统计时间锚点") }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "统计周期激活项", locator: page.locator(".period-tabs button.is-active").first() },
      { label: "统计同步按钮", locator: page.locator(".stats-sync-action") }
    ]);

    await openPrimaryNav(page, "发现");
    await expectDarkModeSurfaceContrast(page, [
      { label: "发现搜索面板", locator: page.locator(".discovery-search-panel") },
      { label: "发现辅助卡片", locator: page.locator(".discovery-card").first() },
      { label: "发现本地书架入口", locator: page.locator(".discovery-shelf-seeds") }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "发现最近阅读入口卡片", locator: page.locator(".shelf-seed-card").first() },
      { label: "发现本地候选入口卡片", locator: page.locator(".discovery-assist-list button").first() },
      { label: "发现主题 chip", locator: page.getByLabel("主题 chips").getByRole("button", { name: "AI" }).first() }
    ]);
    await page.getByRole("button", { name: "深度工作" }).first().click();
    await expectDarkModeSurfaceContrast(page, [
      { label: "发现相似探索头图", locator: page.locator(".discovery-similar-hero") },
      { label: "发现相似探索种子书", locator: page.locator(".similar-seed-card") }
    ]);
    await page.getByRole("button", { name: "返回发现" }).click();

    await page.reload();
    await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-font-scale", "large");
    await expect(page.locator(".app-frame")).toHaveAttribute("data-density", "compact");
    await expect(page.getByRole("heading", { name: "年度阅读报告" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /年度/ })).toHaveAttribute("aria-selected", "true");

    await openPrimaryNav(page, "设置");
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    await openSettingsCategory(page, "外观偏好");
    await expect(page.getByLabel("主题模式")).toHaveValue("dark");
    await expect(page.getByLabel("字体大小")).toHaveValue("large");
    await expect(page.getByLabel("信息密度")).toHaveValue("compact");
    await expect(page.getByLabel("默认启动页")).toHaveValue("stats");
    await expect(page.getByLabel("默认单本笔记视图")).toHaveValue("cards");
    await expect(page.getByLabel("默认统计周期")).toHaveValue("annually");
    await closeSettingsDialog(page);

    await openPrimaryNav(page, "笔记");
    await expectDarkModeSurfaceContrast(page, [
      { label: "笔记头部", locator: page.locator(".notes-hero") },
      { label: "笔记复盘面板", locator: page.locator(".notes-review-panel") },
      { label: "笔记书籍卡片", locator: page.locator(".notebook-card").first() }
    ]);
    await page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ }).click();
    await expect(page.getByLabel("单本笔记视图").getByRole("tab", { name: "卡片" })).toHaveAttribute("aria-selected", "true");
    await expectDarkModeSurfaceContrast(page, [
      { label: "单本笔记头部", locator: page.locator(".book-notes-header") },
      { label: "单本笔记浏览方式面板", locator: page.locator(".book-notes-view-panel") },
      { label: "笔记卡片", locator: page.locator(".note-card").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "单本笔记视图切换容器", locator: page.locator(".segmented-control") },
      { label: "单本笔记视图切换激活项", locator: page.getByLabel("笔记视图切换").getByRole("tab", { name: "卡片" }) },
      { label: "单本笔记视图切换普通项", locator: page.getByLabel("笔记视图切换").getByRole("tab", { name: "章节" }) },
      { label: "笔记卡片元信息", locator: page.locator(".note-card-meta span").first() }
    ]);
    await page.getByLabel("笔记视图切换").getByRole("tab", { name: "章节" }).click();
    await expectDarkModeSurfaceContrast(page, [
      { label: "单本笔记章节列表分组", locator: page.locator(".note-group").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "单本笔记章节筛选", locator: page.getByLabel("章节筛选").getByRole("tab", { name: "全部章节" }) },
      { label: "单本笔记章节目录按钮", locator: page.getByLabel("章节视图工具").getByRole("button", { name: "章节目录" }) }
    ]);

    await page.getByRole("button", { name: "返回笔记中心" }).click();
    await openShelfSubNav(page, "微信书架");
    await page.getByLabel("书架条目").getByRole("button", { name: /深度工作/ }).click();
    await page.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
    await expectDarkModeSurfaceContrast(page, [
      { label: "AI 阅读指南头图", locator: page.locator(".reading-route-hero") },
      { label: "AI 阅读指南来源统计", locator: page.locator(".ai-summary-source-card").first() }
    ]);

    await openPrimaryNav(page, "书籍复盘");
    await expectDarkModeSurfaceContrast(page, [
      { label: "书籍复盘管理页容器", locator: page.locator(".reading-hub-books") },
      { label: "书籍复盘管理工具栏", locator: page.locator(".reading-hub-books-toolbar") },
      { label: "书籍复盘已生成面板", locator: page.locator(".reading-hub-generated-panel") },
      { label: "书籍复盘已生成卡片", locator: page.locator(".reading-hub-book-card").first() },
      { label: "书籍复盘建议生成面板", locator: page.locator(".review-candidate-panel") },
      { label: "书籍复盘建议生成卡片", locator: page.locator(".review-candidate-card").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "书籍复盘概览指标", locator: page.locator(".book-review-asset-overview-metrics span").first() },
      { label: "书籍复盘概览按钮", locator: page.locator(".book-review-asset-overview-next .secondary-action") },
      { label: "书籍复盘已生成数量徽章", locator: page.locator(".reading-hub-section-heading > span").first() },
      { label: "书籍复盘候选数量徽章", locator: page.locator(".review-candidate-heading > span").first() }
    ]);
    await page.getByRole("button", { name: /深度工作/ }).click();
    await expectDarkModeSurfaceContrast(page, [
      { label: "书籍复盘主题标签区", locator: page.locator(".ai-summary-section").filter({ hasText: "主题标签" }) },
      { label: "书籍复盘代表性摘录区", locator: page.getByRole("region", { name: "代表性摘录" }) },
      { label: "书籍复盘代表性摘录卡片", locator: page.locator(".ai-quote-card").first() },
      { label: "书籍复盘来源统计", locator: page.locator(".ai-summary-source-card").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "书籍复盘主题标签", locator: page.locator(".ai-summary-tags span").first() },
      { label: "书籍复盘来源统计 pill", locator: page.locator(".ai-summary-stats span").first() }
    ]);

    await openReadingReviewSubNav(page, "阅读报告");
    await expectDarkModeSurfaceContrast(page, [
      { label: "阅读报告封面", locator: page.locator(".review-cover-card") },
      { label: "阅读报告数据依据", locator: page.locator(".ai-summary-source-card").first() }
    ]);
    await expectDarkModeControlContrast(page, [
      { label: "阅读报告面板标题徽章", locator: page.locator(".review-panel .stats-card-heading > span").first() },
      { label: "阅读报告阶段摘要徽章", locator: page.locator(".review-stage-summary span").first() },
      { label: "阅读报告代表主题徽章", locator: page.locator(".review-stage-tags span").first() }
    ]);

    await expectNoHorizontalOverflow(page);
  });

  test("窄屏笔记卡片遇到长路径文本时不出现水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTauriMock(page, { longNoteCardContent: true });
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ }).click();
    await page.getByRole("tab", { name: "卡片" }).click();

    await expect(page.getByRole("heading", { name: "卡片视图" })).toBeVisible();
    await expect(page.getByLabel("笔记卡片")).toContainText("ll_envScriptsactivatebat");
    await expectNoHorizontalOverflow(page);
  });

  test("笔记卡片列表保持多列瀑布流布局", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ }).click();
    await page.getByRole("tab", { name: "卡片" }).click();

    await expect(page.getByRole("heading", { name: "卡片视图" })).toBeVisible();
    const layout = await page.locator(".note-card-grid").evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        display: style.display,
        columnCount: style.columnCount,
        columnWidth: style.columnWidth,
        columnGap: style.columnGap
      };
    });

    expect(layout.display).toBe("block");
    expect(layout.columnCount).toBe("auto");
    expect(layout.columnWidth).toBe("280px");
    expect(layout.columnGap).toBe("14px");
  });

  test("卡片视图当前组操作保持右侧聚合布局", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "笔记");
    await page.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ }).click();
    await page.getByRole("tab", { name: "卡片" }).click();
    await page.getByRole("button", { name: "随机一组" }).click();
    await expect(page.getByRole("button", { name: "显示全部" })).toBeVisible();

    const layout = await page.getByLabel("卡片视图工具").evaluate((toolbar) => {
      const findButton = (text: string) =>
        Array.from(toolbar.querySelectorAll("button")).find((button) => button.textContent?.includes(text));
      const randomButton = findButton("随机一组");
      const exportButton = findButton("导出当前组");
      const showAllButton = findButton("显示全部");

      if (!randomButton || !exportButton || !showAllButton) {
        throw new Error("卡片视图当前组操作按钮缺失");
      }

      const toolbarRect = toolbar.getBoundingClientRect();
      const randomRect = randomButton.getBoundingClientRect();
      const exportRect = exportButton.getBoundingClientRect();
      const showAllRect = showAllButton.getBoundingClientRect();

      return {
        randomToExportGap: exportRect.left - randomRect.right,
        exportToShowAllGap: showAllRect.left - exportRect.right,
        centerYDelta: Math.max(
          Math.abs(randomRect.top + randomRect.height / 2 - (exportRect.top + exportRect.height / 2)),
          Math.abs(exportRect.top + exportRect.height / 2 - (showAllRect.top + showAllRect.height / 2))
        ),
        rightInset: toolbarRect.right - showAllRect.right
      };
    });

    expect(layout.centerYDelta).toBeLessThanOrEqual(2);
    expect(layout.randomToExportGap).toBeGreaterThanOrEqual(8);
    expect(layout.randomToExportGap).toBeLessThanOrEqual(24);
    expect(layout.exportToShowAllGap).toBeGreaterThanOrEqual(8);
    expect(layout.exportToShowAllGap).toBeLessThanOrEqual(24);
    expect(layout.rightInset).toBeLessThanOrEqual(20);
  });

  test("空态提供明确下一步动作", async ({ page }) => {
    await installTauriMock(page, { emptyData: true });
    await page.goto("/");

    const todayActions = page.getByLabel("今日可做");
    await expect(todayActions).toContainText("同步书架缓存");
    await expect(todayActions).not.toContainText("准备同步笔记");
    await expect(todayActions.locator(".today-action-card")).toHaveCount(1);

    await openShelfSubNav(page, "微信书架");
    await expect(page.getByLabel("书架为空").getByRole("button", { name: "同步书架" })).toBeVisible();

    await openPrimaryNav(page, "笔记");
    await expect(page.getByLabel("笔记为空").getByRole("button", { name: "同步笔记" })).toBeVisible();

    await openPrimaryNav(page, "统计");
    await expect(page.getByLabel("统计为空").getByRole("button", { name: "同步统计" })).toBeVisible();

    await openPrimaryNav(page, "书籍复盘");
    await expect(page.getByLabel("暂无书籍复盘").getByRole("button", { name: "去笔记中心" })).toBeVisible();
    await expect(page.getByLabel("建议生成复盘").getByRole("button", { name: "去同步笔记" })).toBeVisible();

    await openPrimaryNav(page, "阅读报告");
    await expect(page.getByLabel("复盘统计为空").getByRole("button", { name: "同步统计" })).toBeVisible();

    await openShelfSubNav(page, "候选书架");
    await expect(page.getByLabel("候选书架为空")).toContainText("还没有候选书");
    await expect(page.getByLabel("候选书架为空")).toContainText("选书决策需要先保存至少 1 本候选。");
    await expect(page.getByLabel("候选书架为空").getByRole("button", { name: "去发现页保存候选" })).toBeVisible();
    await expect(page.getByRole("button", { name: "推荐下一本" })).toHaveCount(0);

    await openShelfSubNav(page, "微信书架");
    await page.getByLabel("书架为空").getByRole("button", { name: "同步书架" }).click();
    await page.getByRole("button", { name: /^深度工作/ }).click();
    await page.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
    await page.getByRole("button", { name: "调整输入范围" }).click();
    await expect(page.getByRole("dialog", { name: "调整阅读指南输入范围" }).getByRole("button", { name: "去发现页保存候选" })).toBeVisible();
  });

  test("统计同步失败时错误态提供重试路径", async ({ page }) => {
    await installTauriMock(page, { failReadingStatsSync: true });
    await page.goto("/");

    await openPrimaryNav(page, "统计");
    await page.getByRole("button", { name: "同步统计" }).click();

    await expect(page.getByLabel("统计同步错误")).toContainText("统计同步失败，请稍后重试。");
    await expect(page.getByLabel("统计同步错误").getByRole("button", { name: "重试同步" })).toBeVisible();
  });

  test("书籍详情页可以把发现页书籍加入候选", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openPrimaryNav(page, "发现");
    await page.getByPlaceholder("输入书名、作者、主题，或试试“听书/网文/全文”").fill("三体");
    await page.getByRole("button", { name: /^搜索$/ }).click();
    await page.locator(".search-results .discovery-book-card").filter({
      has: page.getByRole("heading", { name: "黑暗森林" })
    }).getByRole("button", { name: "打开详情" }).click();

    await expect(page.getByRole("heading", { name: "黑暗森林" })).toBeVisible();
    await page.getByLabel("本书管理").getByRole("button", { name: /^加入候选/ }).click();

    await expect(page.getByLabel("通知").getByText("已保存《黑暗森林》到本地候选")).toBeVisible();
    await expect(page.getByLabel("本书管理").getByRole("button", { name: /已在候选/ })).toBeDisabled();
    expect(await getLastInvokeArgs(page, "upsert_reading_item_state")).toMatchObject({
      input: {
        itemId: "dark-forest",
        itemType: "candidate",
        status: "toRead",
        title: "黑暗森林",
        author: "刘慈欣",
        category: "科幻",
        note: "书籍详情页保存的本地候选"
      }
    });
  });

  test("已读完成书籍详情页不提供加入候选入口", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await openShelfSubNav(page, "微信书架");
    await page.getByLabel("书架条目").getByRole("button", { name: /三体/ }).click();

    await expect(page.getByRole("heading", { name: "三体" })).toBeVisible();
    await expect(page.getByLabel("候选入口").getByRole("button", { name: /已读完/ })).toBeDisabled();
    await expect(page.getByLabel("候选入口")).toContainText("已读完");
    await expect(page.getByLabel("候选入口")).toContainText("建议进入复盘或阅读指南");
  });

  test.describe("页面滚动视觉回归", () => {
    test.describe.configure({ timeout: 180_000 });

    test("桌面主要页面逐屏滚动检查", async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await installTauriMock(page, {
        manyBookReviewSummaries: true,
        manyCandidateBooks: true,
        manyStatsItems: true
      });
      await page.goto("/");

      const results = await auditMainAppVisualPages(page, "desktop-main");
      expect(results).toHaveLength(14);
    });

    test("窄屏主要页面逐屏滚动检查", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await installTauriMock(page, {
        manyBookReviewSummaries: true,
        manyCandidateBooks: true,
        manyStatsItems: true
      });
      await page.goto("/");

      const results = await auditMainAppVisualPages(page, "narrow-main");
      expect(results).toHaveLength(14);
    });

    test("设置弹窗各分类逐屏滚动检查", async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await installTauriMock(page);
      await page.goto("/");
      await auditSettingsVisualCategories(page, "desktop-settings");
      await closeSettingsDialog(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await openPrimaryNav(page, "设置");
      await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
      await auditSettingsVisualCategories(page, "narrow-settings");
    });
  });
});

async function readOverlayZIndexes(page: Page, backdropSelector: string) {
  return page.evaluate((selector) => {
    const readZIndex = (targetSelector: string) => {
      const element = document.querySelector(targetSelector);
      if (!(element instanceof HTMLElement)) {
        return -1;
      }

      const parsed = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    return {
      assistantLauncher: readZIndex(".reading-assistant-launcher"),
      backdrop: readZIndex(selector),
      bottomNav: readZIndex(".bottom-nav")
    };
  }, backdropSelector);
}

type ReportPreviewMode = "poster" | "cards" | "wide";

async function openMonthlyReportPreview(page: Page) {
  await openPrimaryNav(page, "统计");
  await page.getByRole("button", { name: "生成阅读报告" }).click();

  const dialog = page.getByRole("dialog", { name: "阅读报告生成" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /下一步：选择月报时间/ }).click();
  await expect(dialog.getByLabel("阅读报告周期选择")).toBeVisible();
  await dialog.getByRole("button", { name: "生成报告预览" }).click();
  await expect(dialog.locator(".monthly-report-poster-preview-shell")).toBeVisible();
  await expect(dialog.locator(".monthly-report-preview-empty")).toHaveCount(0);

  return dialog;
}

async function expectReportPreviewModeCentered(dialog: Locator, mode: ReportPreviewMode) {
  const targetSelectorByMode: Record<ReportPreviewMode, string> = {
    poster: ".monthly-report-poster",
    cards: ".monthly-report-card-set",
    wide: ".monthly-report-wide"
  };
  const layout = await dialog.evaluate(
    (dialogElement, { mode, targetSelector }) => {
      const shell = dialogElement.querySelector<HTMLElement>(".monthly-report-poster-preview-shell");
      const target = dialogElement.querySelector<HTMLElement>(targetSelector);
      const footer = dialogElement.querySelector<HTMLElement>(".monthly-report-poster-dialog-actions");
      if (!shell || !target || !footer) {
        throw new Error(`阅读报告 ${mode} 预览布局元素缺失`);
      }

      const shellRect = shell.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const shellCenterX = shellRect.left + shellRect.width / 2;
      const targetCenterX = targetRect.left + targetRect.width / 2;

      return {
        centerDelta: Math.abs(shellCenterX - targetCenterX),
        footerBottom: Math.round(footerRect.bottom),
        footerTop: Math.round(footerRect.top),
        mode,
        shellBottom: Math.round(shellRect.bottom),
        shellOverflowY: window.getComputedStyle(shell).overflowY,
        targetLayoutHeight: Math.round(target.offsetHeight),
        targetLayoutWidth: Math.round(target.offsetWidth),
        targetLeft: Math.round(targetRect.left),
        targetRatio: Number((target.offsetWidth / target.offsetHeight).toFixed(3)),
        targetRight: Math.round(targetRect.right),
        targetWidth: Math.round(targetRect.width),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    },
    { mode, targetSelector: targetSelectorByMode[mode] }
  );

  const centerTolerance = mode === "cards" ? 24 : 16;
  expect(layout.centerDelta, `${mode} preview center delta`).toBeLessThanOrEqual(centerTolerance);
  expect(layout.targetWidth, `${mode} preview width`).toBeGreaterThan(0);
  expect(layout.targetLeft, `${mode} preview left`).toBeGreaterThanOrEqual(0);
  expect(layout.targetRight, `${mode} preview right`).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.footerTop, `${mode} footer top`).toBeGreaterThanOrEqual(layout.shellBottom - 1);
  expect(layout.footerBottom, `${mode} footer bottom`).toBeLessThanOrEqual(layout.viewportHeight);
  if (mode === "wide") {
    expect(layout.targetLayoutWidth, `${mode} layout width`).toBeGreaterThanOrEqual(1000);
    expect(layout.targetRatio, `${mode} layout ratio`).toBeGreaterThan(1.76);
    expect(layout.targetRatio, `${mode} layout ratio`).toBeLessThan(1.79);
  }
  if (mode === "cards" && layout.viewportWidth > 900) {
    expect(layout.shellOverflowY, `${mode} shell overflow`).toMatch(/^(hidden|auto|scroll)$/);
  } else {
    expect(layout.shellOverflowY, `${mode} shell overflow`).toMatch(/^(auto|scroll)$/);
  }
}

type VisualAppScenario = {
  id: string;
  label: string;
  open: (page: Page) => Promise<void>;
  scrollTarget?: string;
};

async function auditMainAppVisualPages(page: Page, suite: string): Promise<VisualScrollAuditResult[]> {
  const scenarios: VisualAppScenario[] = [
    {
      id: "dashboard",
      label: "总览",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "总览");
        await expect(currentPage.getByLabel("今日阅读工作台")).toBeVisible();
      }
    },
    {
      id: "weread-shelf",
      label: "微信书架",
      open: async (currentPage) => {
        await openShelfSubNav(currentPage, "微信书架");
        await expect(currentPage.getByLabel("书架条目", { exact: true })).toBeVisible();
      }
    },
    {
      id: "candidate-shelf",
      label: "候选书架",
      open: async (currentPage) => {
        await openShelfSubNav(currentPage, "候选书架");
        await expect(currentPage.getByRole("heading", { name: "候选书架", exact: true })).toBeVisible();
      }
    },
    {
      id: "notes",
      label: "笔记中心",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "笔记");
        await expect(currentPage.getByLabel("有笔记的书")).toBeVisible();
      }
    },
    {
      id: "book-notes",
      label: "单本笔记",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "笔记");
        await currentPage.getByLabel("有笔记的书").getByRole("button", { name: /深度工作/ }).click();
        await expect(currentPage.getByLabel("单本笔记视图")).toBeVisible();
      }
    },
    {
      id: "stats",
      label: "统计",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "统计");
        await expect(currentPage.getByLabel("统计摘要")).toBeVisible();
      }
    },
    {
      id: "discovery",
      label: "发现",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "发现");
        await expect(currentPage.locator(".discovery-search-panel")).toBeVisible();
      }
    },
    {
      id: "book-detail",
      label: "书籍详情",
      open: openDeepWorkDetailForAudit
    },
    {
      id: "book-ai-summary",
      label: "AI 复盘",
      open: async (currentPage) => {
        await openDeepWorkDetailForAudit(currentPage);
        await currentPage.getByLabel("本书管理").getByRole("button", { name: /AI 复盘/ }).click();
        await expect(currentPage.getByRole("heading", { name: "《深度工作》AI 复盘" })).toBeVisible();
      }
    },
    {
      id: "reading-route",
      label: "阅读指南",
      open: async (currentPage) => {
        await openDeepWorkDetailForAudit(currentPage);
        await currentPage.getByLabel("本书管理").getByRole("button", { name: /本书阅读指南/ }).click();
        await expect(currentPage.getByLabel("本书阅读指南")).toBeVisible();
      }
    },
    {
      id: "reading-hub-review",
      label: "书籍复盘中心",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "书籍复盘");
        await expect(currentPage.locator(".reading-hub-books")).toBeVisible();
      }
    },
    {
      id: "reading-hub-guide",
      label: "阅读指南库",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "阅读指南");
        await expect(currentPage.getByLabel("阅读指南成果列表")).toBeVisible();
      }
    },
    {
      id: "reading-report",
      label: "阅读报告",
      open: async (currentPage) => {
        await openPrimaryNav(currentPage, "阅读报告");
        await expect(currentPage.locator(".review-cover-card")).toBeVisible();
      }
    },
    {
      id: "book-decision",
      label: "选书决策",
      open: async (currentPage) => {
        await openShelfSubNav(currentPage, "候选书架");
        await currentPage.getByRole("button", { name: "推荐下一本" }).click();
        await selectBookDecisionCandidate(currentPage, "月亮与六便士");
        await currentPage.getByRole("button", { name: "下一步" }).click();
        await currentPage.getByRole("button", { name: "生成决策" }).click();
        await expect(currentPage.getByLabel("取舍对比")).toBeVisible();
      }
    }
  ];

  const results: VisualScrollAuditResult[] = [];
  for (const scenario of scenarios) {
    await scenario.open(page);
    results.push(
      await auditVisualScroll(page, {
        id: scenario.id,
        label: scenario.label,
        scrollTarget: scenario.scrollTarget,
        suite
      })
    );
  }

  console.log(
    `[visual-scroll] ${suite}: ${results
      .map((result) => `${result.label}:${result.screenshotCount}`)
      .join(", ")}`
  );
  return results;
}

async function openDeepWorkDetailForAudit(page: Page) {
  await openShelfSubNav(page, "微信书架");
  await page.getByLabel("书架条目", { exact: true }).getByRole("button", { name: /深度工作/ }).click();
  await expect(page.getByRole("heading", { name: "深度工作" })).toBeVisible();
}

async function auditSettingsVisualCategories(page: Page, suite: string) {
  const categories = ["账户与同步", "AI 设置", "外观偏好", "导出设置", "应用更新", "高级维护"];
  if ((await page.getByRole("dialog", { name: "设置" }).count()) === 0) {
    await openPrimaryNav(page, "设置");
  }
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

  const results: VisualScrollAuditResult[] = [];
  for (const category of categories) {
    await openSettingsCategory(page, category);
    results.push(
      await auditVisualScroll(page, {
        id: `settings-${category}`,
        label: `设置-${category}`,
        scrollTarget: ".settings-modal-content",
        suite
      })
    );
  }

  console.log(
    `[visual-scroll] ${suite}: ${results
      .map((result) => `${result.label}:${result.screenshotCount}`)
      .join(", ")}`
  );
}

async function installTauriMock(page: Page, options: MockTauriOptions = {}) {
  await page.addInitScript(
    ({
      hasCredential,
      longNoteCardContent,
      longBulkExportList,
      manyBookReviewSummaries,
      bookReviewExportFailure,
      bulkExportFailure,
      bulkExportCommandFailure,
      emptyData,
      hasAiCredential,
      cachedBookDecision,
      staleBookDecision,
      internalBookDecisionActions,
      manyCandidateBooks,
      manyStatsItems,
      duplicateDashboardActions,
      emptyCandidateStates,
      emptyReviewSignals,
      noRecentReadingEntries,
      failReadingStatsSync,
      longStatsAction,
      manyReadingAssistantThreads,
      availableAppUpdate
    }) => {
      const nowSeconds = 1_725_955_200;
      const currentNowSeconds = Math.floor(Date.now() / 1000);
      const longNoteCardToken =
        "ll_envScriptsactivatebatll_envScriptsactivatebatll_envScriptsactivatebatll_envScriptsactivatebat";
      const highlightText = longNoteCardContent
        ? `如果你使用的是 Windows 虚拟环境，运行 ${longNoteCardToken} 进入环境。`
        : "真正有价值的成果，来自长时间无干扰的专注。";
      const thoughtText = longNoteCardContent
        ? `要停止使用虚拟环境，可以先记录这段命令：${longNoteCardToken}`
        : "这条原则可以直接放进每日阅读复盘。";
      const credential = hasCredential
        ? { hasCredential: true, lastValidatedAt: String(nowSeconds) }
        : { hasCredential: false };
      const hasSavedAiCredential = hasAiCredential ?? hasCredential;
      const readableLastReadAt = (offsetSeconds) => noRecentReadingEntries ? 0 : currentNowSeconds - offsetSeconds;
      let readingAssistantPreferences = {
        usePersonalizedContext: true,
        useReadingMemory: false,
        allowRawBookNotes: false,
        saveConversationHistory: true
      };
      let aiState = {
        credential: hasSavedAiCredential
          ? { hasCredential: true, lastValidatedAt: String(nowSeconds - 1800) }
          : { hasCredential: false },
        provider: {
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini"
        }
      };
      const baseReadingAssistantThreadSummaries = [
        {
          id: "assistant-history-book-notes",
          scope: "bookNotes",
          entityId: "book-deep-work",
          title: "深度工作复盘追问",
          createdAt: String(nowSeconds - 3600),
          updatedAt: String(nowSeconds - 1800),
          messageCount: 2
        },
        {
          id: "assistant-history-stats",
          scope: "readingStats",
          title: "统计阅读节奏",
          createdAt: String(nowSeconds - 3000),
          updatedAt: String(nowSeconds - 1200),
          messageCount: 2
        },
        {
          id: "assistant-history-candidates",
          scope: "candidateShelf",
          title: "候选书决策",
          createdAt: String(nowSeconds - 2400),
          updatedAt: String(nowSeconds - 600),
          messageCount: 2
        }
      ];
      const largeReadingAssistantScopes = [
        { scope: "global", label: "全局" },
        { scope: "bookDetail", entityId: "book-deep-work", label: "当前书" },
        { scope: "bookNotes", entityId: "book-deep-work", label: "笔记" },
        { scope: "readingStats", label: "统计" },
        { scope: "candidateShelf", label: "候选书" }
      ];
      const largeReadingAssistantThreadSummaries = Array.from({ length: 50 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        const scopeInfo = largeReadingAssistantScopes[index % largeReadingAssistantScopes.length];
        const isOtherBookDetailThread =
          scopeInfo.scope === "bookDetail" &&
          Math.floor(index / largeReadingAssistantScopes.length) % 2 === 1;
        const entityId = isOtherBookDetailThread ? "book-clean-code" : scopeInfo.entityId;
        const label = isOtherBookDetailThread ? "其他书" : scopeInfo.label;
        return {
          id: `assistant-history-pressure-${number}`,
          scope: scopeInfo.scope,
          entityId,
          title: `压力线程 ${number} ${label}`,
          createdAt: String(nowSeconds - 7200 + index * 60),
          updatedAt: String(nowSeconds - index * 60),
          messageCount: 2
        };
      });
      const readingAssistantThreadSummaries = manyReadingAssistantThreads
        ? largeReadingAssistantThreadSummaries
        : baseReadingAssistantThreadSummaries;
      const baseReadingAssistantThreadDetails = {
        "assistant-history-book-notes": {
          ...baseReadingAssistantThreadSummaries[0],
          contextSummary: {},
          messages: [
            {
              id: "assistant-history-book-notes-user",
              role: "user",
              content: "深度工作历史问题",
              status: "answered",
              usedContext: [],
              createdAt: String(nowSeconds - 3590)
            },
            {
              id: "assistant-history-book-notes-assistant",
              role: "assistant",
              content: "深度工作历史回答",
              status: "answered",
              usedContext: [],
              output: {
                suggestions: [],
                recommendedBooks: [],
                basisNotice: "基于历史对话。"
              },
              createdAt: String(nowSeconds - 3580)
            }
          ]
        },
        "assistant-history-stats": {
          ...baseReadingAssistantThreadSummaries[1],
          contextSummary: {},
          messages: [
            {
              id: "assistant-history-stats-user",
              role: "user",
              content: "统计历史问题",
              status: "answered",
              usedContext: [],
              createdAt: String(nowSeconds - 2990)
            },
            {
              id: "assistant-history-stats-assistant",
              role: "assistant",
              content: "统计历史回答",
              status: "answered",
              usedContext: [],
              output: {
                suggestions: [],
                recommendedBooks: [],
                basisNotice: "基于历史对话。"
              },
              createdAt: String(nowSeconds - 2980)
            }
          ]
        },
        "assistant-history-candidates": {
          ...baseReadingAssistantThreadSummaries[2],
          contextSummary: {},
          messages: [
            {
              id: "assistant-history-candidates-user",
              role: "user",
              content: "候选书历史问题",
              status: "answered",
              usedContext: [],
              createdAt: String(nowSeconds - 2390)
            },
            {
              id: "assistant-history-candidates-assistant",
              role: "assistant",
              content: "候选书历史回答",
              status: "answered",
              usedContext: [],
              output: {
                suggestions: [],
                recommendedBooks: [],
                basisNotice: "基于历史对话。"
              },
              createdAt: String(nowSeconds - 2380)
            }
          ]
        }
      };
      const largeReadingAssistantThreadDetails = Object.fromEntries(
        largeReadingAssistantThreadSummaries.map((summary, index) => {
          const number = String(index + 1).padStart(2, "0");
          return [
            summary.id,
            {
              ...summary,
              contextSummary: {},
              messages: [
                {
                  id: `${summary.id}-user`,
                  role: "user",
                  content: `压力线程 ${number} 用户问题`,
                  status: "answered",
                  usedContext: [],
                  createdAt: String(nowSeconds - 7200 + index * 60 + 10)
                },
                {
                  id: `${summary.id}-assistant`,
                  role: "assistant",
                  content: `压力线程 ${number} 历史回答`,
                  status: "answered",
                  usedContext: [],
                  output: {
                    suggestions: [],
                    recommendedBooks: [],
                    basisNotice: "基于压力历史 mock。"
                  },
                  createdAt: String(nowSeconds - 7200 + index * 60 + 20)
                }
              ]
            }
          ];
        })
      );
      const readingAssistantThreadDetails = manyReadingAssistantThreads
        ? largeReadingAssistantThreadDetails
        : baseReadingAssistantThreadDetails;
      let hasReturnedBookReviewExportFailure = false;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined
        }
      });
      const syncStates = [
        {
          section: "shelf",
          status: "success",
          lastSuccessAt: String(nowSeconds),
          lastAttemptAt: String(nowSeconds)
        },
        {
          section: "notes",
          status: "success",
          lastSuccessAt: String(nowSeconds - 3_600),
          lastAttemptAt: String(nowSeconds - 3_600)
        },
        {
          section: "stats",
          status: "success",
          lastSuccessAt: String(nowSeconds - 7_200),
          lastAttemptAt: String(nowSeconds - 7_200)
        },
        {
          section: "discovery",
          status: "success",
          lastSuccessAt: String(nowSeconds - 10_800),
          lastAttemptAt: String(nowSeconds - 10_800)
        }
      ];
      const fullBookshelf = {
        snapshot: {
          entries: [
            {
              id: "book-deep-work",
              type: "book",
              title: "深度工作",
              author: "卡尔·纽波特",
              category: "效率",
              isTop: true,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(86_400)
            },
            {
              id: "book-three-body",
              type: "book",
              title: "三体",
              author: "刘慈欣",
              category: "科幻",
              isTop: false,
              isSecret: false,
              isFinished: true,
              lastReadAt: readableLastReadAt(172_800)
            },
            {
              id: "album-history",
              type: "album",
              title: "中国通史",
              author: "音频节目",
              category: "历史",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(259_200)
            },
            {
              id: "mp-collection",
              type: "mp",
              title: "文章收藏",
              category: "公众号",
              isTop: false,
              isSecret: true,
              lastReadAt: currentNowSeconds - 345_600
            },
            {
              id: "book-code-review",
              type: "book",
              title: "代码整洁之道",
              author: "Robert C. Martin",
              category: "计算机-编程设计",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(432_000)
            },
            {
              id: "book-money",
              type: "book",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              isTop: false,
              isSecret: false,
              isFinished: true,
              lastReadAt: readableLastReadAt(475_200)
            },
            {
              id: "book-ai-primer",
              type: "book",
              title: "人工智能入门",
              author: "技术作者",
              category: "计算机-人工智能",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(518_400)
            },
            {
              id: "book-category-education",
              type: "book",
              title: "教育心理学",
              author: "教育作者",
              category: "教育",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(604_800)
            },
            {
              id: "book-category-design",
              type: "book",
              title: "设计入门",
              author: "设计作者",
              category: "设计",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(691_200)
            },
            {
              id: "book-category-art",
              type: "book",
              title: "艺术史",
              author: "艺术作者",
              category: "艺术",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(777_600)
            },
            {
              id: "book-category-law",
              type: "book",
              title: "法律常识",
              author: "法律作者",
              category: "法律",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(864_000)
            },
            {
              id: "book-category-health",
              type: "book",
              title: "健康管理",
              author: "健康作者",
              category: "健康",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(950_400)
            },
            {
              id: "book-category-travel",
              type: "book",
              title: "旅行笔记",
              author: "旅行作者",
              category: "旅行",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_036_800)
            },
            {
              id: "book-category-food",
              type: "book",
              title: "饮食文化",
              author: "饮食作者",
              category: "饮食",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_123_200)
            },
            {
              id: "book-category-philosophy",
              type: "book",
              title: "哲学导论",
              author: "哲学作者",
              category: "哲学",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_209_600)
            },
            {
              id: "book-category-science",
              type: "book",
              title: "科学通识",
              author: "科学作者",
              category: "科学",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_296_000)
            },
            {
              id: "book-category-society",
              type: "book",
              title: "社会观察",
              author: "社会作者",
              category: "社会",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_382_400)
            },
            {
              id: "book-category-language",
              type: "book",
              title: "语言学习",
              author: "语言作者",
              category: "语言",
              isTop: false,
              isSecret: false,
              isFinished: false,
              lastReadAt: readableLastReadAt(1_468_800)
            }
          ],
          summary: {
            totalVisibleEntries: 18,
            bookCount: 16,
            albumCount: 1,
            mpCount: 1,
            publicCount: 17,
            secretCount: 1
          }
        },
        syncState: syncStates[0]
      };
      const emptyBookshelf = {
        snapshot: {
          entries: [],
          summary: {
            totalVisibleEntries: 0,
            bookCount: 0,
            albumCount: 0,
            mpCount: 0,
            publicCount: 0,
            secretCount: 0
          }
        },
        syncState: syncStates[0]
      };
      let bookshelf = emptyData ? emptyBookshelf : fullBookshelf;
      const fullNotebookOverview = {
        books: [
          {
            bookId: "book-deep-work",
            title: "深度工作",
            author: "卡尔·纽波特",
            reviewCount: 1,
            noteCount: 2,
            bookmarkCount: 1,
            totalNoteCount: 4,
            readingProgress: 42,
            sort: nowSeconds
          },
          {
            bookId: "book-three-body",
            title: "三体",
            author: "刘慈欣",
            reviewCount: 3,
            noteCount: 5,
            bookmarkCount: 0,
            totalNoteCount: 8,
            readingProgress: 100,
            sort: nowSeconds - 100
          }
        ],
        summary: {
          totalBookCount: 2,
          totalNoteCount: 6
        },
        syncState: syncStates[1]
      };
      const emptyNotebookOverview = {
        books: [],
        summary: {
          totalBookCount: 0,
          totalNoteCount: 0
        },
        syncState: syncStates[1]
      };
      let notebookOverview = emptyData || emptyReviewSignals ? emptyNotebookOverview : fullNotebookOverview;
      const fullStats = {
        stats: {
          mode: "monthly",
          baseTime: nowSeconds,
          readDays: 12,
          totalReadTimeSeconds: 18_900,
          dayAverageReadTimeSeconds: 1_575,
          compare: 0.18,
          buckets: [
            { startTime: nowSeconds - 259_200, readTimeSeconds: 1_800 },
            { startTime: nowSeconds - 172_800, readTimeSeconds: 3_600 },
            { startTime: nowSeconds - 86_400, readTimeSeconds: 2_400 }
          ],
          longestItems: [
            {
              id: "book-deep-work",
              title: "深度工作",
              author: "卡尔·纽波特",
              type: "book",
              readTimeSeconds: 7_200,
              tags: ["效率", "专注"]
            },
            {
              id: "album-history",
              title: "中国通史",
              type: "album",
              readTimeSeconds: 6_120
            }
          ],
          categories: [
            {
              categoryId: "efficiency",
              title: "效率",
              parentTitle: "非虚构",
              readingTimeSeconds: 9_000,
              readingCount: 3
            },
            {
              categoryId: "sci-fi",
              title: "科幻",
              parentTitle: "文学",
              readingTimeSeconds: 5_400,
              readingCount: 2
            }
          ]
        },
        syncState: syncStates[2]
      };

      if (manyStatsItems) {
        fullStats.stats.longestItems = [
          ...fullStats.stats.longestItems,
          ...Array.from({ length: 30 }, (_, index) => {
            const authors = [
              "刘慈欣",
              "卡尔·纽波特",
              "毛姆",
              "张玮",
              "当年明月",
              "陈磊",
              "余华",
              "王小波",
              "彼得·德鲁克",
              "尤瓦尔·赫拉利",
              "村上春树",
              "东野圭吾",
              "罗翔",
              "李娟",
              "史蒂芬·平克",
              "阿西莫夫",
              "加西亚·马尔克斯",
              "茨威格",
              "樊登",
              "吴军",
              "马伯庸",
              "何帆",
              "严肃",
              "梁文道",
              "万维钢",
              "费孝通",
              "钱穆",
              "黄仁宇",
              "许倬云",
              "陈寅恪",
              "顾诚"
            ];
            const categories = ["科幻", "效率", "文学", "历史", "传记"];
            return {
              id: `long-stats-${index + 1}`,
              title: `长读样本 ${index + 1}`,
              author: authors[index % authors.length],
              type: "book",
              readTimeSeconds: 5_800 - index * 180,
              tags: [categories[index % categories.length]]
            };
          })
        ];
        fullStats.stats.categories = [
          ...fullStats.stats.categories,
          ...Array.from({ length: 18 }, (_, index) => ({
            categoryId: `stats-category-${index + 1}`,
            title: [
              "历史",
              "传记",
              "商业",
              "计算机",
              "心理",
              "社会",
              "艺术",
              "哲学",
              "科学",
              "旅行",
              "教育",
              "管理",
              "经济",
              "政治",
              "生活",
              "健康",
              "技术",
              "写作"
            ][index],
            parentTitle: index % 2 === 0 ? "非虚构" : "文学",
            readingTimeSeconds: 4_800 - index * 240,
            readingCount: index + 1
          }))
        ];
      }
      let stats = emptyData ? { stats: null, syncState: syncStates[2] } : fullStats;

      function readingStatsResponseFor(request = {}) {
        if (!stats.stats) {
          return stats;
        }

        const mode = request.mode || stats.stats.mode || "monthly";
        return {
          ...stats,
          stats: {
            ...stats.stats,
            mode,
            baseTime: mode === "overall" ? 0 : request.baseTime || stats.stats.baseTime
          }
        };
      }

      function bookDetail(bookId) {
        const isThreeBody = bookId === "book-three-body" || bookId === "three-body";
        const isDarkForest = bookId === "dark-forest";
        const isMoon = bookId === "rec-moon";
        const isCleanCode = bookId === "book-code-review";
        const isMoney = bookId === "book-money";
        const isLiuCixin = isThreeBody || isDarkForest;
        return {
          detail: {
            bookId,
            title: isThreeBody
              ? "三体"
              : isDarkForest
                ? "黑暗森林"
                : isMoon
                ? "月亮与六便士"
                : isCleanCode
                  ? "代码整洁之道"
                  : isMoney
                    ? "小狗钱钱"
                    : "深度工作",
            author: isLiuCixin
              ? "刘慈欣"
              : isMoon
                ? "毛姆"
                : isCleanCode
                  ? "Robert C. Martin"
                  : isMoney
                    ? "博多·舍费尔"
                    : "卡尔·纽波特",
            translator: isLiuCixin || isCleanCode || isMoney ? undefined : "宋伟",
            intro: isThreeBody
              ? "一部关于文明、宇宙和选择的科幻小说。"
              : isDarkForest
                ? "三体系列第二部，继续展开文明博弈与宇宙社会学。"
              : isMoon
                ? "关于艺术、选择和人生代价的经典小说。"
              : isCleanCode
                ? "关于代码质量、命名和持续整理的工程实践。"
              : isMoney
                ? "关于金钱观、储蓄和目标管理的财商启蒙读物。"
                : "在碎片化世界中训练深度专注能力的方法论。",
            category: isLiuCixin ? "科幻" : isMoon ? "文学" : isCleanCode ? "计算机" : isMoney ? "经济理财" : "效率",
            publisher: isLiuCixin ? "重庆出版社" : "江西人民出版社",
            publishTime: "2024-01",
            isbn: "9780000000000",
            wordCount: isThreeBody ? 230_000 : isDarkForest ? 350_000 : 180_000,
            ratingPercent: isThreeBody ? 94 : isDarkForest ? 96 : 88,
            ratingCount: isThreeBody ? 120_000 : isDarkForest ? 99_000 : 36_000
          },
          progress: {
            bookId,
            chapterUid: 2,
            chapterOffset: 120,
            progressPercent: isThreeBody || isMoney ? 100 : 42,
            updatedAt: nowSeconds - 86_400,
            recordReadingTimeSeconds: isThreeBody ? 18_000 : isMoney ? 3_600 : 7_200,
            finishTime: isThreeBody || isMoney ? nowSeconds - 172_800 : undefined,
            isStarted: true,
            isFinished: isThreeBody || isMoney
          },
          chapters: [
            {
              bookId,
              chapterUid: 1,
              chapterIdx: 1,
              title: "第一章 专注力",
              wordCount: 12_000,
              level: 1,
              paid: true
            },
            {
              bookId,
              chapterUid: 2,
              chapterIdx: 2,
              title: "第二章 深度习惯",
              wordCount: 14_000,
              level: 1,
              paid: true
            }
          ],
          deepLink: `weread://reading?bId=${bookId}`
        };
      }

      function searchResponse() {
        return {
          result: {
            sid: "sid-e2e",
            scope: 0,
            hasMore: false,
            nextMaxIdx: 2,
            groups: [
              {
                title: "电子书",
                scope: 10,
                scopeCount: 2,
                currentCount: 2,
                books: [
                  {
                    bookId: "three-body",
                    title: "三体",
                    author: "刘慈欣",
                    intro: "文化大革命如火如荼进行的同时，军方探寻外星文明。",
                    category: "科幻",
                    ratingPercent: 94,
                    ratingCount: 120_000,
                    ratingTitle: "神作",
                    readingCount: 880_000,
                    searchIdx: 1
                  },
                  {
                    bookId: "dark-forest",
                    title: "黑暗森林",
                    author: "刘慈欣",
                    intro: "三体系列第二部。",
                    category: "科幻",
                    ratingPercent: 96,
                    ratingCount: 99_000,
                    readingCount: 760_000,
                    searchIdx: 2
                  }
                ]
              }
            ]
          },
          syncState: syncStates[3]
        };
      }

      const recommendations = {
        result: {
          books: [
            {
              bookId: "rec-moon",
              title: "月亮与六便士",
              author: "毛姆",
              category: "文学",
              ratingPercent: 89,
              ratingCount: 48_000,
              readingCount: 320_000,
              reason: "你常读文学和思考类作品"
            }
          ],
          hasMore: false,
          nextMaxIdx: 1
        },
        syncState: syncStates[3]
      };

      const similar = {
        result: {
          sessionId: "similar-session",
          books: [
            {
              bookId: "ball-lightning",
              title: "球状闪电",
              author: "刘慈欣",
              category: "科幻",
              ratingPercent: 90,
              ratingCount: 44_000,
              readingCount: 300_000,
              reason: "同作者科幻作品"
            }
          ],
          hasMore: false,
          nextMaxIdx: 1
        },
        syncState: syncStates[3]
      };
      const extraCandidateStates = manyCandidateBooks
        ? Array.from({ length: 9 }, (_, index) => {
            const order = index + 2;
            return [
              `candidate-extra-${order}`,
              {
                itemId: `candidate-extra-${order}`,
                itemType: "candidate",
                status: "toRead",
                title: order === 9 ? "追风筝的人" : `候选书 ${order}`,
                author: order === 9 ? "卡勒德·胡赛尼" : `作者 ${order}`,
                category: "本地候选",
                note: "扩展候选池",
                createdAt: String(nowSeconds - 500 + order),
                updatedAt: String(nowSeconds - 250 + order)
              }
            ];
          })
        : [];
      const readingItemStates = new Map(
        emptyData
          ? []
          : [
              ...(emptyReviewSignals
                ? []
                : [
                    [
                      "book-code-review",
                      {
                        itemId: "book-code-review",
                        itemType: "book",
                        status: "reviewing",
                        title: "代码整洁之道",
                        author: "Robert C. Martin",
                        category: "计算机",
                        note: "需要整理原则",
                        createdAt: String(nowSeconds - 600),
                        updatedAt: String(nowSeconds - 300)
                      }
                    ]
                  ]),
              ...(duplicateDashboardActions
                ? [
                    [
                      "book-deep-work",
                      {
                        itemId: "book-deep-work",
                        itemType: "book",
                        status: "reviewing",
                        title: "深度工作",
                        author: "卡尔·纽波特",
                        category: "效率",
                        note: "最近阅读同时待复盘",
                        createdAt: String(nowSeconds - 550),
                        updatedAt: String(nowSeconds - 200)
                      }
                    ]
                  ]
                : []),
              ...(emptyCandidateStates
                ? []
                : [
                    [
                      "rec-moon",
                      {
                        itemId: "rec-moon",
                        itemType: "candidate",
                        status: "toRead",
                        title: "月亮与六便士",
                        author: "毛姆",
                        category: "文学",
                        note: "发现页保存的本地候选",
                        createdAt: String(nowSeconds - 500),
                        updatedAt: String(nowSeconds - 250)
                      }
                    ]
                  ]),
              ...extraCandidateStates
            ]
      );

      let settingsState = {
        credential,
        syncStates,
        localData: {
          dataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          defaultDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          databasePath: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/app.db",
          databaseSizeBytes: 48_128,
          cacheRowCount: 24,
          isCustomDataDir: false,
          lastDataOperationError: "迁移失败：目标目录不可写",
          tableCounts: [
            { table: "shelf_entries", rowCount: 4 },
            { table: "book_details", rowCount: 2 },
            { table: "notebook_books", rowCount: 2 },
            { table: "reading_stats", rowCount: 1 },
            { table: "ai_outputs", rowCount: 3 },
            { table: "reading_item_states", rowCount: readingItemStates.size },
            { table: "raw_cache", rowCount: 15 }
          ]
        },
        exportData: {
          exportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          isCustomExportDir: false
        },
        appVersion: "0.1.0",
        supportsNativeUpdater: false
      };

      function bulkPreflight(selectedBookIds?: string[], excludeWithoutExportableNotes = true) {
        const selected = Array.isArray(selectedBookIds) && selectedBookIds.length > 0
          ? new Set(selectedBookIds)
          : undefined;
        const baseItems = [
          {
            bookId: "book-deep-work",
            title: "深度工作",
            author: "卡尔·纽波特",
            totalNoteCount: 3,
            cachedExportableCount: 2,
            hasCachedNotes: true,
            hasCachedAiReview: true,
            status: "ready",
            reason: "本地已缓存可导出的划线或想法。"
          },
          {
            bookId: "book-three-body",
            title: "三体",
            author: "刘慈欣",
            totalNoteCount: 5,
            cachedExportableCount: 0,
            hasCachedNotes: false,
            hasCachedAiReview: false,
            status: "needsSync",
            reason: "需要同步/读取后才能导出。"
          },
          {
            bookId: "book-bookmark-only",
            title: "只有书签的书",
            author: "书签作者",
            totalNoteCount: 4,
            cachedExportableCount: 0,
            hasCachedNotes: false,
            hasCachedAiReview: false,
            status: "noContent",
            reason: "本地笔记概览显示无可导出内容。"
          }
        ];
        const extraItems = longBulkExportList
          ? Array.from({ length: 28 }, (_, index) => ({
              bookId: `book-bulk-${index + 1}`,
              title: `批量导出测试书 ${index + 1}`,
              author: `测试作者 ${index + 1}`,
              totalNoteCount: index + 1,
              cachedExportableCount: index % 3 === 0 ? 0 : 1,
              hasCachedNotes: index % 3 !== 0,
              hasCachedAiReview: index % 5 === 0,
              status: index % 3 === 0 ? "needsSync" : "ready",
              reason: index % 3 === 0 ? "需要同步/读取后才能导出。" : "本地已缓存可导出的划线或想法。"
            }))
          : [];
        const items = [...baseItems, ...extraItems]
          .filter((item) => !excludeWithoutExportableNotes || item.bookId !== "book-bookmark-only")
          .filter((item) => !selected || selected.has(item.bookId));

        return {
          totalBooks: items.length,
          readyCount: items.filter((item) => item.status === "ready").length,
          needsSyncCount: items.filter((item) => item.status === "needsSync").length,
          noContentCount: 0,
          cachedAiReviewCount: items.filter((item) => item.hasCachedAiReview).length,
          items
        };
      }

      let hasReturnedBulkExportFailure = false;
      let hasReturnedBulkExportCommandFailure = false;

      function bulkExportResponse(request = {}) {
        const strategy = request.strategy || "localCachedOnly";
        const selectedIds = Array.isArray(request.selectedBookIds) ? request.selectedBookIds : undefined;
        const preflight = bulkPreflight(selectedIds, request.excludeWithoutExportableNotes !== false);
        const items = preflight.items.map((item) => {
          if (item.status === "ready") {
            return {
              bookId: item.bookId,
              title: item.title,
              status: "exported",
              notesFile: "notes/deep-work-1725955200.md",
              aiReviewFile: "reviews/deep-work-ai-summary-1725955200.md",
              reason: "已导出本地笔记 Markdown。"
            };
          }

          if (strategy === "syncMissingNotes") {
            if (
              bulkExportFailure &&
              item.bookId === "book-three-body" &&
              !hasReturnedBulkExportFailure
            ) {
              return {
                bookId: item.bookId,
                title: item.title,
                status: "failed",
                reason: "微信读书接口暂时无法连接，请稍后重试。"
              };
            }

            return {
              bookId: item.bookId,
              title: item.title,
              status: "exported",
              notesFile: "notes/three-body-1725955200.md",
              reason: "已同步缺失笔记并导出 Markdown。"
            };
          }

          return {
            bookId: item.bookId,
            title: item.title,
            status: "skipped",
            reason: item.reason
          };
        });

        if (bulkExportFailure && strategy === "syncMissingNotes") {
          hasReturnedBulkExportFailure = true;
        }

        return {
          exportId: "wxreadmaster-bulk-export-1725955200",
          path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/wxreadmaster-bulk-export-1725955200",
          exportedAt: String(nowSeconds),
          files: [
            "notes/deep-work-1725955200.md",
            ...(strategy === "syncMissingNotes" ? ["notes/three-body-1725955200.md"] : []),
            "reviews/deep-work-ai-summary-1725955200.md",
            "index.md",
            "export-report.md"
          ],
          report: {
            exportedAt: String(nowSeconds),
            strategy,
            concurrency: Math.min(3, Math.max(1, Number(request.concurrency || 2))),
            items
          }
        };
      }

      function bookDecisionResponse(candidates, source = "generated") {
        return {
          scopeId: "candidates:e2e",
          promptVersion: "book-decision-v1",
          inputHash: "e2e-book-decision-hash",
          providerModel: aiState.provider.model,
          source,
          decision: {
            decisionOverview: "推荐下一本先读《月亮与六便士》，因为它能承接当前候选池里的文学主题，投入也比继续扩展新书更可控。",
            topCandidates: [
              {
                bookId: "rec-moon",
                title: "月亮与六便士",
                author: "毛姆",
                rank: 1,
                whyNow: "当前候选池已经有文学主题，先读它可以形成关于选择代价的复盘。",
                tradeoff: "取舍理由：暂缓《三体》，避免同时推进两条长篇阅读线。",
                estimatedEffort: "3 个 45 分钟阅读时段",
                prerequisiteAction: "先打开详情确认是否继续读。",
                reviewTrigger: "读完第一章后写 3 条关于选择代价的问题。",
                basis: "来自本地候选和已生成结构化信号。"
              }
            ],
            deferredCandidates: [
              {
                bookId: "three-body",
                title: "三体",
                reason: "暂缓到文学主题完成后，避免长篇阅读线互相抢占时间。"
              }
            ],
            nextActions: internalBookDecisionActions
              ? ["openDetails", "scheduleReadingBlock", "postReadReview"]
              : ["今天打开《月亮与六便士》详情并确认是否开始。", "读完第一章后写 3 条选择代价问题。"],
            sourceStats: {
              candidateCount: Math.max(1, (candidates || []).length),
              summaryCount: 1,
              statsSignalCount: 1,
              localStatusCount: Math.max(1, (candidates || []).length)
            },
            generatedAt: String(nowSeconds),
            promptVersion: "book-decision-v1",
            basisNotice:
              "基于本地候选、已生成复盘和结构化统计信号生成，不代表微信读书远端推荐，也不会写回微信读书。"
          },
          cachedUpdatedAt: String(nowSeconds)
        };
      }

      function bookReviewSummaryList() {
        const baseItems = [
          {
            bookId: "book-deep-work",
            title: "深度工作",
            author: "卡尔·纽波特",
            overview: "这本书的笔记集中在深度专注、减少干扰和把原则落到日常复盘。",
            cachedUpdatedAt: String(nowSeconds - 60),
            providerModel: aiState.provider.model,
            feedbackCount: 1
          }
        ];

        if (!manyBookReviewSummaries) {
          return baseItems;
        }

        return [
          ...baseItems,
          ...Array.from({ length: 17 }, (_, index) => {
            const order = index + 2;
            return {
              bookId: `book-review-sample-${order}`,
              title: `复盘样本 ${order}`,
              author: `作者 ${order}`,
              overview: `用于验证书籍复盘导出弹窗在多条缓存记录下的滚动、搜索和选择行为，当前样本序号 ${order}。`,
              cachedUpdatedAt: String(nowSeconds - 60 - order * 90),
              providerModel: order % 2 === 0 ? aiState.provider.model : "gpt-4.1-mini",
              feedbackCount: order % 3 === 0 ? 2 : 0
            };
          })
        ];
      }

      function aiAssetSummariesResponse() {
        return [
          {
            bookId: "book-deep-work",
            title: "深度工作",
            author: "卡尔·纽波特",
            cover: null,
            progress: 42,
            readingStage: "deepening",
            readingStageLabel: "深入",
            localStatus: "reading",
            hasSingleGuide: true,
            crossRouteCount: 1,
            hasBookReview: true,
            refreshState: "suggested",
            refreshReason: "stage_changed",
            updatedAt: String(nowSeconds - 120)
          }
        ];
      }

      function aiAssetDetailResponse(bookId) {
        if (bookId !== "book-deep-work") {
          return null;
        }

        return {
          bookId: "book-deep-work",
          title: "深度工作",
          author: "卡尔·纽波特",
          cover: null,
          progress: 42,
          readingStage: "deepening",
          readingStageLabel: "深入",
          localStatus: "reading",
          currentGuide: {
            feature: "reading-route",
            scopeId: "book:book-deep-work",
            inputHash: "route-single-hash",
            promptVersion: "reading-route-v2",
            generatedAt: String(nowSeconds - 600),
            updatedAt: String(nowSeconds - 300),
            source: "cache",
            title: "《深度工作》本书阅读指南",
            providerModel: aiState.provider.model
          },
          mainCrossRoutes: [
            {
              feature: "reading-route",
              scopeId: "book:book-deep-work:candidates:moon-and-principles",
              inputHash: "route-main-cross-hash",
              promptVersion: "reading-route-v2",
              generatedAt: String(nowSeconds - 540),
              updatedAt: String(nowSeconds - 240),
              source: "generated",
              title: "深度工作 -> 月亮与六便士 -> 原则",
              providerModel: aiState.provider.model
            }
          ],
          participantCrossRoutes: [
            {
              feature: "reading-route",
              scopeId: "book:book-atomic-habits:candidates:deep-work",
              inputHash: "route-participant-hash",
              promptVersion: "reading-route-v2",
              generatedAt: String(nowSeconds - 500),
              updatedAt: String(nowSeconds - 200),
              source: "cache",
              title: "掌控习惯 -> 深度工作",
              providerModel: aiState.provider.model
            }
          ],
          currentBookReview: {
            feature: "book-review",
            scopeId: "book-deep-work",
            inputHash: "book-review-hash",
            promptVersion: "book-notes-summary-v3",
            generatedAt: String(nowSeconds - 720),
            updatedAt: String(nowSeconds - 180),
            source: "cache",
            title: "《深度工作》AI 复盘",
            providerModel: aiState.provider.model
          }
        };
      }

      function aiAssetVersionDetailResponse(args) {
        if (args.feature === "book-review") {
          return {
            feature: "book-review",
            scopeId: "book-deep-work",
            inputHash: "book-review-hash",
            promptVersion: "book-notes-summary-v3",
            generatedAt: String(nowSeconds - 720),
            updatedAt: String(nowSeconds - 180),
            source: "cache",
            title: "《深度工作》AI 复盘",
            providerModel: aiState.provider.model,
            readingStage: "deepening",
            readingStageLabel: "深入",
            progress: 42,
            refreshReason: "notes_changed",
            basisNotice: "基于本地笔记缓存生成，不代表整本书全文内容。",
            sourceStats: {},
            bookSummary: {
              overview: "这本书的笔记集中在深度专注、减少干扰和把原则落到日常复盘。",
              keyIdeas: ["深度工作需要长时间无干扰投入"],
              myFocus: ["关注每日复盘和可执行习惯"],
              actionItems: ["为阅读和工作分别保留固定深度时段"],
              themeTags: ["专注", "复盘"],
              representativeQuotes: [
                {
                  quote: "真正有价值的成果，来自长时间无干扰的专注。",
                  reason: "直接体现本书笔记的核心关注点。",
                  chapter: "第一章 专注力",
                  noteType: "划线"
                }
              ],
              reflectionQuestions: ["我每天是否保留了不被打断的深度时段？"],
              feedbackOutcomeSummary: {
                summary: "上次反馈已确认固定深度时段有价值，本次保留为可执行行动。",
                appliedChanges: ["保留深度时段行动", "减少泛化复盘建议"]
              },
              sourceStats: {
                highlightCount: 1,
                thoughtCount: 1,
                bookmarkCount: 1,
                chapterCount: 1,
                includedHighlightCount: 1,
                includedThoughtCount: 1
              },
              generatedAt: String(nowSeconds - 720),
              promptVersion: "book-notes-summary-v3",
              basisNotice: "基于本地笔记缓存生成，不代表整本书全文内容。"
            }
          };
        }

        const isCrossRoute = String(args.scopeId || "").includes("candidates");

        return {
          feature: "reading-route",
          scopeId: args.scopeId || "book:book-deep-work",
          inputHash: args.inputHash || "route-single-hash",
          promptVersion: "reading-route-v2",
          generatedAt: String(nowSeconds - 600),
          updatedAt: String(nowSeconds - 300),
          source: "cache",
          title: "《深度工作》本书阅读指南",
          providerModel: aiState.provider.model,
          readingStage: "deepening",
          readingStageLabel: "深入",
          progress: 42,
          refreshReason: "stage_changed",
          basisNotice: "基于本地缓存、已生成复盘和用户选择的候选书生成。",
          sourceStats: {},
          readingRoute: {
            routeOverview: isCrossRoute
              ? "先用《深度工作》稳定方法论，再用《月亮与六便士》拓展长期投入主题。"
              : "先围绕《深度工作》完成关键阅读，再整理一份可执行的本书复盘。",
            books: [
              {
                bookId: "book-deep-work",
                title: "深度工作",
                author: "卡尔·纽波特",
                order: 1,
                role: "当前书",
                readingPurpose: "把深度工作方法读完并转成个人执行规则。",
                estimatedEffort: "2 个 45 分钟阅读时段",
                localStatus: "reading",
                basis: "当前进度 42%，优先完成核心方法阅读。"
              },
              ...(isCrossRoute
                ? [
                    {
                      bookId: "rec-moon",
                      title: "月亮与六便士",
                      author: "毛姆",
                      order: 2,
                      role: "主题拓展",
                      readingPurpose: "观察个人选择、创造与代价之间的关系。",
                      estimatedEffort: "3 个普通阅读时段",
                      localStatus: "toRead",
                      basis: "来自用户显式保存的本地候选。"
                    }
                  ]
                : [])
            ],
            dependencies: isCrossRoute
              ? [
                  {
                    fromBookId: "book-deep-work",
                    toBookId: "rec-moon",
                    reason: "先建立稳定阅读节奏，再进入需要持续思考的文学主题。"
                  }
                ]
              : [],
            reviewCheckpoints: [
              {
                timing: "读完第 3 章后",
                question: "哪些方法可以立刻纳入自己的工作节奏？",
                suggestedOutput: "写 3 条本书行动清单。"
              }
            ],
            nextActions: ["今天安排 45 分钟读完第 2 章，并标出 3 条可以直接实践的专注规则。"],
            sourceStats: {
              currentBookCount: 1,
              candidateCount: isCrossRoute ? 1 : 0,
              summaryCount: 1,
              statsSignalCount: 1,
              localStatusCount: 1
            },
            generatedAt: String(nowSeconds - 600),
            promptVersion: "reading-route-v2",
            basisNotice: "基于本地缓存、已生成复盘和用户选择的候选书生成。"
          }
        };
      }

      function aiAssetVersionHistoryResponse(args) {
        const current = aiAssetVersionDetailResponse(args);
        return [
          {
            feature: current.feature,
            scopeId: current.scopeId,
            inputHash: current.inputHash,
            promptVersion: current.promptVersion,
            generatedAt: current.generatedAt,
            updatedAt: current.updatedAt,
            source: current.source,
            title: current.title,
            providerModel: current.providerModel,
            readingStage: current.readingStage,
            readingStageLabel: current.readingStageLabel,
            progress: current.progress,
            refreshReason: current.refreshReason,
            isCurrent: true
          }
        ];
      }

      window.__e2eInvokeCounts = {};
      window.__e2eInvokeArgs = {};
      window.__e2eTauriCallbacks = new Map();
      window.__e2eTauriEventListeners = new Map();
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event, id) => {
          const listeners = window.__e2eTauriEventListeners.get(event) || [];
          window.__e2eTauriEventListeners.set(
            event,
            listeners.filter((listenerId) => listenerId !== id)
          );
          window.__e2eTauriCallbacks.delete(id);
        }
      };
      window.__e2eEmitTauriEvent = (event, payload) => {
        const listeners = window.__e2eTauriEventListeners.get(event) || [];
        for (const listenerId of listeners) {
          const callback = window.__e2eTauriCallbacks.get(listenerId);
          callback?.({ event, id: listenerId, payload });
        }
      };
      window.__TAURI_INTERNALS__ = {
        transformCallback: (callback, once = false) => {
          const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
          window.__e2eTauriCallbacks.set(id, (event) => {
            if (once) {
              window.__e2eTauriCallbacks.delete(id);
            }
            callback?.(event);
          });
          return id;
        },
        unregisterCallback: (id) => {
          window.__e2eTauriCallbacks.delete(id);
        },
        invoke: async (cmd, args = {}) => {
          window.__e2eInvokeCounts[cmd] = (window.__e2eInvokeCounts[cmd] || 0) + 1;
          window.__e2eInvokeArgs[cmd] = args;
          switch (cmd) {
            case "plugin:event|listen": {
              const listeners = window.__e2eTauriEventListeners.get(args.event) || [];
              window.__e2eTauriEventListeners.set(args.event, [...listeners, args.handler]);
              return args.handler;
            }
            case "plugin:event|unlisten": {
              window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(args.event, args.eventId);
              return null;
            }
            case "get_credential_status":
              return credential;
            case "validate_credential":
              return {
                isValid: typeof args.apiKey === "string" && args.apiKey.startsWith("sk-"),
                checkedAt: String(nowSeconds),
                message: "E2E mock validation"
              };
            case "save_credential":
              return { hasCredential: true, lastValidatedAt: String(nowSeconds) };
            case "remove_credential":
              return { hasCredential: false };
            case "get_ai_settings_state":
              return aiState;
            case "validate_ai_credential":
              return {
                isValid: typeof args.apiKey === "string" && args.apiKey.startsWith("sk-"),
                checkedAt: String(nowSeconds),
                message: "E2E mock AI validation"
              };
            case "save_ai_credential":
            case "save_ai_settings":
              if (args.apiKey) {
                aiState = {
                  credential: { hasCredential: true, lastValidatedAt: String(nowSeconds) },
                  provider: {
                    baseUrl: args.baseUrl || "https://api.openai.com/v1",
                    model: args.model || "gpt-4o-mini"
                  }
                };
              } else {
                aiState = {
                  ...aiState,
                  provider: {
                    baseUrl: args.baseUrl || aiState.provider.baseUrl,
                    model: args.model || aiState.provider.model
                  }
                };
              }
              return aiState;
            case "test_ai_connection":
              return {
                isValid: Boolean(args.apiKey || aiState.credential.hasCredential),
                checkedAt: String(nowSeconds),
                message: Boolean(args.apiKey || aiState.credential.hasCredential)
                  ? "AI Provider 连通性测试通过。"
                  : "还没有保存 AI API Key，也没有输入新的 AI API Key。"
              };
            case "get_reading_assistant_preferences":
              return readingAssistantPreferences;
            case "save_reading_assistant_preferences":
              readingAssistantPreferences = { ...readingAssistantPreferences, ...args.preferences };
              return readingAssistantPreferences;
            case "list_reading_assistant_threads":
              return readingAssistantThreadSummaries;
            case "get_reading_assistant_thread":
              return readingAssistantThreadDetails[args.threadId] || null;
            case "clear_reading_assistant_history":
              return null;
            case "cancel_reading_assistant_stream":
              return null;
            case "ask_reading_assistant_stream": {
              const assistantRequest = args.request?.request || {};
              const assistantMessage = String(assistantRequest.message || "");
              if (assistantMessage.includes("理财") && assistantMessage.includes("哪些")) {
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-category-books",
                  userMessageId: "assistant-user-message-category-books",
                  messageId: "assistant-message-category-books",
                  answer:
                    "统计缓存显示“经济理财”相关分类累计 4 本、3小时28分钟。当前本地明细可验证到 1 本，先列出可验证书目，不补写缺失书名：\n1. 《小狗钱钱》 - 博多·舍费尔",
                  suggestions: ["帮我只看经济理财里已读完的书。", "帮我解释经济理财类阅读偏好。"],
                  recommendedBooks: [],
                  action: {
                    type: "categoryBooks",
                    payload: {
                      categoryLabel: "经济理财",
                      matchedCategoryTitles: ["经济理财"],
                      queryStatus: "partial",
                      totalStatCount: 4,
                      totalStatReadingTimeText: "3小时28分钟",
                      listedCount: 1,
                      message: "当前本地明细可验证到 1 本。",
                      books: [
                        {
                          bookId: "book-money",
                          title: "小狗钱钱",
                          author: "博多·舍费尔",
                          category: "经济理财",
                          progressPercent: 100,
                          isFinished: true,
                          readingTimeText: "1小时",
                          source: "书架"
                        }
                      ]
                    }
                  },
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: null,
                  basisNotice: "基于本地统计和书架明细。"
                };
              }
              if (assistantMessage.includes("阅读节奏")) {
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-edit",
                  userMessageId: "assistant-user-message-edit-original",
                  messageId: "assistant-message-edit-original",
                  answer: "阅读节奏说明：当前周期比较稳定。",
                  suggestions: ["把这个判断转成一个复盘问题。"],
                  recommendedBooks: [],
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: null,
                  basisNotice: "基于本地统计摘要。"
                };
              }
              if (assistantMessage.includes("复盘问题")) {
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-edit",
                  userMessageId: "assistant-user-message-edit-updated",
                  messageId: "assistant-message-edit-updated",
                  answer: "复盘问题说明：先处理一个关键问题。",
                  suggestions: [],
                  recommendedBooks: [],
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: null,
                  basisNotice: "基于本地统计摘要。"
                };
              }
              if (assistantMessage.includes("长时间生成取消")) {
                window.__e2eEmitTauriEvent("reading-assistant-stream", {
                  streamId: args.request?.streamId,
                  delta: "生成中片段",
                  content: "生成中片段"
                });
                await new Promise((resolve) => setTimeout(resolve, 800));
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-cancel",
                  userMessageId: "assistant-user-message-cancel",
                  messageId: "assistant-message-cancel",
                  answer: "取消后不应显示。",
                  suggestions: [],
                  recommendedBooks: [],
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: aiState.provider.model,
                  basisNotice: "基于取消生成测试。"
                };
              }
              if (assistantMessage.includes("新书推荐流式输出")) {
                window.__e2eEmitTauriEvent("reading-assistant-stream", {
                  streamId: args.request?.streamId,
                  delta: "新书推荐片段",
                  content: "新书推荐片段"
                });
                await new Promise((resolve) => setTimeout(resolve, 120));
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-new-book-streaming",
                  userMessageId: "assistant-user-message-new-book-streaming",
                  messageId: "assistant-message-new-book-streaming",
                  answer: "新书推荐片段最终完成。",
                  suggestions: ["把第一本加入候选前先搜索微信读书。"],
                  recommendedBooks: [
                    {
                      title: "可能性的艺术",
                      author: "作者甲",
                      reason: "承接近期统计里的决策和长期主义主题。",
                      fit: "适合在读完效率类书后换到更开阔的思考框架。",
                      risk: "如果当前只想读强工具书，节奏可能偏慢。"
                    }
                  ],
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: aiState.provider.model,
                  basisNotice: "基于新书推荐流式测试。"
                };
              }
              if (assistantMessage.includes("流式输出")) {
                window.__e2eEmitTauriEvent("reading-assistant-stream", {
                  streamId: args.request?.streamId,
                  delta: "流式片段",
                  content: "流式片段"
                });
                await new Promise((resolve) => setTimeout(resolve, 120));
                return {
                  threadId: assistantRequest.threadId || "assistant-thread-streaming",
                  userMessageId: "assistant-user-message-streaming",
                  messageId: "assistant-message-streaming",
                  answer: "流式片段最终完成。\n\n1. 保留段落换行\n2. 保留编号列表",
                  suggestions: [],
                  recommendedBooks: [],
                  usedContext: [],
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-assistant-chat-v1.3",
                  providerModel: aiState.provider.model,
                  basisNotice: "基于普通问答流式测试。"
                };
              }
              return {
                threadId: assistantRequest.threadId || "assistant-thread-book-notes",
                userMessageId: "assistant-user-message-book-notes",
                messageId: "assistant-message-book-review",
                answer: "这类笔记总结适合进入单本 AI 复盘，而不是阅读指南。",
                suggestions: [],
                recommendedBooks: [],
                action: {
                  type: "bookReview",
                  payload: {
                    bookId: assistantRequest.entityId || "book-deep-work",
                    title: "深度工作",
                    author: "卡尔·纽波特",
                    message: "这类笔记总结应进入单本 AI 复盘，不走阅读指南。",
                    ctaLabel: "生成 AI 复盘"
                  }
                },
                usedContext: [
                  {
                    contextType: "rawBookNotes",
                    label: "原始笔记",
                    sourceRefs: ["book-deep-work"],
                    itemCount: 2
                  }
                ],
                generatedAt: String(nowSeconds),
                promptVersion: "reading-assistant-chat-v1.3",
                providerModel: aiState.provider.model,
                basisNotice: "基于当前书籍笔记上下文回答。"
              };
            }
            case "remove_ai_credential":
              aiState = {
                ...aiState,
                credential: { hasCredential: false }
              };
              return aiState;
            case "get_latest_book_notes_summary":
              if (args.bookId === "book-three-body") {
                return null;
              }
            case "summarize_book_notes":
              return {
                bookId: args.bookId || "book-deep-work",
                promptVersion: "book-notes-summary-v3",
                inputHash: "e2e-summary-hash",
                providerModel: aiState.provider.model,
                source: args.regenerate ? "generated" : "cache",
                summary: {
                  overview: "这本书的笔记集中在深度专注、减少干扰和把原则落到日常复盘。",
                  keyIdeas: ["深度工作需要长时间无干扰投入", "高价值成果来自刻意安排的专注块"],
                  myFocus: ["关注每日复盘和可执行习惯"],
                  actionItems: ["为阅读和工作分别保留固定深度时段"],
                  themeTags: ["专注", "复盘", "习惯"],
                  representativeQuotes: [
                    {
                      quote: "真正有价值的成果，来自长时间无干扰的专注。",
                      reason: "直接体现本书笔记的核心关注点。",
                      chapter: "第一章 专注力",
                      noteType: "划线"
                    }
                  ],
                  reflectionQuestions: ["我每天是否保留了不被打断的深度时段？"],
                  sourceStats: {
                    highlightCount: 1,
                    thoughtCount: 1,
                    bookmarkCount: 1,
                    chapterCount: 1,
                    includedHighlightCount: 1,
                    includedThoughtCount: 1
                  },
                  generatedAt: String(nowSeconds),
                  promptVersion: "book-notes-summary-v3",
                  basisNotice: "基于本地笔记生成，不代表整本书全文内容。"
                },
                cachedUpdatedAt: String(nowSeconds - 60)
              };
            case "export_book_notes_summary_markdown":
              return {
                fileName: "deep-work-ai-summary.md",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/deep-work-ai-summary.md",
                exportedAt: String(nowSeconds)
              };
            case "get_ai_review_feedback":
            case "save_ai_review_feedback":
              return args.feedback || {
                actionItems: {},
                reflectionQuestions: {}
              };
            case "export_book_notes_summaries_markdown":
              const reviewSummaries = bookReviewSummaryList();
              const selectedReviewIds = Array.isArray(args.bookIds) && args.bookIds.length > 0
                ? args.bookIds
                : reviewSummaries.map((item) => item.bookId);
              if (bookReviewExportFailure && !hasReturnedBookReviewExportFailure) {
                hasReturnedBookReviewExportFailure = true;
                throw { message: "导出目录暂时不可写，请稍后重试。" };
              }
              const selectedReviewFiles = selectedReviewIds.map((bookId) => {
                const matched = reviewSummaries.find((item) => item.bookId === bookId);
                const title = matched?.title || bookId;
                return `${title}-ai-summary-1725955200.md`;
              });
              return {
                exportId: "wxreadmaster-book-reviews-1725955200",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/wxreadmaster-book-reviews-1725955200",
                exportedAt: String(nowSeconds),
                files: [...selectedReviewFiles, "index.md"],
                itemCount: selectedReviewIds.length
              };
            case "list_book_notes_summaries":
              if (emptyData && notebookOverview.books.length === 0) {
                return [];
              }
              return bookReviewSummaryList();
            case "list_ai_asset_summaries":
              return aiAssetSummariesResponse();
            case "get_ai_asset_detail":
              return aiAssetDetailResponse(args.bookId);
            case "get_ai_asset_version_detail":
              return aiAssetVersionDetailResponse(args);
            case "get_ai_asset_version_history":
              return aiAssetVersionHistoryResponse(args);
            case "summarize_reading_stats":
            case "get_latest_reading_stats_review":
              return {
                mode: args.mode || "monthly",
                baseTime: nowSeconds,
                promptVersion: "reading-stats-review-v1",
                inputHash: "e2e-stats-review-hash",
                providerModel: aiState.provider.model,
                source: args.regenerate ? "generated" : "cache",
                review: {
                  overview: "本月阅读集中在少数高投入内容，整体节奏稳定。",
                  rhythmInsights: ["阅读时间集中在连续的三个分桶。"],
                  preferenceInsights: ["效率类内容占比较高。"],
                  focusItems: ["深度工作是本周期最长阅读内容。"],
                  nextActions: [
                    longStatsAction
                      ? "把“长读”变成可复制：参考5月6日的节奏，在下月每周固定安排1次不少于30分钟的连续阅读时段，优先放在你更容易沉浸的条目形态（如本月的专辑类）。"
                      : "保留固定深度阅读时段。"
                  ],
                  sourceStats: {
                    mode: args.mode || "monthly",
                    baseTime: nowSeconds,
                    readDays: 12,
                    totalReadTimeSeconds: 18_900,
                    dayAverageReadTimeSeconds: 1_575,
                    bucketCount: 3,
                    longestItemCount: 1,
                    categoryCount: 2
                  },
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-stats-review-v1",
                  basisNotice: "基于结构化阅读统计生成，不包含笔记正文或书籍全文。"
                },
                cachedUpdatedAt: String(nowSeconds - 30)
              };
            case "export_reading_stats_review_markdown":
              return {
                fileName: "monthly-reading-review-1725955200.md",
                path:
                  "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/monthly-reading-review-1725955200.md",
                exportedAt: String(nowSeconds)
              };
            case "get_latest_reading_route":
            case "summarize_reading_route":
              const readingRouteCandidates = args.request?.candidates || [];
              const hasReadingRouteCandidates = readingRouteCandidates.length > 0;
              return {
                bookId: args.request?.book?.bookId || "book-deep-work",
                scopeId: hasReadingRouteCandidates ? "book:book-deep-work:candidates:e2e" : "book:book-deep-work",
                promptVersion: "reading-route-v2.1",
                inputHash: "e2e-reading-route-hash",
                providerModel: aiState.provider.model,
                source: cmd === "summarize_reading_route" ? "generated" : "cache",
                route: {
                  routeOverview: hasReadingRouteCandidates
                    ? "先用《深度工作》稳定方法论，再用候选书拓展到个人选择与长期投入。"
                    : "先围绕《深度工作》完成关键阅读，再整理一份可执行的本书复盘。",
                  books: hasReadingRouteCandidates
                    ? [
                        {
                          bookId: "book-deep-work",
                          title: "深度工作",
                          author: "卡尔·纽波特",
                          order: 1,
                          role: "方法基座",
                          readingPurpose: "先确认专注训练和复盘方法。",
                          estimatedEffort: "2 个深度阅读时段",
                          localStatus: "reviewing",
                          basis: "来自当前书和已生成复盘摘要。"
                        },
                        {
                          bookId: "rec-moon",
                          title: "月亮与六便士",
                          author: "毛姆",
                          order: 2,
                          role: "主题拓展",
                          readingPurpose: "观察个人选择、创造与代价之间的关系。",
                          estimatedEffort: "3-4 个普通阅读时段",
                          localStatus: "toRead",
                          basis: "来自用户显式保存的本地候选。"
                        }
                      ]
                    : [
                        {
                          bookId: "book-deep-work",
                          title: "深度工作",
                          author: "卡尔·纽波特",
                          order: 1,
                          role: "当前书",
                          readingPurpose: "把深度工作方法读完并转成个人执行规则。",
                          estimatedEffort: "2 个 45 分钟阅读时段",
                          localStatus: "reviewing",
                          basis: "当前进度 42%，优先完成第 2 章到第 3 章的核心方法阅读。"
                        }
                      ],
                  dependencies: hasReadingRouteCandidates
                    ? [
                        {
                          fromBookId: "book-deep-work",
                          toBookId: "rec-moon",
                          reason: "先建立稳定阅读节奏，再进入需要持续思考的文学主题。"
                        }
                      ]
                    : [],
                  reviewCheckpoints: [
                    {
                      timing: hasReadingRouteCandidates ? "读完《深度工作》复盘后" : "读完第 3 章后",
                      question: hasReadingRouteCandidates ? "哪些专注方法能迁移到文学阅读？" : "哪些方法可以立刻纳入自己的工作节奏？",
                      suggestedOutput: hasReadingRouteCandidates ? "写一段路线复盘。" : "写 3 条本书行动清单，并为每条补 1 个执行场景。"
                    }
                  ],
                  nextActions: hasReadingRouteCandidates
                    ? ["确认候选书范围", "读完第一本后生成或更新单本复盘"]
                    : ["今天安排 45 分钟读完第 2 章，并标出 3 条可以直接实践的专注规则。", "再决定是否加入候选书扩展主题"],
                  sourceStats: {
                    currentBookCount: 1,
                    candidateCount: readingRouteCandidates.length,
                    summaryCount: 1,
                    statsSignalCount: 1,
                    localStatusCount: hasReadingRouteCandidates ? 2 : 1
                  },
                  generatedAt: String(nowSeconds),
                  promptVersion: "reading-route-v2.1",
                  basisNotice:
                    "基于本地缓存、已生成复盘和用户选择的候选书生成，不代表微信读书远端计划，也不会写回微信读书。"
                },
                cachedUpdatedAt: String(nowSeconds - 20)
              };
            case "export_reading_route_markdown":
              return {
                fileName: "deep-work-reading-route.md",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/deep-work-reading-route.md",
                exportedAt: String(nowSeconds)
              };
            case "export_report_image":
              return {
                fileName: args.fileName || "reading-report.png",
                path: `D:/wxreadmaster-exports/reports/${args.fileName || "reading-report.png"}`,
                exportedAt: String(nowSeconds)
              };
            case "get_latest_book_decision":
              if (staleBookDecision) {
                return {
                  ...bookDecisionResponse(args.candidates, "staleCache"),
                  errorMessage:
                    "当前候选书输入较上次生成有变化，已先展示最近一次缓存；如需更新，请点击重新生成。"
                };
              }
              return cachedBookDecision ? bookDecisionResponse(args.candidates, "cache") : null;
            case "summarize_book_decision":
              return bookDecisionResponse(args.candidates, "generated");
            case "export_book_decision_markdown":
              return {
                fileName: "book-decision-1725955200.md",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/book-decision-1725955200.md",
                exportedAt: String(nowSeconds)
              };
            case "get_bookshelf":
              return hasCredential ? bookshelf : { ...bookshelf, snapshot: { entries: [], summary: bookshelf.snapshot.summary } };
            case "sync_shelf":
              bookshelf = fullBookshelf;
              return hasCredential ? bookshelf : { ...bookshelf, snapshot: { entries: [], summary: bookshelf.snapshot.summary } };
            case "get_book_detail":
              return bookDetail(args.bookId || "book-deep-work");
            case "open_book_in_weread":
              return {
                opened: false,
                deepLink: `weread://reading?bId=${args.bookId || "book-deep-work"}`,
                message: "E2E 环境不会打开桌面客户端。"
              };
            case "get_notebook_overview":
              return notebookOverview;
            case "get_book_notes":
              return {
                bookId: args.bookId || "book-deep-work",
                book: notebookOverview.books[0],
                highlights: [
                  {
                    bookmarkId: "highlight-1",
                    bookId: args.bookId || "book-deep-work",
                    chapterUid: 1,
                    chapterTitle: "第一章 专注力",
                    markText: highlightText,
                    createTime: nowSeconds - 4_000,
                    range: "120-160"
                  }
                ],
                thoughts: [
                  {
                    reviewId: "thought-1",
                    bookId: args.bookId || "book-deep-work",
                    content: thoughtText,
                    createTime: nowSeconds - 3_000,
                    star: 5,
                    chapterName: "第一章 专注力",
                    isFinish: false
                  }
                ],
                chapters: [],
                chapterGroups: [
                  {
                    chapterUid: 1,
                    title: "第一章 专注力",
                    highlights: [
                      {
                        bookmarkId: "highlight-1",
                        bookId: args.bookId || "book-deep-work",
                        chapterUid: 1,
                        chapterTitle: "第一章 专注力",
                        markText: highlightText,
                        createTime: nowSeconds - 4_000,
                        range: "120-160"
                      }
                    ],
                    thoughts: [
                      {
                        reviewId: "thought-1",
                        bookId: args.bookId || "book-deep-work",
                        content: thoughtText,
                        createTime: nowSeconds - 3_000,
                        star: 5,
                        chapterName: "第一章 专注力",
                        isFinish: false
                      }
                    ]
                  }
                ],
                bookmarkCount: 1,
                exportableCount: 2,
                bookmarkContentNotice: "当前微信读书接口只提供书签数量，不提供书签内容；导出仅包含划线和想法/点评。"
              };
            case "export_book_notes_markdown":
              return {
                bookId: args.bookId || "book-deep-work",
                fileName: "深度工作.md",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/深度工作.md",
                exportableCount: 2,
                bookmarkContentNotice: "书签内容不可导出。"
              };
            case "preflight_bulk_export":
              return bulkPreflight(args.selectedBookIds, args.excludeWithoutExportableNotes !== false);
            case "export_bulk_notes":
              if (bulkExportCommandFailure && !hasReturnedBulkExportCommandFailure) {
                hasReturnedBulkExportCommandFailure = true;
                throw { message: "导出目录暂时不可写，请稍后重试。" };
              }
              if (
                args.request?.strategy === "syncMissingNotes" &&
                (window.__e2eDelayBulkExport || window.__e2eDelayBulkExportUntilCancel)
              ) {
                window.setTimeout(() => {
                  window.__e2eEmitTauriEvent("bulk-export-progress", {
                    phase: "syncing",
                    total: 2,
                    completed: 1,
                    exported: 1,
                    failed: 0,
                    skipped: 0,
                    canceled: 0,
                    active: [{ bookId: "book-three-body", title: "三体" }],
                    latest: {
                      bookId: "book-deep-work",
                      title: "深度工作",
                      status: "exported",
                      reason: "已导出本地笔记 Markdown。"
                    },
                    message: "正在同步缺失笔记：三体。"
                  });
                }, 50);
                const delayUntilCancel = window.__e2eDelayBulkExportUntilCancel;
                window.__e2eDelayBulkExport = false;
                window.__e2eDelayBulkExportUntilCancel = false;
                await new Promise((resolve) => {
                  const startedAt = Date.now();
                  const timer = window.setInterval(() => {
                    if (window.__e2eCancelBulkExport || (!delayUntilCancel && Date.now() - startedAt > 1_000)) {
                      window.clearInterval(timer);
                      resolve(undefined);
                    }
                  }, 20);
                });
                if (!window.__e2eCancelBulkExport) {
                  return bulkExportResponse(args.request || {});
                }
                window.__e2eCancelBulkExport = false;
                return {
                  ...bulkExportResponse(args.request || {}),
                  report: {
                    ...bulkExportResponse(args.request || {}).report,
                    items: [
                      {
                        bookId: "book-deep-work",
                        title: "深度工作",
                        status: "exported",
                        notesFile: "notes/deep-work-1725955200.md",
                        aiReviewFile: "reviews/deep-work-ai-summary-1725955200.md",
                        reason: "已导出本地笔记 Markdown。"
                      },
                      {
                        bookId: "book-three-body",
                        title: "三体",
                        status: "canceled",
                        reason: "用户已取消，未开始同步。"
                      }
                    ]
                  }
                };
              }
              return bulkExportResponse(args.request || {});
            case "cancel_bulk_export":
              window.__e2eCancelBulkExport = true;
              return null;
            case "get_reading_stats":
              return readingStatsResponseFor(args);
            case "sync_reading_stats":
              if (failReadingStatsSync) {
                throw { message: "统计同步失败，请稍后重试。" };
              }
              stats = fullStats;
              return readingStatsResponseFor(args);
            case "search_books":
              return searchResponse();
            case "get_recommendations":
              return recommendations;
            case "get_similar_books":
              if (args.bookId === "three-body") {
                throw new Error("微信读书相似推荐接口暂时不可用");
              }
              return similar;
            case "list_reading_item_states":
              return Array.from(readingItemStates.values());
            case "get_reading_item_state":
              return readingItemStates.get(args.itemId) || null;
            case "upsert_reading_item_state": {
              const input = args.input || {};
              const existing = readingItemStates.get(input.itemId);
              const next = {
                ...existing,
                ...input,
                createdAt: existing?.createdAt || String(nowSeconds),
                updatedAt: String(nowSeconds + Object.keys(window.__e2eInvokeCounts).length)
              };
              readingItemStates.set(input.itemId, next);
              return next;
            }
            case "remove_reading_item_state": {
              const existing = readingItemStates.get(args.itemId) || null;
              readingItemStates.delete(args.itemId);
              return existing;
            }
            case "get_settings_state":
              return settingsState;
            case "get_remote_app_update_manifest":
              return {
                version: availableAppUpdate ? "1.0.14" : settingsState.appVersion,
                notes: availableAppUpdate
                  ? "移动端触控布局优化。\n\n- 修复底部导航遮挡主内容\n- 改善短视口弹窗和选区浮层可操作性\n- 统一关键按钮触控热区"
                  : "",
                publishedAt: "2026-07-19T08:00:00Z"
              };
            case "choose_custom_export_directory":
              return {
                path: "D:/wxreadmaster-exports"
              };
            case "save_custom_export_directory":
              settingsState = {
                ...settingsState,
                exportData: {
                  ...settingsState.exportData,
                  exportDir: args.targetDir || "D:/wxreadmaster-exports",
                  isCustomExportDir: true
                }
              };
              return {
                path: settingsState.exportData.exportDir,
                state: settingsState
              };
            case "reset_custom_export_directory":
              settingsState = {
                ...settingsState,
                exportData: {
                  ...settingsState.exportData,
                  exportDir: settingsState.exportData.defaultExportDir,
                  isCustomExportDir: false
                }
              };
              return {
                state: settingsState
              };
            case "export_diagnostics":
              return {
                fileName: "wxreadmaster-diagnostics-1725955200.md",
                path:
                  "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports/wxreadmaster-diagnostics-1725955200.md",
                exportedAt: String(nowSeconds)
              };
            case "export_local_data_backup":
              return {
                backupId: "wxreadmaster-backup-1725955200",
                path: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/backups/wxreadmaster-backup-1725955200",
                exportedAt: String(nowSeconds),
                files: ["reading-cache.sqlite3", "reading-cache.sqlite3-wal"]
              };
            case "restore_local_data_backup":
              if (!args.confirm) {
                throw { message: "恢复本地备份需要显式确认。" };
              }
              return {
                restoredFrom: args.backupPath,
                restoredAt: String(nowSeconds),
                state: settingsState
              };
            case "choose_custom_data_directory":
              return {
                path: args.targetDir || "D:/wxreadmaster-data",
                state: settingsState
              };
            case "migrate_local_data_directory":
              if (!args.confirm) {
                throw { message: "迁移本地数据目录需要显式确认。" };
              }
              settingsState = {
                ...settingsState,
                localData: {
                  ...settingsState.localData,
                  dataDir: args.targetDir,
                  databasePath: `${args.targetDir}/reading-cache.sqlite3`,
                  isCustomDataDir: true
                }
              };
              return {
                previousDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
                dataDir: args.targetDir,
                migratedAt: String(nowSeconds),
                files: ["reading-cache.sqlite3", "reading-cache.sqlite3-wal"],
                state: settingsState,
                restartRequired: true
              };
            case "clear_ai_output_cache":
              if (!args.confirm) {
                throw { message: "清除 AI 输出缓存需要显式确认。" };
              }
              settingsState = {
                ...settingsState,
                localData: {
                  ...settingsState.localData,
                  cacheRowCount: Math.max(0, settingsState.localData.cacheRowCount - 3),
                  tableCounts: settingsState.localData.tableCounts.map((item) =>
                    item.table === "ai_outputs" ? { ...item, rowCount: 0 } : item
                  )
                }
              };
              return {
                deletedRows: 3,
                state: settingsState
              };
            case "clear_local_cache":
              return {
                deletedRows: 24,
                state: {
                  ...settingsState,
                  localData: {
                    ...settingsState.localData,
                    cacheRowCount: 0,
                    tableCounts: settingsState.localData.tableCounts.map((item) => ({
                      ...item,
                      rowCount: 0
                    }))
                  }
                }
              };
            default:
              throw new Error(`Unhandled mock command: ${cmd}`);
          }
        },
        runCallback: (id, event) => window.__e2eTauriCallbacks.get(id)?.(event),
        callbacks: window.__e2eTauriCallbacks,
        convertFileSrc: (filePath) => filePath,
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" }
        }
      };
    },
    {
      hasCredential: options.hasCredential ?? true,
      availableAppUpdate: options.availableAppUpdate ?? false,
      hasAiCredential: options.hasAiCredential,
      longNoteCardContent: options.longNoteCardContent ?? false,
      longBulkExportList: options.longBulkExportList ?? false,
      manyBookReviewSummaries: options.manyBookReviewSummaries ?? false,
      bookReviewExportFailure: options.bookReviewExportFailure ?? false,
      bulkExportFailure: options.bulkExportFailure ?? false,
      bulkExportCommandFailure: options.bulkExportCommandFailure ?? false,
      emptyData: options.emptyData ?? false,
      cachedBookDecision: options.cachedBookDecision ?? false,
      staleBookDecision: options.staleBookDecision ?? false,
      internalBookDecisionActions: options.internalBookDecisionActions ?? false,
      manyCandidateBooks: options.manyCandidateBooks ?? false,
      manyStatsItems: options.manyStatsItems ?? false,
      duplicateDashboardActions: options.duplicateDashboardActions ?? false,
      emptyCandidateStates: options.emptyCandidateStates ?? false,
      emptyReviewSignals: options.emptyReviewSignals ?? false,
      noRecentReadingEntries: options.noRecentReadingEntries ?? false,
      failReadingStatsSync: options.failReadingStatsSync ?? false,
      longStatsAction: options.longStatsAction ?? false,
      manyReadingAssistantThreads: options.manyReadingAssistantThreads ?? false
    }
  );
}

async function readMobileBlockingDialogLayout(page: Page, dialogSelector: string) {
  return page.locator(dialogSelector).evaluate((dialog) => {
    const backdrop = dialog.closest<HTMLElement>(".reading-route-dialog-backdrop");
    const footer = dialog.querySelector<HTMLElement>(".reading-route-dialog-footer");
    const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!backdrop || !footer || !bottomNav) {
      throw new Error("移动端弹窗布局元素缺失");
    }

    const dialogRect = dialog.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const navRect = bottomNav.getBoundingClientRect();
    const touchTargets = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        [
          "button:not([disabled])",
          "input[type='search']:not([disabled])",
          "select:not([disabled])",
          ".book-decision-factor",
          ".book-decision-candidate label",
          ".reading-route-candidate-grid button:not([disabled])"
        ].join(", ")
      )
    ).filter((element, index, elements) => elements.indexOf(element) === index);
    const undersizedTargets = touchTargets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.getAttribute("class") ?? ""),
          height: Math.round(rect.height),
          label: String(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40),
          tagName: element.tagName.toLowerCase(),
          width: Math.round(rect.width)
        };
      })
      .filter((target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44));

    return {
      backdropZIndex: Number.parseInt(window.getComputedStyle(backdrop).zIndex || "0", 10),
      bottomNavZIndex: Number.parseInt(window.getComputedStyle(bottomNav).zIndex || "0", 10),
      dialogBottom: Math.round(dialogRect.bottom),
      dialogCanScroll: dialog.scrollHeight > dialog.clientHeight,
      dialogLeft: Math.round(dialogRect.left),
      dialogOverflowY: window.getComputedStyle(dialog).overflowY,
      dialogRight: Math.round(dialogRect.right),
      dialogTop: Math.round(dialogRect.top),
      footerBottom: Math.round(footerRect.bottom),
      footerTop: Math.round(footerRect.top),
      navTop: Math.round(navRect.top),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      undersizedTargets,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  });
}

async function readVisibleTouchTargets(page: Page, selectors: string[]) {
  return page.evaluate((targetSelectors) => {
    const compact = (value: string | null | undefined) =>
      String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth
      );
    };
    const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
    const bottomNavTop = bottomNav ? Math.round(bottomNav.getBoundingClientRect().top) : null;
    const readVisibleBounds = (element: HTMLElement, rect: DOMRect) => {
      let visibleTop = Math.max(0, rect.top);
      let visibleBottom = Math.min(window.innerHeight, rect.bottom, bottomNavTop ?? window.innerHeight);
      let current = element.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflowY} ${style.overflowX}`)) {
          const currentRect = current.getBoundingClientRect();
          visibleTop = Math.max(visibleTop, currentRect.top);
          visibleBottom = Math.min(visibleBottom, currentRect.bottom);
        }
        current = current.parentElement;
      }

      return {
        visibleBottom: Math.round(visibleBottom),
        visibleHeight: Math.round(Math.max(0, visibleBottom - visibleTop)),
        visibleTop: Math.round(visibleTop)
      };
    };

    const targets = targetSelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const visibleBounds = readVisibleBounds(element, rect);
          const probeX = Math.round(Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1));
          const probeY = Math.round(
            Math.min(
              visibleBounds.visibleTop + visibleBounds.visibleHeight / 2,
              (bottomNavTop ?? window.innerHeight) - 2,
              window.innerHeight - 1
            )
          );
          const hitElement =
            visibleBounds.visibleHeight > 0 ? document.elementFromPoint(probeX, probeY) : null;

          return {
            bottomNavHitBlocked:
              visibleBounds.visibleHeight > 0 &&
              hitElement instanceof HTMLElement &&
              hitElement !== element &&
              !element.contains(hitElement),
            className: compact(element.getAttribute("class")),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            label: compact(
              element.getAttribute("aria-label") ||
                element.textContent ||
                element.getAttribute("placeholder")
            ),
            selector,
            tagName: element.tagName.toLowerCase(),
            top: Math.round(rect.top),
            visibleHeightAboveBottomNav: visibleBounds.visibleHeight,
            width: Math.round(rect.width)
          };
        })
        .filter((target) => target.visibleHeightAboveBottomNav >= 44)
    );

    return {
      bottomNavTop,
      bottomNavBlockedTargets: targets.filter(
        (target) => target.visibleHeightAboveBottomNav < 44 || target.bottomNavHitBlocked
      ),
      targets,
      undersizedTargets: targets.filter(
        (target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44)
      )
    };
  }, selectors);
}

function expectMobileBlockingDialogLayout(layout: Awaited<ReturnType<typeof readMobileBlockingDialogLayout>>) {
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.footerTop).toBeGreaterThanOrEqual(0);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(["auto", "scroll", "hidden"]).toContain(layout.dialogOverflowY);
  expect(layout.backdropZIndex).toBeGreaterThan(layout.bottomNavZIndex);
  expect(layout.overflowX).toBe(false);
}

async function readMobileOverlayDialogLayout(
  page: Page,
  selectors: {
    actionsSelector: string;
    backdropSelector: string;
    dialogSelector: string;
  }
) {
  return page.locator(selectors.dialogSelector).evaluate((dialog, currentSelectors) => {
    const backdrop = document.querySelector<HTMLElement>(currentSelectors.backdropSelector);
    const actions = dialog.querySelector<HTMLElement>(currentSelectors.actionsSelector);
    const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!backdrop || !actions || !bottomNav) {
      throw new Error("移动端覆盖弹窗布局元素缺失");
    }

    const dialogRect = dialog.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const navRect = bottomNav.getBoundingClientRect();
    const touchTargets = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        [
          "button:not([disabled])",
          "textarea:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])"
        ].join(", ")
      )
    );
    const undersizedTargets = touchTargets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.getAttribute("class") ?? ""),
          height: Math.round(rect.height),
          label: String(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40),
          tagName: element.tagName.toLowerCase(),
          width: Math.round(rect.width)
        };
      })
      .filter((target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44));

    return {
      actionsBottom: Math.round(actionsRect.bottom),
      actionsTop: Math.round(actionsRect.top),
      backdropZIndex: Number.parseInt(window.getComputedStyle(backdrop).zIndex || "0", 10),
      bottomNavZIndex: Number.parseInt(window.getComputedStyle(bottomNav).zIndex || "0", 10),
      dialogBottom: Math.round(dialogRect.bottom),
      dialogCanScroll: dialog.scrollHeight > dialog.clientHeight,
      dialogLeft: Math.round(dialogRect.left),
      dialogOverflowY: window.getComputedStyle(dialog).overflowY,
      dialogRight: Math.round(dialogRect.right),
      dialogTop: Math.round(dialogRect.top),
      navTop: Math.round(navRect.top),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      undersizedTargets,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  }, selectors);
}

function expectMobileOverlayDialogLayout(layout: Awaited<ReturnType<typeof readMobileOverlayDialogLayout>>) {
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.actionsTop).toBeGreaterThanOrEqual(0);
  expect(layout.actionsBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(["auto", "scroll", "hidden"]).toContain(layout.dialogOverflowY);
  expect(layout.backdropZIndex).toBeGreaterThan(layout.bottomNavZIndex);
  expect(layout.overflowX).toBe(false);
}

async function readMobileFormOverlayDialogLayout(
  page: Page,
  selectors: {
    actionsSelector: string;
    backdropSelector: string;
    dialogSelector: string;
  }
) {
  return page.locator(selectors.dialogSelector).evaluate((dialog, currentSelectors) => {
    const backdrop = document.querySelector<HTMLElement>(currentSelectors.backdropSelector);
    const actions = dialog.querySelector<HTMLElement>(currentSelectors.actionsSelector);
    const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!backdrop || !actions || !bottomNav) {
      throw new Error("移动端表单弹窗布局元素缺失");
    }

    const dialogRect = dialog.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const navRect = bottomNav.getBoundingClientRect();
    const directControls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        [
          "button:not([disabled])",
          "textarea:not([disabled])",
          "input:not([disabled]):not([type='checkbox']):not([type='radio'])",
          "select:not([disabled])"
        ].join(", ")
      )
    ).map((element) =>
      element.matches("input, textarea, select") ? element.closest<HTMLElement>("label") ?? element : element
    );
    const labeledChoiceControls = Array.from(
      dialog.querySelectorAll<HTMLInputElement>(
        "input[type='checkbox']:not([disabled]), input[type='radio']:not([disabled])"
      )
    )
      .map((input) => input.closest<HTMLElement>("label") ?? input)
      .filter((element, index, elements) => elements.indexOf(element) === index);
    const touchTargets = [...directControls, ...labeledChoiceControls];
    const undersizedTargets = touchTargets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.getAttribute("class") ?? ""),
          height: Math.round(rect.height),
          label: String(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40),
          tagName: element.tagName.toLowerCase(),
          width: Math.round(rect.width)
        };
      })
      .filter((target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44));

    return {
      actionsBottom: Math.round(actionsRect.bottom),
      actionsTop: Math.round(actionsRect.top),
      backdropZIndex: Number.parseInt(window.getComputedStyle(backdrop).zIndex || "0", 10),
      bottomNavZIndex: Number.parseInt(window.getComputedStyle(bottomNav).zIndex || "0", 10),
      dialogBottom: Math.round(dialogRect.bottom),
      dialogCanScroll: dialog.scrollHeight > dialog.clientHeight,
      dialogLeft: Math.round(dialogRect.left),
      dialogOverflowY: window.getComputedStyle(dialog).overflowY,
      dialogRight: Math.round(dialogRect.right),
      dialogTop: Math.round(dialogRect.top),
      navTop: Math.round(navRect.top),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      undersizedTargets,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  }, selectors);
}

async function readMobileStandaloneDialogLayout(
  page: Page,
  selectors: {
    backdropSelector: string;
    dialogSelector: string;
  }
) {
  return page.locator(selectors.dialogSelector).evaluate((dialog, currentSelectors) => {
    const backdrop = document.querySelector<HTMLElement>(currentSelectors.backdropSelector);
    const bottomNav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!backdrop || !bottomNav) {
      throw new Error("移动端独立弹窗布局元素缺失");
    }

    const dialogRect = dialog.getBoundingClientRect();
    const touchTargets = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        [
          "button:not([disabled])",
          "textarea:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])"
        ].join(", ")
      )
    );
    const undersizedTargets = touchTargets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.getAttribute("class") ?? ""),
          height: Math.round(rect.height),
          label: String(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40),
          tagName: element.tagName.toLowerCase(),
          width: Math.round(rect.width)
        };
      })
      .filter((target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44));

    return {
      backdropZIndex: Number.parseInt(window.getComputedStyle(backdrop).zIndex || "0", 10),
      bottomNavZIndex: Number.parseInt(window.getComputedStyle(bottomNav).zIndex || "0", 10),
      dialogBottom: Math.round(dialogRect.bottom),
      dialogCanScroll: dialog.scrollHeight > dialog.clientHeight,
      dialogLeft: Math.round(dialogRect.left),
      dialogOverflowY: window.getComputedStyle(dialog).overflowY,
      dialogRight: Math.round(dialogRect.right),
      dialogTop: Math.round(dialogRect.top),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      undersizedTargets,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  }, selectors);
}

function expectMobileStandaloneDialogLayout(layout: Awaited<ReturnType<typeof readMobileStandaloneDialogLayout>>) {
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(["auto", "scroll", "hidden"]).toContain(layout.dialogOverflowY);
  expect(layout.backdropZIndex).toBeGreaterThan(layout.bottomNavZIndex);
  expect(layout.overflowX).toBe(false);
}

async function openPrimaryNav(page: Page, label: string) {
  if (label === "书籍复盘" || label === "阅读指南" || label === "阅读报告") {
    await openReadingReviewSubNav(page, label);
    return;
  }

  await ensurePrimaryNavOpen(page);
  await page.locator(".sidebar").getByRole("button", { name: label, exact: true }).dispatchEvent("click");
}

async function openReadingAssistantFromStats(page: Page) {
  await openPrimaryNav(page, "统计");
  await page.getByLabel("打开 AI 阅读助手").click();
  const readingAssistant = page.getByRole("complementary", { name: "AI 阅读助手" });
  await expect(readingAssistant).toBeVisible();
  return readingAssistant;
}

async function sendReadingAssistantMessage(readingAssistant: Locator, message: string) {
  await readingAssistant.getByPlaceholder("问一个阅读问题").fill(message);
  await readingAssistant.getByRole("button", { name: "发送" }).click();
}

async function closeSettingsDialog(page: Page) {
  await page.getByRole("button", { name: "关闭设置" }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
}

async function openSettingsCategory(page: Page, label: string) {
  await page.getByLabel("设置分类").getByRole("button", { name: label }).click();
}

async function openSettingsDiagnostics(page: Page) {
  await page.getByLabel("本地诊断").getByRole("button", { name: "展开" }).click();
}

async function closeSettingsDiagnostics(page: Page) {
  await page.getByLabel("本地诊断").getByRole("button", { name: "收起" }).click();
}

async function openShelfSubNav(page: Page, label: string) {
  await ensurePrimaryNavOpen(page);
  const shelfSubNav = page.getByLabel("书架子菜单");
  if ((await shelfSubNav.count()) === 0) {
    await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
  }

  await page.getByLabel("书架子菜单").getByRole("button", { name: label }).click();
}

async function openReadingReviewSubNav(page: Page, label: string) {
  await ensurePrimaryNavOpen(page);
  const reviewSubNav = page.getByLabel("复盘子菜单");
  if ((await reviewSubNav.count()) === 0) {
    await page.locator(".sidebar").getByRole("button", { name: "复盘", exact: true }).dispatchEvent("click");
    await expect(page.getByLabel("复盘子菜单")).toBeVisible();
  }

  await page.getByLabel("复盘子菜单").getByRole("button", { name: label }).dispatchEvent("click");
}

async function ensurePrimaryNavOpen(page: Page) {
  const mobileTrigger = page.getByRole("button", { name: "打开主导航", exact: true });
  if (await mobileTrigger.isVisible()) {
    await mobileTrigger.dispatchEvent("click");
    await expect(page.locator(".sidebar")).toBeVisible();
  }
}

async function selectBookDecisionCandidate(page: Page, bookTitle: string) {
  await page.getByRole("button", { name: "下一步" }).click();
  const candidateSection = page.getByLabel("候选书选择");
  await expect(candidateSection).toContainText("已选 0 / 8");
  await candidateSection.getByRole("checkbox", { name: bookTitle }).check();
  await expect(candidateSection).toContainText("已选 1 / 8");
}

async function getInvokeCount(page: Page, command: string) {
  return page.evaluate((cmd) => window.__e2eInvokeCounts?.[cmd] ?? 0, command);
}

async function getLastInvokeArgs(page: Page, command: string) {
  return page.evaluate((cmd) => window.__e2eInvokeArgs?.[cmd] ?? {}, command);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function readDailyWorkbenchLayout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".daily-workbench-panel");
    const primary = document.querySelector(".daily-workbench-primary");
    const secondary = document.querySelector(".daily-workbench-secondary");
    const title = primary?.querySelector("strong");
    const firstDetail = primary?.querySelector(".daily-workbench-detail");

    if (
      !(panel instanceof HTMLElement) ||
      !(primary instanceof HTMLElement) ||
      !(secondary instanceof HTMLElement) ||
      !(title instanceof HTMLElement) ||
      !(firstDetail instanceof HTMLElement)
    ) {
      throw new Error("今日工作台布局元素缺失");
    }

    const panelRect = panel.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const firstDetailRect = firstDetail.getBoundingClientRect();
    const countGridColumns = (element: HTMLElement) =>
      window
        .getComputedStyle(element)
        .gridTemplateColumns.split(/\s+/)
        .filter(Boolean).length;

    return {
      viewportWidth: window.innerWidth,
      panelLeft: Math.round(panelRect.left),
      panelRight: Math.round(panelRect.right),
      primaryGridColumnCount: countGridColumns(primary),
      secondaryGridColumnCount: countGridColumns(secondary),
      titleBottom: Math.round(titleRect.bottom),
      firstDetailTop: Math.round(firstDetailRect.top)
    };
  });
}

async function readDailyReadingCardLayout(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector(".daily-reading-card");
    const copy = document.querySelector(".daily-reading-card-copy");
    const footer = card?.querySelector("footer");
    const button = footer?.querySelector("button");

    if (
      !(card instanceof HTMLElement) ||
      !(copy instanceof HTMLElement) ||
      !(footer instanceof HTMLElement) ||
      !(button instanceof HTMLElement)
    ) {
      throw new Error("今日卡片布局元素缺失");
    }

    const cardRect = card.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      panelLeft: Math.round(cardRect.left),
      panelRight: Math.round(cardRect.right),
      cardWidth: Math.round(cardRect.width),
      buttonWidth: Math.round(buttonRect.width),
      copyBottom: Math.round(copyRect.bottom),
      footerTop: Math.round(footerRect.top),
      gridColumnCount: window
        .getComputedStyle(card)
        .gridTemplateColumns.split(/\s+/)
        .filter(Boolean).length
    };
  });
}

async function readDashboardLocalProgressLayout(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector(".dashboard-local-progress-card");
    const metricGrid = document.querySelector(".dashboard-local-progress-grid");

    if (!(card instanceof HTMLElement) || !(metricGrid instanceof HTMLElement)) {
      throw new Error("本地进展布局元素缺失");
    }

    const cardRect = card.getBoundingClientRect();
    const countGridColumns = (element: HTMLElement) =>
      window
        .getComputedStyle(element)
        .gridTemplateColumns.split(/\s+/)
        .filter(Boolean).length;

    return {
      viewportWidth: window.innerWidth,
      panelLeft: Math.round(cardRect.left),
      panelRight: Math.round(cardRect.right),
      gridColumnCount: countGridColumns(card),
      metricGridColumnCount: countGridColumns(metricGrid)
    };
  });
}

async function expectBookDecisionTradeoffPillsCompact(page: Page) {
  const pills = page.getByLabel("取舍对比").locator(".book-decision-top-card > span");
  await expect(pills.first()).toBeVisible();

  const layouts = await pills.evaluateAll((elements) =>
    elements.map((element) => {
      const pillRect = element.getBoundingClientRect();
      const cardRect = element.closest(".book-decision-top-card")?.getBoundingClientRect();
      return {
        text: element.textContent?.trim() || "",
        height: Math.round(pillRect.height),
        width: Math.round(pillRect.width),
        cardWidth: Math.round(cardRect?.width ?? 0)
      };
    })
  );

  expect(layouts.length).toBeGreaterThanOrEqual(1);
  for (const layout of layouts) {
    expect(layout.height, `${layout.text} pill height`).toBeLessThanOrEqual(28);
    expect(layout.width, `${layout.text} pill width`).toBeLessThanOrEqual(96);
    expect(layout.width, `${layout.text} pill should not stretch to card width`).toBeLessThan(layout.cardWidth * 0.65);
  }
}

async function expectDarkModeSurfaceContrast(
  page: Page,
  samples: Array<{ label: string; locator: ReturnType<Page["locator"]> }>
) {
  await expect(page.locator(".app-frame")).toHaveAttribute("data-theme", /^(dark|system)$/);
  await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");

  for (const sample of samples) {
    await expect(sample.locator).toBeVisible();
    const colors = await sample.locator.evaluate((element) => {
      const heading = element.querySelector("h2, h3, h4, strong");
      const body = element.querySelector("p:not(.section-kicker), small");
      return {
        background: getComputedStyle(element).backgroundColor,
        heading: heading ? getComputedStyle(heading).color : "",
        body: body ? getComputedStyle(body).color : ""
      };
    });
    const background = parseCssColor(colors.background);
    expect(relativeLuminance(background), `${sample.label} background ${colors.background}`).toBeLessThan(0.25);

    if (colors.heading) {
      expect(
        contrastRatio(parseCssColor(colors.heading), background),
        `${sample.label} heading ${colors.heading} on ${colors.background}`
      ).toBeGreaterThanOrEqual(4.5);
    }
    if (colors.body) {
      expect(
        contrastRatio(parseCssColor(colors.body), background),
        `${sample.label} body ${colors.body} on ${colors.background}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
}

async function expectDarkModeControlContrast(
  page: Page,
  samples: Array<{ label: string; locator: ReturnType<Page["locator"]> }>
) {
  await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");

  for (const sample of samples) {
    await expect(sample.locator).toBeVisible();
    const colors = await sample.locator.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color
    }));
    const background = parseCssColor(colors.background);
    expect(relativeLuminance(background), `${sample.label} background ${colors.background}`).toBeLessThan(0.25);
    expect(
      contrastRatio(parseCssColor(colors.color), background),
      `${sample.label} text ${colors.color} on ${colors.background}`
    ).toBeGreaterThanOrEqual(4.5);
  }
}

function parseCssColor(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    throw new Error(`Unsupported CSS color: ${value}`);
  }

  return {
    red: Number(match[1]),
    green: Number(match[2]),
    blue: Number(match[3])
  };
}

function relativeLuminance(color: { red: number; green: number; blue: number }) {
  const [red, green, blue] = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(
  first: { red: number; green: number; blue: number },
  second: { red: number; green: number; blue: number }
) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}
