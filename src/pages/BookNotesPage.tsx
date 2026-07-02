import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  BookOpen,
  Download,
  LayoutGrid,
  List,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Share2,
  Shuffle,
  Sparkles
} from "lucide-react";
import { NoteList } from "../components/NoteList";
import { SkillUpgradeNotice } from "../components/SkillUpgradeNotice";
import {
  exportBookNotesMarkdown,
  getBookNotes,
  getCommandErrorInfo,
  getCommandErrorMessage,
  type CommandErrorInfo,
  type ExportBookNotesMarkdownResponse
} from "../lib/reading-api";
import { useToast } from "../components/ToastProvider";
import { formatUnixDate } from "../lib/formatters";
import {
  formatArtifactCreatedMessage,
  formatArtifactExportedMessage
} from "../lib/reading-artifacts";
import type { DefaultNotesView } from "../lib/preferences";
import type { BookNotes, ChapterNoteGroup, Highlight, NotebookBook, Thought } from "../lib/types";
import {
  buildBookNotesReviewStatus,
  type BookNotesReviewStatus
} from "./book-notes-review-status";

type BookNotesPageProps = {
  book?: NotebookBook;
  bookId?: string;
  cachedNotes?: BookNotes;
  onNotesChange: (bookId: string, notes: BookNotes) => void;
  onOpenAiSummary: (bookId: string, notes: BookNotes) => void;
  onBack: () => void;
  backLabel?: string;
  defaultViewMode?: DefaultNotesView;
};

type NoteViewMode = "list" | "cards";
type NoteCardFilter = "all" | "highlight" | "thought";
type NoteCardSort = "chapter" | "latest";

type NoteCardItem = {
  id: string;
  type: "highlight" | "thought";
  text: string;
  abstractText?: string;
  chapterTitle: string;
  chapterUid?: number;
  createdAt?: number;
  meta: string[];
};

const RANDOM_CARD_LIMIT = 6;
const SHARE_GROUP_LIMIT = 6;
const SHARE_CARD_WIDTH = 900;
const SHARE_CARD_PADDING = 64;

export function BookNotesPage({
  book,
  bookId,
  cachedNotes,
  onNotesChange,
  onOpenAiSummary,
  onBack,
  backLabel = "返回笔记中心",
  defaultViewMode = "list"
}: BookNotesPageProps) {
  const targetBookId = bookId ?? book?.bookId;
  const [notes, setNotes] = useState<BookNotes>();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<CommandErrorInfo>();
  const [exportResult, setExportResult] = useState<ExportBookNotesMarkdownResponse>();
  const [viewMode, setViewMode] = useState<NoteViewMode>(defaultViewMode);
  const [cardFilter, setCardFilter] = useState<NoteCardFilter>("all");
  const [cardSort, setCardSort] = useState<NoteCardSort>("chapter");
  const [randomCardIds, setRandomCardIds] = useState<string[]>([]);
  const [sharingCardId, setSharingCardId] = useState<string>();
  const [isSharingGroup, setIsSharingGroup] = useState(false);
  const [shareError, setShareError] = useState<string>();
  const { showToast } = useToast();
  const displayBook = notes?.book && notes.book.bookId === targetBookId ? notes.book : book ?? notes?.book;
  const noteCards = notes ? buildNoteCards(notes.chapterGroups) : [];
  const filteredCards = filterNoteCards(noteCards, cardFilter);
  const orderedCards = sortNoteCards(filteredCards, cardSort);
  const randomIdSet = new Set(randomCardIds);
  const visibleCards =
    randomCardIds.length > 0 ? orderedCards.filter((card) => randomIdSet.has(card.id)) : orderedCards;
  const notesReviewStatus = notes ? buildBookNotesReviewStatus(notes) : undefined;

  useEffect(() => {
    if (!targetBookId) {
      return;
    }

    setError(undefined);
    setExportResult(undefined);
    setShareError(undefined);
    setRandomCardIds([]);

    if (cachedNotes?.bookId === targetBookId) {
      setNotes(cachedNotes);
      setIsLoading(false);
      return;
    }

    setNotes(undefined);
    void loadNotes(targetBookId);
  }, [targetBookId, cachedNotes?.bookId]);

  async function loadNotes(nextBookId = targetBookId) {
    if (!nextBookId) {
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setExportResult(undefined);
    setShareError(undefined);

    try {
      const response = await getBookNotes(nextBookId);
      setNotes(response);
      onNotesChange(response.bookId || nextBookId, response);
    } catch (loadError) {
      setError(getCommandErrorInfo(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleShareCard(card: NoteCardItem) {
    setSharingCardId(card.id);
    setShareError(undefined);

    try {
      const fileName = await exportNoteCardImage({
        card,
        bookTitle: displayBook?.title || notes?.bookId || targetBookId || "单本笔记",
        author: displayBook?.author
      });
      showToast({
        message: formatArtifactCreatedMessage("note-card-image", { fileName }),
        tone: "success"
      });
    } catch (shareImageError) {
      setShareError(
        shareImageError instanceof Error ? shareImageError.message : "生成分享图片失败。"
      );
    } finally {
      setSharingCardId(undefined);
    }
  }

  async function handleShareCurrentGroup() {
    const cards = visibleCards.slice(0, SHARE_GROUP_LIMIT);
    if (cards.length === 0) {
      return;
    }

    setIsSharingGroup(true);
    setShareError(undefined);

    try {
      const fileName = await exportNoteGroupImage({
        cards,
        bookTitle: displayBook?.title || notes?.bookId || targetBookId || "单本笔记",
        author: displayBook?.author,
        scopeLabel: buildGroupShareScopeLabel({
          cardFilter,
          cardSort,
          isRandomGroup: randomCardIds.length > 0,
          totalCount: visibleCards.length,
          exportedCount: cards.length
        })
      });
      showToast({
        message: formatArtifactCreatedMessage("note-card-image", { fileName }),
        tone: "success"
      });
    } catch (shareImageError) {
      setShareError(
        shareImageError instanceof Error ? shareImageError.message : "生成组合分享图片失败。"
      );
    } finally {
      setIsSharingGroup(false);
    }
  }

  async function handleExport() {
    if (!targetBookId) {
      return;
    }

    setIsExporting(true);
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await exportBookNotesMarkdown(targetBookId);
      setExportResult(response);
      showToast({
        message: formatArtifactExportedMessage("notes-markdown"),
        tone: "success"
      });
    } catch (exportError) {
      setError(getCommandErrorInfo(exportError));
    } finally {
      setIsExporting(false);
    }
  }

  function handleViewModeChange(nextMode: NoteViewMode) {
    setViewMode(nextMode);
  }

  function handleCardFilterChange(nextFilter: NoteCardFilter) {
    setCardFilter(nextFilter);
    setRandomCardIds([]);
  }

  function handleCardSortChange(nextSort: NoteCardSort) {
    setCardSort(nextSort);
    setRandomCardIds([]);
  }

  function handleRandomCards() {
    const nextCards = pickRandomCards(orderedCards, RANDOM_CARD_LIMIT);
    setViewMode("cards");
    setRandomCardIds(nextCards.map((card) => card.id));
  }

  function handleShowAllCards() {
    setCardFilter("all");
    setRandomCardIds([]);
  }

  if (!targetBookId) {
    return (
      <section className="tool-panel" aria-label="未选择笔记书籍">
        <BookOpen aria-hidden="true" size={28} />
        <h3>还没有选择书籍</h3>
        <p>请先回到笔记中心，选择一本有笔记的书。</p>
        <button className="secondary-action" type="button" onClick={onBack}>
          {backLabel}
        </button>
      </section>
    );
  }

  return (
    <section className="book-notes-page" aria-label="单本笔记">
      <button className="text-button back-button" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={16} />
        {backLabel}
      </button>

      <section className="book-notes-header">
        <div className="cover-frame notebook-cover">
          {displayBook?.cover ? (
            <img src={displayBook.cover} alt="" />
          ) : (
            <BookOpen aria-hidden="true" size={30} />
          )}
        </div>
        <div>
          <p className="section-kicker">单本笔记</p>
          <h3>{displayBook?.title || notes?.bookId || targetBookId}</h3>
          <p>
            {displayBook?.author
              ? `${displayBook.author} · 可导出 Markdown，也可手动整理成复盘。`
              : "划线和想法会按章节分组展示，可导出 Markdown，也可手动整理成复盘。"}
          </p>
          <div className="book-notes-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void handleExport()}
              disabled={isLoading || isExporting}
            >
              {isExporting ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isExporting ? "导出中" : "导出 Markdown"}
            </button>
            <button
              className="sync-button"
              type="button"
              onClick={() => void loadNotes(targetBookId)}
              disabled={isLoading || isExporting}
            >
              {isLoading ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isLoading ? "刷新中" : "刷新"}
            </button>
            <button
              className="sync-button"
              type="button"
              onClick={() => notes && onOpenAiSummary(targetBookId, notes)}
              disabled={!notes || isLoading || isExporting}
            >
              <Sparkles aria-hidden="true" size={18} />
              AI 复盘
            </button>
          </div>
        </div>
      </section>

      {notes ? (
        <section className="shelf-summary-row book-notes-summary-row" aria-label="单本笔记统计">
          <SummaryPill label="划线" value={notes.highlights.length} />
          <SummaryPill label="想法/点评" value={notes.thoughts.length} />
          <SummaryPill label="书签" value={notes.bookmarkCount} />
          <SummaryPill label="可导出" value={notes.exportableCount} />
          <SummaryPill label="章节分组" value={notes.chapterGroups.length} />
        </section>
      ) : null}

      {notesReviewStatus ? <BookNotesReviewStatusCard status={notesReviewStatus} /> : null}

      {notes && !isLoading ? (
        <section className="book-notes-view-panel" aria-label="单本笔记视图">
          <div className="book-notes-view-row">
            <div>
              <p className="section-kicker">浏览方式</p>
              <h3>{viewMode === "cards" ? "卡片视图" : "章节视图"}</h3>
            </div>
            <div className="segmented-control" role="tablist" aria-label="笔记视图切换">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "list"}
                className={viewMode === "list" ? "is-active" : ""}
                onClick={() => handleViewModeChange("list")}
              >
                <List aria-hidden="true" size={16} />
                章节
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "cards"}
                className={viewMode === "cards" ? "is-active" : ""}
                onClick={() => handleViewModeChange("cards")}
              >
                <LayoutGrid aria-hidden="true" size={16} />
                卡片
              </button>
            </div>
          </div>

          {viewMode === "cards" ? (
            <div className="book-notes-card-tools" aria-label="卡片视图工具">
              <div className="filter-tabs compact-tabs" role="tablist" aria-label="笔记类型筛选">
                {[
                  { id: "all", label: "全部" },
                  { id: "highlight", label: "划线" },
                  { id: "thought", label: "想法" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={cardFilter === item.id}
                    className={cardFilter === item.id ? "is-active" : ""}
                    onClick={() => handleCardFilterChange(item.id as NoteCardFilter)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="filter-tabs compact-tabs" role="tablist" aria-label="笔记排序">
                {[
                  { id: "chapter", label: "按章节" },
                  { id: "latest", label: "最新" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={cardSort === item.id}
                    className={cardSort === item.id ? "is-active" : ""}
                    onClick={() => handleCardSortChange(item.id as NoteCardSort)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="book-notes-card-actions" aria-label="当前组操作">
                <button
                  className="sync-button"
                  type="button"
                  onClick={handleRandomCards}
                  disabled={orderedCards.length === 0}
                >
                  <Shuffle aria-hidden="true" size={17} />
                  随机一组
                </button>
                <button
                  className="sync-button"
                  type="button"
                  onClick={() => void handleShareCurrentGroup()}
                  disabled={visibleCards.length === 0 || sharingCardId !== undefined || isSharingGroup}
                >
                  {isSharingGroup ? (
                    <Loader2 aria-hidden="true" size={17} className="spin" />
                  ) : (
                    <Share2 aria-hidden="true" size={17} />
                  )}
                  {isSharingGroup ? "生成中" : "导出当前组"}
                </button>
                {randomCardIds.length > 0 ? (
                  <button className="text-button" type="button" onClick={() => setRandomCardIds([])}>
                    显示全部
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {viewMode === "cards" && randomCardIds.length > 0 ? (
            <p className="book-notes-random-note">
              已随机抽取 {visibleCards.length} 条当前笔记。
            </p>
          ) : null}
        </section>
      ) : null}

      {notes ? (
        <div className="status-message status-message--neutral">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{notes.bookmarkContentNotice}</span>
        </div>
      ) : null}

      {exportResult ? (
        <div className="status-message status-message--neutral">
          <Download aria-hidden="true" size={18} />
          <span>
            {formatArtifactExportedMessage("notes-markdown", {
              fileName: exportResult.fileName,
              path: exportResult.path
            })}
          </span>
        </div>
      ) : null}

      {shareError ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{shareError}</span>
        </div>
      ) : null}

      {error?.code === "upgrade_required" ? (
        <SkillUpgradeNotice error={error} onRetry={() => void loadNotes()} />
      ) : error ? (
        <section className="setup-card status-card" aria-label="笔记加载错误">
          <AlertCircle aria-hidden="true" size={24} />
          <div>
            <h3>笔记暂时不可用</h3>
            <p>{getCommandErrorMessage(error)}</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => void loadNotes()}>
            重试
          </button>
        </section>
      ) : null}

      {isLoading ? (
        <section className="book-detail-loading" aria-label="正在读取笔记">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取单本笔记</h3>
            <p>会合并划线和个人想法，书签只保留数量。</p>
          </div>
        </section>
      ) : null}

      {notes && !isLoading && viewMode === "list" ? <NoteList groups={notes.chapterGroups} /> : null}
      {notes && !isLoading && viewMode === "cards" ? (
        <NoteCardGrid
          cards={visibleCards}
          onShareCard={(card) => void handleShareCard(card)}
          onShowAll={handleShowAllCards}
          sharingCardId={sharingCardId}
          isGroupSharing={isSharingGroup}
        />
      ) : null}
    </section>
  );
}

function BookNotesReviewStatusCard({ status }: { status: BookNotesReviewStatus }) {
  return (
    <section className={`book-notes-review-status-card is-${status.tone}`} aria-label="复盘输入状态">
      <div className="book-notes-review-status-copy">
        <span>{status.label}</span>
        <div>
          <h3>{status.title}</h3>
          <p>{status.body}</p>
        </div>
      </div>
      <dl className="book-notes-review-status-metrics">
        <div>
          <dt>{status.primaryMetricLabel}</dt>
          <dd>{status.primaryMetricValue}</dd>
        </div>
        <div>
          <dt>{status.secondaryMetricLabel}</dt>
          <dd>{status.secondaryMetricValue}</dd>
        </div>
      </dl>
      <div className="book-notes-review-status-next">
        <strong>{status.nextActionLabel}</strong>
        <small>{status.nextActionReason}</small>
      </div>
    </section>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <article className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function NoteCardGrid({
  cards,
  onShareCard,
  onShowAll,
  sharingCardId,
  isGroupSharing
}: {
  cards: NoteCardItem[];
  onShareCard: (card: NoteCardItem) => void;
  onShowAll: () => void;
  sharingCardId?: string;
  isGroupSharing: boolean;
}) {
  if (cards.length === 0) {
    return (
      <section className="empty-inline" aria-label="没有匹配的笔记卡片">
        <Bookmark aria-hidden="true" size={28} />
        <h3>没有匹配的笔记卡片</h3>
        <p>可以切换类型筛选，或回到章节视图查看原始分组。</p>
        <button className="secondary-action" type="button" onClick={onShowAll}>
          显示全部卡片
        </button>
      </section>
    );
  }

  return (
    <div className="note-card-grid" aria-label="笔记卡片">
      {cards.map((card) => (
        <article className={`note-card note-card--${card.type}`} key={card.id}>
          <div className="note-card-head">
            <span>
              {card.type === "highlight" ? (
                <Bookmark aria-hidden="true" size={16} />
              ) : (
                <MessageSquareText aria-hidden="true" size={16} />
              )}
              {card.type === "highlight" ? "划线" : "想法"}
            </span>
            <small>{card.createdAt ? formatUnixDate(card.createdAt) : "未记录日期"}</small>
          </div>
          {card.abstractText ? <blockquote className="note-card-abstract">{card.abstractText}</blockquote> : null}
          {card.type === "highlight" ? <blockquote>{card.text}</blockquote> : <p>{card.text}</p>}
          <div className="note-card-meta">
            <span>{card.chapterTitle}</span>
            {card.meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="note-card-actions">
            <button
              className="text-button note-card-share"
              type="button"
              onClick={() => onShareCard(card)}
              disabled={sharingCardId !== undefined || isGroupSharing}
            >
              {sharingCardId === card.id ? (
                <Loader2 aria-hidden="true" size={15} className="spin" />
              ) : (
                <Share2 aria-hidden="true" size={15} />
              )}
              {sharingCardId === card.id ? "生成中" : "导出图片"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function buildNoteCards(groups: ChapterNoteGroup[]): NoteCardItem[] {
  return groups.flatMap((group, groupIndex) => [
    ...group.highlights.map((highlight, index) => buildHighlightCard(highlight, group, groupIndex, index)),
    ...group.thoughts.map((thought, index) => buildThoughtCard(thought, group, groupIndex, index))
  ]);
}

function buildHighlightCard(
  highlight: Highlight,
  group: ChapterNoteGroup,
  groupIndex: number,
  index: number
): NoteCardItem {
  return {
    id: `highlight-${highlight.bookmarkId || `${groupIndex}-${index}`}`,
    type: "highlight",
    text: highlight.markText,
    chapterTitle: highlight.chapterTitle || group.title,
    chapterUid: highlight.chapterUid ?? group.chapterUid,
    createdAt: highlight.createTime,
    meta: [
      highlight.range ? `位置 ${highlight.range}` : undefined,
      formatChapterUid(highlight.chapterUid ?? group.chapterUid)
    ].filter(Boolean) as string[]
  };
}

function buildThoughtCard(
  thought: Thought,
  group: ChapterNoteGroup,
  groupIndex: number,
  index: number
): NoteCardItem {
  return {
    id: `thought-${thought.reviewId || `${groupIndex}-${index}`}`,
    type: "thought",
    text: thought.content,
    abstractText: thought.abstractText,
    chapterTitle: thought.chapterName || group.title,
    chapterUid: thought.chapterUid ?? group.chapterUid,
    createdAt: thought.createTime,
    meta: [
      thought.star !== undefined ? formatPersonalStar(thought.star) : undefined,
      thought.range ? `位置 ${thought.range}` : undefined,
      thought.isFinish ? "读完点评" : undefined,
      formatChapterUid(thought.chapterUid ?? group.chapterUid)
    ].filter(Boolean) as string[]
  };
}

function filterNoteCards(cards: NoteCardItem[], filter: NoteCardFilter): NoteCardItem[] {
  if (filter === "all") {
    return cards;
  }

  return cards.filter((card) => card.type === filter);
}

function sortNoteCards(cards: NoteCardItem[], sort: NoteCardSort): NoteCardItem[] {
  const nextCards = [...cards];

  if (sort === "latest") {
    return nextCards.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  }

  return nextCards;
}

function pickRandomCards(cards: NoteCardItem[], limit: number): NoteCardItem[] {
  return [...cards]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(limit, cards.length));
}

function formatChapterUid(chapterUid?: number): string | undefined {
  return chapterUid ? `章节 ${chapterUid}` : undefined;
}

function formatPersonalStar(star: number): string {
  if (!Number.isFinite(star) || star <= 0) {
    return "未评分";
  }

  return `${Math.min(5, Math.trunc(star))} 星`;
}

async function exportNoteCardImage({
  card,
  bookTitle,
  author
}: {
  card: NoteCardItem;
  bookTitle: string;
  author?: string;
}): Promise<string> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("当前环境不支持 Canvas 导出。");
  }

  const contentWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;
  const labelY = 84;
  const titleY = 132;
  const titleLineHeight = 42;
  const bodyLineHeight = 46;
  const metaLineHeight = 32;

  context.font = "800 34px sans-serif";
  const titleLines = wrapCanvasText(context, bookTitle, contentWidth);
  const abstractText = card.abstractText ? `原文：${card.abstractText}` : undefined;
  const bodyText = card.type === "thought" ? `想法：${card.text}` : card.text;
  context.font = "24px serif";
  const abstractLines = abstractText ? wrapCanvasText(context, abstractText, contentWidth) : [];
  context.font = "30px serif";
  const bodyLines = wrapCanvasText(context, bodyText, contentWidth);
  const metaText = buildShareMetaText(card, author);
  context.font = "22px sans-serif";
  const metaLines = wrapCanvasText(context, metaText, contentWidth);
  const bodyY = titleY + titleLines.length * titleLineHeight + 48;
  const thoughtY = bodyY + abstractLines.length * 34 + (abstractLines.length > 0 ? 28 : 0);
  const dividerY = thoughtY + bodyLines.length * bodyLineHeight + 34;
  const metaY = dividerY + 34;
  const brandY = metaY + metaLines.length * metaLineHeight + 48;
  const height = Math.max(620, brandY + 76);
  const scale = 2;

  canvas.width = SHARE_CARD_WIDTH * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);

  drawShareCardBackground(context, SHARE_CARD_WIDTH, height);

  context.fillStyle = "#0f7668";
  context.font = "700 24px sans-serif";
  context.fillText(card.type === "highlight" ? "Highlight" : "Thought", SHARE_CARD_PADDING, labelY);

  context.fillStyle = "#152d3a";
  context.font = "800 34px sans-serif";
  drawCanvasText(context, bookTitle, SHARE_CARD_PADDING, titleY, contentWidth, titleLineHeight);

  if (abstractText) {
    context.fillStyle = "#607483";
    context.font = "24px serif";
    drawCanvasText(context, abstractText, SHARE_CARD_PADDING, bodyY, contentWidth, 34);
  }

  context.fillStyle = "#152d3a";
  context.font = "30px serif";
  drawCanvasText(
    context,
    bodyText,
    SHARE_CARD_PADDING,
    thoughtY,
    contentWidth,
    bodyLineHeight
  );

  context.strokeStyle = "rgba(21, 45, 58, 0.14)";
  context.beginPath();
  context.moveTo(SHARE_CARD_PADDING, dividerY);
  context.lineTo(SHARE_CARD_WIDTH - SHARE_CARD_PADDING, dividerY);
  context.stroke();

  context.fillStyle = "#607483";
  context.font = "22px sans-serif";
  drawCanvasText(context, metaText, SHARE_CARD_PADDING, metaY, contentWidth, metaLineHeight);

  context.fillStyle = "#0f7668";
  context.font = "700 22px sans-serif";
  context.fillText("WxReadMaster · 本地生成", SHARE_CARD_PADDING, brandY);

  const fileName = `${sanitizeFileName(bookTitle)}-${card.type === "highlight" ? "划线" : "想法"}.png`;
  await downloadCanvas(canvas, fileName);
  return fileName;
}

async function exportNoteGroupImage({
  cards,
  bookTitle,
  author,
  scopeLabel
}: {
  cards: NoteCardItem[];
  bookTitle: string;
  author?: string;
  scopeLabel: string;
}): Promise<string> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("当前环境不支持 Canvas 导出。");
  }

  const contentWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;
  const titleLineHeight = 42;
  const cardTitleLineHeight = 28;
  const bodyLineHeight = 32;
  const metaLineHeight = 24;
  const titleY = 106;
  context.font = "800 34px sans-serif";
  const titleLines = wrapCanvasText(context, bookTitle, contentWidth);
  context.font = "22px sans-serif";
  const scopeLines = wrapCanvasText(context, scopeLabel, contentWidth);
  let cursorY = titleY + titleLines.length * titleLineHeight + scopeLines.length * metaLineHeight + 58;
  const cardLayouts = cards.map((card, index) => {
    const cardTitle = `${index + 1}. ${noteTypeLabel(card.type)} · ${card.chapterTitle}`;
    const abstractText = card.abstractText ? `原文：${card.abstractText}` : undefined;
    const bodyText = card.type === "thought" ? `想法：${card.text}` : card.text;
    context.font = "800 22px sans-serif";
    const cardTitleLines = wrapCanvasText(context, cardTitle, contentWidth);
    context.font = "20px serif";
    const abstractLines = abstractText ? wrapCanvasText(context, abstractText, contentWidth) : [];
    context.font = "24px serif";
    const bodyLines = wrapCanvasText(context, bodyText, contentWidth);
    context.font = "18px sans-serif";
    const metaLines = wrapCanvasText(context, buildShareMetaText(card, author), contentWidth);
    const height =
      30 +
      cardTitleLines.length * cardTitleLineHeight +
      abstractLines.length * 28 +
      (abstractLines.length > 0 ? 12 : 0) +
      bodyLines.length * bodyLineHeight +
      metaLines.length * metaLineHeight +
      36;
    const layout = { card, cardTitle, cardTitleLines, abstractLines, bodyLines, metaLines, y: cursorY, height };
    cursorY += height + 16;
    return layout;
  });
  const brandY = cursorY + 28;
  const height = Math.max(720, brandY + 76);
  const scale = 2;

  canvas.width = SHARE_CARD_WIDTH * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  drawShareCardBackground(context, SHARE_CARD_WIDTH, height);

  context.fillStyle = "#0f7668";
  context.font = "700 24px sans-serif";
  context.fillText("Note Collection", SHARE_CARD_PADDING, 70);

  context.fillStyle = "#152d3a";
  context.font = "800 34px sans-serif";
  drawCanvasText(context, bookTitle, SHARE_CARD_PADDING, titleY, contentWidth, titleLineHeight);

  context.fillStyle = "#607483";
  context.font = "22px sans-serif";
  drawCanvasText(
    context,
    scopeLabel,
    SHARE_CARD_PADDING,
    titleY + titleLines.length * titleLineHeight + 10,
    contentWidth,
    metaLineHeight
  );

  cardLayouts.forEach((layout) => {
    const cardX = SHARE_CARD_PADDING;
    const cardWidth = contentWidth;
    context.fillStyle = "rgba(255, 253, 248, 0.72)";
    drawRoundedRect(context, cardX, layout.y - 20, cardWidth, layout.height, 18);
    context.fill();
    context.strokeStyle = "rgba(21, 45, 58, 0.10)";
    context.stroke();

    context.fillStyle = layout.card.type === "highlight" ? "#0f7668" : "#8b5a18";
    context.font = "800 22px sans-serif";
    drawCanvasText(
      context,
      layout.cardTitle,
      cardX + 24,
      layout.y,
      cardWidth - 48,
      cardTitleLineHeight
    );

    const bodyY = layout.y + layout.cardTitleLines.length * cardTitleLineHeight + 14;
    if (layout.card.abstractText) {
      context.fillStyle = "#607483";
      context.font = "20px serif";
      drawCanvasText(
        context,
        `原文：${layout.card.abstractText}`,
        cardX + 24,
        bodyY,
        cardWidth - 48,
        28
      );
    }

    const thoughtY = bodyY + layout.abstractLines.length * 28 + (layout.abstractLines.length > 0 ? 12 : 0);
    context.fillStyle = "#152d3a";
    context.font = "24px serif";
    drawCanvasText(
      context,
      layout.card.type === "thought" ? `想法：${layout.card.text}` : layout.card.text,
      cardX + 24,
      thoughtY,
      cardWidth - 48,
      bodyLineHeight
    );

    const metaY = thoughtY + layout.bodyLines.length * bodyLineHeight + 14;
    context.fillStyle = "#607483";
    context.font = "18px sans-serif";
    drawCanvasText(context, buildShareMetaText(layout.card, author), cardX + 24, metaY, cardWidth - 48, metaLineHeight);
  });

  context.fillStyle = "#0f7668";
  context.font = "700 22px sans-serif";
  context.fillText("WxReadMaster · 本地生成", SHARE_CARD_PADDING, brandY);

  const fileName = `${sanitizeFileName(bookTitle)}-笔记组合.png`;
  await downloadCanvas(canvas, fileName);
  return fileName;
}

function drawShareCardBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = "#e8e4d8";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff6dc";
  drawRoundedRect(context, 32, 32, width - 64, height - 64, 28);
  context.fill();

  context.fillStyle = "rgba(15, 118, 104, 0.08)";
  context.beginPath();
  context.arc(width - 110, 104, 150, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(212, 160, 63, 0.18)";
  context.beginPath();
  context.arc(88, height - 96, 130, 0, Math.PI * 2);
  context.fill();
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function buildShareMetaText(card: NoteCardItem, author?: string): string {
  const primaryMeta = [
    author,
    card.type === "highlight" ? "划线" : "想法",
    card.createdAt ? formatUnixDate(card.createdAt) : undefined
  ].filter(Boolean).join(" · ");
  const positionMeta = [
    card.chapterTitle,
    ...card.meta
  ].filter(Boolean).join(" · ");

  return [
    primaryMeta,
    positionMeta
  ].filter(Boolean).join("\n");
}

function noteTypeLabel(type: NoteCardItem["type"]): string {
  return type === "highlight" ? "划线" : "想法";
}

function buildGroupShareScopeLabel({
  cardFilter,
  cardSort,
  isRandomGroup,
  totalCount,
  exportedCount
}: {
  cardFilter: NoteCardFilter;
  cardSort: NoteCardSort;
  isRandomGroup: boolean;
  totalCount: number;
  exportedCount: number;
}): string {
  const filterLabel = cardFilter === "highlight" ? "只含划线" : cardFilter === "thought" ? "只含想法" : "划线和想法";
  const sortLabel = cardSort === "latest" ? "按最新排序" : "按章节排序";
  const scope = isRandomGroup ? "随机一组" : "当前筛选";
  const countLabel = totalCount > exportedCount ? `导出前 ${exportedCount} 条，共 ${totalCount} 条` : `导出 ${exportedCount} 条`;

  return `${scope} · ${filterLabel} · ${sortLabel} · ${countLabel}`;
}

function drawCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  wrapCanvasText(context, text, maxWidth).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  text.split("\n").forEach((paragraph) => {
    let line = "";
    Array.from(paragraph).forEach((char) => {
      const nextLine = `${line}${char}`;
      if (line && context.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = char;
        return;
      }

      line = nextLine;
    });

    if (line) {
      lines.push(line);
    }
  });

  return lines.length > 0 ? lines : [""];
}

async function downloadCanvas(canvas: HTMLCanvasElement, fileName: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
        return;
      }

      reject(new Error("生成分享图片失败。"));
    }, "image/png");
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "note-card";
}
