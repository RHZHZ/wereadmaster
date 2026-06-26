import type { ReadingRoute, ReadingRouteBookInput } from "../../lib/types";

export type GuidePrescriptionItem = {
  label: string;
  title: string;
  body: string;
};

export type GuideActionItem = {
  title: string;
  done: string;
};

export type GuideMapNode = {
  id: string;
  eyebrow: string;
  label: string;
  detail: string;
  meta: string;
  fullDetail?: string;
  fullMeta?: string;
  fields?: Array<{
    label: string;
    value: string;
  }>;
  associatedActions?: GuideActionItem[];
};

export type GuideDetailSections = {
  steps: Array<{
    index: number;
    title: string;
    meta: string;
    taskLabel: string;
    task: string;
    effort: string;
    evidence: string;
  }>;
  checkpoints: Array<{
    timing: string;
    question: string;
    output: string;
    acceptance: string;
  }>;
  actions: GuideActionItem[];
};

const CHAPTER_RANGE_PATTERN =
  /(第\s*[\d一二三四五六七八九十百零〇两]+\s*[章节回篇部](?:\s*[到至\-—~]\s*第?\s*[\d一二三四五六七八九十百零〇两]+\s*[章节回篇部])?)/;
const CHECKPOINT_VERB_PATTERN = /^(?:写|整理|列出|输出|完成|沉淀)\s*/;
const GENERIC_PLANNING_PATTERNS = [
  /建立稳定.{0,8}习惯/g,
  /整书复盘沉淀/g,
  /可复用.{0,8}模板/g,
  /持续推进/g
];

export function buildGuidePrescriptionItems(route: ReadingRoute, isCrossBookRoute: boolean): GuidePrescriptionItem[] {
  if (isCrossBookRoute) {
    return buildCrossBookFocusItems(route);
  }

  const firstBook = route.books[0];
  const checkpoint = route.reviewCheckpoints[0];
  const nextAction = route.nextActions[0];
  const readingRange = extractReadingRange([nextAction, firstBook?.basis, firstBook?.readingPurpose]);
  const effort = cleanGuideText(firstBook?.estimatedEffort);
  const checkpointQuestion = cleanGuideText(checkpoint?.question);
  const checkpointOutput = cleanGuideText(checkpoint?.suggestedOutput);
  const timing = cleanGuideText(checkpoint?.timing);
  const outputTitle = buildOutputTitle(checkpointOutput);

  return [
    {
      label: "先读哪里",
      title: readingRange ? prefixAction(readingRange, "读完") : "完成下一段关键阅读",
      body: effort ? `用 ${effort}推进；只记录会改变行动的段落。` : "先完成 1 个连续阅读时段；只记录会改变行动的段落。"
    },
    {
      label: "带什么问题读",
      title: checkpointQuestion || "这本书接下来要解决哪个具体问题？",
      body: buildQuestionBody(checkpointOutput)
    },
    {
      label: "读完产出什么",
      title: outputTitle || "一页本书复盘",
      body: buildOutputBody(timing, checkpointOutput)
    }
  ];
}

export function buildGuideFocusItems(route: ReadingRoute, isCrossBookRoute: boolean): GuidePrescriptionItem[] {
  if (isCrossBookRoute) {
    return buildCrossBookFocusItems(route);
  }

  const prescription = buildGuidePrescriptionItems(route, false);
  const actions = buildGuideActionDetails(route);
  const firstAction = actions[0];

  return [
    {
      label: "当前优先级",
      title: firstAction?.title || prescription[0].title,
      body: firstAction ? `完成标准：${firstAction.done}` : prescription[0].body
    },
    {
      label: "验证判断",
      title: prescription[1].title,
      body: prescription[1].body
    },
    {
      label: "本轮收束",
      title: prescription[2].title,
      body: prescription[2].body
    }
  ];
}

export function buildSingleBookGuideNodes(
  currentBook: ReadingRouteBookInput | undefined,
  route: ReadingRoute
): GuideMapNode[] {
  const prescription = buildGuidePrescriptionItems(route, false);
  const actions = buildGuideActionDetails(route);
  const title = cleanGuideText(currentBook?.title || route.books[0]?.title) || "当前书";

  return [
    {
      id: "current-book",
      eyebrow: "当前书",
      label: title,
      detail: "先把注意力放回这一本书，不在主线未收束前扩展书单。",
      meta: cleanGuideText(currentBook?.localStatus || route.books[0]?.localStatus) || "",
      fields: [
        { label: "书名", value: title },
        { label: "作者", value: cleanGuideText(currentBook?.author || route.books[0]?.author) },
        { label: "本地状态", value: cleanGuideText(currentBook?.localStatus || route.books[0]?.localStatus) },
        { label: "依据", value: cleanGuideText(route.books[0]?.basis) }
      ].filter((item) => item.value)
    },
    {
      id: "continue-reading",
      eyebrow: "先读哪里",
      label: prescription[0].title,
      detail: prescription[0].body,
      meta: "",
      fields: [
        { label: "阅读任务", value: prescription[0].title },
        { label: "完整说明", value: prescription[0].body },
        { label: "预计投入", value: cleanGuideText(route.books[0]?.estimatedEffort) },
        { label: "依据", value: cleanGuideText(route.books[0]?.basis) }
      ].filter((item) => item.value),
      associatedActions: maybeAssociatedActions(actions.slice(0, 1))
    },
    {
      id: "book-review",
      eyebrow: "带问题读",
      label: prescription[1].title,
      detail: prescription[1].body,
      meta: "",
      fields: [
        { label: "验证问题", value: prescription[1].title },
        { label: "阅读方式", value: prescription[1].body },
        { label: "复盘问题", value: cleanGuideText(route.reviewCheckpoints[0]?.question) }
      ].filter((item) => item.value)
    },
    {
      id: "single-book-output",
      eyebrow: "交付物",
      label: prescription[2].title,
      detail: prescription[2].body,
      meta: "",
      fields: [
        { label: "交付物", value: prescription[2].title },
        { label: "完成说明", value: prescription[2].body },
        { label: "验收标准", value: cleanGuideText(route.reviewCheckpoints[0]?.suggestedOutput) }
      ].filter((item) => item.value),
      associatedActions: maybeAssociatedActions(buildOutputAssociatedActions(actions, route))
    },
    {
      id: "extend-route",
      eyebrow: "延伸判断",
      label: "是否加入候选书",
      detail: "完成本书复盘后，只有主题需要横向比较时再加入候选书。",
      meta: "候选书可选",
      fields: [
        { label: "判断方式", value: "完成本书复盘后，只有主题需要横向比较时再加入候选书。" },
        { label: "候选状态", value: "候选书可选" }
      ]
    }
  ];
}

export function buildGuideDetailSections(route: ReadingRoute, isCrossBookRoute: boolean): GuideDetailSections {
  const prescription = buildGuidePrescriptionItems(route, isCrossBookRoute);

  return {
    steps: route.books.map((book, index) => ({
      index: book.order || index + 1,
      title: cleanGuideText(book.title) || `第 ${index + 1} 本`,
      meta: [book.author, book.localStatus].map(cleanGuideText).filter(Boolean).join(" · ") || "路线节点",
      taskLabel: isCrossBookRoute ? "阅读目的" : "核对依据",
      task: isCrossBookRoute
        ? shortGuideText(cleanGuideText(book.readingPurpose) || "完成这个节点的阅读和复盘。", 42)
        : buildSingleBookEvidenceTask(book, prescription[0]?.title),
      effort: cleanGuideText(book.estimatedEffort) || "1 个连续阅读时段",
      evidence: buildEvidenceText(book.basis)
    })),
    checkpoints: route.reviewCheckpoints.map((checkpoint) => {
      const output = cleanCheckpointOutput(checkpoint.suggestedOutput) || "一页复盘";

      return {
        timing: cleanGuideText(checkpoint.timing) || "读完本轮阅读后",
        question: cleanGuideText(checkpoint.question) || "这本书接下来要解决哪个具体问题？",
        output,
        acceptance: buildAcceptanceText(checkpoint.suggestedOutput)
      };
    }),
    actions: buildGuideActionDetails(route)
  };
}

export function buildGuideActionText(item: { title: string; done: string }): string {
  return `${item.title}，${item.done}`;
}

export function buildGuideActionDetails(route: ReadingRoute): GuideActionItem[] {
  return route.nextActions.map(buildActionDetail).filter((item) => item.title.trim() && item.done.trim());
}

function buildCrossBookFocusItems(route: ReadingRoute): GuidePrescriptionItem[] {
  const firstBook = route.books[0];
  const lastBook = route.books[route.books.length - 1];
  const checkpoint = route.reviewCheckpoints[0];

  return [
    {
      label: "先读哪本",
      title: cleanGuideText(firstBook?.title) || "当前书",
      body: shortGuideText(cleanGuideText(firstBook?.readingPurpose) || "先完成当前书的关键阅读和复盘。", 58)
    },
    {
      label: "为什么接这本",
      title: lastBook && lastBook.bookId !== firstBook?.bookId ? cleanGuideText(lastBook.title) : "候选书路线",
      body: shortGuideText(cleanGuideText(lastBook?.readingPurpose) || "再按已选候选书推进下一本阅读。", 58)
    },
    {
      label: "如何收束",
      title: cleanGuideText(checkpoint?.timing) || "每个节点结束后",
      body: shortGuideText(cleanGuideText(checkpoint?.suggestedOutput || checkpoint?.question) || "为每一步留下可执行复盘输出。", 58)
    }
  ];
}

function buildQuestionBody(suggestedOutput: string) {
  const amount = suggestedOutput.match(/\d+\s*[条个点]/)?.[0];
  if (amount) {
    return `读到相关段落时，把答案先写成 ${amount}可验证判断。`;
  }

  return "读到相关段落时，先写下答案和对应页段，不急着总结全书。";
}

function buildOutputBody(timing: string, suggestedOutput: string) {
  const requirement = extractRequirementAfterComma(suggestedOutput);
  const prefix = timing || "读完本轮阅读后";

  if (requirement) {
    return ensureChinesePeriod(`${prefix}完成，并${requirement}`);
  }

  return `${prefix}完成，确保能直接指导下一次阅读。`;
}

function buildEvidenceText(value: string) {
  const text = cleanGuideText(value);
  if (!text) {
    return "基于当前书、笔记或本地状态生成";
  }

  return text
    .split(/[，,。；;]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("；");
}

function buildSingleBookEvidenceTask(book: ReadingRoute["books"][number], fallbackTask: string | undefined) {
  const title = cleanGuideText(book.title);
  if (title) {
    return `围绕《${title}》核对本轮阅读依据`;
  }

  return fallbackTask ? `围绕「${fallbackTask}」核对本轮阅读依据` : "核对本轮阅读依据";
}

function buildOutputTitle(suggestedOutput: string) {
  const normalized = suggestedOutput.replace(CHECKPOINT_VERB_PATTERN, "").trim();
  const beforeComma = normalized.split(/[，,；;]/)[0]?.trim() ?? "";
  return shortGuideText(beforeComma, 18);
}

function cleanCheckpointOutput(value: string) {
  return cleanGuideText(value).replace(CHECKPOINT_VERB_PATTERN, "").trim();
}

function buildAcceptanceText(value: string) {
  const requirement = extractRequirementAfterComma(cleanGuideText(value));
  if (requirement) {
    return ensureChinesePeriod(requirement);
  }

  return "能直接指导下一次阅读。";
}

function buildActionDetail(value: string) {
  const text = cleanGuideText(value);
  const [title = "", ...rest] = text.split(/[，,；;]/).map((segment) => segment.trim()).filter(Boolean);
  const done = rest.join("，").replace(/^并/, "").trim();

  return {
    title,
    done: ensureChinesePeriod(done || "完成后立即保存为本书复盘记录")
  };
}

function maybeAssociatedActions(actions: GuideActionItem[]) {
  return actions.length > 0 ? actions : undefined;
}

function buildOutputAssociatedActions(actions: GuideActionItem[], route: ReadingRoute) {
  const outputSegments = splitComparableOutput(route.reviewCheckpoints[0]?.suggestedOutput ?? "");
  if (outputSegments.length === 0) {
    return [];
  }

  return actions.slice(1).filter((item) => {
    const actionText = normalizeComparableOutput(buildGuideActionText(item));
    return outputSegments.every((segment) => actionText.includes(segment));
  });
}

function splitComparableOutput(value: string) {
  return cleanCheckpointOutput(value)
    .split(/[，,；;]/)
    .map(normalizeComparableOutput)
    .filter(Boolean);
}

function normalizeComparableOutput(value: string) {
  return cleanGuideText(value)
    .replace(CHECKPOINT_VERB_PATTERN, "")
    .replace(/^并/, "")
    .replace(/\s+/g, "")
    .replace(/[，,；;。！？]/g, "")
    .trim();
}

function extractRequirementAfterComma(value: string) {
  const segments = value.split(/[，,；;]/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) {
    return "";
  }

  return segments.slice(1).join("，").replace(CHECKPOINT_VERB_PATTERN, "").replace(/^并/, "").trim();
}

function extractReadingRange(values: Array<string | undefined>) {
  let firstMatch = "";

  for (const value of values) {
    const match = cleanGuideText(value).match(CHAPTER_RANGE_PATTERN);
    if (match?.[1]) {
      const normalized = normalizeChapterRange(match[1]);
      if (/[到至\-—~]/.test(normalized)) {
        return normalized;
      }
      firstMatch ||= normalized;
    }
  }

  return firstMatch;
}

function normalizeChapterRange(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/第\s*([\d一二三四五六七八九十百零〇两]+)/g, "第 $1")
    .replace(/([\d一二三四五六七八九十百零〇两]+)\s*([章节回篇部])/g, "$1 $2")
    .replace(/\s*([到至\-—~])\s*/g, "$1")
    .replace(/([到至\-—~])第\s*/g, "$1第 ")
    .trim();
}

function prefixAction(value: string, action: string) {
  if (value.startsWith(action) || value.startsWith("完成")) {
    return value;
  }

  return `${action}${value}`;
}

function cleanGuideText(value: string | undefined) {
  let text = (value ?? "").replace(/\s+/g, " ").trim();
  for (const pattern of GENERIC_PLANNING_PATTERNS) {
    text = text.replace(pattern, "");
  }

  return text.replace(/[，,；;。]\s*$/, "").trim();
}

function shortGuideText(value: string, maxLength: number) {
  const text = cleanGuideText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function ensureChinesePeriod(value: string) {
  return /[。！？]$/.test(value) ? value : `${value}。`;
}
