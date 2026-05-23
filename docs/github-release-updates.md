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
- 构建配置已开启 `createUpdaterArtifacts`。
- GitHub Actions 已新增 tag 触发的 Windows 发布流程。
- GitHub Actions 已新增 Android APK 发布流程。
- GitHub 仓库地址已固定为 `RHZHZ/wereadmaster`。
- updater 公钥已写入 `src-tauri/tauri.conf.json`。
- Windows release workflow 会在安装包上传完成后，基于 release 资产地址和本地 `.sig` 文件手工生成 `latest.json`。
- 首次正式发布前仍需把私钥配置到 GitHub Actions Secrets。

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
- APK 由 Android job 构建后，直接上传到 GitHub Release

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
