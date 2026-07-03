# AI 阅读助手面板交互改造文档

## 背景

当前 AI 阅读助手已经完成 P0 能力闭环：全局入口、右侧面板、多轮对话、阅读上下文、最近对话、偏好设置和清空历史。

但当前面板把以下内容同时放在一个页面流里：

- 当前上下文标签。
- 个性化上下文 / 原始笔记 / 保存历史开关。
- 最近对话入口和历史列表。
- 对话消息。
- 回答依据。
- 快捷问题。
- 输入框。

这会导致右侧面板信息密度过高，尤其在历史列表展开后，历史和对话会挤在一起，用户难以判断当前主任务是“继续提问”还是“管理历史”。

## 目标

把 AI 阅读助手从“一个面板内堆叠多个区块”改造成“一个面板内单视图切换”。

核心目标：

- 默认只聚焦对话。
- 历史列表不与对话内容同时展示。
- 设置不与对话内容长期并列展示。
- 保留右侧抽屉形态，支持用户边看当前页面边提问。
- 不改变后端数据结构和 AI 调用链。

## 非目标

本次不做：

- 不新增独立 AI 聊天页面。
- 不改造数据库表。
- 不引入路由级页面。
- 不做向量知识库。
- 不做聊天结果写入正式 AI 资产。
- 不把最近对话做成桌面端双栏常驻布局。

## 设计决策

### 1. 主助手仍使用右侧抽屉

AI 阅读助手的核心场景是“用户在当前阅读上下文中随时发问”。因此主容器继续使用右侧抽屉，而不是居中弹窗。

原因：

- 右侧抽屉能保留当前页面上下文。
- 用户可以边看书籍、笔记、统计结果边提问。
- 居中弹窗会遮挡主要内容，不适合解释型助手。

交互边界：

- 不对主内容区做高斯模糊，避免削弱阅读上下文。
- 不点击侧边栏外部自动关闭，避免用户对照背景内容时误关。
- 支持 `Esc` 关闭，并保留右上角显式关闭按钮。

### 2. 面板一次只承载一个主任务

面板视图拆成三个互斥状态：

```ts
type ReadingAssistantPanelView = "chat" | "history" | "settings";
```

- `chat`：默认对话视图。
- `history`：最近对话列表视图。
- `settings`：隐私和上下文设置视图。

历史和设置是辅助任务，不应常驻占用对话空间。

### 3. 历史列表替换对话区域，而不是嵌入对话页

点击“历史”后，整个面板主体切换为历史列表：

```text
[返回] 最近对话                         [清空]

会话 1
会话 2
会话 3
```

选择某个会话后：

- 加载线程消息。
- 更新 `threadId`。
- 回到 `chat` 视图。

### 4. 设置作为面板内子视图

点击“设置”后，整个面板主体切换为设置视图：

```text
[返回] 助手设置

个性化上下文       [开关]
原始笔记片段       [开关]
保存对话历史       [开关]
阅读记忆           [开关]

清空本地对话历史
```

设置视图不展示对话消息和输入框。

### 5. 清空历史使用确认弹窗

清空历史属于破坏性操作，可以使用确认弹窗。

约束：

- 入口只出现在 `history` 或 `settings` 视图。
- 不在默认对话视图常驻展示。
- 确认后清空本地助手历史，不影响正式 AI 资产。

## 信息架构

### 对话视图

```text
AI 阅读助手                         [历史] [设置] [关闭]
当前上下文 chips

消息列表

回答依据
快捷问题
输入框
```

默认视图只展示和“继续提问”相关的内容。

对话视图保留：

- 标题。
- 当前上下文 chips。
- 消息列表。
- 最近一次回答依据。
- 快捷问题。
- 输入框。

消息列表在发送、收到回答、加载历史会话后自动滚动到底部，保证最新消息和加载状态可见。

对话视图移除：

- 最近对话展开列表。
- 个性化设置开关。
- 清空历史按钮。

### 历史视图

```text
返回                                 最近对话

历史线程列表
空状态
加载状态
```

历史视图职责：

- 展示最近对话。
- 支持选择线程。
- 支持清空历史。

历史视图不展示：

- 当前对话消息。
- 输入框。
- 快捷问题。
- 偏好开关。

### 设置视图

```text
返回                                 助手设置

上下文与隐私开关
说明文案
清空历史入口
```

设置视图职责：

- 修改助手偏好。
- 展示隐私边界。
- 提供清空历史入口。

设置视图不展示：

- 对话消息。
- 输入框。
- 最近对话列表。

## 交互流程

### 打开助手

```text
点击 AI 悬浮入口
  -> 打开右侧面板
  -> 默认进入 chat 视图
  -> 根据当前页面推断 scope
  -> 展示上下文 chips
```

### 查看历史

```text
chat 视图点击历史
  -> panelView = "history"
  -> 展示最近对话列表
```

选择历史线程：

```text
点击历史线程
  -> getReadingAssistantThread(threadId)
  -> setThreadId
  -> setMessages
  -> panelView = "chat"
```

### 修改设置

```text
chat 视图点击设置
  -> panelView = "settings"
  -> 展示偏好设置
```

保存偏好后：

```text
saveReadingAssistantPreferences
  -> 更新本地 preferences
  -> 回到 chat 后重新计算 enabledContext
```

### 清空历史

```text
history/settings 视图点击清空历史
  -> 确认弹窗
  -> clearReadingAssistantHistory
  -> 清空 threadId/messages/threads/lastUsedContext
  -> panelView = "chat"
```

## 组件改造

当前 `ReadingAssistantPanel` 可以先保持单文件实现，避免过早拆分。若组件继续膨胀，再拆出子组件。

建议最小改造：

```ts
type ReadingAssistantPanelView = "chat" | "history" | "settings";

const [panelView, setPanelView] =
  useState<ReadingAssistantPanelView>("chat");
```

推荐内部渲染结构：

```tsx
<aside className="reading-assistant-panel">
  <ReadingAssistantHeader />
  {panelView === "chat" ? <ChatView /> : null}
  {panelView === "history" ? <HistoryView /> : null}
  {panelView === "settings" ? <SettingsView /> : null}
</aside>
```

P0 可以不立即抽文件，只用局部 render 函数控制复杂度：

- `renderChatView()`
- `renderHistoryView()`
- `renderSettingsView()`

后续如果单文件超过可维护阈值，再拆为：

- `ReadingAssistantHeader`
- `ReadingAssistantContextBar`
- `ReadingAssistantChatView`
- `ReadingAssistantHistoryView`
- `ReadingAssistantSettingsView`

## 样式改造

### 面板布局

对话视图建议使用固定头部和固定输入区：

```css
.reading-assistant-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
```

对话主体内部：

```css
.reading-assistant-chat-view {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  min-height: 0;
}
```

底部输入区使用一体化 AI composer：

- `textarea` 与发送按钮在同一个输入面内。
- 发送按钮使用右下角图标按钮。
- `Enter` 发送，`Shift + Enter` 换行。
- 焦点态通过边框和轻微阴影强化，不改成独立弹窗。

历史和设置视图：

```css
.reading-assistant-subview {
  min-height: 0;
  overflow: auto;
}
```

### 内容约束

- 历史列表必须独立滚动。
- 消息列表必须独立滚动。
- 输入框不能被历史列表挤压。
- 设置项不应出现在对话视图。
- 移动端面板宽度不足时使用全宽抽屉。

## 实施步骤

### 阶段 1：视图状态改造

修改文件：

- `src/components/ReadingAssistantPanel.tsx`
- `src/styles.css`

任务：

- 新增 `panelView` 状态。
- 关闭面板或切换 `scope/entityId` 时重置为 `chat`。
- Header 增加历史和设置入口。
- 删除对话视图中的常驻偏好区和历史区。

验收：

- 默认打开助手只显示对话。
- 历史和设置不再占用对话页空间。

### 阶段 2：历史子视图

任务：

- 将最近对话列表迁移到 `history` 视图。
- 选择线程后回到 `chat`。
- 清空历史入口放入 `history` 视图。
- 空状态和加载状态保持可见。

验收：

- 历史列表不与消息列表同时展示。
- 清空历史后回到空对话状态。

### 阶段 3：设置子视图

任务：

- 将个性化上下文、原始笔记、保存历史、阅读记忆开关迁移到 `settings` 视图。
- 对话视图只保留上下文 chips。
- 原始笔记默认关闭。

验收：

- 设置项不会挤占消息区域。
- 关闭个性化上下文后，chat 视图上下文 chips 更新为“无个性化上下文”或仅保留允许项。

### 阶段 4：样式和回归验证

任务：

- 简化面板 grid 行定义。
- 保证消息区、历史区、设置区都能独立滚动。
- 验证窄宽度下文本不溢出。

验收：

- 右侧面板没有明显空白断层。
- 背景不透出底层页面文字。
- 按钮文字不被裁切。
- 输入框始终可见。

## 测试计划

### 类型检查

```bash
npx tsc --noEmit --pretty false
```

### 前端测试

```bash
npx vitest run "src/pages/SettingsPage.test.tsx" "src/App.test.ts" "src/lib/reading-api.test.ts"
```

如后续新增组件测试，再补充：

- 默认渲染 chat 视图。
- 点击历史进入 history 视图。
- 选择历史后回到 chat 视图。
- 点击设置进入 settings 视图。

### 构建验证

```bash
npm run build
```

### 手工验收

需要覆盖：

- 全局入口打开。
- 书籍详情页打开。
- 笔记页打开。
- 统计页打开。
- 历史为空。
- 历史有数据。
- Provider 未配置或调用失败。
- 原始笔记开关打开和关闭。

## 风险与约束

### 风险 1：单组件继续膨胀

控制方式：

- 首轮用 render 函数降低改动成本。
- 如果 `ReadingAssistantPanel.tsx` 继续变复杂，再拆子组件。

### 风险 2：用户找不到历史入口

控制方式：

- Header 使用明确的历史图标。
- 鼠标悬停显示 title。
- 空对话状态可以保留轻提示，但不展示历史列表。

### 风险 3：设置入口过深

控制方式：

- Header 保留设置入口。
- SettingsPage 继续保留全局 AI 阅读助手设置。
- 面板内设置只放高频隐私开关。

## 最终验收标准

- AI 阅读助手默认视图只服务对话，不展示最近对话列表和设置表单。
- 历史列表和设置页都以互斥子视图呈现。
- 用户可以在 1 次点击内进入历史或设置。
- 选择历史会话后自动回到对话。
- 面板不再因历史列表或偏好开关挤压消息区。
- 不修改后端接口和数据库结构。
