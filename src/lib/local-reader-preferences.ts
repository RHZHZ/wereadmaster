export type LocalReaderFontScale = "compact" | "standard" | "large";
export type LocalReaderLineSpacing = "standard" | "relaxed" | "loose";
export type LocalReaderTheme = "paper" | "warm" | "mint";

export type LocalReaderPreferences = {
  fontScale: LocalReaderFontScale;
  lineSpacing: LocalReaderLineSpacing;
  theme: LocalReaderTheme;
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const LOCAL_READER_PREFERENCES_KEY = "wxreadmaster.localReader.preferences.v1";

const DEFAULT_LOCAL_READER_PREFERENCES: LocalReaderPreferences = {
  fontScale: "standard",
  lineSpacing: "standard",
  theme: "paper"
};

const FONT_SCALE_ORDER: LocalReaderFontScale[] = ["compact", "standard", "large"];
const LINE_SPACING_ORDER: LocalReaderLineSpacing[] = ["standard", "relaxed", "loose"];
const THEME_ORDER: LocalReaderTheme[] = ["paper", "warm", "mint"];

export function readLocalReaderPreferences(
  storage: PreferenceStorage | undefined
): LocalReaderPreferences {
  if (!storage) {
    return DEFAULT_LOCAL_READER_PREFERENCES;
  }

  try {
    const raw = storage.getItem(LOCAL_READER_PREFERENCES_KEY);
    if (!raw) {
      return DEFAULT_LOCAL_READER_PREFERENCES;
    }

    return normalizeLocalReaderPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_LOCAL_READER_PREFERENCES;
  }
}

export function writeLocalReaderPreferences(
  storage: PreferenceStorage | undefined,
  preferences: LocalReaderPreferences
): LocalReaderPreferences {
  const normalized = normalizeLocalReaderPreferences(preferences);

  if (!storage) {
    return normalized;
  }

  try {
    storage.setItem(LOCAL_READER_PREFERENCES_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免打断阅读操作。
  }

  return normalized;
}

export function nextLocalReaderFontScale(
  current: LocalReaderFontScale
): LocalReaderFontScale {
  return nextValue(FONT_SCALE_ORDER, current);
}

export function nextLocalReaderLineSpacing(
  current: LocalReaderLineSpacing
): LocalReaderLineSpacing {
  return nextValue(LINE_SPACING_ORDER, current);
}

export function nextLocalReaderTheme(current: LocalReaderTheme): LocalReaderTheme {
  return nextValue(THEME_ORDER, current);
}

export function getLocalReaderPreferenceStorage(): PreferenceStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function normalizeLocalReaderPreferences(value: unknown): LocalReaderPreferences {
  if (!isRecord(value)) {
    return DEFAULT_LOCAL_READER_PREFERENCES;
  }

  return {
    fontScale: normalizeFontScale(value.fontScale),
    lineSpacing: normalizeLineSpacing(value.lineSpacing),
    theme: normalizeTheme(value.theme)
  };
}

function normalizeFontScale(value: unknown): LocalReaderFontScale {
  return value === "compact" || value === "standard" || value === "large"
    ? value
    : DEFAULT_LOCAL_READER_PREFERENCES.fontScale;
}

function normalizeLineSpacing(value: unknown): LocalReaderLineSpacing {
  return value === "standard" || value === "relaxed" || value === "loose"
    ? value
    : DEFAULT_LOCAL_READER_PREFERENCES.lineSpacing;
}

function normalizeTheme(value: unknown): LocalReaderTheme {
  return value === "paper" || value === "warm" || value === "mint"
    ? value
    : DEFAULT_LOCAL_READER_PREFERENCES.theme;
}

function nextValue<T>(values: readonly T[], current: T): T {
  const currentIndex = values.indexOf(current);
  return values[(currentIndex + 1) % values.length] ?? values[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
