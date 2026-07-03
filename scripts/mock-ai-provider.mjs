#!/usr/bin/env node
import http from "node:http";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_SCENARIO = "normal-stream";
const DEFAULT_CHUNK_DELAY_MS = 120;
const DEFAULT_FIRST_DELAY_MS = 0;

const SCENARIOS = new Set([
  "normal-json",
  "normal-stream",
  "long-json",
  "long-stream",
  "slow-stream",
  "broken-stream",
  "invalid-sse-json",
  "provider-error-json",
  "rate-limit",
  "unsupported-response-format"
]);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!SCENARIOS.has(options.scenario)) {
  console.error(
    `Unknown scenario "${options.scenario}". Supported: ${Array.from(SCENARIOS).join(", ")}`
  );
  process.exit(1);
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("[mock-ai-provider] request failed", error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: {
          message: "mock provider internal error",
          type: "server_error"
        }
      });
    } else {
      response.end();
    }
  });
});

server.listen(options.port, options.host, () => {
  console.log(
    `[mock-ai-provider] listening on http://${options.host}:${options.port} scenario=${options.scenario}`
  );
  console.log(
    `[mock-ai-provider] use Base URL http://${options.host}:${options.port}/v1, model mock-gpt, API Key sk-local-mock`
  );
});

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = trimTrailingSlash(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      provider: "wxreadmaster-local-mock",
      scenario: resolveScenario(request, requestUrl)
    });
    return;
  }

  if (
    request.method === "GET" &&
    (pathname === "/v1/models" || pathname === "/models")
  ) {
    sendJson(response, 200, {
      object: "list",
      data: [
        {
          id: "mock-gpt",
          object: "model",
          owned_by: "wxreadmaster"
        }
      ]
    });
    return;
  }

  if (
    request.method === "POST" &&
    (pathname === "/v1/chat/completions" || pathname === "/chat/completions")
  ) {
    const body = await readJsonBody(request);
    await handleChatCompletion(request, response, requestUrl, body);
    return;
  }

  sendJson(response, 404, {
    error: {
      message: `mock provider route not found: ${request.method} ${pathname || "/"}`,
      type: "not_found"
    }
  });
}

async function handleChatCompletion(request, response, requestUrl, body) {
  const scenario = resolveScenario(request, requestUrl);
  const stream = body.stream === true;
  const model = typeof body.model === "string" && body.model.trim() ? body.model : "mock-gpt";

  if (scenario === "rate-limit") {
    sendProviderError(response, 429, "mock provider rate limited", "rate_limit_exceeded");
    return;
  }

  if (scenario === "provider-error-json") {
    sendProviderError(response, 500, "mock provider triggered 500", "server_error");
    return;
  }

  if (scenario === "unsupported-response-format" && body.response_format) {
    sendProviderError(
      response,
      400,
      "response_format json_schema is not supported by this model",
      "invalid_request_error"
    );
    return;
  }

  if (scenario === "long-json") {
    sendJson(response, 200, buildChatCompletionResponse(model, buildAssistantPayload({
      answer: buildLongRecommendationAnswer(),
      suggestions: buildLongSuggestions(),
      recommendedBooks: buildLongRecommendedBooks()
    })));
    return;
  }

  if (stream || scenario === "normal-stream" || scenario === "slow-stream") {
    await sendStreamResponse(request, response, model, scenario);
    return;
  }

  sendJson(response, 200, buildChatCompletionResponse(model, buildAssistantPayload({
    includeRecommendedBooks: true
  })));
}

async function sendStreamResponse(request, response, model, scenario) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  if (scenario === "invalid-sse-json") {
    response.write('data: {"choices":[\n\n');
    response.end();
    return;
  }

  const payloadText = JSON.stringify(
    buildAssistantPayload({
      includeRecommendedBooks: false,
      answer: scenario === "long-stream"
        ? buildLongStreamAnswer()
        : "这是一段流式 mock 回答。它用于验证桌面端事件、取消状态和最终历史落库。",
      suggestions: scenario === "long-stream" ? buildLongSuggestions() : undefined
    })
  );
  const chunks = splitForStreaming(payloadText, scenario);
  const firstDelayMs = scenario === "slow-stream" ? Math.max(options.firstDelayMs, 1500) : options.firstDelayMs;
  const chunkDelayMs = scenario === "slow-stream" ? Math.max(options.chunkDelayMs, 1000) : options.chunkDelayMs;
  let closed = false;

  request.on("close", () => {
    closed = true;
  });

  await sleep(firstDelayMs);
  const limit = scenario === "broken-stream" ? Math.min(2, chunks.length) : chunks.length;

  for (let index = 0; index < limit; index += 1) {
    if (closed || response.destroyed) {
      return;
    }

    writeSse(response, {
      id: "chatcmpl-mock-stream",
      object: "chat.completion.chunk",
      created: 1725955200,
      model,
      choices: [
        {
          index: 0,
          delta: {
            content: chunks[index]
          },
          finish_reason: null
        }
      ]
    });
    await sleep(chunkDelayMs);
  }

  if (scenario === "broken-stream") {
    response.end();
    return;
  }

  writeSse(response, {
    id: "chatcmpl-mock-stream",
    object: "chat.completion.chunk",
    created: 1725955200,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ]
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

function buildAssistantPayload({
  answer = "这是 mock provider 的完整回答。它用于验证结构化输出、快捷追问和推荐卡片。",
  suggestions = ["继续追问阅读计划", "解释阅读记忆来源"],
  includeRecommendedBooks,
  recommendedBooks
} = {}) {
  return {
    answer,
    suggestions,
    basisNotice: "基于本地 mock 上下文，不代表真实模型质量。",
    recommendedBooks: recommendedBooks ?? (includeRecommendedBooks
      ? [
          {
            title: "卡片笔记写作法",
            author: "申克·阿伦斯",
            reason: "适合把阅读记忆沉淀为可复用的知识线索。",
            fit: "承接复盘、笔记和主题整理。",
            risk: "如果当前只想轻松阅读，方法论密度可能偏高。"
          }
        ]
      : [])
  };
}

function buildChatCompletionResponse(model, payload) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1725955200,
    model,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(payload)
        }
      }
    ]
  };
}

function buildLongStreamAnswer() {
  const paragraphs = [
    "P4.3 长回答压力验证：这段回答故意接近前端可展示上限，用来观察滚动、换行、Markdown-lite 渲染和输入区恢复。",
    "第一，当前阅读记录显示你会在技术、方法论和自我管理之间来回切换，因此长回答需要保持结构清晰，而不是把所有信息堆成一整块。",
    "第二，回答里包含较长的中文句子、英文术语 OpenAI-compatible provider、以及连续标点，目的是检查普通换行和 overflow-wrap 是否稳定。",
    "第三，建议把阅读动作拆成继续阅读、摘录证据、复盘问题、候选书确认四类，这样即使上下文很长，用户也能快速定位下一步。",
    "第四，如果本地阅读记忆同时包含统计、候选书和近期对话，回答应该只引用已提供的范围，并明确说明哪些结论来自本地信号。",
    "第五，长回答结束后仍应保留快捷追问，但快捷追问数量应由后端归一化限制，避免底部区域被十几条按钮撑爆。"
  ];
  const repeated = [];
  for (let index = 0; index < 18; index += 1) {
    repeated.push(`${index + 1}. ${paragraphs[index % paragraphs.length]}`);
  }
  return repeated.join("\n\n");
}

function buildLongRecommendationAnswer() {
  return [
    "下面给出一组故意偏长的新书推荐，用来验证推荐卡片在长标题、长作者和长理由下的换行、限量和历史回放。",
    "这些推荐不是本地候选书架已有项，也未确认微信读书可用；需要用户确认后再加入候选书架。",
    "后端应把超量推荐裁剪到展示上限，前端卡片不应横向溢出。"
  ].join("\n");
}

function buildLongSuggestions() {
  return [
    "把这组建议压缩成今天 20 分钟内能完成的行动清单",
    "只保留和技术阅读有关的下一步",
    "比较前两本书哪个更适合作为下一本",
    "把推荐理由改写成候选书架备注",
    "列出需要先排除的书籍类型",
    "生成 5 个复盘问题",
    "说明这些建议分别来自哪些本地信号",
    "给我一个更轻量的版本",
    "把它整理成周末阅读计划",
    "指出最不确定的推荐"
  ];
}

function buildLongRecommendedBooks() {
  return Array.from({ length: 8 }, (_, index) => ({
    title: `复杂系统、长期主义与个人知识管理的实践手册第 ${index + 1} 卷：从阅读现场到可复用决策资产`,
    author: `作者甲、作者乙、跨学科研究小组 ${index + 1}`,
    reason:
      "这本书的推荐理由刻意写得较长，用于验证推荐卡片正文在多行文本下不会撑破面板，也不会遮挡后续按钮或状态信息。",
    fit:
      "适合当前同时关注技术成长、阅读复盘、候选书筛选和长期知识沉淀的用户，能够承接本地统计、近期阅读和 AI 资产摘要。",
    risk:
      "篇幅和概念密度偏高，如果只是想快速获得轻量阅读反馈，可能需要先阅读导论或选择更短的替代书。"
  }));
}

function splitForStreaming(value, scenario = DEFAULT_SCENARIO) {
  if (scenario === "long-stream") {
    const chunks = [];
    for (let index = 0; index < value.length; index += 180) {
      chunks.push(value.slice(index, index + 180));
    }
    return chunks;
  }

  const preferredCuts = [
    '{"answer":"这是一段',
    "流式 mock 回答。",
    "它用于验证桌面端事件、",
    "取消状态和最终历史落库。\"",
    value.slice(value.indexOf(',"suggestions"'))
  ].filter(Boolean);

  if (preferredCuts.join("") === value) {
    return preferredCuts;
  }

  const chunks = [];
  for (let index = 0; index < value.length; index += 24) {
    chunks.push(value.slice(index, index + 24));
  }
  return chunks;
}

function writeSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendProviderError(response, status, message, type) {
  sendJson(response, status, {
    error: {
      message,
      type
    }
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveScenario(request, requestUrl) {
  const header = request.headers["x-mock-ai-scenario"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const queryValue = requestUrl.searchParams.get("scenario");
  const scenario = queryValue || headerValue || options.scenario;
  return SCENARIOS.has(scenario) ? scenario : options.scenario;
}

function parseArgs(args) {
  const parsed = {
    host: process.env.MOCK_AI_PROVIDER_HOST || DEFAULT_HOST,
    port: numberFromValue(process.env.MOCK_AI_PROVIDER_PORT, DEFAULT_PORT),
    scenario: process.env.MOCK_AI_PROVIDER_SCENARIO || DEFAULT_SCENARIO,
    chunkDelayMs: numberFromValue(process.env.MOCK_AI_PROVIDER_CHUNK_DELAY_MS, DEFAULT_CHUNK_DELAY_MS),
    firstDelayMs: numberFromValue(process.env.MOCK_AI_PROVIDER_FIRST_DELAY_MS, DEFAULT_FIRST_DELAY_MS),
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--host" && next) {
      parsed.host = next;
      index += 1;
    } else if (arg === "--port" && next) {
      parsed.port = numberFromValue(next, parsed.port);
      index += 1;
    } else if (arg === "--scenario" && next) {
      parsed.scenario = next;
      index += 1;
    } else if (arg === "--chunk-delay-ms" && next) {
      parsed.chunkDelayMs = numberFromValue(next, parsed.chunkDelayMs);
      index += 1;
    } else if (arg === "--first-delay-ms" && next) {
      parsed.firstDelayMs = numberFromValue(next, parsed.firstDelayMs);
      index += 1;
    }
  }

  return parsed;
}

function numberFromValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function trimTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown() {
  server.close(() => {
    console.log("[mock-ai-provider] stopped");
    process.exit(0);
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/mock-ai-provider.mjs [options]

Options:
  --host <host>                 Host to bind. Default: ${DEFAULT_HOST}
  --port <port>                 Port to bind. Default: ${DEFAULT_PORT}
  --scenario <name>             Scenario. Default: ${DEFAULT_SCENARIO}
  --chunk-delay-ms <ms>         Delay between SSE chunks. Default: ${DEFAULT_CHUNK_DELAY_MS}
  --first-delay-ms <ms>         Delay before first SSE chunk. Default: ${DEFAULT_FIRST_DELAY_MS}
  --help, -h                    Show help.

Scenarios:
  ${Array.from(SCENARIOS).join("\n  ")}

Desktop settings:
  Base URL: http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1
  Model: mock-gpt
  API Key: sk-local-mock
`);
}
