import type { CSSProperties, ReactNode } from "react";

export type PreferenceRankItem = {
  key: string;
  title: string;
  meta: string;
  valueText: string;
  shareText: string;
  ratio: number;
};

type PreferenceRankListProps = {
  badge: string;
  emptyDescription: string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  kicker: string;
  items: PreferenceRankItem[];
  title: string;
  ariaLabel: string;
};

export function PreferenceRankList({
  badge,
  emptyDescription,
  emptyIcon,
  emptyTitle,
  kicker,
  items,
  title,
  ariaLabel
}: PreferenceRankListProps) {
  if (items.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label={ariaLabel}>
        {emptyIcon}
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="stats-card preference-card" aria-label={ariaLabel}>
      <div className="stats-card-heading">
        <div>
          <p className="section-kicker">{kicker}</p>
          <h3>{title}</h3>
        </div>
        <span>{badge}</span>
      </div>

      <div className="preference-rank-list stats-scroll-list">
        {items.map((item) => {
          const meterStyle = {
            width: `${Math.max(6, Math.round(item.ratio * 100))}%`
          } satisfies CSSProperties;

          return (
            <article className="preference-rank-item" key={item.key}>
              <div className="preference-rank-copy">
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </div>
              <div className="preference-rank-value">
                <b>{item.valueText}</b>
                <small>{item.shareText}</small>
              </div>
              <i style={meterStyle} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
