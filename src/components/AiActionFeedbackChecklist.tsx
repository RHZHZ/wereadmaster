import { useEffect, useId, useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import {
  createAiActionFeedbackRecord,
  normalizeAiActionFeedbackNote,
  summarizeAiActionFeedback,
  type AiActionFeedbackByItemId,
  type AiActionFeedbackRecord,
  type AiActionFeedbackStatus
} from "../lib/ai-action-items";
import { useToast } from "./ToastProvider";

export type AiActionFeedbackChecklistItem = {
  id: string;
  text: string;
  title?: string;
  detail?: string;
};

type AiActionFeedbackChecklistProps = {
  title: string;
  ariaLabel: string;
  icon: ReactNode;
  items: AiActionFeedbackChecklistItem[];
  emptyText: string;
  feedbackByItemId: AiActionFeedbackByItemId;
  onFeedbackChange: (itemId: string, feedback: AiActionFeedbackRecord | undefined) => void;
  onCopy?: () => void;
  copyButton?: ReactNode;
  onAskItem?: (item: AiActionFeedbackChecklistItem) => void;
  askItemLabel?: string;
  labels?: AiActionFeedbackChecklistLabels;
};

const statusOptions: Array<{ status: AiActionFeedbackStatus; label: string }> = [
  { status: "todo", label: "待处理" },
  { status: "completed", label: "已完成" },
  { status: "skipped", label: "暂不做" },
  { status: "notApplicable", label: "不适合" }
];

export type AiActionFeedbackChecklistLabels = {
  completedSummary: string;
  noteLabel: string;
  notePlaceholder: string;
  statuses: Record<AiActionFeedbackStatus, string>;
};

export const actionFeedbackLabels: AiActionFeedbackChecklistLabels = {
  completedSummary: "已完成",
  noteLabel: "反馈记录",
  notePlaceholder: "可选，例如：已写成 500 字笔记，或补充完成过程与结果",
  statuses: {
    todo: "待处理",
    completed: "已完成",
    skipped: "暂不做",
    notApplicable: "不适合"
  }
};

export const reflectionFeedbackLabels: AiActionFeedbackChecklistLabels = {
  completedSummary: "已回答",
  noteLabel: "回答记录",
  notePlaceholder: "可选，例如：已写入 300 字复盘",
  statuses: {
    todo: "待思考",
    completed: "已回答",
    skipped: "暂不答",
    notApplicable: "不适合"
  }
};

export function AiActionFeedbackChecklist({
  title,
  ariaLabel,
  icon,
  items,
  emptyText,
  feedbackByItemId,
  onFeedbackChange,
  onCopy,
  copyButton,
  onAskItem,
  askItemLabel = "拆解",
  labels = actionFeedbackLabels
}: AiActionFeedbackChecklistProps) {
  const [editingItem, setEditingItem] = useState<AiActionFeedbackChecklistItem>();
  const summary = summarizeAiActionFeedback(
    items.map((item) => item.id),
    feedbackByItemId
  );

  return (
    <section className="ai-summary-list ai-action-checklist" aria-label={ariaLabel}>
      <div className="ai-summary-list-heading ai-action-checklist-heading">
        <div>
          <h4>
            {icon}
            {title}
          </h4>
          {items.length > 0 ? (
            <small>
              {labels.completedSummary} {summary.completed} / 共 {summary.total} 项
              {summary.skipped + summary.notApplicable > 0
                ? `，${labels.statuses.skipped} ${summary.skipped}，${labels.statuses.notApplicable} ${summary.notApplicable}`
                : ""}
              {summary.withNote > 0 ? `，记录 ${summary.withNote}` : ""}
            </small>
          ) : null}
        </div>
        {items.length > 0 && onCopy && copyButton ? (
          <button className="text-button ai-summary-copy-button" type="button" onClick={onCopy}>
            {copyButton}
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul className="ai-action-checklist-items">
          {items.map((item) => (
            <ActionFeedbackRow
              key={item.id}
              item={item}
              feedback={feedbackByItemId[item.id]}
              labels={labels}
              onEdit={() => setEditingItem(item)}
              onAsk={onAskItem ? () => onAskItem(item) : undefined}
              askLabel={askItemLabel}
            />
          ))}
        </ul>
      ) : (
        <p>{emptyText}</p>
      )}
      {editingItem ? (
        <FeedbackEditDialog
          key={editingItem.id}
          item={editingItem}
          feedback={feedbackByItemId[editingItem.id]}
          labels={labels}
          onCancel={() => setEditingItem(undefined)}
          onSave={(itemId, feedback) => {
            onFeedbackChange(itemId, feedback);
            setEditingItem(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

function ActionFeedbackRow({
  item,
  feedback,
  labels,
  onEdit,
  onAsk,
  askLabel
}: {
  item: AiActionFeedbackChecklistItem;
  feedback?: AiActionFeedbackRecord;
  labels: AiActionFeedbackChecklistLabels;
  onEdit: () => void;
  onAsk?: () => void;
  askLabel: string;
}) {
  const status = feedback?.status ?? "todo";
  const note = feedback?.note ?? "";

  return (
    <li className={`ai-action-checklist-item ai-action-feedback-item ai-action-feedback-item--${status}`}>
      <div className="ai-action-feedback-main">
        <div className="ai-action-feedback-row">
          <div className="ai-action-feedback-copy">
            <span className={`ai-action-checklist-text${status === "completed" ? " is-completed" : ""}`}>
              {item.title ? (
                <>
                  <strong>{item.title}</strong>
                  {item.detail ? ` ${item.detail}` : null}
                </>
              ) : (
                item.text
              )}
            </span>
            {note ? <small className="ai-action-feedback-note-preview">{note}</small> : null}
          </div>
          <div className="ai-action-feedback-controls">
            <span className={`ai-action-feedback-status-pill ai-action-feedback-status-pill--${status}`}>
              {labels.statuses[status]}
            </span>
            <button
              className="text-button ai-action-feedback-note-toggle"
              type="button"
              onClick={onEdit}
            >
              {feedback ? "编辑反馈" : "记录反馈"}
            </button>
            {onAsk ? (
              <button
                className="text-button ai-action-feedback-note-toggle"
                type="button"
                onClick={onAsk}
              >
                <MessageSquare aria-hidden="true" size={14} />
                {askLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function FeedbackEditDialog({
  item,
  feedback,
  labels,
  onCancel,
  onSave
}: {
  item: AiActionFeedbackChecklistItem;
  feedback?: AiActionFeedbackRecord;
  labels: AiActionFeedbackChecklistLabels;
  onCancel: () => void;
  onSave: (itemId: string, feedback: AiActionFeedbackRecord | undefined) => void;
}) {
  const titleId = useId();
  const { showToast } = useToast();
  const [draftStatus, setDraftStatus] = useState<AiActionFeedbackStatus>(feedback?.status ?? "todo");
  const [draftNote, setDraftNote] = useState(feedback?.note ?? "");
  const normalizedNote = normalizeAiActionFeedbackNote(draftNote);
  const hasUnsavedChanges = draftStatus !== (feedback?.status ?? "todo") || normalizedNote !== (feedback?.note ?? "");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, onCancel]);

  function requestClose() {
    if (hasUnsavedChanges && !window.confirm("反馈记录尚未保存，确定关闭吗？")) {
      return;
    }

    onCancel();
  }

  function handleSave() {
    if (draftStatus === "todo" && !normalizedNote) {
      onSave(item.id, undefined);
      showToast({ message: "已清除反馈记录", tone: "success" });
      return;
    }

    onSave(item.id, createAiActionFeedbackRecord(draftStatus, normalizedNote));
    showToast({ message: "已保存反馈记录", tone: "success" });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={requestClose}>
      <section
        className="ai-action-feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ai-action-feedback-dialog-heading">
          <div>
            <p className="section-kicker">反馈记录</p>
            <h3 id={titleId}>编辑状态与记录</h3>
          </div>
          <button className="dialog-close" type="button" onClick={requestClose} aria-label="关闭反馈编辑">
            关闭
          </button>
        </div>

        <section className="ai-action-feedback-dialog-target" aria-label="当前条目">
          <strong>{item.title ?? item.text}</strong>
          {item.title && item.detail ? <p>{item.detail}</p> : null}
        </section>

        <div className="ai-action-feedback-dialog-statuses" aria-label="反馈状态">
          {statusOptions.map((option) => (
            <button
              key={option.status}
              className="ai-action-feedback-dialog-status"
              type="button"
              aria-pressed={draftStatus === option.status}
              onClick={() => setDraftStatus(option.status)}
            >
              {labels.statuses[option.status] ?? option.label}
            </button>
          ))}
        </div>

        <label className="ai-action-feedback-dialog-note">
          <span>{labels.noteLabel}</span>
          <textarea
            value={draftNote}
            maxLength={500}
            rows={6}
            onChange={(event) => setDraftNote(event.target.value)}
            placeholder={labels.notePlaceholder}
          />
          <small>{normalizedNote.length} / 500</small>
        </label>

        <section className="ai-action-feedback-attachment-note" aria-label="附件能力说明">
          <strong>图片附件</strong>
          <p>当前版本先保存状态和文字记录；图片导入会在本地文件存储方案稳定后接入。</p>
        </section>

        <div className="dialog-actions ai-action-feedback-dialog-actions">
          <button className="secondary-action" type="button" onClick={requestClose}>
            取消
          </button>
          <button className="sync-button" type="button" onClick={handleSave}>
            保存反馈
          </button>
        </div>
      </section>
    </div>
  );
}
