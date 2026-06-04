import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  AlertCircle,
  BookOpen,
  Copy,
  Compass,
  Headphones,
  MoreHorizontal,
  Newspaper,
  RefreshCw,
  Search,
  SearchX,
  X
} from "lucide-react";
import emptyShelf from "../assets/empty-shelf.png";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import { useToast } from "../components/ToastProvider";
import { copyTextToClipboard } from "../lib/clipboard";
import { getCommandErrorMessage, upsertReadingItemState, type BookshelfResponse } from "../lib/reading-api";
import type { CredentialStatus, ShelfArchive, ShelfEntry } from "../lib/types";
import {
  ARCHIVE_PREVIEW_LIMIT,
  CATEGORY_PREVIEW_LIMIT,
  filterEntries,
  filterLabels,
  getCategoryEntries,
  getCategoryOptions,
  getUnarchivedBookCount,
  getVisibleArchiveOptions,
  getVisibleCategoryOptions,
  type ShelfFilter
} from "./bookshelf-filter";

type BookshelfPageProps = {
  credentialStatus?: CredentialStatus;
  bookshelf?: BookshelfResponse;
  isLoading: boolean;
  isSyncing: boolean;
  error?: string;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenDetail: (entry: ShelfEntry) => void;
  onSearchInDiscovery: (entry: ShelfEntry) => void;
};

type ShelfEntryCardProps = {
  entry: ShelfEntry;
  onOpenDetail: (entry: ShelfEntry) => void;
  onSearchInDiscovery: (entry: ShelfEntry) => void;
  onCopyTitle: (entry: ShelfEntry) => void;
  onSaveCandidate: (entry: ShelfEntry) => void;
};

const BOOKSHELF_INITIAL_VISIBLE_COUNT = 96;
const BOOKSHELF_VISIBLE_COUNT_STEP = 96;
const BOOKSHELF_LOAD_MORE_THRESHOLD = 120;

export function BookshelfPage({
  credentialStatus,
  bookshelf,
  isLoading,
  isSyncing,
  error,
  onSync,
  onOpenSettings,
  onOpenDetail,
  onSearchInDiscovery
}: BookshelfPageProps) {
  const [filter, setFilter] = useState<ShelfFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("all");
  const [isCategoryExpanded, setIsCategoryExpanded] = useState(false);
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(BOOKSHELF_INITIAL_VISIBLE_COUNT);
  const deferredQuery = useDeferredValue(query);
  const firstResultRef = useRef<HTMLButtonElement | null>(null);
  const hasCredential = credentialStatus?.hasCredential === true;
  const entries = useMemo(() => bookshelf?.snapshot.entries ?? [], [bookshelf?.snapshot.entries]);
  const archives = useMemo(() => bookshelf?.snapshot.archives ?? [], [bookshelf?.snapshot.archives]);
  const summary = bookshelf?.snapshot.summary;
  const categoryEntries = useMemo(() => getCategoryEntries(entries, filter), [entries, filter]);
  const categoryOptions = useMemo(() => getCategoryOptions(categoryEntries), [categoryEntries]);
  const shouldShowCategoryPanel = filter !== "mp" && categoryOptions.length > 1;
  const shouldShowArchivePanel = (filter === "all" || filter === "book") && archives.length > 0;
  const visibleCategoryOptions = useMemo(
    () => getVisibleCategoryOptions(categoryOptions, categoryFilter, isCategoryExpanded),
    [categoryOptions, categoryFilter, isCategoryExpanded]
  );
  const visibleArchiveOptions = useMemo(
    () => getVisibleArchiveOptions(archives, archiveFilter, isArchiveExpanded),
    [archives, archiveFilter, isArchiveExpanded]
  );
  const hiddenCategoryCount = Math.max(0, categoryOptions.length - visibleCategoryOptions.length);
  const hiddenArchiveCount = Math.max(0, archives.length - visibleArchiveOptions.length);
  const unarchivedBookCount = useMemo(
    () => getUnarchivedBookCount(entries, archives),
    [entries, archives]
  );
  const selectedArchive = useMemo(
    () => (shouldShowArchivePanel ? archives.find((archive) => archive.id === archiveFilter) : undefined),
    [archives, archiveFilter, shouldShowArchivePanel]
  );
  const filteredEntries = useMemo(
    () => filterEntries(entries, filter, categoryFilter, deferredQuery, archiveFilter, archives),
    [entries, filter, categoryFilter, deferredQuery, archiveFilter, archives]
  );
  const shouldLimitVisibleEntries = filteredEntries.length > BOOKSHELF_LOAD_MORE_THRESHOLD;
  const visibleEntries = useMemo(
    () => (shouldLimitVisibleEntries ? filteredEntries.slice(0, visibleCount) : filteredEntries),
    [filteredEntries, shouldLimitVisibleEntries, visibleCount]
  );
  const visibleEntryCount = visibleEntries.length;
  const remainingEntryCount = Math.max(0, filteredEntries.length - visibleEntryCount);
  const nextLoadCount = Math.min(BOOKSHELF_VISIBLE_COUNT_STEP, remainingEntryCount);
  const hasQuery = deferredQuery.trim().length > 0;
  const { showToast } = useToast();

  useEffect(() => {
    if (!shouldShowCategoryPanel) {
      if (categoryFilter !== "all") {
        setCategoryFilter("all");
      }

      if (isCategoryExpanded) {
        setIsCategoryExpanded(false);
      }

      return;
    }

    if (categoryFilter !== "all" && !categoryOptions.some((category) => category.label === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, categoryOptions, isCategoryExpanded, shouldShowCategoryPanel]);

  useEffect(() => {
    setVisibleCount(BOOKSHELF_INITIAL_VISIBLE_COUNT);
  }, [entries, filter, categoryFilter, archiveFilter, deferredQuery]);

  useEffect(() => {
    if (!shouldShowArchivePanel) {
      if (archiveFilter !== "all") {
        setArchiveFilter("all");
      }

      if (isArchiveExpanded) {
        setIsArchiveExpanded(false);
      }

      return;
    }

    if (
      archiveFilter !== "all" &&
      archiveFilter !== "unarchived" &&
      !archives.some((archive) => archive.id === archiveFilter)
    ) {
      setArchiveFilter("all");
    }

    if (archiveFilter === "unarchived" && unarchivedBookCount === 0) {
      setArchiveFilter("all");
    }
  }, [archiveFilter, archives, isArchiveExpanded, shouldShowArchivePanel, unarchivedBookCount]);

  function handleFilterChange(nextFilter: ShelfFilter) {
    startTransition(() => {
      setFilter(nextFilter);
    });
  }

  function handleCategoryFilterChange(nextCategory: string) {
    startTransition(() => {
      setCategoryFilter(nextCategory);
    });
  }

  function handleArchiveFilterChange(nextArchive: string) {
    startTransition(() => {
      setArchiveFilter(nextArchive);
    });
  }

  function handleToggleCategoryExpanded() {
    startTransition(() => {
      setIsCategoryExpanded((current) => !current);
    });
  }

  function handleToggleArchiveExpanded() {
    startTransition(() => {
      setIsArchiveExpanded((current) => !current);
    });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
  }

  function handleClearQuery() {
    startTransition(() => {
      setQuery("");
    });
  }

  function handleResetFilters() {
    startTransition(() => {
      setFilter("all");
      setCategoryFilter("all");
      setArchiveFilter("all");
      setQuery("");
    });
  }

  function handleLoadMoreEntries() {
    startTransition(() => {
      setVisibleCount((current) =>
        Math.min(current + BOOKSHELF_VISIBLE_COUNT_STEP, filteredEntries.length)
      );
    });
  }

  function handleQueryKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Escape" && query) {
      event.preventDefault();
      handleClearQuery();
      return;
    }

    if (event.key === "Enter" && filteredEntries.length > 0) {
      event.preventDefault();
      firstResultRef.current?.focus();
    }
  }

  async function handleCopyEntryTitle(entry: ShelfEntry) {
    try {
      await copyTextToClipboard(entry.title);
      showToast({ message: `已复制「${entry.title}」`, tone: "success" });
    } catch (copyError) {
      showToast({
        message: copyError instanceof Error ? copyError.message : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  async function handleSaveCandidate(entry: ShelfEntry) {
    if (entry.type === "book") {
      return;
    }

    try {
      await upsertReadingItemState({
        itemId: entry.id,
        itemType: entry.type,
        status: "toRead",
        title: entry.title,
        author: entry.author,
        cover: entry.cover,
        category: entry.category,
        note: `书架${filterLabels[entry.type]}保存的本地候选`
      });
      showToast({ message: `已保存《${entry.title}》到本地候选`, tone: "success" });
    } catch (candidateError) {
      showToast({ message: getCommandErrorMessage(candidateError), tone: "error" });
    }
  }

  return (
    <section className="bookshelf-page" aria-label="书架">
      <div className="bookshelf-toolbar">
        <div>
          <p className="section-kicker">本地缓存</p>
          <h3>我的微信读书书架</h3>
          <p>先把书架同步到本机，再从这里进入阅读、整理和复盘流程。</p>
        </div>
        <button className="sync-button" type="button" onClick={onSync} disabled={!hasCredential || isSyncing}>
          <RefreshCw aria-hidden="true" size={18} className={isSyncing ? "spin" : ""} />
          <span>{isSyncing ? "同步中" : "同步书架"}</span>
        </button>
      </div>

      <section className="shelf-summary-row" aria-label="书架统计">
        <SummaryPill label="全部" value={summary?.totalVisibleEntries ?? 0} />
        <SummaryPill label="电子书" value={summary?.bookCount ?? 0} />
        <SummaryPill label="有声书" value={summary?.albumCount ?? 0} />
        <SummaryPill label="文章收藏" value={summary?.mpCount ?? 0} />
        <SummaryPill label="私密" value={summary?.secretCount ?? 0} />
        <SummaryPill label="微信书单" value={archives.length} />
      </section>

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="保存凭据后可同步书架。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="bookshelf-filter-stack" aria-label="书架筛选">
        <div className="bookshelf-filter-group">
          <span className="bookshelf-filter-label">类型</span>
          <div className="filter-tabs bookshelf-filter-tabs bookshelf-filter-tabs--type" role="tablist" aria-label="书架类型筛选">
            {(["all", "book", "album", "mp"] as ShelfFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={filter === item}
                className={filter === item ? "is-active" : ""}
                onClick={() => handleFilterChange(item)}
              >
                {filterLabels[item]}
              </button>
            ))}
          </div>
        </div>

        {shouldShowCategoryPanel ? (
          <section className="bookshelf-filter-group category-filter-panel" aria-label="书架分类筛选">
            <span className="bookshelf-filter-label">分类</span>
            <div className="bookshelf-filter-row">
              <div className="filter-tabs bookshelf-filter-tabs bookshelf-filter-tabs--category category-filter-tabs" role="group" aria-label="书架父分类">
                <button
                  type="button"
                  aria-pressed={categoryFilter === "all"}
                  className={categoryFilter === "all" ? "is-active" : ""}
                  onClick={() => handleCategoryFilterChange("all")}
                >
                  全部
                </button>
                {visibleCategoryOptions.map((category) => (
                  <button
                    key={category.label}
                    type="button"
                    aria-pressed={categoryFilter === category.label}
                    className={categoryFilter === category.label ? "is-active" : ""}
                    onClick={() => handleCategoryFilterChange(category.label)}
                  >
                    {category.label}
                    <span>{category.count}</span>
                  </button>
                ))}
                {categoryOptions.length > CATEGORY_PREVIEW_LIMIT ? (
                  <button
                    className="category-filter-toggle"
                    type="button"
                    aria-expanded={isCategoryExpanded}
                    onClick={handleToggleCategoryExpanded}
                  >
                    {isCategoryExpanded ? "收起分类" : `展开更多${hiddenCategoryCount > 0 ? ` ${hiddenCategoryCount}` : ""}`}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {shouldShowArchivePanel ? (
          <section className="bookshelf-filter-group archive-filter-panel" aria-label="微信书单筛选">
            <span className="bookshelf-filter-label">书单</span>
            <div className="bookshelf-filter-row">
              <div className="filter-tabs bookshelf-filter-tabs bookshelf-filter-tabs--category archive-filter-tabs" role="group" aria-label="微信书单">
                <button
                  type="button"
                  aria-pressed={archiveFilter === "all"}
                  className={archiveFilter === "all" ? "is-active" : ""}
                  onClick={() => handleArchiveFilterChange("all")}
                >
                  全部书单
                </button>
                {unarchivedBookCount > 0 || archiveFilter === "unarchived" ? (
                  <button
                    type="button"
                    aria-pressed={archiveFilter === "unarchived"}
                    className={archiveFilter === "unarchived" ? "is-active" : ""}
                    onClick={() => handleArchiveFilterChange("unarchived")}
                  >
                    未归入书单
                    <span>{unarchivedBookCount}</span>
                  </button>
                ) : null}
                {visibleArchiveOptions.map((archive) => (
                  <button
                    key={archive.id}
                    type="button"
                    aria-pressed={archiveFilter === archive.id}
                    className={archiveFilter === archive.id ? "is-active" : ""}
                    onClick={() => handleArchiveFilterChange(archive.id)}
                    title={archive.name}
                  >
                    {archive.name}
                    <span>{archive.matchedEntryCount}</span>
                  </button>
                ))}
                {archives.length > ARCHIVE_PREVIEW_LIMIT ? (
                  <button
                    className="category-filter-toggle"
                    type="button"
                    aria-expanded={isArchiveExpanded}
                    onClick={handleToggleArchiveExpanded}
                  >
                    {isArchiveExpanded ? "收起书单" : `展开更多${hiddenArchiveCount > 0 ? ` ${hiddenArchiveCount}` : ""}`}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </section>

      {selectedArchive ? (
        <ArchiveNotice archive={selectedArchive} />
      ) : shouldShowArchivePanel && archiveFilter === "unarchived" ? (
        <div className="bookshelf-archive-notice" aria-label="未归入书单说明">
          <strong>未归入书单</strong>
          <span>当前有 {unarchivedBookCount} 本电子书未出现在微信书单中。</span>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="bookshelf-search-row">
          <label className="search-field">
            <Search aria-hidden="true" size={18} />
            <input
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleQueryKeyDown}
              placeholder="按书名、作者或分类筛选书架"
            />
          </label>
          {query ? (
            <button className="text-button bookshelf-search-clear" type="button" onClick={handleClearQuery}>
              <X aria-hidden="true" size={16} />
              清空
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? <ShelfLoading /> : null}

      {!isLoading && entries.length === 0 ? (
        <EmptyShelf
          hasCredential={hasCredential}
          onSync={onSync}
          onOpenSettings={onOpenSettings}
          isSyncing={isSyncing}
        />
      ) : null}

      {!isLoading && entries.length > 0 && filteredEntries.length === 0 ? (
        <section className="empty-inline" aria-label="筛选无结果">
          <SearchX aria-hidden="true" size={28} />
          <h3>{emptyResultTitle(hasQuery, categoryFilter, archiveFilter)}</h3>
          <p>{emptyResultDescription(hasQuery, archiveFilter)}</p>
          <button className="secondary-action" type="button" onClick={hasQuery ? handleClearQuery : handleResetFilters}>
            {hasQuery ? "清空搜索" : "查看全部书架"}
          </button>
        </section>
      ) : null}

      {!isLoading && filteredEntries.length > 0 ? (
        <section className="bookshelf-results" aria-label="书架条目">
          <div className="bookshelf-results-bar" aria-live="polite">
            <span>
              {remainingEntryCount > 0
                ? `已显示 ${visibleEntryCount} / 共 ${filteredEntries.length} 条`
                : `共 ${filteredEntries.length} 条`}
            </span>
          </div>
          <div className="book-grid" aria-label="书架条目列表">
            {visibleEntries.map((entry, index) => (
              <ShelfEntryCard
                key={`${entry.type}-${entry.id}`}
                entry={entry}
                ref={index === 0 ? firstResultRef : undefined}
                onOpenDetail={onOpenDetail}
                onSearchInDiscovery={onSearchInDiscovery}
                onCopyTitle={(nextEntry) => void handleCopyEntryTitle(nextEntry)}
                onSaveCandidate={(nextEntry) => void handleSaveCandidate(nextEntry)}
              />
            ))}
          </div>
          {remainingEntryCount > 0 ? (
            <div className="bookshelf-load-more" aria-label="书架加载更多">
              <p>还有 {remainingEntryCount} 条未显示</p>
              <button className="secondary-action" type="button" onClick={handleLoadMoreEntries}>
                <span>加载更多</span>
                <small>继续显示 {nextLoadCount} 条</small>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function ArchiveNotice({ archive }: { archive: ShelfArchive }) {
  return (
    <div className="bookshelf-archive-notice" aria-label="微信书单说明">
      <strong>书单：{archive.name}</strong>
      <span>
        包含 {archive.bookIds.length} 本，当前书架可匹配 {archive.matchedEntryCount} 本。
        {archive.missingBookCount > 0
          ? `有 ${archive.missingBookCount} 本暂未出现在当前书架同步结果中。`
          : ""}
      </span>
    </div>
  );
}

function emptyResultTitle(hasQuery: boolean, categoryFilter: string, archiveFilter: string): string {
  if (hasQuery) {
    return "没有匹配的书架条目";
  }

  if (archiveFilter !== "all") {
    return "当前书单没有可显示条目";
  }

  return categoryFilter === "all" ? "当前类型没有条目" : "当前分类没有条目";
}

function emptyResultDescription(hasQuery: boolean, archiveFilter: string): string {
  if (hasQuery) {
    return "换一个关键词，或清空搜索后继续浏览。";
  }

  if (archiveFilter !== "all") {
    return "换一个书单、类型或分类，或同步后再查看。";
  }

  return "换一个类型或分类，或同步后再查看。";
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <article className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ShelfLoading() {
  return (
    <div className="shelf-loading" aria-label="正在读取书架">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function EmptyShelf({
  hasCredential,
  onSync,
  onOpenSettings,
  isSyncing
}: {
  hasCredential: boolean;
  onSync: () => void;
  onOpenSettings: () => void;
  isSyncing: boolean;
}) {
  return (
    <section className="empty-state" aria-label="书架为空">
      <img src={emptyShelf} alt="" />
      <div>
        <h3>{hasCredential ? "还没有同步书架" : "书架等待连接"}</h3>
        <p>
          {hasCredential
            ? "同步后会把电子书、有声书和文章收藏写入本机缓存，作为后续复盘和整理的入口。"
            : "保存 API Key 后即可把个人书架同步到本机缓存，继续整理阅读成果。"}
        </p>
        <button
          className="secondary-action"
          type="button"
          onClick={hasCredential ? onSync : onOpenSettings}
          disabled={hasCredential && isSyncing}
        >
          {hasCredential ? "同步书架" : "打开设置"}
        </button>
      </div>
    </section>
  );
}

const ShelfEntryCard = forwardRef<HTMLButtonElement, ShelfEntryCardProps>(({
  entry,
  onOpenDetail,
  onSearchInDiscovery,
  onCopyTitle,
  onSaveCandidate
}, ref) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const Icon = entry.type === "album" ? Headphones : entry.type === "mp" ? Newspaper : BookOpen;
  const isBook = entry.type === "book";

  function closeMenu() {
    setIsMenuOpen(false);
  }

  function toggleMenu() {
    setIsMenuOpen((current) => !current);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  function handleSearchInDiscovery() {
    closeMenu();
    onSearchInDiscovery(entry);
  }

  function handleCopyTitle() {
    closeMenu();
    onCopyTitle(entry);
  }

  function handleSaveCandidate() {
    closeMenu();
    onSaveCandidate(entry);
  }

  function renderCardContent() {
    return (
      <>
        <span className="cover-frame">
          {entry.cover ? <img src={entry.cover} alt="" /> : <Icon aria-hidden="true" size={32} />}
        </span>
        <span className="shelf-card-copy">
          <strong>{entry.title}</strong>
          <small>{entry.author || entry.category || filterLabels[entry.type]}</small>
          <span className="shelf-card-meta">
            {entry.isTop ? "置顶" : filterLabels[entry.type]}
            {entry.isSecret ? " · 私密" : ""}
            {entry.isFinished ? " · 已读完" : ""}
          </span>
        </span>
      </>
    );
  }

  return (
    <article
      className={`shelf-card ${isBook ? "" : "shelf-card--menu-card"}`}
      aria-label={`${entry.title} ${filterLabels[entry.type]}`}
    >
      {isBook ? (
        <button
          ref={ref}
          type="button"
          className="shelf-card-main shelf-card-main--button"
          onClick={() => onOpenDetail(entry)}
        >
          {renderCardContent()}
        </button>
      ) : (
        <>
          <div className="shelf-card-main">{renderCardContent()}</div>
          <div className="shelf-card-menu" onKeyDown={handleMenuKeyDown}>
            <button
              ref={ref}
              className="shelf-card-menu-trigger"
              type="button"
              aria-label={`${entry.title} 更多操作`}
              title={nonBookActionText()}
              aria-expanded={isMenuOpen}
              onClick={toggleMenu}
            >
              <MoreHorizontal aria-hidden="true" size={18} />
            </button>
            {isMenuOpen ? (
              <div className="shelf-card-menu-popover" role="menu" aria-label={`${entry.title} 操作菜单`}>
                <button type="button" role="menuitem" onClick={handleSearchInDiscovery}>
                  <Compass aria-hidden="true" size={16} />
                  去发现页搜索
                </button>
                <button type="button" role="menuitem" onClick={handleSaveCandidate}>
                  <BookOpen aria-hidden="true" size={16} />
                  保存候选
                </button>
                <button type="button" role="menuitem" onClick={handleCopyTitle}>
                  <Copy aria-hidden="true" size={16} />
                  复制标题
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
});

ShelfEntryCard.displayName = "ShelfEntryCard";

function nonBookActionText(): string {
  return "暂不支持详情";
}
