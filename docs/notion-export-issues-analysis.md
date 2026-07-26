# Notion 一键导出问题分析

wxreadmaster · 代码走查报告 · 2026\-07\-26

本报告覆盖单本资产的一键导出 Notion 链路（`BookNotesPage` / 各资产页 → `export_*_targets` → `export/dispatcher.rs` → `export/notion.rs`）、Notion 模板初始化（基础工作台 / 接入现有模板），以及 4 份 Notion 相关设计文档的落地状态。代码基于本地工作区 2026\-07\-21 前后的版本。

## 一、结论速览

导出链路的骨架是健康的：目标相互独立、失败不互相阻断，Obsidian 先行并把路径回写 Notion，数据库 schema 探测后"存在且类型匹配才写"，这些都符合设计文档且有测试覆盖。主要问题集中在三处：**正文保真度**（Obsidian 专用语法原样漏进 Notion 页面）、**失败语义**（错误归因失真、可能产生重复/半成品页面）、**个别属性的数据正确性**。另有两份已完成的设计（批量多目标、Books Tracker 深度接入）尚未实施。

| \# | 问题 | 等级 | 影响面 |
| --- | --- | --- | --- |
| 1 | YAML front matter 原样进入 Notion 正文 | P0 | 每次书籍笔记导出 |
| 2 | Obsidian 块 ID `^xxx`、`_斜体_` 泄漏进正文 | P0 | 每条划线 |
| 3 | 行内 Markdown 链接/粗体不解析，`weread://` 深链以原文显示 | P0 | 每条带回链的划线、想法 |
| 4 | `进度` 按 0–100 写入 percent 格式字段，渲染约为 7200% | P1 | 有阅读进度的书 |
| 5 | 封面失败回退过宽：错误归因失真，且可能重复建页 | P1 | 所有含封面导出 |
| 6 | 追加分块失败 → 半成品页 \+ 不返回 URL，重试即重复 | P1 | 长笔记（\>100 块） |
| 7 | 无限流退避、无请求超时 | P1 | 长笔记/弱网 |
| 8 | `微信读书` URL 用原始 bookId 拼接，疑似打不开 | P1 | 数据库模式导出 |
| 9 | `导入状态` 为 status 类型时整页创建失败 | P2 | 自定义库用户 |
| 10 | 批量导出仍是 Markdown\-only（设计已定稿未实施） | P2 | 批量场景 |
| 11 | Books Tracker 深度接入未实施 | P2 | 模板深度用户 |
| 12 | 结果面板无"打开 Notion 页面"入口；Token 从未真正验证 | P2 | 体验 |

## 二、正文保真度（P0）

这一组问题的根因相同：**Notion 目标复用了为本地/Obsidian 设计的同一份 Markdown 字符串**，而 `markdown_to_blocks()`（`export/notion.rs:965`）只做行级解析，不处理 front matter 和行内语法。`ExportDocument` 中间模型（`sections` 对书籍笔记始终为空）实际上没有承担正文职责，"一份输入、三种输出"的设计只落地了一半。

### 1\. YAML front matter 进入正文

`serialize_book_notes_markdown()` 开头调用 `write_book_notes_front_matter()`（`export/markdown.rs:1396–1422`），输出 `---` 包裹的 YAML。`markdown_to_blocks` 没有 front matter 分支，`---` 与各 `key: value` 行全部落入段落缓冲，最终 Notion 页面的**第一个块就是一段原样 YAML**：

```text
--- doc_type: wxreadmaster-book-notes bookId: "xxx" title: "…" … ---
```

front matter 对 Obsidian 是正确设计，对 Notion 则应剥离——这些元数据在数据库模式下已经写入属性了。

### 2\. Obsidian 块 ID 与斜体标记泄漏

`write_highlight()` 为每条划线追加 `_划线时间：…_ ^{block_id}`（`export/markdown.rs:1241,1250,1257`）。`^h-xxxx` 是 Obsidian 的块引用锚点，Notion 中变成一行可见的乱码尾巴；`_…_` 下划线斜体也不会被解析。**每条划线**在 Notion 里都带着这条尾巴，是页面观感最差的一处。

### 3\. 行内链接与富文本不解析

划线首行输出 `> [划线内容](<weread://bestbookmark?...>)`（`export/markdown.rs:1228`），想法输出 `- 原文：[摘录](<weread://...>)`（`:1268`）。`markdown_to_blocks` 不解析行内链接，Notion 里显示完整的 `[…](<weread://…>)` 原文。即便将来解析成 rich\_text link，`weread://` 深链在 Notion（尤其网页端）也基本不可用——建议 Notion 正文里降级为纯文本，跳转统一交给 `微信读书` URL 属性。

同理不处理的还有：`**粗体**`、行内代码、`####` 及更深标题（降为原文段落）、GFM 表格（逐行变成带竖线的段落）、`---` 分隔线、`- [ ]` 任务清单、嵌套列表（`trim_start` 后被拍平，`export/notion.rs:1017–1026`）。书籍笔记正文相对简单还好；**AI 复盘 / 统计复盘 / 阅读路线**这类含模型生成 Markdown 的资产受影响最明显。

**建议（二选一）**：

- 短期：给 Notion 加一个预处理器——剥 front matter、剥 `^块ID`、行内 `[t](u)` 解析为 rich\_text link（`https` 才保留链接，否则纯文本）、`**`/`_` 解析为 annotations、表格行至少合并为代码块或引用。
- 中期（更彻底）：Notion 适配器直接从 `BookNotesRecord` / 结构化数据生成 blocks（quote \+ 列表 \+ 段落），跳过 Markdown 中间态。划线天然对应 quote 块、想法对应列表，语义反而更贴。

## 三、失败语义与可靠性（P1）

### 4\. 封面失败回退过宽

`export_document()`（`export/notion.rs:75–89`）在 payload 带 cover 时，**任何** `create_page` 错误都会去掉封面重试一次：

- 401/403/404/429/网络抖动等与封面无关的首次失败，会被贴上"Notion 封面写入失败"的 warning（重试成功时），错误归因失真，也浪费一次请求；
- 更实质的风险：请求已送达服务端但响应超时/解析失败时，第一次建页可能已成功，重试会**创建重复页面**。这与项目自己的设计原则冲突——《现有模板接入设计》§7.3 和《Books Tracker 设计》§7.4 都明确"结果未知不自动重试"。

建议：仅当错误可判定为封面相关（HTTP 400 且 message 含 cover/URL 等特征）才降级重试；其余错误直接上抛。

### 5\. 追加分块失败产生半成品页

首批 100 块随建页提交，其余按 100/批 PATCH 追加（`:101–113`）。任何一批失败即整体返回 `Err`——但页面此时**已经创建并写入了部分内容**，而失败结果里没有 URL，用户看到"失败"后重试，就得到第二个（可能又是半成品的）页面。每条划线约合 2–3 个块，超过 100 块的笔记很常见。

建议：追加失败时返回"部分成功"（`Succeeded` \+ warning \+ URL \+ 已写入块数），或失败时归档已建页面再报错；至少要把 URL 带回来。

### 6\. 无限流退避、无超时

Notion 官方限流约 3 rps。追加循环无间隔、`parse_notion_response`（`:1188–1210`）对 429 只翻译文案不读 `Retry-After`；`Client::new()` 未设置超时（obsidian.rs 的封面下载同样），弱网下前端会永远停在"导出中"。批量多目标上线前这两条是硬前提。建议：429 按 `Retry-After` 退避重试 2–3 次；Client 统一 15–30s 超时。另外错误响应体非 JSON（网关 502 等）时 `.json()` 报 serde 错误，会丢掉 HTTP 状态码，建议先取 status 再尝试解析。

## 四、属性数据正确性

### 7\. `进度` percent 语义错误（P1）

模板把 `进度` 建成 `number/percent`（`export/notion.rs:743`），而导出写入 0–100 整数（`document.rs:76–81`）。Notion percent 格式按 0–1 比例渲染（API 写入 72 → 显示 7,200%）。建议写入 `progress / 100.0`，并在真实库上核对一次显示效果。

### 8\. `微信读书` URL 疑似无效（P1）

`weread_book_url()`（`:913–919`）用原始 bookId 拼 `https://weread.qq.com/web/bookDetail/{bookId}`。但微信读书 Web 的书籍页使用**变换后的 book hash**，应用内自己打开书走的也是 `weread://` 深链（`services/book.rs:278`），仓库中没有第二处使用这种 Web URL 的先例。建议实测一个真实 bookId；若确认打不开，实现社区通用的 bookId→hash 变换后再拼 `weread.qq.com/web/reader/{hash}`，或暂不写该属性（显式 `wereadUrl` 通道保留）。

### 9\. `导入状态` 遇 status 类型会整页失败（P2）

`insert_status_like_property`（`:799–813`）对 status 类型直接写 `{"status":{"name":"已导入"}}`。select/multi\_select 的未知选项 Notion 会自动创建，但 **status 选项不能通过 API 创建**——选项不存在时整个建页 400，报错信息难以理解。模板自建库是 select 不受影响；用户把字段改成 Status 类型（很常见的 Notion 习惯）就会中招。建议：写入前对照 schema 里的 options，不存在则跳过该属性。

## 五、设计\-实现差距盘点

| 设计文档 | 日期 | 状态 |
| --- | --- | --- |
| obsidian\-notion\-export\-import（单项多目标） | 07\-20 | ✅ 已实现（五类资产 `export_*_targets` 均注册） |
| notion\-reading\-workspace\-ui（工作台页面） | 07\-21 | ✅ 已实现（blocks 与文档一致，含测试） |
| notion\-existing\-template\-library\-flow（接入现有模板） | 07\-21 | ✅ 已实现（双模式、确认弹窗、封面策略保留） |
| bulk\-obsidian\-notion\-export（批量多目标） | 07\-20 | ❌ 未实施：`BulkExportRequest` 无 `targets`（`services/notes.rs:87–92`），批量向导无目标选择，批量"一键导出"目前仍是 Markdown\-only |
| notion\-books\-tracker\-deep\-integration | 07\-21 | ❌ 未实施：无字段探测 / 书卡 upsert / Relation 代码 |

也就是说，"一键导出到 Notion"目前只覆盖**单本/单项资产**；宣传或用户指南中如提到批量进 Notion，需要注意口径。

## 六、体验与打磨项（P2–P3）

结果面板只把 URL 当纯文本展示（`BookNotesPage.tsx:549–575`），设计要求的"打开入口"没有落地，建议加"打开 Notion 页面 / 复制链接"按钮。Token 保存时直接写 `last_validated_at` 而从未调用 `GET /users/me` 校验（`services/notion_credentials.rs:106–109`），配置错误要到第一次导出才暴露，建议加"验证连接"动作；输入框占位符 `secret_...` 也已过时（新 Integration Token 为 `ntn_` 前缀）。`parseNotionPageId` 要求输入中恰好出现一个 UUID，带 block 锚点（`#…`）的页面链接会被拒绝且提示不说明原因。pageCover 模式下封面会出现两次（page cover \+ 正文图片块），可在启用 page cover 时从正文里去掉封面行。编号列表识别 `split_once(". ")` 会把"2023. 结论"误判为有序项。极端情况下 100 块 × 1900 CJK 字符一批可能逼近 Notion 500KB 请求上限，按字节预算切批更稳。凭据用硬编码口令的 Stronghold 存储（`VAULT_PASSWORD`，`notion_credentials.rs:14`）——本地混淆可接受，但对外表述不宜称"加密保护"。`Notion-Version: 2022-06-28` 固定住是对的，中期留意 Notion data source 新 API 的迁移公告即可。

## 七、做得好的地方

值得保留的设计：目标级独立失败与结果结构（`ExportTargetResult`）清晰；Obsidian 先行、成功后把 Vault 路径写入 Notion `Obsidian 路径` 的编排（`dispatcher.rs:31–68`）正确处理了目标顺序倒置；数据库 schema 动态探测标题属性、"存在且类型匹配才写"让用户删字段不炸正文；`微信读书` URL 对 local/preview ID 的防伪链接过滤；1900 字符切块留了安全余量；模板创建不重置封面策略、已有目标时二次确认、失败不清空父页面输入，都与设计文档一致；错误文案不回显 Token。

## 八、建议的修复顺序

1. **P0 一揽子（正文观感）**：Notion 预处理器（剥 front matter、剥 `^块ID`、行内链接/粗斜体处理）＋ `进度/100` ＋ 封面回退错误分类。这四件事改动集中在 `export/notion.rs` 与一个新的预处理模块，收益立竿见影。
2. **P1（可靠性）**：追加失败的部分成功语义与 URL 回传；429 退避；请求超时；`微信读书` URL 实测与修正。
3. **P2（补设计债）**：status 类型兼容；批量多目标按既有设计实施（其串行\+节流前提依赖上面第 2 步）；结果面板打开入口；Token 验证按钮。

配套测试建议：`markdown_to_blocks` 补 front matter、`^块ID`、行内链接、表格、`####`、嵌套列表用例；`进度` percent 换算；status 属性跳过逻辑；429 退避与超时的集成测试（mock server）。

## 附：验证清单

上真实 Notion 库各验证一次即可确认本报告的 P0/P1 判断：导出一本含划线\+想法的书到数据库，检查页面首块是否为 YAML 段落、划线尾部是否出现 `^h-…`、`原文：[…](<weread://…>)` 是否原样显示、`进度` 列显示值；导出一本超长笔记（\>100 块）观察追加与限流表现；点一次 `微信读书` 属性里的链接确认是否 404。
