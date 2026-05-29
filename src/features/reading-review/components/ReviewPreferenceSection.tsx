import { useId } from "react";
import { Compass } from "lucide-react";
import type { ReadingCategory } from "../../../lib/types";
import { ChartTooltip } from "../../../components/chart-tooltip/ChartTooltip";
import { useChartTooltip } from "../../../components/chart-tooltip/useChartTooltip";
import { formatReviewCategoryValue } from "../review-formatters";
import { ReviewEmptyBlock } from "./ReviewEmptyBlock";
import { ReviewListCard } from "./ReviewListCard";
import { ReviewPanelHeading } from "./ReviewPanelHeading";

type ReviewPreferenceSectionProps = {
  aiItems: string[];
  categories: ReadingCategory[];
};

export function ReviewPreferenceSection({
  aiItems,
  categories
}: ReviewPreferenceSectionProps) {
  return (
    <section className="review-panel" aria-label="偏好地图">
      <ReviewPanelHeading kicker="偏好地图" title="主题投入结构" badge="分类偏好" />
      <PreferenceMap categories={categories} />
      <ReviewListCard
        title="AI 偏好解释"
        icon={<Compass aria-hidden="true" size={18} />}
        items={aiItems}
        emptyText="生成复盘后会解释你把时间投向了哪些主题。"
      />
    </section>
  );
}

function PreferenceMap({ categories }: { categories: ReadingCategory[] }) {
  if (categories.length === 0) {
    return <ReviewEmptyBlock icon={<Compass aria-hidden="true" size={22} />} text="暂无分类偏好。" />;
  }

  const visibleCategories = categories.slice(0, 8);
  const tooltipId = useId();
  const { containerRef, getTriggerProps, isActive } = useChartTooltip<string, HTMLDivElement>();
  const maxValue = Math.max(
    ...visibleCategories.map((category) => category.readingTimeSeconds ?? category.value ?? 0),
    1
  );
  const totalValue = visibleCategories.reduce(
    (sum, category) => sum + (category.readingTimeSeconds ?? category.value ?? 0),
    0
  );

  return (
    <div className="review-preference-map" ref={containerRef}>
      {visibleCategories.map((category, index) => {
        const value = category.readingTimeSeconds ?? category.value ?? 0;
        const size = 74 + Math.round((value / maxValue) * 88);
        const key = `${category.categoryId ?? category.title}-${index}`;
        const share = totalValue > 0 ? Math.max(1, Math.round((value / totalValue) * 100)) : 0;
        const isCurrent = isActive(key);

        return (
          <button
            type="button"
            className={`review-preference-bubble${isCurrent ? " is-active" : ""}`}
            key={key}
            style={{ width: size, height: size }}
            aria-label={`${category.title} ${formatReviewCategoryValue(category)}`}
            {...getTriggerProps(key, `${tooltipId}-${key}`)}
          >
            {isCurrent ? (
              <ChartTooltip
                align={resolvePreferenceTooltipAlign(index, visibleCategories.length)}
                badge={value === maxValue && value > 0 ? "最高投入" : undefined}
                className="review-preference-tooltip"
                id={`${tooltipId}-${key}`}
                rows={buildPreferenceTooltipRows(category, share)}
                title={category.title}
              />
            ) : null}
            <strong>{category.title}</strong>
            <small>{formatReviewCategoryValue(category)}</small>
          </button>
        );
      })}
    </div>
  );
}

function buildPreferenceTooltipRows(category: ReadingCategory, share: number) {
  const rows = [
    {
      label: category.readingTimeSeconds !== undefined ? "阅读时长" : "偏好值",
      value: formatReviewCategoryValue(category),
      tone: "accent" as const
    },
    {
      label: "可视占比",
      value: `${share}%`
    }
  ];

  if (category.parentTitle) {
    rows.push({
      label: "所属分类",
      value: category.parentTitle
    });
  }

  return rows;
}

function resolvePreferenceTooltipAlign(
  index: number,
  total: number
): "start" | "center" | "end" {
  if (index === 0) {
    return "start";
  }

  if (index === total - 1) {
    return "end";
  }

  return "center";
}
