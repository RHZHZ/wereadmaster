export type DailyReadingCardTone =
  | "stats"
  | "decision"
  | "review"
  | "book"
  | "candidate"
  | "persona"
  | "empty";

export type DailyReadingCard = {
  title: string;
  body: string;
  sourceLabel: string;
  actionLabel: string;
  tone: DailyReadingCardTone;
};

export type DailyReadingCardInput = {
  reviewActions?: string[];
  topDecisionTitle?: string;
  topDecisionReason?: string;
  reviewItemTitle?: string;
  reviewItemMeta?: string;
  recentBookTitle?: string;
  recentBookMeta?: string;
  candidateTitle?: string;
  candidateMeta?: string;
  personaSnapshot?: string;
  hasCredential: boolean;
  hasShelfData: boolean;
  hasNotesData?: boolean;
};

export function buildDailyReadingCard(input: DailyReadingCardInput): DailyReadingCard {
  if (!input.hasCredential) {
    return emptyCard(
      "先连接微信读书",
      "连接后可以同步书架、笔记和统计，今日卡片才会有本地来源。",
      "凭据状态",
      "打开设置"
    );
  }

  if (!input.hasShelfData) {
    return emptyCard(
      "先同步书架缓存",
      "本机还没有可用于整理的阅读数据，先同步书架。",
      "书架缓存",
      "去书架同步"
    );
  }

  const nextStatsAction = firstText(input.reviewActions);
  if (nextStatsAction) {
    return {
      title: "这周期最值得处理",
      body: ensureSentence(nextStatsAction),
      sourceLabel: "本地阅读报告",
      actionLabel: "查看阅读报告",
      tone: "stats"
    };
  }

  const decisionTitle = cleanText(input.topDecisionTitle);
  if (decisionTitle) {
    return {
      title: `今天先确认${formatBookTitle(decisionTitle)}`,
      body: ensureSentence(input.topDecisionReason || "已有生成过的选书决策，可以用它减少候选堆积"),
      sourceLabel: "选书决策缓存",
      actionLabel: "查看决策",
      tone: "decision"
    };
  }

  const reviewTitle = cleanText(input.reviewItemTitle);
  if (reviewTitle) {
    const reviewMeta = cleanText(input.reviewItemMeta);
    return {
      title: `今天整理${formatBookTitle(reviewTitle)}`,
      body: reviewMeta
        ? `${reviewMeta}，适合整理成结构化复盘。`
        : "这本书已有本地复盘信号，适合今天整理成结构化输出。",
      sourceLabel: "本地笔记概览",
      actionLabel: "开始复盘",
      tone: "review"
    };
  }

  const recentTitle = cleanText(input.recentBookTitle);
  if (recentTitle) {
    const recentMeta = cleanText(input.recentBookMeta);
    return {
      title: `继续推进${formatBookTitle(recentTitle)}`,
      body: recentMeta
        ? `${recentMeta}。回到最近阅读现场，给后续复盘留材料。`
        : "回到最近阅读现场，继续积累可整理的内容。",
      sourceLabel: "最近阅读",
      actionLabel: "打开书籍",
      tone: "book"
    };
  }

  const candidateTitle = cleanText(input.candidateTitle);
  if (candidateTitle) {
    const candidateMeta = cleanText(input.candidateMeta);
    return {
      title: `候选池里有${formatBookTitle(candidateTitle)}`,
      body: candidateMeta
        ? `${candidateMeta}，适合进入下一本取舍。`
        : "这本候选还没有进入决策，可以先确认是否继续保留。",
      sourceLabel: "本地候选",
      actionLabel: "查看候选",
      tone: "candidate"
    };
  }

  const personaSnapshot = cleanText(input.personaSnapshot);
  if (personaSnapshot) {
    return {
      title: "今天看一个阅读风格信号",
      body: ensureSentence(personaSnapshot),
      sourceLabel: "本地统计画像",
      actionLabel: "查看统计",
      tone: "persona"
    };
  }

  if (input.hasNotesData === false) {
    return emptyCard(
      "先同步笔记样本",
      "当前还没有可复盘的本地笔记，先同步后再挑一本书整理。",
      "笔记概览",
      "同步笔记"
    );
  }

  return emptyCard(
    "继续积累阅读样本",
    "今天还没有足够确定的卡片来源，先推进一本书或同步统计。",
    "本地样本",
    "查看书架"
  );
}

function emptyCard(title: string, body: string, sourceLabel: string, actionLabel: string): DailyReadingCard {
  return {
    title,
    body,
    sourceLabel,
    actionLabel,
    tone: "empty"
  };
}

function firstText(values?: string[]): string | undefined {
  return values?.map(cleanText).find(Boolean);
}

function cleanText(value?: string): string {
  return value?.trim() ?? "";
}

function formatBookTitle(title: string): string {
  return title.startsWith("《") ? title : `《${title}》`;
}

function ensureSentence(value: string): string {
  const text = cleanText(value);
  return /[。！？!?]$/.test(text) ? text : `${text}。`;
}
