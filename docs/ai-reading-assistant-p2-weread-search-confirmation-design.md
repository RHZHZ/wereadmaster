# AI 阅读助手 P2：推荐书微信读书搜索确认设计文档

## 背景

P1 已完成：

- AI 新书推荐输出 `recommendedBooks`。
- 前端渲染推荐书列表。
- 用户确认后可加入本地候选书架。
- 加入后可跳转并刷新候选书架。

P2 目标是补上“微信读书搜索确认”：

```text
AI 推荐书
  -> 用户搜索确认
  -> 用户选择微信读书搜索结果
  -> 使用真实 bookId 加入候选
```

本设计只覆盖 P2a/P2b，不实现 P2c 的候选确认状态增强。

## 设计目标

- 推荐卡片内提供 `搜索确认`。
- 使用现有 `searchBooks` 搜索微信读书。
- 搜索结果在推荐卡片内展示。
- 用户手动选择搜索结果。
- 选择后使用真实微信读书 `bookId` 写入本地候选。
- 搜索失败或无结果时保留 P1 的“加入本地候选”降级路径。

## 非目标

本次不做：

- 不自动选择搜索结果。
- 不新增后端搜索命令。
- 不写入微信读书远端书架。
- 不做候选确认标识持久化。
- 不迁移已存在的 `ai-rec-*` 候选。
- 不做历史推荐卡片持久化。
- 不做 ISBN 或出版信息级别去重。

## 总体方案

前端在推荐卡片内扩展两个动作：

```text
[搜索确认] [加入本地候选]
```

搜索确认流程：

```text
点击搜索确认
  -> searchBooks({ keyword, scope: 0, count: 5 })
  -> 展示前 5 条结果
  -> 用户选择结果
  -> 确认加入候选
  -> upsertReadingItemState(realBookId)
```

P2 不需要新增 Rust 命令。搜索和候选写入都复用现有前端 API。

## 数据模型设计

### 推荐卡片搜索状态

```ts
type RecommendedBookSearchStatus =
  | "idle"
  | "searching"
  | "found"
  | "notFound"
  | "failed";

type RecommendedBookSearchState = {
  status: RecommendedBookSearchStatus;
  results: SearchResult[];
  errorMessage?: string;
};
```

组件状态建议：

```ts
const [recommendedBookSearchStates, setRecommendedBookSearchStates] =
  useState<Record<string, RecommendedBookSearchState>>({});
```

key 继续使用：

```ts
recommendedBookKey(book)
```

### 搜索关键词

```ts
function buildRecommendedBookSearchKeyword(book: ReadingAssistantRecommendedBook): string {
  return [book.title, book.author].filter(Boolean).join(" ").trim();
}
```

规则：

- 有作者：`书名 作者`
- 无作者：`书名`
- 不包含推荐理由、用户画像、笔记内容。

### 写入候选

用户选择微信读书结果后，写入：

```ts
await upsertReadingItemState({
  itemId: result.bookId,
  itemType: "candidate",
  status: "toRead",
  title: result.title,
  author: result.author,
  cover: result.cover,
  category: result.category,
  note: buildConfirmedAiRecommendationCandidateNote(book)
});
```

备注：

```text
来自 AI 阅读助手推荐：{reason}
适合点：{fit}
风险：{risk}
已通过微信读书搜索确认。
```

## 组件设计

### 推荐卡片动作区

当前 P1：

```text
[加入候选]
[查看候选]
```

P2 调整为：

```text
[搜索确认] [加入本地候选]
[查看候选]
```

说明：

- `加入本地候选` 对应 P1 的 `ai-rec-*` 降级路径。
- `搜索确认` 对应 P2 新路径。
- 搜索确认成功并加入后，状态同样变成 `已加入`。

### 搜索结果区

搜索结果展示在当前推荐项内部，不打开全局发现页。

结构：

```text
搜索结果
  书名 A / 作者 A / 分类
  [确认加入]

  书名 B / 作者 B / 分类
  [确认加入]
```

展示数量：

- 默认最多 5 条。
- P2 不做分页。
- 可提供“去发现页查看更多”作为后续增强，但本次不做。

### 空结果

```text
没有找到明确匹配项，可以先保存为本地候选。
```

保留 `加入本地候选` 按钮。

### 搜索失败

```text
搜索失败，可重试或先保存为本地候选。
```

保留：

- `重试搜索`
- `加入本地候选`

## 状态流

### 搜索成功

```text
idle
  -> searching
  -> found
  -> 用户选择结果
  -> adding
  -> added
```

### 搜索无结果

```text
idle
  -> searching
  -> notFound
  -> 用户可加入本地候选
```

### 搜索失败

```text
idle
  -> searching
  -> failed
  -> 用户可重试或加入本地候选
```

## 去重策略

### 选择搜索结果前

点击 `确认加入` 前读取：

```ts
const states = await listReadingItemStates();
```

判断：

- 如果 `state.itemId === result.bookId` 且 `itemType === "candidate"`，显示 `已在候选`。
- 如果 `state.itemId === result.bookId` 且其它阅读状态存在，提示已存在本地状态。

### 书架已有书

P2 可以先不在推荐卡片里实时检查 `bookshelf`。

原因：

- `ReadingAssistantPanel` 当前没有 bookshelf props。
- 为了判断已在书架引入全局书架依赖会扩大面板职责。

P2 先依赖候选去重。已在书架识别可进入 P2c 或候选书架/发现页层处理。

### 本地候选和真实结果重复

如果用户之前保存过 `ai-rec-*` 本地候选，再选择真实搜索结果：

P2 不自动删除 `ai-rec-*`。

原因：

- 删除涉及用户备注和状态迁移。
- 需要更完整的替换确认。

P2 只写入真实 `bookId` 候选；P2c 再设计合并/替换。

## API 使用

### 搜索

使用现有：

```ts
searchBooks({
  keyword,
  scope: 0,
  count: 5
});
```

`scope: 0` 使用全局搜索。

### 写入候选

使用现有：

```ts
upsertReadingItemState(input)
```

不新增 Tauri 命令。

## 错误处理

### 未登录或凭据失效

`searchBooks` 失败后：

- 显示 `搜索失败`。
- 使用 `getCommandErrorMessage` 展示错误。
- 保留本地候选降级按钮。

### 搜索返回空

- 状态设为 `notFound`。
- 显示空状态文案。
- 保留本地候选降级按钮。

### 确认加入失败

- 对应搜索结果按钮显示失败/可重试。
- 不影响推荐卡片其它操作。

## 样式设计

搜索结果不做大卡片，避免推荐项内卡片套卡片。

建议：

```css
.reading-assistant-search-results {
  border-top: 1px solid var(--line);
  margin-top: 10px;
  padding-top: 10px;
}

.reading-assistant-search-result {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 8px;
}
```

封面：

- 固定 40x56。
- 无封面时使用浅色占位。

按钮：

- 搜索确认。
- 确认加入。
- 重试搜索。

## 测试计划

### TypeScript 单元测试

如果 helper 独立导出，可测试：

- `buildRecommendedBookSearchKeyword`
- `findExistingCandidateState`
- `buildConfirmedAiRecommendationCandidateNote`

### 组件测试

建议新增：

- 点击搜索确认调用 `searchBooks`。
- 搜索结果渲染。
- 点击搜索结果调用 `upsertReadingItemState`。
- 搜索失败保留本地候选按钮。
- 搜索无结果显示空状态。

### 回归测试

- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/reading-api.test.ts`
- `npx vitest run src/App.test.ts`
- `npm run build`

## 实施顺序

### 第一步：前端状态与搜索

文件：

- `src/components/ReadingAssistantPanel.tsx`

任务：

- 新增 `recommendedBookSearchStates`。
- 新增 `handleSearchRecommendedBook`。
- 调用 `searchBooks`。
- 展示搜索状态。

### 第二步：搜索结果渲染

文件：

- `src/components/ReadingAssistantPanel.tsx`
- `src/styles.css`

任务：

- 渲染搜索结果列表。
- 每条结果提供 `确认加入`。
- 空结果和失败状态展示。

### 第三步：选择结果加入候选

文件：

- `src/components/ReadingAssistantPanel.tsx`

任务：

- 新增 `handleAddSearchResultCandidate`。
- 用真实 `bookId` 写入候选。
- 复用 P1 的刷新候选书架逻辑。

### 第四步：验证

任务：

- 类型检查。
- 前端测试。
- 构建。

## 关键边界

### 不自动选第一条

即使搜索结果只有一条，也必须让用户确认。

### 不删除 ai-rec 候选

真实 `bookId` 候选和 `ai-rec-*` 本地候选的合并/替换留给 P2c。

### 不把搜索结果发给 AI

搜索结果仅用于用户确认和本地候选写入。

### 不新增数据库字段

P2a/P2b 仅通过候选 `itemId` 是否真实 bookId 来获得更稳定关联。

## 验收标准

- 推荐卡片出现 `搜索确认`。
- 点击后能展示微信读书搜索结果。
- 用户选择结果后能用真实 `bookId` 加入候选。
- 搜索失败或无结果时仍可加入本地候选。
- 已存在真实 `bookId` 候选时不重复写入。
- 不影响普通 AI 对话和 P1 本地候选加入。

## 结论

P2a/P2b 应作为轻量前端增强实现：复用现有 `searchBooks` 和 `upsertReadingItemState`，不新增后端命令和数据库表。

这能把 AI 推荐从“可沉淀为本地候选”进一步提升为“可确认微信读书真实书籍后再沉淀”，同时保持用户确认边界。
