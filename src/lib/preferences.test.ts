import { describe, expect, test } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  readUserPreferences,
  writeUserPreferences,
  type PreferenceStorage
} from "./preferences";

function createMemoryStorage(initial?: Record<string, string>): PreferenceStorage {
  const values = new Map(Object.entries(initial ?? {}));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

describe("user preferences", () => {
  test("falls back to safe defaults when storage is empty or invalid", () => {
    expect(readUserPreferences(createMemoryStorage())).toEqual(DEFAULT_USER_PREFERENCES);
    expect(readUserPreferences(createMemoryStorage({ "wxreadmaster.userPreferences.v1": "{" }))).toEqual(
      DEFAULT_USER_PREFERENCES
    );
  });

  test("keeps only supported preset values from storage", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.userPreferences.v1": JSON.stringify({
        themeMode: "dark",
        fontScale: "huge",
        density: "compact",
        defaultStartPage: "stats",
        defaultNotesView: "cards",
        defaultStatsPeriod: "annually"
      })
    });

    expect(readUserPreferences(storage)).toEqual({
      ...DEFAULT_USER_PREFERENCES,
      themeMode: "dark",
      density: "compact",
      defaultStartPage: "stats",
      defaultNotesView: "cards",
      defaultStatsPeriod: "annually"
    });
  });

  test("writes normalized preferences to storage", () => {
    const storage = createMemoryStorage();

    const preferences = writeUserPreferences(storage, {
      themeMode: "light",
      fontScale: "large",
      density: "compact",
      defaultStartPage: "notes",
      defaultNotesView: "cards",
      defaultStatsPeriod: "overall"
    });

    expect(preferences.fontScale).toBe("large");
    expect(readUserPreferences(storage)).toEqual(preferences);
  });
});
