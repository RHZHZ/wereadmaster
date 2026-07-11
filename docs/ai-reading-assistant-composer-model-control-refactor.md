# AI 阅读助手模型控件下沉改造设计

> 2026-07-10 更新：后续后端实现已将新书推荐纳入聊天流式入口。本文的模型控件布局结论不变；流式边界以“普通问答和新书推荐尝试流式，候选书决策、微信读书搜索和统计聚合非流式”为准。

## 背景

当前 AI 阅读助手在聊天主视图顶部展示独立模型状态条，内容包括 Provider、Model、响应格式策略和“模型设置”入口。这个方案能解决“用户不知道当前模型”的问题，但实际 UI 密度偏高：

- 模型信息占据聊天消息区上方的固定垂直空间。
- 用户每次打开助手都会先看到模型卡片，而不是对话内容和输入区。
- 模型选择本质上是“发送前控制项”，放在输入框附近比放在消息流顶部更符合心智。

截图中的现状：

```text
┌────────────────────────────────────────────┐
│ DeepSeek                                   │
│ deepseek-v4-flash       [齿轮] 模型设置     │
│ JSON 模式                                  │
└────────────────────────────────────────────┘
```

该布局对于设置页是合理的，但对于聊天面板过重。后续应改为类似 Codex 的 composer 内模型控件。

## 目标

将模型状态与切换入口从聊天内容区下沉到输入框内，形成紧凑、低干扰的发送前控制。

目标效果：

```text
┌────────────────────────────────────────────┐
│ 问一个阅读问题                              │
│                                            │
│ [DeepSeek ▾] deepseek-v4-flash · JSON   [↗]│
└────────────────────────────────────────────┘
```

其中：

- 左下角显示当前 Provider。
- 模型名和响应格式策略作为紧凑 meta 展示。
- 点击模型 chip 打开轻量菜单。
- 完整 Provider 配置仍跳转全局 AI 设置。
- 发送按钮保持右下角，不增加单独工具栏高度。

## 非目标

本次改造不做：

- 不做每条消息独立模型选择。
- 不做每条消息回溯切换模型。
- 不把聊天框变成完整 Provider 设置表单。
- 不在聊天框内编辑 Base URL 或 API Key。
- 不新增后端模型市场、远端模型自动同步或模型收藏系统。
- 不改变历史消息 `provider_model` 的记录语义。
- 模型控件 UI 本身不改变聊天意图判定或结构化输出合同。

## 设计原则

### KISS

首版只移动和压缩现有模型状态，不新增复杂的模型管理系统。

### YAGNI

如果当前没有稳定的模型列表缓存，先提供当前模型展示和设置入口，不强行做完整下拉模型切换。

### DRY

模型信息继续复用 `getAiSettingsState()`，不在 `ReadingAssistantPanel` 里复制 Provider 配置状态。

### SOLID

- `ReadingAssistantPanel` 负责展示和交互编排。
- AI Provider 配置仍由设置页负责。
- 后端命令仍只保存全局 Provider 设置，不引入消息级模型配置。

## 当前问题

### 1. 视觉权重过高

独立模型卡片使用边框、背景、两列布局和大号“模型设置”按钮，视觉权重接近功能卡片。聊天面板空间有限，这会压缩消息列表。

### 2. 控件位置不符合任务流

用户的发送流程是：

1. 输入问题。
2. 必要时确认模型。
3. 发送。

模型控件应靠近输入和发送按钮，而不是出现在消息流顶部。

### 3. 设置入口过于突出

“模型设置”是低频操作，不应每次占据主视觉。高频信息是“当前使用什么模型”，低频动作是“去设置页修改 Provider”。

## 推荐方案

采用 composer 内模型控制区。

### 结构

```tsx
<form className="reading-assistant-composer">
  <textarea />
  <div className="reading-assistant-composer-footer">
    <button className="reading-assistant-model-chip" type="button">
      <span>DeepSeek</span>
      <ChevronDown size={13} />
    </button>
    <span className="reading-assistant-model-meta">
      deepseek-v4-flash · JSON
    </span>
    <button className="reading-assistant-send-button" />
  </div>
</form>
```

### 布局

- `reading-assistant-composer` 改为两行 grid：
  - 第一行：`textarea`
  - 第二行：模型控件和发送按钮
- footer 使用 `grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto`
- 发送按钮从 absolute 改为 footer 内固定尺寸按钮。
- 文本区保留最小高度，footer 不额外撑高太多。

### 展示内容

模型 chip：

- Provider preset label：`OpenAI`、`DeepSeek`、`DashScope`、`Moonshot`、`自定义`
- 状态异常时：
  - 未配置 Provider：`未配置`
  - 未配置 Key：Provider 名旁显示轻量 warning 状态

模型 meta：

- `model`
- response format policy 简写：
  - `auto`：`自动`
  - `jsonSchemaFirst`：`Schema`
  - `jsonObjectFirst`：`JSON`
  - `noResponseFormatFirst`：`宽松`

示例：

```text
[DeepSeek ▾] deepseek-v4-flash · JSON
[OpenAI ▾] gpt-4o-mini · Schema
[自定义 ▾] qwen-plus · 自动
[未配置 ▾] 未设置模型
```

## 交互设计

### 点击模型 chip

首版建议打开轻量菜单，而不是直接打开完整设置页。

菜单项：

```text
当前模型
DeepSeek
deepseek-v4-flash
JSON 模式

────────
模型设置
刷新状态
```

行为：

- `模型设置`：调用现有 `onOpenAiSettings`，进入全局 AI 设置。
- `刷新状态`：调用现有 `refreshAiSettings()`。
- 若正在生成：菜单可打开，但设置和刷新禁用，避免生成中切换状态。

### 是否做聊天框内模型切换

分两阶段。

#### P0：只做下沉和设置入口

P0 不直接在聊天框内切换模型，只展示当前模型并提供设置入口。

理由：

- 当前 Provider 配置包含 Base URL、API Key、模型名、响应格式策略、能力探测，状态耦合较多。
- 在聊天框内直接保存模型会引入失败回滚、探测提示、模型列表为空等额外状态。
- 当前主要问题是 UI 占空间，不是模型切换路径不可达。

#### P1：可选支持快速选择已知模型

仅当现有设置页已有可复用的模型列表状态后再做。

约束：

- 只允许选择当前 Provider 下的模型名。
- 不切换 Provider。
- 不编辑 Base URL。
- 不编辑 API Key。
- 保存仍复用现有 Provider 设置命令。
- 保存失败时保留原模型并显示错误。

菜单示例：

```text
DeepSeek
✓ deepseek-v4-flash
  deepseek-chat
  deepseek-reasoner

────────
模型设置
刷新可用模型
```

P1 不是本次必要范围。

## 状态模型

复用现有状态：

```ts
const [aiSettings, setAiSettings] = useState<AiSettingsState>();
const [isLoadingAiSettings, setIsLoadingAiSettings] = useState(false);
```

新增 UI 状态：

```ts
const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
```

不新增后端字段。

不新增消息级字段。

不修改 `ReadingAssistantRequest`。

## 组件改造

### `ReadingAssistantPanel.tsx`

删除或停用：

- `renderModelStatusRow()` 在聊天主视图顶部的调用。
- 顶部独立 `.reading-assistant-model-status` 卡片。

新增：

- `renderComposerModelControl()`
- `renderComposerModelMenu()`

建议结构：

```tsx
function renderComposerModelControl() {
  return (
    <div className="reading-assistant-composer-footer">
      <div className="reading-assistant-composer-model">
        <button type="button" className="reading-assistant-model-chip">
          <span>{providerLabel}</span>
          <ChevronDown size={13} />
        </button>
        <span className="reading-assistant-model-meta">{modelMeta}</span>
      </div>
      <button className="reading-assistant-send-button" />
    </div>
  );
}
```

`handleOpenModelSettings()` 保留，供菜单中的“模型设置”调用。

`refreshAiSettings()` 保留，供菜单中的“刷新状态”调用。

### `styles.css`

移除顶部状态条对聊天网格行数的影响：

```css
.reading-assistant-chat-view {
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
}
```

如果上下文行仍保留，则聊天视图不再因模型状态额外增加一行。

改造 composer：

```css
.reading-assistant-composer {
  display: grid;
  grid-template-rows: minmax(70px, auto) auto;
  gap: 10px;
  padding: 12px;
}

.reading-assistant-composer-footer {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.reading-assistant-composer-model {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.reading-assistant-model-chip {
  min-width: 0;
  max-width: 42%;
}

.reading-assistant-model-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

发送按钮：

- 改为 footer 内普通 grid item。
- 保持 `36px * 36px`。
- 不再使用 absolute 定位。

## 响应式规则

桌面：

- chip 和 meta 同行。
- 长模型名 ellipsis。
- 发送按钮固定在右下。

移动：

- footer 仍单行。
- chip 最大宽度降低到 `48%`。
- meta 可隐藏策略后缀，只保留模型名，或保持 ellipsis。
- 不能让发送按钮换行。

建议移动端文案：

```text
[DeepSeek ▾] deepseek-v4...
```

## 可访问性

- chip 使用 `aria-haspopup="menu"`。
- 菜单打开时 `aria-expanded=true`。
- `Esc` 关闭菜单。
- 点击 composer 外部关闭菜单。
- 菜单项使用 button，不使用不可聚焦 div。
- 模型 meta 不作为唯一信息来源，chip `title` 可包含完整 Provider、Model、策略。

## 错误状态

### 模型状态读取失败

composer 内显示：

```text
[模型 ▾] 状态暂不可用
```

菜单仍提供：

- `刷新状态`
- `模型设置`

### 未配置 API Key

composer 内显示：

```text
[DeepSeek ▾] deepseek-v4-flash · 未配置密钥
```

发送前不在 UI 层强拦截，沿用后端错误路径。原因是凭据状态可能变化，最终判断应以后端为准。

### 生成中

- chip 可禁用或只读。
- `模型设置` 和 `刷新状态` 禁用。
- 发送按钮变为取消按钮，保持现有语义。

## 实施步骤

### Step 1：布局下沉

- 从聊天视图移除 `{renderModelStatusRow()}`。
- 在 composer footer 中新增模型控件。
- 调整 `reading-assistant-chat-view` 行定义。
- 调整 composer padding，移除为 absolute send button 预留的右侧大 padding。

### Step 2：轻量菜单

- 增加 `isModelMenuOpen`。
- 点击 chip 展开菜单。
- 菜单提供“模型设置”和“刷新状态”。
- 外部点击、Esc、切换视图时关闭菜单。

### Step 3：样式收敛

- 删除或停用 `.reading-assistant-model-status`。
- 新增 `.reading-assistant-composer-footer`、`.reading-assistant-model-chip`、`.reading-assistant-model-meta`、`.reading-assistant-model-menu`。
- 检查浅色/深色主题。

### Step 4：回归验证

- 普通问答可发送。
- 普通问答和新书推荐流式输出不受影响。
- 生成中可取消。
- 模型状态读取失败不阻断输入。
- 未配置 Key 时错误仍由后端返回。
- 移动宽度下模型名不撑破 composer。

## 验收标准

- 打开 AI 阅读助手后，消息区顶部不再出现大模型状态卡片。
- 输入框内能看到当前 Provider、Model 和兼容策略。
- 长模型名不会撑破输入框。
- 点击模型 chip 能进入模型菜单。
- 点击“模型设置”仍进入现有 AI 设置。
- 生成中不能触发会改变 Provider 设置的动作。
- `npx tsc --noEmit --pretty false` 通过。
- `npm test` 通过。

## P0 实施状态

日期：2026-07-11。

P0 已完成。

实现结果：

- `ReadingAssistantPanel` 已移除聊天顶部模型状态条展示。
- composer footer 内新增模型 chip 和模型 meta。
- 模型 chip 展示 Provider，meta 展示模型名和响应格式策略简写。
- 点击 chip 打开轻量菜单，菜单展示当前模型、模型设置和刷新状态。
- `模型设置` 复用现有 `onOpenAiSettings`，进入全局 AI 设置。
- `刷新状态` 复用现有 AI 设置状态刷新逻辑。
- 生成中菜单动作禁用，发送按钮保持取消生成语义。
- 切换 history/settings 视图和关闭面板时会收敛模型菜单状态。

验证结果：

- `npx tsc --noEmit --pretty false`：通过。
- `npm test`：通过，72 个测试文件，402 个测试。
- `npm run e2e -- --grep "AI 阅读助手"`：通过，7 个 AI 阅读助手用例。
- `npm run e2e`：通过，84 个 E2E 用例。
- `git diff --check`：通过，仅有 LF/CRLF 提示。

覆盖用例：

- 消息区顶部不再出现 `.reading-assistant-model-status`。
- composer 内显示当前模型和响应格式策略。
- 模型菜单可打开，并能进入现有 AI 设置页。
- 生成中模型菜单动作禁用。
- 生成中仍可取消。
- 普通问答和新书推荐流式输出不受影响。

P1 仍保持后置：

- 不在本轮实现聊天框内模型快速切换。
- 不在聊天框内编辑 Provider、Base URL 或 API Key。
- 不引入消息级模型选择。

## 过当检查

不应引入：

- 独立模型配置弹窗。
- 每条消息的模型选择器。
- 历史消息旁的模型切换按钮。
- Provider 列表在线市场。
- 聊天框内 API Key 输入。
- 新的后端表或消息级模型字段。

## 遗漏检查

实现时需要确认：

- `ReadingAssistantPanel` 切换到 history/settings 视图时关闭模型菜单。
- 面板关闭时关闭模型菜单。
- 生成中取消按钮仍可点击。
- 键盘 Enter 发送逻辑不受 footer 影响。
- 现有 `onOpenAiSettings` 从 `App.tsx` 进入 AI 设置页的链路不被破坏。
- 深色主题下 chip、meta、菜单仍有足够对比度。

## 后续可选增强

只有在 P0 验收稳定后再考虑：

- 当前 Provider 下快速切换已拉取模型。
- 在菜单内显示响应格式策略说明。
- 对普通问答显示“当前将尝试流式输出”的轻量状态。
- 对不支持结构化输出的 Provider 给出一次性设置建议。
