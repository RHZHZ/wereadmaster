# 反馈成果回顾实施方案

## 目标

在现有“轻量行动反馈闭环”基础上，进一步实现“反馈成果回顾闭环”：

- 把用户对书籍复盘、阅读指南和跨书路线的反馈视为阅读成果。
- 在生成新版资产前，把上一版反馈整理为可供 AI 参考的短上下文。
- 在版本详情页中把这段整理结果展示为 `上次沉淀`。

本方案只解决可落地实现，不再重复讨论产品是否应该这样做；产品口径见 `docs/feedback-outcome-review-plan.md`。

## 现状盘点

### 已有能力

#### 1. 书籍复盘已有更新上下文机制

Rust 服务层已经支持在生成复盘时传入 `updateContext`：

- `src-tauri/src/services/ai.rs` 中已有 `BookAiSummaryUpdateContext`
- `book_notes_summary_system_prompt()` 已明确要求：如果输入包含 `updateContext`，应参考上一版反馈，避免重复生成已完成或不适合的建议
- `book_summary_update_context_payload(...)` 已把上一版行动反馈和复盘问题反馈整理成输入 JSON

这意味着书籍复盘距离“成果回顾”只差两步：

- 把 AI 回顾结果结构化输出回来
- 前端把这段结果显示出来

#### 2. 阅读指南已有本地行动反馈与跨版本继承

前端 `ReadingRouteResultPanel` 已支持：

- `nextActions` 的四态反馈
- 基于 `feature + scopeId + inputHash` 的本地轻量继承

但它目前仍停留在前端状态继承层，没有像书籍复盘那样进入 Rust 生成输入上下文，也没有“成果回顾”输出字段。

#### 3. 版本详情页已有“更新依据”展示位置

`src/pages/ReadingHubPage.tsx` 当前已具备：

- `updateContextItems` 的整理逻辑
- `更新依据` 区块
- `重新生成前应核对` 弹窗
- 版本详情作为统一长内容承载层

所以新增 `上次沉淀` 时，不需要开新页面，直接复用现有版本详情层即可。

## 实施范围

### 本期要做

1. 为书籍复盘和阅读指南新增统一的 `feedbackOutcomeSummary` 字段。
2. 让书籍复盘在 AI 输出中返回这段回顾。
3. 让阅读指南也具备类似的更新上下文输入与回顾输出。
4. 在单资产版本详情页展示 `上次沉淀`。
5. 在更新前确认区继续只展示摘要，不展示长正文。

### 本期不做

1. 不做全局历史任务页。
2. 不做新的 SQLite 表。
3. 不做长篇反馈表单。
4. 不把用户完整备注默认发给 AI。
5. 不引入“用户评价”“完成率”“执行力”字段。

## 数据结构设计

### 前后端统一新增类型

建议新增：

```ts
type FeedbackOutcomeSummary = {
  summary: string;
  appliedChanges?: string[];
};
```

挂载位置：

```ts
type BookAiSummary = {
  // existing fields
  feedbackOutcomeSummary?: FeedbackOutcomeSummary;
};

type ReadingRoute = {
  // existing fields
  feedbackOutcomeSummary?: FeedbackOutcomeSummary;
};
```

Rust 侧对应新增：

```rust
pub struct FeedbackOutcomeSummary {
    pub summary: String,
    pub applied_changes: Vec<String>,
}
```

并作为可选字段挂到：

- `BookAiSummary`
- `ReadingRoute`

### 为什么放在资产输出里

不新增独立表的原因：

- 这段内容属于“当前版本为什么这样生成”的说明。
- 它天然跟当前版本绑定。
- `ai_outputs.output_json` 已经是版本正文缓存，最适合承载这类可选解释字段。

## Rust 服务层改造

### 1. 书籍复盘

#### 现状

已有：

- `BookAiSummaryUpdateContext`
- `book_summary_update_context_payload(...)`
- prompt 中对 `updateContext` 的说明

#### 需要补的内容

1. 在 `book_notes_summary_json_schema()` 中增加可选 `feedbackOutcomeSummary`
2. 在 `normalize` / `sanitize` 相关逻辑中解析该字段
3. 在 `BookAiSummary` struct 中补字段
4. 调整 prompt：
   - 不只要求“参考反馈”
   - 还要求可选输出 1 段 `feedbackOutcomeSummary`

#### 建议 prompt 补充

建议在现有复盘 prompt 中追加：

- 当输入里包含 `updateContext` 时，可以额外返回可选 `feedbackOutcomeSummary`
- 该对象只包含 `summary` 和 `appliedChanges`
- `summary` 用 1-2 句说明上一版已完成的进展、放弃的方法和本次如何调整
- `appliedChanges` 为 1-3 条简短变化说明
- 不得评价用户表现，不得输出执行力、完成率、性格判断等结论

### 2. 阅读指南 / 跨书路线

#### 现状

改造前 `reading_route_system_prompt()` 尚未读取类似 `updateContext` 的结构化上下文，因此本方案补齐阅读指南的更新上下文入口。

#### 需要补的内容

1. 新增 `ReadingRouteUpdateContext`
2. 在 `ReadingRouteInput` payload 中按需插入 `updateContext`
3. 读取同一书籍上下文内上一版可复用反馈
4. 在 `reading_route_system_prompt()` 中加入对 `updateContext` 的约束
5. 在 `reading_route` JSON schema 中增加可选 `feedbackOutcomeSummary`

#### 建议输入结构

```json
{
  "updateContext": {
    "sourceInputHash": "...",
    "instruction": "生成新版本时参考上一版已完成行动、暂不做/不适合的动作和极短备注，避免重复建议，并用更适合当前阶段的动作替代。",
    "actionFeedback": [
      {
        "itemId": "0:完成一页复盘",
        "status": "completed",
        "note": "已写出三条现实应用",
        "updatedAt": "2026-06-26T10:00:00Z"
      }
    ]
  }
}
```

#### 建议 prompt 补充

在 `reading_route_system_prompt()` 中追加规则：

- 如果输入中包含 `updateContext`，必须优先参考上一版行动反馈
- 已完成动作应视为已有沉淀，不要重复原样建议
- 暂不做 / 不适合动作应减少重复出现，并替换为更轻量或更合适的动作
- 可选输出 `feedbackOutcomeSummary`
- `feedbackOutcomeSummary` 只说明上一版已完成的进展和本次建议如何调整，不评价用户本人

## 前端类型与 API 层改造

### 1. `src/lib/types.ts`

新增：

- `FeedbackOutcomeSummary`
- `BookAiSummary.feedbackOutcomeSummary?`
- `ReadingRoute.feedbackOutcomeSummary?`

### 2. `src/lib/reading-api.ts`

如果当前解析逻辑是显式挑字段，需要补：

- `feedbackOutcomeSummary.summary`
- `feedbackOutcomeSummary.appliedChanges`

要求：

- 字段缺失时继续兼容旧缓存
- 不能因为旧版本没有该字段而导致整个资产解析失败

## 页面改造

### 主展示层：`ReadingHubPage` 版本详情

这是成果回顾的主展示位置。

建议在当前 `更新依据` 区块后增加：

```tsx
<section aria-label="上次沉淀">
  <h4>上次沉淀</h4>
  <p>...</p>
  <ul>...</ul>
</section>
```

显示规则：

- 当前版本有 `feedbackOutcomeSummary` 时显示
- 没有则不显示占位空框
- 文案长度保持短，不抢主正文

### 为什么不放在资产库或书籍资产详情首屏

- 资产库层级职责是导航，不承载长解释
- 书籍资产详情首屏职责是看当前状态和动作入口
- 成果回顾属于“理解某一版为什么变了”，应放在版本详情

### 次级聚合层：书籍资产详情

本期不做长正文展示，只可后续补一个轻量信号：

- 最近是否有成果沉淀
- 最近一次反馈来自哪个资产类型

## 更新前确认弹窗

### 当前现状

`ReadingHubPage.tsx` 已有 `buildRegenerationReviewItems(...)` 和“重新生成前应核对”。

### 本期建议

继续保持这里只展示摘要，不展示完整 `feedbackOutcomeSummary`。

原因：

- 更新前弹窗职责是核对，不是回顾全文
- 长内容会让确认层变重

建议增加一句说明性文案：

`将参考你上次记录的阅读成果生成新版，避免重复给出已完成或不适合的建议。`

## 导出策略

### 本期建议

先不强制把 `feedbackOutcomeSummary` 写入 Markdown 导出正文。

原因：

- 先让版本详情闭环成立
- 导出层后续再决定是默认导出，还是作为可选区块导出

### 后续可选

如果补导出，建议作为短区块：

- 标题：`上次沉淀`
- 内容：`summary`
- 可选列点：`appliedChanges`

## 测试建议

### Rust

补以下测试：

1. 旧缓存没有 `feedbackOutcomeSummary` 时仍可正常解析
2. 复盘 `updateContext` 存在时可解析 `feedbackOutcomeSummary`
3. 阅读指南 `updateContext` 存在时可解析 `feedbackOutcomeSummary`
4. `feedbackOutcomeSummary` 字段异常时不影响主体资产解析

### 前端

补以下测试：

1. 版本详情页有 `feedbackOutcomeSummary` 时展示 `上次沉淀`
2. 没有该字段时不展示区块
3. 旧缓存返回仍可正常渲染
4. 更新前确认区继续只展示摘要，不展示长正文

## 实施顺序

### 第一步

补类型和文档对齐：

- `types.ts`
- Rust struct
- JSON schema

### 第二步

先打通书籍复盘：

- 复用现有 `updateContext`
- 增加输出字段
- 版本详情展示

### 第三步

再打通阅读指南：

- 新增 `ReadingRouteUpdateContext`
- prompt 接收反馈上下文
- 输出 `feedbackOutcomeSummary`

### 第四步

补测试与导出评估。

## 风险与注意事项

### 1. 不要把“成果回顾”写成批评文案

必须避免：

- “你没有完成”
- “你的执行力较弱”
- “建议提高完成率”

### 2. 不能让旧缓存失效

`feedbackOutcomeSummary` 必须是可选字段，旧数据继续可读。

### 3. 阅读指南的反馈来源要保持收敛

只读取当前书上下文内上一版相关反馈，不扩大成整站历史拼接。

### 4. 备注输入仍然要保持短

如果未来允许长备注，再单独评估是否默认送入 AI。本期仍按“极短补充说明”处理。

## 最终交付标准

满足以下条件即可视为本方案落地：

1. 书籍复盘和阅读指南都支持可选 `feedbackOutcomeSummary`
2. 新版生成时能参考上一版反馈
3. 版本详情页能展示 `上次沉淀`
4. 更新前确认层只展示摘要，不变成长文回顾页
5. 不新增全局任务历史页，不引入新表结构，不破坏旧缓存兼容

## 当前落地状态

截至本次实现，已完成：

- 已新增前后端统一字段 `feedbackOutcomeSummary`，并挂载到书籍复盘和阅读指南资产输出。
- 书籍复盘 prompt / JSON Schema / normalize 已支持“上次沉淀”输出，旧缓存缺失该字段仍兼容。
- 书籍复盘和阅读指南重新生成已支持 `updateFrom`；普通生成/缓存读取不携带上一版反馈，后端也只在 `regenerate=true` 且 feature/scope 匹配时读取上一版反馈。
- 书籍复盘仅在上一版存在真实行动或复盘问题反馈时注入 `updateContext`；阅读指南仅在上一版存在真实下一步行动反馈时注入 `updateContext`，避免空反馈触发“上次沉淀”臆造。
- 阅读指南行动反馈已复用 `ai_feedback_records` 持久化；localStorage 继承只作为 UI 兜底，不把继承项自动写回后端。
- 版本详情页已在存在 `feedbackOutcomeSummary` 时展示 `上次沉淀`。
- 更新前确认区和 prepared update 提示已统一使用“参考你上次记录的阅读成果”口径。
- 已补充后端容错测试，确认 `feedbackOutcomeSummary` 异常或缺失时不影响主体资产解析。
- 已补充前端展示测试，确认存在该字段时展示 `上次沉淀`、缺失时不展示该区块。
- 已区分阅读指南“当前版本本地反馈”和“跨版本继承兜底”；后端成功返回空反馈时，不再用旧版本 localStorage 继承项冒充当前版本事实。

仍不做：

- 不新增全局历史行动页。
- 不新增数据库表。
- 不把成果回顾写成执行力、完成率或用户表现评价。
- 不默认把阅读指南 `reviewCheckpoints` 纳入反馈保存；后续如做，需单独设计轻量状态。
