# 本地书库 Markdown 导入扩展计划

## 文档状态

- 状态：已实现，自动化回归通过；等待真实 Markdown 样本的桌面导入验收。
- 目标范围：本地书库导入 `.md / .markdown`，并复用现有本地阅读器闭环。
- 关联文档：`docs/local-reader-second-stage-plan.md`、`docs/local-reader-concept-plan.md`、`docs/local-reader-release-qa-checklist.md`。
- 当前触发问题：本地书架目前只支持 `TXT / EPUB`，用户希望评估是否接入更多通用格式，例如 Markdown。

## 结论

建议接入 Markdown，但只作为第三种低风险文本格式。

本轮不把本地书库升级为通用文档阅读器，也不引入 PDF、DOCX、HTML、MOBI、AZW3 等复杂格式。Markdown 第一版应保持“文本阅读模式”：能导入、能阅读、能划线、能写想法、能向 AI 提问、能导出本地阅读资产；不承诺完整 Markdown 富文本排版。

一句话目标：

```text
用户能把自己本机合法持有的 .md / .markdown 文档导入本地书库，并用现有轻量阅读器完成阅读、标注、想法、AI 提问和本地导出。
```

## 背景

当前本地书库第二阶段已经完成：

- TXT / EPUB 导入、去重、自愈和阅读。
- 本地阅读进度、划线、想法、AI 提问记录和 Markdown 导出。
- 本地来源与微信读书来源隔离。
- EPUB 走保守文本抽取，不做精排版。

当前格式边界仍是：

```ts
type LocalBookFormat = "epub" | "txt";
```

后端数据库和导入服务也只接受 `epub / txt`。如果用户已有 Markdown 长文、课程笔记、读书摘录、AI 生成资料或技术文档，本地书库无法直接纳入阅读资产闭环。

## 为什么先做 Markdown

Markdown 的价值高于实现成本：

- 本质是纯文本，和现有 TXT 链路最接近。
- 常见于读书笔记、长文档、课程资料、技术材料和 AI 输出。
- 可以自然复用现有正文阅读器、划线、想法、AI 提问和导出。
- 不涉及 PDF 坐标、DOCX 样式、HTML 清洗、MOBI/AZW3 解析或 DRM 风险。

Markdown 的风险也可控：

- 第一版按文本阅读，做基础块级渲染，不承诺完整 Markdown 扩展渲染。
- 标注偏移仍基于原始正文文本，阅读器通过隐藏语法节点保留偏移稳定。
- 标题目录可以用简单规则生成，不依赖完整 Markdown AST。

## 非目标

- 不做 PDF 阅读器。
- 不做 DOCX 导入。
- 不做 HTML 清洗阅读。
- 不做 MOBI / AZW3 / Kindle 格式解析。
- 不做 Markdown 图片附件打包。
- 不解析或复制相对资源目录。
- 不做代码块高亮。
- 不做表格富排版。
- 不做脚注、任务列表、数学公式、Mermaid 图等扩展渲染。
- 不把 Markdown 导入内容和微信读书条目自动合并。
- 不对导入 Markdown 自动生成整文摘要、向量索引或全文问答。

## 产品边界

### 单一来源

Markdown 导入后仍属于本地来源：

```ts
source: "local"
format: "markdown"
```

如果微信读书中有同名书或同名文档，仍显示为两个来源版本。只允许后续用户手动建立关联，不自动合并进度、划线、想法或 AI 提问记录。

### 文本优先

Markdown 第一版以可读文本为主：

- 对标题、引用、列表、分隔线和 fenced code block 做基础块级展示。
- Markdown 语法标记在视觉上弱化或隐藏，但仍留在 DOM 文本流中以保持划线偏移稳定。
- 可识别标题生成目录。
- 可读取 front matter 元数据。
- 不把正文转成 HTML 后再标注。

这样做的原因是现有阅读器的核心价值在稳定选区和本地资产沉淀。完整 Markdown AST、表格、图片、脚注、数学公式等富文本能力可以后续独立评估，但不应成为首版导入的前置条件。

## 支持格式

首版支持：

```text
.md
.markdown
```

内部格式值建议使用：

```ts
type LocalBookFormat = "epub" | "txt" | "markdown";
```

展示标签：

```text
Markdown
```

卡片短标识：

```text
MD
```

规范存储路径建议：

```text
local-books/{bookId}/source.md
```

说明：

- 用户原始扩展名 `.md` 或 `.markdown` 继续记录在 `local_book_files.original_extension`。
- 应用内规范源文件统一使用 `source.md`，避免 `format = markdown` 导致路径扩展名变成 `source.markdown` 过长。
- 文件 hash 仍基于原始文件内容计算，重复导入同一文件不创建新记录。

## Markdown 元数据

第一版只支持轻量 YAML front matter：

```md
---
title: 书名
author: 作者
---
```

解析规则：

- 只在文件开头识别 `---` front matter。
- 只读取 `title` 和 `author` 两个字符串字段。
- 字段值需要去首尾空白。
- 标题最长 160 字符，作者最长 120 字符。
- front matter 解析失败时不阻断导入，回退为普通 Markdown 文本。
- `title` 缺失时回退文件名。
- `author` 缺失时为空。
- 不支持数组作者、多行复杂 YAML、别名、标签、日期等扩展字段。

是否从阅读正文中移除 front matter：

- 建议移除。
- 理由是 front matter 是文件元数据，不是用户主要阅读正文。
- 移除后划线和想法偏移只对应应用内显示文本，导出时也以应用内正文为准。
- 源文件仍完整保存在本地存储中，不丢失原始文件。

## 正文读取策略

Markdown 第一版复用 TXT 的文本读取约束：

- 必须是 UTF-8。
- 空白正文拒绝导入。
- 源文件大小沿用本地图书上限。
- 正文大小沿用本地阅读器上限。
- 换行规范化策略和 TXT 保持一致。

新增函数建议：

```rust
fn read_markdown_book_text(source_path: &Path) -> Result<String, AppError>
```

职责：

- 读取 UTF-8 文本。
- 识别并剥离 front matter。
- 校验正文非空。
- 返回用于阅读器显示和后续标注的正文文本。

不建议在该函数中做：

- Markdown 转 HTML。
- 链接提取。
- 图片下载。
- 代码高亮。
- 表格重排。

## 目录识别

Markdown 可以额外识别标题：

```md
# 一级标题
## 二级标题
### 三级标题
```

规则建议：

- 识别 1 到 6 个 `#` 起始的 ATX 标题。
- `#` 后必须至少有一个空格。
- 标题文本去首尾空白。
- 标题长度超过 80 字符时忽略，避免误识别长行。
- fenced code block 内的 `#` 不作为标题。
- 仍保留当前 TXT/EPUB 的章节标题识别规则。

实现位置建议：

- 前端 `LocalReaderPage` 的目录构建逻辑可以根据 `book.format === "markdown"` 增加 Markdown 标题识别。
- 不需要后端预计算目录。

## 数据模型改造

### 前端类型

```ts
export type LocalBookFormat = "epub" | "txt" | "markdown";
```

相关消费点：

- 本地书卡格式标签。
- 本地书库格式筛选。
- 本地导入提示文案。
- 阅读器格式说明。
- Markdown 导出 front matter 中的 `format` 字段。

### 后端数据库

当前 `local_books.format` 有 CHECK 约束，只允许：

```sql
format IN ('epub', 'txt')
```

需要新增迁移，允许：

```sql
format IN ('epub', 'txt', 'markdown')
```

注意事项：

- SQLite 不能直接修改 CHECK，通常需要重建表。
- 迁移必须保留已有 `local_books` 数据。
- `local_book_files.original_extension` 保留用户原始扩展。
- 旧数据无需回填。

### 后端导入服务

需要更新：

- `SUPPORTED_FORMATS_MESSAGE`
- `local_book_format`
- `validate_import_source_size`
- `read_local_book_text`
- `canonical_local_book_storage_path`
- 相关测试里的格式枚举和错误文案

建议 internal format 与扩展映射：

| 原始扩展 | 内部 format | 规范存储文件 |
| --- | --- | --- |
| `.txt` | `txt` | `source.txt` |
| `.epub` | `epub` | `source.epub` |
| `.md` | `markdown` | `source.md` |
| `.markdown` | `markdown` | `source.md` |

## 前端界面改造

### 本地书库导入区

文案从：

```text
选择 EPUB/TXT 文件
```

改为：

```text
选择 EPUB/TXT/Markdown 文件
```

不建议写成“支持常见文档格式”，避免用户误以为 PDF/DOCX 也能导入。

### 格式筛选

如果当前有格式筛选，应新增：

```text
Markdown
```

排序建议：

```text
全部 / EPUB / TXT / Markdown
```

### 书卡

格式短标识：

```text
MD
```

说明文案：

```text
Markdown 文本阅读
```

不要展示“富文本 Markdown 阅读”，避免能力误解。

### 阅读器

阅读器无需新增独立模式。只需要：

- 标题栏格式显示 `Markdown`。
- 目录识别 Markdown 标题。
- 正文继续按文本段落展示。
- 搜索、划线、想法、AI 提问保持现有行为。

## AI 与导出边界

Markdown 导入不会改变 AI 输入边界。

AI 选区提问仍只允许发送：

- 当前书本地来源 key。
- 书名、作者。
- 用户选中文本。
- 选区前后文窗口。
- 用户问题。

不得因为 Markdown 文档结构存在标题、链接或 front matter，就把完整文件路径、原始绝对路径、附件路径或全量文档发送给 Provider。

Markdown 导出仍保持：

```yaml
source_kind: local
format: markdown
```

导出内容只包含本地阅读器资产：

- 本地划线。
- 本地想法。
- 本地 AI 提问记录。
- 本地阅读器元数据。

不读取微信读书笔记，不触发新的 AI 请求。

## 错误文案

支持格式提示建议更新为：

```text
目前仅支持导入 EPUB、TXT 或 Markdown 文件。
```

Markdown 空正文：

```text
当前 Markdown 文件未提取到可阅读正文。
```

非 UTF-8：

```text
当前 Markdown 文件不是 UTF-8 文本，暂不支持导入。
```

front matter 解析失败：

```text
不作为导入失败原因，回退为普通 Markdown 文本。
```

## 实施顺序

### P0：文档与边界确认

- [x] 明确 Markdown 是第三种文本格式，不是通用文档阅读器。
- [x] 明确首版不做富文本渲染。
- [x] 明确来源仍归属 `local`。

### P1：数据模型与迁移

- [x] 扩展前端 `LocalBookFormat`。
- [x] 增加数据库迁移，允许 `format = markdown`。
- [x] 更新测试 fixture 和格式筛选枚举。

### P2：后端导入

- [x] `local_book_format` 支持 `.md / .markdown`。
- [x] 新增 `read_markdown_book_text`。
- [x] 支持 front matter 的 `title / author` 轻量提取。
- [x] 规范存储到 `source.md`。
- [x] 重复导入、自愈、损坏修复沿用现有 hash 逻辑。

### P3：前端本地书库

- [x] 导入区文案更新为 EPUB/TXT/Markdown。
- [x] 书卡格式展示 Markdown / MD。
- [x] 格式筛选增加 Markdown。
- [x] 空态和错误态文案更新。

### P4：阅读器目录

- [x] Markdown 书籍额外识别 `#` 标题。
- [x] fenced code block 内标题不进入目录。
- [x] 现有章节识别继续保留。

### P4.5：阅读器正文基础 Markdown 展示

- [x] 标题、引用、列表、分隔线和 fenced code block 做基础块级展示。
- [x] Markdown 语法标记视觉隐藏或弱化，同时保留 DOM 文本偏移。
- [x] 划线、想法、AI 草稿、搜索、定位和导出继续复用原始正文偏移。

### P5：验证

- [x] Rust 单测覆盖 Markdown 导入、元数据、重复导入、空正文、非 UTF-8 和不支持格式。
- [x] 前端测试覆盖导入文案、格式筛选、书卡标识和阅读器目录。
- [x] Playwright 预览覆盖 Markdown 本地图书打开、基础 Markdown 正文渲染、Markdown 标题目录、划线、想法、AI 草稿和本地 Markdown 导出。
- [ ] 桌面真实样本覆盖导入 `.md`、打开、划线、写想法、AI 草稿和导出。
- [x] `npx tsc --noEmit --pretty false` 通过。
- [x] `npm run build` 通过。
- [x] `cargo test local_book --lib` 通过。

## 验收标准

功能验收：

- 可以导入 `.md` 文件。
- 可以导入 `.markdown` 文件。
- front matter 中的 `title / author` 能被识别。
- 没有 front matter 时使用文件名作为标题。
- 空 Markdown 不进入书库。
- 重复导入同一个 Markdown 文件不创建重复书卡。
- 打开 Markdown 书籍能阅读正文。
- Markdown 标题、引用、列表、分隔线和 fenced code block 有基础阅读样式。
- Markdown 标题能出现在目录中。
- 可以划线、写想法、向 AI 提问。
- Markdown 导出仍标记本地来源和 `format: markdown`。

兼容验收：

- 旧 TXT / EPUB 导入不受影响。
- 旧本地图书数据库可迁移。
- 旧本地划线、想法和 AI 提问记录不迁移、不丢失。
- 微信读书书架和微信导入书不受影响。

UI 验收：

- 导入区不让用户误以为支持 PDF/DOCX。
- 书卡格式标签不会撑破卡片。
- Markdown 候选筛选项和现有筛选项视觉一致。
- 阅读器正文不因 Markdown 特殊字符出现布局错乱。

## 风险与处理

### 富文本预期过高

风险：用户看到 Markdown 后期待完整渲染、图片、表格、代码高亮。

处理：

- UI 文案使用“Markdown 文本阅读”。
- 发布说明明确第一版保留 Markdown 原文结构。
- 后续如要富文本渲染，必须先设计偏移映射和选区稳定方案。

### front matter 解析复杂化

风险：YAML 语法复杂，过早支持完整解析会引入边界成本。

处理：

- 首版只识别 `title`、`author` 简单字符串。
- 解析失败不阻断导入。
- 不引入完整 YAML 依赖，除非后续需求明确。

### 标题误识别

风险：代码块里的 `#` 被当成标题。

处理：

- 目录识别时跟踪 fenced code block。
- 标题长度限制。
- 保留现有章节识别作为 fallback。

### 数据库迁移风险

风险：修改 CHECK 约束需要重建表，可能影响已有本地图书。

处理：

- 迁移前后保留所有字段。
- 增加迁移测试。
- 发布前用已有 TXT / EPUB 数据库样本验证。

## 后续评估项

Markdown 导入稳定后，再评估：

- 是否提供“预览渲染 Markdown”开关。
- 是否支持图片附件只读展示。
- 是否支持从 Markdown 标题生成更丰富的书内结构。
- 是否支持导入 `.html` 的纯文本清洗模式。

这些都不进入首版。
