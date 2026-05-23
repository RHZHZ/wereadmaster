# 同步卡顿改造规划

## 背景

当前项目里的“同步”在接口层是异步的，但这不等于整条链路都不会阻塞主线程。

现状判断：

- 前端通过 `await invoke(...)` 调用 Tauri 命令，网络请求本身是异步的。
- 后端同步流程里仍然包含同步 SQLite 读写、事务提交、JSON 落盘和状态更新。
- 前端在接收整包数据后，会触发大范围状态更新和列表派生计算。
- 书架、总览和统计页都存在“刷新一次，整页重算一次”的特征。

结论：

> 卡顿不是单一原因，而是后端同步写库 + 前端整包重渲染 + 派生计算叠加造成的。

## 目标

1. 让同步刷新时的 UI 反馈更快。
2. 减少刷新后主线程的集中计算。
3. 保持现有数据模型和用户操作语义不变。
4. 先验证瓶颈，再做针对性优化，避免过度重构。

## 现状问题

### 后端

- [`src-tauri/src/services/shelf.rs`](../src-tauri/src/services/shelf.rs) 的 `sync_shelf` 在网络异步完成后，会同步执行 SQLite 写入、缓存写入和同步状态更新。
- [`src-tauri/src/services/stats.rs`](../src-tauri/src/services/stats.rs) 的 `sync_reading_stats` 有同样问题。
- [`src-tauri/src/services/shelf.rs`](../src-tauri/src/services/shelf.rs) 中的 `replace_shelf_entries` 逐条 `INSERT`，在条目较多时会放大写库时间。

### 前端

- [`src/App.tsx`](../src/App.tsx) 在同步完成后直接 `setBookshelf(response)`，会让整棵依赖树一起更新。
- [`src/pages/BookshelfPage.tsx`](../src/pages/BookshelfPage.tsx) 每次渲染都会重新计算分类、过滤结果和可见列表。
- [`src/pages/DashboardPage.tsx`](../src/pages/DashboardPage.tsx) 每次渲染都会重建多个 `Map` 和派生队列。

## 改造原则

- 先测量，再优化。
- 先拆重计算，再考虑更大范围的结构调整。
- 先保持行为不变，再考虑接口拆分。
- 不引入暂时用不上的新抽象。

## 实施顺序

### 1. 建立基线

先在同步链路上加轻量计时，确认每一段耗时占比：

- 前端发起同步到收到结果。
- 后端网络请求耗时。
- 后端 SQLite 写入耗时。
- 前端状态写入和页面重渲染耗时。

验收标准：

- 能明确指出卡顿主要发生在后端写库、前端重算，还是两者叠加。

### 2. 前端止血

先把最容易重复计算的派生数据收起来：

- 书架页的分类统计、过滤结果、可见分类选项。
- 总览页的书架映射、队列条目、今日动作和推荐列表。
- 只在输入变化时重算，不在每次 render 时重复跑。

验收标准：

- 刷新后页面仍然能显示相同内容。
- 过滤、切换分类和同步完成后的 UI 响应更平滑。

### 3. 后端减重

把同步命令里的同步写库路径做轻量化：

- 保持网络请求异步。
- 减少逐条写入次数，优先批量化或事务内批量执行。
- 将非关键结果写入放到更靠后的阶段，避免把主流程拖长。

验收标准：

- 同步完成时间下降。
- 同步时 UI 卡顿不再集中出现在落库阶段。

### 4. 验证回归

做一次完整验证：

- 首次进入应用。
- 手动同步书架。
- 刷新统计。
- 在书架页切换筛选和搜索。

验收标准：

- 没有功能回退。
- 主线程卡顿明显降低。
- 页面渲染和数据刷新保持一致。

## 非目标

- 不在这一轮重写数据协议。
- 不在这一轮改数据库结构。
- 不引入自动后台同步。
- 不改变“手动触发同步”的产品边界。

## 风险点

- 只做前端缓存可能掩盖后端瓶颈，但不能根治。
- 只做后端批处理可能仍然被大列表渲染拖慢。
- 如果一次刷新返回的数据量本来就大，最终可能还需要列表虚拟化。

## 当前建议

优先执行顺序：

1. 先加计时定位。
2. 再做前端派生计算收敛。
3. 最后优化后端落库路径。

这是最低风险、也最容易看见收益的路线。

## 已完成改造

### 1. 同步链路计时

已在前端 Tauri 调用外层增加轻量计时：

- `getCredentialStatus`
- `getBookshelf`
- `syncShelf`

已在后端同步链路增加分段计时：

- `shelf.network`
- `shelf.persist`
- `shelf.read_cache`
- `stats.network`
- `stats.persist`
- `stats.read_cache`

用途：

- 前端控制台用于观察一次 `invoke` 的整体耗时。
- Tauri 控制台用于区分网络请求、缓存读取和 SQLite 写入耗时。

### 2. 前端派生计算收敛

已处理 [`src/pages/BookshelfPage.tsx`](../src/pages/BookshelfPage.tsx)：

- 书架条目引用稳定化。
- 分类选项、可见分类、过滤结果改为按依赖变化重算。

已处理 [`src/pages/DashboardPage.tsx`](../src/pages/DashboardPage.tsx)：

- 书架条目映射、笔记映射、最近阅读、阅读队列、候选推荐和今日动作改为按依赖变化重算。
- 避免同步完成后由于无关状态变化导致总览页重复构建大对象。

已处理 [`src/App.tsx`](../src/App.tsx)：

- 首次读取书架和手动同步后的大状态写入改为 `startTransition`。
- 让 React 将整包书架刷新视为非紧急更新，减少对输入和按钮反馈的抢占。

### 3. 后端阻塞读写迁移

已处理 [`src-tauri/src/services/shelf.rs`](../src-tauri/src/services/shelf.rs)：

- `get_bookshelf` 改为异步命令路径，并通过 `spawn_blocking` 读取 SQLite。
- `sync_shelf` 保持网络请求异步，落库、缓存写入和同步状态更新通过 `spawn_blocking` 执行。
- `replace_shelf_entries` 在事务内复用预编译 `INSERT` 语句，减少逐条准备 SQL 的开销。

已处理 [`src-tauri/src/services/stats.rs`](../src-tauri/src/services/stats.rs)：

- `get_reading_stats` 改为异步命令路径，并通过 `spawn_blocking` 读取 SQLite。
- `sync_reading_stats` 保持网络请求异步，统计落库、缓存写入和同步状态更新通过 `spawn_blocking` 执行。
- `upsert_reading_stats` 使用预编译语句。

相关命令和调用方已同步改为异步：

- [`src-tauri/src/commands/shelf.rs`](../src-tauri/src/commands/shelf.rs)
- [`src-tauri/src/commands/stats.rs`](../src-tauri/src/commands/stats.rs)
- [`src-tauri/src/services/ai.rs`](../src-tauri/src/services/ai.rs)
- [`src-tauri/src/commands/ai.rs`](../src-tauri/src/commands/ai.rs)

## 验证记录

已完成自动验证：

- `npm run build`
- `npm run test`
- `cargo check`
- `cargo test`

待完成手工验证：

1. 启动 Tauri 应用。
2. 手动刷新书架。
3. 切换书架筛选和搜索。
4. 刷新阅读统计。
5. 对照前端控制台和 Tauri 控制台中的 `[sync]` 计时日志。

## 剩余风险

- 如果书架数据量很大，列表本身渲染仍可能成为主要瓶颈，下一步应考虑书架列表虚拟化。
- 当前计时使用 `console.debug` 和 Tauri 控制台输出，适合开发排查；如果生产包不希望输出调试信息，可以后续加开发环境开关。
- `mark_syncing` / `mark_failed` 在书架和统计服务中仍有相似代码；目前为保持改动范围可控暂不抽象，后续若同步模块继续增加，再提取公共 helper。
