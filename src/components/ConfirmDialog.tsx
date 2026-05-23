import { AlertTriangle, X } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isDanger?: boolean;
  isBusy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  isDanger = false,
  isBusy = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="dialog-close" type="button" onClick={onCancel} aria-label="关闭确认框">
          <X aria-hidden="true" size={18} />
        </button>
        <span className={`dialog-icon ${isDanger ? "is-danger" : ""}`}>
          <AlertTriangle aria-hidden="true" size={24} />
        </span>
        <h3 id="confirm-title">{title}</h3>
        <p>{description}</p>
        <div className="dialog-actions">
          <button className="sync-button" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button
            className={`secondary-action ${isDanger ? "danger-action" : ""}`}
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? "处理中" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
