import { useEffect, useState, type ReactNode } from "react";
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
import { useToast } from "../components/ToastProvider";
import { formatUnixDate } from "../lib/formatters";
import { listLocalBooks } from "../lib/local-reader-api";
import type { LocalBook } from "../lib/local-reader-types";
import {
  getCommandErrorMessage,
  getReadingItemState,
  removeReadingItemState,
  upsertReadingItemState,
  type BookDetailResponse
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
import type { ReadingItemState, ReadingItemStatus, ShelfEntry } from "../lib/types";

type BookDetailPageProps = {
  shelfEntry?: ShelfEntry;
  detailResponse?: BookDetailResponse;
  isLoading: boolean;
  isOpening: boolean;
  error?: string;
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
  { status: "reviewing", label: "待复盘", description: "需要整理笔记" },
  { status: "organized", label: "已整理", description: "已完成沉淀" }
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

  async function handleStatusChange(status: ReadingItemStatus) {
    if (!shelfEntry || !detailResponse) {
      return;
    }

    const detail = detailResponse.detail;

    setIsStateLoading(true);
    setStateError(undefined);

    try {
      const nextState = await upsertReadingItemState({
        itemId: detail.bookId || shelfEntry.id,
        itemType: shelfEntry.type,
        status,
        title: detail.title || shelfEntry.title,
        author: detail.author || shelfEntry.author,
        cover: detail.cover || shelfEntry.cover,
        category: detail.category || shelfEntry.category
      });
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
      const nextState = await upsertReadingItemState({
        itemId: detail.bookId || shelfEntry.id,
        itemType: "candidate",
        status: "toRead",
        title,
        author: detail.author || shelfEntry.author,
        cover: detail.cover || shelfEntry.cover,
        category: detail.category || shelfEntry.category,
        note: "书籍详情页保存的本地候选"
      });
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
      await removeReadingItemState(itemId);
      setReadingState(undefined);
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

      {error ? (
        <section className="setup-card status-card" aria-label="书籍详情错误">
          <AlertCircle aria-hidden="true" size={24} />
          <div>
            <h3>书籍详情暂时不可用</h3>
            <p>{error}</p>
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
        </>
      ) : null}
    </section>
  );
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
          本地书库中有《{book.title}》。这只是来源提示，不会合并微信读书笔记、本地划线、进度或 AI 缓存。
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
  const selectedStatus = localBookStatusOptions.some((option) => option.status === readingState?.status)
    ? readingState?.status
    : undefined;
  const isCandidate = readingState?.itemType === "candidate" && readingState.status === "toRead";
  const isFinished = detailResponse.progress.isFinished === true || shelfEntry.isFinished === true;
  const candidateCardTitle = isFinished ? "已读完" : isCandidate ? "已在候选" : "加入候选";
  const candidateCardDescription = isFinished
    ? "这本书已经读完，建议进入复盘或阅读指南，不再加入待读候选。"
    : "保存到候选书架，供跨书路线和选书决策使用";

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
          description="进入划线、想法和章节视图，确认复盘输入范围"
          onClick={onOpenNotes}
        />
        <ActionButton
          icon={<Sparkles aria-hidden="true" size={18} />}
          title="AI 复盘"
          description="把本书划线和想法整理成结构化复盘；生成仍需手动点击"
          onClick={onOpenAiSummary}
        />
        <ActionButton
          icon={<Layers3 aria-hidden="true" size={18} />}
          title="找相似"
          description="进入发现页的独立相似探索"
          onClick={onFindSimilar}
        />
        <ActionButton
          icon={<BookMarked aria-hidden="true" size={18} />}
          title="本书阅读指南"
          description="先规划这本书下一步；可加入候选书扩展路线"
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
