import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "success" | "warning" | "error" | "neutral";

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return context;
}

type ToastItem = Required<ToastInput> & {
  id: number;
};

const TOAST_DURATION_BY_TONE_MS: Record<ToastTone, number> = {
  success: 3000,
  neutral: 3000,
  warning: 5000,
  error: 8000
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function showToast({ message, tone = "neutral", durationMs }: ToastInput) {
    const id = Date.now() + Math.random();
    const resolvedDurationMs = durationMs ?? TOAST_DURATION_BY_TONE_MS[tone];
    setToasts((current) => [...current, { id, message, tone, durationMs: resolvedDurationMs }]);
  }

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-viewport" aria-label="通知">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, toast.durationMs);

    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs, toast.id]);

  const Icon = iconFromTone(toast.tone);
  const role = toast.tone === "error" || toast.tone === "warning" ? "alert" : "status";

  return (
    <div
      className={`toast-card toast-card--${toast.tone}`}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{toast.message}</span>
      <button
        className="toast-close"
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭通知"
      >
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

function iconFromTone(tone: ToastTone) {
  if (tone === "success") {
    return CheckCircle2;
  }

  if (tone === "warning" || tone === "error") {
    return AlertCircle;
  }

  return Info;
}
