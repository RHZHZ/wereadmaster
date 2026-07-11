# AI 阅读助手 P6 发布候选收敛计划

## 背景

P5 已关闭，AI 阅读助手的桌面 QA 脚本、历史压力验证、E2E mock 收敛和当前对象历史筛选均已完成。P6 不再扩产品能力，目标是把 v1.0.12 发布候选稳定下来。

P6 的判断标准不是“还能不能加功能”，而是“是否已经能安全发布”。

## 阶段目标

1. 冻结 AI 阅读助手功能面。
2. 复核用户可见文案与当前实现一致。
3. 执行发布候选级别的本地回归、桌面回归和真实 Provider 小样本验收。
4. 明确阻塞缺陷、非阻塞风险和发布后观察项。
5. 保持本地优先和用户自备 Key 的隐私边界。

## 非目标

P6 不做：

- 不引入向量数据库。
- 不做手动对话分组、文件夹、拖拽排序。
- 不做每条消息独立模型选择。
- 不做助手回答编辑。
- 不重构 `ReadingAssistantPanel` 主体结构。
- 不把真实付费 Provider 纳入默认 CI。
- 不在发布前强行拆分 Vite 大 chunk，除非发现明确启动或交互阻塞。

## 发布候选冻结规则

进入 P6 后，只接受三类变更：

1. 阻塞缺陷修复。
2. 发布说明、更新说明、验收清单等文档修正。
3. 不改变功能语义的测试补强。

以下需求统一延后：

- 对话分组。
- 多模型对比。
- 任意历史消息编辑。
- 知识库、全文检索、向量召回。
- 远端同步对话历史。

## 当前发布口径

v1.0.12 用户可见能力应统一描述为：

- AI 阅读助手支持全局、当前书、单本笔记、统计、候选书架、AI 资产和本地选区等阅读上下文。
- 普通问答和新书推荐支持流式输出。
- 支持取消生成、上下文开关、本地线程历史、删除单个线程和清空历史。
- 输入框内展示当前模型状态，可跳转 AI 设置；生成中禁用模型菜单动作。
- 支持编辑最后一条用户消息并重新生成。
- 历史页支持搜索、场景筛选和当前对象筛选。
- 新书推荐以结构化卡片展示，可加入候选书架，也可通过微信读书搜索确认。
- 分类书目查询只列出本地可验证书目，不把统计总数扩写成无法确认的书名。
- 应用仍然本地优先，AI Provider 由用户自备，不做中转。

## 必跑验证

### 本地自动化

```bash
npx tsc --noEmit --pretty false
npm test
npm run e2e -- --grep "AI 阅读助手"
npm run e2e
npm run build
git diff --check
```

通过标准：

- TypeScript 无错误。
- 单元测试全绿。
- AI 阅读助手 E2E 全绿。
- 全量 E2E 全绿。
- 生产构建成功。
- `git diff --check` 无空白错误；LF/CRLF 提示不算失败。

### 桌面 mock Provider QA

按场景启动本地 mock provider，并连接 Tauri WebView2 CDP：

```bash
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --preflight
node scripts/qa-ai-reading-assistant-desktop.mjs --case normal-stream --verify-history --timeout-ms 30000
node scripts/qa-ai-reading-assistant-desktop.mjs --case cancel --timeout-ms 30000
node scripts/qa-ai-reading-assistant-desktop.mjs --case provider-error --timeout-ms 30000
```

通过标准：

- 普通问答出现流式增量，最终回答完整。
- 历史回放能恢复完整回答。
- 取消生成后输入区恢复，且取消后的内容不进入会话。
- Provider 错误可见，输入区恢复可继续使用。
- 脚本不读取、不打印真实 API Key。

### 真实 Provider 小样本

真实 Provider 验收必须手动触发，不进入默认 CI。

建议覆盖：

- OpenAI-compatible Provider 基础问答。
- DeepSeek 或其他非 OpenAI 官方 Provider 的兼容策略。
- 普通问答流式输出。
- 新书推荐结构化卡片。
- Provider 返回 `response_format` 不兼容时的错误恢复。

通过标准：

- 至少一个真实 Provider 能完成普通问答。
- 至少一个真实 Provider 能完成新书推荐或明确展示兼容错误。
- 失败时不丢输入、不卡住生成状态、不泄露 Key。

## 发布文档检查

需要保持一致的文件：

- `docs/release-notes-v1.0.12.json`
- `docs/release-notes-v1.0.11.json`
- `docs/wechat-promo-v1.0.11.md`
- `docs/wechat-update-v1.0.11.md`
- `docs/ai-reading-assistant-p5-stability-plan.md`
- `docs/ai-reading-assistant-p6-release-candidate-plan.md`

检查点：

- 不再把上下文数量写死为旧口径。
- 不承诺未实现的对话分组、向量检索、远端同步或消息级模型选择。
- 隐私边界保持一致：用户自备 Key、本地优先、手动触发 AI。
- 发布说明中的版本号与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 一致。

## 阻塞缺陷定义

发现以下问题不得发布：

- AI 阅读助手普通问答无法完成。
- 生成中取消后 UI 卡死或无法再次发送。
- Provider 错误后输入区无法恢复。
- 历史线程打开后消息错乱、串线程或展示其他对象历史。
- 清空历史缺少确认或误删非助手数据。
- 分类书目查询把统计数量扩写成不可验证书名。
- API Key、Provider Key 或敏感诊断信息出现在 UI、日志、文档或测试输出中。
- Windows 安装包、`latest.json` 或签名产物缺失。
- Android APK 签名校验失败。

## 非阻塞风险

以下问题可记录但不阻塞 v1.0.12：

- Vite 构建的大 chunk 提示。
- 少量 Provider 对结构化输出不兼容，但 UI 能给出可操作错误。
- 真实 Provider 响应速度波动。
- 长历史列表进一步虚拟化优化。
- E2E mock 继续拆分文件。

## 发布后观察项

发布后优先观察：

- 用户是否能正确配置 Provider。
- DeepSeek、DashScope、Moonshot 等兼容 Provider 的失败模式。
- AI 推荐书加入候选后的确认率。
- 历史页搜索和当前对象筛选是否足够好用。
- 大量历史线程下是否需要后端分页或虚拟列表。

## 当前状态

日期：2026-07-11。

已完成：

- P5 关闭结论已写入 `docs/ai-reading-assistant-p5-stability-plan.md`。
- `docs/release-notes-v1.0.12.json` 已新增，并写清当前 AI 阅读助手收口和发布候选验证项。
- `docs/release-notes-v1.0.11.json` 已更新为当前 AI 阅读助手能力口径，保留为上一版本说明修正。
- `docs/wechat-promo-v1.0.11.md` 和 `docs/wechat-update-v1.0.11.md` 已修正文案中的上下文范围。
- 版本号已复核：
  - `package.json`：`1.0.12`
  - `package-lock.json`：`1.0.12`
  - `src-tauri/Cargo.toml`：`1.0.12`
  - `src-tauri/tauri.conf.json`：`1.0.12`
  - `src-tauri/Cargo.lock`：`personal-reading-app 1.0.12`
  - `README.md`：`v1.0.12`
  - `docs/release-notes-v1.0.12.json`：`v1.0.12`
- 本地自动化验证已通过：
  - `npx tsc --noEmit --pretty false`
  - `npm test`：402 passed
  - `npm run e2e -- --grep "AI 阅读助手"`：10 passed
  - `npm run e2e`：87 passed
  - `npm run build`
  - `git diff --check`
  - `cargo check --manifest-path "src-tauri/Cargo.toml"`
- Release notes 本地 dry-run 已通过：
  - tag：`v1.0.12`
  - release notes version：`v1.0.12`
  - Windows 归一化安装包名：`wereadmaster_1.0.12_x64-setup.exe`
  - Android versionCode：`1000012`

本轮非阻塞提示：

- `npm run build` 仍有 Vite 大 chunk 提示。
- `git diff --check` 仅输出 LF/CRLF 提示。
- `cargo check` 通过，但保留若干既有 `dead_code` / unused 警告。

本轮未通过 / 未完成项：

- 本地执行 `npm run tauri build` 超过 5 分钟未结束，已停止本轮启动的 build 进程。
- 上一轮本地打包目录生成了 `个人阅读管理_1.0.11_x64-setup.exe`，但未生成对应 `1.0.11` 的 `.sig`。
- 本地存在默认 Tauri updater 签名 key 文件，但当前 shell 未设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。这不能代表 CI 失败，发布前仍必须以 GitHub Actions Secrets 环境下的产物为准。

待执行：

- 根据真实 Provider 小样本结果决定是否只修阻塞缺陷。
- 发布前复核 GitHub Release 产物、`.sig` 签名和 `latest.json`。
