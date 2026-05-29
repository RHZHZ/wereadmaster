import { describe, expect, it } from "vitest";
import {
  clearLocalReaderAiQuestionDraft,
  createLocalReaderAiQuestionDraft,
  createLocalReaderAiQuestionRecord,
  createLocalReaderAiQuestionThreadTurn,
  readLocalReaderAiQuestionDraft,
  readLocalReaderAiQuestionRecords,
  removeLocalReaderAiQuestionRecord,
  upsertLocalReaderAiQuestionRecord,
  upsertLocalReaderAiQuestionThreadTurn,
  writeLocalReaderAiQuestionRecords,
  writeLocalReaderAiQuestionDraft
} from "./local-reader-ai-drafts";

describe("local reader AI question drafts", () => {
  it("reads and writes AI drafts scoped by local book id", () => {
    const storage = createMemoryStorage();
    const draft = createLocalReaderAiQuestionDraft({
      bookId: "local:demo",
      question: "这段话的核心是什么？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "100"
    });

    writeLocalReaderAiQuestionDraft(storage, "local:demo", draft);

    expect(readLocalReaderAiQuestionDraft(storage, "local:demo")).toEqual(draft);
    expect(readLocalReaderAiQuestionDraft(storage, "local:other")).toBeUndefined();

    clearLocalReaderAiQuestionDraft(storage, "local:demo");
    expect(readLocalReaderAiQuestionDraft(storage, "local:demo")).toBeUndefined();
  });

  it("normalizes malformed AI draft records", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionDraft.v1:local%3Ademo": JSON.stringify({
        bookId: "local:demo",
        question: "",
        selectedText: "选中文本",
        startOffset: 1,
        endOffset: 5,
        createdAt: "100"
      })
    });

    expect(readLocalReaderAiQuestionDraft(storage, "local:demo")).toBeUndefined();
  });

  it("falls back to no draft for malformed storage", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionDraft.v1:local%3Ademo": "{"
    });

    expect(readLocalReaderAiQuestionDraft(storage, "local:demo")).toBeUndefined();
  });

  it("reads and writes AI question records scoped by local book id", () => {
    const storage = createMemoryStorage();
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "这段话的核心是什么？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z"
    });

    writeLocalReaderAiQuestionRecords(storage, "local:demo", [record]);

    expect(readLocalReaderAiQuestionRecords(storage, "local:demo")).toEqual([record]);
    expect(readLocalReaderAiQuestionRecords(storage, "local:other")).toEqual([]);
  });

  it("migrates a legacy draft into the records list when no list exists", () => {
    const draft = createLocalReaderAiQuestionDraft({
      bookId: "local:demo",
      question: "旧草稿还在吗？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z"
    });
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionDraft.v1:local%3Ademo": JSON.stringify(draft)
    });

    const records = readLocalReaderAiQuestionRecords(storage, "local:demo");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      bookId: "local:demo",
      source: "local",
      status: "draft",
      question: "旧草稿还在吗？",
      selectedText: "选中文本"
    });
  });

  it("falls back to a legacy draft when the records list is malformed", () => {
    const draft = createLocalReaderAiQuestionDraft({
      bookId: "local:demo",
      question: "记录列表坏了还能找回吗？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z"
    });
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionRecords.v1:local%3Ademo": "{",
      "wxreadmaster.localReader.aiQuestionDraft.v1:local%3Ademo": JSON.stringify(draft)
    });

    const records = readLocalReaderAiQuestionRecords(storage, "local:demo");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      bookId: "local:demo",
      source: "local",
      status: "draft",
      question: "记录列表坏了还能找回吗？"
    });
  });

  it("prefers an existing records list over a legacy draft", () => {
    const draft = createLocalReaderAiQuestionDraft({
      bookId: "local:demo",
      question: "旧草稿不应重复出现",
      selectedText: "旧选中文本",
      startOffset: 1,
      endOffset: 5,
      now: "2026-05-27T11:00:00.000Z"
    });
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "新记录优先",
      selectedText: "新选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z",
      id: "record-1"
    });
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionRecords.v1:local%3Ademo": JSON.stringify([record]),
      "wxreadmaster.localReader.aiQuestionDraft.v1:local%3Ademo": JSON.stringify(draft)
    });

    expect(readLocalReaderAiQuestionRecords(storage, "local:demo")).toEqual([record]);
  });

  it("upserts and removes AI question records by id", () => {
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "先保存什么？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z",
      id: "record-1"
    });
    const answered = {
      ...record,
      status: "answered" as const,
      answer: {
        answer: "只回答这段选区。",
        keyPoints: ["不读取整本书"],
        followUpQuestions: ["还能怎么追问？"],
        generatedAt: "2026-05-27T12:01:00.000Z",
        promptVersion: "local-reader-selection-qa@1",
        basisNotice: "基于用户选区"
      }
    };

    const upserted = upsertLocalReaderAiQuestionRecord([record], "local:demo", answered);

    expect(upserted).toHaveLength(1);
    expect(upserted[0].status).toBe("answered");
    expect(removeLocalReaderAiQuestionRecord(upserted, "record-1")).toEqual([]);
  });

  it("does not preserve answered status when the stored answer is malformed", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionRecords.v1:local%3Ademo": JSON.stringify([
        {
          id: "record-1",
          bookId: "local:demo",
          source: "local",
          status: "answered",
          question: "这段话是什么意思？",
          selectedText: "选中文本",
          startOffset: 2,
          endOffset: 6,
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:01:00.000Z",
          answer: {
            answer: "",
            generatedAt: "2026-05-27T12:01:00.000Z",
            promptVersion: "local-reader-selection-qa@1",
            basisNotice: "基于用户选区"
          }
        }
      ])
    });

    const [record] = readLocalReaderAiQuestionRecords(storage, "local:demo");

    expect(record?.id).toBe("record-1");
    expect(record?.status).toBe("draft");
    expect(record?.answer).toBeUndefined();
  });

  it("upserts follow-up turns inside the same AI question record", () => {
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "这段话的核心是什么？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z",
      id: "record-1"
    });
    const turn = createLocalReaderAiQuestionThreadTurn({
      id: "turn-1",
      question: "可以再解释一个例子吗？",
      now: "2026-05-27T12:02:00.000Z"
    });

    const withTurn = upsertLocalReaderAiQuestionThreadTurn(
      [record],
      "local:demo",
      "record-1",
      turn
    );

    expect(withTurn).toHaveLength(1);
    expect(withTurn[0].thread).toEqual([turn]);
    expect(withTurn[0].updatedAt).toBe("2026-05-27T12:02:00.000Z");

    const answeredTurn = {
      ...turn,
      status: "answered" as const,
      updatedAt: "2026-05-27T12:03:00.000Z",
      answer: {
        answer: "追问回答仍然只属于当前选区。",
        keyPoints: [],
        followUpQuestions: [],
        generatedAt: "2026-05-27T12:03:00.000Z",
        promptVersion: "local-reader-selection-qa@1",
        basisNotice: "基于用户选区"
      }
    };
    const updated = upsertLocalReaderAiQuestionThreadTurn(
      withTurn,
      "local:demo",
      "record-1",
      answeredTurn
    );

    expect(updated).toHaveLength(1);
    expect(updated[0].thread).toHaveLength(1);
    expect(updated[0].thread?.[0].status).toBe("answered");
    expect(updated[0].thread?.[0].answer?.answer).toBe("追问回答仍然只属于当前选区。");
    expect(updated[0].updatedAt).toBe("2026-05-27T12:03:00.000Z");
  });

  it("normalizes malformed AI question thread turns", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.aiQuestionRecords.v1:local%3Ademo": JSON.stringify([
        {
          id: "record-1",
          bookId: "local:demo",
          source: "local",
          status: "draft",
          question: "这段话是什么意思？",
          selectedText: "选中文本",
          startOffset: 2,
          endOffset: 6,
          createdAt: "2026-05-27T12:00:00.000Z",
          updatedAt: "2026-05-27T12:01:00.000Z",
          thread: [
            {
              id: "bad-turn",
              question: "",
              status: "draft",
              createdAt: "2026-05-27T12:02:00.000Z"
            },
            {
              id: "turn-1",
              question: "追问回答损坏时怎么办？",
              status: "answered",
              createdAt: "2026-05-27T12:03:00.000Z",
              updatedAt: "2026-05-27T12:04:00.000Z",
              answer: {
                answer: "",
                generatedAt: "2026-05-27T12:04:00.000Z",
                promptVersion: "local-reader-selection-qa@1",
                basisNotice: "基于用户选区"
              }
            }
          ]
        }
      ])
    });

    const [record] = readLocalReaderAiQuestionRecords(storage, "local:demo");

    expect(record?.thread).toHaveLength(1);
    expect(record.thread?.[0]).toMatchObject({
      id: "turn-1",
      question: "追问回答损坏时怎么办？",
      status: "draft"
    });
    expect(record.thread?.[0].answer).toBeUndefined();
  });

  it("limits AI question thread turns to the latest entries", () => {
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "这段话的核心是什么？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z",
      id: "record-1"
    });
    const turns = Array.from({ length: 14 }, (_, index) =>
      createLocalReaderAiQuestionThreadTurn({
        id: `turn-${index + 1}`,
        question: `追问 ${index + 1}`,
        now: `2026-05-27T12:${String(index + 1).padStart(2, "0")}:00.000Z`
      })
    );

    const [normalized] = writeLocalReaderAiQuestionRecords(undefined, "local:demo", [
      { ...record, thread: turns }
    ]);

    expect(normalized?.thread).toHaveLength(12);
    expect(normalized.thread?.[0].question).toBe("追问 3");
    expect(normalized.thread?.[11].question).toBe("追问 14");
  });

  it("limits AI answer list counts and item length", () => {
    const longItem = "a".repeat(620);
    const record = createLocalReaderAiQuestionRecord({
      bookId: "local:demo",
      question: "可以总结一下吗？",
      selectedText: "选中文本",
      startOffset: 2,
      endOffset: 6,
      now: "2026-05-27T12:00:00.000Z",
      id: "record-1",
      status: "answered",
      answer: {
        answer: "只回答这段选区。",
        keyPoints: Array.from({ length: 10 }, () => longItem),
        followUpQuestions: Array.from({ length: 8 }, () => longItem),
        generatedAt: "2026-05-27T12:01:00.000Z",
        promptVersion: "local-reader-selection-qa@1",
        basisNotice: "基于用户选区"
      }
    });

    const [normalized] = writeLocalReaderAiQuestionRecords(undefined, "local:demo", [record]);

    expect(normalized?.answer?.keyPoints).toHaveLength(8);
    expect(normalized?.answer?.followUpQuestions).toHaveLength(6);
    expect(normalized?.answer?.keyPoints[0]).toHaveLength(500);
    expect(normalized?.answer?.followUpQuestions[0]).toHaveLength(500);
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    }
  };
}
