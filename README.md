# 微信读书个人阅读管理

<img src="src/assets/generated/readme-hero.png" alt="微信读书个人阅读管理主视觉" />

本地优先的微信读书桌面工作台，适合整理书架、笔记、统计和复盘。

如果你想把微信读书从一个“阅读工具”变成一个“可整理、可复盘、可长期沉淀”的本地知识库，这就是它。

[![Release](https://img.shields.io/github/v/release/RHZHZ/wxreadmaster)](https://github.com/RHZHZ/wxreadmaster/releases)
[![Download](https://img.shields.io/badge/下载最新版-GitHub%20Releases-2f80ed)](https://github.com/RHZHZ/wxreadmaster/releases)

## 立即使用

- [查看最新发布](https://github.com/RHZHZ/wxreadmaster/releases)
- [查看一键更新说明](docs/github-release-updates.md)

## 你能得到什么

- 统一看书架、书籍详情、笔记和阅读统计。
- 本地管理数据，减少对前端明文凭据的暴露。
- 支持 AI 复盘、Markdown 导出和 GitHub Releases 一键更新。

## 为什么值得装

- 把分散的阅读数据收进一个稳定的桌面入口。
- 常用内容都能本地缓存，切页更顺手。
- 发布版本通过 GitHub Releases 分发，更新路径清晰。

## 适合谁

- 想把微信读书当成长期知识库的人。
- 需要整理笔记、统计和复盘的人。
- 希望有一个更稳定、更私密桌面入口的人。

## 核心能力

- **总览**: 先看同步状态和关键摘要，再决定下一步。
- **书架**: 管理电子书、有声书和文章收藏。
- **书籍详情**: 查看进度、章节和深链入口。
- **笔记**: 浏览划线和想法，支持 Markdown 导出。
- **统计**: 看周/月/年/总计阅读趋势。
- **发现**: 搜索、推荐和相似书推荐。
- **AI 复盘**: 自动生成结构化总结，结果本地缓存。
- **更新**: 通过 GitHub Releases 检查并安装新版本。

## AI 阅读资产

应用把 AI 能力收束成三类可持续保存的阅读资产，不做通用聊天，也不会在后台自动上传内容。

| 能力 | 解决什么问题 | 怎么用 | 如何持续记录 |
| --- | --- | --- | --- |
| AI 复盘 | 把一本书的划线和想法整理成主题、关键观点、行动项和复盘问题。 | 在书籍详情或复盘中心选择书籍，点击“生成复盘”。没有本地缓存时，只有这一步会读取并发送当前书笔记。 | 复盘结果保存在本地缓存；行动项和复盘问题可以持续标记状态，后续还能导出 Markdown。 |
| 阅读指南 | 回答“这本书接下来怎么读、怎么整理、怎么复盘”。 | 在书籍详情点击“本书阅读指南”，默认只基于当前书、本地进度、已有复盘和统计信号生成。 | 指南会按书归档到“复盘 > 阅读指南”，适合在阅读推进、笔记增加或读完后刷新。 |
| 跨书指南 | 回答“围绕当前主题，下一步读哪些书、按什么顺序读”。 | 先把候选书加入候选书架，再在阅读指南里勾选候选书生成跨书路线图。 | 跨书路线会和当前书关联保存，后续可回到阅读指南库查看路线、复盘节点和下一步动作。 |

持续记录的推荐节奏：

1. 同步书架和笔记后，先在书籍详情确认当前书状态。
2. 阅读中期生成或刷新“本书阅读指南”，明确下一段阅读范围和复盘输出。
3. 读完或笔记足够多时生成“AI 复盘”，把行动项和复盘问题留在本地跟踪。
4. 想延展同一主题时，把候选书加入路线，生成“跨书指南”安排下一本。
5. 定期在“复盘 > 阅读指南”和“复盘 > 书籍复盘”查看已沉淀资产，必要时导出 Markdown。

## 页面预览

| 总览 | 书架 | 笔记 | 设置 |
| --- | --- | --- | --- |
| ![](src/assets/hero-reading-dashboard.png) | ![](src/assets/empty-shelf.png) | ![](src/assets/empty-notes.png) | ![](src/assets/generated/onboarding-local-vault.png) |

## 快速开始

当前正式发布面向 Windows x64。

1. 从 [GitHub Releases](https://github.com/RHZHZ/wxreadmaster/releases) 下载 Windows 安装包。
2. 安装并启动应用。
3. 在设置页完成凭据和更新配置。
4. 开始同步、查看和整理你的阅读数据。

## 本地开发

```powershell
npm run dev
npm test
npm run build
npm run e2e
```

Rust 侧：

```powershell
cargo fmt --check
cargo test --lib
cargo check
```

## 一键更新

正式版本通过 GitHub Releases 分发。应用内“检查并更新”会读取 `latest.json`，验证签名后下载安装包。

发布说明见 [docs/github-release-updates.md](docs/github-release-updates.md)。

## 安全边界

- 前端不直接请求微信读书 API。
- 凭据不进入前端日志和 Markdown 导出。
- 更新包使用签名校验。
