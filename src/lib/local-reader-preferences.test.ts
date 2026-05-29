import { describe, expect, it } from "vitest";
import {
  nextLocalReaderFontScale,
  nextLocalReaderLineSpacing,
  nextLocalReaderTheme,
  readLocalReaderPreferences,
  writeLocalReaderPreferences
} from "./local-reader-preferences";

describe("local reader preferences", () => {
  it("reads defaults when storage is empty or malformed", () => {
    expect(readLocalReaderPreferences(undefined)).toEqual({
      fontScale: "standard",
      lineSpacing: "standard",
      theme: "paper"
    });

    expect(
      readLocalReaderPreferences(createMemoryStorage({ "wxreadmaster.localReader.preferences.v1": "{" }))
    ).toEqual({
      fontScale: "standard",
      lineSpacing: "standard",
      theme: "paper"
    });
  });

  it("writes normalized preferences to scoped storage", () => {
    const storage = createMemoryStorage();
    const next = writeLocalReaderPreferences(storage, {
      fontScale: "large",
      lineSpacing: "loose",
      theme: "mint"
    });

    expect(next).toEqual({
      fontScale: "large",
      lineSpacing: "loose",
      theme: "mint"
    });
    expect(readLocalReaderPreferences(storage)).toEqual(next);
  });

  it("cycles reader controls in a stable order", () => {
    expect(nextLocalReaderFontScale("compact")).toBe("standard");
    expect(nextLocalReaderFontScale("large")).toBe("compact");
    expect(nextLocalReaderLineSpacing("standard")).toBe("relaxed");
    expect(nextLocalReaderLineSpacing("loose")).toBe("standard");
    expect(nextLocalReaderTheme("paper")).toBe("warm");
    expect(nextLocalReaderTheme("mint")).toBe("paper");
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    }
  };
}
