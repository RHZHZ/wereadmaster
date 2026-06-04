# GitHub Releases 一键更新发布说明

## 目标

正式版本通过 GitHub Releases 分发 Windows 安装包和 Tauri updater 产物。用户在应用设置页侧边栏进入“应用更新”菜单后，应用会先读取配置的更新端点并展示版本信息、更新摘要和发布来源；确认安装后再校验签名并下载更新。

## 发布页口径

Release 页面不要只写“修了什么”，还要先回答“这个产品解决什么问题”。建议保持下面这套顺序：

1. 先用一句话讲清定位：这是一个本地优先的微信读书阅读工作台，不是泛用聊天工具。
2. 再用一小段说明结果价值：帮助用户把阅读记录沉淀成可复盘、可导出、可长期积累的知识资产。
3. 最后再列本次版本更新、兼容性和回滚说明。

建议长期复用的开场句：

> 把微信读书里的阅读记录，沉淀成你的知识资产。

建议长期复用的补充描述：

> 这是一个本地优先的阅读工作台，统一整理书架、笔记、阅读统计与 AI 复盘，帮助你更清楚地知道接下来读什么、复盘什么、输出什么。

## 当前状态

- 应用内 updater 插件已接入。
- 设置页侧边栏已提供“应用更新”菜单，内部包含“检查更新 / 安装更新”入口。
- 更新说明弹窗已限制最大高度；当 GitHub Release 摘要过长时，仅摘要区域内部滚动，版本信息和操作按钮保持可见。
- 构建配置已开启 `createUpdaterArtifacts`。
- GitHub Actions 已新增 tag 触发的 Windows 发布流程。
- GitHub Actions 已新增 Android APK 发布流程。
- GitHub 仓库地址已固定为 `RHZHZ/wereadmaster`。
- updater 公钥已写入 `src-tauri/tauri.conf.json`。
- Windows release workflow 会在安装包上传完成后，基于 release 资产地址和本地 `.sig` 文件手工生成 `latest.json`。
- 首次正式发布前仍需把私钥配置到 GitHub Actions Secrets。

## 更新体验改造目标

下面这部分是接下来要做的体验改造，不代表当前版本已经全部实现：

1. 应用启动后自动检查更新。
2. 检测到新版本后，主导航“设置”入口显示红点。
3. 设置弹层内“应用更新”分类也显示红点。
4. 首次发现某个新版本时，自动弹出更新说明弹窗。
5. 用户可在弹窗中直接选择“立即更新”或“稍后再说”。
6. 用户选择稍后后，不再对同一版本重复强弹，但红点继续保留。
7. 设置页仍保留手动检查、查看摘要和安装更新入口。

## 交互原则

### 1. 轻提醒优先

- 优先使用红点和一次性说明弹窗，不做每次启动都强制打断的更新提示。
- 自动检测可以主动，但安装必须明确确认。
- 更新入口始终保留在设置页，保证用户能再次核对版本、摘要和来源。

### 2. 首次弹窗只对新版本触发一次

- 同一个版本首次发现时可以自动弹窗。
- 用户点“稍后再说”后，本版本后续启动不再重复弹窗。
- 用户即使关闭弹窗，红点仍然存在，直到进入更新页查看详情或完成更新。

### 3. 桌面端和 Android 分开处理

- Windows 桌面版支持 Tauri updater，适合做“自动检测 + 弹窗说明 + 一键下载并安装”。
- Android APK 自分发不走 Tauri 原生 updater，只做“检测到新版本 + 显示说明 + 打开 Release 下载页 / 下载 APK 引导安装”。
- 不把 Android 的安装体验伪装成和 Windows 一样的原生无缝更新。

## 平台策略

### Windows

- 使用现有 GitHub Releases + `latest.json` 更新链路。
- 启动后延迟数秒自动检查，避免和首屏加载抢资源。
- 发现新版本后：
  - 主导航“设置”显示红点
  - 设置内“应用更新”分类显示红点
  - 首次发现时自动弹说明弹窗
- 用户点击“立即更新”后，进入下载并安装流程。

### Android

- 不调用桌面版 updater 插件。
- 更新页展示最新 APK 版本、发布时间、更新摘要和下载来源。
- 自动检测到新版本后，同样可以显示红点和说明弹窗。
- 安装动作改为跳转 GitHub Release 或下载 APK 后交由系统安装。

## 状态模型

推荐把更新交互设计成一套明确状态，而不是零散布尔值：

```ts
type AppUpdateFlowState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "readyToInstall"
  | "installing"
  | "upToDate"
  | "error";
```

同时拆分两类状态：

1. 运行时状态
   - 当前是否正在检查
   - 当前是否有可用更新
   - 当前是否正在下载 / 安装
   - 当前错误信息

2. 持久化提示状态
   - `lastCheckedAt`
   - `dismissedVersion`
   - `reviewedVersion`

推荐语义：

- `dismissedVersion`：用户对该版本点过“稍后再说”，同版本不再自动弹窗。
- `reviewedVersion`：用户已查看过该版本详情，用来决定是否清除红点。
- `lastCheckedAt`：用于控制自动检查频率，避免应用每次启动都请求更新端点。

## 前端架构建议

### 1. 更新协调器放在 App 层

- 自动检测不应只放在设置页内部。
- 因为设置页只在打开时挂载，无法承担“应用启动后自动检测”的职责。
- 推荐在 `App` 层集中维护更新状态，并将结果透传给设置页和弹窗。

### 2. 设置页负责展示，不负责独立编排

- 设置页继续负责：
  - 展示当前版本和最新版本
  - 展示发布时间和更新摘要
  - 提供“检查更新 / 安装更新”按钮
- 自动检测、红点显示、首次弹窗这类跨页面行为应由外层统一控制。

### 3. 安装动作尽量复用同一次检查结果

- 不建议点击“安装更新”时再次重新 `check()`。
- 更稳妥的做法是：
  - 检查更新时缓存当前可安装更新对象
  - 用户确认后直接对该对象执行下载 / 安装
- 这样可避免二次请求导致的版本漂移或重复网络开销。

### 4. 更新摘要渲染不要只用单段文本

- GitHub Release 摘要通常包含标题、空行和列表。
- 建议至少支持：
  - 空行分段
  - `- ` 列表项
- 不必一开始就引入完整 Markdown 渲染器，先满足可读性即可。

## 红点与弹窗规则

推荐规则如下：

- 红点显示条件：存在可用新版本，且该版本尚未被标记为已查看。
- 自动弹窗条件：存在可用新版本，且该版本尚未被标记为已忽略。
- 用户点“稍后再说”：
  - 记录 `dismissedVersion`
  - 不清除红点
- 用户进入“应用更新”页并看到详情：
  - 记录 `reviewedVersion`
  - 清除红点
- 用户完成安装：
  - 清理旧版本提示状态

## 实现顺序建议

按这个顺序改，能把风险控制在最小范围：

1. 先补文档与状态约定。
2. 把更新状态提升到 `App` 层管理。
3. 为设置入口和设置内更新分类加红点。
4. 增加首次发现新版本时的说明弹窗。
5. 把安装链路改成复用同一次检查结果。
6. 最后补下载进度展示和 Android 降级更新入口。

## 改造后的验收标准

除了现有发布产物链路外，后续实现还应满足下面这些体验验收项：

1. Windows 启动后能自动检查更新，但不会在每次启动都重复强弹。
2. 检测到新版本后，主导航“设置”和设置内“应用更新”都能显示红点。
3. 新版本首次发现时能自动弹出说明弹窗，并展示版本号、发布时间和更新摘要。
4. 用户点击“稍后再说”后，同版本不再重复自动弹窗。
5. 用户进入更新页查看详情后，红点会被清除。
6. Windows 可从弹窗或设置页进入下载并安装流程。
7. Android 能检测版本并展示更新说明，但安装动作走 APK 下载 / 系统安装流程。

## 首次发布前准备

1. 在 GitHub 创建仓库，并把本地仓库推送到 GitHub。
2. 生成 Tauri updater 签名密钥：

   ```powershell
   npm run tauri signer generate -- --ci -w "$env:USERPROFILE/.tauri/wxreadmaster.key"
   ```

3. 当前项目公钥已经写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
4. 当前项目更新端点已经写入：

   ```json
   {
     "plugins": {
       "updater": {
         "endpoints": [
           "https://github.com/RHZHZ/wereadmaster/releases/latest/download/latest.json"
         ]
       }
     }
   }
   ```

5. 在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中配置：

   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   - `TAURI_RELEASE_PAT`（可选；如果 `GITHUB_TOKEN` 仍报 `Resource not accessible by integration`，就改用它）
   - `ANDROID_KEY_BASE64`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
   - `ANDROID_STORE_PASSWORD`

   如果私钥没有设置密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可以留空或先不配置。

6. `TAURI_SIGNING_PRIVATE_KEY` 建议填入：

   - `C:\Users\RHZ\.tauri\wxreadmaster.key` 文件全文内容
   - 不要提交到仓库
   - 不要写进 `.env`

7. 如果 GitHub Actions 仍然提示 `Resource not accessible by integration`，先检查仓库 `Settings > Actions > General` 里的 `Workflow permissions` 是否为 `Read and write permissions`；如果组织策略限制了默认 token，就启用 `TAURI_RELEASE_PAT`。
8. Android 不是走 Google Play 也可以发 APK，但必须提供自己的 keystore；建议把 keystore 先转成 base64 存到 `ANDROID_KEY_BASE64`，并由 CI 直接上传到同一个 release。
9. 当前 workflow 中，`tauri-action` 仍可使用 `TAURI_RELEASE_PAT` 兜底；但后续 `gh release upload` 步骤固定使用内置 `github.token`。如果你配置了 `TAURI_RELEASE_PAT` 且日志出现 `HTTP 401: Bad credentials`，优先检查该 secret 是否过期、是否多复制了空格或换行。

## 本地打包说明

- 当前项目的 `npm run tauri ...` 已包一层本地启动脚本。
- 当你执行 `npm run tauri build` 或 `npm run tauri bundle` 时，如果当前进程没有设置 `TAURI_SIGNING_PRIVATE_KEY`，脚本会自动尝试读取 `C:\Users\RHZ\.tauri\wxreadmaster.key`。
- 如果你已经手动设置了 `TAURI_SIGNING_PRIVATE_KEY`，则优先使用当前环境变量，不覆盖你的显式配置。

## 发布步骤

1. 同步版本号，确保以下位置一致：

   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. 本地验证：

   ```powershell
   npm test
   npm run build
   cargo check --manifest-path "src-tauri/Cargo.toml"
   ```

3. 创建并推送版本标签：

   ```powershell
   git tag v1.0.1
   git push origin v1.0.1
   ```

4. GitHub Actions 会创建正式 release，并上传安装包和 updater 产物。
5. Windows job 会显式生成并上传 `latest.json`，检查 release 中的安装包、`latest.json` 和签名产物。
6. 如需补充说明，直接编辑 release notes。

## 最小发布检查清单

按这个顺序走，别再横向加需求：

1. 版本号一致，且 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 同步。
2. 本地回归通过：`npm test`、`npm run build`、`cargo check --manifest-path "src-tauri/Cargo.toml"`。
3. 核心流程可用：同步书架、阅读指南、书籍复盘、版本历史、导出、设置页。
4. 应用更新可见：设置页能检查到 GitHub Releases，能展示更新摘要。
5. 发布产物齐全：安装包、`latest.json`、签名产物都在 draft release 中。

如果任何一项失败，先修阻塞，再继续发版。

## 首次发布建议

建议第一次使用：

1. 标签使用 `v1.0.0`。
2. 先正式发布当前版本。
3. 下载并安装当前版本。
4. 再推送一个更高版本标签，例如 `v1.0.1`。
5. 在已安装旧版本的应用里进入“设置 > 应用更新”，点击“检查更新”，确认摘要和版本信息无误后执行“安装更新”，验证整条链路。

## 首次发布模板

```md
把微信读书里的阅读记录，沉淀成你的知识资产。

这是一个本地优先的阅读工作台，统一整理书架、笔记、阅读统计与 AI 复盘，帮助你更清楚地知道接下来读什么、复盘什么、输出什么。

## 本次版本

- ...

## 更新说明

- 版本：v1.0.0
- 适用平台：Windows x64
- 更新方式：设置 > 应用更新

## 兼容性

- Windows 10 / 11

## 回滚

- 如更新异常，请回退到上一版安装包
```

## 常规发布模板

适合后续每次发版直接复制，再按版本内容替换：

```md
把微信读书里的阅读记录，沉淀成你的知识资产。

这是一个本地优先的阅读工作台，统一整理书架、笔记、阅读统计与 AI 复盘，帮助你更清楚地知道接下来读什么、复盘什么、输出什么。

## 本次更新

- 新增：
  - ...
- 优化：
  - ...
- 修复：
  - ...

## 适合谁

- 希望把微信读书当成长期知识库的人
- 有划线、摘录、复盘或写作习惯的人
- 想把阅读记录沉淀成个人资产的人

## 更新说明

- 适用平台：Windows x64
- 更新方式：设置 > 应用更新

## 回滚

- 如更新异常，请回退到上一版安装包
```

## 精简发布模板

如果本次只是小版本修复，可以用更短的版本：

```md
把微信读书里的阅读记录，沉淀成你的知识资产。

## 本次更新

- 修复：
  - ...
- 优化：
  - ...

## 更新说明

- 适用平台：Windows x64
- 更新方式：设置 > 应用更新
```

## Android 发布说明

- 目标产物：APK
- 分发方式：直接下载安装
- 签名方式：自有 keystore
- 不依赖 Google Play
- 需要在 GitHub Actions Secrets 中提供 Android 签名材料
- APK 由 Android job 构建后，先排除 unsigned 产物并通过 `apksigner verify --verbose` 校验，再上传到 GitHub Release

## 验收标准

- Release 页面包含 Windows 安装包。
- Release 页面包含 `latest.json`。
- 应用内进入“设置 > 应用更新”后能发现高于当前版本的新版本，并展示 GitHub Releases 摘要。
- 更新下载前后不暴露签名私钥或 API Key。
- 更新失败时应用仍保留当前版本和本地数据。

## 边界

- 一键更新只面向正式发布版本。
- 开发构建不作为 updater 验收对象。
- 不把签名私钥提交到仓库。
- 不在应用内静默安装未知来源更新。
