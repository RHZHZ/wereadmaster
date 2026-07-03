# AI 阅读助手 P3.2 普通问答流式输出设计

## 目标

P3.2 只优化普通解释型问答的等待体验。最终回答仍以完整结构化 JSON 为准，继续保存到本地历史，不能为了流式破坏推荐卡片、快捷追问和历史恢复。

## 适用范围

流式适用：

- 普通阅读问题解释。
- 阅读计划建议。
- 基于本地上下文的开放追问。
- 直接列出复盘问题或追问清单。

不流式适用：

- 新书推荐。
- 推荐书卡片生成。
- 候选书架决策。
- 任何必须稳定依赖完整结构化输出的场景。

## 技术策略

采用单次 OpenAI-compatible streaming 请求：

1. 后端仍使用 `reading_assistant_response` JSON schema。
2. Provider 返回 SSE 增量文本，本质是逐步输出 JSON 字符串。
3. 后端持续收集 JSON 文本，并只从 `answer` 字段中提取可展示前缀。
4. 每次 `answer` 前缀变长时，通过 Tauri event 推送 delta。
5. 流结束后，后端解析完整 JSON，走原有 `normalize_reading_assistant_output`、落库和返回 `ReadingAssistantAnswer`。

不采用：

- 不做双请求。避免先流式自然语言、再完整 JSON 的成本和不一致问题。
- 不让推荐书卡片流式。推荐卡片必须等完整 JSON 后展示。
- 不从前端解析 JSON。前端只消费 `delta/content` 事件。

## 事件协议

事件名：

```text
reading-assistant-stream
```

事件 payload：

```json
{
  "streamId": "本次请求 ID",
  "delta": "本次新增文本",
  "content": "当前完整 answer 文本"
}
```

前端只处理 `streamId` 匹配当前请求的事件。

## 前端状态

提交后立即插入一条本地 pending 助手消息：

- 有 delta 时更新这条消息的 `content`。
- 最终命令返回后，用正式 `ReadingAssistantAnswer` 替换 pending 消息。
- 如果后端判断该问题不适合流式，则 pending 消息保持加载态，最终仍用正式回答替换。
- 历史回放不展示 pending；历史只显示已经落库的完整回答。

## 失败策略

- 用户取消：前端移除 pending 消息，后端按 `streamId` 标记取消，流式循环在下一次 chunk 检查时停止，不落库半截文本。
- SSE 解析失败：本次请求失败，显示原有错误提示。
- Provider 不支持 stream 或 json schema stream：后续可降级为完整 JSON 请求。
- 完整 JSON 解析失败：不落库半截文本，不把流式草稿写入历史。

## 验收标准

- 普通问答能边生成边显示。
- 生成中可以取消，取消后不保留半截回答。
- 新书推荐和候选书决策仍等待完整回答，不显示半截推荐卡片。
- 最终回答仍包含快捷追问、推荐卡片和上下文 chips。
- 历史回放只出现完整回答，不出现半截流式文本。
- TypeScript、前端测试、Rust 测试和生产构建通过。
