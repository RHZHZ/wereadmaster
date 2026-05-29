import type {
  PeriodReportDownloadMode as ImportedPeriodReportDownloadMode,
  PeriodReportPreviewMode as ImportedPeriodReportPreviewMode
} from "./components/PeriodReportPosterDialog";
import {
  buildMonthlyReportPosterData,
  downloadMonthlyReportPoster,
  downloadMonthlyReportStoryPage,
  downloadMonthlyReportStoryPages,
  downloadMonthlyReportWideReport,
  formatMonthlyReportPosterPersonaTitle,
  MONTHLY_REPORT_STORY_PAGES,
  type MonthlyReportPosterOptions,
  type PeriodReport,
  type PeriodReportAiReviewInput,
  type PeriodReportCompleteness,
  type PeriodReportLabels,
  splitMonthlyReportPosterTitle
} from "./monthly-report-poster";
import type { PeriodReportPosterData } from "./components/PeriodReportPoster";

export type {
  MonthlyReportPosterOptions as PeriodReportBuildOptions,
  PeriodReport,
  PeriodReportAiReviewInput,
  PeriodReportCompleteness,
  PeriodReportLabels,
  PeriodReportPosterData
};
export type PeriodReportPreviewMode = ImportedPeriodReportPreviewMode;
export type PeriodReportDownloadMode = ImportedPeriodReportDownloadMode;

export {
  MONTHLY_REPORT_STORY_PAGES as PERIOD_REPORT_STORY_PAGES,
  buildMonthlyReportPosterData as buildPeriodReportData,
  downloadMonthlyReportPoster as downloadPeriodReportPoster,
  downloadMonthlyReportStoryPage as downloadPeriodReportStoryPage,
  downloadMonthlyReportStoryPages as downloadPeriodReportStoryPages,
  downloadMonthlyReportWideReport as downloadPeriodReportWideReport,
  formatMonthlyReportPosterPersonaTitle as formatPeriodReportPersonaTitle,
  splitMonthlyReportPosterTitle as splitPeriodReportTitle
};
