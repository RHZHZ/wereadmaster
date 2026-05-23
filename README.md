# 微信读书个人阅读管理应用

这是一个本地优先的微信读书个人阅读管理桌面应用。前端使用 React/Vite，桌面壳和可信命令层使用 Tauri/Rust，微信读书 API Key 只由本地 Rust 层读取，前端不保存、不展示明文凭据。

## 当前范围

- 总览：展示本地书架摘要和同步状态。
- 书架：展示电子书、有声书和文章收藏，支持筛选与进入书籍详情。
- 书籍详情：展示元信息、阅读进度、章节和微信读书深链入口。
- 笔记：展示有笔记的书、单本划线/想法，并支持 Markdown 导出。
- 统计：展示周/月/年/总计阅读统计，并提供趋势分桶、长读书目、作者偏好、分类偏好和本地结构化解读。
- 发现：支持搜索、个性化推荐和相似书推荐。
- AI 复盘：单本笔记和阅读统计可主动生成结构化 AI 复盘，结果持久化到本地缓存。
- 设置：管理凭据、AI Provider、同步状态、本地缓存和危险操作确认。

## 本地开发命令

```powershell
npm run dev
npm test
npm run build
npm run e2e
```

Rust 侧验证在 `src-tauri` 目录执行：

```powershell
cargo fmt --check
cargo test --lib
cargo check
```

如果首次运行 Playwright 缺少浏览器：

```powershell
npx playwright install chromium
```

## 发布与一键更新

- Windows 正式发布通过 GitHub Releases 分发，仓库地址为 `RHZHZ/wxreadmaster`。
- 应用内“检查并更新”依赖 Tauri updater，从 GitHub Releases 的 `latest.json` 检查新版本。
- updater 公钥已写入 `src-tauri/tauri.conf.json`，私钥必须只保存在本机或 GitHub Actions Secrets 中。

发布前建议执行：

```powershell
npm test
npm run build
cargo check --manifest-path "src-tauri/Cargo.toml"
```

首次配置或更换签名密钥时：

```powershell
npm run tauri signer generate -- --ci -w "$env:USERPROFILE/.tauri/wxreadmaster.key"
```

本地执行 `npm run tauri build` 时，会优先自动读取 `C:\Users\RHZ\.tauri\wxreadmaster.key` 并注入 `TAURI_SIGNING_PRIVATE_KEY`；如果你显式设置了同名环境变量，则以环境变量为准。

完整发布说明见 `docs/github-release-updates.md`。

## 缓存策略

应用有两层缓存：

- **SQLite 持久缓存**：由 Rust 服务写入本地数据库，用于应用重启后继续读取书架、书籍、笔记、统计、发现等已同步数据。
- **React 内存缓存**：用于避免页面切换时重复请求本地 Tauri 命令，减少 loading 闪烁。

当前前端内存缓存范围：

- 书架：`App` 层保存 `BookshelfResponse`。
- 书籍详情：按 `bookId` 缓存 `BookDetailResponse`。
- 笔记概览：缓存 `NotebookOverviewResponse`。
- 单本笔记：按 `bookId` 缓存 `BookNotes`。
- 阅读统计：按 `ReadingStatsMode` 缓存 `ReadingStatsResponse`。

AI 总结缓存：

- 持久化存入 SQLite `ai_outputs.output_json`。
- 当前单本笔记总结 prompt 版本为 `book-notes-summary-v3`。
- 当前阅读统计复盘 prompt 版本为 `reading-stats-review-v1`。
- 缓存 key 由 `feature + bookId + promptVersion + inputHash` 组成，笔记内容变化后不会误用旧总结。
- 统计复盘缓存 key 由 `feature + mode:baseTime + promptVersion + inputHash` 组成，统计周期或统计内容变化后不会误用旧复盘。

刷新规则：

- 页面内“同步/刷新/重试”按钮会强制重新调用本地命令并覆盖对应缓存。
- 清除本地缓存或移除凭据后，前端内存缓存也会同步清空。
- 设置页不做强缓存，打开或刷新时应反映最新本地状态。

## UI 布局策略

- 桌面端侧边栏使用 sticky，主内容滚动时导航保持可见。
- 工具型长列表按使用场景控制滚动：书架、目录、同步状态、缓存表，以及统计页的长读书目、作者偏好、分类偏好都使用卡片内局部滚动。
- 阅读和探索型内容保持整页滚动：发现页结果/推荐列表、单本笔记正文不做内部滚动，避免嵌套滚动影响浏览节奏。
- 发现页搜索和起步行动是主内容；“为你推荐”默认只作为轻量辅助短清单展示，避免右侧长列表压过搜索任务。
- 980px 以下窄屏取消主要内部滚动限制，优先使用自然页面滚动。

## 视觉素材策略

- 普通交互 UI 保持 code-native，不使用位图模拟控件、卡片或文本。
- Image2 仅用于高感知、低频变化素材：应用图标、首次设置引导图、空状态插画、发布/安装封面图。
- 生成素材默认不内嵌文字，具体说明和按钮文案由 React 组件渲染，确保可访问、可响应式和可维护。
- Tauri 打包图标由 `src-tauri/icons/icon-v2.ico` 提供，并在 `src-tauri/tauri.conf.json` 的 `bundle.icon` 中声明。
- Image2 生成的项目素材位于 `src/assets/generated/`，原始输出保留在 `output/imagegen/` 便于复查。

## E2E 测试说明

Playwright smoke 测试位于 `tests/e2e/app-smoke.spec.ts`，通过 `page.addInitScript` mock `window.__TAURI_INTERNALS__.invoke`，不需要真实微信读书 API Key。

后续功能收口优先级见 `docs/reading-management-closure-roadmap.md`，当前重点是总览主动作、统计总计模式、非电子书边界和核心空态/错误态。

覆盖内容：

- 首次启动和设置引导。
- 总览、书架、书籍详情、笔记、单本笔记、统计、发现、设置。
- 设置页清缓存确认弹窗。
- AI 总结独立页、缓存读取、主题标签、代表性摘录和复盘问题展示。
- 统计页 AI 阅读复盘、缓存读取、作者/分类偏好、长读书目和结构化洞察展示。
- 桌面端和窄屏横向溢出检查。
- 书籍详情、笔记概览、单本笔记、统计页的前端缓存调用次数断言。

## 安全边界

- 前端只调用本地 Tauri 命令，不直接请求微信读书 API。
- 微信读书 API Key 和已保存的 AI API Key 不进入 React state、不写入前端日志、不导出到 Markdown。
- AI 调用只在用户点击生成时发送当前书的划线和想法，不发送全量书架或其他书籍笔记。
- 统计页 AI 复盘只发送当前周期结构化统计，不发送笔记正文、书籍全文或原始 API 响应。
- 清除缓存和移除凭据都需要用户确认。
- 本地缓存清除不会自动移除 API Key，凭据移除不会自动删除已缓存阅读数据。
