import type { ReadingStatsCache, ReadingStatsPeriod } from "./reading-stats-period";
import {
  buildReadingStatsPeriod,
  getCurrentReadingStatsAnchor
} from "./reading-stats-period";

const DEFAULT_LOOKBACK_YEARS = 10;

export type ReadingStatsJumpMonthOption = {
  baseTime: number;
  disabled: boolean;
  label: string;
  month: number;
};

export type ReadingStatsJumpWeekOption = {
  baseTime: number;
  disabled: boolean;
  label: string;
};

type JumpSelection = {
  month: number;
  year: number;
};

export function buildReadingStatsJumpYearOptions(
  cache: ReadingStatsCache,
  now = new Date(),
  lookbackYears = DEFAULT_LOOKBACK_YEARS
): number[] {
  const currentYear = now.getFullYear();
  let earliestYear = currentYear - lookbackYears + 1;

  for (const response of Object.values(cache)) {
    const baseTime = response.stats.baseTime;
    if (!Number.isFinite(baseTime) || baseTime <= 0) {
      continue;
    }

    earliestYear = Math.min(earliestYear, new Date(baseTime * 1000).getFullYear());
  }

  const years: number[] = [];
  for (let year = currentYear; year >= earliestYear; year -= 1) {
    years.push(year);
  }

  return years;
}

export function buildReadingStatsJumpMonthOptions(
  year: number,
  now = new Date()
): ReadingStatsJumpMonthOption[] {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      month,
      label: `${month} 月`,
      baseTime: toLocalTimestamp(year, index, 1),
      disabled: year > currentYear || (year === currentYear && month > currentMonth)
    };
  });
}

export function buildReadingStatsJumpWeekOptions(
  year: number,
  month: number,
  now = new Date()
): ReadingStatsJumpWeekOption[] {
  const monthIndex = month - 1;
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const firstWeekday = monthStart.getDay();
  const mondayOffset = firstWeekday === 0 ? -6 : 1 - firstWeekday;
  const currentWeekAnchor = getCurrentReadingStatsAnchor("weekly", now);
  const weeks: ReadingStatsJumpWeekOption[] = [];
  let cursor = new Date(year, monthIndex, 1 + mondayOffset);

  while (cursor <= monthEnd) {
    const weekEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6);

    if (weekEnd >= monthStart) {
      const baseTime = Math.floor(cursor.getTime() / 1000);
      weeks.push({
        baseTime,
        label: `${cursor.getMonth() + 1} 月 ${cursor.getDate()} 日当周`,
        disabled: baseTime > currentWeekAnchor
      });
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }

  return weeks;
}

export function deriveReadingStatsJumpSelection(
  activePeriod: ReadingStatsPeriod,
  now = new Date()
): JumpSelection {
  if (!Number.isFinite(activePeriod.baseTime) || activePeriod.baseTime <= 0) {
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    };
  }

  const reference = new Date(activePeriod.baseTime * 1000);
  return {
    year: reference.getFullYear(),
    month: reference.getMonth() + 1
  };
}

export function buildAnnualJumpPeriod(year: number): ReadingStatsPeriod {
  return buildReadingStatsPeriod("annually", toLocalTimestamp(year, 0, 1));
}

export function buildMonthlyJumpPeriod(year: number, month: number): ReadingStatsPeriod {
  return buildReadingStatsPeriod("monthly", toLocalTimestamp(year, month - 1, 1));
}

export function buildWeeklyJumpPeriod(baseTime: number): ReadingStatsPeriod {
  return buildReadingStatsPeriod("weekly", baseTime);
}

function toLocalTimestamp(year: number, monthIndex: number, day: number): number {
  return Math.floor(new Date(year, monthIndex, day).getTime() / 1000);
}
