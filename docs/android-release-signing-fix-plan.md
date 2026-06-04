# Android Release Signing Fix Plan

## 背景

`v1.0.4` 的 Windows 发布链路已经可用，Release 中包含 Windows 安装包、`.sig` 和 `latest.json`。

Android 资产无法正常安装，Release 页面实际上传的是：

```text
app-universal-release-unsigned.apk
```

这类 `unsigned` APK 不是正式可安装包，Android 系统会在安装阶段拒绝。当前问题不是用户手机权限或“未知来源安装”本身，而是发布产物不符合 Android 安装要求。

## 修复前判断

### 已确认事实

- `.github/workflows/release.yml` 中有 `Configure Android signing` 步骤，会写入 `src-tauri/gen/android/keystore.properties`。
- `src-tauri/gen/android/app/build.gradle.kts` 的 `release` build type 没有配置 `signingConfigs`。
- 仓库内没有读取 `keystore.properties` 并绑定到 `release.signingConfig` 的 Gradle 逻辑。
- APK 上传脚本使用 `find src-tauri/gen/android -name '*.apk' | head -n 1`，可能直接选中 unsigned 包。
- `src-tauri/gen/android/app/tauri.properties` 仍显示 `versionName=1.0.1`、`versionCode=1000001`，和应用发版号 `1.0.4` 不一致。

### 主要根因

1. CI 生成了 keystore 文件，但 Android Gradle release 构建没有使用它。
2. 上传逻辑没有排除 unsigned APK，也没有强制要求 signed/release APK。
3. Android `versionCode` 没有随发布递增，修好签名后仍可能出现覆盖安装失败。

## 目标

1. Release 中上传可安装的签名 APK。
2. CI 在找不到签名 APK 时直接失败，不再上传 `*-unsigned.apk`。
3. Android `versionName` 与应用版本一致，`versionCode` 每次发版递增。
4. 发布后可通过本地或 CI 检查证明 APK 已签名、可安装。

## 非目标

- 不接入 Google Play。
- 不实现 Android 应用内静默更新。
- 不把 Android 更新伪装成 Windows Tauri updater。
- 不在仓库提交 keystore、密码或私钥。
- 不在本阶段做复杂 ABI 拆包策略；优先保证 universal APK 可安装。

## 当前实施状态

本轮补丁已经落地以下改动：

1. `src-tauri/gen/android/app/build.gradle.kts` 读取 `src-tauri/gen/android/keystore.properties`，release 构建需要同时具备 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。
2. 本地 debug 配置不依赖 keystore；release task 缺少签名配置时应失败，避免继续发布 unsigned APK。
3. `.github/workflows/release.yml` 的 Android job 改为显式要求 `ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_BASE64`。
4. CI 会从 release tag 自动写入 `tauri.android.versionName` 与 `tauri.android.versionCode`，例如 `v1.0.5` 对应 `1.0.5` / `1000005`。
5. 上传 APK 前会排除 `*unsigned*` 文件，并用 `apksigner verify --verbose` 校验签名。

本地已验证：

- `npm run build` 通过。
- `src-tauri/gen/android/gradlew.bat :app:tasks --all --no-daemon` 通过，说明 Android Gradle 配置可解析。

本地未完成完整 release APK 构建验证，因为当前机器没有配置 Android SDK 路径；线上 workflow 已包含 `Setup Android SDK`，最终验收仍应以 CI 产物和真机安装为准。

## 修复方案

### 1. 统一 Android 签名配置

在 `src-tauri/gen/android/app/build.gradle.kts` 中增加 release signing config。

建议读取 `src-tauri/gen/android/keystore.properties`，字段统一为 Android Gradle 常见命名：

```properties
storeFile=/path/to/upload-keystore.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Gradle 侧：

```kotlin
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    signingConfigs {
        create("release") {
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

注意：如果本地开发没有 keystore，不应影响 debug 构建。release 构建找不到 keystore 时应该失败，而不是产出 unsigned 包。

### 2. 修正 GitHub Actions secrets 写入

当前 workflow 写入的是：

```bash
printf 'keyAlias=%s\n' "${{ secrets.ANDROID_KEY_ALIAS }}" > src-tauri/gen/android/keystore.properties
printf 'password=%s\n' "${{ secrets.ANDROID_KEY_PASSWORD }}" >> src-tauri/gen/android/keystore.properties
base64 -d <<< "${{ secrets.ANDROID_KEY_BASE64 }}" > "$RUNNER_TEMP/upload-keystore.jks"
printf 'storeFile=%s\n' "$RUNNER_TEMP/upload-keystore.jks" >> src-tauri/gen/android/keystore.properties
```

建议改为：

```bash
printf 'keyAlias=%s\n' "$ANDROID_KEY_ALIAS" > src-tauri/gen/android/keystore.properties
printf 'keyPassword=%s\n' "$ANDROID_KEY_PASSWORD" >> src-tauri/gen/android/keystore.properties
printf 'storePassword=%s\n' "$ANDROID_STORE_PASSWORD" >> src-tauri/gen/android/keystore.properties
printf '%s' "$ANDROID_KEY_BASE64" | base64 -d > "$RUNNER_TEMP/upload-keystore.jks"
printf 'storeFile=%s\n' "$RUNNER_TEMP/upload-keystore.jks" >> src-tauri/gen/android/keystore.properties
```

- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_BASE64`

第一版显式使用 `ANDROID_STORE_PASSWORD`，减少 CI 表达式歧义。即使 store password 和 key password 相同，也建议配置成两个 secret。

### 3. 强制上传签名 APK

当前上传逻辑过宽：

```bash
APK_PATH="$(find src-tauri/gen/android -name '*.apk' | head -n 1)"
```

已改为：

```bash
APK_PATH="$(find src-tauri/gen/android -name '*.apk' ! -name '*unsigned*' | sort | head -n 1)"
```

并增加防呆：

```bash
if [[ "$APK_PATH" == *unsigned* ]]; then
  echo "Refusing to upload unsigned APK: $APK_PATH"
  exit 1
fi
```

更稳妥的做法是明确匹配 release 产物目录和文件名，避免以后目录里出现多个 APK 时选错。

### 4. 同步 Android 版本号

需要让 Android 版本号随发布递增：

```properties
tauri.android.versionName=1.0.5
tauri.android.versionCode=1000005
```

建议约定：

- `versionName` 等于应用版本，例如 `1.0.5`。
- `versionCode` 使用可读递增规则，例如 `major * 1000000 + minor * 1000 + patch`。
- `1.0.5` 对应 `1000005`。

后续每次发布检查清单必须包含 Android 版本号同步。

### 5. 加入 APK 签名校验

CI 构建后、上传前增加校验步骤。

已加入校验命令：

```bash
apksigner verify --verbose "$APK_PATH"
```

验收要求：

- `apksigner verify` 成功。
- 输出显示 APK 已签名。
- 文件名不包含 `unsigned`。

### 6. 补发策略

建议发 `v1.0.5`，不要修改 `v1.0.4` tag。

原因：

- `v1.0.4` 的 Windows updater `latest.json` 已经公开。
- 替换同 tag 资产容易造成用户侧缓存和 Release 资产不一致。
- Android `versionCode` 需要递增，发新版本更清晰。

`v1.0.5` release notes 应明确：

- 修复 Android APK 未签名导致无法安装的问题。
- Windows 侧无功能变化或仅同步补丁说明。
- Android APK 现在为签名 release 包。

## 实施顺序

1. 已修改 Android Gradle release signing 配置。
2. 已修改 GitHub Actions keystore 写入字段。
3. 已修改 APK 上传脚本，排除 unsigned 并校验签名。
4. 已在 CI 中同步 Android `versionName/versionCode` 到 release tag。
5. 已完成本地基础构建检查。
6. 待确认 GitHub Secrets。
7. 待推送修复提交。
8. 待创建 `v1.0.5` tag。
9. 待 Release 完成后确认资产列表不再包含 `unsigned.apk`。
10. 待在 Android 手机上安装验证。

## 验收标准

- Release 资产中没有 `app-universal-release-unsigned.apk`。
- Release 资产中存在签名后的 APK。
- `apksigner verify --verbose` 通过。
- Android 设备可首次安装。
- Android 设备可从旧版本覆盖安装，前提是签名证书一致且 `versionCode` 更高。
- Windows `latest.json` 仍可访问，Windows updater 不受 Android 修复影响。

## 风险与注意事项

- 如果 `ANDROID_KEY_BASE64` 对应的 keystore 和旧版安装包不是同一签名证书，覆盖安装会失败，只能卸载旧版后安装。
- 如果用户已经装过 unsigned/debug 包，正式签名包覆盖安装也可能失败，需要卸载旧包。
- 如果 `versionCode` 没有递增，Android 会提示无法安装或版本降级。
- 如果 Release 同时保留 unsigned 和 signed APK，用户仍可能下载错文件，因此必须从发布资产中移除 unsigned APK 或让 CI 根本不上传。

## 待确认问题

1. GitHub Secrets 中是否已经有可用的正式 Android keystore？
2. `ANDROID_STORE_PASSWORD` 是否已配置？即使它和 `ANDROID_KEY_PASSWORD` 相同，当前 workflow 也需要显式配置。
3. 是否要保留 Android APK 发布？如果手机端不是主场景，也可以先从 release workflow 中移除 Android job，避免误导用户下载不可用包。
4. 是否需要为 Android 单独写安装说明，明确“不要下载 unsigned 包”。
