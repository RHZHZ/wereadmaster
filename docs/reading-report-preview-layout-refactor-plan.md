# 阅读报告预览布局改造方案

## 结论

需要改造。

当前“阅读报告生成”的预览步骤中，竖版海报在预览容器内明显偏右。轮播报告和 16:9 报告虽然没有完全相同的偏移根因，但它们也共享同一个外层预览容器，如果只修竖版海报，容易留下三种预览模式视觉重心不一致的问题。

本次建议做一次小范围布局改造：不重做报告模板、不改导出数据、不调整报告生成流程，只收敛预览区域的居中、缩放、滚动和移动端适配规则。

## 当前问题

### 1. 竖版海报视觉重心偏右

截图中预览容器本身大致居中，但海报成品落在容器右侧，左侧留下大面积空白。用户会误以为左侧还有未加载的配置面板，或认为预览区域排版缺失。

直接影响：

- 预览不是视觉主角。
- `下载 PNG` 前的检查效率下降。
- 桌面端大屏空间没有被合理使用。

### 2. 缩放实现存在布局偏移风险

当前相关结构在 `ReportGenerationWizardDialog` 中：

```tsx
<div className="monthly-report-poster-scale-frame">
  <PeriodReportPoster data={data!} />
</div>
```

当前相关样式：

```css
.monthly-report-poster-scale-frame {
  width: var(--monthly-report-poster-preview-width, 720px);
  height: var(--monthly-report-poster-preview-height, 960px);
}

.monthly-report-poster-preview-shell.is-poster .monthly-report-poster-scale-frame > .monthly-report-poster {
  width: 720px;
  max-width: none;
  transform: scale(var(--monthly-report-poster-preview-scale, 1));
  transform-origin: top center;
}
```

问题在于：

- 外层 frame 使用的是缩放后的宽高。
- 内层海报仍按原始 `720px` 布局。
- `transform-origin: top center` 会以原始 720px 的中心点作为缩放中心。
- 当 frame 已经变窄时，海报视觉中心会落到 frame 右侧，最终造成右偏。

因此，这不是单纯给 shell 加 `justify-content: center` 就能稳定解决的问题。

### 3. 轮播报告需要单独定义“居中”

轮播报告不是单张海报，它包含：

- 当前故事卡片。
- 左右切换按钮。
- 缩略图 / 页面导航。
- 桌面端说明栏。

因此轮播报告的居中标准不是“某一张卡居中”，而是“整组报告预览区域居中，同时主卡片是视觉主角”。

如果简单套用竖版海报缩放规则，可能导致：

- 缩略图轨道被压缩。
- 主卡片和右侧导航权重失衡。
- 移动端左右栏过窄。

### 4. 16:9 报告需要尽量吃满横向空间

16:9 报告的核心价值是横向结构化展示。它应该在预览区中居中并尽可能放大，而不是贴在右侧或被过度缩小。

移动端上 16:9 天然会变矮，预览更适合检查整体构图，不适合阅读全部细节。第一版不建议增加复杂的放大查看器，先保证：

- 不横向溢出。
- 居中显示。
- 操作按钮不遮挡预览。
- 横版报告在可用宽度内尽量大。

## 改造目标

1. 统一预览区域视觉重心

- 三种预览模式都应在弹窗内容区内居中。
- 预览主体不应靠右或靠左。
- 空白区域应作为视觉留白，而不是造成“缺内容”的误解。

2. 按预览类型设置不同布局策略

- 竖版海报：优先完整可见，缩放后严格居中。
- 轮播报告：整组居中，主卡片突出，缩略图轨道可用。
- 16:9 报告：横向尽量放大，保持 16:9 比例和可读性。
- 长期复盘 16:9：复用横版报告规则，不引入额外分支。

3. 保持实现简单

- 不引入新组件库。
- 不新增复杂拖拽、缩放、全屏查看器。
- 不改变现有报告数据模型。
- 不修改 PNG 导出逻辑，除非发现预览与导出参数已经不一致。

4. 移动端可用性优先

- 预览居中。
- 主要操作按钮不遮挡预览。
- 轮播缩略图在移动端下置并横向滚动。
- 16:9 报告不产生横向页面滚动。
- 底部操作区换行后，预览区仍可独立滚动，不把主体内容挤到不可操作。

## 推荐方案

### 方案 A：修正竖版海报缩放 frame

将竖版海报的缩放原点改为左上角，并让缩放后的视觉宽高与 frame 宽高一致。

推荐方向：

```css
.monthly-report-poster-preview-shell.is-poster .monthly-report-poster-scale-frame > .monthly-report-poster {
  width: 720px;
  max-width: none;
  transform: scale(var(--monthly-report-poster-preview-scale, 1));
  transform-origin: top left;
}
```

保留外层 frame 的缩放后宽高：

```css
.monthly-report-poster-scale-frame {
  width: var(--monthly-report-poster-preview-width, 720px);
  height: var(--monthly-report-poster-preview-height, 960px);
}
```

这样 shell 居中的是缩放后的 frame，海报视觉内容也从 frame 左上角开始缩放，最终不会出现右偏。

### 方案 B：统一外层预览 shell 的居中语义

当前预览 shell 是三种模式共用入口：

```tsx
className={
  isLifetimeReportMode
    ? "monthly-report-poster-preview-shell is-wide lifetime-reading-report-preview-shell"
    : `monthly-report-poster-preview-shell is-${previewMode}`
}
```

建议保留这一结构。基础 shell 只负责滚动和网格容器，各预览模式再分别声明居中，避免把居中规则过宽地作用到未来新增模式：

```css
.monthly-report-poster-preview-shell {
  display: grid;
  min-height: 0;
  overflow: auto;
}

.monthly-report-poster-preview-shell.is-poster,
.monthly-report-poster-preview-shell.is-cards,
.monthly-report-poster-preview-shell.is-wide {
  place-items: center;
}
```

再由模式覆盖具体尺寸：

- `.is-poster`：限制最大宽度，居中显示竖版海报。
- `.is-cards`：整组卡片居中，桌面允许横向结构，移动端改为单列。
- `.is-wide`：横版报告居中，宽度受弹窗宽度和视口高度共同约束。

### 方案 C：轮播报告保持双栏，但移动端单列

桌面端建议保持：

```text
[ 当前故事卡片 ] [ 说明 / 缩略图轨道 ]
```

验收标准：

- `.monthly-report-card-set` 在 shell 内整体居中。
- 主卡片宽度稳定，不被右侧轨道挤压。
- 左右切换按钮不超出预览容器。

移动端建议：

```text
[ 当前故事卡片 ]
[ 横向缩略图轨道 ]
```

当前 CSS 已有 `@media (max-width: 900px)` 的单列方向，后续需要验证它和弹窗高度、底部操作区不会互相挤压。

### 方案 D：16:9 报告优先最大化可视尺寸

横版报告建议继续使用：

```css
.monthly-report-poster-preview-shell.is-wide .monthly-report-wide {
  width: min(1120px, 100%, 103dvh);
}
```

但需要检查两个点：

- shell 自身是否有足够的 inline padding，避免报告边缘贴边。
- 移动端宽度应为 `min(100%, ...)`，不产生横向滚动。

长期复盘：

```css
.monthly-report-poster-preview-shell.is-wide.lifetime-reading-report-preview-shell .lifetime-reading-report-wide {
  width: min(1120px, 100%, 88dvh);
}
```

建议保持长期复盘单独高度约束，因为它的信息密度更高，不应被周期报告的 16:9 规则强行放大。

## 不建议做的事情

1. 不建议新增“预览编辑器”

当前问题是布局和缩放，不是报告内容编辑。新增编辑器会扩大范围，违反 YAGNI。

2. 不建议把轮播报告也强行缩放成单张图

轮播报告有页面导航语义，简单缩放会损害交互可用性。

3. 不建议首轮增加全屏预览

全屏预览可以作为后续增强，但不是修复右偏和移动端可用性的必要条件。

4. 不建议改 PNG 导出实现

除非验证发现导出图也存在偏移，否则本次只修预览布局。预览布局和导出逻辑应低耦合。

## 实施步骤

### 第一步：修正竖版海报偏移

文件：

- `src/styles.css`

改造点：

- 调整 `.monthly-report-poster-preview-shell.is-poster .monthly-report-poster-scale-frame > .monthly-report-poster` 的 `transform-origin`。
- 优先不改 `.monthly-report-poster` 本体，也不默认给 `.monthly-report-poster-scale-frame` 增加 `overflow: hidden`。
- 只有验证发现缩放后装饰层影响布局测量时，才考虑给 frame 增加裁切；如果裁掉阴影或圆角，则放弃裁切。

验收：

- 桌面端竖版海报在预览容器内水平居中。
- 移动端竖版海报不横向溢出。
- 底部按钮不遮挡预览。

### 第二步：统一 shell 居中规则

文件：

- `src/styles.css`

改造点：

- 保持 `.monthly-report-poster-preview-shell` 的基础职责为滚动容器。
- 在 `.is-poster`、`.is-cards`、`.is-wide` 内分别声明居中和尺寸策略。
- 检查 `scrollbar-gutter: stable both-edges` 是否引入视觉偏移；如偏移明显，改为只在需要滚动稳定性的模式启用。

验收：

- 切换 `竖版海报 / 轮播报告 / 16:9 报告` 时，预览主体的视觉中心稳定。
- 空态仍居中显示。
- 移动端底部操作区换行时，预览 shell 仍是可滚动区域。

### 第三步：验证轮播报告

文件：

- `src/features/reading-stats/components/ReportGenerationWizardDialog.tsx`
- `src/styles.css`

原则上不需要改 TSX。只有当 CSS 无法覆盖当前结构时，才调整组件层级。

验收：

- 桌面端轮播报告整组居中。
- 主卡片比缩略图轨道更突出。
- 移动端为单列布局，缩略图横向滚动。
- 左右箭头不越界，不遮挡主要内容。

### 第四步：验证 16:9 和长期复盘

文件：

- `src/styles.css`

验收：

- 周 / 月 / 年的 `16:9 报告` 居中并尽量放大。
- `16:9 长期复盘` 仍保持独立尺寸约束。
- 移动端不产生横向页面滚动。
- 文本不和底部操作区重叠。

### 第五步：补充回归测试

文件：

- `tests/e2e/app-smoke.spec.ts`

建议新增或扩展移动端 / 桌面端阅读报告测试：

- 打开阅读报告生成。
- 进入预览步骤。
- 分别切换 `竖版海报`、`轮播报告`、`16:9 报告`。
- 读取预览主体和 shell 的 bounding box。
- 断言预览主体中心点与 shell 中心点误差在合理范围内。
- 移动端断言无横向溢出，底部按钮可见。

不建议用截图像素做强断言，布局类 e2e 使用 bounding box 更稳定。

建议覆盖视口矩阵：

- `1280 x 720`：桌面常见短视口，验证竖版缩放和底部操作区。
- `1366 x 768`：主流笔记本视口，验证三种预览居中。
- `390 x 844`：移动端竖屏，验证单列、按钮换行和无横向溢出。
- `844 x 390`：移动端横屏短视口，验证弹窗滚动和底部操作可达。

建议补充轻量导出一致性校验：

- 修改预览布局后，至少下载一次竖版 PNG 和 16:9 PNG。
- 确认导出图片尺寸、内容位置和预览模式切换不受预览层 CSS 影响。
- 轮播报告至少验证 `下载当前页` 可用；如改动触及轮播布局，再验证 `下载全部页`。

## 验收标准

### 桌面端

- 竖版海报在预览容器内水平居中。
- 轮播报告整组居中，主卡片清晰可见。
- 16:9 报告在可用宽度内尽量大，且居中。
- 切换预览类型时没有明显跳到右侧的问题。
- 下载按钮区域固定在底部，不遮挡预览。
- 底部操作区高度变化不影响预览区域滚动。

### 移动端

- 弹窗在 390px 宽视口下可完整操作。
- 竖版海报居中且不横向溢出。
- 轮播报告单列展示，缩略图轨道可横向滚动。
- 16:9 报告宽度适配屏幕，不产生页面横向滚动。
- `关闭预览 / 重新选择时间 / 下载` 等按钮仍可点击。
- 844px 横屏短视口下，预览内容和底部操作都可通过弹窗内滚动访问。

## 风险与控制

1. 风险：修正 `transform-origin` 后影响竖版海报阴影显示

控制：

- 只在预览缩放层改样式。
- 不修改 `.monthly-report-poster` 本体。
- 用桌面和移动端截图验证阴影、圆角和装饰层。

2. 风险：统一 shell 居中影响空态布局

控制：

- 保留 `.monthly-report-preview-empty` 的独立宽度和居中规则。
- e2e 覆盖无数据空态或同步中状态。

3. 风险：轮播移动端高度不足

控制：

- 保持 shell 可滚动。
- 缩略图轨道使用横向滚动，不强行压缩主卡片。

4. 风险：16:9 在短视口下过小

控制：

- 继续同时受宽度和高度约束。
- 短视口优先完整可见，读细节不是该状态的主要目标。

## 是否遗漏或过当

### 不遗漏

- 已覆盖竖版海报、轮播报告、16:9 报告和长期复盘 16:9。
- 已覆盖桌面端和移动端。
- 已覆盖预览主体、外层 shell、底部操作区和空态。
- 已包含 e2e 验证建议。

### 不过当

- 不重做报告视觉模板。
- 不改报告生成流程。
- 不改下载 PNG 数据和导出 API。
- 不新增全屏预览、手势缩放、编辑器等大功能。
- 优先通过 CSS 修复，只有必要时才调整 TSX 结构。

## 推荐落地范围

第一版只改：

- `src/styles.css`
- `tests/e2e/app-smoke.spec.ts`

如 CSS 无法稳定解决轮播结构，再最小调整：

- `src/features/reading-stats/components/ReportGenerationWizardDialog.tsx`

这样符合 KISS 和 YAGNI：先修真实布局问题，不借机重构报告系统。

## 文档复核结论

当前方案整体不过当：它没有扩大到报告模板重做、导出链路重写或全屏预览等新能力。

落地时需要特别控制三点：

- 不把基础 shell 的 `place-items: center` 作为无差别全局规则，优先在具体模式类上声明。
- 不默认使用 `overflow: hidden` 裁切缩放 frame，避免裁掉阴影和装饰层。
- 必须把移动端横屏短视口、底部操作区换行和导出一致性纳入验收。

## 落地记录

已完成第一版落地。

实际改动保持在最小范围内：

- `src/styles.css`
  - 将竖版海报预览层的 `transform-origin` 从 `top center` 调整为 `top left`。
  - 将轮播报告预览 shell 的 `justify-items` 从 `stretch` 调整为 `center`，让整组轮播预览居中。
- `tests/e2e/app-smoke.spec.ts`
  - 新增 `阅读报告预览三种形态保持居中且移动端无横向溢出`。
  - 覆盖桌面端 `1366 x 768` 和移动端 `390 x 844`。
  - 分别验证 `竖版海报 / 轮播报告 / 16:9 报告` 的预览主体中心点、横向边界、底部操作区可达和移动端无横向溢出。

未改动内容：

- 未修改报告数据模型。
- 未修改 PNG 下载函数。
- 未修改竖版、轮播、16:9 报告模板内容。
- 未新增全屏预览、缩放手势或编辑器。

验证结果：

- `npx tsc --noEmit` 通过。
- `npm run build` 通过。
- `npx playwright test "tests/e2e/app-smoke.spec.ts" -g "阅读报告预览三种形态保持居中且移动端无横向溢出"` 通过。
- `npx playwright test "tests/e2e/app-smoke.spec.ts" -g "移动端阅读报告生成类型步骤可点击并可滚动|移动端横屏短视口下设置与阅读报告保持可滚动"` 通过。

Browser 插件验证说明：

- 已用 Browser 检查 `http://127.0.0.1:5173` 页面身份、统计页入口、非空渲染和控制台健康。
- Browser 环境没有 e2e 的 Tauri mock，本地统计缓存为空，`生成阅读报告` 按钮处于禁用状态，因此三种预览交互以 Playwright e2e 作为主验收依据。

构建说明：

- 初次 `npm run build` 曾被官网页缺失图片引用阻塞。
- 当前工作区已有的 `website/App.tsx` 改动已将官网图片引用切换到存在的 `src/assets/generated/readme-hero.png` 和 `src/assets/generated/release-cover.png`，重新构建已通过。
- 该官网图片引用修正不是本次报告预览布局改造的核心范围，文档只记录其对构建验证的影响。
