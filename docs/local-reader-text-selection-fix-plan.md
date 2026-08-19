# 本地阅读器多字符划线选区修复方案

## 文档状态

- 状态：待实现。
- 问题范围：本地 TXT、EPUB 和 Markdown 阅读器中，鼠标、触控或键盘选择正文后创建划线的交互。
- 涉及模块：`src/pages/LocalReaderPage.tsx`、`tests/e2e/local-reader.spec.ts`。
- 不涉及：划线存储格式、正文偏移模型、Markdown 导出、本地书库导入和微信读书笔记。

## 问题描述

在本地阅读器拖拽选择正文时，用户可能只能得到一个字符的选区，随后创建的划线也只包含该字符。该问题出现在选区尚未完成时，不是划线记录的长度限制。

预期行为：

```text
按下鼠标并拖拽正文 -> 完成目标文本选择 -> 松开鼠标 -> 显示选区工具条 -> 创建完整划线
```

当前行为：

```text
按下鼠标并开始拖拽 -> selectionchange 产生首个短选区 -> 显示工具条并自动聚焦按钮 -> 拖拽被打断 -> 只保留单字符选区
```

## 根因

当前实现同时存在以下链路：

1. 页面在 `document` 上监听 `selectionchange`，每一次原生选区变化都会调用 `handleSelectionChange`。
2. `handleSelectionChange` 使用零延迟定时器读取当前 `Range` 并写入 `selectionMenu`，不区分选区是拖拽中的中间状态还是已完成状态。
3. `selectionMenu` 写入后，副作用会在下一帧聚焦选区工具条的第一个按钮，即“划线”。
4. 焦点在鼠标仍按下时从正文转移到工具条，会中断浏览器继续扩展原生选区。

相关实现位置：

- `src/pages/LocalReaderPage.tsx` 中 `document.addEventListener("selectionchange", handleSelectionChange)`。
- `src/pages/LocalReaderPage.tsx` 中 `handleSelectionChange` 的零延迟读取。
- `src/pages/LocalReaderPage.tsx` 中 `selectionMenu` 打开后的首个操作按钮自动聚焦。

`normalizeLocalReaderSelectionRange` 和 `createLocalReaderHighlight` 均支持任意合法的非空范围；它们没有单字符上限。现有测试大多先通过 DOM Range 一次性写入完整选区，再分发最终事件，因此没有模拟真实拖拽期间连续发生的 `selectionchange`。

## 修复目标

```text
只在用户完成一次选择后读取 Range 和打开工具条；拖拽或键盘扩选过程中不得改变焦点。
```

具体要求：

- 桌面端鼠标拖选多字符、跨行文本后，划线应完整保存。
- 已有划线、搜索高亮和 Markdown 行内节点存在时，选区偏移仍与正文原始偏移一致。
- 触屏原生选区仍可唤起工具条。
- 键盘 Shift 选区不被工具条自动聚焦打断。
- 选区工具条的键盘可达性保留：在明确完成的鼠标或键盘选择后，仍可按原有策略聚焦首个操作。

## 修复设计

### 将选区读取分为“变化”和“提交”

保留 `readReaderSelection` 作为唯一的 Range 到正文偏移转换函数，不改变其职责。新增一层选区会话控制，只决定何时允许调用它。

| 事件来源 | 拖拽/扩选中 | 选区完成后 | 是否自动聚焦工具条 |
| --- | --- | --- | --- |
| 鼠标 | 不读取、不打开工具条 | `mouseup` 立即提交 | 是 |
| 触控 | 不读取、不打开工具条 | `touchend` 立即提交 | 否 |
| 键盘 | Shift 选区期间不提交 | `keyup` 提交 | 是 |
| 原生 `selectionchange` | 仅记录为待处理变化 | 无显式结束事件时，防抖兜底提交 | 否 |

建议状态仅使用 ref，避免每次 `selectionchange` 触发 React 渲染：

```ts
type SelectionSession = {
  pointerIsDown: boolean;
  keyboardSelectionInProgress: boolean;
  fallbackTimer?: number;
};
```

实现要点：

1. 在正文阅读器的 `onPointerDown` 中标记 `pointerIsDown`；仅对可产生文本选择的主指针处理。
2. 在 `onMouseUp` 与 `onTouchEnd` 中清除 `pointerIsDown`，取消兜底定时器，并立即读取最终选区。
3. 在 `onKeyDown` 识别 Shift 加方向键、Home、End、PageUp、PageDown 等扩选操作；在 `onKeyUp` 提交最终选区。
4. `selectionchange` 发生时，若鼠标或键盘选择仍在进行，直接返回；否则只重置一个短防抖定时器。该定时器用于系统原生选区调整等没有可靠结束事件的场景。
5. 只有显式完成事件触发的提交可申请自动聚焦“划线”按钮。`selectionchange` 防抖提交只展示工具条，不改变焦点，避免干扰触屏选区把手和后续调整。
6. 在组件卸载时清除兜底定时器，避免切换图书后对旧 DOM 读取选区。

### 建议函数边界

为避免把事件判断继续堆积在 `handleSelectionChange` 中，建议拆分为以下职责：

```ts
commitReaderSelection({ autoFocus }: { autoFocus: boolean }): void
scheduleNativeSelectionFallback(): void
cancelNativeSelectionFallback(): void
handleReaderPointerDown(event: PointerEvent): void
handleReaderSelectionCompleted(source: "mouse" | "touch" | "keyboard"): void
```

`commitReaderSelection` 负责调用 `readReaderSelection`、计算关联想法和 AI 记录数量、更新 `selectionMenu`。它不应判断当前是拖拽、触控还是键盘事件。

### 不采用的方案

- 不移除全部 `selectionchange` 支持：移动端原生选区和系统选区把手调整可能只提供该事件，完全移除会造成回归。
- 不通过增加固定长延迟掩盖问题：慢速拖拽或停顿拖拽仍可能在鼠标未松开时触发弹层。必须以输入会话状态作为主判断。
- 不在划线模型中加入最小长度：这会隐藏 UI 时序缺陷，并排除单字符划线这一合法需求。
- 不修改 `readTextOffset` 或存储偏移计算：当前问题发生在选区被读取之前，改动偏移模型只会增加回归面。

## 测试计划

### 单元测试

为选区会话控制提取纯函数时，补充以下覆盖：

- 指针按下期间的 `selectionchange` 不产生提交。
- `mouseup` 能提交最后一次有效选区。
- `touchend` 能提交最后一次有效选区，但不请求自动聚焦。
- 键盘扩选期间不提交，`keyup` 后提交。
- 无显式结束事件时，防抖兜底只提交一次。
- 卸载或切换书籍时会取消待执行的兜底任务。

### E2E 回归

在 `tests/e2e/local-reader.spec.ts` 增加真实指针拖选用例，不再只通过 `Range` 直接注入最终文本：

1. 打开本地阅读器预览中的《小王子》。
2. 使用鼠标按下、移动和松开的事件选择一段至少 12 个字符的可见正文；用真实文本坐标计算起止点，覆盖跨行选择。
3. 在鼠标松开前断言选区工具条未出现，或至少没有获得按钮焦点。
4. 松开后断言工具条出现，点击“划线”。
5. 断言正文和右侧划线列表均包含完整目标文本，而非首个字符。
6. 对已有 `mark.local-reader-highlight`、`.local-reader-search-hit` 和 Markdown 段落各增加一次跨节点选择回归。

保留已有的 `selectionchange` 触屏测试，用于验证兜底路径；不要用新测试替换该用例。

## 验收标准

- 手动桌面验收中，可从任意普通正文位置连续拖选至少一行文本，选区不会在松开鼠标前弹出工具条。
- 创建后的划线文本、`startOffset`、`endOffset` 与当前浏览器选区一致。
- 连续创建多条不同长度划线均不会退化为单字符。
- 触控设备中长按、调整选区把手、松手后仍可显示选区工具条。
- 键盘 Shift+方向键选择文本后，松键前焦点保持在正文，松键后工具条可操作。
- `npm run test`、`npx playwright test tests/e2e/local-reader.spec.ts` 和 `npm run build` 通过。

## 实施顺序

1. 提取选区提交函数及防抖清理逻辑，不改变 `readReaderSelection` 和划线数据结构。
2. 增加输入会话 ref，并接入正文的指针、触控和键盘结束事件。
3. 调整工具条自动聚焦条件，仅允许明确完成的桌面/键盘操作触发。
4. 添加真实拖选 E2E 回归以及会话控制单元测试。
5. 在桌面与移动视口执行回归，确认无选区工具条定位、焦点或触控可达性回归。
