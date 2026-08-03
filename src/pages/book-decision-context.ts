import type {
  BookDecisionRecentReadingContext,
  ShelfEntry
} from "../lib/types";
import type { ReadingStatsCache } from "./reading-stats-period";
import { getLatestReadingStatsResponse } from "./reading-stats-period";

export const recentReadingWindows = [30, 60, 90, 180, 365] as const;
const secondsPerDay = 86_400;

export type RecentReadingManualWindow = (typeof recentReadingWindows)[number];
export type RecentReadingWindowMode = "auto" | RecentReadingManualWindow;

export const recentReadingWindowOptions: Array<{
  value: RecentReadingWindowMode;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  ...recentReadingWindows.map((days) => ({ value: days, label: `${days} 天` }))
];

export type RecentReadingContext = {
  count: number;
  label: string;
  mode: RecentReadingWindowMode;
  windowDays?: number;
};

export function getRecentReadingContext(
  entries: ShelfEntry[],
  nowSeconds = Math.floor(Date.now() / 1000),
  mode: RecentReadingWindowMode = "auto"
): RecentReadingContext {
  const readTimestamps = entries
    .filter((entry) => entry.type === "book")
    .map((entry) => entry.lastReadAt)
    .filter((lastReadAt): lastReadAt is number => typeof lastReadAt === "number" && lastReadAt > 0);

  if (mode !== "auto") {
    const count = countRecordsInWindow(readTimestamps, nowSeconds, mode);

    return {
      count,
      label:
        count > 0
          ? `近 ${mode} 天有 ${count} 本阅读记录`
          : `近 ${mode} 天暂无阅读记录，不纳入近期上下文`,
      mode,
      windowDays: mode
    };
  }

  for (const windowDays of recentReadingWindows) {
    const count = countRecordsInWindow(readTimestamps, nowSeconds, windowDays);

    if (count > 0) {
      return {
        count,
        label:
          windowDays === recentReadingWindows[0]
            ? `近 ${windowDays} 天有 ${count} 本阅读记录`
            : `自动：退避到近 ${windowDays} 天，${count} 本阅读记录`,
        mode,
        windowDays
      };
    }
  }

  return {
    count: 0,
    label: "自动：近 365 天无阅读记录，暂不使用近期上下文",
    mode
  };
}

export function buildBookDecisionRecentReadingContext(
  entries: ShelfEntry[],
  statsCache: ReadingStatsCache,
  windowDays: number | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): BookDecisionRecentReadingContext {
  const since = windowDays ? nowSeconds - windowDays * secondsPerDay : undefined;
  const finishedTitles = entries
    .filter(
      (entry) =>
        entry.type === "book" &&
        entry.isFinished === true &&
        typeof entry.lastReadAt === "number" &&
        entry.lastReadAt > 0 &&
        entry.lastReadAt <= nowSeconds &&
        (since === undefined || entry.lastReadAt >= since)
    )
    .sort((left, right) => {
      const timeDifference = (right.lastReadAt ?? 0) - (left.lastReadAt ?? 0);
      return timeDifference || left.title.localeCompare(right.title, "zh-Hans-CN");
    })
    .map((entry) => entry.title.trim())
    .filter(Boolean)
    .slice(0, 5);
  const stats =
    getLatestReadingStatsResponse(statsCache, "monthly")?.stats ??
    getLatestReadingStatsResponse(statsCache, "overall")?.stats;
  const activeCategories = (stats?.categories ?? [])
    .map((category) => ({
      name: category.title.trim(),
      minutes: Math.max(0, Math.round((category.readingTimeSeconds ?? 0) / 60))
    }))
    .filter((category) => category.name && category.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name, "zh-Hans-CN"))
    .slice(0, 5);

  return {
    finishedTitles,
    activeCategories,
    averageDailyMinutes: Math.max(
      0,
      Math.round((stats?.dayAverageReadTimeSeconds ?? 0) / 60)
    )
  };
}

function countRecordsInWindow(
  readTimestamps: number[],
  nowSeconds: number,
  windowDays: RecentReadingManualWindow
) {
  const since = nowSeconds - windowDays * secondsPerDay;
  return readTimestamps.filter((lastReadAt) => lastReadAt >= since && lastReadAt <= nowSeconds).length;
}
