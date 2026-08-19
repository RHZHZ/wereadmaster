# WxReadMaster

<img src="src/assets/generated/readme-hero.png" alt="WxReadMaster 个人阅读管理工作台" />

> 把阅读记录整理成可以继续阅读、复盘、导出和备份的本地成果。

[![Release](https://img.shields.io/github/v/release/RHZHZ/wereadmaster)](https://github.com/RHZHZ/wereadmaster/releases)
[![Download](https://img.shields.io/badge/下载最新版-GitHub%20Releases-2f80ed)](https://github.com/RHZHZ/wereadmaster/releases)

## 先理解这套工作台

WxReadMaster 是一个本地优先的个人阅读管理工作台。它可以接收你主动同步的微信读书数据，也可以管理 EPUB、TXT 和 Markdown 本地图书；之后在本地整理阅读状态、划线、想法和统计，按需生成书籍复盘、阅读指南、阅读路线、周期复盘和报告图片，并将已经生成的成果带到 Markdown、Obsidian、Notion，或按预览边界发布到 IMA 笔记与知识库。

它不是账号抓取工具，也不是双向知识库同步服务。应用只处理你主动配置并合法获取的数据；联网、AI 处理和导出都由具体操作触发。

## 核心闭环

<img src="docs/assets/reading-workflow.svg" alt="WxReadMaster 阅读闭环：同步、阅读与整理、生成成果、导出与备份" />

四个阶段可以循环使用：

1. **同步**：主动同步微信读书书架、笔记和统计，或导入本地图书。
2. **阅读与整理**：管理候选关系、阅读生命周期、整理进度、划线和想法。
3. **生成成果**：生成书籍复盘、阅读指南、阅读路线、周期复盘和报告图片。
4. **带走**：将本地已有成果导出到 Markdown、Obsidian、Notion，或按预览边界发布到 IMA，并执行本地备份。

不需要一次配置所有能力。先同步和阅读，等有足够材料后再配置 AI、Embedding 或导出目标。

## 适合谁

- 想长期整理微信读书书架、笔记和统计的人。
- 想把划线和想法变成可回看的书籍复盘或阅读指南的人。
- 想在本地阅读 EPUB、TXT 或 Markdown，并保留独立阅读记录的人。
- 想把阅读成果带到 Markdown、Obsidian、Notion，或按预览边界发布到 IMA 的人。

## 你可以管理什么

### 三类阅读来源

| 来源 | 主要内容 | 数据关系 |
| --- | --- | --- |
| 微信书架 | 书架、笔记、统计、发现结果 | 主动同步到本地缓存，不写回第三方知识库 |
| 候选书架 | 想继续了解或准备阅读的书 | 只保存在本机，不写回微信读书 |
| 本地书库 | EPUB、TXT、Markdown、阅读进度、划线、想法 | 与微信书架分开保存，可人工关联但不自动合并 |

### 阅读状态

一本书的状态拆成三个互不覆盖的维度：

- **候选关系**：是否保留为候选，以及候选来源。
- **阅读生命周期**：想读、在读、暂停、读完或暂缓。
- **整理进度**：无、待整理或已整理。

因此，“读完”不等于“已整理”，“已整理”也不会移除候选关系。

### 阅读成果

- **书籍复盘**：单本书的结构化回顾，支持快速抽样和完整快照两种模式。
- **阅读指南**：围绕当前书给出下一步读法、整理动作和复盘建议。
- **阅读路线**：安排多本书之间的阅读顺序和关系。
- **周期复盘**：按周度、月度、年度或总计统计阅读情况。
- **报告图片**：把统计或周期复盘生成适合保存和分享的图片。
- **AI 阅读助手**：在明确的上下文范围内提问、检索笔记和继续追问。

## 数据边界

<img src="docs/assets/data-boundaries.svg" alt="WxReadMaster 数据边界：微信读书、本地工作区、AI 服务与导出目标" />

关键原则：

- 打开导出窗口不会自动同步微信读书、调用 AI 或生成缺失成果。
- AI 只处理你主动触发的上下文；是否发送原始笔记由独立授权控制。
- 构建语义索引时会将笔记正文发送给你配置的 Embedding Provider；日常混合检索只发送查询文本，笔记正文仍从本机读取。
- SQLite 备份包含主数据库以及存在时的 WAL/SHM 文件，但不包含凭据、语义向量、索引任务记录和本地阅读器 WebView 存储。
- Web Preview 是只读入口：不写入阅读状态、不执行本地导出、不触发 AI、不调用本地命令。
- Notion 当前是单向导出，不会把 Notion 内容同步回本地，也不会后台改造已有数据库的视图和结构。
- IMA 导出也是单向、主动触发的发布：本地快照会创建 IMA 笔记，可选加入知识库；不会把 IMA 修改回写本地，也不会自动覆盖或删除远端旧版本。

## 当前平台范围

| 能力 | Windows 桌面端 | Android | Web Preview |
| --- | --- | --- | --- |
| 查看已同步内容 | 支持 | 支持 | 查看已准备数据 |
| 微信读书同步 | 支持 | 支持 | 不支持 |
| 本地书库与阅读器 | 完整能力 | 移动阅读优先 | 只读查看 |
| 主动生成 AI 成果 | 支持 | 以应用实际入口和配置为准 | 不支持 |
| 文档导出与本地备份 | 支持 Markdown、Obsidian、Notion；IMA 按预览边界 | 按移动端能力 | 不支持本地写操作 |
| 应用更新 | 应用内更新或下载安装包 | 下载 APK 后按系统安装 | 不适用 |

## v1.0.19 重点

- 语义索引支持 OpenAI-compatible Embedding Provider 和 Ollama 原生 `/api/embed`。
- 普通笔记查询可以融合本地词法召回和语义召回；精确短语、全量匹配和分页续查优先使用本地词法检索。
- Embedding 不可用、索引失效或配置不匹配时，笔记搜索自动回退到本地词法检索。
- 完整复盘采用不可变本地快照和批次任务，支持进度、取消、继续和失败批次重试。
- AI 阅读助手显示检索来源，并保持原始笔记展示的独立授权边界。
- 修复 Android 发布构建与 Gradle 9 的兼容问题。
- 接入 IMA 笔记与知识库导出入口：支持 Client ID/API Key 配置、目标读取、版本检查、笔记本与知识库路由，以及单本和批量主动发布。

完整变化见 [v1.0.19 Release Notes](docs/release-notes-v1.0.19.json)。

> IMA 导出已提供新版本入口和用户教程，但真实服务、权限、版本兼容和 Android 全链路仍需按发布门禁完成验收；在验收收敛前，请将 IMA 视为预览能力，不作为无条件稳定发布承诺。

## 15 分钟快速开始

### 1. 安装

从 [GitHub Releases](https://github.com/RHZHZ/wereadmaster/releases) 下载对应平台版本：

- Windows x64：下载安装包并启动。
- Android：下载签名 APK，按系统提示安装或升级。

### 2. 同步第一批数据

进入 `设置 > 账户与同步`，按微信读书官方页面获取并保存 API Key，然后从 `书架`、`笔记` 或 `统计` 页面主动执行同步。

### 3. 生成第一个成果

选择一本已经有划线或想法的书：

1. 打开书籍详情，确认材料已经同步到本机。
2. 先生成 `快速复盘（抽样）`，快速了解主题和行动项。
3. 需要覆盖当前笔记快照时，再使用 `完整复盘（快照）`。
4. 在成果页查看结果，并尝试导出一份 Markdown。

### 4. 配置语义索引（可选）

进入 `设置 > AI 设置 > 语义索引`：

- OpenAI-compatible：配置 Embedding Base URL、模型和独立 API Key。
- 本机 Ollama：使用 `http://localhost:11434/api/embed`，模型可填写 `qwen3-embedding:4b`，API Key 留空。

先测试连接，再确认允许发送笔记正文生成向量，最后开始构建索引。

## 导出与备份

单项成果、笔记和书籍复盘支持选择 Markdown、Obsidian 或 Notion 目标。导出结果按目标显示成功或失败；部分失败时使用 `重试失败项`，不要重复提交已经成功的目标。

在 `设置 > 高级维护` 执行 SQLite 备份。重要的本地阅读器划线、想法、AI 提问和阅读器偏好不在 SQLite 备份范围内，请另外导出或保留原始本地数据目录。

## 开发与验证

需要 Node.js、Rust 和 Tauri 开发环境。常用命令：

```powershell
npm install
npm run dev
npm test
npm run build
npm run e2e
```

Rust 侧门禁：

```powershell
cargo fmt --check
cargo check
cargo test --lib
```

完整发布候选还应执行 TypeScript、独立输出目录生产构建、Playwright、Rust 和 `git diff --check`。不要将局部单测通过等同于真实 IMA、Ollama、Windows 安装或 Android 真机验收通过。

## 文档入口

- [用户指南](docs/user-guide.md)：按任务查找安装、同步、阅读、成果、导出、备份和排障步骤。
- [v1.0.19 Release Notes](docs/release-notes-v1.0.19.json)：版本变化、隐私和兼容边界。
- [产品术语表](docs/GLOSSARY.md)：现行页面文案和产品命名。
- [GitHub Releases 更新说明](docs/github-release-updates.md)：应用更新说明。
- [docs 目录](docs/)：设计、验收和维护资料。

## 安全与使用边界

本项目只帮助你整理和导出自己合法获取的阅读数据：

- 不抓取他人数据；
- 不破解或绕过付费内容；
- 不批量盗号；
- 不托管你的 API Key；
- 不把 Notion 当作双向同步服务。

如果微信读书接口或平台规则发生变化，本地已经同步的缓存和已经导出的文件仍可继续使用，但不保证远端接口永久可用。
