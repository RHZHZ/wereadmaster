const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;

export function formatDuration(totalSeconds?: number): string {
  if (!Number.isFinite(totalSeconds) || !totalSeconds || totalSeconds <= 0) {
    return "0分钟";
  }

  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

  if (hours > 0 && minutes > 0) {
    return `${hours}小时${minutes}分钟`;
  }

  if (hours > 0) {
    return `${hours}小时`;
  }

  return `${Math.max(minutes, 1)}分钟`;
}

export function formatUnixDate(timestamp?: number): string {
  if (!Number.isFinite(timestamp) || !timestamp || timestamp <= 0) {
    return "";
  }

  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatAiTimestamp(value?: string): string {
  if (!value) {
    return "";
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function formatProgress(progressPercent?: number): string {
  const value = clampPercent(progressPercent ?? 0);
  return `${value}%`;
}

export function formatRating(ratingPercent?: number): string {
  if (!Number.isFinite(ratingPercent) || ratingPercent === undefined) {
    return "暂无评分";
  }

  return (Math.max(0, ratingPercent) / 10).toFixed(1);
}

export function formatReviewStars(star?: number): string {
  if (!Number.isFinite(star) || !star || star <= 0) {
    return "未评分";
  }

  const starCount = Math.max(1, Math.min(5, Math.round(star / 20)));
  return "★".repeat(starCount);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.trunc(value)));
}
