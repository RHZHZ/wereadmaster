import { BookOpen, Headphones, Trophy } from "lucide-react";
import { formatDuration } from "../lib/formatters";
import type { ReadingRankItem } from "../lib/types";

type ReadingRankProps = {
  items: ReadingRankItem[];
  variant?: "period" | "overall";
};

export function ReadingRank({ items, variant = "period" }: ReadingRankProps) {
  if (items.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label="暂无阅读排行">
        <Trophy aria-hidden="true" size={28} />
        <h3>暂无排行数据</h3>
        <p>低于接口展示阈值的书籍不会进入 readLongest 排行。</p>
      </section>
    );
  }

  return (
    <section className="stats-card reading-rank" aria-label="长读书目">
      <div role="group" aria-label="读得最多">
        <div className="stats-card-heading">
          <div>
            <p className="section-kicker">读得最多</p>
            <h3>{variant === "overall" ? "长期长读书目" : "本周期最长阅读内容"}</h3>
          </div>
          <span>长读书目</span>
        </div>

        <div className="rank-list stats-scroll-list">
          {items.map((item, index) => (
            <article className="rank-item" key={`${item.type}-${item.id}-${index}`}>
              <span className="rank-index">{index + 1}</span>
              <span className="rank-cover">
                {item.cover ? (
                  <img src={item.cover} alt="" />
                ) : item.type === "album" ? (
                  <Headphones aria-hidden="true" size={24} />
                ) : (
                  <BookOpen aria-hidden="true" size={24} />
                )}
              </span>
              <span className="rank-copy">
                <strong>{item.title}</strong>
                <small>{item.author || (item.type === "album" ? "有声内容" : "电子书")}</small>
                {item.tags && item.tags.length > 0 ? (
                  <span className="rank-tags">{item.tags.join(" · ")}</span>
                ) : null}
              </span>
              <b>{formatDuration(item.readTimeSeconds)}</b>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
