import { describe, expect, it } from "vitest";
import { buildLocalReaderMarkdownExport } from "./local-reader-markdown";
import type {
  LocalReaderAiQuestionDraft,
  LocalReaderAiQuestionRecord
} from "./local-reader-ai-drafts";
import type { LocalReaderHighlight } from "./local-reader-highlights";
import type { LocalReaderThought } from "./local-reader-thoughts";
import type { LocalBook, LocalReadingProgress } from "./local-reader-types";

const book: LocalBook = {
  id: "local-book-1",
  source: "local",
  title: "小王子: 本地版",
  author: "圣埃克苏佩里",
  format: "txt",
  fileHash: "hash-local-book",
  fileSize: 1024,
  storagePath: "books/local.txt",
  importedAt: "2026-05-27T08:00:00.000Z",
  updatedAt: "2026-05-27T08:00:00.000Z"
};

const progress: LocalReadingProgress = {
  bookId: book.id,
  locator: "text:120:1000",
  progressPercent: 42,
  readTimeSeconds: 0,
  updatedAt: "2026-05-27T09:00:00.000Z"
};

const highlight: LocalReaderHighlight = {
  id: "highlight-1",
  bookId: book.id,
  text: "阅读器应该安静、轻便。",
  startOffset: 10,
  endOffset: 22,
  tone: "yellow",
  createdAt: "2026-05-27T10:00:00.000Z"
};

const greenHighlight: LocalReaderHighlight = {
  ...highlight,
  id: "highlight-2",
  text: "这段内容需要后续整理。",
  startOffset: 30,
  endOffset: 42,
  tone: "green"
};

const blueHighlight: LocalReaderHighlight = {
  ...highlight,
  id: "highlight-3",
  text: "这里还有疑问。",
  startOffset: 50,
  endOffset: 58,
  tone: "blue"
};

const thought: LocalReaderThought = {
  id: "thought-1",
  bookId: book.id,
  selectedText: "本地阅读的价值，不是替代微信读书。",
  note: "这里要强调本地资产边界。",
  startOffset: 80,
  endOffset: 100,
  createdAt: "2026-05-27T11:00:00.000Z"
};

const aiQuestionDraft: LocalReaderAiQuestionDraft = {
  bookId: book.id,
  question: "这段话的设计原则是什么？",
  selectedText: "阅读器应该安静、轻便。",
  startOffset: 10,
  endOffset: 22,
  createdAt: "2026-05-27T11:30:00.000Z"
};

const aiQuestionRecord: LocalReaderAiQuestionRecord = {
  ...aiQuestionDraft,
  id: "ai-record-1",
  source: "local",
  status: "answered",
  updatedAt: "2026-05-27T11:31:00.000Z",
  answer: {
    answer: "这段话强调阅读器要围绕正文和用户主动选区，不读取整本书。",
    keyPoints: ["正文优先", "基于选区", "不读取整本书"],
    followUpQuestions: ["如何继续收纳 AI 提问？"],
    generatedAt: "2026-05-27T11:31:00.000Z",
    promptVersion: "local-reader-selection-qa@1",
    basisNotice: "基于用户主动选择的文本"
  }
};

const aiQuestionRecordWithThread: LocalReaderAiQuestionRecord = {
  ...aiQuestionRecord,
  updatedAt: "2026-05-27T11:35:00.000Z",
  thread: [
    {
      id: "turn-1",
      question: "这个原则会如何影响追问入口？",
      status: "answered",
      createdAt: "2026-05-27T11:34:00.000Z",
      updatedAt: "2026-05-27T11:35:00.000Z",
      answer: {
        answer: "追问应归入同一条 AI 提问记录，而不是生成新的顶层卡片。",
        keyPoints: [],
        followUpQuestions: [],
        generatedAt: "2026-05-27T11:35:00.000Z",
        promptVersion: "local-reader-selection-qa@1",
        basisNotice: "基于用户主动选择的文本"
      }
    }
  ]
};

describe("local-reader-markdown", () => {
  it("导出本地划线和想法 Markdown，并保留本地来源边界", () => {
    const result = buildLocalReaderMarkdownExport({
      book,
      highlights: [highlight],
      thoughts: [thought],
      aiQuestionRecords: [aiQuestionRecord],
      progress,
      exportedAt: "2026-05-27T12:00:00.000Z"
    });

    expect(result.fileName).toBe("小王子--本地版-本地标记.md");
    expect(result.markdown).toContain("source: local-reader");
    expect(result.markdown).toContain("source_kind: local");
    expect(result.markdown).toContain("# 小王子: 本地版");
    expect(result.markdown).toContain("- 数据边界：仅包含本地阅读器划线、想法和 AI 提问记录，不读取微信读书笔记，不触发 AI。");
    expect(result.markdown).toContain("## 划线");
    expect(result.markdown).toContain("> 阅读器应该安静、轻便。");
    expect(result.markdown).toContain("## 想法");
    expect(result.markdown).toContain("> 本地阅读的价值，不是替代微信读书。");
    expect(result.markdown).toContain("这里要强调本地资产边界。");
    expect(result.markdown).toContain("## AI 提问记录");
    expect(result.markdown).toContain("这段话的设计原则是什么？");
    expect(result.markdown).toContain("这段话强调阅读器要围绕正文和用户主动选区");
    expect(result.markdown).toContain("基于用户主动选择的文本");
    expect(result.markdown).toContain("- 阅读进度：42%");
  });

  it("导出时保留划线、标记和疑问的类型语义", () => {
    const result = buildLocalReaderMarkdownExport({
      book,
      highlights: [highlight, greenHighlight, blueHighlight],
      thoughts: [],
      progress,
      exportedAt: "2026-05-27T12:00:00.000Z"
    });

    expect(result.markdown).toContain("### 1. 划线");
    expect(result.markdown).toContain("### 2. 标记");
    expect(result.markdown).toContain("### 3. 疑问");
    expect(result.markdown).toContain("> 这段内容需要后续整理。");
    expect(result.markdown).toContain("> 这里还有疑问。");
  });

  it("只有 AI 提问记录时仍可导出，并保留空划线和空想法占位", () => {
    const result = buildLocalReaderMarkdownExport({
      book,
      highlights: [],
      thoughts: [],
      aiQuestionRecords: [aiQuestionRecord],
      progress,
      exportedAt: "2026-05-27T12:00:00.000Z"
    });

    expect(result.markdown).toContain("## 划线");
    expect(result.markdown).toContain("暂无本地划线。");
    expect(result.markdown).toContain("## 想法");
    expect(result.markdown).toContain("暂无本地想法。");
    expect(result.markdown).toContain("## AI 提问记录");
    expect(result.markdown).toContain("这段话的设计原则是什么？");
    expect(result.markdown).toContain("仅导出本地 AI 提问记录，不读取微信读书笔记，不触发新的 AI 请求。");
    expect(result.markdown).not.toContain("微信读书 note id");
  });

  it("导出 AI 提问记录时保留同一记录下的追问线程", () => {
    const result = buildLocalReaderMarkdownExport({
      book,
      highlights: [],
      thoughts: [],
      aiQuestionRecords: [aiQuestionRecordWithThread],
      progress,
      exportedAt: "2026-05-27T12:00:00.000Z"
    });

    expect(result.markdown).toContain("**追问线程**");
    expect(result.markdown).toContain("#### 追问 1. 已回答");
    expect(result.markdown).toContain("这个原则会如何影响追问入口？");
    expect(result.markdown).toContain("追问应归入同一条 AI 提问记录");
    expect(result.markdown).not.toContain("## 想法\n\n这个原则会如何影响追问入口？");
  });

  it("转义 front matter 中的标题和作者特殊字符", () => {
    const result = buildLocalReaderMarkdownExport({
      book: {
        ...book,
        title: "标题: \"带换行\"\n本地版",
        author: "作者: A\nB"
      },
      highlights: [],
      thoughts: [],
      progress,
      exportedAt: "2026-05-27T12:00:00.000Z"
    });

    expect(result.fileName).toBe("标题---带换行--本地版-本地标记.md");
    expect(result.markdown).toContain('title: "标题: \\"带换行\\"\\n本地版"');
    expect(result.markdown).toContain('author: "作者: A\\nB"');
  });
});
