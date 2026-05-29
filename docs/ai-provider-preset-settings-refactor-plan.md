# AI Provider 预设与兼容配置改造计划

## 文档状态

- 状态：已实现，后续只保留 Provider 文档复核与真实账号回归。
- 目标范围：设置页 AI Provider 配置、常用模型预设、结构化输出兼容策略、连通性与能力探测提示。
- 关联文档：`docs/ai-feature-plan.md`、`docs/local-reader-ai-question-containment-refactor-plan.md`。
- 当前触发问题：DeepSeek 等 OpenAI-compatible Provider 基础连通性测试通过，但实际问答可能因 `response_format` 兼容差异失败，例如 `This response_format type is unavailable now`。

## 背景

当前 AI 设置只暴露三个手填项：

- `Base URL`
- `模型`
- `AI API Key`

这对熟悉 OpenAI-compatible API 的用户足够，但对普通用户有三个明显问题：

- 常见 Provider 的 Base URL 容易填错。
- 连通性测试只证明 Key、URL 和模型基础请求可用，不代表结构化输出能力可用。
- 不同 Provider 对 `response_format.json_schema`、`response_format.json_object` 的支持不一致，实际生成时才暴露错误。

后端已经具备结构化输出降级链路：

```text
json_schema -> json_object -> 不传 response_format
```

设置页下一步不需要重做 AI 调用层，而是应该把这条兼容策略前置展示，并通过常用 Provider 预设减少误配。

## 改造目标

一句话目标：

```text
让用户可以选择常用 AI Provider 预设，一键填充默认 Base URL、模型和兼容策略；仍保留手动编辑能力，并在测试时明确展示基础连通性与结构化输出兼容状态。
```

具体目标：

- 设置页新增常用 Provider 选择。
- 选择预设后自动填充 Base URL、推荐模型和响应格式策略。
- Base URL 和模型仍可手动修改，不把 preset 做成不可编辑模型市场。
- 明确区分“连通性通过”和“结构化输出兼容通过”。
- 对不稳定或不支持 `response_format` 的模型，允许直接使用宽松模式，避免每次请求都先失败再降级。
- 旧用户已保存的 Base URL、模型和 Key 继续可用，不强制迁移。

## 非目标

- 不做完整模型商店。
- 不自动在线拉取模型列表；只在用户点击“刷新可用模型”时请求当前 Provider 的 `/models` 兼容接口。
- 不保存或展示 API Key 明文。
- 不自动替用户切换 Provider。
- 不把 Provider preset 和业务功能强绑定。
- 不把远端模型列表作为强校验；刷新失败或模型未列出时仍允许手动输入。
- 不因为某个 Provider 不支持 `json_schema` 就禁用 AI 功能。
- 不在本阶段引入流式输出、工具调用或多模态模型配置。

## 设计原则

### 预设是建议，不是锁定

Provider preset 只负责降低配置门槛。用户选择后，表单仍展示真实 Base URL 和模型名，允许继续编辑。

原因：

- 模型名更新频繁，硬编码模型列表会很快过期。
- 不同账号、地域或套餐可用模型不同。
- 用户可能使用第三方 OpenAI-compatible 代理或自部署网关。

### 兼容策略要显式

基础连通性测试通过不代表实际 AI 生成可用。设置页必须让用户知道当前采用哪种响应格式策略：

- 优先 JSON Schema。
- 优先 JSON Object。
- 不传 `response_format`，仅靠 prompt 要求返回 JSON。
- 自动探测并降级。

### 后端仍是可信边界

Preset 可以放在前端，但最终请求策略必须由 Rust trusted layer 执行。前端不能因为 preset 选择直接绕过后端安全边界。

## 推荐信息架构

AI 设置卡片建议保持一个紧凑分区，不新增复杂页面。

```text
AI 设置
├─ Provider 预设
│  ├─ OpenAI
│  ├─ DeepSeek
│  ├─ 通义千问
│  ├─ Kimi
│  └─ 自定义
├─ Base URL
├─ 模型
│  ├─ 刷新可用模型
│  └─ 手动输入兜底
├─ 兼容模式
│  ├─ 自动兼容
│  ├─ 严格结构化
│  ├─ 通用 JSON
│  └─ 宽松兼容
├─ 新的 AI API Key
└─ 操作
   ├─ 保存 AI 设置
   ├─ 测试连通性
   ├─ 测试兼容性
   └─ 移除 AI Key
```

如果空间有限，`测试兼容性` 可以先合并到 `测试连通性`，但结果区必须拆开展示。

## 首批 Provider 预设

首批只做低风险、高频、OpenAI-compatible 的 Provider。

| Preset | Base URL 建议 | 模型建议 | 默认兼容策略 | 说明 |
| --- | --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `json_schema_first` | 保持当前默认值，兼容现有缓存和测试。 |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | `no_response_format_first` | 优先避免 `response_format` 兼容错误；用户可改为实际可用模型。 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `json_object_first` | 先按 OpenAI 兼容接口接入，JSON Schema 支持需以探测结果为准。 |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | `json_object_first` | 保持轻量接入，避免假设所有模型支持 JSON Schema。 |
| 自定义 | 空或保留当前值 | 空或保留当前值 | `auto` | 给代理、自部署和未列出的兼容 Provider 使用。 |

注意：

- 上表模型名是初始可编辑建议，不作为强校验白名单。
- 如果用户当前已经保存了 `deepseek-v4-flash` 等模型，不应被 preset 覆盖，除非用户主动选择 preset 并确认应用。
- Base URL 要按当前后端 `chat_completions_url` 规则验证。后端规则是：

```text
baseUrl 以 /chat/completions 结尾：直接使用
baseUrl 以 /v1 结尾：追加 /chat/completions
其他情况：追加 /v1/chat/completions
```

因此 preset 应优先使用能和当前拼接规则稳定匹配的地址。

## 兼容模式定义

建议新增内部枚举：

```ts
type AiResponseFormatPolicy =
  | "auto"
  | "json_schema_first"
  | "json_object_first"
  | "no_response_format_first";
```

语义：

- `auto`：默认策略，由后端根据 Provider 设置和历史探测结果决定。
- `json_schema_first`：先尝试 JSON Schema，失败后降级到 JSON Object，再失败不传 `response_format`。
- `json_object_first`：跳过 JSON Schema，先尝试 JSON Object，失败后不传 `response_format`。
- `no_response_format_first`：完全不传 `response_format`，只依赖系统提示词要求输出 JSON，并继续使用现有 JSON 解析。

当前 DeepSeek 报错更适合 `no_response_format_first` 或 `json_object_first`，不要让用户每次真实问答都经历两次失败请求。

## 数据模型

### 前端 preset

前端可以先新增常量，不需要远端配置：

```ts
type AiProviderPresetId =
  | "openai"
  | "deepseek"
  | "dashscope"
  | "moonshot"
  | "custom";

type AiProviderPreset = {
  id: AiProviderPresetId;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  responseFormatPolicy: AiResponseFormatPolicy;
};
```

Preset 常量建议放在：

```text
src/lib/ai-provider-presets.ts
```

原因：

- 设置页只消费配置，不承担 Provider 知识维护。
- 后续测试可以直接覆盖 preset 常量。
- 避免 `SettingsPage.tsx` 继续变大。

### 后端设置

当前后端 `AiProviderSettings` 只有：

```rust
pub struct AiProviderSettings {
    pub base_url: String,
    pub model: String,
}
```

建议扩展为：

```rust
pub struct AiProviderSettings {
    pub base_url: String,
    pub model: String,
    pub preset_id: Option<String>,
    pub response_format_policy: Option<AiResponseFormatPolicy>,
}
```

兼容原则：

- 旧 Stronghold 记录缺字段时正常反序列化。
- 缺 `response_format_policy` 时按 `auto`。
- 缺 `preset_id` 时按 `custom` 展示。
- 现有 `base_url`、`model` 不被自动改写。

### API 入参

现有命令：

- `save_ai_credential`
- `save_ai_settings`
- `test_ai_connection`

建议扩展入参：

```ts
{
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}
```

兼容原则：

- 前端不传新字段时沿用旧行为。
- 后端默认 `auto`，不影响旧测试。
- Key 仍只写入本机安全存储。

## 请求策略改造

当前核心链路：

```text
request_ai_json_with_schema_fallback
└─ request_ai_json
   └─ request_ai_json_without_response_format
```

建议保留这条链路，只在入口根据 `response_format_policy` 选择起点。

```text
json_schema_first:
  json_schema -> json_object -> none

json_object_first:
  json_object -> none

no_response_format_first:
  none

auto:
  有历史探测结果：按探测结果选择
  无历史探测结果：json_schema -> json_object -> none
```

实现上不需要复制三套请求函数，可以新增一个小的策略函数：

```rust
async fn request_ai_json_with_policy(
    api_key: &str,
    provider: &AiProviderSettings,
    system_prompt: &str,
    input: &Value,
    schema_name: &str,
    schema: Value,
) -> Result<ProviderJsonResult, AiServiceError>
```

该函数只负责选择起点，底层仍复用现有请求函数。

## 连通性与兼容性测试

### 当前问题

现有测试请求不传 `response_format`：

```text
messages: "请只回复 ok"
max_tokens: 20
```

这只能证明基础接口可用，不能证明实际结构化生成可用。

### 建议结果结构

保留现有 `isValid` 布尔值，同时新增可选诊断字段：

```ts
type AiProviderCapabilityProbe = {
  basic: "passed" | "failed" | "skipped";
  jsonObject: "passed" | "failed" | "skipped";
  jsonSchema: "passed" | "failed" | "skipped";
  recommendedPolicy: AiResponseFormatPolicy;
  message?: string;
};
```

如果不想扩大现有 `AiCredentialValidationResult`，也可以新增独立命令：

```text
probe_ai_provider_capabilities
```

更推荐新增独立命令，原因：

- 不破坏现有测试连通性调用语义。
- 用户可以先快速测基础连通，再主动测兼容性。
- 避免保存设置时额外发多次请求。

### 探测请求

基础连通：

- 不传 `response_format`。
- 只要求回复 `ok`。

JSON Object：

- 传 `response_format: { "type": "json_object" }`。
- 要求返回 `{"ok": true}`。

JSON Schema：

- 传最小 JSON Schema。
- 要求返回 `{"ok": true}`。

探测必须限制：

- `temperature: 0`
- 小 `max_tokens`
- 明确超时
- 失败只展示诊断，不自动保存 Key 明文或远端响应全文

## 设置页交互

### Preset 选择

推荐使用下拉或紧凑 segmented control。考虑当前设置页是模态偏好中心，首版用 `<select>` 更稳：

```text
Provider 预设：[DeepSeek v]
```

选择行为：

- 如果当前 Base URL 和模型为空，直接填充。
- 如果已有值且和当前 preset 不一致，显示轻提示：“将用 DeepSeek 默认配置覆盖当前 Base URL、模型和兼容模式”。
- 不覆盖 API Key。
- 切换到 `自定义` 时不清空现有值。

### 兼容模式展示

默认展示简短标签：

```text
兼容模式：宽松兼容
```

可编辑，但不要用长段说明占据表单。详细说明放在 `Info` tooltip 或折叠提示中。

### 测试结果展示

连通性测试结果不要只显示“通过/失败”，建议展示：

```text
基础连通：通过
通用 JSON：失败
严格结构：失败
推荐兼容模式：宽松兼容
```

对于用户遇到的 DeepSeek 错误，应显示成：

```text
当前模型不支持应用的结构化输出参数，已建议使用“宽松兼容”模式。
```

不要直接把完整 Provider 错误塞进主 UI；完整错误可放在诊断详情或复制按钮里。

## 错误文案

现有错误：

```text
AI Provider 返回 HTTP 400：This response_format type is unavailable now
```

建议用户可见文案：

```text
当前模型不支持应用请求的结构化输出格式。请在 AI 设置中切换为“自动兼容”或“宽松兼容”模式后重试。
```

如果后端已经自动降级成功，详情页只展示实际使用的模式：

```text
结构化约束：无 response_format
```

不把中间失败作为最终错误展示。

## 存量数据与迁移

### 已保存设置

旧设置保持：

- 已保存 API Key 不变。
- 已保存 Base URL 不变。
- 已保存模型不变。
- `preset_id` 缺失时展示为 `自定义`。
- `response_format_policy` 缺失时展示为 `自动`。

### 已生成 AI 缓存

不迁移 `ai_outputs`。

原因：

- 缓存已经记录 `provider_model` 和 `responseFormat`。
- Provider preset 不改变旧输出事实。
- 新策略只影响后续生成。

### 本地阅读器 AI 提问记录

不迁移已有提问记录。

原因：

- 提问记录保存的是问题、回答、状态和实际 Provider 返回结果。
- Provider preset 只影响新请求。
- 旧失败记录可以由用户重试或继续追问生成新 turn。

## 验收标准

### 功能验收

- 用户能在设置页选择常用 Provider 预设。
- 选择预设后 Base URL、模型和兼容模式按预设填充。
- 用户能手动修改 Base URL、模型和兼容模式。
- 用户能点击“刷新可用模型”获取当前 Provider 返回的模型列表。
- 模型输入框始终允许手动输入，不因模型列表为空或刷新失败被阻断。
- 保存后重启应用仍能恢复设置。
- 未输入新 Key 时，保存 Provider 设置不要求重新输入 Key。
- 未输入新 Key 时，连通性测试仍能复用已保存 Key。
- DeepSeek 类模型在“宽松兼容”模式下不再因 `response_format` 报错。
- AI 生成结果仍保留实际 `responseFormat` 元数据。

### 兼容验收

- 旧 Stronghold Provider 设置可以正常读取。
- 旧前端调用不传新字段时可以正常保存。
- Web 预览模式继续返回 `preview-readonly`，不显示真实 Provider preset。
- `chat_completions_url` 不因 preset 出现重复 `/v1/v1` 或重复 `/chat/completions`。

### UI 验收

- 设置页仍保持紧凑控制面板，不变成大模型商城。
- Provider preset、Base URL、模型、兼容模式和 Key 输入不互相遮挡。
- 长 Base URL 和长模型名不会撑破设置卡片。
- 测试结果在移动宽度下也不会越界；虽然本地阅读器不做手机版，设置弹窗仍要保持基本响应式。

## 测试计划

### 单元测试

- `src/lib/ai-provider-presets.test.ts`
  - 每个 preset 有唯一 id。
  - 每个 preset 有合法 Base URL。
  - 每个 preset 有默认模型。
  - `custom` 不强制覆盖已有输入。

- `src/lib/reading-api.test.ts`
  - `AiSettingsState` 兼容缺失 `presetId` 和 `responseFormatPolicy`。
  - 保存 AI 设置时可以传递新字段。
  - 刷新模型列表调用 `list_ai_provider_models`，且不携带明文 Key 之外的额外状态。

- `src-tauri/src/services/ai.rs`
  - 旧 Provider JSON 反序列化成功。
  - 缺 `response_format_policy` 时归一化为 `auto`。
  - `json_object_first` 不发送 JSON Schema 请求。
  - `no_response_format_first` payload 不含 `response_format`。
  - `is_unsupported_response_format_response` 继续识别 DeepSeek 报错。
  - `models_url` 正确处理根地址、`/v1`、`/models` 和 `/chat/completions`。
  - `parse_provider_model_list` 能读取 OpenAI-compatible 的 `data[].id`。

### 组件测试

- `src/pages/SettingsPage.test.tsx`
  - AI 设置页展示 Provider 预设。
  - 选择 DeepSeek 后填充默认 Base URL、模型和兼容模式。
  - 已有自定义配置切换 preset 时不覆盖 Key。
  - 测试结果可以展示基础连通和结构化能力。
  - 模型输入展示“刷新可用模型”入口，刷新结果以下方候选按钮回填同一个输入框。

### E2E

- 打开设置页 AI 分类。
- 选择 DeepSeek preset。
- 输入测试 Key 或复用已保存 Key。
- 点击测试连通性。
- 如果 Provider 返回 `response_format` 不支持，UI 应建议兼容模式，不把基础连通误判为失败。
- 在本地阅读器选区问 AI，确认最终请求不会因 `response_format` 失败中断。

## 实施顺序

### P0：文档与边界确认

- [x] 明确 preset 不是模型商店。
- [x] 明确兼容模式是响应格式策略，不改变输入数据边界。
- [x] 明确旧设置和旧缓存不迁移。

### P1：前端 preset 与设置页 UI

- [x] 新增 `src/lib/ai-provider-presets.ts`。
- [x] 设置页 AI 分类新增 Provider 预设选择。
- [x] 新增兼容模式选择。
- [x] 保存和测试接口透传新字段。
- [x] 补 SettingsPage 组件测试。

### P2：后端设置与请求策略

- [x] 扩展 `AiProviderSettings`。
- [x] 增加 `AiResponseFormatPolicy`。
- [x] 按策略选择请求起点。
- [x] 保持旧 Stronghold 数据兼容。
- [x] 补 Rust 单测。

### P3：兼容性探测

- [x] 评估并新增 `probe_ai_provider_capabilities` 命令。
- [x] 增加 JSON Object 与 JSON Schema 最小探测。
- [x] 设置页展示探测结果和推荐策略。
- [x] 错误文案从 Provider 原文收敛为用户可操作建议。

### P4：刷新可用模型

- [x] 新增 `list_ai_provider_models` 命令。
- [x] 后端按当前 Base URL 推导 `/models` 地址。
- [x] 前端模型输入保留单一输入框，刷新后以候选按钮选择并回填。
- [x] 保留手动输入兜底，不把模型列表作为白名单。
- [x] 刷新失败时提示仍可手动输入，不阻断保存和测试。

## 风险与处理

### 模型名过期

风险：硬编码模型名可能随 Provider 更新而过期。

处理：

- 模型名只作为可编辑默认值。
- 不做模型白名单。
- 测试失败时提示用户确认账号可用模型。
- 用户可手动点击刷新模型列表，但刷新结果只做候选项，不做保存前校验。

### 模型列表接口不兼容

风险：部分 OpenAI-compatible Provider 不开放 `/models`，或返回格式不含 `data` 数组。

处理：

- 刷新模型是用户主动动作，不在打开设置页时自动触发。
- 刷新失败只提示当前列表不可用，不影响手动输入模型名。
- 后端只解析最通用的 OpenAI-compatible `data[].id`，避免引入 Provider 私有适配复杂度。

### Provider 行为差异

风险：同一 Provider 不同模型对 `response_format` 支持不同。

处理：

- 兼容模式以用户当前模型为准。
- 能力探测结果只对当前 Base URL + 模型 + Key 有效。
- 不把 Provider 级判断套到所有模型。

### 多次探测增加成本

风险：测试兼容性会产生额外请求。

处理：

- 基础连通和兼容性探测分开。
- 兼容性探测只在用户点击时执行。
- 每个探测请求限制 token 和超时。

### 错误被隐藏

风险：自动降级成功后用户不知道实际用了较弱约束。

处理：

- AI 输出元数据继续展示实际 `responseFormat`。
- 导出 Markdown 继续记录结构化约束。
- 设置页展示当前兼容模式。

## 参考资料

实现前需要以官方文档复核 Base URL、模型名和结构化输出支持：

- OpenAI API Reference：`https://platform.openai.com/docs/api-reference`
- OpenAI Structured Outputs：`https://platform.openai.com/docs/guides/structured-outputs`
- DeepSeek API Docs：`https://api-docs.deepseek.com/`
- DashScope OpenAI 兼容模式：`https://help.aliyun.com/document_detail/2666499.html`
- Moonshot / Kimi API 文档：`https://platform.moonshot.cn/docs`
