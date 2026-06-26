# 阅读指南节点详情弹窗改造方案

## 背景

`ReadingRouteResultPanel` 中的 `reading-guide-map` 负责把本书阅读指南或跨书路线压缩成可扫描的节点图。当前 `reading-guide-node` 会对标题、阅读目的和元信息做截断，能保证路线图整洁，但用户想核对完整阅读目的、依据、投入和节点角色时，需要到下方长内容区寻找对应信息。

本次改造目标不是把完整阅读指南重新塞进弹窗，而是让单个节点支持“点开看完整节点信息”。页面主内容仍然保留完整连续阅读能力，弹窗只作为路线图节点的局部放大镜。

## 产品原则

### 1. 主图先可读，弹窗只补全

节点默认必须能回答：

- 这是哪本书或哪个推进阶段
- 这个节点的核心任务是什么
- 大致需要投入多少

弹窗只展示被截断或补充字段，不应成为理解路线的唯一入口。

### 2. 不违背“完整指南不放弹窗”的既有边界

既有原则是：完整阅读指南、跨书路线和历史版本不使用弹窗承载长内容。

本次允许的弹窗范围：

- 单个 `reading-guide-node` 的完整字段
- 当前节点相关的依据、目的、投入、状态和依赖
- 少量上下文操作，例如复制节点内容

不允许：

- 在弹窗中展示整份阅读指南
- 在弹窗中平铺所有节点
- 用弹窗替代版本详情页或页面下方完整结构化内容

### 3. 可点击状态要明确

节点如果支持打开详情，视觉上必须表达为可交互元素：

- hover / focus 状态
- 右上角或尾部有展开图标
- 键盘可聚焦
- `aria-label` 能说明会打开哪个节点的详情

## 用户视角

用户进入阅读指南后，先看到路线图：

1. 快速扫一遍每个节点，理解先读什么、为什么读、投入多少。
2. 发现某个节点文字被截断或需要确认依据时，点击该节点。
3. 弹窗展示完整阅读目的、预计投入、当前状态、依据和依赖。
4. 关闭后回到路线图，不打断继续阅读下方完整指南。

## 信息架构

### 单书指南节点

单书指南节点来自 `buildSingleBookGuideNodes(currentBook, route)`。

建议弹窗字段：

- 节点标题：例如 `明确阅读目标`、`推进当前书`、`复盘输出`
- 节点标签：例如 `当前书`、`复盘点`
- 完整说明：节点原始 `detail`
- 元信息：节点原始 `meta`
- 相关书籍：当前书标题、作者
- 对应完整区块：如能映射到 `guideDetails.tasks / checkpoints / actions`，展示简短引用

### 跨书路线节点

跨书节点来自 `route.books`。

建议弹窗字段：

- 书名
- 作者
- 节点顺序
- 节点角色：`role`
- 阅读目的：`readingPurpose`
- 预计投入：`estimatedEffort`
- 本地状态：`localStatus`
- 依据：`basis`
- 依赖关系：
  - 前置书：`dependencies.fromBookId -> currentBookId`
  - 后续书：`dependencies.currentBookId -> toBookId`

## 交互设计

### 打开方式

将节点内部的 `article.reading-guide-node` 改为按钮语义，推荐实现：

```tsx
<button
  type="button"
  className="reading-guide-node reading-guide-node--interactive"
  aria-label={`查看${node.label}的完整阅读节点详情`}
  onClick={() => setActiveNode(node)}
>
  ...
</button>
```

如果保留 `article`，则内部放一个覆盖式按钮，但要避免嵌套可交互元素。

### 弹窗形态

桌面端：

- 居中 modal 或右侧轻量 drawer 均可。
- 当前页面已有较多纵向内容，优先建议 modal，避免和页面滚动区竞争。

移动端：

- 使用 bottom sheet 样式。
- 最大高度不超过视口 80%，内容区内部滚动。

### 关闭方式

必须支持：

- 关闭按钮
- `Esc`
- 点击遮罩
- 关闭后焦点回到触发节点

### 操作

首版只建议提供：

- `复制节点内容`
- `关闭`

暂不做：

- 编辑节点
- 为节点单独记录反馈
- 跳转到某个内部锚点
- 节点级任务拆解

## 技术方案

### 1. 扩展节点视图模型

当前 `GuideMap` 内部节点只有：

```ts
{
  id: string;
  label: string;
  eyebrow: string;
  detail: string;
  meta: string;
}
```

建议扩展为：

```ts
type GuideMapNode = {
  id: string;
  label: string;
  eyebrow: string;
  detail: string;
  meta?: string;
  fullDetail: string;
  fullMeta?: string;
  fields: Array<{
    label: string;
    value: string;
  }>;
};
```

节点卡片继续展示截断后的 `detail / meta`，弹窗读取 `fullDetail / fullMeta / fields`。

### 2. 单书节点适配

`buildSingleBookGuideNodes` 当前可能只返回展示字段。为了避免破坏已有调用，可以采用渐进式扩展：

- 保留已有字段。
- 新增可选字段 `fullDetail / fullMeta / fields`。
- `GuideMap` 中对缺失字段做 fallback。

### 3. 跨书节点适配

跨书节点在 `GuideMap` 内由 `route.books.map` 生成，直接补全：

```ts
fields: [
  { label: "角色", value: book.role },
  { label: "阅读目的", value: book.readingPurpose },
  { label: "预计投入", value: book.estimatedEffort },
  { label: "本地状态", value: book.localStatus },
  { label: "依据", value: book.basis }
]
```

依赖关系可通过 `route.dependencies` 过滤当前 `bookId` 得到。

### 4. 组件拆分

建议新增内部小组件：

- `GuideMap`
- `GuideMapNodeButton`
- `GuideNodeDetailDialog`

保持在 `ReadingRouteResultPanel.tsx` 内部即可，暂不抽成公共组件。这样符合 KISS / YAGNI，避免为单一页面提前建立组件库抽象。

### 5. 样式

新增样式建议：

- `.reading-guide-node--interactive`
- `.reading-guide-node-action`
- `.reading-guide-node-dialog-backdrop`
- `.reading-guide-node-dialog`
- `.reading-guide-node-dialog-fields`

节点尺寸仍保持稳定：

- 不因 hover 图标出现而改变高度
- 弹窗内容滚动，不撑破视口
- 移动端节点仍保持单列或双列响应式规则

## 无障碍要求

- 弹窗使用 `role="dialog"` 和 `aria-modal="true"`。
- 弹窗标题通过 `aria-labelledby` 关联。
- 节点按钮必须可键盘触发。
- `Esc` 关闭弹窗。
- 关闭后焦点回到原节点。
- 复制按钮成功后用现有 toast 反馈。

## 测试计划

### 单元 / 组件测试

在 `ReadingRouteResultPanel.test.tsx` 增加：

1. 单书指南节点渲染为可点击按钮。
2. 点击节点后展示完整节点详情。
3. 跨书路线节点弹窗展示完整 `readingPurpose / estimatedEffort / basis`。
4. 关闭弹窗后详情消失。
5. 没有额外字段时仍能 fallback 到现有展示内容。

### 构建验证

- `npm test -- --run src/pages/reading-route/ReadingRouteResultPanel.test.tsx`
- `npm run build`
- `git diff --check`

## 验收标准

- 路线图节点默认仍然紧凑、稳定、可扫描。
- 任意节点可点击查看完整内容。
- 弹窗只展示单节点详情，不展示整份阅读指南。
- 桌面和移动端文本不溢出、不遮挡、不撑破视口。
- 键盘和读屏用户能打开、关闭并理解弹窗。
- 不改变 AI 输出结构、不修改后端 schema、不新增数据库字段。

## 不做范围

- 不新增节点级反馈状态。
- 不新增节点编辑能力。
- 不新增历史版本弹窗。
- 不把整份阅读指南搬进 modal。
- 不修改 prompt 或 AI 输出 JSON schema。

## 当前落地状态

已完成首版落地：

- `reading-guide-node` 已改为按钮语义，支持鼠标点击和键盘触发。
- 单书指南节点补充了完整字段，包含书名、作者、本地状态、依据、阅读任务、复盘问题和验收标准等。
- 跨书路线节点补充了作者、角色、阅读目的、预计投入、本地状态、依据、前置依赖和后续依赖。
- 节点详情弹窗使用 `role="dialog"` 和 `aria-modal="true"`，支持关闭按钮、`Esc`、点击遮罩关闭，并在关闭后把焦点还给触发节点。
- 弹窗只展示单个节点的详情和复制操作，不承载整份阅读指南。
- 桌面端使用居中 modal；移动端使用 bottom sheet 样式，内容区内部滚动。

已验证：

- `npm test -- --run src/pages/reading-route/ReadingRouteResultPanel.test.tsx`
- `npm test -- --run`
- `npm run build`
- `git diff --check`

仍建议在后续 UI 回归中覆盖：

- 桌面端和移动端真实点击后的视觉布局。
- 长标题、长依据、多条依赖时的弹窗滚动和文本换行。
