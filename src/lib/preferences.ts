import type { ReadingStatsMode } from "./types";

export type ThemeMode = "system" | "light" | "dark";
export type FontScale = "normal" | "large" | "extraLarge";
export type InformationDensity = "comfortable" | "compact";
export type DefaultStartPage = "dashboard" | "shelf" | "notes" | "stats" | "readingReview" | "discovery";
export type DefaultNotesView = "list" | "cards";

export type UserPreferences = {
  themeMode: ThemeMode;
  fontScale: FontScale;
  density: InformationDensity;
  defaultStartPage: DefaultStartPage;
  defaultNotesView: DefaultNotesView;
  defaultStatsPeriod: ReadingStatsMode;
};

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export const USER_PREFERENCES_STORAGE_KEY = "wxreadmaster.userPreferences.v1";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  themeMode: "system",
  fontScale: "normal",
  density: "comfortable",
  defaultStartPage: "dashboard",
  defaultNotesView: "list",
  defaultStatsPeriod: "monthly"
};

const themeModes = new Set<ThemeMode>(["system", "light", "dark"]);
const fontScales = new Set<FontScale>(["normal", "large", "extraLarge"]);
const densities = new Set<InformationDensity>(["comfortable", "compact"]);
const startPages = new Set<DefaultStartPage>([
  "dashboard",
  "shelf",
  "notes",
  "stats",
  "readingReview",
  "discovery"
]);
const notesViews = new Set<DefaultNotesView>(["list", "cards"]);
const statsPeriods = new Set<ReadingStatsMode>(["weekly", "monthly", "annually", "overall"]);

export function readUserPreferences(storage = safeLocalStorage()): UserPreferences {
  if (!storage) {
    return DEFAULT_USER_PREFERENCES;
  }

  try {
    const raw = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeUserPreferences(parsed);
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function writeUserPreferences(
  storage: PreferenceStorage | undefined,
  preferences: UserPreferences
): UserPreferences {
  const normalized = normalizeUserPreferences(preferences);
  storage?.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) {
    return DEFAULT_USER_PREFERENCES;
  }

  return {
    themeMode: pickPreset(value.themeMode, themeModes, DEFAULT_USER_PREFERENCES.themeMode),
    fontScale: pickPreset(value.fontScale, fontScales, DEFAULT_USER_PREFERENCES.fontScale),
    density: pickPreset(value.density, densities, DEFAULT_USER_PREFERENCES.density),
    defaultStartPage: pickPreset(
      value.defaultStartPage,
      startPages,
      DEFAULT_USER_PREFERENCES.defaultStartPage
    ),
    defaultNotesView: pickPreset(
      value.defaultNotesView,
      notesViews,
      DEFAULT_USER_PREFERENCES.defaultNotesView
    ),
    defaultStatsPeriod: pickPreset(
      value.defaultStatsPeriod,
      statsPeriods,
      DEFAULT_USER_PREFERENCES.defaultStatsPeriod
    )
  };
}

function safeLocalStorage(): PreferenceStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickPreset<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}
