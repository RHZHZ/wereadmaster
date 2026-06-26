import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpenText, BookMarked, CheckCircle2, Copy, GitBranch, Sparkles, X } from "lucide-react";
import { AiActionFeedbackChecklist } from "../../components/AiActionFeedbackChecklist";
import { useToast } from "../../components/ToastProvider";
import {
  buildAiActionItemId,
  deriveAiAssetActionFeedbackMatchKeys,
  deriveAiAssetActionItemFeedback,
  getAiActionItemStorage,
  readAiAssetActionItemFeedback,
  readExactAiAssetActionItemFeedback,
  writeAiAssetActionItemFeedback,
  type AiActionFeedbackByItemId,
  type AiActionFeedbackRecord
} from "../../lib/ai-action-items";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatAiResponseFormat, formatAiTimestamp } from "../../lib/formatters";
import { formatArtifactCopiedMessage } from "../../lib/reading-artifacts";
import { getAiReviewFeedback, saveAiReviewFeedback } from "../../lib/reading-api";
import type {
  ReadingRoute,
  ReadingRouteBookInput,
  ReadingRouteResponse
} from "../../lib/types";
import {
  buildGuideActionText,
  buildGuideActionDetails,
  buildGuideDetailSections,
  buildGuideFocusItems,
  type GuideMapNode,
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
  const persistedActionFeedbackRef = useRef<AiActionFeedbackByItemId>({});
  const touchedActionFeedbackIdsRef = useRef<Set<string>>(new Set());
  const { showToast } = useToast();

  useEffect(() => {
    let isMounted = true;

    if (!assetScopeId || !assetInputHash) {
      setActionFeedbackByItemId({});
      persistedActionFeedbackRef.current = {};
      touchedActionFeedbackIdsRef.current = new Set();
      return () => {
        isMounted = false;
      };
    }
    const scopeId = assetScopeId;
    const inputHash = assetInputHash;

    const storage = getAiActionItemStorage();
    const exactLocalFeedback = readExactAiAssetActionItemFeedback(storage, assetFeature, scopeId, inputHash);
    const reusableFeedbackByMatchKey = readAiAssetActionItemFeedback(storage, assetFeature, scopeId, inputHash);
    const localFeedback = deriveAiAssetActionItemFeedback(
      buildReadingRouteActionTexts(guideDetails.actions),
      reusableFeedbackByMatchKey
    );
    const currentVersionLocalFeedback = deriveAiAssetActionItemFeedback(
      buildReadingRouteActionTexts(guideDetails.actions),
      exactLocalFeedback.feedbackByItemId
    );

    setActionFeedbackByItemId(localFeedback);
    persistedActionFeedbackRef.current = {};
    touchedActionFeedbackIdsRef.current = new Set();

    async function loadStoredFeedback() {
      try {
        const stored = await getAiReviewFeedback({
          feature: assetFeature,
          scopeId,
          inputHash
        });
        if (!isMounted) {
          return;
        }

        if (hasActionFeedback(stored.actionItems)) {
          const nextPersisted = mergeStoredReadingRouteFeedback(
            stored.actionItems,
            persistedActionFeedbackRef.current,
            touchedActionFeedbackIdsRef.current
          );
          persistedActionFeedbackRef.current = nextPersisted;
          setActionFeedbackByItemId(
            mergeStoredReadingRouteFeedback(localFeedback, nextPersisted, touchedActionFeedbackIdsRef.current)
          );
          return;
        }

        if (!hasActionFeedback(persistedActionFeedbackRef.current)) {
          const nextLocalFeedback = exactLocalFeedback.hasReadableState
            ? mergeStoredReadingRouteFeedback(
                currentVersionLocalFeedback,
                persistedActionFeedbackRef.current,
                touchedActionFeedbackIdsRef.current
              )
            : {};
          setActionFeedbackByItemId(nextLocalFeedback);
        }
      } catch {
        if (isMounted && !hasActionFeedback(persistedActionFeedbackRef.current)) {
          setActionFeedbackByItemId(localFeedback);
        }
      }
    }

    void loadStoredFeedback();

    return () => {
      isMounted = false;
    };
  }, [assetFeature, assetInputHash, assetScopeId, route.nextActions]);

  function handleActionFeedbackChange(itemId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!assetScopeId || !assetInputHash) {
      return;
    }

    setActionFeedbackByItemId((current) => updateFeedbackById(current, itemId, feedback));
    touchedActionFeedbackIdsRef.current.add(itemId);
    const nextPersisted = updateFeedbackById(persistedActionFeedbackRef.current, itemId, feedback);
    persistedActionFeedbackRef.current = nextPersisted;
    writeAiAssetActionItemFeedback(
      getAiActionItemStorage(),
      assetFeature,
      assetScopeId,
      assetInputHash,
      deriveAiAssetActionFeedbackMatchKeys(buildReadingRouteActionTexts(guideDetails.actions), nextPersisted)
    );
    void saveReadingRouteFeedbackState(assetScopeId, assetInputHash, nextPersisted);
  }

  async function handleCopyActionChecklist() {
    if (guideDetails.actions.length === 0) {
      return;
    }

    try {
      await copyTextToClipboard(formatReadingRouteActionChecklist(guideDetails.actions, actionFeedbackByItemId));
      showToast({ message: formatArtifactCopiedMessage("action-checklist"), tone: "success" });
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

      <section className="reading-route-focus-card" aria-label={isCrossBookRoute ? "路线主线" : "本书指南重点"}>
        <div className="reading-route-focus-heading">
          <CheckCircle2 aria-hidden="true" size={20} />
          <div>
            <p className="section-kicker">{isCrossBookRoute ? "路线主线" : "本书重点"}</p>
            <h4>{isCrossBookRoute ? "按这个方向推进" : "接下来先做什么"}</h4>
          </div>
        </div>
        <div className="reading-route-focus-grid">
          {buildGuideFocusItems(route, isCrossBookRoute).map((item) => (
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
                <h3>{isCrossBookRoute ? "按这个顺序推进" : "核对本轮阅读依据"}</h3>
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
            {route.responseFormat ? <span>{formatAiResponseFormat(route.responseFormat)}</span> : null}
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

async function saveReadingRouteFeedbackState(
  scopeId: string,
  inputHash: string,
  actionItems: AiActionFeedbackByItemId
) {
  try {
    await saveAiReviewFeedback({
      feature: "reading-route",
      scopeId,
      inputHash,
      feedback: {
        actionItems,
        reflectionQuestions: {}
      }
    });
  } catch {
    // 后端不可用时 localStorage 仍作为兜底，避免用户刚输入的反馈丢失。
  }
}

function hasActionFeedback(feedbackByItemId: AiActionFeedbackByItemId): boolean {
  return Object.keys(feedbackByItemId).length > 0;
}

function updateFeedbackById(
  feedbackByItemId: AiActionFeedbackByItemId,
  itemId: string,
  feedback: AiActionFeedbackRecord | undefined
): AiActionFeedbackByItemId {
  const next = { ...feedbackByItemId };

  if (feedback) {
    next[itemId] = feedback;
  } else {
    delete next[itemId];
  }

  return next;
}

export function mergeStoredReadingRouteFeedback(
  stored: AiActionFeedbackByItemId,
  current: AiActionFeedbackByItemId,
  touchedItemIds: Set<string>
): AiActionFeedbackByItemId {
  const next = { ...stored, ...current };

  for (const itemId of touchedItemIds) {
    if (!current[itemId]) {
      delete next[itemId];
    }
  }

  return next;
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
  const [activeNode, setActiveNode] = useState<GuideMapNode | undefined>();
  const nodeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const { showToast } = useToast();
  const routeActions = buildGuideActionDetails(route);
  const nodes = isCrossBookRoute
    ? route.books.map((book, index) => ({
        id: `${book.bookId}-${book.order}`,
        label: book.title,
        eyebrow: index === 0 ? "当前书" : `第 ${index + 1} 本`,
        detail: shortGuideText(book.readingPurpose, 48),
        meta: shortGuideText([book.role, book.estimatedEffort].filter(Boolean).join(" · "), 34),
        fullDetail: book.readingPurpose,
        fullMeta: [book.role, book.estimatedEffort].filter(Boolean).join(" · "),
        fields: buildCrossBookNodeFields(book, route),
        associatedActions: buildCrossBookAssociatedActions(book, routeActions, index)
      }))
    : buildSingleBookGuideNodes(currentBook, route);

  async function handleCopyNode(node: GuideMapNode) {
    try {
      await copyTextToClipboard(formatGuideNodeDetail(node));
      showToast({ message: "已复制：阅读节点详情", tone: "success" });
    } catch (copyError) {
      showToast({
        message: copyError instanceof Error ? copyError.message : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  function handleCloseNode() {
    const nodeId = activeNode?.id;
    setActiveNode(undefined);
    if (nodeId) {
      window.setTimeout(() => nodeButtonRefs.current.get(nodeId)?.focus(), 0);
    }
  }

  return (
    <>
      <div className={isCrossBookRoute ? "reading-guide-map reading-guide-map--cross" : "reading-guide-map"} role="list">
        {nodes.map((node, index) => (
          <div className="reading-guide-map-item" key={node.id} role="listitem">
            <button
              className="reading-guide-node reading-guide-node--interactive"
              type="button"
              ref={(element) => {
                if (element) {
                  nodeButtonRefs.current.set(node.id, element);
                } else {
                  nodeButtonRefs.current.delete(node.id);
                }
              }}
              onClick={() => setActiveNode(node)}
              aria-label={`查看${node.label}的完整阅读节点详情`}
            >
              <span>{node.eyebrow}</span>
              <strong>{node.label}</strong>
              <p>{node.detail}</p>
              {node.meta ? <small>{node.meta}</small> : null}
              <BookOpenText className="reading-guide-node-action" aria-hidden="true" size={16} />
            </button>
            {index < nodes.length - 1 ? <span className="reading-guide-connector" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
      {activeNode ? (
        <GuideNodeDetailDialog
          node={activeNode}
          onClose={handleCloseNode}
          onCopy={() => void handleCopyNode(activeNode)}
        />
      ) : null}
    </>
  );
}

function GuideNodeDetailDialog({
  node,
  onClose,
  onCopy
}: {
  node: GuideMapNode;
  onClose: () => void;
  onCopy: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fields = node.fields?.filter((field) => field.value) ?? [];
  const associatedActions = node.associatedActions?.filter((item) => item.title && item.done) ?? [];

  return (
    <div className="reading-guide-node-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="reading-guide-node-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`reading-guide-node-title-${node.id}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="reading-guide-node-dialog-heading">
          <div>
            <span>{node.eyebrow}</span>
            <h4 id={`reading-guide-node-title-${node.id}`}>{node.label}</h4>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭阅读节点详情">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="reading-guide-node-dialog-body">
          <p>{node.fullDetail || node.detail}</p>
          {node.fullMeta || node.meta ? <small>{node.fullMeta || node.meta}</small> : null}
          {fields.length > 0 ? (
            <dl className="reading-guide-node-dialog-fields">
              {fields.map((field) => (
                <div key={`${field.label}-${field.value}`}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {associatedActions.length > 0 ? (
            <section className="reading-guide-node-dialog-linked-actions" aria-label="关联行动">
              <strong>关联行动</strong>
              <div>
                {associatedActions.map((item, index) => (
                  <article key={`${item.title}-${index}`}>
                    <span>{item.title}</span>
                    <small>完成标准：{item.done}</small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className="reading-guide-node-dialog-actions">
          <button className="secondary-action" type="button" onClick={onCopy}>
            <Copy aria-hidden="true" size={15} />
            复制节点内容
          </button>
          <button className="primary-action" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

function buildCrossBookNodeFields(book: ReadingRoute["books"][number], route: ReadingRoute): GuideMapNode["fields"] {
  const previous = route.dependencies.filter((item) => item.toBookId === book.bookId);
  const next = route.dependencies.filter((item) => item.fromBookId === book.bookId);

  return [
    { label: "作者", value: book.author ?? "" },
    { label: "角色", value: book.role },
    { label: "阅读目的", value: book.readingPurpose },
    { label: "预计投入", value: book.estimatedEffort },
    { label: "本地状态", value: book.localStatus ?? "" },
    { label: "依据", value: book.basis },
    { label: "前置依赖", value: previous.map((item) => `${item.fromBookId}：${item.reason}`).join("\n") },
    { label: "后续依赖", value: next.map((item) => `${item.toBookId}：${item.reason}`).join("\n") }
  ].filter((item) => item.value);
}

export function buildCrossBookAssociatedActions(
  book: ReadingRoute["books"][number],
  actions: ReturnType<typeof buildGuideActionDetails>,
  index: number
): GuideMapNode["associatedActions"] {
  if (index === 0) {
    return undefined;
  }

  const title = book.title.trim();
  const bookId = book.bookId.trim();
  const associatedActions = actions.filter((item) => {
    const text = buildGuideActionText(item);
    return Boolean(
      (title && (text.includes(`《${title}》`) || text.includes(title))) ||
        (bookId && text.includes(bookId))
    );
  });

  return associatedActions.length > 0 ? associatedActions : undefined;
}

export function formatGuideNodeDetail(node: GuideMapNode): string {
  const fields = node.fields?.filter((field) => field.value) ?? [];
  const associatedActions = node.associatedActions?.filter((item) => item.title && item.done) ?? [];

  return [
    `# ${node.label}`,
    `标签：${node.eyebrow}`,
    node.fullDetail || node.detail,
    node.fullMeta || node.meta ? `补充：${node.fullMeta || node.meta}` : "",
    ...fields.map((field) => `${field.label}：${field.value}`),
    associatedActions.length > 0 ? "关联行动：" : "",
    ...associatedActions.map((item) => `- ${item.title}，完成标准：${item.done}`)
  ]
    .filter(Boolean)
    .join("\n");
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
