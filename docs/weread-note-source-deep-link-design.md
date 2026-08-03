# 微信读书笔记原文定位设计

> **文档状态**：P0 + P1 已实施；自动化质量门禁已收口；P2 待独立评审
> **日期**：2026-08-01
> **适用范围**：微信读书划线与想法、笔记中心、桌面端协议跳转、Markdown / Obsidian / Notion 导出
> **核心裁决**：优先在 wxreadmaster 内补齐“定位原文”主路径，复用现有 `bookId + chapterUid + range` 数据生成微信读书深链接；前端不得传入任意协议 URL，链接必须由 Rust 后端校验并构造。Markdown / Obsidian 保持现有精确链接能力；Notion 因不支持 `weread://` 可点击链接，首版明确降级，HTTPS 桥接页作为独立后续能力。

## 1. 背景

微信读书笔记的一项高价值体验是：点击划线或想法关联的原文链接，可以回到该内容在书中的位置。该能力把“笔记回顾”与“上下文重读”连接起来，比只展示摘录文本更有用。

wxreadmaster 当前已经同步并保存了大部分定位所需数据，也已经在 Markdown / Obsidian 导出中生成精确链接，但产品层尚未形成统一体验：

- 书籍详情页可以打开微信读书书籍或章节；
- Markdown / Obsidian 导出的划线和想法原文可以携带 `weread://` 深链接；
- 笔记中心的列表和卡片没有“定位原文”操作；
- 打开命令只接收 `bookId + chapterUid`，尚未接收 `range`；
- 深链接构造逻辑分散在 mapper、Markdown 导出和 BookService；
- Notion 会把 `weread://` 链接降级为纯文本，不能提供直接点击体验。

因此，本次设计不是重新发明定位协议，而是将已有数据与能力收敛为稳定、可测试、可降级的产品功能。

## 2. 设计结论

### 2.1 产品主路径

在微信读书笔记的每条划线和想法上增加次级操作：

```text
定位原文
```

点击后由 Rust 后端根据结构化定位参数生成深链接并调用系统协议处理器，尝试打开微信读书客户端。

### 2.2 定位精度分级

按可用数据自动选择最高可用精度：

| 精度 | 条件 | 深链接 | 用户结果 |
| --- | --- | --- | --- |
| 原文范围 | 有 `bookId + chapterUid + range` | `weread://bestbookmark?...rangeStart...rangeEnd...` | 尝试定位到划线或想法关联原文 |
| 章节 | 有 `bookId + chapterUid` | `weread://reading?bId=...&chapterUid=...` | 打开对应章节 |
| 书籍 | 只有 `bookId` | `weread://reading?bId=...` | 打开书籍 |
| 不可定位 | 缺少或非法 `bookId` | 不生成链接 | 禁止操作并给出提示 |

### 2.3 能力声明

UI 和文档应使用“尝试打开原文”或“定位原文”，不能承诺“已精确定位”。

原因是系统命令成功只能证明深链接已交给操作系统，不能证明：

- 微信读书客户端一定已安装；
- 当前客户端版本仍支持该协议；
- 客户端已成功打开目标书籍；
- `rangeStart / rangeEnd` 一定被客户端接受；
- 电子书版本变化后原范围仍对应相同文本。

### 2.4 首版边界

P0 只完成桌面应用内定位，不新增服务器、不新增账号体系、不写回微信读书、不修改已同步笔记。

Notion 的 HTTPS 跳转桥接不进入 P0，避免为了一个外部导出场景引入远端服务、隐私政策和运维负担。

## 3. 目标

- 用户可以从 wxreadmaster 的微信读书划线直接返回原文。
- 用户可以从想法卡片返回该想法关联的原文。
- 有完整 range 时优先使用精确链接；信息缺失时自动降级。
- 链接构造逻辑集中在 Rust 后端，所有调用方共享同一套规则。
- 前端只提交结构化字段，不执行任意自定义协议。
- 打开失败时提供清楚、可恢复的反馈。
- Markdown / Obsidian 继续输出可点击的精确原文链接。
- Notion 明确披露限制，不伪装为可点击能力。
- 不破坏当前书籍级、章节级打开微信读书的兼容行为。

## 4. 非目标

- 不读取微信读书正文内容。
- 不在 wxreadmaster 中重新实现微信读书阅读器。
- 不修改、删除或新增微信读书远端划线和想法。
- 不保证所有微信读书客户端版本永久支持相同协议。
- 不通过文本搜索猜测原文位置。
- 不把笔记正文、划线文本或想法内容发送到外部跳转服务。
- 不在 P0 中提供 Notion HTTPS 跳转桥接。
- 不将本地书库的定位逻辑与微信读书协议链接混用。

## 5. 当前实现基线

### 5.1 数据模型已经具备定位字段

前端 `src/lib/types.ts` 中：

```ts
export type Highlight = {
  bookmarkId: string;
  bookId: string;
  chapterUid?: number;
  chapterTitle?: string;
  markText: string;
  createTime?: number;
  range?: string;
  deepLink?: string;
};

export type Thought = {
  reviewId: string;
  bookId: string;
  content: string;
  abstractText?: string;
  chapterUid?: number;
  range?: string;
  deepLink?: string;
};
```

Rust `src-tauri/src/mappers/notes.rs` 中的 `HighlightRecord` 和 `ThoughtRecord` 同样保存：

- `book_id`；
- `chapter_uid`；
- `range_text`；
- `deep_link`。

### 5.2 mapper 已生成章节级链接

当前 mapper 在存在 `chapterUid` 时生成：

```text
weread://reading?bId={bookId}&chapterUid={chapterUid}
```

该链接可作为缺少 range 时的章节级降级目标。

### 5.3 Markdown / Obsidian 已生成范围级链接

`src-tauri/src/export/markdown.rs` 已根据 `chapterUid + range` 生成：

```text
weread://bestbookmark
  ?bookId={bookId}
  &chapterUid={chapterUid}
  &rangeStart={rangeStart}
  &rangeEnd={rangeEnd}
```

并将其用于：

- 划线文本链接；
- 想法关联原文链接。

缺少合法 range 时回退到 mapper 的章节链接。

### 5.4 桌面打开能力已存在

当前跨端边界：

```ts
openBookInWeread(bookId, chapterUid?)
```

对应 Tauri command：

```rust
open_book_in_weread(app, book_id, chapter_uid)
```

Rust 后端负责构造 `weread://reading` 并通过操作系统打开：

- Windows：`rundll32 url.dll,FileProtocolHandler`；
- macOS：`open`；
- Linux：`xdg-open`。

该命令已注册 runtime、build manifest、permission 和 capability。

### 5.5 笔记页尚未接线

`src/pages/BookNotesPage.tsx` 的 `NoteCardItem` 当前只保留：

- 笔记 ID；
- 类型；
- 文本；
- 章节标题；
- `chapterUid`；
- 展示元信息。

它没有保留 `bookId`、`range` 和 `deepLink`，卡片操作也只有分享或保存图片，没有定位原文。

列表视图同样没有原文定位操作。

### 5.6 Notion 当前主动降级

Notion API 的富文本链接要求可接受的 URL。当前转换器对 `weread://` 自定义协议采取安全降级：保留链接文字，但移除 link 对象。

已有测试：

```rust
weread_deep_links_degrade_to_plain_text
```

因此当前 Notion 页面中的划线文本不是可点击的微信读书深链接。这是明确的兼容策略，不是偶发缺陷。

## 6. 用户体验设计

### 6.1 笔记列表视图

每条划线或想法的底部元信息区增加次级按钮：

```text
章节名 · 位置 659-705 · 划线时间
[定位原文]
```

规则：

- 有合法 `bookId` 时显示按钮；
- 有 range 时按钮 title 为“在微信读书中定位原文”；
- 只有章节时 title 为“在微信读书中打开本章”；
- 只有书籍时 title 为“在微信读书中打开本书”；
- 不用整个卡片作为链接，避免与文本选择、复制和分享冲突。

### 6.2 笔记卡片视图

在现有分享操作旁增加弱操作：

```text
[定位原文] [保存图片]
```

优先级：

- 分享/保存图片是内容分发；
- 定位原文是阅读回溯；
- 两者均为次级操作，不覆盖笔记正文。

移动端按钮允许换行，但触控区域不小于 44px。

### 6.3 点击反馈

调用中：

```text
正在打开微信读书…
```

系统命令成功：

```text
已请求打开微信读书。
```

若精度发生降级：

```text
该笔记缺少精确位置，已尝试打开对应章节。
```

系统打开失败：

```text
无法打开微信读书，请确认已安装客户端。
```

如果系统已接收命令但无法确认客户端结果，不显示“已定位成功”。

### 6.4 连续点击

同一条笔记打开进行中时禁用该按钮，防止短时间内重复唤起客户端。其他笔记按钮可以保持可用，也可以在 P0 采用页面级单飞锁，优先选择实现简单且无并发价值的页面级单飞锁。

### 6.5 Web 预览

Web 预览环境不能直接执行 Tauri command。处理规则：

- 可以隐藏按钮，或显示禁用状态并提示“桌面版可用”；
- 不在浏览器中直接设置 `window.location.href = "weread://..."`；
- Playwright mock 环境可以模拟 command 结果验证 UI。

推荐显示禁用按钮，便于解释桌面版能力并保持布局稳定。

## 7. 数据契约

### 7.1 前端定位目标

新增统一类型：

```ts
export type WereadSourceLocation = {
  bookId: string;
  chapterUid?: number;
  range?: string;
};

export type WereadSourcePrecision =
  | "range"
  | "chapter"
  | "book";

export type OpenWereadSourceResult = {
  opened: boolean;
  deepLink: string;
  precision: WereadSourcePrecision;
  warning?: string;
};
```

不把原始 `deepLink` 作为打开请求参数。历史数据中的 `deepLink` 仅作兼容快照和导出参考，不能直接执行。

### 7.2 NoteCardItem 扩展

```ts
type NoteCardItem = {
  id: string;
  type: "highlight" | "thought";
  text: string;
  abstractText?: string;
  bookId: string;
  chapterTitle: string;
  chapterUid?: number;
  range?: string;
  createdAt?: number;
  meta: string[];
};
```

`buildHighlightCard` 和 `buildThoughtCard` 从原始记录复制结构化定位字段。

### 7.3 Rust 请求与响应

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WereadSourceLocation {
    pub book_id: String,
    pub chapter_uid: Option<i64>,
    pub range: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WereadSourcePrecision {
    Range,
    Chapter,
    Book,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWereadSourceResult {
    pub opened: bool,
    pub deep_link: String,
    pub precision: WereadSourcePrecision,
    pub warning: Option<String>,
}
```

## 8. 深链接构造规则

### 8.1 集中构造

当前链接逻辑分散在：

- `mappers/notes.rs`；
- `export/markdown.rs`；
- `services/book.rs`。

建议新增纯函数模块：

```text
src-tauri/src/services/weread_deep_link.rs
```

该模块只负责：

- 校验 `bookId`；
- 校验 `chapterUid`；
- 解析 range；
- 根据可用字段选择精度；
- 生成深链接；
- 不执行系统命令；
- 不访问数据库或网络。

建议接口：

```rust
pub fn build_weread_source_link(
    book_id: &str,
    chapter_uid: Option<i64>,
    range: Option<&str>,
) -> Result<WereadSourceLink, AppError>
```

返回：

```rust
pub struct WereadSourceLink {
    pub url: String,
    pub precision: WereadSourcePrecision,
    pub warning: Option<String>,
}
```

### 8.2 bookId 校验

延续现有 `normalize_book_id` 约束：

- 去除首尾空白；
- 不得为空；
- 仅允许字母、数字、下划线和连字符；
- 设置合理长度上限，例如 128；
- 非法时返回 `invalid_payload`，不得尝试打开。

### 8.3 chapterUid 校验

- 只接受非负整数；
- 负数视为无效输入，不降级为书籍级，避免掩盖数据异常；
- 缺失时允许降级到书籍级。

### 8.4 range 解析

现有 Markdown 实现从 range 字符串提取前两个非负整数。P0 可兼容该行为，但需要收紧规则：

1. 去除首尾空白；
2. 提取且只使用两个整数；
3. `rangeStart >= 0`；
4. `rangeEnd > rangeStart`；
5. 数值必须在 `i64` 范围内；
6. 异常 range 不阻止打开，降级到章节并返回 warning。

兼容输入示例：

```text
659-705
659,705
659_705
```

非法示例：

```text
659
705-659
abc
```

长期应在同步 mapper 中同时保存结构化 `rangeStart / rangeEnd`，减少重复解析字符串；但为了保持现有 SQLite schema 和 API 兼容，P0 不强制迁移。

### 8.5 URL 编码

因为 `bookId` 已限制为安全字符、其余参数是整数，当前无需通用 URL 编码器。若未来放宽 `bookId`，必须使用标准 URL builder，禁止字符串直接拼接未验证输入。

## 9. Tauri 接口设计

### 9.1 推荐新增语义命令

保留现有：

```rust
open_book_in_weread(book_id, chapter_uid)
```

新增：

```rust
#[tauri::command]
pub fn open_weread_note_source(
    app: AppHandle,
    location: WereadSourceLocation,
) -> Result<OpenWereadSourceResult, AppCommandError>
```

不建议直接给旧命令增加 `range`，原因：

- 旧命令语义是“打开书籍”；
- 新能力语义是“定位笔记原文”；
- 新返回值需要 `precision` 和 `warning`；
- 保持旧调用方和权限兼容更安全。

### 9.2 服务层流程

```text
command
  → 解析结构化请求
  → build_weread_source_link
  → open_deep_link
  → 返回 opened / deepLink / precision / warning
```

command 不包含链接规则，系统进程调用不进入纯函数模块。

### 9.3 错误契约

建议错误码：

| code | 场景 | 用户文案 |
| --- | --- | --- |
| `invalid_weread_book_id` | bookId 非法 | 无法识别该笔记对应的微信读书书籍。 |
| `invalid_weread_chapter_uid` | chapterUid 为负数 | 该笔记的章节位置无效，请重新同步后再试。 |
| `weread_client_open_failed` | 系统命令失败 | 无法打开微信读书，请确认已安装客户端。 |
| `weread_protocol_unsupported` | 当前系统不支持 | 当前系统暂不支持自动打开微信读书。 |

range 非法不是硬错误：只要 `bookId + chapterUid` 可用，就降级并返回 warning。

### 9.4 权限注册

新增命令时必须同步：

- `src-tauri/build.rs`；
- `src-tauri/src/lib.rs`；
- `src-tauri/capabilities/default.json`；
- `src-tauri/permissions/autogenerated/open_weread_note_source.toml`；
- `src/lib/tauri-permissions.test.ts`。

## 10. 前端 API 设计

在 `src/lib/reading-api.ts` 新增：

```ts
export async function openWereadNoteSource(
  location: WereadSourceLocation
): Promise<OpenWereadSourceResult> {
  return invoke<OpenWereadSourceResult>("open_weread_note_source", {
    location
  });
}
```

前端只传：

```ts
{
  bookId: card.bookId,
  chapterUid: card.chapterUid,
  range: card.range
}
```

不得传：

```ts
{ url: card.deepLink }
```

## 11. 前端组件改造

### 11.1 BookNotesPage

新增页面级状态：

```ts
const [openingSourceId, setOpeningSourceId] = useState<string>();
```

新增处理函数：

```ts
async function handleOpenNoteSource(card: NoteCardItem) {
  // 单飞、调用 API、根据 precision/warning 显示 toast
}
```

### 11.2 NoteCardGrid

新增 props：

```ts
onOpenSource: (card: NoteCardItem) => void;
openingSourceId?: string;
canOpenSource: boolean;
```

在卡片操作区增加按钮，并使用 `ExternalLink` 或 `BookOpen` 图标。按钮文案统一为“定位原文”，不要根据精度改变主文案，精度通过 title 和结果 toast 表达。

### 11.3 NoteList

当前 `NoteList` 应接收相同回调，不在组件内部重复调用 API。列表与卡片共用一个页面级 handler，确保：

- 错误提示一致；
- 单飞状态一致；
- Web 预览处理一致；
- 后续埋点一致。

### 11.4 可访问性

- 按钮使用真实 `<button>`；
- `aria-label` 包含笔记类型和简短文本，例如“定位划线原文：将最重要的事…”；
- 加载中设置 `aria-busy` 或替换为加载图标；
- 不只依赖图标表达含义；
- 键盘 Enter / Space 可触发；
- 焦点样式沿用项目现有可见焦点规则。

## 12. Markdown 与 Obsidian

### 12.1 保持现有行为

- 划线第一行继续包裹范围级链接；
- 想法的关联原文继续包裹范围级链接；
- range 无效时回退章节链接；
- 无章节时回退书籍链接。

### 12.2 消除重复逻辑

`export/markdown.rs` 的 `highlight_deep_link` 与 `thought_deep_link` 应调用新的集中构造函数，而不是继续独立拼接。

但导出链路与交互链路的错误策略不同：

- 交互打开：非法 bookId 是错误；
- 导出 Markdown：单条链接构造失败不得阻止整本笔记导出，应输出普通文本并返回可选 warning 或记录内部诊断。

### 12.3 Obsidian 兼容

Obsidian 是否直接打开 `weread://` 取决于系统协议注册与 Obsidian 的外部协议策略。wxreadmaster 可以保证链接被正确输出，不能保证所有 Obsidian 版本自动放行。

## 13. Notion 处理设计

### 13.1 P0 明确降级

继续保持现有策略：

- 正文保留划线或关联原文文本；
- 不把 `weread://` 写入 Notion rich text link；
- 不因一个不受支持的链接导致整页创建失败；
- 页面级“微信读书”属性继续保存书籍级 HTTPS 链接（若存在），但不能宣称它可以精确定位划线。

### 13.2 P0 文案

Notion 导出结果无需对每条笔记重复 warning，但帮助文档应明确：

```text
Notion 不支持直接点击微信读书自定义协议。导出的原文文本会保留，精确定位请在 wxreadmaster 或支持该协议的 Markdown 工具中使用。
```

### 13.3 P2 HTTPS 桥接页

若后续确认 Notion 精确跳转具有足够价值，可提供 HTTPS 桥接：

```text
https://<bridge-host>/open/weread
  ?bookId=...
  &chapterUid=...
  &rangeStart=...
  &rangeEnd=...
```

桥接页职责：

1. 校验参数；
2. 用户点击后尝试打开 `weread://`；
3. 显示“打开客户端”“复制链接”“返回”等降级操作；
4. 不接收笔记正文、书名、作者或用户身份；
5. 默认不记录完整查询参数日志；
6. 不自动跳转未知协议或未知域名。

在产品引入桥接页前，必须单独评审：

- 部署和可用性；
- 隐私政策；
- 日志脱敏；
- 防滥用和速率限制；
- 域名可信度；
- 微信读书协议变化后的兼容维护；
- 用户是否可关闭该能力。

不建议把公共 URL 短链服务作为默认桥接，因为会泄露阅读位置元数据并引入第三方依赖。

## 14. 安全设计

### 14.1 禁止任意协议执行

前端不能传入完整 URL，Rust command 不能接受：

```text
file://
powershell://
cmd://
http://任意地址
其他自定义协议
```

后端只根据经过约束的结构化字段生成固定的 `weread://reading` 或 `weread://bestbookmark`。

### 14.2 参数最小化

深链接只包含定位必要字段：

- `bookId`；
- `chapterUid`；
- `rangeStart`；
- `rangeEnd`。

不包含：

- 划线正文；
- 想法内容；
- 用户标识；
- Token、Cookie 或 synckey；
- 本地文件路径。

### 14.3 进程调用

继续使用参数数组调用系统命令，不通过 shell 拼接命令字符串。任何平台实现都不得使用 `cmd /c`、PowerShell 字符串执行或 shell expansion。

### 14.4 日志

- 不记录笔记正文；
- 可以记录精度枚举和匿名错误码；
- 默认不记录完整 deep link；
- 如需诊断，仅记录脱敏后的 bookId 前缀和是否具备章节/range。

## 15. 兼容与降级矩阵

| 环境 | range 完整 | 只有章节 | 只有书籍 | 客户端未安装 |
| --- | --- | --- | --- | --- |
| Windows 桌面版 | 尝试精确定位 | 打开章节 | 打开书籍 | 提示安装/检查协议 |
| macOS 桌面版 | 尝试精确定位 | 打开章节 | 打开书籍 | 提示安装/检查协议 |
| Linux 桌面版 | 取决于协议注册 | 取决于协议注册 | 取决于协议注册 | 明确失败提示 |
| Web 预览 | 禁用 | 禁用 | 禁用 | 不适用 |
| Markdown / Obsidian | 输出范围链接 | 输出章节链接 | 输出书籍链接 | 点击后由系统处理 |
| Notion P0 | 纯文本 | 纯文本 | 书籍 HTTPS 属性可用 | 不适用 |

## 16. 实施分期

### P0：应用内原文定位

- 新增集中式微信读书深链接构造模块；
- 新增 `open_weread_note_source` command；
- 增加类型、API normalizer 和 command 权限；
- 扩展笔记列表和卡片定位字段；
- 列表与卡片增加“定位原文”；
- range 异常时降级章节并提示；
- Web 预览禁用；
- 保持旧 `open_book_in_weread` 兼容。

P0 实施结果：

- 已新增 `src-tauri/src/services/weread_deep_link.rs`，集中校验 `bookId / chapterUid / range` 并构造固定微信读书深链接；
- 已新增 `open_weread_note_source` command，并完成 runtime / manifest / permission / capability 四方注册；
- 旧 `open_book_in_weread` 已复用统一的 `bookId`、章节校验与系统协议打开边界，命令名和返回结构保持兼容；
- 章节视图和卡片视图的划线、想法均已增加“定位原文”，打开期间使用页面级单飞锁；
- Web 预览明确禁用自定义协议，只允许桌面运行态调用；
- range 无效时由 Rust 自动降级到章节并返回 warning；缺章节时降级到书籍；
- Markdown / Obsidian 与 Notion 导出逻辑未在 P0 中改动，分别保持现有范围级链接和纯文本降级行为。

### P1：导出链路收敛

- Markdown / Obsidian 改用集中构造函数；
- 补齐无章节时的书籍级降级；
- 导出失败不阻断正文；
- 增加跨导出格式回归测试；
- 更新用户帮助。

P1 实施结果：

- `src-tauri/src/export/markdown.rs` 的划线与想法链接已统一调用 `build_weread_source_link`，不再手工拼接或执行记录中的历史 `deepLink`；
- Markdown / Obsidian 按 `range → chapter → book` 输出最高可用精度，非法 `bookId` 只省略链接，正文、位置与 Obsidian block ID 继续保留；
- `src-tauri/src/mappers/notes.rs` 在同步映射阶段生成同一规则下的兼容链接快照；
- `src-tauri/src/services/notes.rs` 从 SQLite 读取笔记时根据结构化字段重新生成链接，不再回退信任历史任意 URL；
- 已补充 Markdown、mapper、缓存读取和 Notion 自定义协议降级回归测试；
- Notion 仍保持纯文本降级，P1 不引入 HTTPS 服务、不修改用户数据库 schema。

### P2：Notion 可点击桥接（可选）

- 先做隐私与运维评审；
- 实现最小 HTTPS 跳转页；
- Notion 原文文本链接改为桥接 URL；
- 提供设置开关和明确说明；
- 失败时仍保留普通文本；
- 不影响没有桥接服务的离线导出能力。

## 17. 代码改造清单

### 17.1 前端

| 文件 | 改造 |
| --- | --- |
| `src/lib/types.ts` | 新增 `WereadSourceLocation`、precision 和打开结果类型 |
| `src/lib/reading-api.ts` | 新增 typed invoke 与防御性结果映射 |
| `src/pages/BookNotesPage.tsx` | 扩展卡片字段、增加页面级打开 handler、加载和 toast 状态 |
| 笔记列表组件 | 增加定位原文按钮并复用页面 handler |
| `src/pages/BookNotesPage.test.tsx` | 增加按钮、精度降级、失败提示和 Web 状态测试 |
| `tests/e2e/app-smoke.spec.ts` | Mock 新 command，验证参数和用户反馈 |

### 17.2 Rust / Tauri

| 文件 | 改造 |
| --- | --- |
| `src-tauri/src/services/weread_deep_link.rs` | 新增纯函数构造器与校验 |
| `src-tauri/src/services/book.rs` | 复用系统打开函数或拆分 `WereadOpenService` |
| `src-tauri/src/commands/book.rs` | 新增 `open_weread_note_source` |
| `src-tauri/src/export/markdown.rs` | 改用集中式链接构造器 |
| `src-tauri/src/mappers/notes.rs` | 移除重复拼接或保留兼容快照但调用统一 helper |
| `src-tauri/build.rs` | 注册 command manifest |
| `src-tauri/src/lib.rs` | 注册 runtime command |
| `src-tauri/capabilities/default.json` | 增加 allow permission |
| `src-tauri/permissions/autogenerated/` | 生成新 command permission |

### 17.3 文档

- 本文档；
- 用户帮助中的“从笔记返回原文”；
- Notion 导出限制说明；
- Markdown / Obsidian 外部协议说明。

## 18. 测试策略

### 18.1 Rust 纯函数测试

必须覆盖：

1. `bookId + chapterUid + 659-705` 生成 `bestbookmark`；
2. range 支持逗号或其他现有兼容分隔符；
3. range 只有一个数字时降级章节；
4. range 结束小于或等于开始时降级章节；
5. 无 range 时生成章节链接；
6. 无 chapter 时生成书籍链接；
7. 空 bookId 返回错误；
8. 含空格、斜杠、`&` 或协议字符的 bookId 返回错误；
9. 负 chapterUid 返回错误；
10. 极大数字溢出时安全降级或报错，不 panic。

### 18.2 Rust 服务测试

系统协议打开应通过可替换的 opener 边界测试，不能在单元测试中真的启动微信读书。

覆盖：

- opener 成功返回 `opened = true`；
- opener 失败返回稳定错误；
- 返回结果包含真实选择的 precision；
- range 降级 warning 不被丢失；
- 不执行用户传入 URL。

### 18.3 前端单元测试

覆盖：

- 划线和想法都显示“定位原文”；
- `NoteCardItem` 保留 bookId、chapterUid、range；
- 点击后调用新 API，而不是旧书籍命令；
- 请求参数不包含原始 deepLink；
- 加载中按钮禁用；
- range 精度成功显示中性/成功提示；
- 章节降级显示 warning；
- command 失败显示错误；
- Web 预览禁用且有说明；
- 分享图片功能不受影响。

### 18.4 E2E

Playwright mock command：

```ts
case "open_weread_note_source":
  return {
    opened: true,
    deepLink:
      "weread://bestbookmark?bookId=b1&chapterUid=28&rangeStart=659&rangeEnd=705",
    precision: "range"
  };
```

断言：

- 打开笔记详情；
- 划线卡片存在定位按钮；
- 点击后 command 参数包含结构化字段；
- toast 不宣称无法验证的“已精确定位成功”；
- 列表和卡片两种视图均可用；
- 390px 宽度无横向溢出；
- command 失败时页面内容仍保留。

### 18.5 导出回归

- Markdown 范围级链接保持不变；
- 想法关联原文链接保持不变；
- 无 range 时生成章节链接；
- 无 chapter 时生成书籍链接；
- Notion 继续去除 `weread://` link，不导致 API payload 无效；
- Obsidian block anchor 不受影响；
- 五类阅读资产的其他导出不受影响。

### 18.6 手工真机验证

自动化无法证明微信读书客户端最终定位成功。发布前至少在实际安装微信读书的环境验证：

- Windows 当前支持版本；
- macOS 当前支持版本；
- 一条有 range 的划线；
- 一条有 range 的想法；
- 一条缺少 range 的笔记；
- 客户端未运行；
- 客户端已经运行；
- 书籍版本或章节目录变化后的行为。

测试结果需要记录客户端版本与日期，避免把一次验证当作永久协议保证。

## 19. 验收标准

### 19.1 产品验收

- [x] 微信读书划线和想法均可看到“定位原文”。
- [x] 有 range 时优先尝试范围级定位。
- [x] range 缺失或异常时自动降级且明确提示。
- [x] 点击失败不影响查看、复制、分享和导出笔记。
- [x] UI 不使用“已精确定位成功”等不可验证表述。
- [x] Web 预览明确说明桌面版可用。
- [x] 本地书库笔记不显示微信读书定位操作。

### 19.2 技术验收

- [x] 前端不传入可执行 URL。
- [x] Rust 只构造固定 `weread://` 路径。
- [x] bookId、chapterUid 和 range 在后端完成校验。
- [x] P0 应用内链接构造逻辑只有一个真值来源。
- [x] 旧 `open_book_in_weread` 调用方保持兼容。
- [x] 新 command 完成 runtime / manifest / permission / capability 四方注册。
- [x] 单元测试不启动真实外部客户端。
- [x] Markdown / Obsidian 导出链接无回归。
- [x] Notion payload 不包含不受支持的自定义协议链接。

### 19.3 质量门禁

P0 已完成的门禁证据：

- [x] TypeScript `tsc --noEmit` 通过。
- [x] 前端全量单测通过：75 个测试文件、445 个测试。
- [x] Rust 原文定位定向测试通过：7 个测试。
- [x] Rust 全量测试通过：360 个测试。
- [x] Tauri 权限完整性测试通过：4 个测试。
- [x] 笔记 E2E 通过：章节视图和卡片视图均验证结构化 command 参数。
- [x] 生产构建通过：使用独立验证目录且不清理现有 `dist`。
- [x] 相关文件 `git diff --check` 通过。

P1 导出链路收敛的本轮验证证据：

- [x] Markdown / Obsidian 导出定向测试：11 / 11。
- [x] 微信读书笔记 mapper 定向测试：7 / 7。
- [x] SQLite 缓存读取定向测试：4 / 4。
- [x] Notion 自定义协议纯文本降级测试：1 / 1。
- [x] Rust 全量测试：366 / 366。
- [x] 原文定位相关前端测试：3 个文件、50 / 50，其中 Tauri 权限 4 / 4。
- [x] 独立临时目录生产构建通过：3358 个模块。
- [x] 本轮 Rust 文件 `rustfmt --check` 通过。
- [x] 原文定位相关文件及仓库当前差异 `git diff --check` 通过。
- [x] 仓库级前端全量测试最终通过：75 个测试文件、447 个测试。
- [x] 仓库级 TypeScript `tsc --noEmit` 最终复跑通过；并行“选书决策上下文”切片稳定后已重新验证，无需覆盖其业务实现。

自动化门禁只能证明构造、权限、UI 调用和构建稳定；微信读书客户端是否真正精确定位仍需按 18.6 节执行真机验证并记录客户端版本。

## 20. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 微信读书修改或移除协议 | 跳转失效 | 真机版本矩阵；错误提示；不承诺永久兼容 |
| 系统命令成功但客户端未定位 | 产生虚假成功 | 文案只说“已请求打开”；不把启动结果当定位结果 |
| range 字符串格式变化 | 精确定位下降 | 集中解析；异常降级章节；保留测试样本 |
| 电子书版本变化 | range 指向错误文本 | 不自行搜索猜测；允许用户在章节内确认 |
| 前端执行任意协议 | 安全风险 | 只传结构化参数；Rust 固定构造协议 |
| 连续点击多次启动客户端 | 体验问题 | 单飞锁和加载状态 |
| Web 预览误触发协议 | 浏览器异常弹窗 | Web 环境禁用，不直接设置 location |
| Notion 不支持自定义协议 | 链接不可点 | P0 纯文本降级；P2 单独评审 HTTPS 桥接 |
| HTTPS 桥接泄露阅读位置 | 隐私风险 | 不进入 P0；参数最小化；禁正文；日志脱敏 |
| Linux 未注册协议 | 打开失败 | 明确平台限制，不伪装成功 |

## 21. 发布与回滚

### 21.1 发布策略

- 功能默认开启，不需要新增设置开关；
- 仅当定位字段和桌面运行时可用时显示；
- 首版不改变同步数据和数据库 schema；
- 首版不改变 Notion 输出；
- 先在 Windows 和 macOS 真机验证，再进入发布候选。

### 21.2 回滚策略

如果协议兼容性出现严重问题：

- 前端隐藏“定位原文”按钮即可停止新入口；
- 保留旧书籍级打开命令；
- 不需要数据迁移或回滚 SQLite；
- Markdown / Obsidian 可独立决定是否保留链接；
- 新 command 可在后续兼容版本再移除，避免权限集合立即震荡。

## 22. 最终原则

1. **结构化参数，不执行任意 URL。** 前端描述位置，后端生成协议。
2. **最高可用精度，明确降级。** range → 章节 → 书籍。
3. **启动不等于定位成功。** UI 不做无法验证的承诺。
4. **一个链接真值来源。** UI、Markdown 和 mapper 共享构造规则。
5. **失败不影响笔记。** 原文定位是增强能力，不是阅读和导出的前置条件。
6. **离线优先。** P0 不为了 Notion 引入远端跳转服务。
7. **外部协议属于兼容能力。** 必须通过真实客户端版本持续验证。
