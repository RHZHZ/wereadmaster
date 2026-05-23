import { ExternalLink, Lock, Unlock } from "lucide-react";
import type { Chapter, ReadingProgress } from "../lib/types";

type ChapterListProps = {
  chapters: Chapter[];
  progress: ReadingProgress;
  isOpening: boolean;
  onOpenChapter: (chapterUid: number) => void;
};

export function ChapterList({
  chapters,
  progress,
  isOpening,
  onOpenChapter
}: ChapterListProps) {
  if (chapters.length === 0) {
    return (
      <section className="chapter-panel" aria-label="目录">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">目录</p>
            <h3>暂未获取到章节</h3>
          </div>
        </div>
        <p className="muted-copy">这本书可能暂时没有目录数据，或微信读书接口没有返回章节列表。</p>
      </section>
    );
  }

  return (
    <section className="chapter-panel" aria-label="目录">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">目录</p>
          <h3>{chapters.length} 个章节</h3>
        </div>
        <span className="chapter-progress">当前进度 {progress.progressPercent}%</span>
      </div>

      <ol className="chapter-list">
        {chapters.map((chapter) => {
          const isCurrent = chapter.chapterUid === progress.chapterUid;

          return (
            <li key={`${chapter.bookId}-${chapter.chapterUid}`} className={isCurrent ? "is-current" : ""}>
              <button
                type="button"
                onClick={() => onOpenChapter(chapter.chapterUid)}
                disabled={isOpening}
                style={{ paddingLeft: `${Math.max(chapter.level - 1, 0) * 18 + 14}px` }}
              >
                <span className="chapter-title">
                  <strong>{chapter.title}</strong>
                  <small>
                    第 {chapter.chapterIdx || "-"} 章
                    {chapter.wordCount ? ` · ${chapter.wordCount} 字` : ""}
                    {chapter.isMPChapter ? " · 公众号章节" : ""}
                  </small>
                </span>
                <span className="chapter-flags">
                  {chapter.paid === false ? <Lock aria-hidden="true" size={15} /> : <Unlock aria-hidden="true" size={15} />}
                  {isCurrent ? "当前" : "打开"}
                  <ExternalLink aria-hidden="true" size={15} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
