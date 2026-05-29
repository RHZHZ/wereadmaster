import {
  AlertCircle,
  ArrowLeft,
  BookMarked,
  Download,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles
} from "lucide-react";
import type { BookDetail, PreparedAssetUpdate, ReadingProgress, ShelfEntry } from "../lib/types";
import { ReadingRouteInputPanel } from "./reading-route/ReadingRouteInputPanel";
import { ReadingRouteResultPanel } from "./reading-route/ReadingRouteResultPanel";
import { useReadingRoutePageState } from "./reading-route/useReadingRoutePageState";

type ReadingRoutePageProps = {
  shelfEntry?: ShelfEntry;
  detail?: BookDetail;
  progress?: ReadingProgress;
  preparedUpdate?: PreparedAssetUpdate;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenDiscovery: () => void;
};

export function ReadingRoutePage({
  shelfEntry,
  detail,
  progress,
  preparedUpdate,
  onBack,
  onOpenSettings,
  onOpenDiscovery
}: ReadingRoutePageProps) {
  const state = useReadingRoutePageState({ shelfEntry, detail, progress, preparedUpdate });
  const regenerateLabel = preparedUpdate ? "生成更新版本" : "重新生成";

  return (
    <section className="reading-route-page" aria-label="本书阅读指南">
      <button className="text-button back-button" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={16} />
        返回书籍详情
      </button>

      <section className="reading-route-hero">
        <div className="ai-summary-icon">
          <BookMarked aria-hidden="true" size={24} />
        </div>
        <div>
          <p className="section-kicker">AI 阅读指南</p>
          <h3>{state.currentBook?.title ? `围绕《${state.currentBook.title}》规划下一步` : state.pageTitle}</h3>
          <p>默认把当前书整理成下一步阅读指南；加入候选书后切换为跨书路线图。不会自动发送笔记，也不会写回微信读书。</p>
          {state.currentBook?.author ? <small>{state.currentBook.author}</small> : null}
        </div>
        <div className="ai-summary-hero-side">
          <span className={`ai-summary-badge ai-summary-badge--${state.statusMeta.tone}`}>{state.statusMeta.label}</span>
          <div className="ai-summary-actions">
            <button
              className="sync-button"
              type="button"
              onClick={() => void state.handleGenerate(false)}
              disabled={!state.canGenerate || state.hasRoute}
            >
              {state.status === "generating" || state.isLoadingCache ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Sparkles aria-hidden="true" size={18} />
              )}
              {state.status === "generating"
                ? "生成中"
                : state.isLoadingCache
                  ? "读取缓存中"
                  : state.hasCandidateSelection
                    ? "生成跨书路线图"
                    : "生成本书指南"}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void state.handleGenerate(true)}
              disabled={!state.canRegenerate}
            >
              <RefreshCw aria-hidden="true" size={18} />
              {regenerateLabel}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void state.handleExport()}
              disabled={!state.hasRoute || state.isExporting || state.status === "generating" || state.isLoadingCache}
            >
              {state.isExporting ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <Download aria-hidden="true" size={18} />}
              {state.isExporting ? "导出中" : "导出 Markdown"}
            </button>
          </div>
        </div>
      </section>

      {state.status === "setup-required" ? (
        <div className="ai-summary-callout">
          <Settings aria-hidden="true" size={20} />
          <div>
            <strong>需要先配置 AI Provider</strong>
            <p>阅读指南和跨书路线沿用本机 AI Provider 设置，API Key 不会暴露给前端。</p>
          </div>
          <button className="secondary-action" type="button" onClick={onOpenSettings}>
            去设置
          </button>
        </div>
      ) : null}

      {preparedUpdate ? (
        <section className="ai-summary-boundary-strip ai-summary-boundary-strip--prepared" aria-label="准备更新上下文">
          <RefreshCw aria-hidden="true" size={18} />
          <div>
            <strong>正在准备更新上一版阅读指南</strong>
            <p>
              来源版本：{preparedUpdate.versionTitle || "阅读指南"} · Prompt {preparedUpdate.promptVersion}。
              本页只带入当前书上下文；需要你手动点击“{regenerateLabel}”才会调用 AI，不会自动同步远端或发送完整反馈明细。
            </p>
            {state.missingPreparedCandidateCount > 0 ? (
              <p>
                有 {state.missingPreparedCandidateCount} 本上一版候选书未在本地候选书架中找到，需要先调整输入范围后再生成更新版本。
              </p>
            ) : preparedUpdate.candidateBookIds?.length ? (
              <p>已恢复上一版候选范围：{state.selectedCandidates.length} / {preparedUpdate.candidateBookIds.length} 本候选已纳入。</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {state.isLoadingSettings || state.isLoadingInputs ? (
        <div className="ai-summary-loading">
          <Loader2 aria-hidden="true" size={20} className="spin" />
          <span>正在读取本地 AI 设置和候选书</span>
        </div>
      ) : null}

      {state.error ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{state.error}</span>
        </div>
      ) : null}

      {state.exportResult ? (
        <div className="status-message status-message--neutral">
          <Download aria-hidden="true" size={18} />
          <span>
            已导出 {state.exportResult.fileName}，路径：{state.exportResult.path}
          </span>
        </div>
      ) : null}

      <ReadingRouteInputPanel
        currentBook={state.currentBook}
        candidateBooks={state.candidateBooks}
        selectedCandidates={state.selectedCandidates}
        onCandidateToggle={state.handleCandidateToggle}
        onSelectAllCandidates={state.handleSelectAllCandidates}
        onClearCandidates={state.handleClearCandidates}
        onOpenDiscovery={onOpenDiscovery}
      />

      {state.route ? (
        <ReadingRouteResultPanel
          currentBook={state.currentBook}
          route={state.route}
          routeResponse={state.routeResponse}
          isCrossBookRoute={state.isCrossBookRoute}
          resultTitle={state.resultTitle}
        />
      ) : (
        <div className="ai-summary-placeholder">
          <Sparkles aria-hidden="true" size={20} />
          <p>可以直接生成本书阅读指南；如需比较和排序下一本，再额外加入候选书生成跨书路线图。</p>
        </div>
      )}
    </section>
  );
}
