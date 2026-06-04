import type { ReadingStatsResponse } from "../lib/reading-api";
import type { ReadingStatsMode } from "../lib/types";

export type ReadingStatsPeriod = {
  mode: ReadingStatsMode;
  baseTime: number;
};

export type ReadingStatsCache = Record<string, ReadingStatsResponse>;

type ReadingStatsTitleVariant = "stats" | "review";

type PeriodDateParts = {
  year: number;
  month: number;
  day: number;
};

export function buildReadingStatsPeriod(
  mode: ReadingStatsMode,
  baseTime?: number
): ReadingStatsPeriod {
  return {
    mode,
    baseTime: normalizeReadingStatsBaseTime(mode, baseTime)
  };
}

export function normalizeReadingStatsBaseTime(
  mode: ReadingStatsMode,
  baseTime?: number
): number {
  if (mode === "overall") {
    return 0;
  }

  if (!Number.isFinite(baseTime) || !baseTime || baseTime <= 0) {
    return 0;
  }

  return Math.trunc(baseTime);
}

export function buildReadingStatsCacheKey(mode: ReadingStatsMode, baseTime = 0): string {
  return `${mode}:${normalizeReadingStatsBaseTime(mode, baseTime)}`;
}

export function upsertReadingStatsCache(
  cache: ReadingStatsCache,
  response: ReadingStatsResponse
): ReadingStatsCache {
  const key = buildReadingStatsCacheKey(response.stats.mode, response.stats.baseTime);
  return {
    ...cache,
    [key]: response
  };
}

export function getReadingStatsResponse(
  cache: ReadingStatsCache,
  period: ReadingStatsPeriod
): ReadingStatsResponse | undefined {
  if (period.mode === "overall") {
    return cache[buildReadingStatsCacheKey("overall", 0)];
  }

  if (period.baseTime > 0) {
    const exact = cache[buildReadingStatsCacheKey(period.mode, period.baseTime)];
    if (exact) {
      return exact;
    }

    const targetIdentity = buildReadingStatsPeriodIdentity(period.mode, period.baseTime);
    return Object.values(cache).find(
      (response) =>
        response.stats.mode === period.mode &&
        buildReadingStatsPeriodIdentity(response.stats.mode, response.stats.baseTime) ===
          targetIdentity
    );
  }

  return getLatestReadingStatsResponse(cache, period.mode);
}

export function getLatestReadingStatsResponse(
  cache: ReadingStatsCache,
  mode: ReadingStatsMode
): ReadingStatsResponse | undefined {
  const currentAnchor = mode === "overall" ? 0 : getCurrentReadingStatsAnchor(mode);
  let matched: ReadingStatsResponse | undefined;
  let fallbackMatched: ReadingStatsResponse | undefined;

  for (const response of Object.values(cache)) {
    if (response.stats.mode !== mode) {
      continue;
    }

    if (!fallbackMatched || response.stats.baseTime > fallbackMatched.stats.baseTime) {
      fallbackMatched = response;
    }

    if (response.stats.baseTime > currentAnchor) {
      continue;
    }

    if (!matched || response.stats.baseTime > matched.stats.baseTime) {
      matched = response;
    }
  }

  return matched ?? fallbackMatched;
}

export function getReadingStatsRequestBaseTime(period: ReadingStatsPeriod): number | undefined {
  if (period.mode === "overall") {
    return 0;
  }

  return period.baseTime > 0 ? period.baseTime : undefined;
}

export function isCurrentReadingStatsPeriod(period: ReadingStatsPeriod): boolean {
  if (period.mode === "overall") {
    return true;
  }

  const targetIdentity = buildReadingStatsPeriodIdentity(
    period.mode,
    period.baseTime > 0 ? period.baseTime : getCurrentReadingStatsAnchor(period.mode)
  );
  const currentIdentity = buildReadingStatsPeriodIdentity(period.mode, getCurrentReadingStatsAnchor(period.mode));

  return targetIdentity === currentIdentity;
}

export function canShiftReadingStatsPeriod(
  period: ReadingStatsPeriod,
  offset: -1 | 1
): boolean {
  if (period.mode === "overall") {
    return false;
  }

  if (offset < 0) {
    return true;
  }

  const currentAnchor = getCurrentReadingStatsAnchor(period.mode);
  const shifted = shiftReadingStatsPeriodUnsafe(period, offset);
  return shifted.baseTime <= currentAnchor;
}

export function formatReadingStatsPeriodTitle(
  period: ReadingStatsPeriod,
  variant: ReadingStatsTitleVariant
): string {
  if (period.mode === "overall") {
    return variant === "review" ? "长期阅读画像" : "长期阅读成果";
  }

  const dateParts = getPeriodDateParts(period.baseTime);
  if (!dateParts) {
    return fallbackTitle(period.mode, variant);
  }

  if (period.mode === "weekly") {
    const anchor = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
    return `${anchor} 当周${variant === "review" ? "阅读复盘" : "阅读报告"}`;
  }

  if (period.mode === "annually") {
    return `${dateParts.year} 年度${variant === "review" ? "阅读复盘" : "阅读报告"}`;
  }

  return `${dateParts.year} 年 ${dateParts.month} 月${variant === "review" ? "阅读复盘" : "阅读报告"}`;
}

export function formatReadingStatsPeriodAnchor(period: ReadingStatsPeriod): string {
  if (period.mode === "overall") {
    return "全部历史";
  }

  const dateParts = getPeriodDateParts(period.baseTime);
  if (!dateParts) {
    return fallbackAnchor(period.mode);
  }

  if (period.mode === "weekly") {
    return `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
  }

  if (period.mode === "annually") {
    return `${dateParts.year} 年`;
  }

  return `${dateParts.year} 年 ${dateParts.month} 月`;
}

export function formatReadingStatsPeriodMetricLabel(period: ReadingStatsPeriod): string {
  if (period.mode === "overall") {
    return "全部历史";
  }

  const dateParts = getPeriodDateParts(period.baseTime);
  if (!dateParts) {
    return fallbackAnchor(period.mode);
  }

  if (period.mode === "annually") {
    return `${dateParts.year} 年`;
  }

  if (period.mode === "monthly") {
    return `${dateParts.year} 年 ${dateParts.month} 月`;
  }

  return `${dateParts.month} 月 ${dateParts.day} 日当周`;
}

export function formatReadingStatsBucketLabel(
  mode: ReadingStatsMode,
  timestamp: number
): string {
  const dateParts = getPeriodDateParts(timestamp);
  if (!dateParts) {
    return "";
  }

  if (mode === "overall") {
    return `${dateParts.year}年`;
  }

  if (mode === "annually") {
    return `${dateParts.month}月`;
  }

  return `${dateParts.month}月${dateParts.day}日`;
}

export function shiftReadingStatsPeriod(
  period: ReadingStatsPeriod,
  offset: -1 | 1
): ReadingStatsPeriod {
  if (period.mode === "overall") {
    return period;
  }

  const shifted = shiftReadingStatsPeriodUnsafe(period, offset);
  if (offset < 0) {
    return shifted;
  }

  const currentAnchor = getCurrentReadingStatsAnchor(period.mode);
  if (shifted.baseTime <= currentAnchor) {
    return shifted;
  }

  return {
    mode: period.mode,
    baseTime: currentAnchor
  };
}

function shiftReadingStatsPeriodUnsafe(
  period: ReadingStatsPeriod,
  offset: -1 | 1
): ReadingStatsPeriod {
  if (period.mode === "weekly") {
    const baseTime = period.baseTime > 0 ? period.baseTime : getCurrentReadingStatsAnchor("weekly");
    const reference = new Date(baseTime * 1000);
    return {
      mode: period.mode,
      baseTime: Math.floor(
        new Date(
          reference.getFullYear(),
          reference.getMonth(),
          reference.getDate() + offset * 7
        ).getTime() / 1000
      )
    };
  }

  const fallbackAnchor = getCurrentReadingStatsAnchor(period.mode);
  const reference = period.baseTime > 0 ? new Date(period.baseTime * 1000) : new Date(fallbackAnchor * 1000);
  const year = reference.getFullYear();
  const month = reference.getMonth();

  if (period.mode === "annually") {
    return {
      mode: period.mode,
      baseTime: Math.floor(new Date(year + offset, 0, 1).getTime() / 1000)
    };
  }

  return {
    mode: period.mode,
    baseTime: Math.floor(new Date(year, month + offset, 1).getTime() / 1000)
  };
}

export function getReadingStatsDrillPeriod(
  currentMode: ReadingStatsMode,
  timestamp: number
): ReadingStatsPeriod | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  if (currentMode === "overall") {
    return buildReadingStatsPeriod("annually", timestamp);
  }

  if (currentMode === "annually") {
    return buildReadingStatsPeriod("monthly", timestamp);
  }

  return undefined;
}

function fallbackTitle(mode: ReadingStatsMode, variant: ReadingStatsTitleVariant): string {
  if (mode === "weekly") {
    return variant === "review" ? "周度阅读复盘" : "周度阅读报告";
  }

  if (mode === "annually") {
    return variant === "review" ? "年度阅读复盘" : "年度阅读报告";
  }

  return variant === "review" ? "月度阅读复盘" : "月度阅读报告";
}

function fallbackAnchor(mode: ReadingStatsMode): string {
  if (mode === "weekly") {
    return "周度";
  }

  if (mode === "annually") {
    return "年度";
  }

  return "月度";
}

function getPeriodDateParts(timestamp: number): PeriodDateParts | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

export function getCurrentReadingStatsAnchor(mode: ReadingStatsMode, now = new Date()): number {
  if (mode === "overall") {
    return 0;
  }

  if (mode === "annually") {
    return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  }

  if (mode === "monthly") {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }

  const weekDay = now.getDay();
  const mondayOffset = weekDay === 0 ? -6 : 1 - weekDay;
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset).getTime() / 1000
  );
}

function buildReadingStatsPeriodIdentity(
  mode: ReadingStatsMode,
  baseTime: number
): string {
  if (mode === "overall" || baseTime <= 0) {
    return `${mode}:0`;
  }

  const dateParts = getPeriodDateParts(baseTime);
  if (!dateParts) {
    return `${mode}:${baseTime}`;
  }

  if (mode === "annually") {
    return `${mode}:${dateParts.year}`;
  }

  if (mode === "monthly") {
    return `${mode}:${dateParts.year}-${dateParts.month}`;
  }

  return `${mode}:${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}
