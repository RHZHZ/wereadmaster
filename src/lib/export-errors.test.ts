import { describe, expect, test } from "vitest";
import { classifyExportError } from "./export-errors";

describe("classifyExportError", () => {
  test("classifies unwritable directory errors", () => {
    expect(classifyExportError("导出目录暂时不可写，请稍后重试。").kind).toBe("directory_unwritable");
  });

  test("classifies missing path errors", () => {
    expect(classifyExportError("导出目录不存在，请重新设置。").kind).toBe("path_missing");
  });

  test("classifies file in use errors", () => {
    expect(classifyExportError("目标文件被占用，请关闭其他程序后重试。").kind).toBe("file_in_use");
  });

  test("classifies serialization errors", () => {
    expect(classifyExportError("Markdown 序列化失败，请稍后重试。").kind).toBe("serialization_failed");
  });

  test("classifies permission errors", () => {
    expect(classifyExportError("Access is denied while writing export file.").kind).toBe("permission_denied");
  });

  test("falls back to unknown for unmatched errors", () => {
    expect(classifyExportError("发生未知错误。").kind).toBe("unknown");
  });
});
