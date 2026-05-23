import { useState } from "react";
import { BookOpen, ChevronRight, Loader2, MoreHorizontal, Sparkles } from "lucide-react";
import { DiscoveryBookCard, DiscoveryLoading } from "./SearchResults";
import type { Recommendation } from "../lib/types";

type RecommendationListProps = {
  kicker: string;
  title: string;
  description: string;
  books: Recommendation[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  emptyTitle: string;
  emptyDescription: string;
  notice?: string;
  guideItems?: string[];
  maxVisible?: number;
  layout?: "stack" | "rail";
  compact?: boolean;
  subdued?: boolean;
  candidateIds?: ReadonlySet<string>;
  savingCandidateIds?: ReadonlySet<string>;
  shelfItemIds?: ReadonlySet<string>;
  onOpenBook: (book: Recommendation) => void;
  onFindSimilar: (book: Recommendation) => void;
  onSaveCandidate?: (book: Recommendation) => void;
  onLoadMore: () => void;
};

export function RecommendationList({
  kicker,
  title,
  description,
  books,
  isLoading,
  isLoadingMore,
  hasMore,
  emptyTitle,
  emptyDescription,
  notice,
  guideItems,
  maxVisible,
  layout = "stack",
  compact = false,
  subdued = false,
  candidateIds,
  savingCandidateIds,
  shelfItemIds,
  onOpenBook,
  onFindSimilar,
  onSaveCandidate,
  onLoadMore
}: RecommendationListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = Boolean(maxVisible && !isExpanded && books.length > maxVisible);
  const visibleBooks = canExpand && maxVisible ? books.slice(0, maxVisible) : books;
  const canLoadMore = hasMore || canExpand;

  if (isLoading && books.length === 0) {
    return <DiscoveryLoading label={title} />;
  }

  return (
    <section
      className={`discovery-card recommendation-list recommendation-list--${layout} ${compact ? "recommendation-list--compact" : ""} ${
        subdued ? "recommendation-list--subdued" : ""
      }`}
      aria-label={title}
    >
      <div className="discovery-card-heading">
        <div>
          <p className="section-kicker">{kicker}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {books.length > 0 ? <span>{books.length} 本</span> : null}
      </div>

      {notice ? <p className="recommendation-notice">{notice}</p> : null}

      {books.length === 0 ? (
        guideItems && guideItems.length > 0 ? (
          <section className="discovery-empty discovery-empty--compact discovery-empty--guide">
            <Sparkles aria-hidden="true" size={24} />
            <div>
              <h3>{emptyTitle}</h3>
              <p>{emptyDescription}</p>
              <ol className="discovery-guide-list">
                {guideItems.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ol>
            </div>
          </section>
        ) : (
          <section className="discovery-empty discovery-empty--compact">
            <Sparkles aria-hidden="true" size={28} />
            <h3>{emptyTitle}</h3>
            <p>{emptyDescription}</p>
          </section>
        )
      ) : (
        <div className="recommendation-stack">
          {visibleBooks.map((book) => (
            layout === "rail" ? (
              <RecommendationRailCard
                key={`${book.bookId}-${book.searchIdx ?? book.reason ?? book.title}`}
                book={book}
                onOpenBook={onOpenBook}
                onFindSimilar={onFindSimilar}
                isCandidate={candidateIds?.has(book.bookId) === true}
                isSavingCandidate={savingCandidateIds?.has(book.bookId) === true}
                isInShelf={shelfItemIds?.has(book.bookId) === true}
                onSaveCandidate={onSaveCandidate}
              />
            ) : (
              <DiscoveryBookCard
                key={`${book.bookId}-${book.searchIdx ?? book.reason ?? book.title}`}
                book={book}
                onOpenBook={onOpenBook}
                onFindSimilar={onFindSimilar}
                isCandidate={candidateIds?.has(book.bookId) === true}
                isSavingCandidate={savingCandidateIds?.has(book.bookId) === true}
                isInShelf={shelfItemIds?.has(book.bookId) === true}
                onSaveCandidate={onSaveCandidate}
              />
            )
          ))}
        </div>
      )}

      {canLoadMore ? (
        <button
          className={compact ? "text-button discovery-load-more discovery-load-more--quiet" : "secondary-action discovery-load-more"}
          type="button"
          onClick={canExpand ? () => setIsExpanded(true) : onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? (
            <Loader2 aria-hidden="true" size={18} className="spin" />
          ) : (
            <ChevronRight aria-hidden="true" size={18} />
          )}
          {isLoadingMore ? "加载中" : canExpand ? `显示全部 ${books.length} 本` : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}

function RecommendationRailCard({
  book,
  isCandidate,
  isSavingCandidate,
  isInShelf,
  onOpenBook,
  onFindSimilar,
  onSaveCandidate
}: {
  book: Recommendation;
  isCandidate: boolean;
  isSavingCandidate: boolean;
  isInShelf: boolean;
  onOpenBook: (book: Recommendation) => void;
  onFindSimilar: (book: Recommendation) => void;
  onSaveCandidate?: (book: Recommendation) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const candidateLabel = isInShelf ? "已在书架" : isCandidate ? "已保存" : isSavingCandidate ? "保存中" : "保存候选";
  const disableCandidate = isInShelf || isCandidate || isSavingCandidate || !onSaveCandidate;

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <article className={`recommendation-rail-card ${book.soldout ? "is-soldout" : ""}`}>
      <button
        className="recommendation-rail-main"
        type="button"
        onClick={() => onOpenBook(book)}
        aria-label={`打开《${book.title}》详情`}
      >
        <span className="recommendation-rail-cover">
          {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={28} />}
        </span>
        <span className="recommendation-rail-copy">
          <strong>{book.title}</strong>
          <small>{book.author || "暂无作者信息"}</small>
          <span className="recommend-rail-reason">{book.reason || book.category || book.publisher || "点击查看详情评分"}</span>
        </span>
      </button>

      <div className="recommendation-rail-menu">
        <button
          className="shelf-card-menu-trigger"
          type="button"
          aria-label={`${book.title} 更多操作`}
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <MoreHorizontal aria-hidden="true" size={18} />
        </button>
        {isMenuOpen ? (
          <div className="shelf-card-menu-popover" role="menu" aria-label={`${book.title} 操作菜单`}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onFindSimilar(book);
                closeMenu();
              }}
            >
              找相似
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disableCandidate}
              onClick={() => {
                onSaveCandidate?.(book);
                closeMenu();
              }}
            >
              {candidateLabel}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
