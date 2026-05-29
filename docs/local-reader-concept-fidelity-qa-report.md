# 本地书库与阅读器概念稿贴合 QA 报告

## 结论

本轮视觉贴合改造可以作为当前阶段验收基线。

- 本地书库宽桌面态已恢复为双列书卡 + 右侧导入区。
- 本地书卡已从统一色块升级为稳定生成的纸质封面。
- 阅读器正文纸面感、侧栏内容层级、选区工具条和 AI 提问详情均已具备稳定截图。
- 右侧划线/想法/AI 列表已改为填满侧栏剩余高度，不再留下无意义的大块死区。
- 划线侧栏卡片已补充固定最小高度、文本截断和日期行布局，长划线摘要下的日期不再越过卡片边界。
- 侧栏当前项增加了更明确的左侧定位条、内收描边和标题强调，定位后更容易看出正文对应的是哪条记录。
- 阅读器临时浮层已补齐键盘关闭和点击关闭/取消后的焦点恢复。
- AI 仍保持“选区提问”边界，不展示假回答。

## 验收范围

### 参考概念稿

- 本地书库：`output/imagegen/local-library-concept.png`
- 本地阅读器：`output/imagegen/local-reader-concept.png`
- AI 提问收纳态：`output/local-reader-ai-question-containment.png`

### 改造后截图

- 本地书库默认桌面：`output/local-library-after-concept-fidelity-default.png`
- 本地书库宽桌面：`output/local-library-after-concept-fidelity-wide.png`
- 阅读器默认桌面：`output/local-reader-after-concept-fidelity-default.png`
- 阅读器宽桌面：`output/local-reader-after-concept-fidelity-wide.png`
- 阅读器选区工具条：`output/local-reader-after-concept-fidelity-selection-toolbar.png`
- 阅读器 AI 提问侧栏：`output/local-reader-after-concept-fidelity-ai-tab.png`
- 阅读器 AI 提问详情：`output/local-reader-after-concept-fidelity-ai-detail.png`
- 阅读器 AI 提问详情概念稿对齐修正：`output/local-reader-ai-detail-concept-aligned-v6.png`
- 阅读器侧栏高度修正：`output/local-reader-after-concept-fidelity-sidebar-filled.png`
- 阅读器划线日期边界修正：`output/local-reader-highlight-date-contained.png`
- 阅读器划线当前定位态：`output/local-reader-highlight-revealed-state.png`
- 阅读器想法当前定位态：`output/local-reader-thought-revealed-state.png`
- 阅读器 AI 提问当前定位态：`output/local-reader-ai-revealed-state.png`
- 阅读器想法长文本卡片边界：`output/local-reader-thought-long-card-boundary.png`
- 阅读器 AI 长问题卡片边界：`output/local-reader-ai-long-card-boundary.png`
- 阅读器密集划线列表：`output/local-reader-sidebar-dense-highlights.png`
- 阅读器密集想法列表：`output/local-reader-sidebar-dense-thoughts.png`
- 阅读器密集 AI 提问列表：`output/local-reader-sidebar-dense-ai.png`
- 阅读器 1280px 默认基线：`output/local-reader-default-1280-baseline.png`
- 阅读器想法 tab 长文本基线：`output/local-reader-thought-tab-long-card-baseline.png`
- 阅读器侧栏当前项增强：`output/local-reader-current-sidebar-state.png`
- 阅读器选区关联卡片边界：`output/local-reader-selection-related-cards-boundary.png`
- 阅读器暗色默认态：`output/local-reader-dark-default.png`
- 阅读器暗色选区关联卡片：`output/local-reader-dark-selection-related-cards.png`

## 对照结果

| 项目 | 概念稿要求 | 当前结果 | 结论 |
| --- | --- | --- | --- |
| 本地书库骨架 | 左侧导航、顶部搜索筛选、双列书卡、右侧导入区 | 1536px 宽桌面成立 | 通过 |
| 书卡封面 | 有书籍资产感 | 本地生成封面具备书脊、内框、格式、色板 | 通过 |
| 书卡密度 | 可扫读，不撑大 | 1280px 保守单列，1536px 双列 | 通过 |
| 导入区 | 独立右侧导入区 | 稳定显示，未承诺假拖拽能力 | 通过 |
| 阅读器正文 | 纸面感，正文优先 | 边框、纸面层次、行宽稳定 | 通过 |
| 划线侧栏 | 卡片列表有内容层级 | 列表填满剩余高度，去除无意义死区 | 通过 |
| 划线日期 | 日期应留在卡片内部 | 长摘要两行截断，日期独立成行并保持在卡片边界内 | 通过 |
| 划线定位 | 正文和侧栏能互相对应 | 定位原文后，正文 mark 与侧栏卡片同步进入 `is-revealed`，卡片标记 `aria-current="location"`，并显示更清楚的侧栏当前项样式 | 通过 |
| 想法定位 | 非划线原文也可被定位 | 没有已有划线时，正文使用临时 `local-reader-source-reveal` 高亮，侧栏想法卡片同步进入 `is-revealed` | 通过 |
| AI 定位 | 选区可能跨越划线和普通文本 | 已有划线段和普通文本段都能被定位，AI 卡片同步进入 `is-revealed` | 通过 |
| 想法长文本 | 长想法、日期和删除按钮不互相挤压 | 想法摘要两行截断，日期收纳，删除按钮留在卡片内，卡片不横向溢出 | 通过 |
| AI 长问题 | 长问题、原文和操作按钮不互相挤压 | 问题和原文摘要截断，操作按钮留在卡片内，卡片不横向溢出 | 通过 |
| 密集侧栏 | 多条记录时内部滚动，不制造死区 | 划线、想法、AI 三个列表均填满剩余侧栏高度，列表内部滚动，页面无横向溢出 | 通过 |
| 侧栏按钮命名 | 三类卡片语义一致 | 划线、想法、AI 卡片均有明确“查看详情”可访问名称 | 通过 |
| 选区工具 | 出现在正文附近 | 点击划线后悬浮工具条贴近正文 | 通过 |
| 选区关联卡片 | 想法 / AI 仍围绕正文小浮层呈现 | 关联想法和 AI 提问卡片固定在小浮层内，长文本两行截断，整组内部滚动且不越过视口 | 通过 |
| 临时浮层关闭 | 不应只能依赖点击或滚动收起 | 选区工具条打开后聚焦首个操作；目录、书内搜索、选区工具条、写想法浮层、AI 提问浮层均支持 `Escape` 关闭；搜索关闭、写想法取消、AI 关闭/取消也会把焦点还给触发控件 | 通过 |
| 暗色模式 | 阅读器各容器不应浅深割裂 | 顶部栏、状态栏、正文纸面、右侧侧栏、选区浮层均切换为一致暗底 | 通过 |
| 想法展示 | 摘要卡 + 详情弹窗 | 不把写想法移到侧边栏主输入 | 通过 |
| AI 展示 | 概念稿偏右侧阅读注释面板 | 保留“AI 提问”业务命名；详情已从居中大表单改为贴在右侧栏左侧的 sidecar 详情面板，右栏卡片保持可见，完整详情仍承载长文本和操作 | 基本贴近，仍有有意差异 |
| 数据边界 | 本地与微信隔离 | 文案和记录均保持本地边界 | 通过 |

## 验证记录

### Browser/IAB

验证路径：

`http://127.0.0.1:5173/?local-reader-preview=1&local-reader-preview-marks=1`

交互路径：

1. 打开预览。
2. 进入书架。
3. 进入本地书库。
4. 打开《月亮与六便士》。
5. 查看划线侧栏。

结果：

- 页面标题：`个人阅读管理`
- 页面非空白：通过
- 框架错误 overlay：未出现
- console error/warn：0
- 阅读器标题：`月亮与六便士`
- 划线列表填满侧栏剩余高度：通过
- 划线卡片日期边界：3 张预览划线卡片全部通过 containment 校验

补充焦点验证：

- 使用 Browser/IAB 打开 `http://127.0.0.1:5173/?local-reader-preview=1&local-reader-preview-marks=1` 并进入《小王子》本地阅读器。
- 点击“关闭书内搜索”后，搜索表单关闭，焦点回到 `aria-label="打开书内搜索"` 按钮。
- 点击已有划线后，选区工具条自动聚焦“划线”按钮。
- 点击写想法浮层“取消”后，浮层关闭，焦点回到原文 `mark.local-reader-highlight`。
- 点击 AI 提问面板关闭按钮后，面板关闭，焦点回到原文 `mark.local-reader-highlight`。
- Browser/IAB console error/warn：0。

补充边界验证：

- 使用长划线摘要构造 8 条划线卡片。
- 1280 x 760 视口下，日期 `small` 的 top / left / right / bottom 均保持在所属 `li` 卡片边界内。
- 截图：`output/local-reader-highlight-date-contained.png`

补充定位态验证：

- 点击划线侧栏卡片打开详情，卡片进入 `is-active`，并标记 `aria-current="location"`。
- 点击“定位原文”后弹窗关闭，正文划线和侧栏卡片同步进入 `is-revealed`。
- 当前项样式具备可见 outline、左侧定位条和 inset 强调；样式增强不改变卡片高度边界。
- 截图：`output/local-reader-highlight-revealed-state.png`

补充想法 / AI 定位态验证：

- 想法记录不依赖已有划线；定位后正文普通文本出现临时 `local-reader-source-reveal`。
- AI 提问记录可覆盖已有划线和后续普通文本；定位后两类文本都可见。
- 想法和 AI 侧栏卡片均标记 `aria-current="location"`。
- 截图：
  - `output/local-reader-thought-revealed-state.png`
  - `output/local-reader-ai-revealed-state.png`

补充 AI 长文本卡片验证：

- 使用包含长英文 token 的 AI 问题记录。
- 1280 x 760 视口下，AI 卡片 `scrollWidth <= clientWidth`。
- 卡片高度保持在 168px 以内。
- 右侧复制、定位、删除操作按钮均保持在卡片边界内。
- 截图：`output/local-reader-ai-long-card-boundary.png`

补充 AI 详情面板概念稿对齐修正：

- 原实现更像居中的通用后台弹窗，和概念稿中的右侧阅读注释面板差距明显。
- 二次修正后 AI 详情面板宽度从 520px 收窄到约 360px，并固定贴在右侧栏左侧，减少全屏居中表单感和正文遮挡。
- 弹层背景去掉强模糊和重压暗，浅色态为透明遮罩，阅读页和右侧 AI 列表上下文不再被压暗。
- 面板垂直位置保持在阅读区中上部，避免落在屏幕正中造成通用 modal 观感。
- 标题层级改为“AI 提问详情”主标题，状态和时间降为小号元信息。
- 选中文本和用户问题改为更轻的分段结构，本地边界说明从详情常驻内容中移除，复制操作收敛为图标按钮。
- 1536 x 960 视口下，面板约为 `x=823, y=134, width=360, height=482`；阅读正文区域约为 `x=294, width=879`，右侧栏约从 `x=1188` 开始，面板与右侧栏间距约 5px。
- 底部操作区高度约 51px，`关闭 / 定位原文 / 继续追问 / 删除记录` 未越界。
- v6 截图由项目 Playwright 捕获；本轮 Browser/IAB 通道在重连阶段触发本地 runtime sandbox 启动失败，未作为 v6 截图来源。
- 仍保留有意差异：概念稿中 AI 内容主要在右栏卡片内展示，而当前详情用于承载完整长文本、复制、定位、继续追问和删除，因此以右栏 sidecar 实现，不完全内嵌右栏。
- 截图：`output/local-reader-ai-detail-concept-aligned-v6.png`

补充想法长文本卡片验证：

- 使用包含长英文 token 的想法记录。
- 1280 x 760 视口下，想法卡片 `scrollWidth <= clientWidth`。
- 卡片高度保持在 98px 以内。
- 删除按钮保持在卡片边界内。
- 截图：
  - `output/local-reader-thought-long-card-boundary.png`
  - `output/local-reader-thought-tab-long-card-baseline.png`

补充 1280px 默认阅读器基线：

- 1280 x 720 视口下，阅读器默认展示正文、右侧划线列表和底部进度条。
- 页面未出现横向溢出或侧栏卡片越界。
- 当前项增强截图验证正文定位和侧栏想法卡片同步，右侧卡片不被撑大。
- 截图：
  - `output/local-reader-default-1280-baseline.png`
  - `output/local-reader-current-sidebar-state.png`

补充密集侧栏列表验证：

- 分别写入 12 条划线、12 条想法和 12 条 AI 提问记录。
- 1280 x 760 视口下，三个列表 `clientHeight` 均为 586px，且 `scrollHeight > clientHeight`。
- 三个列表均为内部 `overflow-y: auto`，`scrollWidth == clientWidth`。
- 页面整体无横向溢出。
- 截图：
  - `output/local-reader-sidebar-dense-highlights.png`
  - `output/local-reader-sidebar-dense-thoughts.png`
  - `output/local-reader-sidebar-dense-ai.png`

补充侧栏可访问名称验证：

- 想法卡片补齐 `aria-label="查看想法详情 ..."`。
- 与划线卡片、AI 提问卡片保持同一命名规则。
- 选区浮层中的相关想法 / AI 提问卡片补齐 `aria-label`。
- E2E 已覆盖长想法卡片、选区相关想法卡片和选区相关 AI 提问卡片的可访问名称。

补充选区浮层关联卡片边界验证：

- 1120 x 560 视口下写入 2 条相关想法和 2 条相关 AI 提问记录。
- 选区浮层高度保持在 420px 以内，不越过视口底部。
- 相关想法 / AI 提问分组均为内部 `overflow-y: auto`，小卡片长文本不横向溢出。
- 点击相关想法小卡片可进入详情弹窗查看全文。
- Browser/IAB 交互验证中，实际浮层高度 242px，`scrollWidth == clientWidth`，console error/warn：0。
- 截图：`output/local-reader-selection-related-cards-boundary.png`

补充临时浮层键盘关闭验证：

- `Escape` 可关闭本地图书目录浮层。
- `Escape` 可关闭书内搜索浮层。
- `Escape` 可关闭正文选区工具条。
- `Escape` 可关闭写想法浮层和 AI 提问浮层。
- 正文选区工具条打开后，焦点进入首个“划线”操作按钮。
- 关闭目录后焦点回到“目录”按钮。
- 关闭书内搜索后焦点回到“打开书内搜索”按钮。
- 关闭选区工具条、写想法浮层和 AI 提问浮层后，焦点回到原文划线触发点。
- 如果工具条来自普通正文手动选区而不是已有划线，关闭后焦点回到正文阅读区。
- 点击“关闭书内搜索”、写想法“取消”、AI 关闭按钮和 AI “取消”时，也执行同样的焦点恢复。
- 点击取消会释放选区保护窗口，用户立刻重新选择正文时不会被上一轮划线点击的保护逻辑吞掉。
- 详情弹窗仍沿用原有 `Escape` 关闭逻辑，不混入临时层处理。

补充暗色模式验证：

- 1280 x 720 视口下切换应用主题为暗色。
- 阅读器顶部栏、状态栏、右侧侧栏、工具按钮和正文纸面均使用暗色背景，不再出现浅色容器割裂。
- 选区浮层在暗色模式下仍显示相关想法和相关 AI 提问。
- 暗色选区浮层高度 262px，未越过视口底部，页面无横向溢出。
- Browser/IAB 完成交互和 DOM 指标验证；因 Browser 截图接口连续超时，截图落盘使用项目 Playwright 捕获。
- 截图：
  - `output/local-reader-dark-default.png`
  - `output/local-reader-dark-selection-related-cards.png`

### 宽桌面

使用 1536 x 960 视口补充验证：

- 本地书库前 4 张卡片呈 2 列。
- 右侧导入区宽度稳定为 300px。
- 阅读器正文区和侧栏稳定显示。
- AI 提问详情弹窗不展示假回答。

### 自动化

已通过：

- `npx tsc --noEmit --pretty false`
- `npx vitest run src/pages/LocalLibraryPage.test.tsx src/lib/local-reader-api.test.ts src/lib/local-reader-highlights.test.ts src/lib/local-reader-thoughts.test.ts src/lib/local-reader-ai-drafts.test.ts`
- `npx playwright test tests/e2e/local-reader.spec.ts`（16 passed）
- `npm run build`

## 有意偏离

- 不抓取真实网络封面，继续使用本地生成封面。
- 1280px 默认桌面不强制双列，避免卡片内容拥挤。
- AI 分区使用“AI 提问”，不使用“AI 回答”作为默认命名；视觉形态仍对齐概念稿里的阅读注释详情面板。
- 示例划线、想法和 AI 草稿仅在 `local-reader-preview=1&local-reader-preview-marks=1` 出现，不进入真实存储。

## 后续建议

下一阶段可以进入阅读器细节打磨，而不是继续大改结构。当前已补齐侧栏当前项视觉增强、想法 tab 长文本截图基线和 1280px 默认阅读器基线。

优先级建议：

1. 如果后续支持真实封面，再单独设计本地封面来源和缓存策略。
2. 若继续细化阅读体验，可评估字号、行距和正文宽度预设是否需要用户级偏好。
