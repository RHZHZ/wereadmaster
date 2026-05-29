import { Lightbulb, ListChecks } from "lucide-react";
import { ReviewListCard } from "./ReviewListCard";
import { ReviewPanelHeading } from "./ReviewPanelHeading";

type ReviewActionsSectionProps = {
  items: string[];
};

export function ReviewActionsSection({ items }: ReviewActionsSectionProps) {
  return (
    <section className="review-panel review-action-panel" aria-label="下一步行动">
      <ReviewPanelHeading kicker="行动建议" title="把复盘变成安排" badge="可执行" />
      <ReviewListCard
        title="下一步行动"
        icon={<ListChecks aria-hidden="true" size={18} />}
        items={items}
        emptyText="生成复盘后会给出 3-5 条可执行建议。"
      />
      <div className="review-action-note">
        <Lightbulb aria-hidden="true" size={18} />
        <span>建议只保留少数行动项，避免把复盘变成新的待办压力。</span>
      </div>
    </section>
  );
}
