import type { ReadingStatsResponse } from "../../lib/reading-api";
import type { ReadingStats } from "../../lib/types";
import { getCurrentReadingStatsAnchor } from "../../pages/reading-stats-period";

export type SparklineSeries = {
  labels: string[];
  values: number[];
};

export type StatsSummarySparklineSeries = {
  averageReadTimeSeconds: SparklineSeries;
  compare: SparklineSeries;
  readDays: SparklineSeries;
  totalReadTimeSeconds: SparklineSeries;
};

export function buildStatsSummarySparklineSeries(
  responses: ReadingStatsResponse[],
  stats?: ReadingStats
): StatsSummarySparklineSeries {
  if (!stats || stats.mode === "overall") {
    return createEmptyStatsSummarySparklineSeries();
  }

  const matchedResponses = dedupeReadingStatsResponses(
    responses.filter(
      (response) =>
        response.stats.mode === stats.mode &&
        response.stats.baseTime <= getCurrentReadingStatsAnchor(stats.mode)
    )
  )
    .sort((left, right) => left.stats.baseTime - right.stats.baseTime)
    .slice(-6);

  const labels = matchedResponses.map((response) => String(response.stats.baseTime));

  return {
    averageReadTimeSeconds: {
      labels,
      values: matchedResponses.map((response) => getAverageReadTimeSeconds(response.stats))
    },
    compare: {
      labels,
      values: matchedResponses.map((response) => response.stats.compare ?? 0)
    },
    readDays: {
      labels,
      values: matchedResponses.map((response) => Math.max(0, response.stats.readDays ?? 0))
    },
    totalReadTimeSeconds: {
      labels,
      values: matchedResponses.map((response) => Math.max(0, response.stats.totalReadTimeSeconds ?? 0))
    }
  };
}

function dedupeReadingStatsResponses(responses: ReadingStatsResponse[]) {
  const deduped = new Map<string, ReadingStatsResponse>();

  responses.forEach((response) => {
    deduped.set(`${response.stats.mode}:${response.stats.baseTime}`, response);
  });

  return Array.from(deduped.values());
}

function getAverageReadTimeSeconds(stats: ReadingStats) {
  if ((stats.dayAverageReadTimeSeconds ?? 0) > 0) {
    return Math.max(0, stats.dayAverageReadTimeSeconds ?? 0);
  }

  if ((stats.readDays ?? 0) > 0) {
    return Math.round((stats.totalReadTimeSeconds ?? 0) / Math.max(1, stats.readDays ?? 0));
  }

  return 0;
}

function createEmptyStatsSummarySparklineSeries(): StatsSummarySparklineSeries {
  return {
    averageReadTimeSeconds: { labels: [], values: [] },
    compare: { labels: [], values: [] },
    readDays: { labels: [], values: [] },
    totalReadTimeSeconds: { labels: [], values: [] }
  };
}
