import {
  BookOpen,
  ChevronRight,
  Layers3,
  Loader2,
  SearchX,
  Sparkles,
  Star
} from "lucide-react";
import { formatRating } from "../lib/formatters";
import type { Recommendation, SearchBooksResult, SearchResult } from "../lib/types";

type SearchResultsProps = {
  result?: SearchBooksResult;
  isLoading: boolean;
  isLoadingMore: boolean;
  kicker?: string;
  heading?: string;
  candidateIds?: ReadonlySet<string>;
  savingCandidateIds?: ReadonlySet<string>;
  shelfItemIds?: ReadonlySet<string>;
  onOpenBook: (book: SearchResult) => void;
  onFindSimilar: (book: SearchResult) => void;
  onSaveCandidate?: (book: SearchResult) => void;
  onLoadMore: () => void;
  onUseSuggestion: (keyword: string) => void;
};

const starterCards = [
  {
    title: "按主题找书",
    description: "输入“心理学”“时间管理”“科幻”等主题，先铺开候选书。"
  },
  {
    title: "按作者追踪",
    description: "直接搜索作者名，再从结果里进入详情或找相似。"
  },
  {
    title: "从一本书扩展",
    description: "在任意书卡点击“找相似”，把阅读口味继续延伸。"
  }
];

const starterSuggestions = ["三体", "东野圭吾", "时间管理", "心理学", "听书", "AI"];

export function SearchResults({
  result,
  isLoading,
  isLoadingMore,
  kicker = "搜索结果",
  heading,
  candidateIds,
  savingCandidateIds,
  shelfItemIds,
  onOpenBook,
  onFindSimilar,
  onSaveCandidate,
  onLoadMore,
  onUseSuggestion
}: SearchResultsProps) {
  const books = result?.results ?? [];

  if (isLoading && books.length === 0) {
    return <DiscoveryLoading label="正在搜索微信读书" />;
  }

  if (!result) {
    return (
      <section className="discovery-card discovery-starter" aria-label="发现起步">
        <div className="discovery-starter-head">
          <span className="discovery-starter-icon">
            <Sparkles aria-hidden="true" size={22} />
          </span>
          <div>
            <p className="section-kicker">发现起步</p>
            <h3>先确定一个寻找方向</h3>
            <p>搜索、推荐和相似书会汇到这里，适合用来整理下一批想读的书。</p>
          </div>
        </div>

        <div className="discovery-starter-grid" aria-label="发现路径">
          {starterCards.map((card) => (
            <article key={card.title}>
              <h4>{card.title}</h4>
              <p>{card.description}</p>
            </article>
          ))}
        </div>

        <div className="starter-tags" aria-label="搜索灵感">
          {starterSuggestions.map((keyword) => (
            <button key={keyword} type="button" onClick={() => onUseSuggestion(keyword)}>
              {keyword}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (books.length === 0) {
    return (
      <section className="discovery-empty" aria-label="搜索无结果">
        <SearchX aria-hidden="true" size={30} />
        <h3>没有找到匹配内容</h3>
        <p>可以换关键词、按作者搜索、试试主题 chip，或先从书架里选一本到相似推荐继续找。</p>
      </section>
    );
  }

  return (
    <section className="discovery-card search-results" aria-label="搜索结果">
      <div className="discovery-card-heading">
        <div>
          <p className="section-kicker">{kicker}</p>
          <h3>{heading ?? `${books.length} 条可浏览结果`}</h3>
        </div>
        {result.sid ? <span>sid 已记录</span> : null}
      </div>

      {result.groups.length > 1 ? (
        <div className="search-group-pills" aria-label="综合搜索分类">
          {result.groups.map((group) => (
            <span key={`${group.title}-${group.scope ?? "all"}`}>
              <Layers3 aria-hidden="true" size={14} />
              {group.title} {group.currentCount ?? group.books.length}
              {group.scopeCount ? `/${group.scopeCount}` : ""}
            </span>
          ))}
        </div>
      ) : null}

      <div className="discovery-book-grid">
        {books.map((book) => (
          <DiscoveryBookCard
            key={`${book.bookId}-${book.searchIdx ?? book.title}`}
            book={book}
            onOpenBook={onOpenBook}
            onFindSimilar={onFindSimilar}
            isCandidate={candidateIds?.has(book.bookId) === true}
            isSavingCandidate={savingCandidateIds?.has(book.bookId) === true}
            isInShelf={shelfItemIds?.has(book.bookId) === true}
            onSaveCandidate={onSaveCandidate}
          />
        ))}
      </div>

      {result.hasMore ? (
        <button
          className="secondary-action discovery-load-more"
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? (
            <Loader2 aria-hidden="true" size={18} className="spin" />
          ) : (
            <ChevronRight aria-hidden="true" size={18} />
          )}
          {isLoadingMore ? "加载中" : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}

export function DiscoveryBookCard({
  book,
  isCandidate = false,
  isSavingCandidate = false,
  isInShelf = false,
  onOpenBook,
  onFindSimilar,
  onSaveCandidate
}: {
  book: SearchResult | Recommendation;
  isCandidate?: boolean;
  isSavingCandidate?: boolean;
  isInShelf?: boolean;
  onOpenBook: (book: SearchResult) => void;
  onFindSimilar: (book: SearchResult) => void;
  onSaveCandidate?: (book: SearchResult) => void;
}) {
  const candidateLabel = isInShelf ? "已在书架" : isCandidate ? "已保存" : isSavingCandidate ? "保存中" : "保存候选";
  const disableCandidate = isInShelf || isCandidate || isSavingCandidate || !onSaveCandidate;

  return (
    <article className={`discovery-book-card ${book.soldout ? "is-soldout" : ""}`}>
      <button className="discovery-cover" type="button" onClick={() => onOpenBook(book)}>
        {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={30} />}
      </button>

      <div className="discovery-book-copy">
        <div>
          <p className="discovery-book-category">{book.category || book.publisher || "微信读书"}</p>
          <h4>{book.title}</h4>
          <small>{book.author || "暂无作者信息"}</small>
        </div>

        {"reason" in book && book.reason ? (
          <p className="recommend-reason">{book.reason}</p>
        ) : book.intro ? (
          <p className="discovery-intro">{book.intro}</p>
        ) : null}

        <div className="discovery-meta-row">
          <span>
            <Star aria-hidden="true" size={14} />
            {formatRating(book.ratingPercent)}
            {book.ratingTitle ? ` · ${book.ratingTitle}` : ""}
          </span>
          {book.readingCount ? <span>{formatCompactCount(book.readingCount)} 人在读</span> : null}
          {book.ratingCount ? <span>{formatCompactCount(book.ratingCount)} 人评分</span> : null}
          {book.soldout ? <b>暂不可读</b> : null}
        </div>

        <div className="discovery-actions">
          <button className="text-button" type="button" onClick={() => onOpenBook(book)}>
            打开详情
          </button>
          <button className="text-button" type="button" onClick={() => onFindSimilar(book)}>
            找相似
          </button>
          <button
            className={`text-button discovery-candidate-action ${
              isCandidate || isInShelf ? "is-active" : ""
            }`}
            type="button"
            onClick={() => onSaveCandidate?.(book)}
            disabled={disableCandidate}
          >
            {candidateLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

export function DiscoveryLoading({ label }: { label: string }) {
  return (
    <section className="discovery-loading" aria-label={label}>
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} />
      ))}
    </section>
  );
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }

  return String(Math.trunc(value));
}
