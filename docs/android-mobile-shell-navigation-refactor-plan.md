# Android 移动端壳层与导航改造方案

## 背景

当前 Android 版已经可以进入应用主界面，但顶部壳层和侧边导航仍带有明显桌面端痕迹。用户截图中暴露出两类问题：

- 顶部区域曾出现最小化、最大化、关闭等桌面窗口控制按钮，和 Android 系统状态栏、应用标题栏挤在一起。
- 移动端侧边抽屉已经能打开，但抽屉和底层内容的层级不够清楚，遮罩偏弱，导航项仍像桌面侧栏卡片，导致阅读和点击焦点不稳定。

本方案只处理 Android / 窄屏下的应用外壳、顶部栏和主导航抽屉，不重写各业务页面，也不涉及 Android APK 签名、版本号或发布链路。发布链路问题已由 `android-release-signing-fix-plan.md` 单独覆盖。

## 当前判断

### 已有基础

代码中已经具备移动端导航的基本骨架：

- `src/App.tsx` 使用 `isMobileSidebarOpen` 控制 `mobile-sidebar-open` 状态。
- `src/App.tsx` 已有 `.sidebar-scrim`、`.mobile-sidebar-trigger`、`.mobile-sidebar-close`。
- `src/styles.css` 在 `@media (max-width: 980px)` 下将 `.sidebar` 改为 fixed 抽屉。
- `src/components/AppTitleBar.tsx` 独立承载桌面窗口拖拽和窗口控制按钮。

因此第一版不需要引入新的 UI 框架，也不需要重写导航数据结构。更合理的方向是拆清“桌面窗口壳层”和“移动端应用壳层”，在现有结构上收敛样式和平台分流。

### 主要问题

1. `AppTitleBar` 是桌面窗口概念，不应该在 Android 上继续展示。
2. 窄屏布局仍以固定 `40px` 顶部行作为基础，没有明确处理 Android 状态栏安全区。
3. 抽屉背景透明感偏强，打开后底层页面仍然形成视觉干扰。
4. 侧边导航项在移动端过于卡片化，选中项面积和强调程度偏重。
5. 抽屉打开时需要明确禁止底层滚动和误触。
6. 关闭按钮、遮罩、返回焦点等交互规则需要统一。

### 当前代码触点

后续实现应优先收敛以下位置，避免散落到业务页面：

| 文件 | 当前职责 | 改造关注点 |
| --- | --- | --- |
| `src/App.tsx` | 壳层 DOM、导航状态、主工作区渲染 | 增加 `isAndroidShell` / `isMobileShell` 派生状态；控制 `<AppTitleBar />` 条件渲染；点击叶子导航项后关闭移动抽屉 |
| `src/components/AppTitleBar.tsx` | 桌面窗口拖拽与窗口控制 | 保持桌面专属，不承载 Android 顶部栏 |
| `src/styles.css` | 全局壳层、侧栏、topbar、移动端媒体查询 | 增加 safe area 变量；收敛 `.topbar`、`.sidebar`、`.sidebar-scrim`、`.nav-item` 移动端样式 |
| `src/App.test.ts` | 侧栏折叠和导航状态测试 | 补 Android shell / mobile drawer 行为测试 |
| `tests/e2e/app-smoke.spec.ts` | 端到端主流程 | 增加移动 viewport 下顶部栏和抽屉回归检查 |

不要把 Android 适配写进 `ReadingHubPage`、`BookshelfPage`、`SettingsPage` 等业务页面。业务页只消费壳层提供的可用空间。

## 用户视角

理想状态下，Android 用户看到的是一个正常移动应用，而不是缩小后的桌面应用：

1. 打开应用后，内容从系统状态栏下方开始，不被摄像头孔、状态栏或系统手势区遮挡。
2. 顶部只看到移动端应用栏：左侧菜单按钮，中间或左侧当前页面标题，必要时右侧保留轻量操作。
3. 点击菜单按钮后，左侧抽屉覆盖出来，右侧有明确遮罩，底层内容变暗且不可操作。
4. 导航项像移动端菜单列表，用户能快速点击目标页面，而不是在卡片堆里辨认。
5. 点击遮罩、关闭按钮或选择菜单项后，抽屉关闭，并回到当前页面。

用户不需要知道桌面端有可折叠侧栏、窗口拖拽区或 Tauri 窗口控制。Android 版只需要符合移动端导航习惯。

## 设计原则

### 1. 平台壳层分离

桌面端和 Android 端共享业务页面，但不共享窗口壳层语义。

- 桌面端：保留 `AppTitleBar`、窗口控制按钮、可折叠侧边栏。
- Android / 窄屏端：隐藏桌面 titlebar，使用移动端 app bar 和 modal drawer。

### 2. 主导航仍是侧边抽屉

第一版不引入底部 TabBar。当前应用导航项较多，并且存在 `书架`、`复盘` 等二级菜单，底部 TabBar 容易造成信息被截断或入口取舍争议。

推荐继续使用左侧 modal drawer：

- 适合多入口应用。
- 可复用现有 `navigationItems`、`shelfSubItems`、`readingReviewSubItems`。
- 不改路由体系，风险小。

### 3. 移动端导航项降噪

移动端抽屉里的导航项应是稳定 row，而不是桌面卡片。

- 图标、标题、短说明横向排列。
- 选中态用左侧细条、轻背景或文字颜色表达。
- 避免大面积高亮卡片和过重阴影。
- 二级菜单缩进即可，不再制造新的卡片层级。

### 4. 遮罩负责明确层级

抽屉打开时，用户应该立刻知道“当前在导航层”。

- 抽屉本体接近不透明。
- 右侧遮罩足够明显。
- 遮罩可点击关闭。
- 底层页面不能滚动、不能被点击。

## 信息架构

移动端壳层建议拆成三个区域：

```text
Android / narrow shell
├─ system safe area
├─ mobile app bar
│  ├─ menu trigger
│  ├─ current view title
│  └─ optional page action slot
├─ modal navigation drawer
│  ├─ brand compact header
│  ├─ primary nav rows
│  ├─ secondary nav rows
│  └─ local privacy note
└─ workspace content
```

桌面端仍维持：

```text
Desktop shell
├─ AppTitleBar
├─ sidebar
└─ workspace
   └─ topbar
```

这两套壳层可以共享导航数据和页面渲染函数，但不应共享所有 CSS 布局假设。

## 顶部栏改造方案

### 1. Android 隐藏 `AppTitleBar`

`AppTitleBar` 中的最小化、最大化、关闭是桌面窗口操作。Android 上展示这些按钮会让用户误判应用形态，也可能与系统状态栏冲突。

建议增加平台判断：

- 优先使用 Tauri 平台能力或 user agent 判断 Android。
- 桌面端渲染 `<AppTitleBar />`。
- Android 端不渲染 `<AppTitleBar />`。

第一版可将判断封装为轻量函数，例如：

```ts
function isAndroidRuntime() {
  return /Android/i.test(navigator.userAgent);
}
```

后续如需要更严谨，可再接入 Tauri OS 插件能力。不要为了这个判断引入复杂平台服务。

### 2. 移动端 app bar 使用安全区

移动端顶部栏需要考虑状态栏高度：

```css
.app-frame {
  --mobile-safe-top: env(safe-area-inset-top, 0px);
}
```

Android / 窄屏下：

- 顶部栏高度使用 `calc(var(--mobile-safe-top) + 52px)`。
- 顶部栏内部内容使用 `padding-top: var(--mobile-safe-top)`。
- 抽屉和遮罩的 top 与高度也跟随同一变量。

这样可以避免内容顶到状态栏，也能兼容异形屏。

### 3. 顶部标题聚焦当前页面

移动端 app bar 只表达当前上下文：

- 左侧：菜单按钮。
- 主体：当前页面标题，例如 `书架`、`阅读报告`、`本书指南`。
- 副标题默认不展示，避免两行标题挤压首屏。

如果需要展示 `activeItem.description`，建议放进抽屉导航项或页面内容，不放在移动端顶部栏。

## 侧边抽屉改造方案

### 1. 抽屉本体

建议移动端样式：

- `width: min(320px, calc(100vw - 56px))`
- `background: var(--paper)` 或接近不透明的面板色
- `box-shadow: 24px 0 48px rgba(...)`
- `border-right: 1px solid var(--line)`
- `top: calc(var(--mobile-safe-top) + 52px)` 或覆盖到安全区下方

如果希望抽屉从屏幕最顶部覆盖，可让抽屉自身处理 `padding-top: var(--mobile-safe-top)`。第一版建议从 app bar 下方开始，认知更稳。

### 2. 遮罩

遮罩需要明显表达 modal 状态：

- 使用 `rgba(15, 23, 42, 0.42)` 或与现有主题匹配的深色透明层。
- `position: fixed` 覆盖 app bar 下方到屏幕底部。
- `pointer-events` 只在打开时启用。
- 点击关闭抽屉。

深色主题下可以略微提高遮罩透明度，但不要让底层文本穿透到影响抽屉阅读。

### 3. 导航项

移动端 `.nav-item` 和 `.nav-subitem` 应降级为菜单 row：

- 高度稳定，建议主项 `48px-56px`。
- border radius 保持 `8px` 以内。
- 图标固定宽度。
- 标题单行，说明可单行或在窄屏隐藏。
- 选中态用轻背景和左侧强调条，不使用厚重卡片阴影。

建议移动端选中态：

```css
.nav-item.is-active {
  background: rgba(...);
  color: var(--ink);
}

.nav-item.is-active::before {
  width: 3px;
}
```

不要让选中项在视觉上变成业务内容卡片，否则会和页面卡片抢层级。

### 4. 关闭与返回焦点

抽屉关闭方式：

- 点击遮罩关闭。
- 点击右上角关闭按钮关闭。
- 点击叶子导航项后关闭。
- 按 `Escape` 关闭，桌面浏览器调试时也有效。

关闭后焦点回到菜单按钮，避免键盘和读屏用户丢失位置。

## 平台分流策略

第一版建议组合使用“视口 + 运行平台”：

- `isNarrowViewport`：决定是否使用 modal drawer。
- `isAndroidRuntime`：决定是否隐藏桌面 titlebar、启用移动端安全区规则。

这样可以覆盖两种场景：

- Android 平板横屏：仍然隐藏桌面窗口控制，但可根据宽度决定导航形态。
- 桌面浏览器窄宽调试：可测试抽屉，但仍可保留桌面 titlebar，除非明确模拟 Android。

不要仅用 `max-width` 判断 Android，否则桌面缩窗会误隐藏窗口控制。

### 推荐判定规则

第一版可以在前端用轻量判定，不新增 Tauri 插件：

```ts
const isAndroidRuntime =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
const isNarrowViewport =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 980px)").matches;
```

落到壳层 class：

```tsx
<div
  className={`app-frame ${isAndroidRuntime ? "android-shell" : ""} ${
    isNarrowViewport ? "mobile-shell" : ""
  }`}
>
```

注意：

- `android-shell` 只负责隐藏桌面窗口控制、启用 Android 安全区。
- `mobile-shell` 只负责窄屏布局、modal drawer 和移动导航密度。
- Android 平板横屏可能是 `android-shell` 但不是 `mobile-shell`。
- 桌面窄屏可能是 `mobile-shell` 但不是 `android-shell`。

## 技术实现建议

### 1. 壳层状态

保留现有状态：

- `isSidebarCollapsed`
- `isMobileSidebarOpen`

新增轻量派生：

- `isAndroidShell`
- `isMobileShell`

其中：

- `isAndroidShell` 只处理平台差异。
- `isMobileShell` 只处理布局差异。

### 2. DOM 结构

建议最小改动：

- `<AppTitleBar />` 增加条件渲染。
- `.app-frame` 增加 `android-shell` 或 `mobile-shell` class。
- 继续复用现有 `<aside className="sidebar">`。
- 继续复用现有 `.sidebar-scrim`。
- 现有 `.topbar` 在移动端改造成 app bar，而不是新增第二个 header。

这样可以避免重复维护两份导航 DOM。

建议导航函数统一收口：

- `handleNavigate` 内部在 `isMobileShell` 时关闭抽屉。
- `handleOpenShelfTab` / `handleOpenReadingReviewTab` 选择最终页面时关闭抽屉。
- 仅展开二级菜单时不关闭抽屉，避免用户刚点开分组就被打断。

### 3. 滚动锁定

抽屉打开时，给壳层增加样式约束：

```css
.app-frame.mobile-sidebar-open .workspace {
  overflow: hidden;
}
```

如果页面内部有独立滚动容器，需要在 `body` 或根节点补一层 `overscroll-behavior: contain`。第一版优先控制 `.workspace`，必要时再补 body class。

### 4. 主题适配

暗色主题下不要只调遮罩，抽屉本体也要保持足够不透明：

- 亮色：抽屉接近 `var(--paper)`。
- 暗色：抽屉接近暗色面板，不显示底层页面文字。
- 按钮 hover / active 与桌面端共享 token，但移动端间距单独设定。

## CSS 落点建议

### 1. 壳层变量

建议在 `.app-frame` 定义移动端安全区变量：

```css
.app-frame {
  --mobile-safe-top: env(safe-area-inset-top, 0px);
  --mobile-appbar-height: 52px;
}
```

Android 壳层再覆写 grid：

```css
@media (max-width: 980px) {
  .app-frame.android-shell {
    grid-template-rows:
      calc(var(--mobile-safe-top) + var(--mobile-appbar-height))
      minmax(0, 1fr);
  }
}
```

如果实测 Tauri Android WebView 的 `safe-area-inset-top` 始终为 `0px`，不要在业务页补 padding。应统一在壳层追加 Android 专用 fallback，例如 `--mobile-safe-top: 24px`，并在真机验证后决定是否保留。

### 2. `AppTitleBar` 隐藏规则

不要只用 CSS 隐藏窗口按钮。推荐直接在 `App.tsx` 条件渲染：

```tsx
{!isAndroidShell ? <AppTitleBar /> : null}
```

CSS 可作为兜底：

```css
.app-frame.android-shell .app-titlebar {
  display: none;
}
```

### 3. 移动端顶部栏

移动端 `.topbar` 建议收敛到一行：

- `min-height: var(--mobile-appbar-height)`
- `padding-top: var(--mobile-safe-top)` 只在 Android shell 生效。
- `.section-kicker` 在移动端隐藏。
- `h2` 单行省略，不换行挤压按钮。

### 4. 抽屉层级

移动端抽屉和遮罩建议使用明确 z-index 层级：

| 层级 | 建议 z-index | 元素 |
| --- | ---: | --- |
| app bar | 25 | `.topbar` |
| scrim | 35 | `.sidebar-scrim` |
| drawer | 40 | `.sidebar` |
| modal | 60+ | 设置弹窗、确认弹窗 |

设置弹窗应高于抽屉；如果设置弹窗打开时再打开抽屉，优先禁止抽屉触发，避免两个 modal 竞争焦点。

## 交互细节

### 1. 打开抽屉

触发条件：

- 点击 `.mobile-sidebar-trigger`。
- `aria-expanded` 从 `false` 变为 `true`。
- `.app-frame` 增加 `mobile-sidebar-open`。
- 焦点可移动到抽屉关闭按钮或第一个导航项。

### 2. 关闭抽屉

关闭条件：

- 点击 `.sidebar-scrim`。
- 点击 `.mobile-sidebar-close`。
- 点击最终导航项。
- 按 `Escape`。
- Android 系统返回键后续如接管，也只在抽屉打开时关闭抽屉。

关闭后：

- `.app-frame` 移除 `mobile-sidebar-open`。
- 焦点回到 `.mobile-sidebar-trigger`。
- 底层滚动恢复。

### 3. 二级菜单

`书架`、`复盘` 这类有子项的主导航：

- 第一次点击只展开 / 收起二级菜单。
- 点击二级菜单叶子项才关闭抽屉并切换页面。
- 当前页面所在分组默认展开，避免用户进入抽屉后找不到当前位置。

## 分阶段实施计划

### Phase 1：壳层分离

目标：Android 不再出现桌面窗口控制。

改动：

- 在 `App.tsx` 增加 `isAndroidShell`。
- Android 下不渲染 `<AppTitleBar />`。
- `.app-frame` 增加 `android-shell` class。

验收：

- Android 顶部没有最小化、最大化、关闭按钮。
- 桌面端窗口按钮仍可用。

### Phase 2：移动 app bar 与 safe area

目标：顶部栏符合移动端视觉，不顶到状态栏。

改动：

- 增加 `--mobile-safe-top`、`--mobile-appbar-height`。
- 移动端 `.topbar` 单行化。
- 移动端隐藏 `.section-kicker`。

验收：

- Android 竖屏首屏标题不被状态栏遮挡。
- 长页面标题不会挤压菜单按钮。

### Phase 3：抽屉视觉和交互收口

目标：抽屉像 modal drawer，而不是透明桌面侧栏。

改动：

- 强化 `.sidebar` 背景、阴影、尺寸。
- 强化 `.sidebar-scrim` 遮罩。
- 移动端 `.nav-item` / `.nav-subitem` 改成 row 密度。
- 点击叶子项自动关闭抽屉。

验收：

- 抽屉文字清晰。
- 底层页面不可点击。
- 选中态不过度卡片化。

### Phase 4：回归测试和真机验收

目标：桌面与 Android 行为都稳定。

改动：

- 补组件测试。
- 补移动 viewport e2e。
- 用 Android APK 真机检查。

验收：

- 桌面端不回归。
- Android 竖屏 / 横屏均可用。

## 测试计划

### 单元 / 组件测试

可补充以下断言：

- Android shell 下不渲染 `.app-window-controls`。
- 菜单按钮点击后 `.mobile-sidebar-open` 生效。
- 点击 `.sidebar-scrim` 后抽屉关闭。
- 点击叶子导航项后抽屉关闭。
- `aria-expanded` 与抽屉状态一致。

### 视觉回归检查

需要至少检查：

- Android 竖屏：360 x 800。
- Android 大屏：412 x 915。
- Android 横屏：800 x 360。
- 桌面窄屏调试：390 x 844。
- 桌面正常宽度：1440 x 900。
- 桌面折叠侧栏状态：1440 x 900 + `sidebar-collapsed`。

重点确认：

- 顶部没有桌面窗口控制按钮。
- 标题不与状态栏重叠。
- 抽屉文字清晰，不受底层页面干扰。
- 遮罩和抽屉层级正确。
- 桌面端 titlebar 和可折叠侧栏不回归。

### 可访问性检查

- 菜单按钮有明确 `aria-label`。
- `aria-expanded` 跟随抽屉状态。
- 抽屉关闭按钮有明确 `aria-label`。
- 抽屉打开时键盘焦点不落到底层页面。
- `Escape` 能关闭抽屉。
- 当前导航项使用 `aria-current="page"`。

### 真机检查

Android APK 安装后检查：

- 冷启动首屏。
- 进入书架、复盘、阅读指南、设置弹窗。
- 打开和关闭主导航抽屉。
- 横竖屏切换。
- 系统返回键行为是否符合预期。

系统返回键第一版可以先不接管；若抽屉打开时按返回键没有关闭抽屉，再补 Android back 事件处理。

### 发布前检查

- 若本改造随新版本发布，需要同步更新 `README.md` 的 Android 说明。
- 若已有版本说明 JSON，例如 `docs/release-notes-v*.json`，需要在发布前补充 Android UI 修复项。
- 真机截图建议保存到 `docs/assets/`，命名包含版本和设备尺寸，便于后续对比。

## 验收标准

- Android 顶部不再出现最小化、最大化、关闭按钮。
- Android 内容不顶到状态栏，顶部留白稳定。
- 移动端 app bar 只展示菜单按钮和当前页面标题。
- 抽屉打开后，右侧遮罩明确且可点击关闭。
- 抽屉本体不透明，文字不与底层页面混在一起。
- 抽屉打开时底层页面不可滚动、不可误触。
- 导航项在移动端呈现为菜单 row，选中态不过度卡片化。
- 点击叶子导航项后，抽屉自动关闭。
- 桌面端 `AppTitleBar`、窗口控制和侧栏折叠能力保持不变。

## 暂不解决的问题

- 设置页保存按钮卡住属于本地命令 / 凭据存储链路问题，不纳入本壳层文档。
- Android APK 签名、覆盖安装、版本号递增仍由发布文档负责。
- 业务页面内部移动端密度，例如阅读指南卡片、统计图表、设置弹窗内容布局，只在发现严重溢出时另开专项。
- Android 系统返回键接管只作为后续增强，不阻塞第一版 UI 修复。

## 非目标

- 不重写全部页面移动端布局。
- 不调整阅读指南、复盘、书架等业务模块的信息架构。
- 不新增底部 TabBar。
- 不引入新的 UI 框架或导航库。
- 不修改 Android 发布签名链路。
- 不处理应用内自动更新。
- 不为所有页面单独设计移动端专属 header action。

## 实施步骤

1. 增加平台判断与壳层 class，区分 Android shell 和普通桌面 shell。
2. Android 下隐藏 `AppTitleBar`，移动端顶部栏使用 safe area。
3. 收敛移动端 `.topbar`，只保留菜单按钮和当前页面标题。
4. 强化 `.sidebar` 移动端抽屉样式，确保本体不透明、尺寸稳定。
5. 强化 `.sidebar-scrim` 遮罩层级，并补充点击关闭规则。
6. 调整移动端 `.nav-item` / `.nav-subitem` 为菜单 row。
7. 抽屉打开时锁定底层滚动和误触。
8. 补充组件测试与 Android 真机验收记录。

## 风险与注意事项

- 不要把移动端样式直接覆盖到桌面端 `.sidebar`，否则会破坏桌面侧栏密度。
- 不要只通过 `max-width` 隐藏窗口控制，桌面缩窗仍需要窗口按钮。
- 不要让抽屉背景继续使用高透明度，否则用户会觉得导航和页面混在同一层。
- 不要在移动端顶部展示两行标题和说明，首屏高度会被无意义挤占。
- 不要把系统返回键行为一次做复杂；先保证抽屉视觉和点击闭环，再按真机表现补齐返回键关闭。

## 原则应用

- KISS：复用现有 `App.tsx` 壳层和导航数据，只补平台分流与移动端样式。
- YAGNI：第一版不做底部 TabBar、不做新导航库、不重写业务页面。
- DRY：桌面端和移动端共享导航数据，避免维护两套路由入口。
- SOLID：将平台判断、壳层布局和业务页面渲染职责拆开，避免业务页面承担 Android 窗口适配逻辑。
