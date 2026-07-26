import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

type AppDialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  disableEscape?: boolean;
  disableBackdropClose?: boolean;
  initialFocusRef?: { current: HTMLElement | null };
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

/**
 * 所有弹窗的行为基座:Esc 关闭、Tab 焦点圈定、初始焦点、关闭后焦点归还、
 * backdrop 点击关闭(可禁用)与 aria 接线。视觉完全由 className 决定,
 * 以便沿用现有的 dialog/update-dialog 等样式。
 */
export function AppDialog({
  open,
  onClose,
  children,
  className,
  backdropClassName = "dialog-backdrop",
  labelledBy,
  describedBy,
  ariaLabel,
  disableEscape = false,
  disableBackdropClose = false,
  initialFocusRef
}: AppDialogProps) {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const section = sectionRef.current;
    const initialTarget =
      initialFocusRef?.current ??
      section?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      section ??
      null;
    initialTarget?.focus();

    return () => {
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
    // initialFocusRef 是 ref 容器,引用稳定,不参与依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  function handleBackdropKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (disableEscape) {
        return;
      }

      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const section = sectionRef.current;
    if (!section) {
      return;
    }

    const focusables = Array.from(section.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      section.focus();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const isInside = active instanceof HTMLElement && section.contains(active);

    if (event.shiftKey) {
      if (!isInside || active === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!isInside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!disableBackdropClose && event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
      onKeyDown={handleBackdropKeyDown}
    >
      <section
        ref={sectionRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
