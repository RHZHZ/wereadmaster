# GitHub Releases 一键更新发布说明

## 目标

正式版本通过 GitHub Releases 分发 Windows 安装包和 Tauri updater 产物。用户在应用设置页侧边栏进入“应用更新”菜单后，应用会先读取配置的更新端点并展示版本信息、更新摘要和发布来源；确认安装后再校验签名并下载更新。

## 当前状态

- 应用内 updater 插件已接入。
- 设置页侧边栏已提供“应用更新”菜单，内部包含“检查更新 / 安装更新”入口。
- 构建配置已开启 `createUpdaterArtifacts`。
- GitHub Actions 已新增 tag 触发的 Windows 发布流程。
- GitHub 仓库地址已固定为 `RHZHZ/wxreadmaster`。
- updater 公钥已写入 `src-tauri/tauri.conf.json`。
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
           "https://github.com/RHZHZ/wxreadmaster/releases/latest/download/latest.json"
         ]
       }
     }
   }
   ```

5. 在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中配置：

   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

   如果私钥没有设置密码，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 可以留空或先不配置。

6. `TAURI_SIGNING_PRIVATE_KEY` 建议填入：

   - `C:\Users\RHZ\.tauri\wxreadmaster.key` 文件全文内容
   - 不要提交到仓库
   - 不要写进 `.env`

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
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. GitHub Actions 会创建 draft release，并上传安装包和 updater 产物。
5. 检查 draft release 中的安装包、`latest.json` 和签名产物。
6. 补充发布说明后发布 release。

## 首次发布建议

建议第一次使用：

1. 标签使用 `v0.1.0` 或 `v0.1.1`。
2. 先发布为 draft release。
3. 下载并安装当前版本。
4. 再推送一个更高版本标签，例如 `v0.1.2`。
5. 在已安装旧版本的应用里进入“设置 > 应用更新”，点击“检查更新”，确认摘要和版本信息无误后执行“安装更新”，验证整条链路。

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
