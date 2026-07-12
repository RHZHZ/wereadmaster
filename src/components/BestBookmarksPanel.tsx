import { AlertCircle, Highlighter, Loader2, MessageSquare, RefreshCw, Users } from "lucide-react";
import { formatUnixDate } from "../lib/formatters";
import type { CommandErrorInfo } from "../lib/reading-api";
import type { BestBookmark, BestBookmarksResult, ReadReviewsResult } from "../lib/types";
import { SkillUpgradeNotice } from "./SkillUpgradeNotice";

type BestBookmarksPanelProps = {
  result?: BestBookmarksResult;
  isLoading: boolean;
  error?: CommandErrorInfo;
  hasRequested: boolean;
  readReviewsByBookmarkId?: Record<string, ReadReviewsResult | undefined>;
  readReviewErrorsByBookmarkId?: Record<string, CommandErrorInfo | undefined>;
  readReviewsLoadingBookmarkId?: string;
  onLoad: () => void;
  onLoadReadReviews?: (bookmark: BestBookmark) => void;
};

export function BestBookmarksPanel({
  result,
  isLoading,
  error,
  hasRequested,
  readReviewsByBookmarkId = {},
  readReviewErrorsByBookmarkId = {},
  readReviewsLoadingBookmarkId,
  onLoad,
  onLoadReadReviews
}: BestBookmarksPanelProps) {
  if (error?.code === "upgrade_required") {
    return (
      <SkillUpgradeNotice
        error={error}
        onRetry={onLoad}
        className="public-content-panel best-bookmarks-panel"
      />
    );
  }

  const bookmarks = result?.items ?? [];
  const shouldShowInitialState = !hasRequested && bookmarks.length === 0 && !error && !isLoading;
  const actionLabel = isLoading ? "加载中" : hasRequested || result ? "刷新划线" : "加载热门划线";

  return (
    <section className="public-content-panel best-bookmarks-panel" aria-label="热门划线">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">热门划线</p>
          <h3>读者共同划过的句子</h3>
          <p>来自微信读书公开内容，不属于你的个人划线。</p>
        </div>
        <button className="secondary-action" type="button" onClick={onLoad} disabled={isLoading}>
          {isLoading ? <Loader2 aria-hidden="true" size={16} className="spin" /> : <RefreshCw aria-hidden="true" size={16} />}
          {actionLabel}
        </button>
      </div>

      {shouldShowInitialState ? (
        <div className="public-content-empty">
          <Highlighter aria-hidden="true" size={24} />
          <strong>尚未加载公开热门划线</strong>
          <span>公开内容与个人笔记保持分离。</span>
        </div>
      ) : null}

      {error ? (
        <div className="public-content-status is-error" role="status">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{formatBestBookmarksError(error)}</span>
        </div>
      ) : null}

      {isLoading && bookmarks.length === 0 ? (
        <div className="public-content-status" role="status">
          <Loader2 aria-hidden="true" size={18} className="spin" />
          <span>正在读取热门划线</span>
        </div>
      ) : null}

      {hasRequested && !isLoading && !error && bookmarks.length === 0 ? (
        <div className="public-content-empty">
          <Highlighter aria-hidden="true" size={24} />
          <strong>暂无可展示热门划线</strong>
          <span>可以先查看个人笔记或目录定位下一步阅读。</span>
        </div>
      ) : null}

      {bookmarks.length > 0 ? (
        <ul className="public-content-list best-bookmark-list">
          {bookmarks.slice(0, 5).map((bookmark) => (
            <BestBookmarkItem
              key={bookmark.bookmarkId}
              bookmark={bookmark}
              readReviews={readReviewsByBookmarkId[bookmark.bookmarkId]}
              readReviewsError={readReviewErrorsByBookmarkId[bookmark.bookmarkId]}
              isReadReviewsLoading={readReviewsLoadingBookmarkId === bookmark.bookmarkId}
              onLoadReadReviews={onLoadReadReviews}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function BestBookmarkItem({
  bookmark,
  readReviews,
  readReviewsError,
  isReadReviewsLoading,
  onLoadReadReviews
}: {
  bookmark: BestBookmark;
  readReviews?: ReadReviewsResult;
  readReviewsError?: CommandErrorInfo;
  isReadReviewsLoading: boolean;
  onLoadReadReviews?: (bookmark: BestBookmark) => void;
}) {
  const countText = formatBookmarkCount(bookmark.totalCount);
  const canLoadReadReviews = Boolean(onLoadReadReviews && bookmark.range && bookmark.chapterUid !== undefined);
  const reviewButtonLabel = readReviews || readReviewsError ? "刷新共读想法" : "查看共读想法";

  return (
    <li className="public-content-item best-bookmark-item">
      <div className="public-content-meta">
        {bookmark.chapterTitle ? <strong>{bookmark.chapterTitle}</strong> : <strong>未分章节</strong>}
        {countText ? (
          <span>
            <Users aria-hidden="true" size={14} />
            {countText}
          </span>
        ) : null}
      </div>
      <p className="best-bookmark-quote">{bookmark.markText}</p>
      {canLoadReadReviews ? (
        <button
          className="text-button read-reviews-toggle"
          type="button"
          onClick={() => onLoadReadReviews?.(bookmark)}
          disabled={isReadReviewsLoading}
        >
          {isReadReviewsLoading ? <Loader2 aria-hidden="true" size={14} className="spin" /> : <MessageSquare aria-hidden="true" size={14} />}
          {isReadReviewsLoading ? "加载中" : reviewButtonLabel}
        </button>
      ) : null}
      {readReviewsError ? (
        <div className="public-content-status is-error read-reviews-status" role="status">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{formatReadReviewsError(readReviewsError)}</span>
        </div>
      ) : null}
      {isReadReviewsLoading && !readReviews ? (
        <div className="public-content-status read-reviews-status" role="status">
          <Loader2 aria-hidden="true" size={16} className="spin" />
          <span>正在读取共读想法</span>
        </div>
      ) : null}
      {readReviews ? <ReadReviewsList result={readReviews} /> : null}
    </li>
  );
}

function ReadReviewsList({ result }: { result: ReadReviewsResult }) {
  const reviews = result.reviews.slice(0, 5);

  if (reviews.length === 0) {
    return (
      <div className="public-content-empty read-reviews-empty">
        <MessageSquare aria-hidden="true" size={20} />
        <strong>暂无可展示共读想法</strong>
        <span>这条热门划线下还没有可展示的公开想法。</span>
      </div>
    );
  }

  return (
    <div className="read-reviews-inline" aria-label="共读想法">
      <div className="read-reviews-inline-heading">
        <strong>共读想法</strong>
        <span>不属于你的个人笔记</span>
      </div>
      <ul>
        {reviews.map((review) => {
          const authorName = review.author?.name || "微信读书用户";
          const timeText = review.createTime ? formatUnixDate(review.createTime) : undefined;

          return (
            <li key={review.reviewId}>
              <div className="public-content-meta">
                <strong>{authorName}</strong>
                {timeText ? <span>{timeText}</span> : null}
              </div>
              <p className="read-review-body">{review.content}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatBookmarkCount(totalCount?: number): string | undefined {
  if (!totalCount || totalCount < 1) {
    return undefined;
  }

  return `${Math.trunc(totalCount)} 人划过`;
}

function formatBestBookmarksError(error: CommandErrorInfo): string {
  return error.detail && error.detail !== error.message
    ? `${error.message} 诊断：${error.detail}`
    : error.message;
}

function formatReadReviewsError(error: CommandErrorInfo): string {
  const message = formatBestBookmarksError(error);

  return error.code === "upgrade_required" ? `微信读书 Skill 需要升级：${message}` : message;
}
