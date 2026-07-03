# AI 阅读助手 P4.0 本地 Mock Provider 设计

## 目标

为 P4 桌面端真实联调提供一个本地 OpenAI-compatible mock provider，用来稳定复现正常流式、慢响应、取消、断流和错误返回。

该 mock provider 的目标不是模拟模型质量，而是验证协议、状态机和持久化边界。

## 背景

当前后端 AI 请求遵循 OpenAI-compatible Chat Completions 形态：

- URL 由 Base URL 推导到 `/v1/chat/completions`。
- 请求体包含 `model`、`messages`、`temperature`、`max_tokens`。
- 支持 `response_format`：
  - `json_object`
  - `json_schema`
- 普通非流式响应从 `choices[0].message.content` 读取 JSON 字符串。
- 流式响应通过 SSE 读取 `choices[0].delta.content`。
- P3.2 的流式解析会把 delta 累积成完整 JSON，并从 JSON 中的 `answer` 字段提取前缀增量。

因此 mock provider 必须按这个协议返回，而不是自定义接口。

## 非目标

- 不接入真实 OpenAI、DeepSeek、DashScope 或 Moonshot。
- 不做 embedding。
- 不做真实推荐质量评估。
- 不写入生产配置。
- 不默认纳入 release 包。
- 不把 mock server 作为应用功能暴露给用户。

## 技术选择

建议使用 Node.js 原生 `http` 模块实现，不新增依赖。

原因：

- 当前项目已有 Node 工具链。
- 原生 `http` 足够支持 JSON 响应和 SSE。
- 不引入 Express、Fastify 或其他服务框架，符合 KISS / YAGNI。
- 脚本可以放在 `scripts/` 下，仅用于开发和 QA。

建议文件：

```text
scripts/mock-ai-provider.mjs
```

建议命令：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
```

可选 package script：

```json
{
  "mock:ai-provider": "node scripts/mock-ai-provider.mjs"
}
```

是否加入 `package.json` 需要实施前再确认，避免增加低频脚本噪声。

## 接口契约

### 健康检查

```text
GET /health
```

响应：

```json
{
  "ok": true,
  "provider": "wxreadmaster-local-mock",
  "scenario": "normal-stream"
}
```

### 模型列表

```text
GET /v1/models
```

响应：

```json
{
  "object": "list",
  "data": [
    {
      "id": "mock-gpt",
      "object": "model",
      "owned_by": "wxreadmaster"
    }
  ]
}
```

用途：

- 验证设置页“刷新模型”或 provider 探测路径。
- 不需要模拟分页。

### Chat Completions

```text
POST /v1/chat/completions
```

请求判断：

- `stream === true`：返回 SSE。
- `stream !== true`：返回完整 JSON。
- `response_format.type === "json_schema"`：返回符合 schema 的 JSON 字符串。
- `response_format.type === "json_object"`：返回顶层 JSON 字符串。
- 不支持的 scenario 根据配置返回错误。

## 正常非流式响应

响应体：

```json
{
  "id": "chatcmpl-mock",
  "object": "chat.completion",
  "created": 1725955200,
  "model": "mock-gpt",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "{\"answer\":\"这是 mock provider 的完整回答。\",\"suggestions\":[\"继续追问阅读计划\"],\"basisNotice\":\"基于本地 mock 上下文。\",\"recommendedBooks\":[]}"
      }
    }
  ]
}
```

## 正常流式响应

响应头：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
```

SSE 帧：

```text
data: {"choices":[{"delta":{"content":"{\"answer\":\"这是一段"}}]}

data: {"choices":[{"delta":{"content":"流式 mock 回答。\""}}]}

data: {"choices":[{"delta":{"content":",\"suggestions\":[\"继续追问阅读计划\"],\"basisNotice\":\"基于本地 mock 上下文。\",\"recommendedBooks\":[]}"}}]}

data: [DONE]
```

要求：

- 每帧以空行结尾。
- delta 内容拼接后必须是一个有效 JSON 字符串。
- `answer` 字段必须先出现，方便前端增量展示。
- 最后一帧 `[DONE]` 可发送，后端会忽略。

## Scenario 设计

### `normal-json`

用途：

- 验证非流式结构化输出。
- 覆盖新书推荐、候选书决策等完整 JSON 场景。

行为：

- 等待 100-300ms。
- 返回完整 Chat Completion JSON。

### `normal-stream`

用途：

- 验证普通问答流式体验。

行为：

- 每 80-200ms 发送一段 SSE。
- `answer` 先出现。
- 最终返回完整 JSON 内容。

### `long-stream`

用途：

- 验证长流式回答、消息区滚动、快捷追问限量和横向溢出。

行为：

- 返回接近前端长回答压力的多段 answer。
- 返回 10 条 suggestions，用于验证后端归一化后只展示 3 条。
- 不返回推荐书。

### `long-json`

用途：

- 验证非流式长推荐卡片、长标题/长理由换行、推荐数量限量。

行为：

- 返回 8 本长标题推荐书，用于验证后端归一化后只展示 5 本。
- 返回 10 条 suggestions，用于验证只展示 3 条。
- answer 说明这些推荐仍需用户确认后再加入候选书架。

### `slow-stream`

用途：

- 验证生成中状态、取消生成、输入区锁定。

行为：

- 首帧延迟 1500ms。
- 后续每 1000ms 发送一段。
- 总耗时 8-12s。

### `broken-stream`

用途：

- 验证中途断流错误处理。

行为：

- 发送一到两帧合法 delta。
- 在 JSON 未闭合时关闭连接。

预期：

- 后端返回“AI 流式返回内容不是有效 JSON”或等价错误。
- 前端显示错误，输入区恢复。
- 不落库半截助手消息。

### `invalid-sse-json`

用途：

- 验证 SSE 帧无法解析。

行为：

```text
data: {"choices":[
```

预期：

- 后端返回“AI 流式返回包含无法解析的事件”。

### `provider-error-json`

用途：

- 验证 OpenAI-compatible 错误体。

响应：

```json
{
  "error": {
    "message": "mock provider 触发 500",
    "type": "server_error"
  }
}
```

HTTP status：`500`。

### `rate-limit`

用途：

- 验证 429 错误展示。

HTTP status：`429`。

响应：

```json
{
  "error": {
    "message": "mock provider rate limited",
    "type": "rate_limit_exceeded"
  }
}
```

### `unsupported-response-format`

用途：

- 验证后端对不支持 `response_format` Provider 的 fallback。

HTTP status：`400`。

响应：

```json
{
  "error": {
    "message": "response_format json_schema is not supported by this model"
  }
}
```

预期：

- 对支持 fallback 的路径，后端应按现有策略退回兼容请求。
- 对必须依赖 schema 的流式路径，应返回可理解错误或按既有逻辑处理。

## 配置方式

建议启动参数：

```text
--host 127.0.0.1
--port 8787
--scenario normal-stream
--chunk-delay-ms 120
--first-delay-ms 0
```

建议环境变量：

```text
MOCK_AI_PROVIDER_HOST=127.0.0.1
MOCK_AI_PROVIDER_PORT=8787
MOCK_AI_PROVIDER_SCENARIO=normal-stream
```

优先级：

1. CLI 参数。
2. 环境变量。
3. 默认值。

## 桌面联调步骤

1. 启动 mock provider。

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
```

2. 启动桌面应用。

```bash
npm run tauri
```

3. 在设置页配置 AI Provider：

```text
Base URL: http://127.0.0.1:8787/v1
Model: mock-gpt
API Key: sk-local-mock
```

4. 打开 AI 阅读助手。
5. 输入普通阅读问题。
6. 观察：
   - 是否有增量文本。
   - 按钮是否变为“取消生成”。
   - 完成后是否恢复“发送”。
   - used context 是否显示阅读记忆来源。
   - 重新打开历史是否恢复完整回答。

## 验收用例

| 用例 | Scenario | 期望 |
| --- | --- | --- |
| 普通流式问答 | `normal-stream` | 增量文本、最终落库、历史恢复。 |
| 慢响应 | `slow-stream` | 生成中状态稳定，可取消。 |
| 部分 delta 后取消 | `slow-stream` | pending 消息移除，不落库半截文本。 |
| 中途断流 | `broken-stream` | 错误可读，输入区恢复，不落库半截文本。 |
| SSE 非法 JSON | `invalid-sse-json` | 展示解析错误。 |
| Provider 500 | `provider-error-json` | 展示 provider 错误。 |
| Provider 429 | `rate-limit` | 展示限流错误。 |
| 不支持 response_format | `unsupported-response-format` | fallback 或错误路径符合现有策略。 |
| 非流式结构化回答 | `normal-json` | 推荐卡片和快捷追问仍来自完整 JSON。 |
| 长流式回答 | `long-stream` | 长回答可滚动，不横向溢出，快捷追问限量展示。 |
| 长推荐卡片 | `long-json` | 长标题和长理由不撑破面板，推荐数量限量展示。 |

## 实现边界

建议第一版只实现：

- `/health`
- `/v1/models`
- `/v1/chat/completions`
- `normal-json`
- `normal-stream`
- `long-json`
- `long-stream`
- `slow-stream`
- `broken-stream`
- `invalid-sse-json`
- `provider-error-json`
- `rate-limit`
- `unsupported-response-format`

暂缓：

- 复杂随机数据生成。
- Web UI 控制面板。
- 多会话状态管理。
- 请求录制和回放。
- 自动修改应用设置。

## 风险与处理

### R1：mock 行为和真实 Provider 不一致

处理：

- mock 只验证协议和状态机。
- P4.5 保留真实 Provider 小样本人工验收。

### R2：mock server 被误用为产品能力

处理：

- 放在 `scripts/`。
- 文档明确仅用于本地 QA。
- 不打包进 Tauri release。

### R3：scenario 过多导致维护成本上升

处理：

- 第一版只保留 P4 必需场景。
- 新场景必须对应明确验收风险。

## 是否开始实现

实现状态：

- 已新增 `scripts/mock-ai-provider.mjs`。
- 未修改 `package.json`，当前通过 `node scripts/mock-ai-provider.mjs` 直接运行。
- 已验证帮助信息、语法检查、健康检查、非流式 JSON、流式 SSE 和 429 错误场景。

验证命令：

```bash
node scripts/mock-ai-provider.mjs --help
node --check scripts/mock-ai-provider.mjs
```

补充冒烟：

- `GET /health`：通过。
- `POST /v1/chat/completions?scenario=normal-json`：返回 OpenAI-compatible 非流式 JSON。
- `POST /v1/chat/completions` 且 `stream=true`：返回 SSE delta 与 `[DONE]`。
- `scenario=rate-limit`：返回 HTTP 429 和 OpenAI-compatible error body。

后续若需要更方便的入口，再评估是否在 `package.json` 增加低频脚本 `mock:ai-provider`。
