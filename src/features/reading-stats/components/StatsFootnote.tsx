import { formatUnixDate } from "../../../lib/formatters";
import type { ReadingStatsMode } from "../../../lib/types";
import {
  buildReadingStatsPeriod,
  formatReadingStatsPeriodMetricLabel
} from "../../../pages/reading-stats-period";

type StatsFootnoteProps = {
  baseTime: number;
  mode: ReadingStatsMode;
};

export function StatsFootnote({ baseTime, mode }: StatsFootnoteProps) {
  return (
    <section className="stats-footnote">
      <strong>口径说明</strong>
      <p>
        当前周期：{formatReadingStatsPeriodMetricLabel(buildReadingStatsPeriod(mode, baseTime))}；
        {baseTime > 0 ? `统计基准日 ${formatUnixDate(baseTime) || "未知"}` : "总计口径覆盖全部历史"}。
        总时长、阅读天数、趋势变化和分类偏好都来自微信读书的结构化统计缓存。
      </p>
    </section>
  );
}
