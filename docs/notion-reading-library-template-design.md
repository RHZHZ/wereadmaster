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

- 一个 Notion 父页面：`wxreadmaster`
- 一个核心数据库：`阅读库`
- 每本书或每个阅读资产是一条页面记录
- 页面正文承载 Markdown 转换后的块内容
- 页面封面承载书籍封面

这比拆成“书籍库、笔记库、复盘库、统计库”更符合 KISS 和 YAGNI。首版只维护一张数据库，降低用户配置成本和 API 出错面。

## 3. 数据库字段

### 3.1 必需字段

| 字段名 | Notion 类型 | 应用写入 | 用途 |
| --- | --- | --- | --- |
| `名称` | Title | 是 | 页面标题，通常为书名或资产标题 |
| `作者` | Rich text | 是 | 书籍作者 |
| `Book ID` | Rich text | 是 | 微信读书 bookId 或本地 sourceId |
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
- `书籍笔记`：过滤 `资产类型 = 书籍笔记`。
- `复盘`：过滤 `资产类型 = 书籍复盘`。
- `待读整理`：过滤 `导入状态 = 待整理`。

单条页面建议结构：

1. 页面封面：书籍封面。
2. 顶部属性：作者、资产类型、Book ID、导出时间、导入状态。
3. 正文：由 wxreadmaster Markdown 转为 Notion blocks。

当前 API 初始化先创建数据库和字段，不创建视图过滤器。Notion API 对视图控制有限，视图可在用户复制模板或后续 Notion API 能力成熟后补齐。

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

当目标是模板数据库时，应用除了写 Title，还应尽量写入这些属性：

- `作者`
- `Book ID`
- `资产类型`
- `来源`
- `导出时间`
- `导入状态`

兼容策略：

- 如果用户删掉某个字段，导入不应失败。
- 写入前读取数据库 schema，只写存在且类型匹配的属性。
- Title 字段继续自动识别，不强制叫 `名称`。

这保持 DRY：模板字段和普通数据库导入共用同一套 schema 探测逻辑。

## 9. 手动创建模板

用户也可以手动创建一张 Notion 数据库，至少需要：

- 一个 Title 字段，例如 `名称`。
- 可选添加上述推荐字段。

然后把数据库共享给 Notion Integration，在应用设置中填数据库 ID，目标类型选 `数据库`。

## 10. 验收标准

- 可在父页面下一键创建 `wxreadmaster 阅读库` 数据库。
- 创建后应用自动切换 Notion 目标为新数据库。
- 单本笔记导入数据库时能写入标题、作者、Book ID、资产类型、来源、导出时间和导入状态。
- 用户删除推荐字段后，正文导入仍成功。
- Notion Token 不进入普通配置、日志和导出内容。
