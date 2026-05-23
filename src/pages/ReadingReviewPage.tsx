import { startTransition, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Database,
  Download,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  Settings,
  Target,
  Trophy
} from "lucide-react";
import {
  exportReadingStatsReviewMarkdown,
  getAiSettingsState,
  getCommandErrorMessage,
  getLatestReadingStatsReview,
  getReadingStats,
  summarizeReadingStats,
  syncReadingStats,
  type ReadingStatsResponse
} from "../lib/reading-api";
import {
  buildReadingHabitProfile,
  extractRepresentativeThemes,
  hasEnoughDataForHabitProfile
} from "../lib/business-rules";
import { formatAiTimestamp, formatDuration, formatUnixDate } from "../lib/formatters";
import type {
  AiSettingsState,
  BookAiSummarySource,
  CredentialStatus,
  ExportAiMarkdownResponse,
  ReadingCategory,
  ReadingRankItem,
  ReadingStats,
  ReadingStatsAiReviewResponse,
  ReadingStatsMode,
  ReadingTimeBucket
} from "../lib/types";

type ReadingReviewPageProps = {
  credentialStatus?: CredentialStatus;
  cache: Partial<Record<ReadingStatsMode, ReadingStatsResponse>>;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
};

type ReviewStatus =
  | "idle"
  | "setup-required"
  | "loading-cache"
  | "generating"
  | "cached"
  | "generated"
  | "error";

const periodOptions: Array<{ mode: ReadingStatsMode; label: string; description: string }> = [
  { mode: "weekly", label: "本周", description: "短周期节奏" },
  { mode: "monthly", label: "本月", description: "默认复盘" },
  { mode: "annually", label: "今年", description: "年度节奏" },
  { mode: "overall", label: "总计", description: "长期画像" }
];

export function ReadingReviewPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings
}: ReadingReviewPageProps) {
  const [mode, setMode] = useState<ReadingStatsMode>("monthly");
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [reviewResponse, setReviewResponse] = useState<ReadingStatsAiReviewResponse>();
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isLoadingReviewCache, setIsLoadingReviewCache] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportAiMarkdownResponse>();
  const [error, setError] = useState<string>();
  const hasCredential = credentialStatus?.hasCredential === true;
  const stats = cache[mode]?.stats;
  const review = reviewResponse?.review;
  const hasStatsData = hasReadableStats(stats);
  const canGenerate =
    Boolean(stats) &&
    hasStatsData &&
    aiState?.credential.hasCredential === true &&
    status !== "generating" &&
    !isLoadingReviewCache &&
    !isLoadingStats;
  const peakBucket = getPeakBucket(stats);
  const topCategory = getTopCategory(stats?.categories ?? []);
  const timeSegments = buildReviewTimelineSegments(stats);
  const representativeThemes = extractRepresentativeThemes(stats);
  const habitProfile = buildReadingHabitProfile(stats);
  const canBuildProfile = hasEnoughDataForHabitProfile(stats);
  const statusMeta = statusMetaFromState(status, Boolean(reviewResponse?.errorMessage));
  const isStaleCache = reviewResponse?.source === "staleCache";

  useEffect(() => {
    let isMounted = true;

    async function loadAiState() {
      try {
        const nextState = await getAiSettingsState();
        if (!isMounted) {
          return;
        }

        setAiState(nextState);
        setStatus((current) =>
          current === "cached" ||
          current === "generated" ||
          current === "generating" ||
          current === "loading-cache"
            ? current
            : statusFromAiState(nextState)
        );
      } catch (settingsError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorMessage(settingsError));
        }
      }
    }

    void loadAiState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      if (cache[mode]) {
        setError(undefined);
        setIsLoadingStats(false);
        return;
      }

      setIsLoadingStats(true);
      setError(undefined);

      try {
        const cached = await getReadingStats(mode);
        if (isMounted) {
          onCacheChange(mode, cached);
        }
      } catch (statsError) {
        if (isMounted) {
          setError(getCommandErrorMessage(statsError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingStats(false);
        }
      }
    }

    void loadStats();

    return () => {
      isMounted = false;
    };
  }, [mode, cache, onCacheChange]);

  useEffect(() => {
    setReviewResponse(undefined);
    setError(undefined);
    setStatus(statusFromAiState(aiState));
  }, [mode, stats]);

  useEffect(() => {
    let isMounted = true;

    async function loadCachedReview() {
      if (!stats || !hasStatsData) {
        setIsLoadingReviewCache(false);
        return;
      }

      setIsLoadingReviewCache(true);
      setError(undefined);
      setStatus("loading-cache");

      try {
        const cached = await getLatestReadingStatsReview({
          mode: stats.mode,
          baseTime: stats.baseTime
        });

        if (!isMounted) {
          return;
        }

        if (cached) {
          setReviewResponse(cached);
          setStatus(statusFromSource(cached.source));
          setError(cached.errorMessage);
          return;
        }

        setReviewResponse(undefined);
        setStatus(statusFromAiState(aiState));
      } catch (cacheError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorMessage(cacheError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingReviewCache(false);
        }
      }
    }

    void loadCachedReview();

    return () => {
      isMounted = false;
    };
  }, [stats, hasStatsData]);

  async function handleSyncStats() {
    if (!hasCredential) {
      setError("请先在设置中保存微信读书 API Key，再同步阅读统计。");
      onOpenSettings();
      return;
    }

    setIsSyncing(true);
    setError(undefined);

    try {
      const synced = await syncReadingStats(mode);
      onCacheChange(mode, synced);
    } catch (syncError) {
      setError(getCommandErrorMessage(syncError));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleGenerate(regenerate: boolean) {
    if (!stats) {
      setError("请先读取或同步当前周期统计，再生成阅读复盘。");
      return;
    }

    if (!hasStatsData) {
      setError("当前周期还没有可复盘的统计数据。");
      return;
    }

    if (aiState?.credential.hasCredential !== true) {
      setStatus("setup-required");
      return;
    }

    setStatus("generating");
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await summarizeReadingStats({
        mode: stats.mode,
        baseTime: stats.baseTime,
        regenerate
      });
      setReviewResponse(response);
      setStatus(statusFromSource(response.source));
      if (response.errorMessage) {
        setError(response.errorMessage);
      }
    } catch (reviewError) {
      setStatus("error");
      setError(getCommandErrorMessage(reviewError));
    }
  }

  async function handleExport() {
    if (!stats || !review) {
      return;
    }

    setIsExporting(true);
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await exportReadingStatsReviewMarkdown({
        mode: stats.mode,
        baseTime: stats.baseTime
      });
      setExportResult(response);
    } catch (exportError) {
      setError(getCommandErrorMessage(exportError));
    } finally {
      setIsExporting(false);
    }
  }

  function handleModeChange(nextMode: ReadingStatsMode) {
    startTransition(() => {
      setMode(nextMode);
    });
  }

  return (
    <section className="reading-review-page" aria-label="阅读复盘">
      <section className="review-cover-card">
        <div className="review-cover-main">
          <p className="section-kicker">AI 阅读体检报告</p>
          <h3>{reviewTitle(mode)}</h3>
          <p>
            {review?.overview ??
              "把阅读统计转成更容易行动的复盘报告：节奏、偏好、重点内容和下一步行动分开展示。"}
          </p>
          <div className="review-cover-actions">
            <button
              className="sync-button"
              type="button"
              onClick={() => void handleGenerate(false)}
              disabled={!canGenerate || Boolean(review)}
            >
              {status === "generating" || isLoadingReviewCache ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Database aria-hidden="true" size={18} />
              )}
              {status === "generating"
                ? "生成中"
                : isLoadingReviewCache
                  ? "读取缓存中"
                  : "生成复盘"}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void handleGenerate(true)}
              disabled={!canGenerate || !review}
            >
              <RefreshCw aria-hidden="true" size={18} />
              重新生成
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => void handleSyncStats()}
              disabled={!hasCredential || isSyncing}
            >
              {isSyncing ? (
                <Loader2 aria-hidden="true" size={16} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={16} />
              )}
              {isSyncing ? "同步中" : "同步统计"}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void handleExport()}
              disabled={!review || isExporting || isLoadingReviewCache || status === "generating"}
            >
              {isExporting ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isExporting ? "导出中" : "导出 Markdown"}
            </button>
          </div>
        </div>
        <div className="review-cover-side">
          <span className={`ai-summary-badge ai-summary-badge--${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
          <strong>{formatDuration(stats?.totalReadTimeSeconds)}</strong>
          <small>{periodLabel(mode)}总阅读/收听时长</small>
        </div>
      </section>

      <div className="period-tabs" role="tablist" aria-label="复盘周期">
        {periodOptions.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="tab"
            aria-selected={mode === option.mode}
            className={mode === option.mode ? "is-active" : ""}
            onClick={() => handleModeChange(option.mode)}
          >
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>

      {status === "setup-required" ? (
        <div className="ai-summary-callout">
          <Settings aria-hidden="true" size={20} />
          <div>
            <strong>需要先配置 AI Provider</strong>
            <p>复盘页只发送结构化统计，不发送笔记正文或书籍全文。</p>
          </div>
          <button className="secondary-action" type="button" onClick={onOpenSettings}>
            去设置
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {exportResult ? (
        <div className="status-message status-message--neutral">
          <Download aria-hidden="true" size={18} />
          <span>已导出 {exportResult.fileName}，路径：{exportResult.path}</span>
        </div>
      ) : null}

      {isStaleCache && !error ? (
        <div className="status-message status-message--neutral">
          <Database aria-hidden="true" size={18} />
          <span>正在展示同周期最近一次缓存；统计数据已变化，可点击重新生成更新复盘。</span>
        </div>
      ) : null}

      {isLoadingStats ? (
        <section className="book-detail-loading" aria-label="正在读取复盘统计">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取本地统计缓存</h3>
            <p>没有缓存时可以先同步统计，再生成阅读复盘。</p>
          </div>
        </section>
      ) : null}

      {!isLoadingStats && !hasStatsData ? (
        <section className="empty-inline stats-empty" aria-label="复盘统计为空">
          <CalendarDays aria-hidden="true" size={28} />
          <h3>还没有可复盘的数据</h3>
          <p>先同步当前周期统计；复盘页会基于结构化统计生成报告。</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void handleSyncStats()}
            disabled={!hasCredential || isSyncing}
          >
            {isSyncing ? "同步中" : "同步统计"}
          </button>
        </section>
      ) : null}

      {stats ? (
        <>
          <section className="review-metric-grid" aria-label="复盘指标">
            <ReviewMetricCard
              icon={<CalendarDays aria-hidden="true" size={20} />}
              label="阅读天数"
              value={`${stats.readDays ?? 0}天`}
              detail="单日满 1 分钟计入"
            />
            <ReviewMetricCard
              icon={<Clock3 aria-hidden="true" size={20} />}
              label={mode === "overall" ? "长期日均" : "自然日均"}
              value={formatAverageDuration(stats)}
              detail={mode === "overall" ? "总计周期不强推自然日均" : "用于判断稳定性"}
            />
            <ReviewMetricCard
              icon={<BarChart3 aria-hidden="true" size={20} />}
              label="高峰分桶"
              value={peakBucket ? formatBucketLabel(stats.mode, peakBucket.startTime) : "暂无"}
              detail={peakBucket ? formatDuration(peakBucket.readTimeSeconds) : "同步后展示"}
            />
            <ReviewMetricCard
              icon={<Compass aria-hidden="true" size={20} />}
              label="主要偏好"
              value={topCategory?.title ?? "暂无"}
              detail={topCategory ? formatCategoryValue(topCategory) : "分类数据不足"}
            />
          </section>

          <section className="review-layout">
            <div className="review-column review-column--left">
              <section className="review-panel review-timeline-panel" aria-label="阅读时间轴">
                <PanelHeading
                  kicker="阅读时间轴"
                  title="按阶段看阅读变化"
                  badge={`${stats.buckets.filter((bucket) => bucket.readTimeSeconds > 0).length} 个分桶`}
                />
                <ReviewTimeline mode={stats.mode} buckets={stats.buckets} />
                <ReviewTimeSegments
                  mode={stats.mode}
                  readDays={stats.readDays}
                  segments={timeSegments}
                  themes={representativeThemes}
                />
                <ReviewList
                  title="AI 节奏标注"
                  icon={<BarChart3 aria-hidden="true" size={18} />}
                  items={review?.rhythmInsights ?? []}
                  emptyText="生成复盘后会把趋势变化标注成可读结论。"
                />
              </section>

              <section className="review-panel" aria-label="阅读习惯画像">
                <PanelHeading
                  kicker="阅读习惯画像"
                  title="本周期更接近哪种节奏"
                  badge="仅本地统计"
                />
                <HabitProfileCard profile={habitProfile} canBuildProfile={canBuildProfile} />
              </section>
            </div>

            <div className="review-column review-column--right">
              <section className="review-panel" aria-label="偏好地图">
                <PanelHeading kicker="偏好地图" title="主题投入结构" badge="分类偏好" />
                <PreferenceMap categories={stats.categories} />
                <ReviewList
                  title="AI 偏好解释"
                  icon={<Compass aria-hidden="true" size={18} />}
                  items={review?.preferenceInsights ?? []}
                  emptyText="生成复盘后会解释你把时间投向了哪些主题。"
                />
              </section>

              <section className="review-panel" aria-label="重点内容">
                <PanelHeading kicker="重点内容" title="最值得复盘的书" badge="最多 4 本" />
                <FocusBooks items={stats.longestItems} aiItems={review?.focusItems ?? []} />
              </section>
            </div>

            <section className="review-panel review-action-panel" aria-label="下一步行动">
              <PanelHeading kicker="行动建议" title="把复盘变成安排" badge="可执行" />
              <ReviewList
                title="下一步行动"
                icon={<ListChecks aria-hidden="true" size={18} />}
                items={review?.nextActions ?? []}
                emptyText="生成复盘后会给出 3-5 条可执行建议。"
              />
              <div className="review-action-note">
                <Lightbulb aria-hidden="true" size={18} />
                <span>建议只保留少数行动项，避免把复盘变成新的待办压力。</span>
              </div>
            </section>
          </section>

          <section className="ai-summary-source-card" aria-label="复盘数据依据">
            <div>
              <strong>数据依据</strong>
              <small>只发送结构化统计：周期、阅读天数、总时长、趋势分桶、最长内容和分类偏好。</small>
            </div>
            <div className="ai-summary-stats">
              <SummaryStat label="分桶" value={stats.buckets.length} />
              <SummaryStat label="最长内容" value={stats.longestItems.length} />
              <SummaryStat label="分类" value={stats.categories.length} />
              <SummaryStat label="阅读天数" value={stats.readDays ?? 0} />
            </div>
          </section>

          <div className="ai-summary-meta">
            <span>生成时间：{formatAiTimestamp(review?.generatedAt) || "尚未生成"}</span>
            <span>Prompt：{review?.promptVersion ?? "reading-stats-review-v1"}</span>
            {reviewResponse?.providerModel ? <span>模型：{reviewResponse.providerModel}</span> : null}
            {reviewResponse?.cachedUpdatedAt ? (
              <span>缓存更新：{formatAiTimestamp(reviewResponse.cachedUpdatedAt)}</span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function ReviewMetricCard({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="review-metric-card">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PanelHeading({
  kicker,
  title,
  badge
}: {
  kicker: string;
  title: string;
  badge: string;
}) {
  return (
    <div className="stats-card-heading">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h3>{title}</h3>
      </div>
      <span>{badge}</span>
    </div>
  );
}

function ReviewTimeline({
  mode,
  buckets
}: {
  mode: ReadingStatsMode;
  buckets: ReadingTimeBucket[];
}) {
  const visibleBuckets = buckets.filter((bucket) => bucket.readTimeSeconds > 0);

  if (visibleBuckets.length === 0) {
    return (
      <div className="review-empty-block">
        <BarChart3 aria-hidden="true" size={22} />
        <span>暂无趋势分桶。</span>
      </div>
    );
  }

  const maxSeconds = Math.max(...visibleBuckets.map((bucket) => bucket.readTimeSeconds), 1);

  return (
    <div className="review-timeline">
      {visibleBuckets.map((bucket) => {
        const width = `${Math.max(8, Math.round((bucket.readTimeSeconds / maxSeconds) * 100))}%`;

        return (
          <article key={bucket.startTime}>
            <div>
              <strong>{formatBucketLabel(mode, bucket.startTime)}</strong>
              <span>{formatDuration(bucket.readTimeSeconds)}</span>
            </div>
            <i style={{ width }} />
          </article>
        );
      })}
    </div>
  );
}

function ReviewTimeSegments({
  mode,
  readDays,
  segments,
  themes
}: {
  mode: ReadingStatsMode;
  readDays?: number;
  segments: ReviewTimelineSegment[];
  themes: string[];
}) {
  if (segments.length === 0) {
    return (
      <div className="review-empty-block">
        <CalendarDays aria-hidden="true" size={22} />
        <span>当前周期还不足以切出阶段变化。</span>
      </div>
    );
  }

  return (
    <section className="review-stage-list" aria-label="阅读阶段变化">
      <div className="review-stage-summary">
        <span>{readDays ? `${readDays} 天参与阅读` : "阅读天数不足"}</span>
        <span>{themes.length > 0 ? `${themes.length} 个代表主题` : "等待主题聚合"}</span>
      </div>
      {segments.map((segment) => (
        <article key={`${segment.anchorTime}-${segment.title}`}>
          <div className="review-stage-heading">
            <strong>{segment.title}</strong>
            <span>{formatBucketLabel(mode, segment.anchorTime)}</span>
          </div>
          <p>{segment.description}</p>
        </article>
      ))}
      {themes.length > 0 ? (
        <div className="review-stage-tags" aria-label="代表主题">
          {themes.map((theme) => (
            <span key={theme}>{theme}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function HabitProfileCard({
  profile,
  canBuildProfile
}: {
  profile: ReturnType<typeof buildReadingHabitProfile>;
  canBuildProfile: boolean;
}) {
  if (!canBuildProfile || !profile) {
    return (
      <div className="review-empty-block">
        <Compass aria-hidden="true" size={22} />
        <span>数据不足，继续阅读后生成画像。</span>
      </div>
    );
  }

  return (
    <section className="review-profile-card">
      <div className="review-profile-head">
        <span className="review-profile-badge">本周期更接近</span>
        <strong>{profile.primaryLabel}</strong>
        {profile.secondaryLabels.length > 0 ? (
          <small>兼有 {profile.secondaryLabels.join(" / ")} 倾向</small>
        ) : (
          <small>这不是固定人格，只是当前周期侧写。</small>
        )}
      </div>
      <p>{profile.description}</p>
      <ul className="review-profile-evidence">
        {profile.evidence.map((item, index) => (
          <li key={`${item}-${index}`}>
            <CheckCircle2 aria-hidden="true" size={15} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="review-profile-footnote">
        <Lightbulb aria-hidden="true" size={16} />
        <span>{profile.basisNotice}</span>
      </div>
    </section>
  );
}

function PreferenceMap({ categories }: { categories: ReadingCategory[] }) {
  if (categories.length === 0) {
    return (
      <div className="review-empty-block">
        <Compass aria-hidden="true" size={22} />
        <span>暂无分类偏好。</span>
      </div>
    );
  }

  const visibleCategories = categories.slice(0, 8);
  const maxValue = Math.max(
    ...visibleCategories.map((category) => category.readingTimeSeconds ?? category.value ?? 0),
    1
  );

  return (
    <div className="review-preference-map">
      {visibleCategories.map((category, index) => {
        const value = category.readingTimeSeconds ?? category.value ?? 0;
        const size = 74 + Math.round((value / maxValue) * 88);

        return (
          <article
            key={`${category.categoryId ?? category.title}-${index}`}
            style={{ width: size, height: size }}
          >
            <strong>{category.title}</strong>
            <small>{formatCategoryValue(category)}</small>
          </article>
        );
      })}
    </div>
  );
}

function FocusBooks({ items, aiItems }: { items: ReadingRankItem[]; aiItems: string[] }) {
  if (items.length === 0 && aiItems.length === 0) {
    return (
      <div className="review-empty-block">
        <Trophy aria-hidden="true" size={22} />
        <span>暂无重点内容。</span>
      </div>
    );
  }

  return (
    <div className="review-focus-grid">
      {items.slice(0, 4).map((item, index) => (
        <article className="review-focus-book" key={`${item.id}-${index}`}>
          <span className="rank-cover">
            {item.cover ? <img src={item.cover} alt="" /> : <BookOpen aria-hidden="true" size={24} />}
          </span>
          <div>
            <strong>{item.title}</strong>
            <small>{item.author || (item.type === "album" ? "有声内容" : "电子书")}</small>
            <b>{formatDuration(item.readTimeSeconds)}</b>
          </div>
        </article>
      ))}
      {aiItems.length > 0 ? (
        <ReviewList
          title="AI 重点解释"
          icon={<Target aria-hidden="true" size={18} />}
          items={aiItems}
          emptyText=""
        />
      ) : null}
    </div>
  );
}

function ReviewList({
  title,
  icon,
  items,
  emptyText
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyText: string;
}) {
  return (
    <section className="review-list-card">
      <h4>
        {icon}
        {title}
      </h4>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>
              <CheckCircle2 aria-hidden="true" size={15} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}

function hasReadableStats(stats?: ReadingStats): boolean {
  return Boolean(
    stats &&
      ((stats.totalReadTimeSeconds ?? 0) > 0 ||
        (stats.readDays ?? 0) > 0 ||
        stats.buckets.length > 0 ||
        stats.longestItems.length > 0 ||
        stats.categories.length > 0)
  );
}

function getPeakBucket(stats?: ReadingStats): ReadingTimeBucket | undefined {
  return stats?.buckets.reduce<ReadingTimeBucket | undefined>((peak, bucket) => {
    if (bucket.readTimeSeconds <= 0) {
      return peak;
    }

    if (!peak || bucket.readTimeSeconds > peak.readTimeSeconds) {
      return bucket;
    }

    return peak;
  }, undefined);
}

function getTopCategory(categories: ReadingCategory[]): ReadingCategory | undefined {
  return categories.reduce<ReadingCategory | undefined>((top, category) => {
    const value = category.readingTimeSeconds ?? category.value ?? 0;
    const topValue = top ? top.readingTimeSeconds ?? top.value ?? 0 : -1;
    return value > topValue ? category : top;
  }, undefined);
}

function formatCategoryValue(category: ReadingCategory): string {
  if (category.readingTimeSeconds !== undefined) {
    return formatDuration(category.readingTimeSeconds);
  }

  if (category.readingCount !== undefined) {
    return `${category.readingCount} 本`;
  }

  return "分类偏好";
}

function formatAverageDuration(stats: ReadingStats): string {
  if (stats.dayAverageReadTimeSeconds && stats.dayAverageReadTimeSeconds > 0) {
    return formatDuration(stats.dayAverageReadTimeSeconds);
  }

  if (stats.mode === "overall" && stats.readDays && stats.readDays > 0) {
    return formatDuration((stats.totalReadTimeSeconds ?? 0) / stats.readDays);
  }

  return "暂无";
}

type ReviewTimelineSegment = {
  anchorTime: number;
  title: string;
  description: string;
};

function buildReviewTimelineSegments(stats?: ReadingStats): ReviewTimelineSegment[] {
  const buckets = stats?.buckets.filter((bucket) => bucket.readTimeSeconds > 0) ?? [];
  if (buckets.length === 0) {
    return [];
  }

  const maxSeconds = Math.max(...buckets.map((bucket) => bucket.readTimeSeconds), 1);
  const segments: ReviewTimelineSegment[] = [];

  buckets.forEach((bucket, index) => {
    const previous = buckets[index - 1];
    const ratio = bucket.readTimeSeconds / maxSeconds;
    const delta = previous ? bucket.readTimeSeconds - previous.readTimeSeconds : 0;

    let title = "稳定段";
    let description = `在 ${formatBucketLabel(stats?.mode ?? "monthly", bucket.startTime)} 保持了 ${formatDuration(bucket.readTimeSeconds)} 的投入。`;

    if (ratio >= 0.88) {
      title = "高峰段";
      description = `这一段投入达到当前周期高位，阅读时长约 ${formatDuration(bucket.readTimeSeconds)}。`;
    } else if (delta >= 900) {
      title = "抬升段";
      description = `相比上一段明显抬升，新增投入约 ${formatDuration(delta)}。`;
    } else if (delta <= -900) {
      title = "收束段";
      description = `相比上一段明显回落，说明节奏开始从高峰收束。`;
    }

    segments.push({
      anchorTime: bucket.startTime,
      title,
      description
    });
  });

  return segments.slice(-4);
}

function reviewTitle(mode: ReadingStatsMode): string {
  if (mode === "weekly") {
    return "本周阅读复盘";
  }

  if (mode === "annually") {
    return "年度阅读复盘";
  }

  if (mode === "overall") {
    return "长期阅读画像";
  }

  return "本月阅读复盘";
}

function periodLabel(mode: ReadingStatsMode): string {
  return periodOptions.find((option) => option.mode === mode)?.label ?? "本月";
}

function formatBucketLabel(mode: ReadingStatsMode, timestamp: number): string {
  const date = new Date(timestamp * 1000);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  if (mode === "overall") {
    return `${date.getFullYear()}年`;
  }

  if (mode === "annually") {
    return `${date.getMonth() + 1}月`;
  }

  const formatted = formatUnixDate(timestamp);
  return formatted ? formatted.slice(5) : "";
}

function statusMetaFromState(status: ReviewStatus, hasStaleCacheError: boolean) {
  if (status === "setup-required") {
    return { label: "需要设置", tone: "warning" };
  }

  if (status === "loading-cache") {
    return { label: "读取缓存中", tone: "neutral" };
  }

  if (status === "generating") {
    return { label: "生成中", tone: "neutral" };
  }

  if (status === "cached") {
    return { label: "本地缓存", tone: "neutral" };
  }

  if (status === "generated") {
    return { label: "已生成", tone: "success" };
  }

  if (status === "error") {
    return { label: hasStaleCacheError ? "使用旧缓存" : "生成失败", tone: "warning" };
  }

  return { label: "待生成", tone: "neutral" };
}

function statusFromSource(source: BookAiSummarySource): ReviewStatus {
  if (source === "cache" || source === "staleCache") {
    return "cached";
  }

  if (source === "generated") {
    return "generated";
  }

  return "idle";
}

function statusFromAiState(aiState?: AiSettingsState): ReviewStatus {
  if (!aiState) {
    return "idle";
  }

  return aiState.credential.hasCredential ? "idle" : "setup-required";
}
