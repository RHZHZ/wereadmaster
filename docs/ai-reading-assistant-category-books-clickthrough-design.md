# AI 阅读助手分类书单点击交互设计

## 背景

`categoryBooks` action 已支持回答“我读过哪些理财类书籍”这类问题，并返回本地可验证书目。当前结果能展示书名、作者、分类、进度、阅读时长和来源，但书籍行不可点击。

用户看到分类书单后的自然下一步通常是进入某本书的详情页，继续查看进度、笔记、复盘或阅读指南。因此需要补一个轻量点击闭环。

本设计是 `docs/ai-reading-assistant-category-books-query-design.md` 的 P1 增强，只解决“从分类书单打开书籍详情”。

## 问题定义

当前缺口：

- 分类书单停留在静态展示。
- 用户需要手动去书架搜索同一本书。
- AI 助手结果和现有书籍详情页没有导航连接。
- 对有可靠 `bookId` 的本地书籍，没有利用现有详情能力。

## 目标

让分类书单中可定位的书籍支持点击打开现有书籍详情页。

目标行为：

1. 用户问“我读过哪些理财类书籍”。
2. 助手返回 `categoryBooks` action。
3. 结果中有可靠 `bookId` 且能在当前书架中定位的书籍行显示为可点击。
4. 用户点击书籍行。
5. AI 助手关闭。
6. 应用打开该书籍详情页。

## 非目标

本次不做：

- 不直接打开微信读书。
- 不直接打开笔记页。
- 不直接生成 AI 复盘。
- 不在书籍行内增加多动作菜单。
- 不做批量选择、筛选、排序。
- 不为统计-only 缺失明细生成可点击项。
- 不构造复杂的书籍实体兜底。
- 不新增后端命令。
- 不新增数据库字段。

## 设计原则

### KISS

首版只支持一个动作：打开现有书籍详情。

### YAGNI

不预置“打开笔记”“生成复盘”“加入候选”等二级动作。等真实使用反馈证明需要再加。

### DRY

导航复用 `App.tsx` 现有书籍详情打开逻辑，不复制详情页加载逻辑。

### SOLID

- `ReadingAssistantPanel` 只负责把用户点击事件透传给父级。
- `App.tsx` 负责根据 `bookId` 定位书架条目并导航。
- `CategoryBooksAction` 只负责展示和触发单一回调，不关心路由实现。

## 交互设计

### 可点击条件

一条书籍记录只有同时满足以下条件才可点击：

- `book.bookId` 非空。
- 父组件传入 `onOpenBookDetail`。
- `App.tsx` 能在当前 `bookshelf.entries` 中找到 `id === book.bookId` 的书架条目。

不满足时：

- 行保持静态展示。
- 不显示 hover 可点击状态。
- 不绑定点击事件。

### 视觉状态

可点击行：

- 使用 `button` 元素。
- 保留当前卡片式行布局。
- hover/focus 时边框和背景略增强。
- 显示清晰 focus ring。

不可点击行：

- 使用 `div`。
- 视觉与当前静态列表一致。

### 键盘支持

可点击行必须天然支持：

- `Tab` focus。
- `Enter` 打开。
- `Space` 打开。

使用原生 `button`，不手写键盘事件。

## 前端接口设计

### `ReadingAssistantPanelProps`

新增：

```ts
onOpenBookDetail?: (bookId: string) => void;
```

### `ReadingAssistantCategoryBooksActionProps`

新增：

```ts
type ReadingAssistantCategoryBooksActionProps = {
  action: ReadingAssistantCategoryBooksActionPayload;
  onOpenBookDetail?: (bookId: string) => void;
};
```

### 渲染逻辑

```tsx
const canOpen = Boolean(onOpenBookDetail && book.bookId);

const content = (
  <>
    <BookOpen aria-hidden="true" size={16} />
    <span>
      <strong>{book.title}</strong>
      <small>{meta}</small>
    </span>
  </>
);

return canOpen ? (
  <button
    className="reading-assistant-category-book is-clickable"
    type="button"
    onClick={() => onOpenBookDetail?.(book.bookId)}
  >
    {content}
  </button>
) : (
  <div className="reading-assistant-category-book">{content}</div>
);
```

## App 层导航设计

`App.tsx` 当前已有 `handleOpenBookDetail(entry: ShelfEntry)`，分类 action 只有 `bookId`。

首版采用保守路径：

```ts
function handleOpenBookDetailFromAssistant(bookId: string) {
  const entry = bookshelf?.entries.find((item) => item.id === bookId && item.type === "book");
  if (!entry) {
    return;
  }

  handleCloseReadingAssistant();
  handleOpenBookDetail(entry);
}
```

传入：

```tsx
<ReadingAssistantPanel
  ...
  onOpenBookDetail={handleOpenBookDetailFromAssistant}
/>
```

### 为什么不构造最小 `ShelfEntry`

不推荐首版构造最小对象：

- `BookDetailPage` 和返回路径可能依赖完整书架条目字段。
- 伪造条目会扩大错误边界。
- 当前 `categoryBooks` 的 P0 目标是“本地可验证”，点击也应只对当前书架可验证对象开放。

如果后续确实需要支持 `book_details` 有记录但书架没有记录的书，可以新增专门的 `openBookDetailById(bookId)` 路径。

## 样式设计

新增状态类：

```css
.reading-assistant-category-book.is-clickable {
  width: 100%;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.reading-assistant-category-book.is-clickable:hover,
.reading-assistant-category-book.is-clickable:focus-visible {
  border-color: rgba(33, 125, 131, 0.28);
  background: rgba(33, 125, 131, 0.09);
}
```

注意：

- 不改变整体卡片密度。
- 不增加行内按钮。
- 不使用仅 hover 可见的操作。

## 数据边界

点击交互不改变后端输出契约。

仍依赖：

```ts
type ReadingAssistantCategoryBookItem = {
  bookId: string;
  title: string;
  author?: string;
  category?: string;
  progressPercent?: number;
  isFinished: boolean;
  readingTimeText?: string;
  source: string;
};
```

前端必须防御：

- 空 `bookId`。
- 书架中找不到对应条目。
- 未传入 `onOpenBookDetail`。

## 错误处理

首版不新增错误提示。

原因：

- 不可点击状态已经表达“当前不能直接打开”。
- 如果点击后详情页加载失败，应由现有详情页错误处理负责。
- 避免在 AI 助手里增加一套导航错误状态。

## 测试计划

### 单元测试

`ReadingAssistantCategoryBooksAction`：

- 有 `onOpenBookDetail` 时，书籍行渲染为按钮。
- 点击按钮触发 `onOpenBookDetail(bookId)`。
- 无回调时，书籍行静态展示。
- 空书单时仍展示“统计总数不会被展开成伪书名”。

### App/e2e 测试

新增或扩展现有 e2e：

1. 打开统计页。
2. 打开 AI 阅读助手。
3. 提问“我读过哪些理财类书籍”。
4. mock 返回 `categoryBooks`，书籍 `bookId` 能匹配书架。
5. 点击《小狗钱钱》。
6. 断言 AI 助手关闭。
7. 断言进入书籍详情页。

如果 mock 当前书架不包含该书：

- 只断言静态展示，不断言可点击。

## 验收标准

- 分类书单中可定位书籍可点击。
- 点击后关闭 AI 阅读助手并打开现有书籍详情页。
- 不可定位书籍保持静态展示。
- 键盘可操作。
- 现有 `bookReview`、`statsAggregate`、`wereadSearch` action 不回归。
- 不新增 AI 调用。
- 不新增后端命令或数据库字段。

## 后续扩展

可根据使用反馈再考虑：

- 打开书籍笔记。
- 生成单本 AI 复盘。
- 在结果列表中只看已读完。
- 支持 `book_details` 有记录但书架没有记录时按 `bookId` 打开详情。

这些都不属于本次范围。
