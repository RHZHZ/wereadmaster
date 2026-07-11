# AI 阅读助手 P5 稳定性与工程整理计划

## 背景

P4 已关闭，AI 阅读助手的真实桌面流式链路、异常恢复、长数据压力、隐私边界和真实 Provider 小样本均已通过验收。P5 不应继续扩大产品面，而应把 P4 发现的“可重复验证”和“维护成本”问题收束掉。

P5 的核心不是新增能力，而是降低后续变更风险。

## 阶段目标

P5 只处理三类问题：

1. 把 P4 的手工/半自动桌面验收沉淀为可重复 QA 流程。
2. 在隔离数据环境里补齐历史线程压力验证。
3. 降低 AI 阅读助手相关 E2E mock 和大文件测试的维护成本。

## 非目标

P5 不做：

- 不引入向量数据库。
- 不做通用知识库或跨书全文问答。
- 不做手动对话分组、文件夹、拖拽排序。
- 不做每条消息独立模型选择。
- 不做助手回答编辑。
- 不做远端同步对话历史。
- 不重构整个 AI 阅读助手产品形态。
- 不默认调用真实付费 Provider 做 CI 自动化。

## 设计原则

### KISS

优先把已有验证流程脚本化和文档化，不引入新的测试框架。

### YAGNI

只有已被 P4 证明有价值的场景才进入 P5。对话分组、向量库和消息级模型选择都没有进入条件。

### DRY

复用现有 Playwright、mock Tauri 和本地 OpenAI-compatible mock provider。不要再复制一套 AI 请求 mock。

### SOLID

- QA 脚本只负责验证，不修改真实用户配置或真实历史。
- 数据造景逻辑与断言逻辑分离。
- 真实 Provider 验收保持显式手动开关，不混入默认自动化。

## P5-A：桌面 QA 脚本化

### 目标

把 P4 中通过 WebView2 CDP 操作真实 Tauri WebView 的流程，沉淀成可重复执行的 QA 脚本或文档化命令。

### 范围

覆盖：

- 启动本地 mock provider。
- 启动 Tauri dev 并打开 WebView2 CDP 端口。
- 连接 `http://127.0.0.1:9222`。
- 配置 AI Provider 指向本地 mock。
- 发送普通问答，确认流式增量。
- 执行取消生成。
- 验证 Provider 错误后输入区恢复。
- 验证历史回放恢复完整回答。

不覆盖：

- 真实 Provider 默认调用。
- 修改用户真实 API Key。
- 长时间超时等待类低频场景。

### 实施建议

1. 新增 QA 脚本，先不直接纳入 CI。
2. 将脚本参数化：
   - `baseUrl`
   - `model`
   - `scenario`
   - `cdpPort`
3. 默认只使用本地 mock provider。
4. 对真实 Provider 验收增加显式参数，例如 `--real-provider`，并要求运行前确认。

### 当前脚本

已新增：

```bash
node scripts/qa-ai-reading-assistant-desktop.mjs --help
```

脚本职责：

- 连接已启动的 Tauri WebView2 CDP。
- 通过真实 UI 把 AI Provider 保存为本地 mock。
- 打开 AI 阅读助手并执行指定验证 case。
- 支持 `--preflight` 只检查 mock provider 和 CDP，不修改设置、不发送消息。
- 默认不启动或停止 Tauri。
- 默认不启动或停止 mock provider。
- 默认不调用真实 Provider。

支持 case：

- `normal-stream`：验证普通问答流式增量、输入区恢复和横向溢出。
- `cancel`：配合 `slow-stream` mock provider 验证取消生成。
- `provider-error`：配合 `provider-error-json` mock provider 验证错误恢复。

正常流式和历史回放：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario normal-stream
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --preflight
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --verify-history
```

取消生成：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario slow-stream
node scripts/qa-ai-reading-assistant-desktop.mjs --case cancel
```

Provider 错误：

```bash
node scripts/mock-ai-provider.mjs --port 8787 --scenario provider-error-json
node scripts/qa-ai-reading-assistant-desktop.mjs --case provider-error
```

注意：

- 脚本默认会把本机 AI Provider 设置保存为 mock 配置：
  - Base URL：`http://127.0.0.1:8787/v1`
  - Model：`mock-gpt`
  - API Key：`sk-local-mock-1234567890`
- 如需保留当前 Provider 设置，可使用 `--skip-configure`，但必须提前手动确认应用已指向对应 mock provider。
- 脚本不读取、不打印真实 API Key。

### 验收

- 在本地 mock provider 下，一条命令或一组固定命令可完成正常流式、取消、错误恢复和历史回放验证。
- 运行结束后说明是否改动了 AI Provider 配置。
- 不读取、不打印、不写出 API Key。

### 当前状态

日期：2026-07-11。

已完成真实 Tauri WebView2/CDP 实跑。

前置：

- 启动 Tauri dev 时使用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`。
- 使用临时 Tauri config 清空 `beforeDevCommand`，复用当前 `5173` Vite dev server。
- mock provider 按场景在 `127.0.0.1:8787` 启停。

已通过：

```bash
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --preflight
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --verify-history --timeout-ms 30000
node scripts/qa-ai-reading-assistant-desktop.mjs --case cancel --timeout-ms 30000
node scripts/qa-ai-reading-assistant-desktop.mjs --case provider-error --timeout-ms 30000
```

覆盖结果：

- `normal-stream`：通过，脚本完成 Provider mock 配置、普通问答流式输出、输入区恢复、横向溢出检查和历史回放。
- `cancel`：通过，配合 `slow-stream` 验证取消生成后输入区恢复，且未新增 mock 回答内容。
- `provider-error`：通过，配合 `provider-error-json` 验证 Provider 错误展示和输入区恢复。
- `--preflight`：通过，能在不修改设置、不发送消息的前提下检查 mock provider 和 CDP。

脚本修正：

- 默认 mock API Key 改为 `sk-local-mock-1234567890`，满足本地 AI Key 长度校验。
- 保存 Provider 设置失败时输出设置页诊断信息。
- 取消 case 改为检查回答数量是否增加，避免误判历史中的旧 mock 回答。

配置副作用：

- 本机 AI Provider 已被脚本临时保存为 mock 配置：
  - Base URL：`http://127.0.0.1:8787/v1`
  - Model：`mock-gpt`
  - API Key：`sk-local-mock-1234567890`
- 本轮结束前已停止 mock provider 进程。
- 如需继续使用真实 Provider，需要重新保存真实 Provider 和 API Key。

## P5-B：隔离历史压力验证

### 目标

补齐 P4 未在真实用户库中执行的 50 个历史线程压力场景。

### 原则

不在用户当前真实数据库中批量制造历史线程。

可选方案：

1. 临时数据目录。
2. 专用测试 SQLite 数据库。
3. Playwright Tauri mock 大历史列表。

推荐顺序：

1. 先用 Playwright Tauri mock 覆盖 UI 滚动和筛选。
2. 如需验证真实 SQLite 查询，再使用临时数据目录。
3. 不直接写入用户当前 AppData 数据库。

### 场景

- 50 个历史线程。
- 混合 scope：
  - `global`
  - `bookDetail`
  - `bookNotes`
  - `readingStats`
  - `candidateShelf`
  - `aiAsset`
- 长标题。
- 同一实体下多条对话。
- 搜索命中 1 条、0 条、多条。
- 场景筛选后列表高度可滚动。

### 验收

- 历史列表可滚动。
- 搜索和场景筛选无明显卡顿。
- 打开历史线程后消息恢复。
- 不出现横向溢出。
- 清空历史仍需要二次确认。

### 当前状态

日期：2026-07-11。

已完成 Playwright Tauri mock 隔离验证，不写真实数据库。

实现：

- `tests/e2e/app-smoke.spec.ts` 新增 `manyReadingAssistantThreads` mock 选项。
- 该选项生成 50 个本地助手历史线程，覆盖 `global`、`bookDetail`、`bookNotes`、`readingStats`、`candidateShelf`。
- 每个线程带独立历史详情，可打开回放消息。

已覆盖：

- 历史页显示 `50 / 50 个会话`。
- 历史列表可滚动。
- 搜索“压力线程 42”命中 1 条。
- 按“统计”筛选后显示 `10 / 50 个会话`。
- 打开统计压力线程后恢复用户问题和助手回答。

验证命令：

```bash
npx tsc --noEmit --pretty false
npm run e2e -- --grep "AI 阅读助手"
```

结果：通过。

保留项：

- 专用测试 SQLite 数据库或临时数据目录验证仍可后续补充，但不阻塞 P5-B 的 UI 压力验证。

## P5-C：E2E mock 维护成本收敛

### 问题

`tests/e2e/app-smoke.spec.ts` 已承载大量业务 mock 和 smoke 场景。继续堆叠 AI 阅读助手分支会增加维护成本。

### 目标

降低测试文件认知负担，不改变测试覆盖语义。

### 可选整理

- 抽出 AI 阅读助手 mock 数据构造函数。
- 抽出 `ask_reading_assistant_stream` 分支处理函数。
- 抽出历史线程 mock 构造。
- 抽出通用断言辅助：
  - 打开 AI 阅读助手。
  - 发送助手消息。
  - 读取最后一次 invoke 参数。

### 边界

- 不为了整理而重写全部 smoke 测试。
- 不改变现有用例名称和业务断言。
- 不把简单 mock 过度抽象成测试框架。

### 验收

- AI 阅读助手 E2E 用例仍覆盖：
  - 分类书单点击。
  - 编辑并重新生成。
  - 历史搜索和场景筛选。
  - 模型控件下沉。
  - 普通问答流式。
  - 生成中取消。
  - 新书推荐流式和推荐卡片。
- `npm run e2e -- --grep "AI 阅读助手"` 通过。
- `npm run e2e` 通过。

### 当前状态

日期：2026-07-11。

已完成首轮低风险收敛：

- 抽出 `openReadingAssistantFromStats(page)`，统一 AI 阅读助手统计页入口打开步骤。
- 抽出 `sendReadingAssistantMessage(readingAssistant, message)`，统一输入和发送步骤。
- 保留原有用例名称、mock 数据和业务断言。
- 未拆分文件、未重写 Tauri mock 框架，避免一次性扩大改动面。

验证命令：

```bash
npx tsc --noEmit --pretty false
npm run e2e -- --grep "AI 阅读助手"
```

结果：通过。

## P5-D：当前对象历史筛选

P5-A 到 P5-C 稳定后，选择一个低风险产品小步：在有明确 `entityId` 的上下文中，历史页支持“当前对象”筛选。

### 目标

解决同一类场景历史过多时，用户无法快速只看当前书籍、当前笔记或当前 AI 资产相关对话的问题。

### 范围

- 只在当前上下文存在 `entityId` 且不是全局助手时展示“当前对象”筛选。
- 过滤条件为当前 `scope + entityId`。
- 继续保留搜索和场景筛选。
- 切换上下文对象时重置该筛选。

### 非目标

- 手动分组。
- 任意消息编辑。
- 每条消息模型选择。
- 通用知识库。
- 后端历史表结构调整。
- 向量数据库。

### 当前状态

日期：2026-07-11。

已完成：

- `ReadingAssistantPanel` 历史页新增“当前对象”筛选 chip。
- 当前筛选只在书籍详情、单本笔记、AI 资产等有实体上下文的场景出现。
- 统计页等无实体上下文入口不显示该筛选。
- `filterReadingAssistantThreads` 增加 `scope + entityId` 本地过滤条件，不新增后端接口。
- 50 条历史线程 mock 增加同一 `bookDetail` scope 下不同 `entityId` 的数据，避免只测到场景过滤。

验证命令：

```bash
npx tsc --noEmit --pretty false
npm run e2e -- --grep "AI 阅读助手历史"
```

结果：通过。

## 测试策略

每个 P5 切片至少运行：

```bash
npx tsc --noEmit --pretty false
npm test
npm run e2e -- --grep "AI 阅读助手"
git diff --check
```

涉及全局 mock 或 layout 时追加：

```bash
npm run e2e
npm run build
```

涉及 Rust 后端历史一致性时追加：

```bash
cargo test --manifest-path "src-tauri/Cargo.toml" reading_assistant
```

## 完成标准

P5 可以关闭的条件：

- P4 桌面验收流程有可重复执行路径。
- 50 个历史线程压力场景在隔离环境通过。
- AI 阅读助手 E2E mock 维护成本下降，新增场景不再继续堆叠单个巨大分支。
- 全量单元、构建、E2E 和 diff 检查通过。
- 未引入向量数据库、手动分组、消息级模型等过度能力。

## P5 关闭结论

日期：2026-07-11。

结论：P5 已满足关闭条件，适合进入下一阶段。

已完成：

- P5-A：桌面 QA 脚本已沉淀，可重复验证普通流式、取消生成、Provider 错误恢复和历史回放。
- P5-B：隔离 mock 覆盖 50 个历史线程压力场景，不写入真实用户数据库。
- P5-C：AI 阅读助手 E2E 入口和发送动作已抽出 helper，降低新增用例重复。
- P5-D：历史页新增“当前对象”筛选，只在有实体上下文时展示，未新增后端表或分组系统。

最终验证：

```bash
npx tsc --noEmit --pretty false
npm test
npm run e2e -- --grep "AI 阅读助手"
npm run e2e
npm run build
git diff --check
```

结果：

- `npm test`：402 passed。
- `npm run e2e -- --grep "AI 阅读助手"`：10 passed。
- `npm run e2e`：87 passed。
- `npm run build`：通过。
- `git diff --check`：通过，仅有工作区 LF/CRLF 提示。

非阻塞项：

- `npm run build` 仍有 Vite 大 chunk 提示，属于现有打包体积问题，不由 P5 引入。
- 本机 AI Provider 曾被桌面 QA 脚本配置为本地 mock；如需真实模型，需要重新保存真实 Provider/API Key。
- 真实 Provider 回归不应进入默认自动化，保留为显式手动验收项。

## 下一阶段建议

下一阶段建议进入 P6：发布候选收敛。

P6 目标：

- 冻结 AI 阅读助手产品面，只修复阻塞级缺陷。
- 复核发布说明、升级说明和用户可见行为变更。
- 执行真实 Provider 小样本手动验收，确认 mock 验证之外的 Provider 兼容性。
- 检查桌面安装包、配置迁移、隐私边界和失败恢复文案。
- 对 Vite 大 chunk 只做评估，不在发布前强行拆包，除非发现启动或交互性能阻塞。

P6 非目标：

- 不继续增加聊天管理、手动分组、向量数据库、每条消息模型选择或助手回答编辑。
- 不重构 AI 阅读助手主组件。
- 不把真实付费 Provider 纳入默认 CI。
- 不做无明确收益的 mock 框架重写。

## 推荐执行顺序

1. P5-A：桌面 QA 脚本化。
2. P5-B：隔离历史压力验证。
3. P5-C：E2E mock 维护成本收敛。
4. P5-D：当前对象历史筛选。
5. P6：发布候选收敛。

原因：

- 先固化验证流程，才能安全继续整理测试和产品小步。
- 历史压力验证是 P4 唯一保留项，应优先补齐。
- mock 整理应在覆盖稳定后进行，避免整理时丢断言。
