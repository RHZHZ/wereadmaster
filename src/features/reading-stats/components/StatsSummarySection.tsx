import type { ReactNode } from "react";
import {
  CalendarDays,
  Clock3,
  LibraryBig,
  Target,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { MetricSparkline } from "../../../components/MetricSparkline";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingStats } from "../../../lib/types";
import type { StatsSummarySparklineSeries } from "../stats-sparkline-helpers";
import { categoryValue } from "../stats-preference-helpers";

type StatsSummarySectionProps = {
  isOverallMode: boolean;
  sparklineSeries: StatsSummarySparklineSeries;
  stats?: ReadingStats;
};

export function StatsSummarySection({
  isOverallMode,
  sparklineSeries,
  stats
}: StatsSummarySectionProps) {
  return (
    <section className="stats-summary-row" aria-label="统计摘要">
      {isOverallMode ? (
        <>
          <StatTile
            icon={<Clock3 aria-hidden="true" size={20} />}
            label="累计时长"
            value={formatDuration(stats?.totalReadTimeSeconds)}
            detail="全部历史累计成果"
          />
          <StatTile
            icon={<CalendarDays aria-hidden="true" size={20} />}
            label="长期阅读天数"
            value={`${stats?.readDays ?? 0}天`}
            detail="长期持续投入记录"
          />
          <StatTile
            icon={<Target aria-hidden="true" size={20} />}
            label="代表方向"
            value={getTopCategoryTitle(stats)}
            detail="长期投入最高分类"
          />
          <StatTile
            icon={<LibraryBig aria-hidden="true" size={20} />}
            label="长读书目"
            value={`${stats?.longestItems.length ?? 0}本`}
            detail="长期高投入内容"
          />
        </>
      ) : (
        <>
          <StatTile
            icon={<Clock3 aria-hidden="true" size={20} />}
            label="总时长"
            value={formatDuration(stats?.totalReadTimeSeconds)}
            detail="按当前周期累计"
            sparklineTone="green"
            sparklineValues={sparklineSeries.totalReadTimeSeconds.values}
          />
          <StatTile
            icon={<CalendarDays aria-hidden="true" size={20} />}
            label="阅读天数"
            value={`${stats?.readDays ?? 0}天`}
            detail="单日满 1 分钟计入"
            sparklineTone="green"
            sparklineValues={sparklineSeries.readDays.values}
          />
          <StatTile
            icon={<Clock3 aria-hidden="true" size={20} />}
            label="自然日均"
            value={formatDuration(stats?.dayAverageReadTimeSeconds)}
            detail="不是阅读日均"
            sparklineTone="neutral"
            sparklineValues={sparklineSeries.averageReadTimeSeconds.values}
          />
          <StatTile
            icon={compareIcon(stats?.compare)}
            label="环比"
            value={formatCompare(stats?.compare)}
            detail="只在接口返回时展示"
            sparklineTone={(stats?.compare ?? 0) < 0 ? "gold" : "green"}
            sparklineValues={sparklineSeries.compare.values}
          />
        </>
      )}
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
  sparklineTone,
  sparklineValues
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  sparklineTone?: "green" | "gold" | "neutral";
  sparklineValues?: number[];
}) {
  return (
    <article className="stats-tile">
      <span className="stats-tile-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      <MetricSparkline tone={sparklineTone} values={sparklineValues ?? []} />
    </article>
  );
}

function getTopCategoryTitle(stats?: ReadingStats): string {
  const topCategory = stats?.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];

  return topCategory?.title ?? "暂无";
}

function formatCompare(compare?: number): string {
  if (!Number.isFinite(compare) || compare === undefined) {
    return "暂无";
  }

  const percent = Math.round(Math.abs(compare) * 100);

  if (compare > 0) {
    return `+${percent}%`;
  }

  if (compare < 0) {
    return `-${percent}%`;
  }

  return "持平";
}

function compareIcon(compare?: number) {
  if ((compare ?? 0) < 0) {
    return <TrendingDown aria-hidden="true" size={20} />;
  }

  return <TrendingUp aria-hidden="true" size={20} />;
}
