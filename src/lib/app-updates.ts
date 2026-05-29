import type {
  AppUpdateNoticeState,
  AppUpdateStatus
} from "./types";

export type UpdateNoticeStorage = Pick<Storage, "getItem" | "setItem">;

export const APP_UPDATE_NOTICE_STORAGE_KEY = "wxreadmaster.appUpdateNotice.v1";
export const APP_UPDATE_AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function readAppUpdateNoticeState(
  storage = safeLocalStorage()
): AppUpdateNoticeState {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(APP_UPDATE_NOTICE_STORAGE_KEY);
    return normalizeAppUpdateNoticeState(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export function writeAppUpdateNoticeState(
  storage: UpdateNoticeStorage | undefined,
  value: AppUpdateNoticeState
): AppUpdateNoticeState {
  const normalized = normalizeAppUpdateNoticeState(value);
  storage?.setItem(APP_UPDATE_NOTICE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function normalizeAppUpdateNoticeState(
  value: unknown
): AppUpdateNoticeState {
  if (!isRecord(value)) {
    return {};
  }

  return {
    lastCheckedAt: stringValue(value.lastCheckedAt),
    dismissedVersion: stringValue(value.dismissedVersion),
    reviewedVersion: stringValue(value.reviewedVersion)
  };
}

export function shouldAutoCheckForAppUpdate(
  state: AppUpdateNoticeState,
  now = Date.now(),
  intervalMs = APP_UPDATE_AUTO_CHECK_INTERVAL_MS
): boolean {
  if (!state.lastCheckedAt) {
    return true;
  }

  const lastCheckedAt = Date.parse(state.lastCheckedAt);
  if (!Number.isFinite(lastCheckedAt)) {
    return true;
  }

  return now - lastCheckedAt >= intervalMs;
}

export function shouldShowAppUpdateBadge(
  status: AppUpdateStatus | undefined,
  state: AppUpdateNoticeState
): boolean {
  return Boolean(
    status?.available &&
      status.latestVersion &&
      status.latestVersion !== state.reviewedVersion
  );
}

export function shouldAutoShowAppUpdateDialog(
  status: AppUpdateStatus | undefined,
  state: AppUpdateNoticeState
): boolean {
  return Boolean(
    status?.available &&
      status.latestVersion &&
      status.latestVersion !== state.dismissedVersion
  );
}

export function markAppUpdateChecked(
  state: AppUpdateNoticeState,
  checkedAt = new Date().toISOString()
): AppUpdateNoticeState {
  return {
    ...state,
    lastCheckedAt: checkedAt
  };
}

export function markAppUpdateDismissed(
  state: AppUpdateNoticeState,
  version: string | undefined
): AppUpdateNoticeState {
  if (!version) {
    return state;
  }

  return {
    ...state,
    dismissedVersion: version
  };
}

export function markAppUpdateReviewed(
  state: AppUpdateNoticeState,
  version: string | undefined
): AppUpdateNoticeState {
  if (!version) {
    return state;
  }

  return {
    ...state,
    reviewedVersion: version
  };
}

export function pruneAppUpdateNoticeState(
  state: AppUpdateNoticeState,
  currentVersion: string | undefined
): AppUpdateNoticeState {
  if (!currentVersion) {
    return state;
  }

  return {
    ...state,
    dismissedVersion:
      state.dismissedVersion === currentVersion
        ? undefined
        : state.dismissedVersion,
    reviewedVersion:
      state.reviewedVersion === currentVersion
        ? undefined
        : state.reviewedVersion
  };
}

function safeLocalStorage(): UpdateNoticeStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
