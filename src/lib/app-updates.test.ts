import { describe, expect, it } from "vitest";
import {
  APP_UPDATE_AUTO_CHECK_INTERVAL_MS,
  markAppUpdateChecked,
  markAppUpdateDismissed,
  markAppUpdateReviewed,
  normalizeAppUpdateNoticeState,
  pruneAppUpdateNoticeState,
  readAppUpdateNoticeState,
  shouldAutoCheckForAppUpdate,
  shouldAutoShowAppUpdateDialog,
  shouldShowAppUpdateBadge,
  writeAppUpdateNoticeState
} from "./app-updates";
import type { AppUpdateStatus } from "./types";

describe("app update notice state helpers", () => {
  it("falls back to empty notice state for invalid storage payloads", () => {
    expect(readAppUpdateNoticeState(createMemoryStorage())).toEqual({});
    expect(
      readAppUpdateNoticeState(
        createMemoryStorage({ "wxreadmaster.appUpdateNotice.v1": "{" })
      )
    ).toEqual({});
  });

  it("normalizes persisted fields and drops invalid values", () => {
    expect(
      normalizeAppUpdateNoticeState({
        lastCheckedAt: "2026-05-24T10:00:00.000Z",
        dismissedVersion: "1.0.2",
        reviewedVersion: 1024
      })
    ).toEqual({
      lastCheckedAt: "2026-05-24T10:00:00.000Z",
      dismissedVersion: "1.0.2"
    });
  });

  it("persists normalized notice state", () => {
    const storage = createMemoryStorage();
    const saved = writeAppUpdateNoticeState(storage, {
      lastCheckedAt: "2026-05-24T10:00:00.000Z",
      dismissedVersion: "1.0.2",
      reviewedVersion: "1.0.2"
    });

    expect(saved).toEqual({
      lastCheckedAt: "2026-05-24T10:00:00.000Z",
      dismissedVersion: "1.0.2",
      reviewedVersion: "1.0.2"
    });
    expect(readAppUpdateNoticeState(storage)).toEqual(saved);
  });

  it("enforces the automatic check interval", () => {
    expect(shouldAutoCheckForAppUpdate({})).toBe(true);
    expect(
      shouldAutoCheckForAppUpdate(
        { lastCheckedAt: "2026-05-24T10:00:00.000Z" },
        Date.parse("2026-05-24T10:10:00.000Z"),
        APP_UPDATE_AUTO_CHECK_INTERVAL_MS
      )
    ).toBe(false);
    expect(
      shouldAutoCheckForAppUpdate(
        { lastCheckedAt: "2026-05-24T10:00:00.000Z" },
        Date.parse("2026-05-25T10:30:00.000Z"),
        APP_UPDATE_AUTO_CHECK_INTERVAL_MS
      )
    ).toBe(true);
  });

  it("derives badge and dialog visibility from version state", () => {
    const status: AppUpdateStatus = {
      available: true,
      currentVersion: "1.0.1",
      supportsNativeUpdater: true,
      latestVersion: "1.0.2"
    };

    expect(shouldShowAppUpdateBadge(status, {})).toBe(true);
    expect(shouldAutoShowAppUpdateDialog(status, {})).toBe(true);
    expect(
      shouldShowAppUpdateBadge(status, { reviewedVersion: "1.0.2" })
    ).toBe(false);
    expect(
      shouldAutoShowAppUpdateDialog(status, { dismissedVersion: "1.0.2" })
    ).toBe(false);
  });

  it("updates notice state markers for checked, dismissed and reviewed versions", () => {
    const checked = markAppUpdateChecked({}, "2026-05-24T10:00:00.000Z");
    const dismissed = markAppUpdateDismissed(checked, "1.0.2");
    const reviewed = markAppUpdateReviewed(dismissed, "1.0.2");

    expect(reviewed).toEqual({
      lastCheckedAt: "2026-05-24T10:00:00.000Z",
      dismissedVersion: "1.0.2",
      reviewedVersion: "1.0.2"
    });
  });

  it("prunes stale version markers after the app itself reaches that version", () => {
    expect(
      pruneAppUpdateNoticeState(
        {
          lastCheckedAt: "2026-05-24T10:00:00.000Z",
          dismissedVersion: "1.0.2",
          reviewedVersion: "1.0.2"
        },
        "1.0.2"
      )
    ).toEqual({
      lastCheckedAt: "2026-05-24T10:00:00.000Z",
      dismissedVersion: undefined,
      reviewedVersion: undefined
    });
  });
});

function createMemoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    }
  };
}
