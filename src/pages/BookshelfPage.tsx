import {
  forwardRef,
  useDeferredValue,
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
import type { CredentialStatus, ShelfEntry, ShelfEntryType } from "../lib/types";

type ShelfFilter = "all" | ShelfEntryType;

type CategoryOption = {
  label: string;
  count: number;
};

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

const filterLabels: Record<ShelfFilter, string> = {
  all: "全部",
  book: "电子书",
  album: "有声书",
  mp: "文章收藏"
};

const CATEGORY_PREVIEW_LIMIT = 12;

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
  const [isCategoryExpanded, setIsCategoryExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const firstResultRef = useRef<HTMLButtonElement | null>(null);
  const hasCredential = credentialStatus?.hasCredential === true;
  const entries = bookshelf?.snapshot.entries ?? [];
  const summary = bookshelf?.snapshot.summary;
  const categoryOptions = getCategoryOptions(entries);
  const visibleCategoryOptions = getVisibleCategoryOptions(
    categoryOptions,
    categoryFilter,
    isCategoryExpanded
  );
  const hiddenCategoryCount = Math.max(0, categoryOptions.length - visibleCategoryOptions.length);
  const filteredEntries = filterEntries(entries, filter, categoryFilter, deferredQuery);
  const hasQuery = deferredQuery.trim().length > 0;
  const { showToast } = useToast();

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

  function handleToggleCategoryExpanded() {
    startTransition(() => {
      setIsCategoryExpanded((current) => !current);
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
      setQuery("");
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
          <p>从本机缓存读取，手动同步时才调用微信读书接口。</p>
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
      </section>

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="书架同步只通过本地 Tauri 命令执行。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="filter-tabs" role="tablist" aria-label="书架筛选">
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

      {categoryOptions.length > 0 ? (
        <section className="category-filter-panel" aria-label="书架分类筛选">
          <div className="filter-tabs category-filter-tabs" role="tablist" aria-label="书架父分类">
            <button
              type="button"
              role="tab"
              aria-selected={categoryFilter === "all"}
              className={categoryFilter === "all" ? "is-active" : ""}
              onClick={() => handleCategoryFilterChange("all")}
            >
              全部分类
            </button>
            {visibleCategoryOptions.map((category) => (
              <button
                key={category.label}
                type="button"
                role="tab"
                aria-selected={categoryFilter === category.label}
                className={categoryFilter === category.label ? "is-active" : ""}
                onClick={() => handleCategoryFilterChange(category.label)}
              >
                {category.label}
                <span>{category.count}</span>
              </button>
            ))}
          </div>
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
        </section>
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
          <h3>{hasQuery ? "没有匹配的书架条目" : "当前分类没有条目"}</h3>
          <p>{hasQuery ? "换一个关键词，或清空搜索后继续浏览。" : "换一个类型或分类，或同步后再查看。"}</p>
          <button className="secondary-action" type="button" onClick={hasQuery ? handleClearQuery : handleResetFilters}>
            {hasQuery ? "清空搜索" : "查看全部书架"}
          </button>
        </section>
      ) : null}

      {!isLoading && filteredEntries.length > 0 ? (
        <div className="book-grid" aria-label="书架条目">
          {filteredEntries.map((entry, index) => (
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
      ) : null}
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
            ? "同步后会按电子书、有声书和文章收藏展示，计数使用微信读书书架的完整口径。"
            : "保存 API Key 后即可把个人书架同步到本机缓存。"}
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

function filterEntries(
  entries: ShelfEntry[],
  filter: ShelfFilter,
  categoryFilter: string,
  query: string
): ShelfEntry[] {
  const keyword = query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filter !== "all" && entry.type !== filter) {
      return false;
    }

    if (categoryFilter !== "all" && getParentCategory(entry.category) !== categoryFilter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const title = entry.title.toLowerCase();
    const author = entry.author?.toLowerCase() ?? "";
    const category = entry.category?.toLowerCase() ?? "";

    return title.includes(keyword) || author.includes(keyword) || category.includes(keyword);
  });
}

function getCategoryOptions(entries: ShelfEntry[]): CategoryOption[] {
  const counts = new Map<string, { count: number; index: number }>();

  entries.forEach((entry) => {
    const category = getParentCategory(entry.category);
    if (!category) {
      return;
    }

    const current = counts.get(category);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(category, { count: 1, index: counts.size });
  });

  return Array.from(counts, ([label, value]) => ({ label, count: value.count, index: value.index }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ label, count }) => ({ label, count }));
}

function getVisibleCategoryOptions(
  options: CategoryOption[],
  activeCategory: string,
  isExpanded: boolean
): CategoryOption[] {
  if (isExpanded || options.length <= CATEGORY_PREVIEW_LIMIT) {
    return options;
  }

  const preview = options.slice(0, CATEGORY_PREVIEW_LIMIT);
  if (activeCategory === "all" || preview.some((category) => category.label === activeCategory)) {
    return preview;
  }

  const activeOption = options.find((category) => category.label === activeCategory);
  return activeOption ? [...preview.slice(0, CATEGORY_PREVIEW_LIMIT - 1), activeOption] : preview;
}

function getParentCategory(category?: string): string | undefined {
  const normalized = category?.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.split("-")[0]?.trim() || normalized;
}
