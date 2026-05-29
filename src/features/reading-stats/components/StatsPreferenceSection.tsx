import { CalendarDays, LibraryBig } from "lucide-react";
import { PreferenceRankList } from "../../../components/PreferenceRankList";
import type { ReadingCategory, ReadingStats, ReadingStatsMode } from "../../../lib/types";
import {
  buildAuthorPreferenceRankItems,
  buildCategoryPreferenceRankItems
} from "../stats-preference-helpers";

type StatsPreferenceSectionProps = {
  categories: ReadingCategory[];
  items: ReadingStats["longestItems"];
  mode: ReadingStatsMode;
};

export function StatsPreferenceSection({
  categories,
  items,
  mode
}: StatsPreferenceSectionProps) {
  const isOverallMode = mode === "overall";
  const authorItems = buildAuthorPreferenceRankItems(items);
  const categoryItems = buildCategoryPreferenceRankItems(categories);

  return (
    <>
      <PreferenceRankList
        ariaLabel="作者偏好"
        badge={`${authorItems.length} 位`}
        emptyDescription="当前周期缺少可聚合的作者信息时，这里会保持为空。"
        emptyIcon={<LibraryBig aria-hidden="true" size={28} />}
        emptyTitle="暂无作者偏好"
        items={authorItems}
        kicker="作者偏好"
        title={isOverallMode ? "长期常读作者" : "读得最多的作者"}
      />
      <PreferenceRankList
        ariaLabel="分类偏好"
        badge="最多 8 类"
        emptyDescription="当前周期分类数据不足时，这里会保持为空。"
        emptyIcon={<CalendarDays aria-hidden="true" size={28} />}
        emptyTitle="暂无偏好分类"
        items={categoryItems}
        kicker="偏好分析"
        title={isOverallMode ? "长期分类投入" : "阅读分类偏好"}
      />
    </>
  );
}
