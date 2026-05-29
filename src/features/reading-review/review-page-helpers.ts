import { formatDuration } from "../../lib/formatters";
import type {
  AiSettingsState,
  BookAiSummarySource,
  ReadingStats
} from "../../lib/types";
import { formatReadingStatsBucketLabel } from "../../pages/reading-stats-period";

export type ReviewStatus =
  | "idle"
  | "setup-required"
  | "loading-cache"
  | "generating"
  | "cached"
  | "generated"
  | "error";

export type ReviewTimelineSegment = {
  anchorTime: number;
  tone: "steady" | "rise" | "peak" | "cooldown";
  title: string;
  description: string;
};

export type ReviewTimelineSegmentInsight = ReviewTimelineSegment & {
  aiInsight?: string;
};

export type ReviewTimelineInsights = {
  segments: ReviewTimelineSegmentInsight[];
  unmatchedInsights: string[];
};

export function buildReviewTimelineSegments(stats?: ReadingStats): ReviewTimelineSegment[] {
  const buckets = stats?.buckets.filter((bucket) => bucket.readTimeSeconds > 0) ?? [];
  if (buckets.length === 0) {
    return [];
  }

  const maxSeconds = Math.max(...buckets.map((bucket) => bucket.readTimeSeconds), 1);
  const segments: ReviewTimelineSegment[] = [];

  buckets.forEach((bucket, index) => {
    const previous = buckets[index - 1];
    const ratio = bucket.readTimeSeconds / maxSeconds;
    const delta = previous ? bucket.readTimeSeconds - previous.readTimeSeconds : 0;

    let title = "稳定段";
    let tone: ReviewTimelineSegment["tone"] = "steady";
    let description = `在 ${formatReadingStatsBucketLabel(
      stats?.mode ?? "monthly",
      bucket.startTime
    )} 保持了 ${formatDuration(bucket.readTimeSeconds)} 的投入。`;

    if (ratio >= 0.88) {
      title = "高峰段";
      tone = "peak";
      description = `这一段投入达到当前周期高位，阅读时长约 ${formatDuration(
        bucket.readTimeSeconds
      )}。`;
    } else if (delta >= 900) {
      title = "抬升段";
      tone = "rise";
      description = `相比上一段明显抬升，新增投入约 ${formatDuration(delta)}。`;
    } else if (delta <= -900) {
      title = "收束段";
      tone = "cooldown";
      description = "相比上一段明显回落，说明节奏开始从高峰收束。";
    }

    segments.push({
      anchorTime: bucket.startTime,
      tone,
      title,
      description
    });
  });

  return segments.slice(-4);
}

export function buildReviewTimelineInsights(
  segments: ReviewTimelineSegment[],
  insights: string[]
): ReviewTimelineInsights {
  const normalizedInsights = insights.map((insight) => insight.trim()).filter(Boolean);

  if (segments.length === 0) {
    return {
      segments: [],
      unmatchedInsights: normalizedInsights
    };
  }

  const matchedInsightIndexes = new Set<number>();
  const segmentAssignments = new Map<number, string>();
  const candidates: ReviewTimelineInsightCandidate[] = [];

  segments.forEach((segment, segmentIndex) => {
    normalizedInsights.forEach((insight, insightIndex) => {
      const semanticScore = scoreInsightForSegment(segment, segmentIndex, segments.length, insight);
      if (semanticScore <= 0) {
        return;
      }

      candidates.push({
        insight,
        insightIndex,
        semanticScore,
        segmentIndex,
        sequenceScore: scoreInsightSequenceProximity(segmentIndex, insightIndex)
      });
    });
  });

  candidates
    .sort((left, right) => {
      if (right.semanticScore !== left.semanticScore) {
        return right.semanticScore - left.semanticScore;
      }

      if (right.sequenceScore !== left.sequenceScore) {
        return right.sequenceScore - left.sequenceScore;
      }

      if (left.segmentIndex !== right.segmentIndex) {
        return left.segmentIndex - right.segmentIndex;
      }

      return left.insightIndex - right.insightIndex;
    })
    .forEach((candidate) => {
      if (segmentAssignments.has(candidate.segmentIndex) || matchedInsightIndexes.has(candidate.insightIndex)) {
        return;
      }

      matchedInsightIndexes.add(candidate.insightIndex);
      segmentAssignments.set(candidate.segmentIndex, candidate.insight);
    });

  segments.forEach((_, segmentIndex) => {
    if (segmentAssignments.has(segmentIndex)) {
      return;
    }

    const fallbackIndex = normalizedInsights.findIndex(
      (insight, insightIndex) =>
        !matchedInsightIndexes.has(insightIndex) && !isGlobalTimelineObservation(insight)
    );
    if (fallbackIndex < 0) {
      return;
    }

    matchedInsightIndexes.add(fallbackIndex);
    segmentAssignments.set(segmentIndex, normalizedInsights[fallbackIndex]);
  });

  return {
    segments: segments.map((segment, index) => ({
      ...segment,
      aiInsight: segmentAssignments.get(index)
    })),
    unmatchedInsights: normalizedInsights.filter((_, index) => !matchedInsightIndexes.has(index))
  };
}

type ReviewTimelineInsightCandidate = {
  insight: string;
  insightIndex: number;
  semanticScore: number;
  segmentIndex: number;
  sequenceScore: number;
};

function scoreInsightForSegment(
  segment: ReviewTimelineSegment,
  segmentIndex: number,
  segmentCount: number,
  insight: string
): number {
  const normalized = insight.trim();
  if (!normalized) {
    return 0;
  }

  const toneScore = countKeywordMatches(toneKeywords[segment.tone], normalized) * 4;
  const positionScore =
    countKeywordMatches(resolveSegmentPositionKeywords(segmentIndex, segmentCount), normalized) * 3;
  const aliasScore = countKeywordMatches(resolveSegmentAliasKeywords(segmentIndex, segmentCount), normalized) * 2;
  const conflictScore = countConflictingToneMatches(segment.tone, normalized) * 2;

  return Math.max(toneScore + positionScore + aliasScore - conflictScore, 0);
}

function countConflictingToneMatches(
  tone: ReviewTimelineSegment["tone"],
  insight: string
): number {
  return reviewTimelineTones
    .filter((candidateTone) => candidateTone !== tone)
    .reduce((total, candidateTone) => total + countKeywordMatches(toneKeywords[candidateTone], insight), 0);
}

function countKeywordMatches(keywords: string[], insight: string): number {
  return Array.from(new Set(keywords)).reduce((total, keyword) => {
    return total + (keyword && insight.includes(keyword) ? 1 : 0);
  }, 0);
}

function scoreInsightSequenceProximity(segmentIndex: number, insightIndex: number): number {
  const distance = Math.abs(segmentIndex - insightIndex);

  if (distance === 0) {
    return 0.6;
  }

  if (distance === 1) {
    return 0.3;
  }

  return 0;
}

function resolveSegmentPositionKeywords(index: number, total: number): string[] {
  if (total <= 1) {
    return ["整体", "全段", "本段", "整段"];
  }

  const keywords = [...resolveSegmentOrdinalKeywords(index, total)];

  if (index === 0) {
    keywords.push("前段", "前期", "开头", "起步", "开始", "起始");
  } else if (index === total - 1) {
    keywords.push("后段", "后期", "结尾", "收尾", "末段", "尾段", "最后");
  } else {
    keywords.push("中段", "中期", "中部", "中间");
  }

  if (index < total / 2) {
    keywords.push("前半");
  } else {
    keywords.push("后半");
  }

  return keywords;
}

function resolveSegmentOrdinalKeywords(index: number, total: number): string[] {
  const ordinal = chineseOrdinals[index] ?? `${index + 1}`;
  const keywords = [`第${index + 1}段`, `第${ordinal}段`];

  if (index === 0) {
    keywords.push("首段");
  }

  if (index === total - 1) {
    keywords.push("最后一段");
  }

  return keywords;
}

function resolveSegmentAliasKeywords(index: number, total: number): string[] {
  if (total <= 1) {
    return [];
  }

  if (index === 0) {
    return ["前面", "前序", "起势"];
  }

  if (index === total - 1) {
    return ["后面", "后程", "尾声", "收尾阶段"];
  }

  return ["中程", "中盘", "中间阶段"];
}

function isGlobalTimelineObservation(insight: string): boolean {
  return globalTimelineObservationKeywords.some((keyword) => insight.includes(keyword));
}

const toneKeywords: Record<ReviewTimelineSegment["tone"], string[]> = {
  steady: ["稳定", "持平", "持续", "平稳", "均匀", "平缓", "维持"],
  rise: ["抬升", "上升", "回升", "增加", "拉高", "走高", "提升"],
  peak: ["高峰", "峰值", "集中", "冲高", "最高", "最强", "爆发"],
  cooldown: ["收束", "回落", "下降", "减少", "放缓", "降温", "回撤"]
};

const reviewTimelineTones: ReviewTimelineSegment["tone"][] = ["steady", "rise", "peak", "cooldown"];
const chineseOrdinals = ["一", "二", "三", "四", "五", "六"];
const globalTimelineObservationKeywords = [
  "整体来看",
  "整体上",
  "整体而言",
  "总体来看",
  "总体上",
  "总体而言",
  "整体节奏",
  "总体节奏"
];

export function statusMetaFromState(status: ReviewStatus, hasStaleCacheError: boolean) {
  if (status === "setup-required") {
    return { label: "需要设置", tone: "warning" as const };
  }

  if (status === "loading-cache") {
    return { label: "读取缓存中", tone: "neutral" as const };
  }

  if (status === "generating") {
    return { label: "生成中", tone: "neutral" as const };
  }

  if (status === "cached") {
    return { label: "本地缓存", tone: "neutral" as const };
  }

  if (status === "generated") {
    return { label: "已生成", tone: "success" as const };
  }

  if (status === "error") {
    return { label: hasStaleCacheError ? "使用旧缓存" : "生成失败", tone: "warning" as const };
  }

  return { label: "待生成", tone: "neutral" as const };
}

export function statusFromSource(source: BookAiSummarySource): ReviewStatus {
  if (source === "cache" || source === "staleCache") {
    return "cached";
  }

  if (source === "generated") {
    return "generated";
  }

  return "idle";
}

export function statusFromAiState(aiState?: AiSettingsState): ReviewStatus {
  if (!aiState) {
    return "idle";
  }

  return aiState.credential.hasCredential ? "idle" : "setup-required";
}
