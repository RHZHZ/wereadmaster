# Notion 阅读库数据库模板设计

## 1. 目标

为 wxreadmaster 提供一套可复制、可一键创建、可长期维护的 Notion 阅读库模板，让用户不需要手动理解 Notion 数据库字段，也能把书籍笔记、AI 复盘和阅读资产稳定导入 Notion。

设计重点：

- 用户可在 Notion 手动照抄创建。
- 应用可通过 Notion API 一键初始化数据库。
- 当前单本笔记导入可直接写入基础元数据。
- 后续书籍复盘、阅读路线、统计复盘、选书决策能复用同一字段契约。

非目标：

- 不做双向同步。
- 不做 Notion 内部复杂多数据库关系图。
- 不依赖用户安装 Notion 模板包。
- 不在首版创建多张数据库。

## 2. 模板定位

模板名称：`wxreadmaster 阅读库`

推荐结构：

- 一个 Notion 父页面：由用户创建并共享给 Integration
- 一个核心数据库：`阅读成果库`
- 每本书或每个阅读资产是一条页面记录
- 页面正文承载 Markdown 转换后的块内容
- 数据库 `封面` Files & media 属性承载 Gallery 卡片预览
- Page cover 承载成果页顶部视觉封面

这比拆成“书籍库、笔记库、复盘库、统计库”更符合 KISS 和 YAGNI。首版只维护一张数据库，降低用户配置成本和 API 出错面。

## 3. 数据库字段

### 3.1 必需字段

| 字段名 | Notion 类型 | 应用写入 | 用途 |
| --- | --- | --- | --- |
| `名称` | Title | 是 | 页面标题，通常为书名或资产标题 |
| `作者` | Rich text | 是 | 书籍作者 |
| `Book ID` | Rich text | 是 | 微信读书 bookId 或本地 sourceId |
| `封面` | Files & media | 有有效 HTTP(S) 封面时写入 | Gallery 卡片预览的稳定来源 |
| `资产类型` | Select | 是 | 区分笔记、复盘、路线、统计、选书 |
| `来源` | Select | 是 | 当前固定写入 `wxreadmaster` |
| `导出时间` | Date | 是 | 本次导入时间 |
| `导入状态` | Select | 是 | 默认 `已导入` |

### 3.2 推荐字段

| 字段名 | Notion 类型 | 应用写入 | 用途 |
| --- | --- | --- | --- |
| `阅读状态` | Select | 后续 | 未开始、阅读中、复盘中、已整理 |
| `阅读阶段` | Select | 是 | 起步、建立主线、深入推进、收束整理、完成归档 |
| `进度` | Number | 是 | 阅读进度百分比 |
| `标签` | Multi-select | 是 | 主题标签、复盘标签 |
| `微信读书` | URL | 后续 | 深链或外部链接 |
| `Obsidian 路径` | Rich text | 后续 | 双目标导出时记录本地笔记位置 |
| `Prompt 版本` | Rich text | 是 | AI 资产版本追踪 |
| `输入哈希` | Rich text | 是 | AI 资产去重与版本识别 |
| `Scope ID` | Rich text | 是 | 阅读路线、统计复盘、选书决策的范围 ID |
| `周期` | Select | 是 | 周复盘、月复盘、年复盘、总览 |
| `行动数` | Number | 是 | AI 成果中的行动建议数量 |
| `候选书数` | Number | 是 | 阅读路线和选书决策涉及的候选书数量 |
| `划线数` | Number | 是 | 书籍笔记划线数量 |
| `想法数` | Number | 是 | 书籍笔记想法/点评数量 |
| `书签数` | Number | 是 | 书籍笔记书签数量 |
| `可导出数` | Number | 是 | 书籍笔记可导出内容数量 |

首版一键创建时建议同时创建必需字段和推荐字段。字段数量不多，不会增加用户操作成本；后续导出接入时也不需要迁移数据库。

说明：状态类字段默认用 Select 创建，降低 Notion API 初始化失败概率；如果用户手动改成 Status，应用导入逻辑仍会兼容写入。

## 4. 枚举值

### 4.1 `资产类型`

- `书籍笔记`
- `书籍复盘`
- `阅读统计复盘`
- `阅读路线`
- `选书决策`

应用映射：

| ExportSourceKind | Notion 值 |
| --- | --- |
| `bookNotes` | `书籍笔记` |
| `bookReview` | `书籍复盘` |
| `readingStatsReview` | `阅读统计复盘` |
| `readingRoute` | `阅读路线` |
| `bookDecision` | `选书决策` |

### 4.2 `来源`

- `wxreadmaster`
- `Obsidian`
- `手动整理`

首版导入固定写入 `wxreadmaster`。

### 4.3 `导入状态`

- `待整理`
- `已导入`
- `已复盘`
- `已归档`

首版导入固定写入 `已导入`。

### 4.4 `阅读状态`

- `待读`
- `阅读中`
- `复盘中`
- `已整理`

该字段用于用户手动管理或后续本地阅读状态同步。

## 5. Notion 页面布局建议

数据库视图建议：

- `全部资产`：按 `导出时间` 倒序。
- `画廊`：使用 Gallery，Card preview 绑定数据库属性 `封面`，不要依赖 Page cover。
- `书籍笔记`：过滤 `资产类型 = 书籍笔记`。
- `复盘`：过滤 `资产类型 = 书籍复盘`。
- `待读整理`：过滤 `导入状态 = 待整理`。

单条页面建议结构：

1. Gallery 卡片：读取 `封面` Files & media 属性。
2. Page cover：在页面顶部展示书籍封面；与 Gallery 属性封面独立。
3. 顶部属性：作者、资产类型、Book ID、导出时间、导入状态。
4. 正文：由 wxreadmaster Markdown 转为 Notion blocks。

当前标准库创建流程会在数据库连接保存后初始化四个最小 Table 视图：`最近导入`、`书籍笔记`、`待复盘`、`复盘与报告`。其中 `最近导入`复用并更新 Notion 自动生成的 `Default view`，其余三个视图按筛选和排序契约创建。该能力只作用于应用本次新建的标准库；用户已有数据库、旧标准库和第三方模板不会自动改造。视图初始化失败只进入可重试的 `partial`，不会回滚数据库连接，也不会重复创建数据库。

Gallery 仍由用户按需手工创建，并把 Card preview 绑定数据库 `封面` 属性；应用不会自动创建或覆盖用户 Gallery 和其他未知视图。

## 6. 应用内 UI 设计

设置页 Notion 区域拆成三个层次：

- `连接状态`：Token 是否已保存、目标数据库是否已配置。
- `一键模板`：展示字段预览、父页面 ID 输入、创建按钮。
- `高级目标`：保留手动填写 Page/Database ID 的能力。

推荐交互：

1. 用户填写 Integration Token。
2. 用户在 Notion 创建一个空父页面，并共享给 Integration。
3. 用户填写父页面 ID。
4. 点击 `创建阅读库数据库`。
5. 应用调用 Notion API 创建数据库。
6. 成功后自动把新数据库 ID 写入设置，目标类型设为 `Database`。
7. 后续导出默认进入该数据库。

失败处理：

- Token 缺失：提示先保存 Token。
- 父页面 ID 为空：提示填写已共享的父页面 ID。
- 403：提示父页面未共享给 Integration。
- 404：提示页面不存在或没有权限。
- API 失败：不清空已有设置。

## 7. API 契约

新增 Tauri command：

```rust
#[tauri::command]
pub async fn create_notion_reading_library_template(
    app: AppHandle,
    parent_page_id: String,
) -> Result<CreateNotionReadingLibraryTemplateResponse, AppCommandError>
```

响应：

```rust
pub struct CreateNotionReadingLibraryTemplateResponse {
    pub database_id: String,
    pub url: String,
    pub title: String,
    pub state: SettingsStateResponse,
}
```

执行职责：

- 从 Stronghold 读取 Notion Token。
- 校验父页面 ID。
- 在父页面下创建 `wxreadmaster 阅读库` 数据库。
- 创建模板字段。
- 写入本地 Notion 配置：`parentId = database_id`，`parentType = database`。
- 返回最新设置状态。

## 8. 导入写入策略

当目标是标准成果数据库时，应用除了写 Title，还应尽量写入这些属性：

- `作者`
- `Book ID`
- `封面`
- `资产类型`
- `来源`
- `导出时间`
- `导入状态`

封面写入采用创建后双 PATCH：

1. 先创建不带封面 mutation 的页面，取得 page ID。
2. 独立 PATCH 数据库 `封面` Files & media 属性。
3. 若封面模式允许，再独立 PATCH Page cover。
4. 两次 PATCH 使用同一有效 HTTP(S) 封面 URL，但状态和错误彼此独立。
5. 封面失败不阻断正文，也不得触发页面创建 POST 重发，避免重复成果页。
6. mutation 超时或网络结果未知时读取页面最新状态做 reconciliation；确认目标 URL 已写入才视为成功。

`contentImageOnly` 的兼容语义：

- 禁用 Page cover。
- 不禁用数据库 `封面` 属性；Gallery 仍应有稳定预览。

兼容策略：

- 如果用户删掉某个可选字段，正文导入不应失败。
- 写入前读取数据库 schema，只写存在且类型匹配的属性。
- Title 字段继续自动识别，不强制叫 `名称`。
- `cover` logical field 只允许映射到 `files`。
- 唯一 `封面/files` 候选可复用；同名错误类型或多个候选时 fail-closed，不自动改名、删除或覆盖字段。

这保持 DRY：模板字段和普通数据库导入共用同一套 schema 探测逻辑。

Notion 网络客户端与错误反馈契约：

- 数据库分析、标准库创建、普通导出、Tracker、凭据校验和封面回填复用统一客户端配置，支持系统代理、rustls 和 SOCKS，并设置连接与请求总超时。
- 网络发送失败按连接、超时、请求发送、响应传输和解析阶段保留结构化诊断；401、403、404、429 等已收到 HTTP 响应的 API 错误继续使用独立文案，不混同为网络故障。
- 设置页数据库检查使用独立 45 秒前端门限，避免早于后端 30 秒请求超时而遮蔽真实分类。
- Toast 只展示“检查网络、系统代理或 VPN”的可操作主文案；底层 URL 留在结构化诊断中，不进入主提示，也不得包含 Token。
- 统一客户端不改变 mutation 安全策略：除 429 有界重试外，网络错误、超时和 5xx 不盲目重发创建或更新请求；结果未知时仍按原状态机或 reconciliation 处理。

## 9. 现有成果页封面回填

旧数据库或历史成果页不会因未来导出逻辑升级而自动获得属性封面，因此设置页提供独立维护流程：

1. **预检**：固定 database ID、schema fingerprint、唯一 `封面/files` 字段方案和唯一 Book ID 字段。
2. **显式确认**：没有 `confirm=true` 不允许执行。
3. **本地查找**：只按 Book ID 读取本地缓存，优先级为 `notebook_books.cover`、`book_details.cover`、`shelf_entries.cover`；不访问微信读书远端，只接受 HTTP(S)。
4. **只补空值**：处理每页前重新读取最新状态；已有属性封面或 Page cover 分别保留，绝不覆盖人工内容。
5. **独立容错**：属性封面与 Page cover 分开更新；一个成功、一个失败记为 `partial`，单页失败不阻断整体。
6. **取消与报告**：使用 operation ID 取消；已完成修改保留，不回滚；报告区分 updated、partial、preserved、skipped、failed、canceled。

安全边界：

- 回填不创建新数据库。
- 回填不创建、删除或归档成果页。
- schema 漂移、字段类型冲突、多个候选字段或 database ID 变化时停止执行并要求重新预检。
- 回填状态与标准库 provisioning 状态机隔离，并使用单飞保护禁止并发任务。
- 真实 Notion 回填必须在预检结果可见后再次取得用户明确确认；本地自动化测试不得代替该确认。

真实验收记录（2026-08-03）：

- 用户已在真实阅读成果库完成封面回填测试，并确认执行通过。
- Gallery Card preview 已绑定 `封面` Files & media 属性，既有成果页可正常展示封面。
- 本次确认作为真实 mutation 与视觉展示验收证据；后续再次回填仍需继续遵守预检、显式确认、只补空值和不覆盖人工封面的边界。

## 10. 手动创建模板

用户也可以手动创建一张 Notion 数据库，至少需要：

- 一个 Title 字段，例如 `名称`。
- 可选添加上述推荐字段。

然后把数据库共享给 Notion Integration，在应用设置中填数据库 ID，目标类型选 `数据库`。

## 11. 验收标准

- 可在父页面下一键创建 `阅读成果库` 数据库，且默认包含 `封面` Files & media 属性。
- 创建后应用自动切换 Notion 目标为新数据库。
- database analysis 能给出 `cover -> 封面/files` 建议映射，并按 property ID 保存。
- 单本笔记导入数据库时能写入标题、作者、Book ID、资产类型、来源、导出时间和导入状态。
- 有有效封面时，数据库 `封面` 属性和 Page cover 可独立写入；`contentImageOnly` 仅禁用 Page cover。
- 任一封面 PATCH 失败不导致正文失败，也不重发页面创建 POST。
- Gallery Card preview 绑定 `封面` 后可显示新导出成果页封面。
- 旧页回填只补空值，保留人工封面；缺本地封面时跳过并报告。
- 回填支持预检、显式确认、进度、取消、结构化报告和防并发。
- 字段冲突、Book ID 歧义或 schema 漂移时 fail-closed。
- 用户删除推荐字段后，正文导入仍成功。
- Notion Token 不进入普通配置、日志和导出内容。
