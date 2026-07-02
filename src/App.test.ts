import { describe, expect, test } from "vitest";
import {
  createCollapsedSidebarMenuState,
  isAndroidRuntime,
  isMobileShellViewport,
  openSidebarMenuState,
  resolveBottomNavigationId,
  toggleSidebarMenuState,
} from "./App";

describe("sidebar accordion state", () => {
  test("starts with all menus collapsed", () => {
    expect(createCollapsedSidebarMenuState()).toEqual({
      shelf: false,
      readingReview: false,
    });
  });

  test("opens only the requested menu", () => {
    expect(openSidebarMenuState("shelf")).toEqual({
      shelf: true,
      readingReview: false,
    });
    expect(openSidebarMenuState("readingReview")).toEqual({
      shelf: false,
      readingReview: true,
    });
  });

  test("toggles current menu and closes the other one", () => {
    expect(
      toggleSidebarMenuState(
        {
          shelf: false,
          readingReview: false,
        },
        "shelf",
      ),
    ).toEqual({
      shelf: true,
      readingReview: false,
    });

    expect(
      toggleSidebarMenuState(
        {
          shelf: true,
          readingReview: false,
        },
        "readingReview",
      ),
    ).toEqual({
      shelf: false,
      readingReview: true,
    });

    expect(
      toggleSidebarMenuState(
        {
          shelf: false,
          readingReview: true,
        },
        "readingReview",
      ),
    ).toEqual({
      shelf: false,
      readingReview: false,
    });
  });
});

describe("mobile shell detection", () => {
  test("detects Android runtime from user agent", () => {
    expect(
      isAndroidRuntime(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36",
      ),
    ).toBe(true);
    expect(
      isAndroidRuntime(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ),
    ).toBe(false);
  });

  test("falls back safely when no runtime user agent exists", () => {
    expect(isAndroidRuntime("")).toBe(false);
  });

  test("uses the narrow viewport media query for mobile shell state", () => {
    expect(
      isMobileShellViewport((query) => ({
        matches: query === "(max-width: 980px)",
      })),
    ).toBe(true);
    expect(
      isMobileShellViewport((query) => ({
        matches: query === "(min-width: 981px)",
      })),
    ).toBe(false);
  });
});

describe("bottom navigation active state", () => {
  test("maps primary views to mobile bottom navigation items", () => {
    expect(resolveBottomNavigationId("dashboard")).toBe("dashboard");
    expect(resolveBottomNavigationId("shelf")).toBe("shelf");
    expect(resolveBottomNavigationId("notes")).toBe("notes");
    expect(resolveBottomNavigationId("readingReview")).toBe("readingReview");
    expect(resolveBottomNavigationId("mine")).toBe("mine");
  });

  test("maps nested views back to their primary mobile destination", () => {
    expect(resolveBottomNavigationId("candidateShelf")).toBe("shelf");
    expect(resolveBottomNavigationId("localLibrary")).toBe("shelf");
    expect(resolveBottomNavigationId("bookDetail")).toBe("shelf");
    expect(
      resolveBottomNavigationId("bookDetail", {
        detailBackView: "dashboard",
      }),
    ).toBe("dashboard");
    expect(
      resolveBottomNavigationId("bookDetail", {
        detailBackView: "discovery",
      }),
    ).toBe("mine");
    expect(resolveBottomNavigationId("bookNotes")).toBe("notes");
    expect(
      resolveBottomNavigationId("bookAiSummary", {
        bookAiBackView: "readingReview",
      }),
    ).toBe("readingReview");
    expect(resolveBottomNavigationId("bookAiSummary")).toBe("notes");
    expect(resolveBottomNavigationId("readingRoute")).toBe("readingReview");
  });

  test("keeps low-frequency pages under mine and hides local reader", () => {
    expect(resolveBottomNavigationId("stats")).toBe("mine");
    expect(resolveBottomNavigationId("discovery")).toBe("mine");
    expect(resolveBottomNavigationId("localReader")).toBeUndefined();
  });
});
