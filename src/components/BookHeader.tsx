import { BookOpen, Clock3, ExternalLink, Loader2, Sparkles, Star } from "lucide-react";
import { formatDuration, formatProgress, formatRating, formatUnixDate } from "../lib/formatters";
import type { BookDetail, Chapter, ReadingProgress, ShelfEntry } from "../lib/types";

type BookHeaderProps = {
  detail: BookDetail;
  progress: ReadingProgress;
  currentChapter?: Chapter;
  shelfEntry?: ShelfEntry;
  isOpening: boolean;
  onOpenInWeread: () => void;
  onFindSimilar?: () => void;
};

export function BookHeader({
  detail,
  progress,
  currentChapter,
  shelfEntry,
  isOpening,
  onOpenInWeread,
  onFindSimilar
}: BookHeaderProps) {
  const progressText = formatProgress(progress.progressPercent);
  const lastReadText = progress.updatedAt ? formatUnixDate(progress.updatedAt) : "暂无记录";
  const finishText = progress.finishTime ? formatUnixDate(progress.finishTime) : "";

  return (
    <section className="book-header" aria-label="书籍概览">
      <div className="book-cover-large">
        {detail.cover || shelfEntry?.cover ? (
          <img src={detail.cover || shelfEntry?.cover} alt="" />
        ) : (
          <BookOpen aria-hidden="true" size={52} />
        )}
      </div>

      <div className="book-header-copy">
        <p className="section-kicker">{detail.category || shelfEntry?.category || "微信读书"}</p>
        <h3>{detail.title}</h3>
        <p className="book-author">
          {[detail.author, detail.translator ? `译者 ${detail.translator}` : undefined]
            .filter(Boolean)
            .join(" · ") || "暂无作者信息"}
        </p>

        <div className="book-meta-row" aria-label="书籍元信息">
          <span>
            <Star aria-hidden="true" size={16} />
            {formatRating(detail.ratingPercent)}
            {detail.ratingCount ? ` / ${detail.ratingCount} 人评分` : ""}
          </span>
          <span>
            <Clock3 aria-hidden="true" size={16} />
            累计 {formatDuration(progress.recordReadingTimeSeconds)}
          </span>
          <span>{progress.isFinished ? `已读完 ${finishText}` : `最近阅读 ${lastReadText}`}</span>
        </div>

        <div className="progress-block" aria-label="阅读进度">
          <div>
            <strong>{progressText}</strong>
            <span>{progress.isFinished ? "已完成" : progress.isStarted ? "阅读中" : "未开始"}</span>
          </div>
          {currentChapter && !progress.isFinished ? (
            <span className="current-chapter-label">当前章节：{currentChapter.title}</span>
          ) : null}
          <meter min="0" max="100" value={progress.progressPercent}>
            {progressText}
          </meter>
        </div>

        <div className="book-actions">
          <button className="secondary-action" type="button" onClick={onOpenInWeread} disabled={isOpening}>
            {isOpening ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <ExternalLink aria-hidden="true" size={18} />}
            {isOpening ? "正在打开" : "在微信读书中打开"}
          </button>
          {onFindSimilar ? (
            <button className="sync-button" type="button" onClick={onFindSimilar}>
              <Sparkles aria-hidden="true" size={18} />
              找相似书
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
