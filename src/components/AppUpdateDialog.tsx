import { Download, Info, Sparkles, X } from "lucide-react";
import { AppUpdateNotes } from "./AppUpdateNotes";
import type { AppUpdateStatus } from "../lib/types";

type AppUpdateDialogProps = {
  open: boolean;
  status?: AppUpdateStatus;
  isInstalling?: boolean;
  progressLabel?: string;
  onClose: () => void;
  onLater: () => void;
  onViewDetails: () => void;
  onInstall: () => void;
};

export function AppUpdateDialog({
  open,
  status,
  isInstalling = false,
  progressLabel,
  onClose,
  onLater,
  onViewDetails,
  onInstall
}: AppUpdateDialogProps) {
  if (!open || !status?.available) {
    return null;
  }

  const supportsNativeUpdater = status.supportsNativeUpdater;
  const title = supportsNativeUpdater
    ? `${status.latestVersion || "新版本"} 已可安装`
    : `${status.latestVersion || "新版本"} 已可下载`;
  const description = supportsNativeUpdater
    ? "先看说明，再决定是否安装。更新包来自 GitHub Releases，并会执行签名校验。"
    : "先看说明，再决定是否下载。当前平台会跳转到 GitHub Releases 下载对应安装包。";
  const primaryActionLabel = supportsNativeUpdater
    ? isInstalling
      ? "安装中"
      : "立即更新"
    : isInstalling
      ? "打开中"
      : "前往下载";

  return (
    <div className="update-dialog-backdrop" role="presentation">
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onClose}
          aria-label="关闭更新说明"
          disabled={isInstalling}
        >
          <X aria-hidden="true" size={18} />
        </button>
        <div className="update-dialog-heading">
          <span className="settings-icon">
            <Sparkles aria-hidden="true" size={20} />
          </span>
          <div>
            <p className="section-kicker">发现新版本</p>
            <h3 id="update-dialog-title">{title}</h3>
            <p>{description}</p>
          </div>
        </div>

        <dl className="settings-dl update-dialog-meta">
          <div>
            <dt>当前版本</dt>
            <dd>{status.currentVersion}</dd>
          </div>
          <div>
            <dt>最新版本</dt>
            <dd>{status.latestVersion || "未知版本"}</dd>
          </div>
          <div className="wide-row">
            <dt>发布时间</dt>
            <dd>{formatReleaseDate(status.publishedAt)}</dd>
          </div>
        </dl>

        <section className="settings-update-notes update-dialog-notes" aria-label="更新摘要">
          <div className="settings-update-notes-heading">
            <Info aria-hidden="true" size={16} />
            <strong>更新摘要</strong>
          </div>
          <AppUpdateNotes
            notes={status.notes}
            emptyText="本次版本尚未提供详细摘要。"
          />
        </section>

        {progressLabel ? (
          <div className="status-message status-message--actionable">
            <Download aria-hidden="true" size={18} />
            <span>{progressLabel}</span>
          </div>
        ) : null}

        <div className="update-dialog-actions">
          <button
            className="sync-button"
            type="button"
            onClick={onLater}
            disabled={isInstalling}
          >
            稍后再说
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={onViewDetails}
            disabled={isInstalling}
          >
            查看详情
          </button>
          <button
            className="sync-button"
            type="button"
            onClick={onInstall}
            disabled={isInstalling}
          >
            {primaryActionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatReleaseDate(value?: string): string {
  if (!value) {
    return "尚未提供";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}
