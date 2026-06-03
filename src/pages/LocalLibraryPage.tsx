import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  AlertCircle,
  BookOpen,
  FilePlus2,
  FileText,
  Grid2X2,
  Import,
  List,
  Loader2,
  Search,
  SearchX,
  X
} from "lucide-react";
import { useToast } from "../components/ToastProvider";
import {
  chooseLocalBookFile,
  getLocalReadingProgress,
  importLocalBook,
  listLocalBooks
} from "../lib/local-reader-api";
import type {
  LocalBook,
  LocalBookFormat,
  LocalReadingProgress
} from "../lib/local-reader-types";
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
  findLikelyWereadBookMatch,
  type SourceVersionPair
} from "../lib/source-version-matches";
import type { ShelfEntry } from "../lib/types";
import { getCommandErrorMessage } from "../lib/reading-api";
import { formatAiTimestamp, formatProgress } from "../lib/formatters";

type LocalBookFilter = "all" | LocalBookFormat;
type LocalLibraryViewMode = "list" | "grid";
type LocalReadingProgressReadResult = {
  progress?: LocalReadingProgress;
  error?: string;
};

const filterLabels: Record<LocalBookFilter, string> = {
  all: "全部",
  epub: "EPUB",
  txt: "TXT",
  markdown: "Markdown"
};
const localBookFilters: LocalBookFilter[] = ["all", "epub", "txt", "markdown"];

type LocalLibraryPageProps = {
  onOpenBook?: (bookId: string) => void;
  wereadEntries?: ShelfEntry[];
};

export function LocalLibraryPage({ onOpenBook, wereadEntries = [] }: LocalLibraryPageProps) {
  const [books, setBooks] = useState<LocalBook[]>([]);
  const [progressByBookId, setProgressByBookId] = useState<Record<string, LocalReadingProgress>>({});
  const [filter, setFilter] = useState<LocalBookFilter>("all");
  const [viewMode, setViewMode] = useState<LocalLibraryViewMode>("grid");
  const [query, setQuery] = useState("");
  const [filePath, setFilePath] = useState("");
  const [assetLinks, setAssetLinks] = useState<ReadingAssetLinkPair[]>(() =>
    readReadingAssetLinks(getReadingAssetLinkStorage())
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isChoosing, setIsChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const { showToast } = useToast();
  const filteredBooks = useMemo(
    () => filterLocalBooks(books, filter, deferredQuery),
    [books, deferredQuery, filter]
  );
  const wereadMatchByBookId = useMemo(
    () => buildWereadMatchByLocalBookId(books, wereadEntries),
    [books, wereadEntries]
  );
  const sourceVersionPairByBookId = useMemo(
    () => buildSourceVersionPairByLocalBookId(books, wereadMatchByBookId),
    [books, wereadMatchByBookId]
  );
  const bookCountLabel =
    filteredBooks.length === books.length
      ? `${books.length} 本`
      : `${filteredBooks.length} / ${books.length} 本`;

  useEffect(() => {
    let isMounted = true;

    async function loadBooks() {
      setIsLoading(true);
      setError(undefined);
      setWarning(undefined);

      try {
        const nextBooks = await listLocalBooks();
        const progressEntries = await Promise.all(
          nextBooks.map(
            async (book) => [book.id, await readLocalReadingProgressSafely(book.id)] as const
          )
        );
        const progressLoadState = resolveLocalLibraryProgressLoadState(progressEntries);

        if (isMounted) {
          startTransition(() => {
            setBooks(nextBooks);
            setProgressByBookId(progressLoadState.progressByBookId);
          });
          setWarning(progressLoadState.warning);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
          setWarning(undefined);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBooks();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  function handleFilterChange(nextFilter: LocalBookFilter) {
    startTransition(() => {
      setFilter(nextFilter);
    });
  }

  function handleClearQuery() {
    startTransition(() => {
      setQuery("");
    });
  }

  async function handleImportLocalBook() {
    await importLocalBookFromPath(filePath);
  }

  async function handleChooseLocalBookFile() {
    setIsChoosing(true);
    setError(undefined);
    setWarning(undefined);

    let selectedPath: string | undefined;
    try {
      selectedPath = await chooseLocalBookFile();
    } catch (chooseError) {
      const message = getCommandErrorMessage(chooseError);
      setError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsChoosing(false);
    }

    if (!selectedPath) {
      return;
    }

    startTransition(() => {
      setFilePath(selectedPath);
    });
    await importLocalBookFromPath(selectedPath);
  }

  async function importLocalBookFromPath(rawPath: string) {
    const normalizedPath = rawPath.trim();
    if (!normalizedPath) {
      setError("请输入 EPUB、TXT 或 Markdown 文件路径。");
      setWarning(undefined);
      return;
    }

    setIsImporting(true);
    setError(undefined);
    setWarning(undefined);

    try {
      const importResult = await importLocalBook({ filePath: normalizedPath });
      const { book, wasAlreadyImported } = importResult;
      const progressResult = await readLocalReadingProgressSafely(book.id);
      const importNotice = resolveLocalBookImportNotice(book, wasAlreadyImported);

      startTransition(() => {
        setBooks((current) => upsertLocalBook(current, book));
        setProgressByBookId((current) => ({
          ...current,
          ...(progressResult.progress ? { [book.id]: progressResult.progress } : {})
        }));
        setFilePath("");
      });
      showToast(importNotice);
      if (progressResult.error) {
        showToast(resolveLocalBookImportProgressWarning(progressResult.error));
      }
    } catch (importError) {
      const message = getCommandErrorMessage(importError);
      setError(message);
      setWarning(undefined);
      showToast({ message, tone: "error" });
    } finally {
      setIsImporting(false);
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

  return (
    <section className="local-library-page" aria-label="本地书库">
      <header className="local-library-commandbar">
        <div className="local-library-command-actions">
          <label className="search-field local-library-command-search">
            <Search aria-hidden="true" size={18} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书名、作者或关键词"
            />
            {query ? (
              <button type="button" aria-label="清空搜索" onClick={handleClearQuery}>
                <X aria-hidden="true" size={15} />
              </button>
            ) : (
              <kbd>Ctrl + K</kbd>
            )}
          </label>
          <div className="local-library-filter-tabs" role="tablist" aria-label="本地书库格式筛选">
            {localBookFilters.map((item) => (
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
      </header>

      <div className="local-library-divider" />

      <div className="local-library-meta-row">
        <p>
          {filter === "all" ? "全部书籍" : `${filterLabels[filter]} 书籍`}
          <strong>{bookCountLabel}</strong>
        </p>
        <div className="local-library-meta-actions">
          <span className="local-library-sort-label">排序：最近阅读</span>
          <div className="local-library-view-toggle" aria-label="本地书库视图">
            <button
              type="button"
              className={viewMode === "grid" ? "is-active" : ""}
              aria-pressed={viewMode === "grid"}
              aria-label="网格视图"
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 aria-hidden="true" size={18} />
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "is-active" : ""}
              aria-pressed={viewMode === "list"}
              aria-label="列表视图"
              onClick={() => setViewMode("list")}
            >
              <List aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}
      {!error && warning ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{warning}</span>
        </div>
      ) : null}

      <div className="local-library-workbench">
        <section className="local-library-list-panel" aria-label="本地图书列表">
          {isLoading ? <LocalLibraryLoading /> : null}

          {!isLoading && books.length === 0 ? <LocalLibraryEmpty /> : null}

          {!isLoading && books.length > 0 && filteredBooks.length === 0 ? (
            <section className="local-library-list-empty" aria-label="本地书库筛选无结果">
              <SearchX aria-hidden="true" size={30} />
              <h3>没有匹配的本地图书</h3>
              <p>换一个关键词，或切回全部格式继续浏览。</p>
            </section>
          ) : null}

          {!isLoading && filteredBooks.length > 0 ? (
            <div
              className={`local-book-list local-book-list--${viewMode}`}
              aria-label="本地图书列表"
            >
              {filteredBooks.map((book) => (
                <LocalBookRow
                  key={book.id}
                  book={book}
                  progress={progressByBookId[book.id]}
                  wereadMatch={wereadMatchByBookId.get(book.id)}
                  sourceVersionPair={sourceVersionPairByBookId.get(book.id)}
                  isSourceVersionLinked={Boolean(
                    findReadingAssetLinkPair(assetLinks, sourceVersionPairByBookId.get(book.id))
                  )}
                  onToggleSourceVersionLink={handleToggleSourceVersionLink}
                  onOpen={onOpenBook ? () => onOpenBook(book.id) : undefined}
                />
              ))}
            </div>
          ) : null}
        </section>

        <aside className="local-library-dropzone" aria-label="导入本地图书">
          <div className="local-library-dropzone-illustration">
            <FilePlus2 aria-hidden="true" size={68} />
            <span>
              <Import aria-hidden="true" size={20} />
            </span>
          </div>
          <h3>选择或粘贴本地图书</h3>
          <p>支持 EPUB / TXT / Markdown 格式</p>
          <label className="local-library-path-field">
            <FileText aria-hidden="true" size={18} />
            <input
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="C:/Books/example.epub"
              disabled={isImporting}
            />
          </label>
          <div className="local-library-import-actions">
            <button
              className="local-library-choose-button"
              type="button"
              onClick={() => void handleChooseLocalBookFile()}
              disabled={isImporting || isChoosing}
            >
              {isChoosing ? "选择中" : isImporting ? "导入中" : "选择文件"}
            </button>
            <button
              className="local-library-path-import-button"
              type="button"
              onClick={() => void handleImportLocalBook()}
              disabled={isImporting || isChoosing || !filePath.trim()}
            >
              {isImporting ? (
                <Loader2 aria-hidden="true" size={17} className="spin" />
              ) : (
                <Import aria-hidden="true" size={17} />
              )}
              {isImporting ? "导入中" : "导入路径"}
            </button>
          </div>
          <small>选择文件会直接导入；也可以粘贴本地路径后点击导入路径。</small>
        </aside>
      </div>
    </section>
  );
}

function LocalBookRow({
  book,
  progress,
  wereadMatch,
  sourceVersionPair,
  isSourceVersionLinked,
  onToggleSourceVersionLink,
  onOpen
}: {
  book: LocalBook;
  progress?: LocalReadingProgress;
  wereadMatch?: ShelfEntry;
  sourceVersionPair?: SourceVersionPair;
  isSourceVersionLinked: boolean;
  onToggleSourceVersionLink: (pair: SourceVersionPair, isLinked: boolean) => void;
  onOpen?: () => void;
}) {
  const progressPercent = progress?.progressPercent ?? 0;
  const coverTone = resolveLocalBookCoverTone(book);
  const coverTitle = resolveLocalBookCoverTitle(book.title);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!onOpen) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  function handleToggleSourceVersionLink(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (sourceVersionPair) {
      onToggleSourceVersionLink(sourceVersionPair, isSourceVersionLinked);
    }
  }

  return (
    <article
      className={`local-book-row ${onOpen ? "local-book-row--interactive" : ""}`}
      aria-label={`${book.title} ${formatLocalBookFormatLabel(book.format)}`}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <span
        className={`local-book-cover local-book-cover--${book.format} local-book-cover--tone-${coverTone}`}
        aria-hidden="true"
      >
        <span className="local-book-cover-mark">
          <BookOpen size={17} />
        </span>
        <strong className="local-book-cover-title">{coverTitle}</strong>
        <span className="local-book-cover-format">{formatLocalBookFormatBadge(book.format)}</span>
      </span>
      <span className="local-book-row-main">
        <strong>{book.title}</strong>
        <small>{book.author || "未知作者"}</small>
        <span className="local-book-row-badges" aria-label="本地图书来源">
          <span className="local-book-format-badge">{formatLocalBookFormatLabel(book.format)}</span>
          <span className="local-book-source-badge">本地版本</span>
          {wereadMatch ? (
            <span
              className={
                isSourceVersionLinked
                  ? "local-book-weread-match-badge local-book-weread-match-badge--linked"
                  : "local-book-weread-match-badge"
              }
              aria-label="疑似微信读书版本"
              title={`微信读书版本：${wereadMatch.title}`}
            >
              {isSourceVersionLinked ? "已关联微信版本" : "可能有微信版本"}
            </span>
          ) : null}
          {sourceVersionPair ? (
            <button
              className="local-book-source-link-button"
              type="button"
              onClick={handleToggleSourceVersionLink}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {isSourceVersionLinked ? "取消关联" : "关联"}
            </button>
          ) : null}
        </span>
      </span>
      <span className="local-book-row-progress">
        <small>阅读进度</small>
        <span>
          <meter min={0} max={100} value={progressPercent} />
          <strong>{progress ? formatProgress(progressPercent) : "未开始"}</strong>
        </span>
      </span>
      <span className="local-book-row-meta">
        <small>最后阅读</small>
        <span>{formatAiTimestamp(progress?.updatedAt ?? book.updatedAt) || "刚刚导入"}</span>
      </span>
    </article>
  );
}

function LocalLibraryEmpty() {
  return (
    <section className="local-library-list-empty" aria-label="本地书库为空">
      <FileText aria-hidden="true" size={42} />
      <h3>还没有本地图书</h3>
      <p>从右侧导入 EPUB/TXT/Markdown 后，这里会按最近阅读展示本地版本和阅读进度。</p>
    </section>
  );
}

function LocalLibraryLoading() {
  return (
    <div className="local-book-loading" aria-label="正在读取本地书库">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function filterLocalBooks(
  books: LocalBook[],
  filter: LocalBookFilter,
  query: string
): LocalBook[] {
  const keyword = query.trim().toLowerCase();

  return books.filter((book) => {
    if (filter !== "all" && book.format !== filter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const title = book.title.toLowerCase();
    const author = book.author?.toLowerCase() ?? "";
    const format = book.format.toLowerCase();

    return title.includes(keyword) || author.includes(keyword) || format.includes(keyword);
  });
}

function upsertLocalBook(books: LocalBook[], nextBook: LocalBook): LocalBook[] {
  const withoutCurrent = books.filter((book) => book.id !== nextBook.id);
  return [nextBook, ...withoutCurrent].sort((left, right) => {
    const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (Number.isFinite(updatedDelta) && updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.title.localeCompare(right.title, "zh-Hans-CN");
  });
}

function toProgressMap(
  entries: Array<readonly [string, LocalReadingProgress | undefined]>
): Record<string, LocalReadingProgress> {
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, LocalReadingProgress] => Boolean(entry[1]))
  );
}

export function resolveLocalBookCoverTitle(title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return "未命名";
  }

  return Array.from(trimmedTitle).slice(0, 4).join("");
}

export function resolveLocalBookCoverTone(
  book: Pick<LocalBook, "id" | "title" | "author" | "format">
): number {
  const seed = `${book.id}:${book.title}:${book.author ?? ""}:${book.format}`;
  const hash = Array.from(seed).reduce((total, character) => total + character.charCodeAt(0), 0);

  return (hash % 5) + 1;
}

export function formatLocalBookFormatLabel(format: LocalBookFormat): string {
  return filterLabels[format];
}

export function formatLocalBookFormatBadge(format: LocalBookFormat): string {
  if (format === "markdown") {
    return "MD";
  }

  return format.toUpperCase();
}

async function readLocalReadingProgressSafely(
  bookId: string
): Promise<LocalReadingProgressReadResult> {
  try {
    return { progress: await getLocalReadingProgress(bookId) };
  } catch (error) {
    return { error: getCommandErrorMessage(error) };
  }
}

export function resolveLocalLibraryProgressLoadState(
  entries: Array<readonly [string, LocalReadingProgressReadResult]>
): { progressByBookId: Record<string, LocalReadingProgress>; warning?: string } {
  const progressByBookId = toProgressMap(
    entries.map(([bookId, result]) => [bookId, result.progress] as const)
  );
  const hasProgressReadFailure = entries.some(([, result]) => Boolean(result.error));

  return {
    progressByBookId,
    warning: hasProgressReadFailure
      ? "部分阅读进度暂时无法读取，书库已按图书信息展示。"
      : undefined
  };
}

function buildWereadMatchByLocalBookId(
  books: LocalBook[],
  wereadEntries: ShelfEntry[]
): Map<string, ShelfEntry> {
  const matches = new Map<string, ShelfEntry>();
  for (const book of books) {
    const match = findLikelyWereadBookMatch(book, wereadEntries);
    if (match) {
      matches.set(book.id, match);
    }
  }

  return matches;
}

function buildSourceVersionPairByLocalBookId(
  books: LocalBook[],
  wereadMatchByBookId: Map<string, ShelfEntry>
): Map<string, SourceVersionPair> {
  const pairs = new Map<string, SourceVersionPair>();
  for (const book of books) {
    const match = wereadMatchByBookId.get(book.id);
    if (!match) {
      continue;
    }

    const pair = buildLikelySourceVersionPair(book, match);
    if (pair) {
      pairs.set(book.id, pair);
    }
  }

  return pairs;
}

export function resolveLocalBookImportNotice(
  book: Pick<LocalBook, "title">,
  wasAlreadyImported: boolean
): { message: string; tone: "success" | "neutral" } {
  if (wasAlreadyImported) {
    return {
      message: `《${book.title}》已在本地书库，可直接打开现有记录。`,
      tone: "neutral"
    };
  }

  return {
    message: `已导入《${book.title}》`,
    tone: "success"
  };
}

export function resolveLocalBookImportProgressWarning(
  progressErrorMessage: string
): { message: string; tone: "neutral" } {
  return {
    message: `图书已导入，但阅读进度暂时无法读取：${progressErrorMessage}`,
    tone: "neutral"
  };
}
