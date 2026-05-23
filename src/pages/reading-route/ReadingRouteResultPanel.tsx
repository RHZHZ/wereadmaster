import { useEffect, useState, type ReactNode } from "react";
import { BookMarked, CheckCircle2, Copy, GitBranch, Sparkles } from "lucide-react";
import { AiActionFeedbackChecklist } from "../../components/AiActionFeedbackChecklist";
import { useToast } from "../../components/ToastProvider";
import {
  buildAiActionItemId,
  deriveAiAssetActionFeedbackMatchKeys,
  deriveAiAssetActionItemFeedback,
  getAiActionItemStorage,
  readAiAssetActionItemFeedback,
  writeAiAssetActionItemFeedback,
  type AiActionFeedbackByItemId,
  type AiActionFeedbackRecord
} from "../../lib/ai-action-items";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatAiTimestamp } from "../../lib/formatters";
import type {
  ReadingRoute,
  ReadingRouteBookInput,
  ReadingRouteResponse
} from "../../lib/types";
import {
  buildGuideActionText,
  buildGuideDetailSections,
  buildGuidePrescriptionItems,
  buildSingleBookGuideNodes
} from "./guide-prescription";
import { buildReadingRouteContinuity, type ReadingRouteContinuity } from "./route-continuity";

type ReadingRouteResultPanelProps = {
  currentBook?: ReadingRouteBookInput;
  route: ReadingRoute;
  routeResponse?: ReadingRouteResponse;
  isCrossBookRoute: boolean;
  resultTitle: string;
};

export function ReadingRouteResultPanel({
  currentBook,
  route,
  routeResponse,
  isCrossBookRoute,
  resultTitle
}: ReadingRouteResultPanelProps) {
  const guideDetails = buildGuideDetailSections(route, isCrossBookRoute);
  const routeContinuity = buildReadingRouteContinuity(route, currentBook, isCrossBookRoute);
  const assetFeature = "reading-route";
  const assetScopeId = routeResponse?.scopeId;
  const assetInputHash = routeResponse?.inputHash;
  const [actionFeedbackByItemId, setActionFeedbackByItemId] = useState<AiActionFeedbackByItemId>({});
  const { showToast } = useToast();

  useEffect(() => {
    if (!assetScopeId || !assetInputHash) {
      setActionFeedbackByItemId({});
      return;
    }

    const reusableFeedbackByMatchKey = readAiAssetActionItemFeedback(
      getAiActionItemStorage(),
      assetFeature,
      assetScopeId,
      assetInputHash
    );

    setActionFeedbackByItemId(deriveAiAssetActionItemFeedback(buildReadingRouteActionTexts(guideDetails.actions), reusableFeedbackByMatchKey));
  }, [assetFeature, assetInputHash, assetScopeId, route.nextActions]);

  function handleActionFeedbackChange(itemId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!assetScopeId || !assetInputHash) {
      return;
    }

    setActionFeedbackByItemId((current) => {
      const next = { ...current };

      if (feedback) {
        next[itemId] = feedback;
      } else {
        delete next[itemId];
      }

      writeAiAssetActionItemFeedback(
        getAiActionItemStorage(),
        assetFeature,
        assetScopeId,
        assetInputHash,
        deriveAiAssetActionFeedbackMatchKeys(buildReadingRouteActionTexts(guideDetails.actions), next)
      );

      return next;
    });
  }

  async function handleCopyActionChecklist() {
    if (guideDetails.actions.length === 0) {
      return;
    }

    try {
      await copyTextToClipboard(formatReadingRouteActionChecklist(guideDetails.actions, actionFeedbackByItemId));
      showToast({ message: "已复制行动清单", tone: "success" });
    } catch (copyError) {
      showToast({
        message: copyError instanceof Error ? copyError.message : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  return (
    <div className="reading-route-content">
      <section className="reading-route-map-section" aria-label={resultTitle}>
        <div className="reading-route-section-heading">
          <div>
            <p className="section-kicker">{isCrossBookRoute ? "跨书路线" : "单书指南"}</p>
            <h3>{resultTitle}</h3>
            <p>{isCrossBookRoute ? "按多本书的先后关系推进，每个节点保留阅读目的和复盘动作。" : "先把这本书读完、复盘和整理，再决定是否扩展到候选书。"}</p>
          </div>
          <span>{isCrossBookRoute ? `${route.books.length} 个书籍节点` : "5 个步骤"}</span>
        </div>
        <GuideMap currentBook={currentBook} route={route} isCrossBookRoute={isCrossBookRoute} />
      </section>

      <section className="reading-route-focus-card" aria-label={isCrossBookRoute ? "路线主线" : "本书指南重点"}>
        <div className="reading-route-focus-heading">
          <CheckCircle2 aria-hidden="true" size={20} />
          <div>
            <p className="section-kicker">{isCrossBookRoute ? "路线主线" : "本书重点"}</p>
            <h4>{isCrossBookRoute ? "按这个方向推进" : "接下来先做什么"}</h4>
          </div>
        </div>
        <div className="reading-route-focus-grid">
          {buildGuidePrescriptionItems(route, isCrossBookRoute).map((item) => (
            <article key={item.label} className="reading-route-focus-item">
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <details className="reading-route-overview-disclosure">
          <summary>{isCrossBookRoute ? "查看路线总览原文" : "查看指南总览原文"}</summary>
          <p>{route.routeOverview}</p>
        </details>
      </section>

      {routeContinuity ? <ReadingRouteContinuityCard continuity={routeContinuity} /> : null}

      <section className="reading-route-details-entry" aria-label="完整阅读指南">
        <div className="reading-route-section-heading">
          <div>
            <p className="section-kicker">指南细节</p>
            <h3>完整阅读指南</h3>
            <p>复盘问题、行动标准和生成依据直接呈现在页面中，不再使用弹窗打断阅读路径。</p>
          </div>
          <span>{guideDetails.steps.length} 本</span>
        </div>

        <div className="reading-route-inline-details">
          <section className="reading-route-section" aria-label={isCrossBookRoute ? "阅读顺序" : "本书推进任务"}>
            <div className="reading-route-section-heading">
              <div>
                <p className="section-kicker">{isCrossBookRoute ? "阅读顺序" : "推进任务"}</p>
                <h3>{isCrossBookRoute ? "按这个顺序推进" : "先完成这个阅读任务"}</h3>
              </div>
              <span>{guideDetails.steps.length} 本</span>
            </div>
            <div className="reading-route-detail-step-list">
              {guideDetails.steps.map((step) => (
                <article key={`${step.title}-${step.index}`} className="reading-route-detail-step">
                  <b>{step.index}</b>
                  <div>
                    <span>{step.taskLabel}</span>
                    <strong>{step.task}</strong>
                    <small>{step.title} · {step.meta}</small>
                  </div>
                  <dl>
                    <div>
                      <dt>投入</dt>
                      <dd>{step.effort}</dd>
                    </div>
                    <div>
                      <dt>依据</dt>
                      <dd>{step.evidence}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <div className="reading-route-detail-rails">
            {isCrossBookRoute ? (
              <RouteList
                title="依赖关系"
                icon={<GitBranch aria-hidden="true" size={18} />}
                items={
                  route.dependencies.length > 0
                    ? route.dependencies.map((item) => `${item.fromBookId} -> ${item.toBookId}：${item.reason}`)
                    : []
                }
                emptyText="这条路线没有强制前后依赖。"
              />
            ) : null}
            <DetailCardList
              title="复盘点"
              ariaLabel="复盘点卡片列表"
              icon={<BookMarked aria-hidden="true" size={18} />}
              items={guideDetails.checkpoints.map((item) => ({
                eyebrow: item.timing,
                title: item.question,
                body: `输出：${item.output}`,
                meta: `验收：${item.acceptance}`
              }))}
              emptyText="这次路线没有生成复盘点。"
            />
            <ActionChecklistCardList
              title="下一步行动"
              ariaLabel="下一步行动卡片列表"
              icon={<Sparkles aria-hidden="true" size={18} />}
              items={guideDetails.actions}
              emptyText="这次路线没有生成下一步行动。"
              feedbackByItemId={actionFeedbackByItemId}
              onFeedbackChange={handleActionFeedbackChange}
              onCopyActionChecklist={handleCopyActionChecklist}
            />
          </div>

          <section className="ai-summary-source-card" aria-label="阅读指南来源统计">
            <div>
              <strong>来源统计</strong>
              <small>{route.basisNotice}</small>
            </div>
            <div className="ai-summary-stats">
              <SummaryStat label="当前书" value={route.sourceStats.currentBookCount ?? (currentBook ? 1 : 0)} />
              <SummaryStat label="候选书" value={route.sourceStats.candidateCount} />
              <SummaryStat label="已有复盘" value={route.sourceStats.summaryCount} />
              <SummaryStat label="统计信号" value={route.sourceStats.statsSignalCount} />
              <SummaryStat label="本地状态" value={route.sourceStats.localStatusCount} />
            </div>
          </section>

          <div className="ai-summary-meta">
            <span>生成时间：{formatAiTimestamp(route.generatedAt) || "尚未生成"}</span>
            <span>Prompt：{route.promptVersion ?? "reading-route-v2.1"}</span>
            {routeResponse?.providerModel ? <span>模型：{routeResponse.providerModel}</span> : null}
            {routeResponse?.cachedUpdatedAt ? (
              <span>缓存更新：{formatAiTimestamp(routeResponse.cachedUpdatedAt)}</span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReadingRouteContinuityCard({ continuity }: { continuity: ReadingRouteContinuity }) {
  return (
    <section className="reading-route-continuity-card" aria-label="跨书路线接续">
      <div className="reading-route-focus-heading">
        <GitBranch aria-hidden="true" size={20} />
        <div>
          <p className="section-kicker">接续下一本</p>
          <h4>{`${continuity.currentTitle} -> ${continuity.nextTitle}`}</h4>
        </div>
      </div>
      <div className="reading-route-continuity-grid">
        <div>
          <span>为什么切换</span>
          <p>{continuity.handoffReason}</p>
        </div>
        <div>
          <span>何时切换</span>
          <p>{continuity.switchCondition}</p>
        </div>
        <div>
          <span>接续动作</span>
          <p>{continuity.continuationAction}</p>
          {continuity.nextMeta ? <small>{continuity.nextMeta}</small> : null}
        </div>
      </div>
    </section>
  );
}

function RouteList({
  title,
  icon,
  items,
  emptyText
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  emptyText: string;
}) {
  return (
    <section className="ai-summary-list" aria-label={title}>
      <div className="ai-summary-list-heading">
        <h4>
          {icon}
          {title}
        </h4>
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function DetailCardList({
  title,
  ariaLabel,
  icon,
  items,
  emptyText
}: {
  title: string;
  ariaLabel: string;
  icon: ReactNode;
  items: Array<{
    eyebrow?: string;
    title: string;
    body: string;
    meta?: string;
  }>;
  emptyText: string;
}) {
  return (
    <section className="reading-route-detail-card-list" aria-label={ariaLabel}>
      <div className="ai-summary-list-heading">
        <h4>
          {icon}
          {title}
        </h4>
      </div>
      {items.length > 0 ? (
        <div className="reading-route-detail-card-stack">
          {items.map((item, index) => (
            <article key={`${item.title}-${index}`} className="reading-route-detail-card">
              {item.eyebrow ? <span>{item.eyebrow}</span> : null}
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              {item.meta ? <small>{item.meta}</small> : null}
            </article>
          ))}
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function ActionChecklistCardList({
  title,
  ariaLabel,
  icon,
  items,
  emptyText,
  feedbackByItemId,
  onFeedbackChange,
  onCopyActionChecklist
}: {
  title: string;
  ariaLabel: string;
  icon: ReactNode;
  items: Array<{
    title: string;
    done: string;
  }>;
  emptyText: string;
  feedbackByItemId: AiActionFeedbackByItemId;
  onFeedbackChange: (itemId: string, feedback: AiActionFeedbackRecord | undefined) => void;
  onCopyActionChecklist: () => void;
}) {
  return (
    <div className="reading-route-action-checklist">
      <AiActionFeedbackChecklist
        title={title}
        ariaLabel={ariaLabel}
        icon={icon}
        items={items.map((item, index) => {
          const itemText = buildGuideActionText(item);
          return {
            id: buildAiActionItemId(itemText, index),
            text: itemText,
            title: item.title,
            detail: `完成标准：${item.done}`
          };
        })}
        emptyText={emptyText}
        feedbackByItemId={feedbackByItemId}
        onFeedbackChange={onFeedbackChange}
        onCopy={onCopyActionChecklist}
        copyButton={
          <>
            <Copy aria-hidden="true" size={15} />
            复制行动清单
          </>
        }
      />
    </div>
  );
}

export function formatReadingRouteActionChecklist(
  items: Array<{
    title: string;
    done: string;
  }>,
  feedbackByItemId: AiActionFeedbackByItemId
): string {
  return [
    "## 下一步行动",
    ...items.map((item, index) => {
      const itemText = buildGuideActionText(item);
      const feedback = feedbackByItemId[buildAiActionItemId(itemText, index)];
      const marker = feedback?.status === "completed" ? "x" : " ";
      const suffix = feedback ? `（${actionFeedbackStatusLabel(feedback.status)}）` : "";
      const noteLines = feedback?.note
        ? feedback.note.split("\n").map((line) => (line ? `  - 反馈记录：${line}` : ""))
        : [];
      return [`- [${marker}] ${item.title}，完成标准：${item.done}${suffix}`, ...noteLines].join("\n");
    })
  ].join("\n");
}

function actionFeedbackStatusLabel(status: AiActionFeedbackRecord["status"]): string {
  if (status === "completed") {
    return "已完成";
  }

  if (status === "skipped") {
    return "暂不做";
  }

  if (status === "notApplicable") {
    return "不适合";
  }

  return "待处理";
}

function buildReadingRouteActionTexts(
  items: Array<{
    title: string;
    done: string;
  }>
): string[] {
  return items.map(buildGuideActionText);
}

function GuideMap({
  currentBook,
  route,
  isCrossBookRoute
}: {
  currentBook?: ReadingRouteBookInput;
  route: ReadingRoute;
  isCrossBookRoute: boolean;
}) {
  const nodes = isCrossBookRoute
    ? route.books.map((book, index) => ({
        id: `${book.bookId}-${book.order}`,
        label: book.title,
        eyebrow: index === 0 ? "当前书" : `第 ${index + 1} 本`,
        detail: shortGuideText(book.readingPurpose, 48),
        meta: shortGuideText([book.role, book.estimatedEffort].filter(Boolean).join(" · "), 34)
      }))
    : buildSingleBookGuideNodes(currentBook, route);

  return (
    <div className={isCrossBookRoute ? "reading-guide-map reading-guide-map--cross" : "reading-guide-map"} role="list">
      {nodes.map((node, index) => (
        <div className="reading-guide-map-item" key={node.id} role="listitem">
          <article className="reading-guide-node">
            <span>{node.eyebrow}</span>
            <strong>{node.label}</strong>
            <p>{node.detail}</p>
            {node.meta ? <small>{node.meta}</small> : null}
          </article>
          {index < nodes.length - 1 ? <span className="reading-guide-connector" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

function shortGuideText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}
