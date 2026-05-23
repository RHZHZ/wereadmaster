# 批量导出真实进度开发计划

## 目标

批量导出同步缺失笔记时，前端展示后端真实进度，而不是仅显示静态“正在同步”文案。

## 方案

- 后端在 `export_bulk_notes` 队列执行过程中发送 `bulk-export-progress` Tauri 事件。
- 前端在批量导出弹窗打开时订阅该事件，弹窗关闭时清理监听。
- UI 在运行阶段展示总数、已完成数、当前处理书籍、成功/失败/跳过/取消数量和进度条。
- 本地缓存导出、同步完成、失败、取消都计入同一个进度模型。

## 事件字段

- `phase`: `preparing`、`exportingCached`、`syncing`、`writingReport`、`completed`。
- `total`: 本次导出预检条目总数。
- `completed`: 已完成处理的条目数。
- `exported`: 已成功导出的条目数。
- `failed`: 失败条目数。
- `skipped`: 跳过条目数。
- `canceled`: 取消条目数。
- `active`: 当前正在处理的书籍，包含 `bookId` 和 `title`。
- `latest`: 最近完成的书籍结果，包含 `bookId`、`title`、`status`、`reason`。
- `message`: 面向用户的当前阶段说明。

## 验收

- 同步策略运行中能看到 `同步进度` 区域。
- 进度从 `0/N` 变为中间状态，再进入最终报告。
- 当前处理书籍名称可见。
- 失败或取消时进度统计准确反映状态。
- `npm test`、`npm run build`、批量导出 E2E 通过。
