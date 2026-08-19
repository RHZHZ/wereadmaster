import { describe, expect, it } from "vitest";
import {
  buildMultiTargetExportRequest,
  exportTargetsFromDestination
} from "./export-targets";

describe("export target request helpers", () => {
  it("adds an explicit body-export confirmation only for Ima", () => {
    expect(buildMultiTargetExportRequest(["markdown", "ima"], true)).toEqual({
      targets: ["markdown", "ima"],
      ima: { confirmBodyExport: true, forceNewSnapshot: false }
    });
    expect(buildMultiTargetExportRequest(["markdown", "ima"])).toEqual({
      targets: ["markdown", "ima"],
      ima: { confirmBodyExport: false, forceNewSnapshot: false }
    });
    expect(buildMultiTargetExportRequest(["ima"], true, true)).toEqual({
      targets: ["ima"],
      ima: { confirmBodyExport: true, forceNewSnapshot: true }
    });
    expect(buildMultiTargetExportRequest(["markdown", "notion"], true)).toEqual({
      targets: ["markdown", "notion"]
    });
  });

  it("keeps the existing bulk destination mapping", () => {
    expect(exportTargetsFromDestination("ima")).toEqual(["ima"]);
    expect(exportTargetsFromDestination("obsidianNotion")).toEqual([
      "obsidian",
      "notion"
    ]);
  });
});
