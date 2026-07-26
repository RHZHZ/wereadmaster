# Obsidian / Notion 双通道导出导入任务拆解

## 目标

把 [设计文档](./obsidian-notion-export-import-design.md)、[实施计划](./obsidian-notion-export-import-implementation-plan.md) 和 [接口设计](./obsidian-notion-export-import-interface-design.md) 拆成可执行任务，按最小风险顺序推进。

## 执行顺序

### 阶段 1：底层模型

先做不依赖 UI 的核心能力。

任务：

- 新增统一导出文档类型。
- 新增资源物化类型和 helper。
- 新增目标级结果类型。
- 保留现有 Markdown 导出逻辑作为内容来源。

涉及文件：

- `src-tauri/src/export/document.rs`
- `src-tauri/src/export/assets.rs`
- `src-tauri/src/export/targets.rs`
- `src-tauri/src/export/mod.rs`
- `src/lib/types.ts`

依赖：

- 现有 `markdown.rs`
- 现有笔记、AI 复盘、阅读指南、选书决策导出逻辑

### 阶段 2：Obsidian 配置与落盘

先打通本地 Vault 导出。

任务：

- 扩展本地配置结构。
- 新增 Obsidian 导出设置读写。
- 新增 Vault 路径选择。
- 实现 `.md` + 附件落盘。
- 封面本地化并引用。

涉及文件：

- `src-tauri/src/db.rs`
- `src-tauri/src/services/settings.rs`
- `src-tauri/src/export/obsidian.rs`
- `src-tauri/src/commands/settings.rs`
- `src/lib/types.ts`
- `src/lib/reading-api.ts`
- 相关设置页组件

依赖：

- 阶段 1 的统一文档模型

### 阶段 3：Notion 凭据与写入

先打通最小可用的页面创建。

任务：

- 新增 Notion 凭据服务。
- 新增 Notion 设置状态。
- 新增 Notion Token 保存、读取、删除、校验。
- 新增页面/数据库条目写入。
- 封面作为 page cover 写入。

涉及文件：

- `src-tauri/src/services/notion.rs`
- `src-tauri/src/commands/notion.rs`
- `src-tauri/src/platform/stronghold.rs`
- `src-tauri/src/services/settings.rs`
- `src-tauri/src/db.rs`
- `src/lib/types.ts`
- `src/lib/reading-api.ts`

依赖：

- 阶段 1 的统一文档模型
- 阶段 2 的资源物化逻辑

### 阶段 4：导出命令编排

把单资产导出接到多目标编排器。

任务：

- 新增多目标 request / response。
- 为单本笔记、复盘、阅读指南、统计复盘、选书决策增加目标导出命令。
- 命令层保持薄封装。

涉及文件：

- `src-tauri/src/commands/notes.rs`
- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src/lib/reading-api.ts`
- `src/lib/types.ts`

依赖：

- 阶段 1 至阶段 3

### 阶段 5：前端入口与结果面板

把导出能力暴露给用户。

任务：

- 增加目标选择。
- 增加 Obsidian / Notion 设置卡片。
- 增加导出结果分组展示。
- 保留现有 Markdown 导出按钮作为兜底。

涉及文件：

- `src/pages/BookNotesPage.tsx`
- `src/pages/BookAiSummaryPage.tsx`
- `src/pages/ReadingRoutePage.tsx`
- `src/pages/BookDecisionPage.tsx`
- `src/pages/NotesPage.tsx`
- `src/pages/SettingsPage.tsx`

依赖：

- 阶段 4 的 command 与 API

### 阶段 6：测试回归

把风险收口。

任务：

- Rust 单测覆盖模型、资源物化、目标结果。
- 前端单测覆盖 API 映射。
- E2E 覆盖导出路径。
- 手工验证 Obsidian Vault 和 Notion 页面效果。

涉及文件：

- `src-tauri/src/export/*.rs`
- `src-tauri/src/services/*.rs`
- `src/lib/*.test.ts`
- `src/pages/*.test.tsx`

## 文件级优先级

### P0

- `src-tauri/src/export/document.rs`
- `src-tauri/src/export/assets.rs`
- `src-tauri/src/export/targets.rs`
- `src-tauri/src/export/obsidian.rs`
- `src-tauri/src/services/notion.rs`

### P1

- `src-tauri/src/db.rs`
- `src-tauri/src/services/settings.rs`
- `src-tauri/src/commands/settings.rs`
- `src-tauri/src/commands/notes.rs`
- `src-tauri/src/commands/ai.rs`

### P2

- `src/lib/types.ts`
- `src/lib/reading-api.ts`
- `src/pages/SettingsPage.tsx`
- `src/pages/NotesPage.tsx`
- 相关单页导出按钮

## 风险控制

- 先实现 Markdown 兼容输出，再接 Obsidian。
- 先实现 Obsidian 本地成功，再接 Notion API。
- 每完成一个目标都先补单测，再补前端入口。
- 不在第一轮引入任务历史表或同步状态机。

## 完成标准

- [ ] 核心导出模型可复用。
- [ ] Obsidian 可直接导出到 Vault。
- [ ] Notion 可直接创建页面或数据库条目。
- [ ] 现有 Markdown 导出不回退。
- [ ] 前端能同时展示多目标结果。
- [ ] 配置和凭据边界清晰。

