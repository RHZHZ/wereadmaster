import type { ReadingStatsMode } from "../../lib/types";
import {
  buildReadingStatsPeriod,
  type ReadingStatsPeriod
} from "../../pages/reading-stats-period";
import {
  buildAnnualJumpPeriod,
  buildMonthlyJumpPeriod,
  buildReadingStatsJumpMonthOptions,
  buildReadingStatsJumpWeekOptions,
  buildWeeklyJumpPeriod,
  type ReadingStatsJumpWeekOption
} from "../../pages/reading-stats-period-options";

export type ReportGenerationPeriodMode = Exclude<ReadingStatsMode, "overall">;

type ReportGenerationPeriodSelection = {
  period: ReadingStatsPeriod;
  selectedMonth: number;
};

export function buildReportGenerationPeriodSelection({
  mode,
  preferredWeekBaseTime,
  selectedMonth,
  selectedYear,
  now = new Date()
}: {
  mode: ReadingStatsMode;
  preferredWeekBaseTime: number;
  selectedMonth: number;
  selectedYear: number;
  now?: Date;
}): ReportGenerationPeriodSelection {
  if (mode === "overall") {
    return {
      period: buildReadingStatsPeriod("overall"),
      selectedMonth
    };
  }

  if (mode === "annually") {
    return {
      period: buildAnnualJumpPeriod(selectedYear),
      selectedMonth
    };
  }

  const nextMonth = resolveEnabledReportMonth(selectedYear, selectedMonth, now);

  if (mode === "monthly") {
    return {
      period: buildMonthlyJumpPeriod(selectedYear, nextMonth),
      selectedMonth: nextMonth
    };
  }

  const nextWeek = resolveEnabledReportWeek(selectedYear, nextMonth, preferredWeekBaseTime, now);
  return {
    period: nextWeek ? buildWeeklyJumpPeriod(nextWeek.baseTime) : buildReadingStatsPeriod("weekly"),
    selectedMonth: nextMonth
  };
}

export function resolveEnabledReportMonth(
  year: number,
  preferredMonth: number,
  now = new Date()
): number {
  const enabledMonths = buildReadingStatsJumpMonthOptions(year, now).filter((option) => !option.disabled);
  if (enabledMonths.some((option) => option.month === preferredMonth)) {
    return preferredMonth;
  }

  return enabledMonths[enabledMonths.length - 1]?.month ?? preferredMonth;
}

export function resolveEnabledReportWeek(
  year: number,
  month: number,
  preferredBaseTime: number,
  now = new Date()
): ReadingStatsJumpWeekOption | undefined {
  const enabledWeeks = buildReadingStatsJumpWeekOptions(year, month, now).filter((option) => !option.disabled);
  return enabledWeeks.find((option) => option.baseTime === preferredBaseTime) ?? enabledWeeks[enabledWeeks.length - 1];
}
