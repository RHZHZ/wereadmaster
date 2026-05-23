import { BookOpen, Maximize2, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowAction = "minimize" | "toggleMaximize" | "close";

export function AppTitleBar() {
  function handleDrag() {
    if (!isTauriRuntime()) {
      return;
    }

    void getCurrentWindow().startDragging();
  }

  function handleWindowAction(action: WindowAction) {
    if (!isTauriRuntime()) {
      return;
    }

    const appWindow = getCurrentWindow();
    const task =
      action === "minimize"
        ? appWindow.minimize()
        : action === "toggleMaximize"
          ? appWindow.toggleMaximize()
          : appWindow.close();

    void task;
  }

  return (
    <header className="app-titlebar" aria-label="应用窗口控制">
      <div
        className="app-titlebar-drag-region"
        aria-label="拖动窗口"
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail === 1) {
            handleDrag();
          }
        }}
      >
        <BookOpen aria-hidden="true" size={15} />
        <span>个人阅读管理</span>
      </div>
      <div className="app-window-controls">
        <button type="button" aria-label="最小化窗口" onClick={() => handleWindowAction("minimize")}>
          <Minus aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-label="最大化或还原窗口" onClick={() => handleWindowAction("toggleMaximize")}>
          <Maximize2 aria-hidden="true" size={14} />
        </button>
        <button
          className="app-window-control-close"
          type="button"
          aria-label="关闭窗口"
          onClick={() => handleWindowAction("close")}
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>
    </header>
  );
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
