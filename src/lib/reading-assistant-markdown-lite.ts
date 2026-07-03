export type ReadingAssistantMarkdownInline =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "strong";
      children: ReadingAssistantMarkdownInline[];
    }
  | {
      type: "code";
      text: string;
    };

export type ReadingAssistantMarkdownBlock =
  | {
      type: "paragraph";
      children: ReadingAssistantMarkdownInline[];
    }
  | {
      type: "list";
      ordered: boolean;
      items: ReadingAssistantMarkdownInline[][];
    };

type ListLine = {
  ordered: boolean;
  content: string;
};

const MAX_INPUT_LENGTH = 6_000;
const MAX_BLOCKS = 80;
const MAX_LIST_ITEMS = 120;
const MAX_INLINE_NODES = 240;
const MAX_INLINE_DEPTH = 2;
const LIST_LINE_PATTERN = /^\s*(?:(\d+)[.)]|[-*])\s+(.+)$/;
const TRUNCATED_SUFFIX = "\n...";

export function parseReadingAssistantMarkdownLite(
  value: string
): ReadingAssistantMarkdownBlock[] {
  const blocks: ReadingAssistantMarkdownBlock[] = [];
  const paragraphLines: string[] = [];
  const normalizedValue = normalizeInput(value);
  let activeList: { ordered: boolean; items: ReadingAssistantMarkdownInline[][] } | undefined;

  function pushBlock(block: ReadingAssistantMarkdownBlock) {
    if (blocks.length < MAX_BLOCKS) {
      blocks.push(block);
    }
  }

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }

    pushBlock({
      type: "paragraph",
      children: parseInlineMarkdown(paragraphLines.join("\n"))
    });
    paragraphLines.length = 0;
  }

  function flushList() {
    if (!activeList) {
      return;
    }

    pushBlock({
      type: "list",
      ordered: activeList.ordered,
      items: activeList.items
    });
    activeList = undefined;
  }

  normalizedValue.split(/\r?\n/).forEach((line) => {
    if (blocks.length >= MAX_BLOCKS) {
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const listLine = parseListLine(line);
    if (!listLine) {
      flushList();
      paragraphLines.push(line);
      return;
    }

    flushParagraph();
    if (!activeList || activeList.ordered !== listLine.ordered) {
      flushList();
      activeList = { ordered: listLine.ordered, items: [] };
    }
    if (activeList.items.length < MAX_LIST_ITEMS) {
      activeList.items.push(parseInlineMarkdown(listLine.content));
    }
  });

  flushParagraph();
  flushList();

  return blocks;
}

function normalizeInput(value: string): string {
  if (value.length <= MAX_INPUT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_INPUT_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function parseListLine(line: string): ListLine | undefined {
  const match = line.match(LIST_LINE_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    ordered: Boolean(match[1]),
    content: match[2].trim()
  };
}

function parseInlineMarkdown(value: string, depth = 0): ReadingAssistantMarkdownInline[] {
  const nodes: ReadingAssistantMarkdownInline[] = [];
  let cursor = 0;

  function pushText(text: string) {
    if (!text) {
      return;
    }

    const lastNode = nodes[nodes.length - 1];
    if (lastNode?.type === "text") {
      lastNode.text += text;
      return;
    }

    nodes.push({ type: "text", text });
  }

  while (cursor < value.length) {
    if (nodes.length >= MAX_INLINE_NODES) {
      const lastNode = nodes[nodes.length - 1];
      if (lastNode?.type === "text") {
        lastNode.text += value.slice(cursor);
      } else {
        nodes.push({ type: "text", text: value.slice(cursor) });
      }
      break;
    }

    if (value[cursor] === "`") {
      const end = value.indexOf("`", cursor + 1);
      if (end > cursor + 1) {
        nodes.push({ type: "code", text: value.slice(cursor + 1, end) });
        cursor = end + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && value.startsWith("**", cursor)) {
      const end = value.indexOf("**", cursor + 2);
      if (end > cursor + 2) {
        nodes.push({
          type: "strong",
          children: parseInlineMarkdown(value.slice(cursor + 2, end), depth + 1)
        });
        cursor = end + 2;
        continue;
      }
    }

    pushText(value[cursor]);
    cursor += 1;
  }

  return nodes;
}
