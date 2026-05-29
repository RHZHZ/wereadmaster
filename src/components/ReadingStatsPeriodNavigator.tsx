import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReadingStatsMode } from "../lib/types";
import {
  formatReadingStatsPeriodAnchor,
  type ReadingStatsPeriod
} from "../pages/reading-stats-period";

type PeriodOption = {
  mode: ReadingStatsMode;
  label: string;
  description: string;
};

type DrillLabels = {
  overall: string;
  nested: string;
};

type ReadingStatsPeriodNavigatorProps = {
  activePeriod: ReadingStatsPeriod;
  anchorAriaLabel: string;
  anchorDescription: string;
  canStepForward: boolean;
  drillAriaLabel: string;
  drillLabels: DrillLabels;
  drillPeriods: ReadingStatsPeriod[];
  periodOptions: PeriodOption[];
  tabsAriaLabel: string;
  onDrillPeriod: (period: ReadingStatsPeriod) => void;
  onModeChange: (mode: ReadingStatsMode) => void;
  onOpenJumpPicker: () => void;
  onShiftPeriod: (offset: -1 | 1) => void;
};

export function ReadingStatsPeriodNavigator({
  activePeriod,
  anchorAriaLabel,
  anchorDescription,
  canStepForward,
  drillAriaLabel,
  drillLabels,
  drillPeriods,
  periodOptions,
  tabsAriaLabel,
  onDrillPeriod,
  onModeChange,
  onOpenJumpPicker,
  onShiftPeriod
}: ReadingStatsPeriodNavigatorProps) {
  const drillLabel =
    activePeriod.mode === "overall"
      ? drillLabels.overall
      : activePeriod.mode === "annually"
        ? drillLabels.nested
        : undefined;

  return (
    <>
      <section className="stats-period-anchor" aria-label={anchorAriaLabel}>
        <div>
          <p className="section-kicker">时间锚点</p>
          <h4>{formatReadingStatsPeriodAnchor(activePeriod)}</h4>
          <p>{anchorDescription}</p>
        </div>
        <div className="stats-period-anchor-actions">
          <button type="button" className="secondary-action" onClick={onOpenJumpPicker}>
            <CalendarDays aria-hidden="true" size={16} />
            跳转
          </button>
          {activePeriod.mode !== "overall" ? (
            <>
            <button type="button" className="secondary-action" onClick={() => onShiftPeriod(-1)}>
              <ChevronLeft aria-hidden="true" size={16} />
              上一段
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => onShiftPeriod(1)}
              disabled={!canStepForward}
            >
              下一段
              <ChevronRight aria-hidden="true" size={16} />
            </button>
            </>
          ) : null}
        </div>
      </section>

      <div className="period-tabs" role="tablist" aria-label={tabsAriaLabel}>
        {periodOptions.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="tab"
            aria-selected={activePeriod.mode === option.mode}
            className={activePeriod.mode === option.mode ? "is-active" : ""}
            onClick={() => onModeChange(option.mode)}
          >
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>

      {drillLabel && drillPeriods.length > 0 ? (
        <div className="stats-period-drill" aria-label={drillAriaLabel}>
          <span>{drillLabel}</span>
          <div className="stats-period-drill-list">
            {drillPeriods.map((nextPeriod) => (
              <button
                key={`${nextPeriod.mode}:${nextPeriod.baseTime}`}
                type="button"
                className={
                  nextPeriod.baseTime === activePeriod.baseTime && nextPeriod.mode === activePeriod.mode
                    ? "is-active"
                    : ""
                }
                onClick={() => onDrillPeriod(nextPeriod)}
              >
                {formatReadingStatsPeriodAnchor(nextPeriod)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
