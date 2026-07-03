# AI 阅读助手 P4.1 桌面端流式联调清单

## 目标

验证 AI 阅读助手在真实 Tauri 桌面壳中的流式问答链路：

- 前端调用 `ask_reading_assistant_stream`。
- 后端请求 OpenAI-compatible Provider。
- 后端解析 SSE delta。
- 后端通过 `reading-assistant-stream` 事件推送增量文本。
- 前端显示增量回答和“取消生成”状态。
- 最终完整 JSON 落库。
- 历史回放恢复完整回答、used context 和快捷追问。

## 范围

本清单只验证 P3 已完成能力在真实桌面链路里的稳定性，不新增产品能力。

覆盖：

- 正常流式。
- 慢响应。
- 取消生成。
- 中途断流。
- Provider 错误。
- 历史回放。
- 阅读记忆开关边界。

不覆盖：

- 真实模型推荐质量。
- 全量向量知识库。
- 远端同步对话历史。
- 自动修改用户真实 AI Provider 配置。

## 前置条件

### 1. 启动本地 mock provider

正常流式：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
```

慢响应：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario slow-stream
```

断流：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario broken-stream
```

错误：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario provider-error-json
```

每次切换 scenario 建议重启 mock provider，避免误判。

### 2. 启动桌面应用

```bash
npm run tauri
```

注意：该命令会打开 Tauri 桌面窗口。

当前项目的 `tauri` 脚本是 Tauri CLI 包装器，手动启动 dev 时也可使用：

```bash
node scripts/run-tauri.mjs dev
```

如果 `5173` 已有当前项目 Vite dev server，可用临时 config 禁用 `beforeDevCommand` 后复用现有 dev server：

```bash
node scripts/run-tauri.mjs dev --config "%TEMP%/wxreadmaster-tauri-no-before-dev.json" --no-dev-server-wait
```

临时 config 内容：

```json
{
  "build": {
    "beforeDevCommand": ""
  }
}
```

### 3. 配置 AI Provider

在设置页填写：

```text
Base URL: http://127.0.0.1:8787/v1
Model: mock-gpt
API Key: sk-local-mock
```

建议同时确认：

- 阅读助手“个性化上下文”：开启。
- 阅读助手“阅读记忆”：开启。
- 阅读助手“原始笔记片段”：保持关闭。
- 阅读助手“保存对话历史”：开启。

## 用例 1：正常流式问答

mock scenario：

```bash
normal-stream
```

步骤：

1. 打开 AI 阅读助手。
2. 输入：`请基于我的阅读记忆给一个下一步建议`。
3. 点击发送。
4. 观察生成中状态。
5. 等待回答完成。

预期：

- 发送按钮切换为“取消生成”。
- 回答内容逐步出现。
- 完成后按钮恢复“发送”。
- 回答展示 Markdown-lite 列表或段落。
- 回答展示 `阅读记忆 · N` used context。
- 回答下方展示快捷追问。
- 不出现错误 toast 或失败消息。

历史验证：

1. 点击“最近对话”。
2. 打开刚才的会话。

预期：

- 历史中显示完整回答，不是半截流式文本。
- 快捷追问恢复。
- used context 恢复。

## 用例 2：慢响应期间取消

mock scenario：

```bash
slow-stream
```

步骤：

1. 打开 AI 阅读助手。
2. 输入任意普通问题。
3. 点击发送。
4. 在首帧前点击“取消生成”。

预期：

- pending 助手消息移除。
- 按钮恢复“发送”。
- 输入区可继续输入。
- 最近对话中不新增半截助手消息。

补充步骤：

1. 再次发送一个问题。
2. 等首段文字出现后点击“取消生成”。

预期：

- 已出现的半截文本不进入历史。
- 前端不残留 loading 状态。

## 用例 3：中途断流

mock scenario：

```bash
broken-stream
```

步骤：

1. 打开 AI 阅读助手。
2. 输入普通问题。
3. 点击发送。
4. 等待连接断开。

预期：

- 前端展示可理解错误。
- 输入区恢复可用。
- 生成中状态结束。
- 历史不会保存半截成功回答。

可接受错误文案：

- `AI 流式返回内容不是有效 JSON。`
- 或等价的 provider/网络错误提示。

## 用例 4：SSE 非法事件

mock scenario：

```bash
invalid-sse-json
```

步骤：

1. 打开 AI 阅读助手。
2. 输入普通问题。
3. 点击发送。

预期：

- 前端展示解析错误。
- 输入区恢复可用。
- 不落库成功回答。

可接受错误文案：

- `AI 流式返回包含无法解析的事件。`

## 用例 5：Provider 500

mock scenario：

```bash
provider-error-json
```

步骤：

1. 打开 AI 阅读助手。
2. 输入普通问题。
3. 点击发送。

预期：

- 前端展示 provider 错误。
- 不出现无限 loading。
- 输入区恢复可用。

## 用例 6：Provider 429

mock scenario：

```bash
rate-limit
```

步骤：

1. 打开 AI 阅读助手。
2. 输入普通问题。
3. 点击发送。

预期：

- 前端展示限流错误。
- 输入区恢复可用。
- 历史不写入成功回答。

## 用例 7：阅读记忆关闭边界

mock scenario：

```bash
normal-stream
```

步骤：

1. 打开 AI 阅读助手设置。
2. 关闭“阅读记忆”。
3. 返回聊天。
4. 发送普通问题。

预期：

- 本次上下文不显示“阅读记忆”。
- 完成回答的 used context 不包含 `readingMemory`。
- 不影响普通回答完成。

恢复：

1. 回到助手设置。
2. 重新开启“阅读记忆”。

## 用例 8：非流式结构化推荐

mock scenario：

```bash
normal-json
```

步骤：

1. 打开 AI 阅读助手。
2. 输入：`推荐 3 本适合我下一步加入候选书架的新书`。
3. 点击发送。

预期：

- 后端根据 intent 保持完整 JSON 返回。
- 推荐卡片可见。
- 快捷追问可见。
- 历史回放能恢复推荐卡片。

备注：

- mock provider 只返回固定推荐样本，不代表真实推荐质量。

## 证据记录模板

每个用例建议记录：

```text
用例：
scenario：
时间：
结果：通过 / 失败 / 阻塞
观察：
错误文案：
是否写入历史：
截图路径：
备注：
```

## 失败分流

### 前端没有增量文本

优先检查：

- `reading-assistant-stream` 事件是否被前端监听。
- 后端是否收到 SSE chunk。
- mock provider 是否以 `stream=true` 收到请求。
- 当前问题是否被判断为普通 `General` intent。

### 后端返回完整成功但历史没有恢复结构化输出

优先检查：

- `ai_assistant_messages.output_json` 是否写入。
- `get_reading_assistant_thread` 是否返回 `output`。
- 前端 `messageFromRecord` 是否恢复 `suggestions` 和 `recommendedBooks`。

### 取消后仍写入半截历史

优先检查：

- `cancel_reading_assistant_stream` 是否被调用。
- `take_reading_assistant_stream_cancel_request` 是否命中。
- 前端 canceled stream id 是否过滤完成后的响应。

## 完成标准

P4.1 可完成的条件：

- 用例 1、2、3、5 通过。
- 用例 7 通过。
- 用例 8 至少通过一次推荐卡片和历史恢复验证。
- 所有失败路径均不会留下半截成功历史。
- 记录一次桌面端截图或录屏证据。

当前结论：

- P4.1 完成标准已满足。
- 429 和非法 SSE 可作为补充回归，不阻塞 P4.1 收尾。

## 当前联调状态

日期：2026-07-03。

已完成：

- 本地 mock provider 已启动：`http://127.0.0.1:8787`，scenario 为 `normal-stream`。
- mock provider 健康检查通过：`GET /health`。
- Tauri dev 已启动并运行 `target/debug/personal-reading-app.exe`。
- 启动 Tauri 时复用了已有 `5173` Vite dev server，并用临时 config 禁用了 `beforeDevCommand`，避免端口冲突。

启动过程记录：

- 初次执行 `npm run tauri` 只显示 Tauri CLI 帮助，因为缺少 `dev` 子命令。
- 执行 `node scripts/run-tauri.mjs dev` 时，`5173` 被已有 node 进程占用，`beforeDevCommand` 启动失败。
- 使用临时 config 复用已有 `5173` 后，Rust 编译完成并启动桌面应用。
- 编译期间只出现既有 dead code warning，未出现阻断错误。

已完成的 P4.1 自动化验证：

- 通过 WebView2 远程调试端口 `9222` 连接真实 Tauri WebView。
- 在真实设置页内将 AI Provider 配置为本地 mock：
  - Base URL：`http://127.0.0.1:8787/v1`
  - Model：`mock-gpt`
  - API Key：`sk-local-mock-1234567890`
  - 兼容模式：`jsonSchemaFirst`
- 用例 1 正常流式问答通过。
- 生成中按钮切换为“取消生成”。
- 回答内容通过 mock SSE 增量出现。
- 最终回答展示 Markdown-lite、used context 和快捷追问。
- 历史回放通过，最近对话中可打开刚才的线程，并恢复完整回答、used context 和快捷追问。

截图证据：

- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-stream-normal-rerun.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-history-replay.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-cancel-after-delta-rerun.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-broken-stream.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-provider-500.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-reading-memory-off.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-recommendation-card.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-tauri-recommendation-history.png`

验证期间发现并修复：

- 发现：当后端返回多个相同 `contextType` 的 used context，例如 `readingStats` 和统计复盘摘要同属 `readingStats`，前端使用 `${message.id}-${context.contextType}` 作为 React key 会触发重复 key warning。
- 修复：`src/components/ReadingAssistantPanel.tsx` 中 used context key 增加 index，避免重复 key。
- 复测：重复 key warning 消失。

复测中仍观察到：

- Edge Tracking Prevention 对微信读书封面图输出 storage warning。
- 该 warning 来自外部封面资源，不影响 AI 阅读助手流式链路。

已完成的异常和边界验证：

- 首帧前取消：通过，未残留半截回答。
- 收到部分 delta 后取消：通过，面板只保留用户问题，未残留半截回答。
- 中途断流 `broken-stream`：通过，展示“AI 流式返回内容不是有效 JSON。”，输入区恢复。
- Provider 500 `provider-error-json`：通过，展示“AI Provider 返回 HTTP 500：mock provider triggered 500”，输入区恢复。
- 阅读记忆关闭边界：通过，关闭后上下文 chips 仅有“阅读统计”“阅读画像”，used context 不含“阅读记忆”；验证后已恢复开关。
- 非流式结构化推荐 `normal-json`：通过，推荐卡片可见，历史回放可恢复推荐卡片和快捷追问。

配置副作用：

- 为完成真实桌面联调，AI Provider 已临时配置为本地 mock：
  - Base URL：`http://127.0.0.1:8787/v1`
  - Model：`mock-gpt`
  - API Key：`sk-local-mock-1234567890`
- 如需回到真实模型，需要重新保存真实 Provider 和 API Key。

待补充：

- `rate-limit` 429 错误路径：已在 P4.2 补充。
- `invalid-sse-json` 非法 SSE 事件路径：已在 P4.2 补充。

## P4.2 取消与失败路径补充验证

日期：2026-07-03。

目标：

- 补齐 P4.1 后续保留的 429 和非法 SSE 错误路径。
- 验证网络错误后输入区恢复可用。
- 确认失败路径不会留下半截成功回答。

已完成验证：

- `rate-limit`：当前 `8787` mock provider 场景为 `rate-limit`，发送问题后展示“AI Provider 返回 HTTP 429：mock provider rate limited”；输入区恢复，`取消生成` 不残留，控制台无错误。
- `invalid-sse-json`：临时启动 `8789` mock provider，Provider Base URL 切换为 `http://127.0.0.1:8789/v1`；发送问题后展示“AI 流式返回包含无法解析的事件。”；输入区恢复，`取消生成` 不残留，控制台无错误；验证后已恢复 Base URL 为 `http://127.0.0.1:8787/v1`。
- 网络错误：Provider Base URL 临时切到未监听端口 `http://127.0.0.1:8799/v1`；发送问题后展示“AI Provider 无法连接（网络请求失败）。请检查 Base URL、网络代理、防火墙，或稍后重试。”；输入区恢复，`取消生成` 不残留，控制台无错误；验证后已恢复 Base URL 为 `http://127.0.0.1:8787/v1`。

截图证据：

- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-2-rate-limit.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-2-invalid-sse-json.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-2-network-error.png`

验证期间发现并修复：

- 发现：设置弹层 `z-index` 低于 AI 阅读助手面板，导致设置弹层打开时“关闭设置”按钮被助手面板拦截点击。
- 修复：将 `settings-modal-backdrop` 层级提升到高于 AI 阅读助手面板，移动端覆盖值同步调整。
- 复测：设置弹层关闭按钮可点击。

当前结论：

- P4.2 完成标准已满足。
- 真实超时场景未单独等待 60 秒以上复现；已用未监听端口覆盖网络失败和输入区恢复路径。

## P4.3 长数据压力场景补充验证

日期：2026-07-03。

目标：

- 验证长回答、复杂推荐输出、超量快捷追问和 80 条消息时 AI 阅读助手面板仍可用。
- 避免为了 QA 批量污染真实本地历史。

已完成验证：

- `long-stream`：临时启动 `8790` mock provider，返回长流式回答和 10 条快捷追问；真实 Tauri WebView 中主页面无横向溢出，AI 阅读助手面板无横向溢出，消息区可滚动，快捷追问最终展示 3 条，used context 展示阅读记忆来源。
- `long-json`：临时启动 `8791` mock provider，返回 8 本长标题/长理由推荐书和 10 条快捷追问；真实 Tauri WebView 中推荐卡片最终展示 5 本，快捷追问展示 3 条，长标题和长理由未撑破面板，无控制台错误。
- 80 条消息：临时启动 `8792` mock provider，并临时关闭“保存对话历史”；连续发送 40 轮短问答形成 80 条 UI 消息，消息区可滚动，输入区恢复可用，主页面和面板均无横向溢出；验证后已恢复“保存对话历史”和 Provider Base URL。
- 历史列表现状：当前真实历史为 16 个会话，列表未达到 50 个会话压力规模。

关键指标：

- 长流式回答：`pageOverflowX=false`，`panelOverflowX=false`，`messagesScrollable=true`，`lastSuggestionCount=3`。
- 长推荐卡片：`recommendationCount=5`，`lastSuggestionCount=3`，`pageOverflowX=false`，`panelOverflowX=false`，`messagesScrollable=true`。
- 80 条消息：初始 12 条，最终 92 条，新增 80 条；`pageOverflowX=false`，`panelOverflowX=false`，`messagesScrollable=true`。

截图证据：

- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-3-long-stream.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-3-long-recommendations.png`
- `C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-3-80-messages.png`

当前结论：

- P4.3 的长回答、长推荐卡片、超量快捷追问和 80 条消息压力场景已通过。
- 50 个历史线程未实跑；不建议在用户当前本地库内批量制造历史线程。该项应在临时数据目录或专用测试库中补充。

## P4.4 阅读记忆边界审计

日期：2026-07-03。

目标：

- 确认阅读助手 prompt payload 和 `usedContext` 不泄露 API Key、数据库路径、本地文件路径或默认关闭的原始笔记正文。
- 确认阅读记忆开关和来源可追溯性符合 P3.3 边界。

已完成验证：

- 单元测试 `reading_assistant_context_omits_reading_memory_when_disabled`：关闭 `useReadingMemory` 后不注入 `readingMemory`，`usedContext` 不包含 `ReadingMemory`。
- 单元测试 `reading_assistant_context_respects_personalized_context_toggle`：关闭个性化上下文后不注入当前书、复盘等本地上下文。
- 单元测试 `reading_assistant_context_includes_reading_memory_lite_when_enabled`：阅读记忆开启时包含可追溯 `sourceRef`，并默认不包含 `rawBookNotes`。
- 单元测试 `reading_assistant_book_detail_context_excludes_sensitive_raw_fields`：book detail `raw_json` 中的 `apiKey`、`databasePath`、密钥片段不会进入 prompt payload；P4.4 补充断言确认这些敏感字段也不会进入 `usedContext` 序列化结果。
- P4.1 桌面联调已验证阅读记忆关闭边界：关闭后上下文 chips 仅有“阅读统计”“阅读画像”，used context 不含“阅读记忆”；验证后已恢复开关。

执行命令：

- `cargo test reading_assistant_context --lib`
- `cargo test reading_assistant_book_detail_context_excludes_sensitive_raw_fields --lib`

当前结论：

- P4.4 完成标准已满足。

## P4.5 真实 Provider 手动验收

日期：2026-07-03。

目标：

- 在用户显式配置真实 Provider 后做小样本人工验收。
- 确认真实模型质量和结构化输出不破坏 P3/P4 已验证链路。

当前状态：

- 已实跑并通过。
- 用户已显式配置真实 Provider，并确认允许小样本真实模型调用成本和本地阅读上下文发送。
- 设置页显示“已配置 AI Provider”，验证错误为“无”。
- 本次验收未读取、输出或修改 API Key。

真实 Provider 配置：

- Provider：DeepSeek。
- Base URL：`https://api.deepseek.com/v1`。
- Model：`deepseek-v4-flash`。
- 兼容模式：`jsonObjectFirst`。

执行方式：

- Browser plugin 已列出，但本会话工具发现 `node_repl js` 返回 0 个可调用工具，无法走 Browser runtime。
- 使用 Playwright `connectOverCDP("http://127.0.0.1:9222")` 连接真实 Tauri WebView2。
- 验收页面：`http://127.0.0.1:5173/`，标题为“个人阅读管理”。
- 只执行两条最小真实调用，避免额外成本。

已完成样本：

1. 普通解释型问题：`这本书最近适合从哪个角度继续读？请结合我的本地阅读状态，给出 3 条简短建议。`
   - 结果：通过。
   - 助手消息：新增 1 条，回答长度 314 字。
   - UI 状态：输入区恢复，`取消生成` 不残留。
   - 布局指标：`pageOverflowX=false`，`panelOverflowX=false`。
   - 控制台：无 error/warn。
   - 截图：`C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-5-real-normal.png`。
2. 新书推荐：`推荐 3 本可加入候选书架的新书。请给出书名、作者和一句推荐理由。`
   - 结果：通过。
   - 助手消息：新增 1 条，回答长度 704 字。
   - 推荐卡片：新增 3 张。
   - UI 状态：输入区恢复，`取消生成` 不残留。
   - 布局指标：`pageOverflowX=false`，`panelOverflowX=false`。
   - 控制台：无 error/warn。
   - 截图：`C:\Users\RHZ\AppData\Local\Temp\wxreadmaster-p4-5-real-recommendation.png`。

当前结论：

- P4.5 完成标准已满足。
- 真实 Provider 可以完成普通问答和结构化新书推荐卡片渲染。
- P4 已具备整体收尾条件。

自动化说明：

- 已通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 打开 WebView2 CDP 端口。
- 已使用 Playwright `connectOverCDP` 自动操作真实 Tauri WebView。
- 因此后续真实 Provider 小样本可继续自动化执行，无需完全依赖人工点击。
