import { describe, expect, test } from "vitest";
import { parseReadingAssistantMarkdownLite } from "./reading-assistant-markdown-lite";

describe("reading assistant markdown-lite parser", () => {
  test("parses paragraphs and preserves line breaks inside a paragraph", () => {
    expect(parseReadingAssistantMarkdownLite("第一句\n第二句")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: "第一句\n第二句" }]
      }
    ]);
  });

  test("parses ordered and unordered lists without nesting", () => {
    expect(parseReadingAssistantMarkdownLite("1. 先读第一章\n2. 写三条问题\n\n- 记录疑问")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "text", text: "先读第一章" }],
          [{ type: "text", text: "写三条问题" }]
        ]
      },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "记录疑问" }]]
      }
    ]);
  });

  test("parses bold and inline code as a strict whitelist", () => {
    expect(parseReadingAssistantMarkdownLite("请先读 **第二章**，再记录 `3 条问题`。")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "请先读 " },
          { type: "strong", children: [{ type: "text", text: "第二章" }] },
          { type: "text", text: "，再记录 " },
          { type: "code", text: "3 条问题" },
          { type: "text", text: "。" }
        ]
      }
    ]);
  });

  test("keeps html, links, and images as plain text", () => {
    expect(
      parseReadingAssistantMarkdownLite(
        "<img src=x onerror=alert(1)>\n[链接](javascript:alert(1))\n![图](https://example.com/a.png)"
      )
    ).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "<img src=x onerror=alert(1)>\n[链接](javascript:alert(1))\n![图](https://example.com/a.png)"
          }
        ]
      }
    ]);
  });

  test("truncates very long input with a plain text suffix", () => {
    const blocks = parseReadingAssistantMarkdownLite("甲".repeat(6_100));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    if (blocks[0].type === "paragraph") {
      expect(blocks[0].children[0]).toEqual({
        type: "text",
        text: `${"甲".repeat(6_000)}\n...`
      });
    }
  });

  test("limits block count and list item count", () => {
    const paragraphBlocks = parseReadingAssistantMarkdownLite(
      Array.from({ length: 100 }, (_, index) => `段落 ${index + 1}`).join("\n\n")
    );
    expect(paragraphBlocks).toHaveLength(80);

    const listBlocks = parseReadingAssistantMarkdownLite(
      Array.from({ length: 130 }, (_, index) => `${index + 1}. 条目 ${index + 1}`).join("\n")
    );
    expect(listBlocks).toHaveLength(1);
    expect(listBlocks[0]).toMatchObject({ type: "list", ordered: true });
    if (listBlocks[0].type === "list") {
      expect(listBlocks[0].items).toHaveLength(120);
    }
  });

  test("keeps remaining inline text after inline node limit", () => {
    const blocks = parseReadingAssistantMarkdownLite(
      `${Array.from({ length: 240 }, (_, index) => `**重点${index + 1}**`).join("")}尾部内容`
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    if (blocks[0].type === "paragraph") {
      expect(blocks[0].children).toHaveLength(241);
      expect(blocks[0].children[blocks[0].children.length - 1]).toEqual({
        type: "text",
        text: "尾部内容"
      });
    }
  });
});
