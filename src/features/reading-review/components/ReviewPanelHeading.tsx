type ReviewPanelHeadingProps = {
  badge: string;
  kicker: string;
  title: string;
};

export function ReviewPanelHeading({ badge, kicker, title }: ReviewPanelHeadingProps) {
  return (
    <div className="stats-card-heading">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h3>{title}</h3>
      </div>
      <span>{badge}</span>
    </div>
  );
}
