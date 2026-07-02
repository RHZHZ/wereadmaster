import { AlertTriangle } from "lucide-react";
import type { CommandErrorInfo } from "../lib/reading-api";

type SkillUpgradeNoticeProps = {
  error: CommandErrorInfo;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

export function SkillUpgradeNotice({
  error,
  onRetry,
  retryLabel = "升级后重试",
  className = ""
}: SkillUpgradeNoticeProps) {
  return (
    <section
      className={`setup-card status-card skill-upgrade-notice ${className}`.trim()}
      aria-label="微信读书 Skill 需要升级"
    >
      <AlertTriangle aria-hidden="true" size={24} />
      <div>
        <h3>微信读书 Skill 需要升级</h3>
        <p>{error.message}</p>
        {error.detail && error.detail !== error.message ? <small>{error.detail}</small> : null}
      </div>
      {onRetry ? (
        <button className="secondary-action" type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </section>
  );
}
