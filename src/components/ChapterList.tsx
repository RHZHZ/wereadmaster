import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Lock, Unlock } from "lucide-react";
import type { Chapter, ReadingProgress } from "../lib/types";

const MOBILE_CHAPTER_DIRECTORY_QUERY = "(max-width: 720px)";

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
  const chapterListId = useId();
  const chapterListRef = useRef<HTMLOListElement>(null);
  const currentChapterRef = useRef<HTMLLIElement>(null);
  const previousExpandedRef = useRef<boolean>();
  const [isExpanded, setIsExpanded] = useState(() => getInitialDirectoryExpandedState());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_CHAPTER_DIRECTORY_QUERY);
    const syncExpandedState = () => {
      setIsExpanded(!mediaQuery.matches);
    };

    syncExpandedState();
    mediaQuery.addEventListener("change", syncExpandedState);

    return () => mediaQuery.removeEventListener("change", syncExpandedState);
  }, []);

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = isExpanded;

    if (wasExpanded !== false || !isExpanded || !isMobileDirectoryViewport()) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      const list = chapterListRef.current;
      const currentChapter = currentChapterRef.current;
      if (!list || !currentChapter) {
        return;
      }

      const nextScrollTop =
        currentChapter.offsetTop - Math.max(0, (list.clientHeight - currentChapter.offsetHeight) / 2);
      list.scrollTop = Math.max(0, nextScrollTop);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isExpanded, progress.chapterUid]);

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

  const chapterPanelClassName = `chapter-panel ${isExpanded ? "is-expanded" : "is-collapsed"}`;

  return (
    <section className={chapterPanelClassName} aria-label="目录">
      <div className="panel-heading chapter-panel-heading">
        <div>
          <p className="section-kicker">目录</p>
          <h3>{chapters.length} 个章节</h3>
        </div>
        <div className="chapter-panel-actions">
          <span className="chapter-progress">当前进度 {progress.progressPercent}%</span>
          <button
            className="sync-button chapter-toggle-button"
            type="button"
            aria-controls={chapterListId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? (
              <ChevronUp aria-hidden="true" size={16} />
            ) : (
              <ChevronDown aria-hidden="true" size={16} />
            )}
            {isExpanded ? "收起目录" : "展开目录"}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <ol className="chapter-list" id={chapterListId} ref={chapterListRef}>
          {chapters.map((chapter) => {
            const isCurrent = chapter.chapterUid === progress.chapterUid;

            return (
              <li
                key={`${chapter.bookId}-${chapter.chapterUid}`}
                ref={isCurrent ? currentChapterRef : undefined}
                className={isCurrent ? "is-current" : ""}
              >
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
                    {chapter.paid === false ? (
                      <Lock aria-hidden="true" size={15} />
                    ) : (
                      <Unlock aria-hidden="true" size={15} />
                    )}
                    {isCurrent ? "当前" : "打开"}
                    <ExternalLink aria-hidden="true" size={15} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function getInitialDirectoryExpandedState() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return !window.matchMedia(MOBILE_CHAPTER_DIRECTORY_QUERY).matches;
}

function isMobileDirectoryViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_CHAPTER_DIRECTORY_QUERY).matches
  );
}
