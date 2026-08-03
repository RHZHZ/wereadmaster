import {
  AlertCircle,
  CheckCircle2,
  CircleSlash2,
  FileText,
  Loader2,
  RefreshCw,
  Settings
} from "lucide-react";
import type {
  ExportPlatformMode,
  ExportTargetConfiguration
} from "../../lib/asset-export-dialog";
import type { ExternalExportTarget } from "../../lib/types";

export function ExportTargetSelection({
  configurations,
  isLoadingSettings,
  platformMode,
  selectedTargets,
  settingsError,
  onOpenSettings,
  onReloadSettings,
  onTargetChange
}: {
  configurations: ExportTargetConfiguration[];
  isLoadingSettings: boolean;
  platformMode: ExportPlatformMode;
  selectedTargets: ExternalExportTarget[];
  settingsError?: string;
  onOpenSettings: () => void;
  onReloadSettings: () => void;
  onTargetChange: (target: ExternalExportTarget) => void;
}) {
  if (platformMode === "webReadonly") {
    return (
      <section className="asset-export-readonly" aria-label="Web 导出能力说明">
        <CircleSlash2 aria-hidden="true" size={26} />
        <div>
          <h4>当前为 Web 只读预览</h4>
          <p>文档导出请在桌面应用中执行。</p>
        </div>
      </section>
    );
  }

  if (isLoadingSettings) {
    return (
      <section className="asset-export-progress" aria-live="polite">
        <Loader2 aria-hidden="true" size={26} className="spin" />
        <div>
          <h4>正在读取导出设置</h4>
          <p>将显示设置页中已保存的导出目录、Vault 和 Notion 目标。</p>
        </div>
      </section>
    );
  }

  if (settingsError) {
    return (
      <section className="asset-export-settings-error" role="alert">
        <AlertCircle aria-hidden="true" size={24} />
        <div>
          <h4>无法读取导出设置</h4>
          <p>{settingsError}</p>
          <button className="btn-secondary" type="button" onClick={onReloadSettings}>
            <RefreshCw aria-hidden="true" size={16} />
            重新读取
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="asset-export-selection" aria-label="选择导出目标">
      <div className="asset-export-selection-heading">
        <div>
          <h4>选择本次导出目标</h4>
          <p>目的地来自设置页，本面板只读展示，不修改长期配置。</p>
        </div>
        <span>已选择 {selectedTargets.length} 个</span>
      </div>
      <div className="asset-export-targets">
        {configurations.map((configuration) => (
          <ExportTargetCard
            configuration={configuration}
            key={configuration.target}
            selected={selectedTargets.includes(configuration.target)}
            onChange={() => onTargetChange(configuration.target)}
            onOpenSettings={onOpenSettings}
          />
        ))}
      </div>
      {selectedTargets.length === 0 ? (
        <p className="asset-export-inline-warning">至少选择一个导出目标。</p>
      ) : configurations.some(
          (configuration) =>
            selectedTargets.includes(configuration.target) && configuration.readiness !== "ready"
        ) ? (
        <p className="asset-export-inline-warning">所选目标中存在未配置项，请取消选择或前往设置。</p>
      ) : null}
    </section>
  );
}

function ExportTargetCard({
  configuration,
  selected,
  onChange,
  onOpenSettings
}: {
  configuration: ExportTargetConfiguration;
  selected: boolean;
  onChange: () => void;
  onOpenSettings: () => void;
}) {
  const isReadonly =
    configuration.readiness === "readonly" || configuration.readiness === "unsupported";

  return (
    <article
      className={`asset-export-target ${selected ? "is-selected" : ""} asset-export-target--${configuration.readiness}`}
    >
      <label>
        <input
          type="checkbox"
          checked={selected}
          onChange={onChange}
          disabled={isReadonly}
        />
        <span className="asset-export-target-check" aria-hidden="true">
          {selected ? <CheckCircle2 size={20} /> : <FileText size={20} />}
        </span>
        <span className="asset-export-target-copy">
          <strong>{configuration.label}</strong>
          <span title={configuration.destinationLabel}>{configuration.destinationLabel}</span>
          <small>{configuration.detail}</small>
        </span>
      </label>
      {configuration.readiness === "missing" || configuration.readiness === "invalid" ? (
        <button className="text-button" type="button" onClick={onOpenSettings}>
          <Settings aria-hidden="true" size={15} />
          前往设置
        </button>
      ) : null}
    </article>
  );
}
