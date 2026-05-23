import { classifyExportError } from "../lib/export-errors";

type ExportFailurePanelProps = {
  ariaLabel: string;
  error: string;
  contextTitle: string;
  contextDescription: string;
};

export function ExportFailurePanel({
  ariaLabel,
  error,
  contextTitle,
  contextDescription
}: ExportFailurePanelProps) {
  const descriptor = classifyExportError(error);

  return (
    <section className="bulk-export-result bulk-export-result--error" aria-label={ariaLabel}>
      <div>
        <h3>{descriptor.title}</h3>
        <p>{descriptor.summary}</p>
      </div>
      <span>未导出</span>
      <div className="bulk-export-result-list">
        <article className="bulk-export-result-item">
          <p>
            <strong>原始错误</strong>
            <span>{error}</span>
          </p>
        </article>
        <article className="bulk-export-result-item">
          <p>
            <strong>恢复建议</strong>
            <span>{descriptor.recoveryHint}</span>
          </p>
        </article>
        <article className="bulk-export-result-item">
          <p>
            <strong>{contextTitle}</strong>
            <span>{contextDescription}</span>
          </p>
        </article>
      </div>
    </section>
  );
}
