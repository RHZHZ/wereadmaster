# 候选书架卡片操作菜单改造方案

## 结论

候选书架卡片里的常驻 `移除` 按钮建议收拢到右上角三点菜单。

当前卡片的核心任务是帮助用户扫读候选书：封面、书名、作者、候选来源和确认状态。`移除` 属于低频管理动作，常驻在卡片底部会抢占内容空间，也会让卡片看起来像“书籍对象 + 删除入口”，而不是一个可继续比较和决策的候选书对象。

这次改造不改变候选书架的数据流，不修改移除逻辑，只调整卡片动作的展示方式：

- `移除` 从常驻文本按钮改为三点菜单里的 `移除候选`。
- `搜索确认 / 重新搜索 / 重试搜索` 保持可见，不收进菜单。
- 卡片主体仍负责打开书籍详情。
- 不新增批量操作、不新增确认弹窗、不改变候选来源判断。

## 当前问题

1. `移除` 权重偏高

- 截图中 `移除` 长期占据卡片底部。
- 它使用图标 + 文本，视觉权重接近主操作。
- 用户扫读候选书时，会被管理动作打断。

2. 卡片内容空间被压缩

- 候选卡片本身较紧凑。
- 长书名、作者、来源标签已经需要两到三行空间。
- 常驻 `移除` 会继续压缩内容区，尤其在横向密集卡片中更明显。

3. 操作语义不够分层

- 打开详情是主行为。
- 搜索确认是未确认 AI 候选的主流程行为。
- 移除是低频管理行为。
- 当前这些动作都显性暴露，层级不够清楚。

4. 移动端更需要收敛

- 移动端卡片宽度更小。
- 常驻文字按钮容易换行或挤压来源标签。
- 三点菜单能让卡片主体更稳定。

## 改造目标

1. 降低低频动作干扰

- 默认卡片只突出书籍信息和必要确认动作。
- 删除类动作收敛到菜单中。

2. 保留关键流程可发现性

- 未确认 AI 候选仍直接显示 `搜索确认`。
- 不把主流程动作藏进三点菜单。

3. 保持行为不变

- 继续调用现有 `handleRemoveCandidate(book)`。
- 继续使用 `removingIds` 控制移除中的禁用状态。
- 成功和失败 toast 不变。

4. 保持实现简单

- 不引入新的菜单库。
- 不新增复杂浮层系统。
- 只在 `CandidateBookshelfPage` 内部实现当前页面所需菜单。

## 推荐交互

### 默认卡片

```text
[封面]  书名，两行以内                     [···]
        作者 / 分类
        AI 推荐 · 微信读书已确认

        [搜索确认]  仅未确认 AI 候选显示
```

### 点击三点后

```text
[···]
  ┌────────────┐
  │ 移除候选   │
  └────────────┘
```

交互规则：

- 三点按钮默认可见，不能只在 hover 时出现。
- 点击三点按钮打开当前卡片菜单。
- 再次点击同一个三点按钮关闭菜单。
- 点击其他卡片的三点按钮，关闭原菜单并打开新菜单。
- 点击 `移除候选` 后关闭菜单，并执行现有移除逻辑。
- `Escape` 关闭菜单。
- 点击菜单外部关闭菜单。
- 移除中的菜单项禁用，文案可显示 `移除中`。

## 组件落点

### `CandidateBookshelfPage`

文件：`src/pages/CandidateBookshelfPage.tsx`

当前相关实现：

- `handleRemoveCandidate(book)`：现有移除逻辑。
- `removingIds`：现有移除中状态。
- `.candidate-card-actions`：当前承载 `搜索确认` 和 `移除`。
- `.shelf-card-main`：卡片主体按钮，负责打开详情。

建议新增最小状态：

```ts
const [openActionMenuBookId, setOpenActionMenuBookId] = useState<string>();
```

建议新增处理函数：

```ts
function handleToggleCandidateActionMenu(bookId: string) {
  setOpenActionMenuBookId((current) => (current === bookId ? undefined : bookId));
}
```

移除时建议先关闭菜单：

```ts
setOpenActionMenuBookId(undefined);
void handleRemoveCandidate(book);
```

### JSX 结构建议

不要把三点按钮放进 `.shelf-card-main` 内部，因为 `.shelf-card-main` 本身是按钮。推荐结构：

```tsx
<article className="shelf-card candidate-bookshelf-card">
  <button className="shelf-card-main shelf-card-main--button">
    ...
  </button>

  <button className="candidate-card-menu-trigger">
    <MoreHorizontal ... />
  </button>

  {openActionMenuBookId === book.bookId ? (
    <div className="candidate-card-menu" role="menu">
      <button role="menuitem" className="candidate-card-menu-item is-danger">
        <Trash2 ... />
        移除候选
      </button>
    </div>
  ) : null}

  <div className="candidate-card-actions">
    搜索确认动作
  </div>
</article>
```

注意：

- 三点按钮和菜单是 `.shelf-card-main` 的兄弟节点，避免嵌套交互元素。
- 菜单按钮必须 `type="button"`。
- 三点按钮需要明确 `aria-expanded` 和 `aria-haspopup="menu"`。
- 菜单项需要可键盘 focus。

## 样式落点

文件：`src/styles.css`

重点选择器：

- `.candidate-bookshelf-card`
- `.candidate-card-menu-trigger`
- `.candidate-card-menu`
- `.candidate-card-menu-item`
- `.candidate-card-actions`
- `.candidate-remove-button`

建议样式方向：

```css
.candidate-bookshelf-card {
  position: relative;
}

.candidate-card-menu-trigger {
  position: absolute;
  top: 10px;
  right: 10px;
}

.candidate-card-menu {
  position: absolute;
  top: 42px;
  right: 10px;
  z-index: 4;
}
```

视觉要求：

- 三点按钮尺寸建议 `32px` 到 `36px`。
- 移动端触控目标不低于 `40px`。
- 菜单圆角不超过现有 8px 体系。
- 菜单阴影轻，不做重浮层。
- `移除候选` 使用低饱和危险色，不使用强红色背景。
- 卡片 hover 和 focus 状态不应被菜单按钮破坏。

## 可访问性要求

- 三点按钮：
  - `aria-label="更多候选操作：书名"`
  - `aria-haspopup="menu"`
  - `aria-expanded={openActionMenuBookId === book.bookId}`

- 菜单：
  - `role="menu"`
  - `aria-label="候选操作"`

- 菜单项：
  - `role="menuitem"`
  - `disabled={removingIds.has(book.bookId)}`

- 键盘：
  - `Tab` 可以进入三点按钮和菜单项。
  - `Escape` 可以关闭打开的菜单。
  - 菜单关闭后不强制管理焦点，第一版保持简单。

## 实施顺序

1. 引入 `MoreHorizontal` 图标。
2. 在 `CandidateBookshelfPage` 增加 `openActionMenuBookId` 状态。
3. 增加三点按钮，放在 `.shelf-card-main` 之后。
4. 将 `移除` 从 `.candidate-card-actions` 移到菜单项。
5. 保留 `搜索确认` 在 `.candidate-card-actions`。
6. 补 `Escape` 关闭菜单逻辑。
7. 补点击菜单外部关闭逻辑。
8. 增加菜单、触发按钮和暗色主题样式。
9. 检查移动端卡片不溢出。
10. 跑候选书架相关测试和一次桌面/移动视觉验证。

## 验收标准

- 候选书卡片默认不再显示常驻 `移除` 文本按钮。
- 每张卡右上角显示三点操作按钮。
- 点击三点后只打开当前卡片菜单。
- 菜单显示 `移除候选`。
- 点击 `移除候选` 后复用现有移除行为，toast 文案不回退。
- 移除中状态禁用菜单项，避免重复提交。
- 未确认 AI 候选仍显示 `搜索确认`。
- 点击卡片主体仍打开详情。
- 点击三点和菜单项不会触发卡片主体打开详情。
- 桌面和移动端无文字溢出、按钮重叠、菜单被裁切。
- 暗色主题下菜单、按钮和危险动作可读。

## 不做范围

- 不新增批量移除。
- 不新增删除确认弹窗。
- 不新增“查看详情”菜单项。
- 不把 `搜索确认` 收进菜单。
- 不改 `removeReadingItemState`。
- 不改候选来源判断。
- 不改选书决策流程。
- 不引入新的下拉菜单组件库。

## 风险和注意事项

- 如果三点按钮放进 `.shelf-card-main`，会形成嵌套 button，必须避免。
- 如果菜单没有处理外部点击，会出现多个菜单悬挂或状态残留。
- 如果三点按钮只在 hover 出现，移动端不可发现。
- 如果菜单层级太高或阴影太重，会破坏候选卡片的轻量感。
- 如果 `移除候选` 使用强危险色，会让管理动作再次抢过内容。
- 如果卡片 `overflow` 被设置为 hidden，菜单可能被裁切，需要检查实际样式。

## 工程原则映射

KISS：

- 用一个页面内状态管理当前打开菜单。
- 不引入菜单库或复杂 focus trap。

YAGNI：

- 第一版菜单只承载 `移除候选`。
- 不提前扩展批量、排序、归档等动作。

DRY：

- 复用现有 `handleRemoveCandidate` 和 `removingIds`。
- 复用现有候选卡片结构，只移动低频动作入口。

SOLID：

- 候选卡片继续负责展示候选书。
- 移除逻辑保持在页面已有行为函数中。
- 菜单只负责动作承载，不改变数据派生规则。

## 推荐落地标准

第一版建议最小改动：

- 改 `src/pages/CandidateBookshelfPage.tsx`：增加三点菜单状态和 JSX。
- 改 `src/styles.css`：增加菜单触发按钮、菜单面板和菜单项样式。
- 保留现有 `candidate-card-actions` 作为搜索确认动作区。
- 不修改 `candidate-books.ts`。
- 不改后端命令。

这样可以先解决截图中的视觉拥挤问题，同时不给候选书架引入过多交互复杂度。

## 实施结果

已按第一版最小改动落地：

- `CandidateBookshelfPage` 已新增右上角三点菜单。
- 常驻 `移除` 已改为菜单项 `移除候选`。
- `搜索确认 / 重新搜索 / 重试搜索` 仍保留在卡片操作区。
- 已确认候选不再渲染空的动作区，避免低频动作搬迁后留下额外空白结构。
- 菜单支持同卡切换、跨卡切换、点击外部关闭和 `Escape` 关闭。
- 点击 `移除候选` 复用原 `handleRemoveCandidate`，成功 toast 文案保持为 `已从候选书架移除《书名》`。
- 移除中状态复用 `removingIds`，菜单项禁用并显示 `移除中`。
- 样式复用现有 `shelf-card-menu` 体系，只补候选卡片尺寸、移动端触控目标、危险动作和暗色主题。

## 复核结论

遗漏项：

- 已补 e2e 覆盖：默认不显示常驻 `移除`、三点菜单显示 `移除候选`、`Escape` 关闭菜单、点击菜单项后候选卡片消失并显示 toast。
- 已做桌面和移动端截图验证，确认三点入口不压住主标题区，移动端 390px 下菜单可读且不被裁切。

未过度项：

- 未引入菜单组件库。
- 未新增确认弹窗。
- 未新增批量移除。
- 未把 `搜索确认` 收进菜单。
- 未改候选来源判断、后端命令和选书决策流程。

验证命令：

- `npm run build`
- `npx playwright test "tests/e2e/app-smoke.spec.ts" -g "桌面端主流程可导航并使用本地命令 mock 数据"`
