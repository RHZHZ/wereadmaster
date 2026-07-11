#!/usr/bin/env node
import { chromium } from "@playwright/test";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_PROVIDER_BASE_URL = "http://127.0.0.1:8787/v1";
const DEFAULT_MODEL = "mock-gpt";
const DEFAULT_API_KEY = "sk-local-mock-1234567890";
const DEFAULT_TIMEOUT_MS = 20_000;

const CASES = new Set(["normal-stream", "cancel", "provider-error"]);
const EXPECTED_SCENARIO_BY_CASE = {
  "normal-stream": "normal-stream",
  cancel: "slow-stream",
  "provider-error": "provider-error-json"
};

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!CASES.has(options.caseName)) {
  fail(`未知 case：${options.caseName}。支持：${Array.from(CASES).join(", ")}`);
}

let exitCode = 0;

try {
  await runQa(options);
} catch (error) {
  exitCode = 1;
  console.error(`[qa-ai-reading-assistant-desktop] 失败：${errorMessage(error)}`);
} finally {
  process.exit(exitCode);
}

async function runQa(config) {
  console.log("[qa-ai-reading-assistant-desktop] 开始");
  console.log(`[qa-ai-reading-assistant-desktop] CDP: ${config.cdpUrl}`);
  console.log(`[qa-ai-reading-assistant-desktop] Provider: ${config.providerBaseUrl}`);
  console.log(`[qa-ai-reading-assistant-desktop] Case: ${config.caseName}`);

  if (!config.skipHealthCheck) {
    await assertMockProviderHealth(config.providerBaseUrl, config.timeoutMs, config.caseName);
  }

  if (config.preflight) {
    await assertCdpReachable(config.cdpUrl, config.timeoutMs);
    console.log("[qa-ai-reading-assistant-desktop] preflight 通过，未修改应用设置，未发送助手消息");
    return;
  }

  const browser = await chromium.connectOverCDP(config.cdpUrl);
  const page = await resolveTauriPage(browser);
  page.setDefaultTimeout(config.timeoutMs);

  if (!config.skipConfigure) {
    await configureAiProvider(page, config);
  }

  if (config.caseName === "normal-stream") {
    await verifyNormalStream(page, config);
  } else if (config.caseName === "cancel") {
    await verifyCancel(page, config);
  } else if (config.caseName === "provider-error") {
    await verifyProviderError(page, config);
  }

  console.log("[qa-ai-reading-assistant-desktop] 通过");
}

async function assertMockProviderHealth(providerBaseUrl, timeoutMs, caseName) {
  const healthUrl = new URL("/health", providerBaseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetch(healthUrl, { signal: controller.signal });
    } catch (error) {
      fail(`mock provider 不可用：${healthUrl}，请先启动 scripts/mock-ai-provider.mjs。${errorMessage(error)}`);
    }
    if (!response.ok) {
      fail(`mock provider health check 失败：HTTP ${response.status}`);
    }

    const payload = await response.json();
    console.log(
      `[qa-ai-reading-assistant-desktop] mock provider health ok, scenario=${payload.scenario ?? "unknown"}`
    );
    const expectedScenario = EXPECTED_SCENARIO_BY_CASE[caseName];
    if (expectedScenario && payload.scenario !== expectedScenario) {
      fail(
        `当前 mock provider scenario=${payload.scenario ?? "unknown"}，但 case=${caseName} 期望 ${expectedScenario}`
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

async function assertCdpReachable(cdpUrl, timeoutMs) {
  const versionUrl = new URL("/json/version", cdpUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetch(versionUrl, { signal: controller.signal });
    } catch (error) {
      fail(`WebView2 CDP 不可用：${versionUrl}，请确认 Tauri 已用 CDP 端口启动。${errorMessage(error)}`);
    }
    if (!response.ok) {
      fail(`WebView2 CDP 检查失败：HTTP ${response.status}`);
    }

    const payload = await response.json();
    console.log(
      `[qa-ai-reading-assistant-desktop] CDP ok, browser=${payload.Browser ?? "unknown"}`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTauriPage(browser) {
  const contexts = browser.contexts();
  for (const context of contexts) {
    const pages = context.pages();
    const appPage = pages.find((page) => page.url().includes("127.0.0.1") || page.url().includes("localhost"));
    if (appPage) {
      await appPage.bringToFront();
      await appPage.waitForLoadState("domcontentloaded");
      return appPage;
    }
  }

  const firstPage = contexts[0]?.pages()[0];
  if (firstPage) {
    await firstPage.bringToFront();
    await firstPage.waitForLoadState("domcontentloaded");
    return firstPage;
  }

  fail("未找到可用的 Tauri WebView 页面。请确认桌面应用已启动，并开启 WebView2 CDP 端口。");
}

async function configureAiProvider(page, config) {
  console.log("[qa-ai-reading-assistant-desktop] 配置 AI Provider 为本地 mock");
  await openSettings(page);
  await openSettingsCategory(page, "AI 设置");

  const aiSettings = page.locator('section[aria-label="AI 设置"]');
  await aiSettings.waitFor({ state: "visible" });
  await aiSettings.getByLabel("Base URL").fill(config.providerBaseUrl);
  await aiSettings.locator('label:has-text("模型") input').fill(config.model);
  await aiSettings.getByLabel("新的 AI API Key").fill(config.apiKey);
  await aiSettings.getByRole("button", { name: "保存 AI 设置" }).click();
  try {
    await page
      .getByLabel("通知")
      .getByText(/AI (设置和新 Key 已保存到本机安全存储|Provider 设置已保存)/)
      .waitFor({ state: "visible" });
  } catch (error) {
    const diagnostics = await readSettingsDiagnostics(page);
    fail(`保存 AI Provider 设置后未看到成功通知。${diagnostics} ${errorMessage(error)}`);
  }
  await closeSettings(page);
}

async function readSettingsDiagnostics(page) {
  return page.evaluate(() => {
    const visibleText = document.body.innerText;
    const snippets = [
      ...visibleText.matchAll(/AI [^\n]{0,80}/g),
      ...visibleText.matchAll(/错误[^\n]{0,80}/g),
      ...visibleText.matchAll(/失败[^\n]{0,80}/g),
      ...visibleText.matchAll(/保存中[^\n]{0,80}/g)
    ]
      .map((match) => match[0])
      .slice(0, 8);
    const saveButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("保存 AI 设置")
    );
    return `诊断：${JSON.stringify({
      snippets,
      saveButtonDisabled: saveButton?.disabled ?? null,
      saveButtonText: saveButton?.textContent?.trim() ?? null
    })}`;
  });
}

async function verifyNormalStream(page, config) {
  console.log("[qa-ai-reading-assistant-desktop] 验证正常流式输出");
  const assistant = await openReadingAssistant(page);
  await sendAssistantMessage(assistant, "P5 桌面 QA：请用普通问答验证流式输出。");
  await assistant.getByText(/流式 mock 回答|桌面端事件/).waitFor({ state: "visible" });
  await assistant.getByRole("button", { name: "发送" }).waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page);

  if (config.verifyHistory) {
    console.log("[qa-ai-reading-assistant-desktop] 验证历史回放");
    await assistant.getByRole("button", { name: "查看最近对话" }).click();
    const threadButtons = assistant.locator(".reading-assistant-thread-list button");
    await threadButtons.first().waitFor({ state: "visible" });
    await threadButtons.first().click();
    await assistant.getByText(/流式 mock 回答|桌面端事件/).waitFor({ state: "visible" });
  }
}

async function verifyCancel(page) {
  console.log("[qa-ai-reading-assistant-desktop] 验证取消生成");
  const assistant = await openReadingAssistant(page);
  const existingAnswerCount = await assistant.getByText(/流式 mock 回答|桌面端事件/).count();
  await sendAssistantMessage(assistant, "P5 桌面 QA：请验证慢响应取消。");
  await assistant.getByRole("button", { name: "取消生成" }).waitFor({ state: "visible" });
  await assistant.getByRole("button", { name: "取消生成" }).click();
  await assistant.getByRole("button", { name: "发送" }).waitFor({ state: "visible" });
  await page.waitForTimeout(600);

  const leaked = await assistant.getByText(/流式 mock 回答|桌面端事件/).count();
  if (leaked > existingAnswerCount) {
    fail("取消生成后仍然看到了 mock 回答内容。请确认 mock provider 使用 slow-stream 场景。");
  }
}

async function verifyProviderError(page) {
  console.log("[qa-ai-reading-assistant-desktop] 验证 Provider 错误恢复");
  const assistant = await openReadingAssistant(page);
  await sendAssistantMessage(assistant, "P5 桌面 QA：请验证 Provider 错误恢复。");
  await assistant
    .getByText(/AI Provider 返回 HTTP|AI Provider 无法连接|mock provider/)
    .waitFor({ state: "visible" });
  await assistant.getByRole("button", { name: "发送" }).waitFor({ state: "visible" });
}

async function openSettings(page) {
  const dialog = page.getByRole("dialog", { name: "设置" });
  if ((await dialog.count()) > 0 && await dialog.first().isVisible()) {
    return;
  }

  const sidebarSettings = page.locator(".sidebar").getByRole("button", { name: "设置", exact: true });
  if ((await sidebarSettings.count()) > 0) {
    await sidebarSettings.dispatchEvent("click");
  } else {
    await page.getByRole("button", { name: /设置/ }).first().click();
  }

  await dialog.waitFor({ state: "visible" });
}

async function closeSettings(page) {
  const dialog = page.getByRole("dialog", { name: "设置" });
  if ((await dialog.count()) === 0) {
    return;
  }

  await page.getByRole("button", { name: "关闭设置" }).dispatchEvent("click");
  await dialog.waitFor({ state: "hidden" });
}

async function openSettingsCategory(page, label) {
  await page.getByLabel("设置分类").getByRole("button", { name: label }).click();
}

async function openReadingAssistant(page) {
  const assistant = page.getByRole("complementary", { name: "AI 阅读助手" });
  if ((await assistant.count()) === 0 || !(await assistant.first().isVisible())) {
    await page.getByLabel("打开 AI 阅读助手").click();
  }

  await assistant.waitFor({ state: "visible" });
  return assistant;
}

async function sendAssistantMessage(assistant, message) {
  const input = assistant.getByPlaceholder("问一个阅读问题");
  await input.fill(message);
  await assistant.getByRole("button", { name: "发送" }).click();
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const panel = document.querySelector(".reading-assistant-panel");
    return {
      page: root.scrollWidth - window.innerWidth,
      panel: panel ? panel.scrollWidth - panel.clientWidth : 0
    };
  });

  if (overflow.page > 1 || overflow.panel > 1) {
    fail(`检测到横向溢出：page=${overflow.page}, panel=${overflow.panel}`);
  }
}

function parseArgs(args) {
  const parsed = {
    cdpUrl: process.env.WXREADMASTER_QA_CDP_URL || DEFAULT_CDP_URL,
    providerBaseUrl: process.env.WXREADMASTER_QA_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL,
    model: process.env.WXREADMASTER_QA_MODEL || DEFAULT_MODEL,
    apiKey: process.env.WXREADMASTER_QA_API_KEY || DEFAULT_API_KEY,
    caseName: process.env.WXREADMASTER_QA_CASE || "normal-stream",
    timeoutMs: numberFromValue(process.env.WXREADMASTER_QA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    verifyHistory: false,
    preflight: false,
    skipConfigure: false,
    skipHealthCheck: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--cdp-url" && next) {
      parsed.cdpUrl = next;
      index += 1;
    } else if (arg === "--provider-base-url" && next) {
      parsed.providerBaseUrl = next;
      index += 1;
    } else if (arg === "--model" && next) {
      parsed.model = next;
      index += 1;
    } else if (arg === "--api-key" && next) {
      parsed.apiKey = next;
      index += 1;
    } else if (arg === "--case" && next) {
      parsed.caseName = next;
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      parsed.timeoutMs = numberFromValue(next, parsed.timeoutMs);
      index += 1;
    } else if (arg === "--verify-history") {
      parsed.verifyHistory = true;
    } else if (arg === "--preflight") {
      parsed.preflight = true;
    } else if (arg === "--skip-configure") {
      parsed.skipConfigure = true;
    } else if (arg === "--skip-health-check") {
      parsed.skipHealthCheck = true;
    }
  }

  return parsed;
}

function numberFromValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  throw new Error(message);
}

function printHelp() {
  console.log(`Usage:
  node scripts/qa-ai-reading-assistant-desktop.mjs [options]

前置条件：
  1. 启动 mock provider，例如：
     node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
  2. 启动 Tauri dev，并开启 WebView2 CDP 端口 9222。
  3. 再运行本脚本连接真实桌面 WebView。

Options:
  --case <name>                 验证场景：normal-stream, cancel, provider-error。默认 normal-stream
  --cdp-url <url>               WebView2 CDP URL。默认 ${DEFAULT_CDP_URL}
  --provider-base-url <url>     AI Provider Base URL。默认 ${DEFAULT_PROVIDER_BASE_URL}
  --model <model>               模型名。默认 ${DEFAULT_MODEL}
  --api-key <key>               写入本机安全存储的 mock Key。默认 ${DEFAULT_API_KEY}
  --verify-history              normal-stream 场景额外验证历史回放
  --preflight                   只检查 mock provider 和 CDP，不修改设置、不发送消息
  --skip-configure              不通过 UI 保存 AI Provider 设置
  --skip-health-check           不检查 mock provider /health
  --timeout-ms <ms>             Playwright 超时。默认 ${DEFAULT_TIMEOUT_MS}
  --help, -h                    显示帮助

示例：
  node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
  node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --preflight
  node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --verify-history

  node scripts/mock-ai-provider.mjs --port 8787 --scenario slow-stream
  node scripts/qa-ai-reading-assistant-desktop.mjs --case cancel

  node scripts/mock-ai-provider.mjs --port 8787 --scenario provider-error-json
  node scripts/qa-ai-reading-assistant-desktop.mjs --case provider-error

注意：
  - 默认会把 AI Provider 设置保存为本地 mock 配置。
  - 默认不会调用真实付费 Provider。
  - 本脚本不启动或停止 Tauri，也不启动或停止 mock provider。
`);
}
