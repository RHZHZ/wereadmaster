import { describe, expect, test } from "vitest";
import {
  createCollapsedSidebarMenuState,
  openSidebarMenuState,
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
