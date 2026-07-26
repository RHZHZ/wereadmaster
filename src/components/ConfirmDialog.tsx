import { useId, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { AppDialog } from "./AppDialog";

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
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <AppDialog
      open={open}
      onClose={onCancel}
      className="confirm-dialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={cancelButtonRef}
      disableEscape={isBusy}
      disableBackdropClose={isBusy}
    >
      <button className="dialog-close" type="button" onClick={onCancel} aria-label="关闭确认框" disabled={isBusy}>
        <X aria-hidden="true" size={18} />
      </button>
      <span className={`dialog-icon ${isDanger ? "is-danger" : ""}`}>
        <AlertTriangle aria-hidden="true" size={24} />
      </span>
      <h3 id={titleId}>{title}</h3>
      <p id={descriptionId}>{description}</p>
      <div className="dialog-actions">
        <button ref={cancelButtonRef} className="sync-button" type="button" onClick={onCancel} disabled={isBusy}>
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
    </AppDialog>
  );
}
