import { mkdir } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

type VisualScrollIssue = {
  type: string;
  tag?: string;
  className?: string;
  text?: string;
  left?: number;
  right?: number;
  width?: number;
  viewportWidth?: number;
  overflow?: number;
};

export type VisualScrollAuditResult = {
  label: string;
  screenshotCount: number;
  scrollHeight: number;
  clientHeight: number;
  maxScrollTop: number;
};

type VisualScrollAuditOptions = {
  id: string;
  label: string;
  suite: string;
  scrollTarget?: string;
  screenshotRoot?: string;
};

const defaultScreenshotRoot = "test-results/visual-scroll";

export async function auditVisualScroll(
  page: Page,
  {
    id,
    label,
    suite,
    scrollTarget = ".workspace",
    screenshotRoot = defaultScreenshotRoot
  }: VisualScrollAuditOptions
): Promise<VisualScrollAuditResult> {
  const target = page.locator(scrollTarget).first();
  await expect(target, `${label} 滚动容器`).toBeVisible();

  const initialMetrics = await target.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("滚动目标不是 HTMLElement。");
    }

    element.scrollTo({ top: 0, left: 0 });
    element.dispatchEvent(new Event("scroll", { bubbles: true }));

    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    };
  });

  const positions = buildScrollPositions(
    initialMetrics.scrollHeight,
    initialMetrics.clientHeight
  );
  const suiteDirectory = `${screenshotRoot}/${sanitizePathSegment(suite)}`;
  await mkdir(suiteDirectory, { recursive: true });

  for (const [index, position] of positions.entries()) {
    await target.evaluate((element, top) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      element.scrollTo({ top, left: 0 });
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, position);
    await page.waitForTimeout(80);

    const issues = await page.evaluate(collectVisibleLayoutIssues, scrollTarget);
    expect(issues, `${label} 第 ${index + 1}/${positions.length} 屏布局问题`).toEqual([]);

    await page.screenshot({
      animations: "disabled",
      fullPage: false,
      path: `${suiteDirectory}/${sanitizePathSegment(id)}-${String(index + 1).padStart(2, "0")}.png`
    });
  }

  return {
    label,
    screenshotCount: positions.length,
    scrollHeight: initialMetrics.scrollHeight,
    clientHeight: initialMetrics.clientHeight,
    maxScrollTop: Math.max(0, initialMetrics.scrollHeight - initialMetrics.clientHeight)
  };
}

function buildScrollPositions(scrollHeight: number, clientHeight: number) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (maxScrollTop === 0) {
    return [0];
  }

  const step = Math.max(220, Math.floor(clientHeight * 0.82));
  const positions = [0];
  for (let next = step; next < maxScrollTop; next += step) {
    positions.push(next);
  }
  positions.push(maxScrollTop);

  return Array.from(new Set(positions.map((position) => Math.round(position))));
}

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function collectVisibleLayoutIssues(scrollTargetSelector: string): VisualScrollIssue[] {
  const issues: VisualScrollIssue[] = [];
  const compact = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const isVisible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth
    );
  };

  const viewportWidth = document.documentElement.clientWidth;
  const rootOverflow = Math.ceil(document.documentElement.scrollWidth - viewportWidth);
  if (rootOverflow > 1) {
    issues.push({
      type: "root-horizontal-overflow",
      overflow: rootOverflow,
      viewportWidth
    });
  }

  const target = document.querySelector(scrollTargetSelector);
  if (!(target instanceof HTMLElement)) {
    issues.push({ type: "missing-scroll-target", text: scrollTargetSelector });
    return issues;
  }

  const targetOverflow = Math.ceil(target.scrollWidth - target.clientWidth);
  const targetOverflowX = getComputedStyle(target).overflowX;
  if (targetOverflow > 2 && targetOverflowX !== "auto" && targetOverflowX !== "scroll") {
    issues.push({
      type: "target-horizontal-overflow",
      className: target.className,
      overflow: targetOverflow,
      viewportWidth
    });
  }

  const targetRect = target.getBoundingClientRect();
  if (targetRect.right > viewportWidth + 2 || targetRect.left < -2) {
    issues.push({
      type: "scroll-target-outside-viewport",
      className: target.className,
      left: Math.round(targetRect.left),
      right: Math.round(targetRect.right),
      width: Math.round(targetRect.width),
      viewportWidth
    });
  }

  const boundarySelector = [
    "button",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='tab']",
    "[role='dialog']",
    "section[aria-label]",
    "article",
    "header",
    "footer"
  ].join(",");

  for (const element of Array.from(target.querySelectorAll(boundarySelector))) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (rect.right > viewportWidth + 2 || rect.left < -2) {
      issues.push({
        type: "visible-element-outside-viewport",
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: compact(element.textContent),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        viewportWidth
      });
    }
  }

  const textSelector = [
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "p",
    "strong",
    "small",
    "h1",
    "h2",
    "h3",
    "h4",
    "li",
    "dt",
    "dd"
  ].join(",");

  for (const element of Array.from(target.querySelectorAll(textSelector))) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      continue;
    }

    const style = getComputedStyle(element);
    const hasFloatingDescendant = Array.from(element.children).some((child) => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }
      return child.getAttribute("role") === "tooltip" || getComputedStyle(child).position === "absolute";
    });
    if (
      hasFloatingDescendant ||
      style.display === "inline" ||
      style.overflowX === "hidden" ||
      style.overflowX === "clip"
    ) {
      continue;
    }

    const overflow = Math.ceil(element.scrollWidth - element.clientWidth);
    if (element.clientWidth > 0 && overflow > 2) {
      issues.push({
        type: "text-horizontal-overflow",
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: compact(element.textContent),
        overflow
      });
    }
  }

  return issues.slice(0, 20);
}
