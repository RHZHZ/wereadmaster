import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

type ReviewListCardProps = {
  emptyText: string;
  icon: ReactNode;
  items: string[];
  title: string;
};

export function ReviewListCard({ emptyText, icon, items, title }: ReviewListCardProps) {
  return (
    <section className="review-list-card">
      <h4>
        {icon}
        {title}
      </h4>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>
              <CheckCircle2 aria-hidden="true" size={15} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}
