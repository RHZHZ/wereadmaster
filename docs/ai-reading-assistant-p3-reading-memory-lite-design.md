# AI 阅读助手 P3.3 阅读记忆检索-lite 设计

## 目标

P3.3 让 AI 阅读助手具备轻量跨资产记忆，但不做向量库、全文问答或后台索引。记忆只来自本地已有的结构化摘要和状态，必须可关闭、可追溯来源、预算可控。

## 输入来源

允许注入：

- 最近 AI 资产摘要。
- 最近统计复盘摘要。
- 最近候选书/选书决策摘要。
- 少量候选书本地状态。

不允许注入：

- 全书全文。
- 全量原始笔记。
- 原始 WeRead 响应。
- 本地文件路径、数据库路径、API Key。
- 不可追溯的“长期记忆”。

## 上下文形态

在 AI 阅读助手上下文中新增：

```json
{
  "readingMemory": {
    "basis": "只来自本机可追溯的结构化阅读资产和状态。",
    "items": [
      {
        "type": "aiAssetSummary",
        "sourceRef": "ai-asset:book_id",
        "title": "书名",
        "summary": {}
      }
    ]
  }
}
```

每个记忆片段必须带 `sourceRef`。前端已通过 used context chips 展示“阅读记忆”来源数量。

## 开关策略

- `usePersonalizedContext=false`：不读取任何本地阅读记录。
- `useReadingMemory=false`：不注入 `readingMemory`。
- `allowRawBookNotes=false`：不影响阅读记忆，因为阅读记忆不读取原始笔记。

## 默认上下文调整

- 全局助手和候选书架默认使用 `readingMemory`，不再通过 `aiAssetSummary` 注入宽泛最近资产。
- 当前书、AI 资产详情仍保留 `aiAssetSummary`，因为它们是用户当前所在对象的直接上下文。

## 验收标准

- 默认全局问答会注入少量 `readingMemory`。
- 关闭阅读记忆后不注入 `readingMemory`。
- 每个记忆片段都有 `sourceRef`。
- 不读取全文、原始笔记或远端数据。
- TypeScript、前端测试、Rust 测试和生产构建通过。
