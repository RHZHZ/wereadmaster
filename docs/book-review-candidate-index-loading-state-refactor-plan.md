# 书籍复盘候选索引加载状态改造方案

## 结论

需要改造。

当前复盘中心会在“本地笔记索引仍在读取”时，把 `notesOverview` 缺失临时当成空数组处理，导致页面同时出现：

- `正在读取本地笔记索引`
- `当前没有待生成复盘的书`

这两个状态语义冲突。更准确的表达应该是：已生成复盘缓存可以先展示，但待生成候选还在判断中，不能提前给出“没有待生成”的结论。

## 问题现象

截图中页面显示：

- 顶部 loading：`正在读取本地笔记索引`
- 概览卡片：`当前没有待生成复盘的书`
- 已生成列表：已有 5 本阅读报告
- 统计：`已生成 5 本`、`待整理 0 本`、`有反馈 0 本`

用户会自然理解为系统一边还在判断，一边已经下结论为 0。本质上不是缓存错误，而是加载中状态和空结果状态没有分层。

## 根因

文件：`src/pages/ReadingHubPage.tsx`

当前候选计算：

```ts
const reviewCandidates = getReviewCandidates(notesOverview?.books ?? [], summaryItems);
```

当 `notesOverview` 仍在加载时，`notesOverview?.books` 是 `undefined`，但这里会被转换成 `[]`。后续 `buildBookReviewAssetOverview` 只能看到：

```ts
summaries.length === 5
candidates.length === 0
```

于是它进入“已有复盘且没有候选”的 complete 分支，生成 `当前没有待生成复盘的书`。

这里缺少一个明确状态：

```ts
candidateIndexStatus: "loading" | "ready" | "unavailable"
```

## 改造目标

1. 区分“候选索引加载中”和“候选确实为空”

- 加载中不显示确定性空结论。
- 加载完成且候选为 0 时，才显示 `当前没有待生成复盘的书`。

2. 允许已生成缓存先展示

- `summaryItems` 已加载时，已生成复盘列表可以正常展示。
- 候选索引加载中时，不阻塞已生成列表。

3. 保持页面结构稳定

- 不改复盘生成逻辑。
- 不改缓存接口。
- 不改候选排序规则。
- 只修正状态派生和文案。

4. 降低 loading 视觉冲突

- 如果已经有已生成复盘，候选索引 loading 应更像“后台刷新状态”，而不是一个强占位 loading 卡。
- 如果没有任何已生成复盘，loading 可以保持更明显，避免空白。

## 推荐状态模型

在 `ReadingHubPage` 内派生候选索引状态：

```ts
const isCandidateIndexLoading = activeTab === "books" && isLoadingNotebook && !notesOverview;
const isCandidateIndexReady = Boolean(notesOverview);
const reviewCandidates = isCandidateIndexReady
  ? getReviewCandidates(notesOverview.books, summaryItems)
  : [];
```

如果后续需要区分接口失败，可以扩展为：

```ts
type ReviewCandidateIndexStatus = "loading" | "ready" | "failed" | "credentialMissing";
```

第一版不建议新增复杂枚举，保持 KISS。

## 概览构建改造

文件：`src/pages/book-review-asset-overview.ts`

建议给 `buildBookReviewAssetOverview` 增加一个可选输入：

```ts
candidateIndexLoading?: boolean;
```

输入类型：

```ts
export type BookReviewAssetOverviewInput = {
  summaries: BookAiSummaryListItem[];
  candidates: NotebookBook[];
  candidateIndexLoading?: boolean;
};
```

构建逻辑调整：

1. 有候选：保持当前 active 分支。
2. 无候选但 `candidateIndexLoading === true` 且有已生成缓存：显示“已生成缓存可用，候选索引更新中”。
3. 无候选且加载完成、有已生成缓存：显示当前 complete 分支。
4. 无候选且加载中、无已生成缓存：显示“正在读取本地笔记索引”或保留 empty/loading 文案。
5. 无候选且加载完成、无已生成缓存：显示当前 empty 分支。

推荐 loading 分支文案：

```text
label: "复盘缓存可用"
title: "正在更新待生成复盘的判断"
body: "已先展示本地已生成复盘；本地笔记索引读取完成后，会更新待生成书籍数量。"
nextActionLabel: "先回看"
nextActionTitle: "已生成复盘"
nextActionReason: "候选判断还在更新，可以先查看或导出已生成复盘。"
nextActionButtonLabel: "查看复盘"
```

如果已有 `topSummary`，下一步可指向 `summary`；如果没有 `topSummary`，下一步指向 `notes`。

## 页面渲染规则

文件：`src/pages/ReadingHubPage.tsx`

### 顶部候选索引 loading

当前：

```tsx
{isLoadingNotebook ? (
  <section className="book-detail-loading" aria-label="正在读取复盘候选">
    ...
  </section>
) : null}
```

建议改为：

- 当 `summaryItems.length === 0` 时，保留较明显 loading。
- 当 `summaryItems.length > 0` 时，改为轻提示，避免与已生成缓存区冲突。

推荐文案：

```text
正在后台更新本地笔记索引，已先展示已生成复盘。
```

### 建议生成复盘区域

当前无候选时直接显示：

```text
当前没有待整理成复盘的书。
```

建议加 loading 分支：

- `isCandidateIndexLoading === true`：显示 `正在判断哪些书适合生成复盘...`
- `isCandidateIndexReady && reviewCandidates.length === 0`：显示 `当前没有待整理成复盘的书。`

这样局部列表和上方概览语义一致。

## 具体实施步骤

1. 在 `ReadingHubPage` 派生：

- `isCandidateIndexLoading`
- `isCandidateIndexReady`
- `reviewCandidates`

2. 调整 `reviewCandidates` 计算：

- 不再使用 `notesOverview?.books ?? []` 表达加载中。
- 只有 `notesOverview` 存在时才计算候选。

3. 扩展 `buildBookReviewAssetOverview` 输入：

- 新增 `candidateIndexLoading?: boolean`。
- 增加 loading + generated cache 分支。

4. 调整 `BookReviewAssetOverviewPanel`：

- 优先不改组件结构。
- 仅通过 overview 文案和 tone 表达状态。
- 如需视觉区分，可新增 tone：`syncing`，但第一版建议复用 `complete` 或 `active`，避免样式扩散。

5. 调整建议生成区域空态：

- loading 中显示判断中。
- ready 且空才显示无待整理。

6. 更新测试：

- `book-review-asset-overview.test.ts` 增加“已有 summary 且 candidateIndexLoading 为 true”用例。
- `ReadingHubPage` 相关测试或 e2e 增加：读取本地笔记索引时不出现 `当前没有待生成复盘的书`。

## 验收标准

- 本地笔记索引加载中时，不再显示 `当前没有待生成复盘的书`。
- 已生成复盘缓存存在时，已生成列表仍可展示。
- 加载中概览文案说明“已先展示缓存，候选判断更新中”。
- `待整理 0 本` 不作为最终判断出现，除非 `notesOverview` 已加载完成。
- 建议生成区域在加载中显示判断中状态。
- 加载完成且确实无候选时，才显示无待整理/无待生成文案。
- 原候选排序规则不变。
- 原复盘生成入口不变。

## 不做范围

- 不改 `getNotebookOverview` 接口。
- 不改 `listBookNotesSummaries` 接口。
- 不改书籍复盘生成流程。
- 不改 AI 输出缓存结构。
- 不改候选排序算法。
- 不新增全局状态管理。
- 不引入复杂 skeleton 组件。

## 风险和注意事项

- 如果只改文案、不改状态派生，后续仍可能在其他区域出现“加载中 + 空结果”的冲突。
- 如果直接隐藏概览卡，会损失已生成缓存的可用性。
- 如果新增过多 tone 或布局，会让复盘中心样式扩散，第一版应保持最小改动。
- 如果 `hasCredential === false`，候选索引可能不会加载，需要避免永远显示 loading。

## 工程原则映射

KISS：

- 用派生布尔值区分 loading/ready，不引入复杂状态机。

YAGNI：

- 不重做复盘中心结构。
- 不新增接口和后端字段。

DRY：

- 继续复用 `buildBookReviewAssetOverview` 作为概览文案唯一入口。
- 继续复用 `getReviewCandidates` 的候选排序规则。

SOLID：

- `ReadingHubPage` 负责异步状态编排。
- `book-review-asset-overview` 负责根据输入状态生成展示模型。
- UI 组件只消费 overview，不直接理解数据加载细节。

## 推荐落地优先级

P0：

- 修正 `notesOverview?.books ?? []` 的加载中误判。
- 概览 loading 文案不再下确定性空结论。
- 建议生成区域增加 loading 分支。

P1：

- 调整 loading 视觉权重，从大 loading 卡改为轻提示。
- 增加 e2e 截图验证桌面布局。

P2：

- 如后续频繁出现类似问题，再抽象通用 `RemoteData<T>` 或 `Loadable<T>` 模型；当前不建议提前抽象。

## 实施结果

已完成 P0 修复：

- `ReadingHubPage` 不再使用 `notesOverview?.books ?? []` 把未加载候选索引误判为空数组。
- 新增 `shouldLoadCandidateIndex` / `isCandidateIndexLoading` 派生状态。
- 候选索引加载判断已改为独立的 `hasNotebookIndexLoadFailed`，不再依赖页面共享 `error`，避免 summaries 或其他请求错误误伤候选索引状态。
- 候选索引加载中时，概览卡显示 `正在更新待生成复盘的判断`，不再显示 `当前没有待生成复盘的书`。
- 候选索引加载中时，指标中的 `待整理` 显示为 `判断中`，不再显示最终态 `0 本`。
- 已生成复盘缓存存在时，顶部改为轻提示：`正在后台更新本地笔记索引，已先展示已生成复盘。`
- 建议生成区域在候选索引加载中显示 `正在判断哪些书适合生成复盘...`，加载完成且确实为空时才显示 `当前没有待整理成复盘的书。`

已补测试：

- `book-review-asset-overview.test.ts` 覆盖“已有复盘缓存 + 候选索引加载中”分支。
- `ReadingHubPage.test.tsx` 覆盖有凭据但 `notesOverview` 尚未存在时，页面显示 `判断中` 且不显示 `当前没有待生成复盘的书`。
- e2e 复盘中心相关用例通过。

验证命令：

- `npm test -- src/pages/book-review-asset-overview.test.ts src/pages/ReadingHubPage.test.tsx`
- `npm run build`
- `npx playwright test "tests/e2e/app-smoke.spec.ts" -g "复盘中心阅读指南库按书聚合展示并可查看书籍成果详情"`
