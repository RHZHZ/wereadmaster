import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookMarked,
  BookOpen,
  BookPlus,
  CheckCircle2,
  Database,
  Layers3,
  Loader2,
  NotebookPen,
  Sparkles,
  X
} from "lucide-react";
import { BookHeader } from "../components/BookHeader";
import { ChapterList } from "../components/ChapterList";
import { BestBookmarksPanel } from "../components/BestBookmarksPanel";
import { PublicReviewsPanel } from "../components/PublicReviewsPanel";
import { SkillUpgradeNotice } from "../components/SkillUpgradeNotice";
import { findCurrentChapter } from "../lib/book-progress";
import { useToast } from "../components/ToastProvider";
import { formatUnixDate } from "../lib/formatters";
import { TERMS } from "../lib/glossary";
import { listLocalBooks } from "../lib/local-reader-api";
import type { LocalBook } from "../lib/local-reader-types";
import {
  getCommandErrorInfo,
  getCommandErrorMessage,
  getBestBookmarks,
  getPublicReviews,
  getReadReviews,
  getReadingItemState,
  patchReadingItemState,
  type BookDetailResponse,
  type CommandErrorInfo
} from "../lib/reading-api";
import {
  findReadingAssetLinkPair,
  getReadingAssetLinkStorage,
  readReadingAssetLinks,
  setReadingAssetLinkPairLinked,
  writeReadingAssetLinks,
  type ReadingAssetLinkPair
} from "../lib/reading-asset-links";
import {
  buildLikelySourceVersionPair,
  findLikelyLocalBookMatch,
  type SourceVersionPair
} from "../lib/source-version-matches";
import type {
  BestBookmarksResult,
  PublicReviewsResult,
  ReadReviewsResult,
  ReadingItemState,
  ReadingItemStatus,
  ShelfEntry
} from "../lib/types";
import {
  buildBookAssetStatus,
  type BookAssetStatus
} from "./book-asset-status";

type BookDetailPageProps = {
  shelfEntry?: ShelfEntry;
  detailResponse?: BookDetailResponse;
  isLoading: boolean;
  isOpening: boolean;
  error?: CommandErrorInfo;
  linkMessage?: string;
  backLabel?: string;
  localBooks?: LocalBook[];
  onBack: () => void;
  onRetry: () => void;
  onOpenBook: () => void;
  onOpenChapter: (chapterUid: number) => void;
  onOpenNotes?: () => void;
  onOpenAiSummary?: () => void;
  onFindSimilar?: () => void;
  onOpenReadingRoute?: () => void;
};

const localBookStatusOptions: Array<{ status: ReadingItemStatus; label: string; description: string }> = [
  { status: "reviewing", label: TERMS.toOrganize, description: "需要整理笔记" },
  { status: "organized", label: "已整理", description: "整理完成" }
];

export function BookDetailPage({
  shelfEntry,
  detailResponse,
  isLoading,
  isOpening,
  error,
  linkMessage,
  backLabel = "返回书架",
  localBooks,
  onBack,
  onRetry,
  onOpenBook,
  onOpenChapter,
  onOpenNotes,
  onOpenAiSummary,
  onFindSimilar,
  onOpenReadingRoute
}: BookDetailPageProps) {
  const [readingState, setReadingState] = useState<ReadingItemState>();
  const [loadedLocalBooks, setLoadedLocalBooks] = useState<LocalBook[]>([]);
  const [assetLinks, setAssetLinks] = useState<ReadingAssetLinkPair[]>(() =>
    readReadingAssetLinks(getReadingAssetLinkStorage())
  );
  const [isStateLoading, setIsStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string>();
  const [publicReviews, setPublicReviews] = useState<PublicReviewsResult>();
  const [publicReviewListType, setPublicReviewListType] = useState(0);
  const [isPublicReviewsLoading, setIsPublicReviewsLoading] = useState(false);
  const [isPublicReviewsLoadingMore, setIsPublicReviewsLoadingMore] = useState(false);
  const [publicReviewsError, setPublicReviewsError] = useState<CommandErrorInfo>();
  const [publicReviewsPaginationError, setPublicReviewsPaginationError] = useState<CommandErrorInfo>();
  const publicReviewsRequestIdRef = useRef(0);
  const [bestBookmarks, setBestBookmarks] = useState<BestBookmarksResult>();
  const [isBestBookmarksLoading, setIsBestBookmarksLoading] = useState(false);
  const [bestBookmarksError, setBestBookmarksError] = useState<CommandErrorInfo>();
  const [hasRequestedBestBookmarks, setHasRequestedBestBookmarks] = useState(false);
  const [readReviewsByBookmarkId, setReadReviewsByBookmarkId] = useState<
    Record<string, ReadReviewsResult | undefined>
  >({});
  const [readReviewErrorsByBookmarkId, setReadReviewErrorsByBookmarkId] = useState<
    Record<string, CommandErrorInfo | undefined>
  >({});
  const [readReviewsLoadingBookmarkId, setReadReviewsLoadingBookmarkId] = useState<string>();
  const { showToast } = useToast();
  const effectiveLocalBooks = localBooks ?? loadedLocalBooks;

  useEffect(() => {
    if (!shelfEntry?.id || shelfEntry.type !== "book") {
      setReadingState(undefined);
      return;
    }

    let isMounted = true;
    const itemId = shelfEntry.id;
    setIsStateLoading(true);
    setStateError(undefined);

    async function loadReadingState() {
      try {
        const response = await getReadingItemState(itemId);
        if (isMounted) {
          setReadingState(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setStateError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsStateLoading(false);
        }
      }
    }

    void loadReadingState();

    return () => {
      isMounted = false;
    };
  }, [shelfEntry?.id, shelfEntry?.type]);

  useEffect(() => {
    if (localBooks || !shelfEntry?.id || shelfEntry.type !== "book") {
      return;
    }

    let isMounted = true;

    async function loadLocalBooks() {
      try {
        const books = await listLocalBooks();
        if (isMounted) {
          setLoadedLocalBooks(books);
        }
      } catch {
        if (isMounted) {
          setLoadedLocalBooks([]);
        }
      }
    }

    void loadLocalBooks();

    return () => {
      isMounted = false;
    };
  }, [localBooks, shelfEntry?.id, shelfEntry?.type]);

  const publicReviewsBookId =
    shelfEntry?.type === "book" ? detailResponse?.detail.bookId || shelfEntry.id : undefined;

  useEffect(() => {
    setBestBookmarks(undefined);
    setBestBookmarksError(undefined);
    setIsBestBookmarksLoading(false);
    setHasRequestedBestBookmarks(false);
    setReadReviewsByBookmarkId({});
    setReadReviewErrorsByBookmarkId({});
    setReadReviewsLoadingBookmarkId(undefined);
  }, [publicReviewsBookId]);

  useEffect(() => {
    const requestId = ++publicReviewsRequestIdRef.current;

    if (!publicReviewsBookId) {
      setPublicReviews(undefined);
      setPublicReviewListType(0);
      setPublicReviewsError(undefined);
      setPublicReviewsPaginationError(undefined);
      setIsPublicReviewsLoading(false);
      setIsPublicReviewsLoadingMore(false);
      return;
    }

    const bookId = publicReviewsBookId;
    let isMounted = true;
    setPublicReviews(undefined);
    setPublicReviewsError(undefined);
    setPublicReviewsPaginationError(undefined);
    setIsPublicReviewsLoading(true);
    setIsPublicReviewsLoadingMore(false);

    async function loadPublicReviews() {
      try {
        const response = await getPublicReviews({
          bookId,
          reviewListType: publicReviewListType,
          count: 10
        });
        if (isMounted && requestId === publicReviewsRequestIdRef.current) {
          setPublicReviews(response.result);
        }
      } catch (loadError) {
        if (isMounted && requestId === publicReviewsRequestIdRef.current) {
          setPublicReviewsError(getCommandErrorInfo(loadError));
        }
      } finally {
        if (isMounted && requestId === publicReviewsRequestIdRef.current) {
          setIsPublicReviewsLoading(false);
        }
      }
    }

    void loadPublicReviews();

    return () => {
      isMounted = false;
    };
  }, [publicReviewListType, publicReviewsBookId]);

  const localBookMatch =
    shelfEntry && detailResponse
      ? findLikelyLocalBookMatch(
          {
            type: shelfEntry.type,
            title: detailResponse.detail.title || shelfEntry.title,
            author: detailResponse.detail.author || shelfEntry.author
          },
          effectiveLocalBooks
        )
      : undefined;
  const sourceVersionPair =
    shelfEntry && detailResponse && localBookMatch
      ? buildLikelySourceVersionPair(localBookMatch, {
          id: shelfEntry.id,
          type: shelfEntry.type,
          title: detailResponse.detail.title || shelfEntry.title,
          author: detailResponse.detail.author || shelfEntry.author
        })
      : undefined;
  const isSourceVersionLinked = Boolean(findReadingAssetLinkPair(assetLinks, sourceVersionPair));
  const currentChapter = detailResponse
    ? findCurrentChapter(detailResponse.chapters, detailResponse.progress)
    : undefined;

  async function handleStatusChange(status: ReadingItemStatus) {
    if (!shelfEntry || !detailResponse) {
      return;
    }

    const detail = detailResponse.detail;

    setIsStateLoading(true);
    setStateError(undefined);

    try {
      const nextState = await patchReadingItemState(
        detail.bookId || shelfEntry.id,
        { organizeStatus: status === "organized" ? "organized" : "to_organize" },
        {
          itemKind: shelfEntry.type,
          title: detail.title || shelfEntry.title,
          author: detail.author || shelfEntry.author,
          cover: detail.cover || shelfEntry.cover,
          category: detail.category || shelfEntry.category
        }
      );
      setReadingState(nextState);
      showToast({ message: `已标记为「${statusLabel(status) ?? "本地整理状态"}」`, tone: "success" });
    } catch (updateError) {
      const message = getCommandErrorMessage(updateError);
      setStateError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsStateLoading(false);
    }
  }

  async function handleSaveCandidate() {
    if (!shelfEntry || !detailResponse) {
      return;
    }

    const detail = detailResponse.detail;
    const title = detail.title || shelfEntry.title;

    setIsStateLoading(true);
    setStateError(undefined);

    try {
      const nextState = await patchReadingItemState(
        detail.bookId || shelfEntry.id,
        {
          isCandidate: true,
          candidateSource: "weread",
          sourceMeta: {
            ...(readingState?.sourceMeta ?? {}),
            savedFrom: "book_detail"
          }
        },
        {
          itemKind: shelfEntry.type,
          title,
          author: detail.author || shelfEntry.author,
          cover: detail.cover || shelfEntry.cover,
          category: detail.category || shelfEntry.category
        }
      );
      setReadingState(nextState);
      showToast({ message: `已保存《${title}》到本地候选`, tone: "success" });
    } catch (candidateError) {
      const message = getCommandErrorMessage(candidateError);
      setStateError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsStateLoading(false);
    }
  }

  async function handleClearStatus() {
    const itemId = detailResponse?.detail.bookId || shelfEntry?.id;
    if (!itemId) {
      return;
    }

    setIsStateLoading(true);
    setStateError(undefined);

    try {
      const nextState = await patchReadingItemState(itemId, { organizeStatus: "none" });
      setReadingState(nextState);
      showToast({ message: "已清除本地整理状态", tone: "success" });
    } catch (removeError) {
      const message = getCommandErrorMessage(removeError);
      setStateError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsStateLoading(false);
    }
  }

  function handleToggleSourceVersionLink(pair: SourceVersionPair, isLinked: boolean) {
    if (!setReadingAssetLinkPairLinked([], pair, true)) {
      showToast({ message: "无法建立版本关联，请稍后重试。", tone: "error" });
      return;
    }

    setAssetLinks((current) => {
      const next = setReadingAssetLinkPairLinked(current, pair, !isLinked);
      return writeReadingAssetLinks(getReadingAssetLinkStorage(), next ?? current);
    });
    showToast({
      message: isLinked ? "已取消本地版本和微信版本的关联。" : "已关联为同一本书的两个来源版本。",
      tone: isLinked ? "neutral" : "success"
    });
  }

  async function handleRefreshPublicReviews() {
    if (!publicReviewsBookId) {
      return;
    }

    const requestId = ++publicReviewsRequestIdRef.current;
    setIsPublicReviewsLoading(true);
    setPublicReviewsError(undefined);
    setPublicReviewsPaginationError(undefined);

    try {
      const response = await getPublicReviews({
        bookId: publicReviewsBookId,
        reviewListType: publicReviewListType,
        count: 10
      });
      if (requestId === publicReviewsRequestIdRef.current) {
        setPublicReviews(response.result);
      }
    } catch (refreshError) {
      if (requestId === publicReviewsRequestIdRef.current) {
        setPublicReviewsError(getCommandErrorInfo(refreshError));
      }
    } finally {
      if (requestId === publicReviewsRequestIdRef.current) {
        setIsPublicReviewsLoading(false);
      }
    }
  }

  async function handleLoadMorePublicReviews() {
    if (!publicReviewsBookId || !publicReviews?.hasMore || isPublicReviewsLoadingMore) {
      return;
    }

    const requestId = publicReviewsRequestIdRef.current;
    setIsPublicReviewsLoadingMore(true);
    setPublicReviewsPaginationError(undefined);

    try {
      const response = await getPublicReviews({
        bookId: publicReviewsBookId,
        reviewListType: publicReviewListType,
        count: 10,
        maxIdx: publicReviews.nextMaxIdx,
        synckey: publicReviews.synckey
      });
      if (requestId === publicReviewsRequestIdRef.current) {
        setPublicReviews((current) => mergePublicReviewPages(current, response.result));
      }
    } catch (loadError) {
      if (requestId === publicReviewsRequestIdRef.current) {
        setPublicReviewsPaginationError(getCommandErrorInfo(loadError));
      }
    } finally {
      if (requestId === publicReviewsRequestIdRef.current) {
        setIsPublicReviewsLoadingMore(false);
      }
    }
  }

  async function handleLoadBestBookmarks() {
    if (!publicReviewsBookId) {
      return;
    }

    const bookId = publicReviewsBookId;
    setHasRequestedBestBookmarks(true);
    setIsBestBookmarksLoading(true);
    setBestBookmarksError(undefined);

    try {
      const response = await getBestBookmarks({ bookId, chapterUid: 0 });
      setBestBookmarks(response.result);
    } catch (loadError) {
      setBestBookmarksError(getCommandErrorInfo(loadError));
    } finally {
      setIsBestBookmarksLoading(false);
    }
  }

  async function handleLoadReadReviews(bookmark: BestBookmarksResult["items"][number]) {
    if (!bookmark.range || bookmark.chapterUid === undefined) {
      return;
    }

    setReadReviewsLoadingBookmarkId(bookmark.bookmarkId);
    setReadReviewErrorsByBookmarkId((current) => ({
      ...current,
      [bookmark.bookmarkId]: undefined
    }));

    try {
      const response = await getReadReviews({
        bookId: bookmark.bookId,
        chapterUid: bookmark.chapterUid,
        range: bookmark.range,
        count: 5
      });
      setReadReviewsByBookmarkId((current) => ({
        ...current,
        [bookmark.bookmarkId]: response.result
      }));
    } catch (loadError) {
      setReadReviewErrorsByBookmarkId((current) => ({
        ...current,
        [bookmark.bookmarkId]: getCommandErrorInfo(loadError)
      }));
    } finally {
      setReadReviewsLoadingBookmarkId(undefined);
    }
  }

  if (!shelfEntry) {
    return (
      <section className="tool-panel" aria-label="未选择书籍">
        <BookOpen aria-hidden="true" size={28} />
        <h3>还没有选择书籍</h3>
        <p>请先回到上一页，选择一本电子书后再查看详情。</p>
        <button className="secondary-action" type="button" onClick={onBack}>
          {backLabel}
        </button>
      </section>
    );
  }

  return (
    <section className="book-detail-page" aria-label="书籍详情">
      <button className="text-button back-button" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={16} />
        {backLabel}
      </button>

      {isLoading ? (
        <section className="book-detail-loading" aria-label="正在加载书籍详情">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取书籍详情</h3>
            <p>会并行展示元信息、阅读进度和目录缓存。</p>
          </div>
        </section>
      ) : null}

      {error?.code === "upgrade_required" ? (
        <SkillUpgradeNotice error={error} onRetry={onRetry} />
      ) : error ? (
        <section className="setup-card status-card" aria-label="书籍详情错误">
          <AlertCircle aria-hidden="true" size={24} />
          <div>
            <h3>书籍详情暂时不可用</h3>
            <p>{formatCommandErrorInfo(error)}</p>
          </div>
          <button className="secondary-action" type="button" onClick={onRetry}>
            重试
          </button>
        </section>
      ) : null}

      {linkMessage ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{linkMessage}</span>
        </div>
      ) : null}

      {detailResponse ? (
        <>
          <BookHeader
            detail={detailResponse.detail}
            progress={detailResponse.progress}
            currentChapter={currentChapter}
            shelfEntry={shelfEntry}
            isOpening={isOpening}
            onOpenInWeread={onOpenBook}
            onFindSimilar={onFindSimilar}
          />

          {localBookMatch ? (
            <LocalVersionNotice
              book={localBookMatch}
              sourceVersionPair={sourceVersionPair}
              isSourceVersionLinked={isSourceVersionLinked}
              onToggleSourceVersionLink={handleToggleSourceVersionLink}
            />
          ) : null}

          <BookActionPanel
            shelfEntry={shelfEntry}
            detailResponse={detailResponse}
            readingState={readingState}
            isLoading={isStateLoading}
            error={stateError}
            onStatusChange={handleStatusChange}
            onClearStatus={handleClearStatus}
            onSaveCandidate={handleSaveCandidate}
            onOpenNotes={onOpenNotes}
            onOpenAiSummary={onOpenAiSummary}
            onFindSimilar={onFindSimilar}
            onOpenReadingRoute={onOpenReadingRoute}
          />

          <div className="book-detail-layout">
            <article className="book-info-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">简介</p>
                  <h3>书籍信息</h3>
                </div>
                <Database aria-hidden="true" size={20} />
              </div>
              <p className="book-intro">{detailResponse.detail.intro || "微信读书暂未返回简介。"}</p>
              <dl className="metadata-grid">
                <MetadataItem label="出版社" value={detailResponse.detail.publisher} />
                <MetadataItem label="出版时间" value={detailResponse.detail.publishTime} />
                <MetadataItem label="ISBN" value={detailResponse.detail.isbn} />
                <MetadataItem
                  label="总字数"
                  value={detailResponse.detail.wordCount ? `${detailResponse.detail.wordCount} 字` : undefined}
                />
                <MetadataItem
                  label="最近阅读"
                  value={detailResponse.progress.updatedAt ? formatUnixDate(detailResponse.progress.updatedAt) : undefined}
                />
                <MetadataItem
                  label="完成时间"
                  value={detailResponse.progress.finishTime ? formatUnixDate(detailResponse.progress.finishTime) : undefined}
                />
              </dl>
            </article>

            <ChapterList
              chapters={detailResponse.chapters}
              progress={detailResponse.progress}
              isOpening={isOpening}
              onOpenChapter={onOpenChapter}
            />
          </div>

          {publicReviewsBookId ? (
            <BestBookmarksPanel
              result={bestBookmarks}
              isLoading={isBestBookmarksLoading}
              error={bestBookmarksError}
              hasRequested={hasRequestedBestBookmarks}
              readReviewsByBookmarkId={readReviewsByBookmarkId}
              readReviewErrorsByBookmarkId={readReviewErrorsByBookmarkId}
              readReviewsLoadingBookmarkId={readReviewsLoadingBookmarkId}
              onLoad={() => void handleLoadBestBookmarks()}
              onLoadReadReviews={(bookmark) => void handleLoadReadReviews(bookmark)}
            />
          ) : null}

          {publicReviewsBookId ? (
            <PublicReviewsPanel
              result={publicReviews}
              reviewListType={publicReviewListType}
              isLoading={isPublicReviewsLoading}
              isLoadingMore={isPublicReviewsLoadingMore}
              error={publicReviewsError}
              paginationError={publicReviewsPaginationError}
              onReviewListTypeChange={setPublicReviewListType}
              onRefresh={() => void handleRefreshPublicReviews()}
              onLoadMore={() => void handleLoadMorePublicReviews()}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function mergePublicReviewPages(
  current: PublicReviewsResult | undefined,
  next: PublicReviewsResult
): PublicReviewsResult {
  if (!current || current.reviewListType !== next.reviewListType) {
    return next;
  }

  const seenReviewIds = new Set(current.reviews.map((review) => review.reviewId));
  const reviews = [
    ...current.reviews,
    ...next.reviews.filter((review) => !seenReviewIds.has(review.reviewId))
  ];

  return {
    ...next,
    reviews
  };
}

function LocalVersionNotice({
  book,
  sourceVersionPair,
  isSourceVersionLinked,
  onToggleSourceVersionLink
}: {
  book: LocalBook;
  sourceVersionPair?: SourceVersionPair;
  isSourceVersionLinked: boolean;
  onToggleSourceVersionLink: (pair: SourceVersionPair, isLinked: boolean) => void;
}) {
  return (
    <section className="book-source-boundary-card" aria-label="疑似本地版本">
      <Layers3 aria-hidden="true" size={20} />
      <div>
        <strong>可能存在本地版本</strong>
        <p>
          本地书库中有《{book.title}》。这只是来源提示，不会自动合并笔记、划线或进度。
        </p>
      </div>
      <div className="book-source-boundary-actions">
        <span>{isSourceVersionLinked ? "已关联本地版本" : "本地版本"}</span>
        {sourceVersionPair ? (
          <button
            className="book-source-link-button"
            type="button"
            onClick={() => onToggleSourceVersionLink(sourceVersionPair, isSourceVersionLinked)}
          >
            {isSourceVersionLinked ? "取消关联" : "关联版本"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function formatCommandErrorInfo(error: CommandErrorInfo): string {
  return error.detail && error.detail !== error.message
    ? `${error.message} 诊断：${error.detail}`
    : error.message;
}

function BookActionPanel({
  shelfEntry,
  detailResponse,
  readingState,
  isLoading,
  error,
  onStatusChange,
  onClearStatus,
  onSaveCandidate,
  onOpenNotes,
  onOpenAiSummary,
  onFindSimilar,
  onOpenReadingRoute
}: {
  shelfEntry: ShelfEntry;
  detailResponse: BookDetailResponse;
  readingState?: ReadingItemState;
  isLoading: boolean;
  error?: string;
  onStatusChange: (status: ReadingItemStatus) => void;
  onClearStatus: () => void;
  onSaveCandidate: () => void;
  onOpenNotes?: () => void;
  onOpenAiSummary?: () => void;
  onFindSimilar?: () => void;
  onOpenReadingRoute?: () => void;
}) {
  const selectedStatus =
    readingState?.organizeStatus === "organized"
      ? "organized"
      : readingState?.organizeStatus === "to_organize"
        ? "reviewing"
        : localBookStatusOptions.some((option) => option.status === readingState?.status)
          ? readingState?.status
          : undefined;
  const isCandidate =
    readingState?.isCandidate ??
    (readingState?.itemType === "candidate" && readingState.status === "toRead");
  const isFinished = detailResponse.progress.isFinished === true || shelfEntry.isFinished === true;
  const candidateCardTitle = isFinished ? "已读完" : isCandidate ? "已在候选" : "加入候选";
  const candidateCardDescription = isFinished
    ? "建议进入复盘或阅读指南"
    : "用于路线和选书决策";
  const assetStatus = buildBookAssetStatus({
    shelfEntry,
    progress: detailResponse.progress,
    readingState,
    canOpenNotes: Boolean(onOpenNotes),
    canOpenAiSummary: Boolean(onOpenAiSummary),
    canOpenReadingRoute: Boolean(onOpenReadingRoute)
  });

  return (
    <section className="book-action-panel" aria-label="本书管理">
      <div className="book-action-heading">
        <div>
          <p className="section-kicker">本地整理</p>
          <h3>本书管理</h3>
          <p>微信读书进度仍以微信读书为准；这里只记录本机的复盘和整理状态，不会写回微信读书。</p>
        </div>
        {selectedStatus ? (
          <span className="book-state-badge">
            <CheckCircle2 aria-hidden="true" size={16} />
            {statusLabel(selectedStatus)}
          </span>
        ) : null}
      </div>

      <BookAssetStatusCard status={assetStatus} />

      <div className="book-state-options" aria-label="本地整理状态">
        {localBookStatusOptions.map((option) => (
          <button
            key={option.status}
            type="button"
            className={selectedStatus === option.status ? "is-active" : ""}
            onClick={() => onStatusChange(option.status)}
            disabled={isLoading}
          >
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
        {selectedStatus ? (
          <button type="button" className="book-state-clear" onClick={onClearStatus} disabled={isLoading}>
            <X aria-hidden="true" size={16} />
            清除状态
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="book-action-error">
          <AlertCircle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}

      <div className="book-action-grid">
        <ActionButton
          icon={<NotebookPen aria-hidden="true" size={18} />}
          title="查看笔记"
          description="确认复盘输入范围"
          onClick={onOpenNotes}
        />
        <ActionButton
          icon={<Sparkles aria-hidden="true" size={18} />}
          title={TERMS.bookReview}
          description="整理划线和想法"
          onClick={onOpenAiSummary}
        />
        <ActionButton
          icon={<Layers3 aria-hidden="true" size={18} />}
          title="找相似"
          description="探索同主题书"
          onClick={onFindSimilar}
        />
        <ActionButton
          icon={<BookMarked aria-hidden="true" size={18} />}
          title="本书阅读指南"
          description="规划下一步阅读"
          onClick={onOpenReadingRoute}
        />
      </div>

      <div className="book-candidate-entry" aria-label="候选入口">
        <p className="section-kicker">候选入口</p>
        <ActionButton
          icon={isFinished ? <CheckCircle2 aria-hidden="true" size={18} /> : <BookPlus aria-hidden="true" size={18} />}
          title={candidateCardTitle}
          description={candidateCardDescription}
          onClick={isFinished || isCandidate ? undefined : onSaveCandidate}
          disabled={isLoading || isFinished || isCandidate}
        />
      </div>
    </section>
  );
}

function BookAssetStatusCard({ status }: { status: BookAssetStatus }) {
  return (
    <article className={`book-asset-status-card is-${status.tone}`} aria-label="本书整理状态">
      <div className="book-asset-status-main">
        <span className="book-asset-status-label">{status.label}</span>
        <div>
          <h4>{status.title}</h4>
          <p>{status.body}</p>
        </div>
      </div>
      <dl className="book-asset-status-meta">
        <div>
          <dt>当前进度</dt>
          <dd>{status.progressLabel}</dd>
        </div>
        <div>
          <dt>建议动作</dt>
          <dd>{status.nextActionLabel}</dd>
        </div>
      </dl>
      <p className="book-asset-status-next">{status.nextActionReason}</p>
    </article>
  );
}

function ActionButton({
  icon,
  title,
  description,
  onClick,
  disabled = false
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="book-action-card" type="button" onClick={onClick} disabled={disabled || !onClick}>
      {icon}
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </button>
  );
}

function statusLabel(status: ReadingItemStatus): string | undefined {
  if (status === "toRead") {
    return "本地候选";
  }

  if (status === "reading") {
    return undefined;
  }

  return localBookStatusOptions.find((option) => option.status === status)?.label;
}

function MetadataItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "暂无"}</dd>
    </div>
  );
}
