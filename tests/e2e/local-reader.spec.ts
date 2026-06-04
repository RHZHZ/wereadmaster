import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { auditVisualScroll } from "./visual-scroll-helpers";

const LOCAL_READER_URL = "/?local-reader-preview=1";
const LOCAL_READER_ORIGIN = "http://127.0.0.1:5173";
const BOOK_ID = "preview-prince";

const PREVIEW_TEXT = [
  "第一章",
  "",
  "“很多时候，幸福并不来自宏大的事件，而是藏在我们注意不到的细节里。”",
  "",
  "我六岁那年，在一本描写原始森林的书里看到一幅精彩的图画。那本书叫《真实的故事》。",
  "",
  "于是我也想画出自己的第一幅作品。大人们看了以后，只问我为什么要画一顶帽子。",
  "",
  "这就是本地 TXT 阅读器预览文本。正式版本会从本机导入文件中读取 UTF-8 内容，并把滚动位置保存为本地阅读进度。",
  "",
  "第二章",
  "",
  "阅读器应该安静、轻便，不抢正文的注意力。后续再补充划线、标记和向 AI 提问时，也应当围绕选中文本出现，而不是把阅读页变成复杂工作台。",
  "",
  "清晨的第一缕阳光透过窗帘的缝隙落在桌面上，空气里还带着夜晚的凉意。",
  "",
  "我习惯在这个时间，给自己倒一杯温热的水，翻开一本书，或者只是静静地发呆。",
  "",
  "我们总在追赶未来，却常常错过了当下。其实，生活并不需要太多的计划和目标，只要愿意停下来，认真感受一朵花的香气、一次风的轻抚、一顿饭的温度，就足够了。",
  "",
  "朋友说，成年人的世界里，容易的事情越来越少。也许正是这样，但我们仍然可以选择用温柔的方式，去对待每一个平凡的日子。",
  "",
  "* * *",
  "",
  "傍晚散步回家，路灯一盏盏亮起。街边的小店飘出饭菜的香味，邻居家的孩子在院子里追逐着笑闹。",
  "",
  "那些看似普通的瞬间，拼凑成了我们生命中的大部分。",
  "",
  "当我们学会在平凡中发现美好，生活便会温柔地回馈我们力量。",
  "",
  "第三章",
  "",
  "本地版本和微信读书版本会继续隔离保存：进度、划线、章节位置和 AI 缓存都不会自动合并。",
  "",
  "本地阅读的价值，不是替代微信读书，而是把用户真正拥有的文件、进度与思考留在本机。",
  "",
  "如果同一本书同时存在于微信读书和本地书库，它们会作为两个版本被清晰标识，避免划线、笔记和 AI 缓存发生隐性冲突。"
].join("\n");

const SELECTED_TEXT =
  "阅读器应该安静、轻便，不抢正文的注意力。后续再补充划线、标记和向 AI 提问时，也应当围绕选中文本出现，而不是把阅读页变成复杂工作台。";
const MARKDOWN_SELECTED_TEXT =
  "Markdown 导入在首版保持文本阅读模式，保留原始标记，优先保证选区、划线和想法偏移稳定。";

const LONG_THOUGHT =
  "这条想法用于验证详情弹窗的复制能力和长文本边界：averyveryverylongtoken_without_spaces_0123456789abcdefghijklmnopqrstuvwxyz@example-domain-with-extra-long-name.test/path/to/resource?query=reading-note-boundary，以及继续补充一段中文说明，确认内容只在详情内部滚动，不会撑大弹窗或侧栏卡片。";
const LONG_HIGHLIGHT = `${SELECTED_TEXT} ${LONG_THOUGHT}`;
const LONG_AI_QUESTION =
  "这条 AI 提问用于验证侧栏卡片边界：averyveryverylongquestiontoken_without_spaces_0123456789abcdefghijklmnopqrstuvwxyz@example-domain-with-extra-long-name.test/path/to/question?query=local-reader-ai-card-boundary，同时继续补充一段中文问题，确认问题、原文、状态和右侧操作按钮不会互相覆盖，也不会撑开侧栏卡片。";

test.describe("本地阅读器想法详情", () => {
  test.describe.configure({ timeout: 90_000 });

  test("EPUB 书籍进入正文阅读器而不是待接入占位", async ({ page }) => {
    await gotoLocalReaderPreview(page);
    await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
    await page.getByLabel("书架子菜单").getByRole("button", { name: "本地书库" }).click();
    await expect(page.getByRole("button", { name: "更多本地书库操作" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /排序：最近阅读/ })).toHaveCount(0);
    await expect(page.getByText("排序：最近阅读")).toBeVisible();
    await expect(page.getByRole("heading", { name: "拖入或选择本地图书" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "选择或粘贴本地图书" })).toBeVisible();
    await page.keyboard.press("Control+K");
    await expect(page.getByPlaceholder("搜索书名、作者或关键词")).toBeFocused();
    const localBookRow = page.getByRole("button", { name: /月亮与六便士 EPUB/ });
    await expect(localBookRow.getByLabel("本地图书来源")).toContainText("本地版本");
    await localBookRow.click();

    await expect(page.getByLabel("本地阅读器")).toBeVisible();
    await expect(page.getByRole("heading", { name: "月亮与六便士" })).toBeVisible();
    await expect(page.getByLabel("阅读来源边界")).toContainText("本地版本");
    await expect(page.getByLabel("阅读来源边界")).toContainText("与微信书架隔离");
    await expect(page.getByLabel("月亮与六便士 正文")).toContainText("本地阅读预览");
    await expect(page.getByLabel("月亮与六便士 正文")).toContainText("TXT/EPUB 文本内容");
    await expect(page.getByLabel("月亮与六便士 正文")).toContainText("保守文本抽取");
    await expect(page.getByLabel("月亮与六便士 正文")).not.toContainText("TXT 正文样本");
    await expect(page.getByLabel("EPUB 阅读器待接入")).toHaveCount(0);
    await expect(page.getByLabel("阅读状态")).toContainText("EPUB · 本地文本阅读");
    await expect(page.getByLabel("阅读状态")).toContainText("滚动位置");
    await expect(page.getByLabel("阅读状态")).not.toContainText("页码：");
    await expect(page.getByLabel("阅读状态")).not.toContainText("本章剩余");
    await expect(page.getByRole("button", { name: "全部书籍" })).toHaveCount(0);
    await expect(page.getByText("全部书籍")).toBeVisible();
    await page.getByRole("tab", { name: "想法" }).click();
    await expect(page.getByRole("button", { name: "本书想法" })).toHaveCount(0);
    await expect(page.getByText("本书想法")).toBeVisible();

    await page.getByLabel("月亮与六便士 正文").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(page.getByLabel("阅读状态")).toContainText("已保存");
  });

  test("Markdown 书籍渲染基础格式并识别标题目录", async ({ page }) => {
    await gotoLocalReaderPreview(page);
    await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
    await page.getByLabel("书架子菜单").getByRole("button", { name: "本地书库" }).click();
    await page.getByRole("tab", { name: "Markdown" }).click();

    const localBookRow = page.getByRole("button", { name: /阅读设计笔记 Markdown/ });
    await expect(localBookRow.getByLabel("本地图书来源")).toContainText("本地版本");
    await localBookRow.click();

    await expect(page.getByLabel("本地阅读器")).toBeVisible();
    await expect(page.getByRole("heading", { name: "阅读设计笔记" })).toBeVisible();
    await expect(page.getByLabel("阅读来源边界")).toContainText("本地版本");
    await expect(page.getByLabel("阅读状态")).toContainText("Markdown · 本地文本阅读");
    const markdownRenderState = await page.getByLabel("阅读设计笔记 正文").evaluate((reader) => {
      const heading = reader.querySelector<HTMLElement>(".local-reader-markdown-block--heading");
      const paragraph = reader.querySelector<HTMLElement>(".local-reader-markdown-block--paragraph");
      const codeLine = reader.querySelector<HTMLElement>(".local-reader-markdown-block--codeLine");
      const syntax = reader.querySelector<HTMLElement>(".local-reader-markdown-syntax");
      const codeFence = reader.querySelector<HTMLElement>(".local-reader-markdown-block--codeFence");
      const headingStyle = heading ? getComputedStyle(heading) : undefined;
      const paragraphStyle = paragraph ? getComputedStyle(paragraph) : undefined;
      const codeStyle = codeLine ? getComputedStyle(codeLine) : undefined;
      const syntaxStyle = syntax ? getComputedStyle(syntax) : undefined;
      const codeFenceStyle = codeFence ? getComputedStyle(codeFence) : undefined;

      return {
        codeFenceHidden: codeFenceStyle?.position === "absolute" && codeFenceStyle.opacity === "0",
        codeLineMonospace: Boolean(codeStyle?.fontFamily.toLowerCase().includes("mono")),
        codeText: codeLine?.textContent ?? "",
        hasMarkdownRoot: Boolean(reader.querySelector(".local-reader-content--markdown")),
        headingFontWeight: Number.parseInt(headingStyle?.fontWeight ?? "0", 10),
        headingText: heading?.textContent ?? "",
        paragraphText: paragraph?.textContent ?? "",
        paragraphFontSize: Number.parseFloat(paragraphStyle?.fontSize ?? "0"),
        syntaxHidden: syntaxStyle?.position === "absolute" && syntaxStyle.opacity === "0"
      };
    });

    expect(markdownRenderState.hasMarkdownRoot).toBe(true);
    expect(markdownRenderState.headingText).toContain("第一节：阅读边界");
    expect(markdownRenderState.headingFontWeight).toBeGreaterThanOrEqual(700);
    expect(markdownRenderState.paragraphText).toContain("Markdown 导入在首版保持文本阅读模式");
    expect(markdownRenderState.paragraphFontSize).toBeGreaterThanOrEqual(16);
    expect(markdownRenderState.codeText).toContain("代码块标题不应进入目录");
    expect(markdownRenderState.codeLineMonospace).toBe(true);
    expect(markdownRenderState.syntaxHidden).toBe(true);
    expect(markdownRenderState.codeFenceHidden).toBe(true);

    await page.getByRole("button", { name: "目录", exact: true }).click();
    const outline = page.getByLabel("本地图书目录");
    await expect(outline).toBeVisible();
    await expect(outline.getByRole("button", { name: /第一节：阅读边界/ })).toBeVisible();
    await expect(outline.getByRole("button", { name: /第二节：划线与 AI/ })).toBeVisible();
    await expect(outline.getByRole("button", { name: /代码块标题不应进入目录/ })).toHaveCount(0);
  });

  test("Markdown 书籍支持划线、想法、AI 草稿和本地导出", async ({ page }) => {
    await openPreviewMarkdownReader(page);

    await selectReaderTextIn(page, "阅读设计笔记 正文", MARKDOWN_SELECTED_TEXT);
    const selectionToolbar = page.getByRole("toolbar", { name: "本地选中文本操作" });
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "划线" }).click();

    const highlight = page.locator(".local-reader-highlight").filter({
      hasText: MARKDOWN_SELECTED_TEXT
    });
    await expect(highlight).toBeVisible();
    await page.getByRole("tab", { name: "划线" }).click();
    await expect(page.getByRole("button", { name: /查看划线详情/ })).toContainText(
      MARKDOWN_SELECTED_TEXT
    );

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "写想法" })).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "写想法" }).click();
    const thoughtComposer = page.locator(".local-reader-thought-composer");
    await expect(thoughtComposer).toBeVisible();
    await page.getByPlaceholder("写下这段文字触发的想法").fill("Markdown 选区想法会随本地来源保存。");
    await thoughtComposer.getByRole("button", { name: "保存想法" }).click();
    await expect(thoughtComposer).toHaveCount(0);

    await page.getByRole("tab", { name: "想法" }).click();
    await expect(page.getByRole("button", { name: /查看想法详情/ })).toContainText(
      "Markdown 选区想法会随本地来源保存。"
    );

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "问 AI" })).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "问 AI" }).click();
    const aiPanel = page.getByRole("form", { name: "AI 提问面板" });
    await expect(aiPanel).toBeVisible();
    await page.getByLabel("AI 提问内容").fill("这段 Markdown 选区应该如何继续整理？");
    await aiPanel.getByRole("button", { name: "保存记录" }).click();

    await expect(page.getByRole("tab", { name: "AI 提问" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toContainText(
      "这段 Markdown 选区应该如何继续整理？"
    );

    const download = await downloadLocalReaderMarks(page);
    expect(download.suggestedFilename()).toBe("阅读设计笔记-本地标记.md");

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdown = await readFile(downloadPath!, "utf-8");
    expect(markdown).toContain("format: markdown");
    expect(markdown).toContain("- 格式：Markdown");
    expect(markdown).toContain(MARKDOWN_SELECTED_TEXT);
    expect(markdown).toContain("Markdown 选区想法会随本地来源保存。");
    expect(markdown).toContain("这段 Markdown 选区应该如何继续整理？");
  });

  test("目录浮层可识别章节并跳转正文位置", async ({ page }) => {
    await openPreviewLocalReader(page);

    await page.getByRole("button", { name: "目录", exact: true }).click();
    const outline = page.getByLabel("本地图书目录");
    await expect(outline).toBeVisible();
    await expect(outline.getByRole("button", { name: /第一章/ })).toBeVisible();
    await expect(outline.getByRole("button", { name: /第二章/ })).toBeVisible();
    await expect(outline.getByRole("button", { name: /第三章/ })).toBeVisible();

    const reader = page.getByLabel("小王子 正文");
    const beforeScrollTop = await reader.evaluate((element) => element.scrollTop);
    await outline.getByRole("button", { name: /第三章/ }).click();

    await expect(outline).toHaveCount(0);
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      beforeScrollTop + 40
    );
  });

  test("书内搜索可定位正文并标记当前命中", async ({ page }) => {
    await openPreviewLocalReader(page);

    const reader = page.getByLabel("小王子 正文");
    const beforeScrollTop = await reader.evaluate((element) => element.scrollTop);
    const searchPanel = await openLocalReaderSearch(page);
    await expect(searchPanel).toContainText("书内搜索");
    await page.getByLabel("搜索正文").fill("本地版本");
    await searchPanel.getByRole("button", { name: "定位" }).click();

    await expect(searchPanel).toContainText("1 / 1");
    await expect(page.locator(".local-reader-search-hit")).toContainText("本地版本");
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      beforeScrollTop + 40
    );
  });

  test("Escape 可关闭阅读器临时浮层", async ({ page }) => {
    await seedLocalHighlight(page, SELECTED_TEXT);
    await openPreviewLocalReader(page);

    await page.getByRole("button", { name: "目录", exact: true }).click();
    await expect(page.getByLabel("本地图书目录")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("本地图书目录")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "目录", exact: true })).toBeFocused();

    await openLocalReaderSearch(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("form", { name: "更多阅读工具" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开更多工具" })).toBeFocused();

    const highlight = page.locator(".local-reader-highlight").first();
    await highlight.click();
    const selectionToolbar = page.getByRole("toolbar", { name: "本地选中文本操作" });
    await expect(selectionToolbar).toBeVisible();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(selectionToolbar).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "写想法" }).click();
    await expect(page.locator(".local-reader-thought-composer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".local-reader-thought-composer")).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "问 AI" }).click();
    await expect(page.getByRole("form", { name: "AI 提问面板" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("form", { name: "AI 提问面板" })).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await selectReaderText(page, "清晨的第一缕阳光透过窗帘");
    await expect(selectionToolbar).toBeVisible();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(selectionToolbar).toHaveCount(0);
    await expect(page.getByLabel("小王子 正文")).toBeFocused();
  });

  test("点击关闭或取消临时浮层后恢复到阅读触发点", async ({ page }) => {
    await seedLocalHighlight(page, SELECTED_TEXT);
    await openPreviewLocalReader(page);

    const searchPanel = await openLocalReaderSearch(page);
    await searchPanel.getByRole("button", { name: "关闭书内搜索" }).click();
    await expect(searchPanel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开更多工具" })).toBeFocused();

    const highlight = page.locator(".local-reader-highlight").first();
    const selectionToolbar = page.getByRole("toolbar", { name: "本地选中文本操作" });

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "写想法" }).click();
    await expect(page.locator(".local-reader-thought-composer")).toBeVisible();
    await page.locator(".local-reader-thought-composer").getByRole("button", { name: "取消" }).click();
    await expect(page.locator(".local-reader-thought-composer")).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "问 AI" }).click();
    const aiComposer = page.getByRole("form", { name: "AI 提问面板" });
    await expect(aiComposer).toBeVisible();
    await aiComposer.getByRole("button", { name: "关闭 AI 提问面板" }).click();
    await expect(aiComposer).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await highlight.click();
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "问 AI" }).click();
    await expect(aiComposer).toBeVisible();
    await aiComposer.getByRole("button", { name: "取消" }).click();
    await expect(aiComposer).toHaveCount(0);
    await expect(highlight).toBeFocused();

    await selectReaderText(page, "清晨的第一缕阳光透过窗帘");
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeFocused();
    await selectionToolbar.getByRole("button", { name: "写想法" }).click();
    await expect(page.locator(".local-reader-thought-composer")).toBeVisible();
    await page.locator(".local-reader-thought-composer").getByRole("button", { name: "取消" }).click();
    await expect(page.locator(".local-reader-thought-composer")).toHaveCount(0);
    await expect(page.getByLabel("小王子 正文")).toBeFocused();
  });

  test("选区工具条可复制当前原文片段", async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_READER_ORIGIN
    });
    await seedLocalThought(page, LONG_THOUGHT);
    await openPreviewLocalReader(page);

    await page.locator(".local-reader-highlight").click();
    const selectionToolbar = page.getByRole("toolbar", { name: "本地选中文本操作" });
    await expect(selectionToolbar.getByRole("button", { name: "划线" })).toBeVisible();
    await expect(selectionToolbar.getByRole("button", { name: "标记" })).toBeVisible();
    await expect(selectionToolbar.getByRole("button", { name: "疑问" })).toBeVisible();
    await expect(selectionToolbar.getByRole("button", { name: "重点" })).toHaveCount(0);
    await expect(
      page.getByLabel("选区相关想法").getByRole("button", {
        name: /查看选区想法详情/
      })
    ).toBeVisible();
    await selectionToolbar.getByRole("button", {
      name: "复制"
    }).click();

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      SELECTED_TEXT
    );
  });

  test("选区浮层关联卡片长文本不撑开面板或越过视口", async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 560 });
    await seedSelectionPopoverRelatedRecords(page);
    await openPreviewLocalReader(page);

    await page.locator(".local-reader-highlight").click();
    const selectionPopover = page.locator(".local-reader-selection-popover");
    await expect(selectionPopover).toBeVisible();
    await expect(selectionPopover).toHaveClass(/has-thoughts/);

    const thoughtGroup = page.getByLabel("选区相关想法");
    const aiGroup = page.getByLabel("选区相关 AI 提问");
    await expect(
      thoughtGroup.getByRole("button", { name: /查看选区想法详情/ })
    ).toHaveCount(2);
    await expect(
      aiGroup.getByRole("button", { name: /查看选区 AI 提问详情/ })
    ).toHaveCount(2);

    const popoverMetrics = await selectionPopover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const groups = Array.from(
        element.querySelectorAll<HTMLElement>(".local-reader-selection-thoughts")
      ).map((group) => {
        const groupRect = group.getBoundingClientRect();
        const cards = Array.from(
          group.querySelectorAll<HTMLElement>(".local-reader-selection-thought-card")
        ).map((card) => ({
          clientWidth: card.clientWidth,
          height: Math.round(card.getBoundingClientRect().height),
          scrollWidth: card.scrollWidth
        }));

        return {
          clientHeight: group.clientHeight,
          clientWidth: group.clientWidth,
          height: Math.round(groupRect.height),
          overflowY: getComputedStyle(group).overflowY,
          scrollHeight: group.scrollHeight,
          scrollWidth: group.scrollWidth,
          cards
        };
      });

      return {
        bottom: Math.round(rect.bottom),
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollWidth: element.scrollWidth,
        viewportHeight: window.innerHeight,
        groups
      };
    });

    expect(popoverMetrics.height).toBeLessThanOrEqual(420);
    expect(popoverMetrics.bottom).toBeLessThanOrEqual(popoverMetrics.viewportHeight - 12);
    expect(popoverMetrics.scrollWidth).toBeLessThanOrEqual(popoverMetrics.clientWidth + 1);
    expect(popoverMetrics.groups).toHaveLength(2);
    for (const group of popoverMetrics.groups) {
      expect(group.height).toBeLessThanOrEqual(176);
      expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
      expect(group.overflowY).toBe("auto");
      expect(group.scrollHeight).toBeGreaterThanOrEqual(group.clientHeight);
      for (const card of group.cards) {
        expect(card.height).toBeLessThanOrEqual(58);
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      }
    }

    const firstThoughtCard = thoughtGroup.getByRole("button", {
      name: /查看选区想法详情/
    });
    await firstThoughtCard.nth(0).click();
    await expect(page.locator(".local-reader-thought-modal-panel")).toBeVisible();
    await expect(page.locator(".local-reader-thought-modal-panel")).toContainText(
      "选区浮层想法 0"
    );
  });

  test("暗色模式下阅读器容器和选区浮层保持一致暗底", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await setDarkUserPreferences(page);
    await seedSelectionPopoverRelatedRecords(page);
    await openPreviewLocalReader(page);

    await expect(page.locator(".app-frame")).toHaveAttribute("data-effective-theme", "dark");

    const surfaceMetrics = await page.evaluate(() => {
      const readSurface = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return undefined;
        }

        const style = getComputedStyle(element);
        return {
          backgroundLightness: getCssColorLightness(style.backgroundColor),
          colorLightness: getCssColorLightness(style.color)
        };
      };

      function getCssColorLightness(color: string) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) {
          return 255;
        }

        return (
          Number(match[1]) * 0.2126 +
          Number(match[2]) * 0.7152 +
          Number(match[3]) * 0.0722
        );
      }

      return {
        documentOverflowX:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentPane: readSurface(".local-reader-document"),
        header: readSurface(".local-reader-header"),
        inspector: readSurface(".local-reader-inspector"),
        statusbar: readSurface(".local-reader-statusbar"),
        toolbarButton: readSurface(".local-reader-toolbar button")
      };
    });

    expect(surfaceMetrics.documentOverflowX).toBeLessThanOrEqual(1);
    for (const key of ["documentPane", "header", "inspector", "statusbar", "toolbarButton"] as const) {
      expect(surfaceMetrics[key]?.backgroundLightness).toBeLessThan(72);
      expect(surfaceMetrics[key]?.colorLightness).toBeGreaterThan(110);
    }

    await page.locator(".local-reader-highlight").click();
    const selectionPopover = page.locator(".local-reader-selection-popover");
    await expect(selectionPopover).toBeVisible();
    await expect(page.getByLabel("选区相关想法")).toBeVisible();
    await expect(page.getByLabel("选区相关 AI 提问")).toBeVisible();

    const popoverMetrics = await selectionPopover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollWidth: element.scrollWidth,
        viewportHeight: window.innerHeight
      };
    });

    expect(popoverMetrics.height).toBeLessThanOrEqual(420);
    expect(popoverMetrics.bottom).toBeLessThanOrEqual(popoverMetrics.viewportHeight - 12);
    expect(popoverMetrics.scrollWidth).toBeLessThanOrEqual(popoverMetrics.clientWidth + 1);
  });

  test("详情弹窗可复制原文和想法，长文本不撑开卡片", async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_READER_ORIGIN
    });
    await seedLocalThought(page, LONG_THOUGHT);
    await openPreviewLocalReader(page);

    await page.getByRole("tab", { name: "想法" }).click();
    const thoughtItem = page.locator(".local-reader-thought-list li").filter({
      hasText: "这条想法用于验证详情弹窗"
    });
    const thoughtCard = thoughtItem.locator(".local-reader-thought-card");
    await expect(thoughtCard).toBeVisible();
    await expect(thoughtCard).toHaveAttribute("aria-label", /查看想法详情/);

    const cardMetrics = await thoughtItem.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const card = element.querySelector(".local-reader-thought-card");
      const deleteButton = element.querySelector(".local-reader-thought-delete")?.getBoundingClientRect();
      const note = element.querySelector(".local-reader-thought-card p");
      const date = element.querySelector(".local-reader-thought-card small");

      return {
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollWidth: element.scrollWidth,
        cardMetrics: card
          ? {
              clientWidth: card.clientWidth,
              scrollWidth: card.scrollWidth
            }
          : undefined,
        deleteInside:
          Boolean(deleteButton) &&
          deleteButton!.top >= rect.top &&
          deleteButton!.right <= rect.right &&
          deleteButton!.bottom <= rect.bottom,
        noteMetrics: note
          ? {
              clientWidth: note.clientWidth,
              scrollWidth: note.scrollWidth
            }
          : undefined,
        dateMetrics: date
          ? {
              clientWidth: date.clientWidth,
              scrollWidth: date.scrollWidth
            }
          : undefined
      };
    });
    expect(cardMetrics.scrollWidth).toBeLessThanOrEqual(cardMetrics.clientWidth + 1);
    expect(cardMetrics.cardMetrics?.scrollWidth).toBeLessThanOrEqual(
      (cardMetrics.cardMetrics?.clientWidth ?? 0) + 1
    );
    expect(cardMetrics.height).toBeLessThanOrEqual(98);
    expect(cardMetrics.deleteInside).toBe(true);
    expect(cardMetrics.noteMetrics?.scrollWidth).toBeLessThanOrEqual(
      (cardMetrics.noteMetrics?.clientWidth ?? 0) + 1
    );
    expect(cardMetrics.dateMetrics?.scrollWidth).toBeLessThanOrEqual(
      (cardMetrics.dateMetrics?.clientWidth ?? 0) + 1
    );

    await thoughtCard.click();
    await expect(page.locator(".local-reader-thought-modal-panel")).toBeVisible();
    await expect(thoughtItem).toHaveClass(/is-active/);
    await expect(thoughtItem).toHaveAttribute("aria-current", "location");
    await expectCurrentSidebarItemStyle(thoughtItem, 98);

    const copyButtons = page.locator(".local-reader-thought-modal-copy");
    await expect(copyButtons).toHaveCount(2);

    await copyButtons.nth(0).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(SELECTED_TEXT);

    await copyButtons.nth(1).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(LONG_THOUGHT);

    const modalMetrics = await page.locator(".local-reader-thought-modal-panel").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        width: Math.round(rect.width)
      };
    });
    expect(modalMetrics.width).toBeLessThanOrEqual(720);
    expect(modalMetrics.height).toBeLessThanOrEqual(760);

    const contentMetrics = await page.locator(".local-reader-thought-modal-content").evaluateAll((elements) =>
      elements.map((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }))
    );
    expect(contentMetrics).toHaveLength(2);
    for (const item of contentMetrics) {
      expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
    }

    await page
      .locator(".local-reader-thought-modal-panel")
      .getByRole("button", { name: "定位原文" })
      .click();
    await expect(page.locator(".local-reader-highlight.is-revealed")).toContainText(SELECTED_TEXT);
    await expect(thoughtItem).toHaveClass(/is-revealed/);
    await expect(thoughtItem).toHaveAttribute("aria-current", "location");
    await expectCurrentSidebarItemStyle(thoughtItem, 98);
  });

  test("划线侧栏卡片点击后以详情弹窗展示完整内容", async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_READER_ORIGIN
    });
    await seedLocalHighlight(page, LONG_HIGHLIGHT);
    await openPreviewLocalReader(page);

    const highlightItem = page.locator(".local-reader-highlight-list li").filter({
      hasText: "这条想法用于验证详情弹窗"
    });
    const highlightCard = highlightItem.locator(".local-reader-highlight-card");
    await expect(highlightCard).toBeVisible();

    const cardMetrics = await highlightCard.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollWidth: element.scrollWidth
      };
    });
    expect(cardMetrics.scrollWidth).toBeLessThanOrEqual(cardMetrics.clientWidth + 1);
    expect(cardMetrics.height).toBeLessThanOrEqual(96);

    await highlightCard.click();
    const modal = page.locator(".local-reader-highlight-modal-panel");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(LONG_HIGHLIGHT);
    await expect(modal).toContainText("不会写回微信读书");

    const modalMetrics = await modal.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        width: Math.round(rect.width)
      };
    });
    expect(modalMetrics.width).toBeLessThanOrEqual(640);
    expect(modalMetrics.height).toBeLessThanOrEqual(760);

    const contentMetrics = await page
      .locator(".local-reader-highlight-modal-panel .local-reader-thought-modal-content")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        }))
      );
    expect(contentMetrics.length).toBeGreaterThanOrEqual(1);
    for (const item of contentMetrics) {
      expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
    }

    await modal.getByRole("button", { name: "复制" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      LONG_HIGHLIGHT
    );

    await modal.getByRole("button", { name: "设为疑问" }).click();
    await expect(modal.getByRole("button", { name: "疑问" })).toBeVisible();
    await expect(modal).toContainText("疑问");

    await modal.getByRole("button", { name: "写想法" }).click();
    const thoughtComposer = page.locator(".local-reader-thought-composer");
    await expect(thoughtComposer).toBeVisible();
    await page.getByPlaceholder("写下这段文字触发的想法").fill("从划线详情补充一条想法");
    await thoughtComposer.getByRole("button", { name: "保存想法" }).click();
    await expect(thoughtComposer).toHaveCount(0);

    await highlightCard.click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "问 AI" }).click();
    const aiPanel = page.getByRole("form", { name: "AI 提问面板" });
    await expect(aiPanel).toBeVisible();
    await page.getByLabel("AI 提问内容").fill("这条划线应该如何理解？");
    await aiPanel.getByRole("button", { name: "保存记录" }).click();
    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toContainText(
      "这条划线应该如何理解？"
    );

    await page.getByRole("tab", { name: "划线" }).click();
    await highlightCard.click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "定位原文" }).click();
    await expect(page.locator(".local-reader-highlight.is-revealed")).toContainText(SELECTED_TEXT);
    await expect(highlightItem).toHaveClass(/is-revealed/);
    await expect(highlightItem).toHaveAttribute("aria-current", "location");
    await expectCurrentSidebarItemStyle(highlightItem, 116);

    await highlightItem.locator(".local-reader-highlight-delete").click();
    await expect(highlightItem).toHaveClass(/is-delete-pending/);
    await expect(page.locator(".local-reader-highlight-modal-panel")).toHaveCount(0);

    await highlightCard.click();
    await expect(modal).toBeVisible();
    await expect(highlightItem).not.toHaveClass(/is-delete-pending/);

    await modal.getByRole("button", { name: "删除划线" }).click();
    await expect(modal.getByRole("button", { name: "确认删除" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(highlightItem).not.toHaveClass(/is-delete-pending/);

    await highlightCard.click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "删除划线" }).click();
    await modal.getByRole("button", { name: "确认删除" }).click();
    await expect(page.locator(".local-reader-highlight-list li")).toHaveCount(0);
  });

  test("问 AI 会在正文附近保存提问记录并展示本地边界", async ({ page }) => {
    await seedLocalThought(page, LONG_THOUGHT);
    await openPreviewLocalReader(page);

    await page.locator(".local-reader-highlight").click();
    await page.getByRole("toolbar", { name: "本地选中文本操作" }).getByRole("button", {
      name: "问 AI"
    }).click();

    const aiPanel = page.getByRole("form", { name: "AI 提问面板" });
    await expect(aiPanel).toBeVisible();
    await page.getByLabel("AI 提问内容").fill("这段话的核心设计原则是什么？");
    await aiPanel.getByRole("button", { name: "保存记录" }).click();

    const savedDraftToast = page.locator(".toast-card").filter({
      hasText: "已保存 AI 提问记录"
    });
    await expect(savedDraftToast).toContainText("当前不会请求模型");
    await expect(savedDraftToast).not.toContainText("等待模型接入后发送");
    await expect(page.getByRole("tab", { name: "AI 提问" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("button", { name: "本书想法" })).toHaveCount(0);
    const aiItem = page.locator(".local-reader-ai-list li").filter({
      hasText: "这段话的核心设计原则是什么？"
    });
    const aiCard = aiItem.getByRole("button", { name: /查看 AI 提问详情/ });
    await expect(aiCard).toContainText("这段话的核心设计原则是什么？");
    await expect(aiCard).toContainText("草稿");
    await expect(aiCard).toContainText(SELECTED_TEXT);
    await expect(page.getByRole("button", { name: "赞同回答" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "不赞同回答" })).toHaveCount(0);
    await expect(page.getByLabel("AI 提问列表")).not.toContainText("AI 回答");
    await expect(page.getByLabel("AI 提问列表")).not.toContainText("AI 接入后");

    await aiCard.click();
    await expect(aiItem).toHaveClass(/is-active/);
    await expect(aiItem).toHaveAttribute("aria-current", "location");
    await expectCurrentSidebarItemStyle(aiItem, 168);
    const aiModal = page.getByRole("dialog", { name: /AI 提问详情/ });
    await expect(aiModal).toContainText("这段话的核心设计原则是什么？");
    await expect(aiModal).toContainText("草稿");
    await expect(aiModal).toContainText("用户问题");
    await expect(aiModal).not.toContainText("AI 回答");
    await aiModal.getByRole("button", { name: "继续追问" }).click();

    const followUpPanel = page.getByRole("form", { name: "AI 提问面板" });
    await expect(followUpPanel).toBeVisible();
    await expect(followUpPanel).toContainText("继续追问");
    await page.getByLabel("AI 提问内容").fill("这个追问应该留在同一条记录里吗？");
    await followUpPanel.getByRole("button", { name: "保存追问" }).click();

    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toHaveCount(1);
    await expect(aiCard).toContainText("2 轮");
    const aiModalAfterFollowUp = page.getByRole("dialog", { name: /AI 提问详情/ });
    await expect(aiModalAfterFollowUp).toContainText("追问线程");
    await expect(aiModalAfterFollowUp).toContainText("这个追问应该留在同一条记录里吗？");
    await page.keyboard.press("Escape");
    await expect(aiModalAfterFollowUp).toHaveCount(0);

    await openPreviewLocalReader(page);
    await page.locator(".local-reader-highlight").click();
    await expect(
      page.getByLabel("选区相关 AI 提问").getByRole("button", {
        name: /查看选区 AI 提问详情/
      })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "AI 提问" }).click();
    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toContainText(
      "这段话的核心设计原则是什么？"
    );

    await page.getByRole("button", { name: /定位 AI 提问原文/ }).click();
    await expect(page.locator(".local-reader-highlight.is-revealed")).toContainText(SELECTED_TEXT);
    await expect(aiItem).toHaveClass(/is-revealed/);
    await expect(aiItem).toHaveAttribute("aria-current", "location");
    await expectCurrentSidebarItemStyle(aiItem, 168);

    await page.getByRole("button", { name: /删除 AI 提问/ }).click();
    await page.getByRole("button", { name: /确认删除 AI 提问/ }).click();
    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toHaveCount(0);
    await expect(page.getByLabel("AI 提问空态")).toContainText("暂无 AI 提问记录");
    await expect(page.getByLabel("AI 提问列表")).not.toContainText("AI 接入后");

    await openPreviewLocalReader(page);
    await page.getByRole("tab", { name: "AI 提问" }).click();
    await expect(page.getByRole("button", { name: /查看 AI 提问详情/ })).toHaveCount(0);
  });

  test("可将当前本地划线和想法导出为 Markdown", async ({ page }) => {
    await seedLocalThought(page, LONG_THOUGHT);
    await openPreviewLocalReader(page);

    await page.locator(".local-reader-highlight").click();
    await page.getByRole("toolbar", { name: "本地选中文本操作" }).getByRole("button", {
      name: "问 AI"
    }).click();
    const aiPanel = page.getByRole("form", { name: "AI 提问面板" });
    await expect(aiPanel).toBeVisible();
    await page.getByLabel("AI 提问内容").fill("这段话可以怎么继续思考？");
    await aiPanel.getByRole("button", { name: "保存记录" }).click();

    const download = await downloadLocalReaderMarks(page);
    expect(download.suggestedFilename()).toBe("小王子-本地标记.md");

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdown = await readFile(downloadPath!, "utf-8");
    expect(markdown).toContain("source: local-reader");
    expect(markdown).toContain("source_kind: local");
    expect(markdown).toContain("仅包含本地阅读器划线、想法和 AI 提问记录，不读取微信读书笔记，不触发 AI");
    expect(markdown).toContain(SELECTED_TEXT);
    expect(markdown).toContain(LONG_THOUGHT);
    expect(markdown).toContain("## AI 提问记录");
    expect(markdown).toContain("这段话可以怎么继续思考？");
    expect(markdown).toContain("仅导出本地 AI 提问记录，不读取微信读书笔记，不触发新的 AI 请求");
  });

  test("只有 AI 提问记录时也可导出 Markdown", async ({ page }) => {
    await seedLocalAiQuestionDraft(page, "这条草稿需要单独导出吗？");
    await openPreviewLocalReader(page);

    const download = await downloadLocalReaderMarks(page);
    expect(download.suggestedFilename()).toBe("小王子-本地标记.md");

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdown = await readFile(downloadPath!, "utf-8");
    expect(markdown).toContain("暂无本地划线。");
    expect(markdown).toContain("暂无本地想法。");
    expect(markdown).toContain("## AI 提问记录");
    expect(markdown).toContain("这条草稿需要单独导出吗？");
    expect(markdown).toContain("仅导出本地 AI 提问记录，不读取微信读书笔记，不触发新的 AI 请求");
    expect(markdown).not.toContain(LONG_THOUGHT);
  });

  test("AI 提问侧栏长文本不撑开卡片或遮挡操作按钮", async ({ page }) => {
    await seedLocalAiQuestionRecord(page, LONG_AI_QUESTION);
    await openPreviewLocalReader(page);

    await page.getByRole("tab", { name: "AI 提问" }).click();
    const aiItem = page.locator(".local-reader-ai-list li").filter({
      hasText: "这条 AI 提问用于验证侧栏卡片边界"
    });
    await expect(aiItem).toBeVisible();

    const cardMetrics = await aiItem.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const actions = element.querySelector(".local-reader-ai-card-actions")?.getBoundingClientRect();
      const question = element.querySelector(".local-reader-ai-card p");
      const questionMetrics = question
        ? {
            clientWidth: question.clientWidth,
            scrollWidth: question.scrollWidth
          }
        : undefined;

      return {
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollWidth: element.scrollWidth,
        actionsInside:
          Boolean(actions) &&
          actions!.top >= rect.top &&
          actions!.right <= rect.right &&
          actions!.bottom <= rect.bottom,
        questionMetrics
      };
    });

    expect(cardMetrics.scrollWidth).toBeLessThanOrEqual(cardMetrics.clientWidth + 1);
    expect(cardMetrics.height).toBeLessThanOrEqual(168);
    expect(cardMetrics.actionsInside).toBe(true);
    expect(cardMetrics.questionMetrics?.scrollWidth).toBeLessThanOrEqual(
      (cardMetrics.questionMetrics?.clientWidth ?? 0) + 1
    );
  });

  test("AI 追问线程长列表在详情内局部滚动", async ({ page }) => {
    await seedLocalAiQuestionRecord(
      page,
      "这段话的核心设计原则是什么？",
      Array.from({ length: 10 }, (_, index) => ({
        id: `e2e-local-reader-ai-thread-${index + 1}`,
        question: `第 ${index + 1} 个追问是否仍归入同一条 AI 提问记录？`,
        status: "draft",
        createdAt: `2026-05-27T12:${String(index + 1).padStart(2, "0")}:00.000Z`,
        updatedAt: `2026-05-27T12:${String(index + 1).padStart(2, "0")}:00.000Z`
      }))
    );
    await openPreviewLocalReader(page);

    await page.getByRole("tab", { name: "AI 提问" }).click();
    const aiCard = page.getByRole("button", { name: /查看 AI 提问详情/ });
    await expect(aiCard).toContainText("11 轮");
    await aiCard.click();

    const aiModal = page.getByRole("dialog", { name: /AI 提问详情/ });
    await expect(aiModal).toContainText("追问线程");
    await expect(aiModal).toContainText("10 条追问");

    const threadMetrics = await page.locator(".local-reader-ai-thread-list").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        height: Math.round(rect.height),
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth
      };
    });
    expect(threadMetrics.height).toBeLessThanOrEqual(320);
    expect(threadMetrics.scrollHeight).toBeGreaterThan(threadMetrics.clientHeight);
    expect(threadMetrics.scrollWidth).toBeLessThanOrEqual(threadMetrics.clientWidth + 1);

    const modalMetrics = await page.locator(".local-reader-ai-modal-panel").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth
      };
    });
    expect(modalMetrics.width).toBeLessThanOrEqual(380);
    expect(modalMetrics.scrollWidth).toBeLessThanOrEqual(modalMetrics.clientWidth + 1);
  });

  test("侧栏多记录列表保持内部滚动且不留下大块死区", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await seedDenseLocalReaderSidebarRecords(page);
    await openPreviewLocalReader(page);

    await expectSidebarListToFillPanel(page, "划线", ".local-reader-highlight-list", 92);
    await expectSidebarListToFillPanel(page, "想法", ".local-reader-thought-list", 98);
    await expectSidebarListToFillPanel(page, "AI 提问", ".local-reader-ai-list", 168);

    const pageMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth + 1);
  });

  test("删除确认态在编辑和关闭详情时会被清理", async ({ page }) => {
    await seedLocalThought(page, LONG_THOUGHT);
    await openPreviewLocalReader(page);

    await page.getByRole("tab", { name: "想法" }).click();
    const thoughtItem = page.locator(".local-reader-thought-list li").filter({
      hasText: "这条想法用于验证详情弹窗"
    });

    await thoughtItem.locator(".local-reader-thought-delete").click();
    await expect(thoughtItem).toHaveClass(/is-delete-pending/);

    await thoughtItem.locator(".local-reader-thought-card").click();
    await expect(page.locator(".local-reader-thought-modal-panel")).toBeVisible();

    await page.getByRole("button", { name: "编辑想法" }).click();
    await expect(thoughtItem).not.toHaveClass(/is-delete-pending/);

    await page.keyboard.press("Escape");
    await expect(page.getByLabel("编辑想法内容")).toHaveCount(0);
    await expect(page.locator(".local-reader-thought-modal-panel")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".local-reader-thought-modal-panel")).toHaveCount(0);
    await expect(thoughtItem).not.toHaveClass(/is-delete-pending/);
  });

  test("本地书库和阅读器逐屏滚动视觉回归", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await openPreviewLocalLibrary(page);
    await auditVisualScroll(page, {
      id: "local-library",
      label: "本地书库",
      suite: "local-reader-desktop"
    });

    await page.getByRole("button", { name: /小王子 TXT/ }).click();
    await expect(page.getByLabel("本地阅读器")).toBeVisible();
    await auditVisualScroll(page, {
      id: "local-reader-document",
      label: "本地阅读器正文",
      scrollTarget: ".local-reader-document",
      suite: "local-reader-desktop"
    });
    await auditVisualScroll(page, {
      id: "local-reader-inspector",
      label: "本地阅读器侧栏",
      scrollTarget: ".local-reader-inspector-panel",
      suite: "local-reader-desktop"
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await openPreviewLocalLibrary(page);
    await auditVisualScroll(page, {
      id: "local-library",
      label: "本地书库窄屏",
      suite: "local-reader-narrow"
    });

    await page.getByRole("button", { name: /小王子 TXT/ }).click();
    await expect(page.getByLabel("本地阅读器")).toBeVisible();
    await auditVisualScroll(page, {
      id: "local-reader-document",
      label: "本地阅读器正文窄屏",
      scrollTarget: ".local-reader-document",
      suite: "local-reader-narrow"
    });
  });
});

async function seedLocalThought(page: Page, note: string) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const createdAt = "2026-05-27T12:00:00.000Z";
  const thought = {
    id: "e2e-local-reader-thought",
    bookId: BOOK_ID,
    selectedText: SELECTED_TEXT,
    note,
    startOffset,
    endOffset,
    createdAt
  };
  const highlight = {
    id: "e2e-local-reader-highlight",
    bookId: BOOK_ID,
    text: SELECTED_TEXT,
    startOffset,
    endOffset,
    tone: "yellow",
    createdAt
  };

  await page.addInitScript(
    ({ bookId, seededHighlight, seededThought }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.thoughts.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify([seededThought])
      );
      window.localStorage.setItem(
        `wxreadmaster.localReader.highlights.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify([seededHighlight])
      );
    },
    { bookId: BOOK_ID, seededHighlight: highlight, seededThought: thought }
  );
}

async function seedLocalAiQuestionDraft(page: Page, question: string) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const draft = {
    bookId: BOOK_ID,
    question,
    selectedText: SELECTED_TEXT,
    startOffset,
    endOffset,
    createdAt: "2026-05-27T12:00:00.000Z"
  };

  await page.addInitScript(
    ({ bookId, seededDraft }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.aiQuestionDraft.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededDraft)
      );
    },
    { bookId: BOOK_ID, seededDraft: draft }
  );
}

async function seedLocalAiQuestionRecord(page: Page, question: string, thread: unknown[] = []) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const createdAt = "2026-05-27T12:00:00.000Z";
  const record = {
    id: "e2e-local-reader-ai-question-record",
    bookId: BOOK_ID,
    source: "local",
    status: "draft",
    question,
    selectedText: SELECTED_TEXT,
    startOffset,
    endOffset,
    createdAt,
    updatedAt: thread.length
      ? "2026-05-27T12:30:00.000Z"
      : createdAt,
    ...(thread.length ? { thread } : {})
  };

  await page.addInitScript(
    ({ bookId, seededRecord }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.aiQuestionRecords.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify([seededRecord])
      );
    },
    { bookId: BOOK_ID, seededRecord: record }
  );
}

async function setDarkUserPreferences(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "wxreadmaster.userPreferences.v1",
      JSON.stringify({
        themeMode: "dark",
        fontScale: "normal",
        density: "comfortable",
        defaultStartPage: "dashboard",
        defaultNotesView: "list",
        defaultStatsPeriod: "monthly"
      })
    );
  });
}

async function selectReaderText(page: Page, text: string) {
  await selectReaderTextIn(page, "小王子 正文", text);
}

async function selectReaderTextIn(page: Page, readerLabel: string, text: string) {
  await page.getByLabel(readerLabel).evaluate((reader, selectedText) => {
    const contentRoot = reader.querySelector(".local-reader-content");
    if (!contentRoot) {
      throw new Error("阅读器正文节点不存在。");
    }

    const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
      const nodeText = currentNode.textContent ?? "";
      const startIndex = nodeText.indexOf(selectedText);
      if (startIndex >= 0) {
        const range = document.createRange();
        range.setStart(currentNode, startIndex);
        range.setEnd(currentNode, startIndex + selectedText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        reader.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }

      currentNode = walker.nextNode();
    }

    throw new Error(`阅读器正文缺少测试选区：${selectedText}`);
  }, text);
}

async function seedSelectionPopoverRelatedRecords(page: Page) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const highlight = {
    id: "e2e-selection-popover-highlight",
    bookId: BOOK_ID,
    text: SELECTED_TEXT,
    startOffset,
    endOffset,
    tone: "yellow",
    createdAt: "2026-05-27T12:00:00.000Z"
  };
  const thoughts = Array.from({ length: 2 }, (_, index) => ({
    id: `e2e-selection-popover-thought-${index}`,
    bookId: BOOK_ID,
    selectedText: SELECTED_TEXT,
    note: `选区浮层想法 ${index}：${LONG_THOUGHT}`,
    startOffset,
    endOffset,
    createdAt: `2026-05-27T13:0${index}:00.000Z`
  }));
  const aiQuestionRecords = Array.from({ length: 2 }, (_, index) => ({
    id: `e2e-selection-popover-ai-${index}`,
    bookId: BOOK_ID,
    source: "local",
    status: "draft",
    question: `选区浮层 AI 提问 ${index}：${LONG_AI_QUESTION}`,
    selectedText: SELECTED_TEXT,
    startOffset,
    endOffset,
    createdAt: `2026-05-27T14:0${index}:00.000Z`,
    updatedAt: `2026-05-27T14:0${index}:00.000Z`
  }));

  await page.addInitScript(
    ({ bookId, seededHighlight, seededThoughts, seededAiQuestionRecords }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.highlights.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify([seededHighlight])
      );
      window.localStorage.setItem(
        `wxreadmaster.localReader.thoughts.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededThoughts)
      );
      window.localStorage.setItem(
        `wxreadmaster.localReader.aiQuestionRecords.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededAiQuestionRecords)
      );
    },
    {
      bookId: BOOK_ID,
      seededHighlight: highlight,
      seededThoughts: thoughts,
      seededAiQuestionRecords: aiQuestionRecords
    }
  );
}

async function seedDenseLocalReaderSidebarRecords(page: Page) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const highlights = Array.from({ length: 12 }, (_, index) => ({
    id: `e2e-dense-highlight-${index}`,
    bookId: BOOK_ID,
    text: `${SELECTED_TEXT} dense-highlight-${index} averyveryverylongtoken_without_spaces_${index}`,
    startOffset,
    endOffset,
    tone: index % 3 === 0 ? "green" : index % 3 === 1 ? "yellow" : "blue",
    createdAt: `2026-05-27T12:${String(index).padStart(2, "0")}:00.000Z`
  }));
  const thoughts = Array.from({ length: 12 }, (_, index) => ({
    id: `e2e-dense-thought-${index}`,
    bookId: BOOK_ID,
    selectedText: SELECTED_TEXT,
    note: `密集想法 ${index}：${LONG_THOUGHT}`,
    startOffset,
    endOffset,
    createdAt: `2026-05-27T13:${String(index).padStart(2, "0")}:00.000Z`
  }));
  const aiQuestionRecords = Array.from({ length: 12 }, (_, index) => ({
    id: `e2e-dense-ai-${index}`,
    bookId: BOOK_ID,
    source: "local",
    status: "draft",
    question: `密集 AI 提问 ${index}：${LONG_AI_QUESTION}`,
    selectedText: SELECTED_TEXT,
    startOffset,
    endOffset,
    createdAt: `2026-05-27T14:${String(index).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-05-27T14:${String(index).padStart(2, "0")}:00.000Z`
  }));

  await page.addInitScript(
    ({ bookId, seededHighlights, seededThoughts, seededAiQuestionRecords }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.highlights.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededHighlights)
      );
      window.localStorage.setItem(
        `wxreadmaster.localReader.thoughts.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededThoughts)
      );
      window.localStorage.setItem(
        `wxreadmaster.localReader.aiQuestionRecords.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify(seededAiQuestionRecords)
      );
    },
    {
      bookId: BOOK_ID,
      seededHighlights: highlights,
      seededThoughts: thoughts,
      seededAiQuestionRecords: aiQuestionRecords
    }
  );
}

async function expectSidebarListToFillPanel(
  page: Page,
  tabName: "划线" | "想法" | "AI 提问",
  listSelector: string,
  maxCardHeight: number
) {
  await page.getByRole("tab", { name: tabName }).click();
  const list = page.locator(listSelector);
  await expect(list).toBeVisible();

  const metrics = await list.evaluate((element) => {
    const listRect = element.getBoundingClientRect();
    const sectionRect = element.closest(".local-reader-inspector-section")?.getBoundingClientRect();
    const items = Array.from(element.querySelectorAll("li"));
    const itemRects = items.map((item) => item.getBoundingClientRect());

    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      itemCount: items.length,
      listBottom: Math.round(listRect.bottom),
      listTop: Math.round(listRect.top),
      maxItemHeight: Math.max(...itemRects.map((rect) => Math.round(rect.height))),
      minItemHeight: Math.min(...itemRects.map((rect) => Math.round(rect.height))),
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      sectionBottom: sectionRect ? Math.round(sectionRect.bottom) : 0
    };
  });

  expect(metrics.itemCount).toBeGreaterThanOrEqual(12);
  expect(metrics.clientHeight).toBeGreaterThan(420);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.overflowY).toBe("auto");
  expect(metrics.maxItemHeight).toBeLessThanOrEqual(maxCardHeight);
  expect(metrics.minItemHeight).toBeGreaterThan(40);
  expect(Math.abs(metrics.sectionBottom - metrics.listBottom)).toBeLessThanOrEqual(2);
}

async function expectCurrentSidebarItemStyle(item: Locator, maxHeight: number) {
  const metrics = await item.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const afterStyle = getComputedStyle(element, "::after");

    return {
      afterBackgroundColor: afterStyle.backgroundColor,
      afterWidth: afterStyle.width,
      boxShadow: style.boxShadow,
      clientWidth: element.clientWidth,
      height: Math.round(rect.height),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      scrollWidth: element.scrollWidth
    };
  });

  expect(metrics.height).toBeLessThanOrEqual(maxHeight);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.outlineStyle).toBe("solid");
  expect(Number.parseFloat(metrics.outlineWidth)).toBeGreaterThanOrEqual(1);
  expect(metrics.boxShadow).toContain("inset");
  expect(Number.parseFloat(metrics.afterWidth)).toBeGreaterThanOrEqual(3);
  expect(metrics.afterBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
}

async function downloadLocalReaderMarks(page: Page) {
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const exportAction = page.getByRole("button", { name: "导出 Markdown", exact: true });
  await expect(exportAction).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), exportAction.click()]);
  return download;
}

async function openLocalReaderSearch(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "打开更多工具" }).click();
  const searchPanel = page.getByRole("form", { name: "更多阅读工具" });
  await expect(searchPanel).toBeVisible();
  return searchPanel;
}

async function seedLocalHighlight(page: Page, text: string) {
  const startOffset = PREVIEW_TEXT.indexOf(SELECTED_TEXT);
  if (startOffset < 0) {
    throw new Error("本地阅读器预览正文缺少测试选区。");
  }

  const endOffset = startOffset + SELECTED_TEXT.length;
  const highlight = {
    id: "e2e-local-reader-long-highlight",
    bookId: BOOK_ID,
    text,
    startOffset,
    endOffset,
    tone: "yellow",
    createdAt: "2026-05-27T12:00:00.000Z"
  };

  await page.addInitScript(
    ({ bookId, seededHighlight }) => {
      window.localStorage.setItem(
        `wxreadmaster.localReader.highlights.v1:${encodeURIComponent(bookId)}`,
        JSON.stringify([seededHighlight])
      );
    },
    { bookId: BOOK_ID, seededHighlight: highlight }
  );
}

async function openPreviewLocalReader(page: Page) {
  await gotoLocalReaderPreview(page);
  await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
  await page.getByLabel("书架子菜单").getByRole("button", { name: "本地书库" }).click();
  await page.getByRole("button", { name: /小王子 TXT/ }).click();
  await expect(page.getByLabel("本地阅读器")).toBeVisible();
  await expect(page.getByRole("heading", { name: "小王子" })).toBeVisible();
}

async function openPreviewMarkdownReader(page: Page) {
  await gotoLocalReaderPreview(page);
  await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
  await page.getByLabel("书架子菜单").getByRole("button", { name: "本地书库" }).click();
  await page.getByRole("button", { name: /阅读设计笔记 Markdown/ }).click();
  await expect(page.getByLabel("本地阅读器")).toBeVisible();
  await expect(page.getByRole("heading", { name: "阅读设计笔记" })).toBeVisible();
}

async function openPreviewLocalLibrary(page: Page) {
  await gotoLocalReaderPreview(page);
  const mobileTrigger = page.getByRole("button", { name: "打开主导航", exact: true });
  if (await mobileTrigger.isVisible()) {
    await mobileTrigger.click();
    await expect(page.locator(".sidebar")).toBeVisible();
  }

  await page.locator(".sidebar").getByRole("button", { name: "书架", exact: true }).click();
  await page.getByLabel("书架子菜单").getByRole("button", { name: "本地书库" }).click();
  await expect(page.getByLabel("本地书库")).toBeVisible();
}

async function gotoLocalReaderPreview(page: Page) {
  await page.goto(LOCAL_READER_URL, { waitUntil: "domcontentloaded" });
}
