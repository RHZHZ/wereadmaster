import { useEffect, useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { ReadingStatsCache, ReadingStatsPeriod } from "../pages/reading-stats-period";
import {
  buildAnnualJumpPeriod,
  buildMonthlyJumpPeriod,
  buildReadingStatsJumpMonthOptions,
  buildReadingStatsJumpWeekOptions,
  buildReadingStatsJumpYearOptions,
  buildWeeklyJumpPeriod,
  deriveReadingStatsJumpSelection
} from "../pages/reading-stats-period-options";

type ReadingStatsPeriodJumpPickerProps = {
  activePeriod: ReadingStatsPeriod;
  cache: ReadingStatsCache;
  onClose: () => void;
  onSelectPeriod: (period: ReadingStatsPeriod) => void;
  open: boolean;
};

export function ReadingStatsPeriodJumpPicker({
  activePeriod,
  cache,
  onClose,
  onSelectPeriod,
  open
}: ReadingStatsPeriodJumpPickerProps) {
  const initialSelection = useMemo(
    () => deriveReadingStatsJumpSelection(activePeriod),
    [activePeriod]
  );
  const [selectedYear, setSelectedYear] = useState(initialSelection.year);
  const [selectedMonth, setSelectedMonth] = useState(initialSelection.month);

  const yearOptions = useMemo(() => buildReadingStatsJumpYearOptions(cache), [cache]);
  const monthOptions = useMemo(
    () => buildReadingStatsJumpMonthOptions(selectedYear),
    [selectedYear]
  );
  const weekOptions = useMemo(
    () => buildReadingStatsJumpWeekOptions(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );
  const activeYear = initialSelection.year;

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedYear(initialSelection.year);
    setSelectedMonth(initialSelection.month);
  }, [initialSelection.month, initialSelection.year, open]);

  useEffect(() => {
    if (!open || activePeriod.mode === "overall") {
      return;
    }

    const enabledMonths = monthOptions.filter((option) => !option.disabled);
    if (enabledMonths.length === 0) {
      return;
    }

    if (!enabledMonths.some((option) => option.month === selectedMonth)) {
      const fallbackMonth = enabledMonths[enabledMonths.length - 1]?.month ?? enabledMonths[0].month;
      setSelectedMonth(fallbackMonth);
    }
  }, [activePeriod.mode, monthOptions, open, selectedMonth]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  function handleSelect(period: ReadingStatsPeriod) {
    onSelectPeriod(period);
    onClose();
  }

  return (
    <div className="reading-route-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="reading-route-dialog reading-stats-jump-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-stats-jump-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="reading-route-dialog-heading">
          <div>
            <p className="section-kicker">时间跳转</p>
            <h3 id="reading-stats-jump-title">{buildJumpTitle(activePeriod.mode)}</h3>
            <p>{buildJumpDescription(activePeriod.mode)}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭时间跳转" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {activePeriod.mode === "overall" ? (
          <section className="stats-period-jump-section">
            <div className="stats-period-jump-heading">
              <strong>历史年份</strong>
              <span>选择年份后进入年度视角</span>
            </div>
            <div className="stats-period-jump-grid stats-period-jump-grid--years">
              {yearOptions.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={year === activeYear ? "is-active" : ""}
                  onClick={() => handleSelect(buildAnnualJumpPeriod(year))}
                >
                  {year} 年
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {activePeriod.mode !== "overall" ? (
          <section className="stats-period-jump-section">
            <div className="stats-period-jump-heading">
              <strong>年份</strong>
              <span>先定位年份，再决定查看全年、月份或具体周</span>
            </div>
            <div className="stats-period-jump-grid stats-period-jump-grid--years">
              {yearOptions.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={selectedYear === year ? "is-active" : ""}
                  onClick={() => setSelectedYear(year)}
                >
                  {year} 年
                </button>
              ))}
            </div>
            {activePeriod.mode === "annually" ? (
              <div className="stats-period-jump-inline-actions">
                <button
                  type="button"
                  className="sync-button"
                  onClick={() => handleSelect(buildAnnualJumpPeriod(selectedYear))}
                  disabled={selectedYear === activeYear}
                >
                  <CalendarDays aria-hidden="true" size={16} />
                  查看 {selectedYear} 年度
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {activePeriod.mode === "annually" || activePeriod.mode === "monthly" || activePeriod.mode === "weekly" ? (
          <section className="stats-period-jump-section">
            <div className="stats-period-jump-heading">
              <strong>{activePeriod.mode === "weekly" ? "月份" : "直达月份"}</strong>
              <span>
                {activePeriod.mode === "annually"
                  ? "点击月份直接进入该月"
                  : activePeriod.mode === "monthly"
                    ? "快速跳到目标月份"
                    : "先选月份，再列出该月所有周"}
              </span>
            </div>
            <div className="stats-period-jump-grid stats-period-jump-grid--months">
              {monthOptions.map((option) => (
                <button
                  key={`${selectedYear}-${option.month}`}
                  type="button"
                  className={selectedMonth === option.month ? "is-active" : ""}
                  disabled={option.disabled}
                  onClick={() => {
                    if (activePeriod.mode === "weekly") {
                      setSelectedMonth(option.month);
                      return;
                    }

                    handleSelect(buildMonthlyJumpPeriod(selectedYear, option.month));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {activePeriod.mode === "weekly" ? (
          <section className="stats-period-jump-section">
            <div className="stats-period-jump-heading">
              <strong>具体周</strong>
              <span>选择该月内的周一锚点，直接跳到对应周度统计</span>
            </div>
            <div className="stats-period-jump-grid stats-period-jump-grid--weeks">
              {weekOptions.map((option) => (
                <button
                  key={option.baseTime}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => handleSelect(buildWeeklyJumpPeriod(option.baseTime))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}

function buildJumpTitle(mode: ReadingStatsPeriod["mode"]): string {
  if (mode === "overall") {
    return "选择年份";
  }

  if (mode === "annually") {
    return "年份与月份跳转";
  }

  if (mode === "monthly") {
    return "跳到月份";
  }

  return "跳到周";
}

function buildJumpDescription(mode: ReadingStatsPeriod["mode"]): string {
  if (mode === "overall") {
    return "从长期总览直接进入某个年份，避免反复切换箭头。";
  }

  if (mode === "annually") {
    return "可以先切到别的年份，也可以直接进入该年的具体月份。";
  }

  if (mode === "monthly") {
    return "快速定位到具体年月，不再依赖逐段切换。";
  }

  return "先确定年月，再选择该月内的具体周度锚点。";
}
