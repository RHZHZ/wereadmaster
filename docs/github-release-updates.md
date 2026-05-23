# GitHub Releases 一键更新发布说明

## 目标

正式版本通过 GitHub Releases 分发 Windows 安装包和 Tauri updater 产物。用户在应用设置页点击“检查并更新”后，应用从配置的更新端点检查新版本，校验签名后下载并安装。

## 当前状态

- 应用内 updater 插件已接入。
- 设置页已提供“检查并更新”入口。
- 构建配置已开启 `createUpdaterArtifacts`。
- GitHub Actions 已新增 tag 触发的 Windows 发布流程。
- GitHub 仓库地址、updater 公钥和 endpoints 仍需在首次正式发布前填入。

## 首次发布前准备

1. 在 GitHub 创建仓库，并把本地仓库推送到 GitHub。
2. 生成 Tauri updater 签名密钥：

   ```powershell
   npm run tauri signer generate
   ```

3. 把生成的公钥写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
4. 把 GitHub Releases 的更新描述文件地址写入 `plugins.updater.endpoints`。

   推荐格式：

   ```json
   {
     "plugins": {
       "updater": {
         "pubkey": "填入生成的公钥",
         "endpoints": [
           "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
         ]
       }
     }
   }
   ```

5. 在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中配置：

   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

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

## 验收标准

- Release 页面包含 Windows 安装包。
- Release 页面包含 `latest.json`。
- 应用内点击“检查并更新”能发现高于当前版本的新版本。
- 更新下载前后不暴露签名私钥或 API Key。
- 更新失败时应用仍保留当前版本和本地数据。

## 边界

- 一键更新只面向正式发布版本。
- 开发构建不作为 updater 验收对象。
- 不把签名私钥提交到仓库。
- 不在应用内静默安装未知来源更新。
