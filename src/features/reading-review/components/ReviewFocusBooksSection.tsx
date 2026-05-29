import { BookOpen, Target, Trophy } from "lucide-react";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingRankItem } from "../../../lib/types";
import { ReviewEmptyBlock } from "./ReviewEmptyBlock";
import { ReviewListCard } from "./ReviewListCard";
import { ReviewPanelHeading } from "./ReviewPanelHeading";

type ReviewFocusBooksSectionProps = {
  aiItems: string[];
  items: ReadingRankItem[];
};

export function ReviewFocusBooksSection({
  aiItems,
  items
}: ReviewFocusBooksSectionProps) {
  return (
    <section className="review-panel" aria-label="重点内容">
      <ReviewPanelHeading kicker="重点内容" title="最值得复盘的书" badge="最多 4 本" />
      <FocusBooks items={items} aiItems={aiItems} />
    </section>
  );
}

function FocusBooks({ items, aiItems }: { items: ReadingRankItem[]; aiItems: string[] }) {
  if (items.length === 0 && aiItems.length === 0) {
    return <ReviewEmptyBlock icon={<Trophy aria-hidden="true" size={22} />} text="暂无重点内容。" />;
  }

  return (
    <div className="review-focus-grid">
      {items.slice(0, 4).map((item, index) => (
        <article className="review-focus-book" key={`${item.id}-${index}`}>
          <span className="rank-cover">
            {item.cover ? <img src={item.cover} alt="" /> : <BookOpen aria-hidden="true" size={24} />}
          </span>
          <div>
            <strong>{item.title}</strong>
            <small>{item.author || (item.type === "album" ? "有声内容" : "电子书")}</small>
            <b>{formatDuration(item.readTimeSeconds)}</b>
          </div>
        </article>
      ))}
      {aiItems.length > 0 ? (
        <ReviewListCard
          title="AI 重点解释"
          icon={<Target aria-hidden="true" size={18} />}
          items={aiItems}
          emptyText=""
        />
      ) : null}
    </div>
  );
}
