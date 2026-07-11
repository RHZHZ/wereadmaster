import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import {
  clearAiOutputCache,
  checkForAppUpdate,
  chooseCustomExportDirectory,
  exportReportImage,
  getAiSettingsState,
  getAiReviewFeedback,
  getAIAssetVersionDetail,
  getAIAssetVersionHistory,
  askReadingAssistant,
  getBestBookmarks,
  getBookDetail,
  getBookshelf,
  getCommandErrorInfo,
  getCredentialStatus,
  getLatestReadingStatsReview,
  getNotebookOverview,
  getPublicReviews,
  getReadReviews,
  getReadingAssistantThread,
  getReadingAssistantPreferences,
  askReadingAssistantStream,
  cancelReadingAssistantStream,
  listenReadingAssistantStream,
  getReadingStats,
  getSettingsState,
  listReadingAssistantThreads,
  listAiProviderModels,
  listReadingItemStates,
  probeAiProviderCapabilities,
  resetCustomExportDirectory,
  resetWereadProxyUrl,
  saveAiSettings,
  saveAiReviewFeedback,
  saveCustomExportDirectory,
  saveWereadProxyUrl,
  searchBooks,
  summarizeBookNotes,
  summarizeReadingRoute,
  syncShelf,
  testAiConnection,
  validateAiCredential,
  getCommandErrorMessage
} from "./reading-api";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const checkMock = vi.mocked(check);

describe("settings export directory API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    checkMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("maps export location from settings state", async () => {
    invokeMock.mockResolvedValue({
      credential: { hasCredential: true },
      credentialError: {
        code: "credential_storage_error",
        message: "本地凭据存储暂时不可用，请稍后重试。",
        detail: "mock storage failure"
      },
      syncStates: [],
        localData: {
          dataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          defaultDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          databasePath: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/reading-cache.sqlite3",
          databaseSizeBytes: 1024,
          cacheRowCount: 2,
          isCustomDataDir: false,
          lastDataOperationError: "迁移失败：目标目录不可写",
          tableCounts: []
        },
      exportData: {
        exportDir: "D:/ReadingExports",
        defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
        isCustomExportDir: true
      },
      network: {
        wereadProxyUrl: "http://127.0.0.1:7890",
        isCustomWereadProxy: true
      },
      appVersion: "0.1.0",
      supportsNativeUpdater: true
    });

    const state = await getSettingsState();

    expect(state.exportData).toEqual({
      exportDir: "D:/ReadingExports",
      defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
      isCustomExportDir: true
    });
    expect(state.network).toEqual({
      wereadProxyUrl: "http://127.0.0.1:7890",
      isCustomWereadProxy: true
    });
    expect(state.localData.lastDataOperationError).toBe("迁移失败：目标目录不可写");
    expect(state.credentialError).toEqual({
      code: "credential_storage_error",
      message: "本地凭据存储暂时不可用，请稍后重试。",
      detail: "mock storage failure"
    });
  });

  test("includes command diagnostic detail when available", () => {
    expect(
      getCommandErrorMessage({
        code: "gateway_network_error",
        message: "微信读书接口暂时无法连接，请稍后重试。",
        detail: "error sending request for url (https://i.weread.qq.com/api/agent/gateway): operation timed out"
      })
    ).toBe(
      "微信读书接口暂时无法连接，请稍后重试。 诊断：error sending request for url (https://i.weread.qq.com/api/agent/gateway): operation timed out"
    );
  });

  test("keeps upgrade-required command errors structured", () => {
    expect(
      getCommandErrorInfo({
        code: "upgrade_required",
        message: "微信读书 Skill 需要升级。",
        detail: "请替换 SKILL.md 后重试。"
      })
    ).toEqual({
      code: "upgrade_required",
      message: "微信读书 Skill 需要升级。",
      detail: "请替换 SKILL.md 后重试。"
    });
  });

  test("reading assistant asks through Tauri with the request payload", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "bookDetail" as const,
      entityId: "book_1",
      message: "这本书我现在该怎么读？",
      enabledContext: ["currentBook" as const, "bookNotesSummary" as const]
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "先围绕当前进度读 30 分钟。",
      suggestions: ["帮我制定 30 分钟阅读计划"],
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1",
      providerModel: "gpt-4o-mini",
      basisNotice: "基于当前书籍上下文回答。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      threadId: "thread_1",
      answer: "先围绕当前进度读 30 分钟。",
      recommendedBooks: []
    });
    expect(invokeMock).toHaveBeenCalledWith("ask_reading_assistant", { request });
  });

  test("reading assistant maps structured recommended books", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "global" as const,
      message: "推荐 3 本可加入候选书架的新书",
      enabledContext: ["readingStats" as const, "readingPersona" as const]
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "基于你的阅读画像，建议先看这几本。",
      suggestions: [],
      recommendedBooks: [
        {
          title: "可能性的艺术",
          author: "作者甲",
          reason: "延续你关注的成长主题。",
          fit: "适合继续追问选择和行动。",
          risk: "理论密度可能偏高。"
        },
        {
          author: "作者乙",
          reason: "缺少标题的项应被过滤。",
          fit: "无",
          risk: "无"
        }
      ],
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: "gpt-4o-mini",
      basisNotice: "基于当前阅读画像回答。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      recommendedBooks: [
        {
          title: "可能性的艺术",
          author: "作者甲",
          reason: "延续你关注的成长主题。",
          fit: "适合继续追问选择和行动。",
          risk: "理论密度可能偏高。"
        }
      ]
    });
  });

  test("reading assistant maps weread search action output", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "global" as const,
      message: "帮我确认《显微镜下的大明》在微信读书是否可以找到",
      enabledContext: []
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "我在微信读书搜索到 1 个《显微镜下的大明》相关结果。",
      suggestions: [],
      recommendedBooks: [],
      action: {
        type: "wereadSearch",
        payload: {
          keyword: "显微镜下的大明",
          status: "found",
          message: "搜索到 1 个可能匹配项。",
          results: [
            {
              bookId: "book_1",
              title: "显微镜下的大明",
              author: "马伯庸",
              category: "历史",
              localStatus: "inLibrary",
              localLabel: "已读完",
              canAddToCandidate: false
            },
            {
              bookId: "",
              title: "缺少 ID 的结果"
            }
          ]
        }
      },
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: null,
      basisNotice: "基于微信读书搜索结果返回。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      action: {
        type: "wereadSearch",
        payload: {
          keyword: "显微镜下的大明",
          results: [
            {
              bookId: "book_1",
              title: "显微镜下的大明",
              localStatus: "inLibrary",
              localLabel: "已读完",
              canAddToCandidate: false
            }
          ]
        }
      }
    });
  });

  test("reading assistant maps stats aggregate action output", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "readingStats" as const,
      message: "总计历史记录呢",
      enabledContext: []
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "当前可验证口径为全部本地缓存。",
      suggestions: [],
      recommendedBooks: [],
      action: {
        type: "statsAggregate",
        payload: {
          rangeLabel: "全部本地缓存",
          dataStatus: "complete",
          message: "累计阅读 70小时50分钟。",
          totalReadingTimeText: "70小时50分钟",
          readDays: 71,
          shelfBookCount: 498,
          finishedBookCount: 3,
          readingBookCount: 495,
          candidateBookCount: 3,
          updatedAt: "200",
          topCategories: [
            {
              title: "经济理财",
              readingTimeText: "3小时28分钟",
              readingCount: 4
            },
            {
              readingTimeText: "缺少标题的分类应被过滤"
            }
          ]
        }
      },
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: null,
      basisNotice: "基于本地统计。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      action: {
        type: "statsAggregate",
        payload: {
          rangeLabel: "全部本地缓存",
          totalReadingTimeText: "70小时50分钟",
          readDays: 71,
          topCategories: [
            {
              title: "经济理财",
              readingTimeText: "3小时28分钟",
              readingCount: 4
            }
          ]
        }
      }
    });
  });

  test("reading assistant maps category books action output", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "readingStats" as const,
      message: "我读过哪些理财类书籍",
      enabledContext: []
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "统计缓存显示经济理财 4 本；当前本地可验证到 1 本。",
      suggestions: [],
      recommendedBooks: [],
      action: {
        type: "categoryBooks",
        payload: {
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 4,
          totalStatReadingTimeText: "3小时28分钟",
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book_money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              readingTimeText: "1小时",
              source: "书架"
            },
            {
              bookId: "",
              title: "缺少 ID 的项应被过滤"
            }
          ]
        }
      },
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: null,
      basisNotice: "基于本地统计。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      action: {
        type: "categoryBooks",
        payload: {
          categoryLabel: "经济理财",
          queryStatus: "partial",
          totalStatCount: 4,
          listedCount: 1,
          books: [
            {
              bookId: "book_money",
              title: "小狗钱钱",
              isFinished: true,
              source: "书架"
            }
          ]
        }
      }
    });
  });

  test("reading assistant maps book review action output", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "bookNotes" as const,
      entityId: "book_1",
      message: "基于我的笔记总结重点",
      enabledContext: ["currentBook" as const, "rawBookNotes" as const]
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "这些重点适合进入单本 AI 复盘。",
      suggestions: [],
      recommendedBooks: [],
      action: {
        type: "bookReview",
        payload: {
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          author: "罗伯特·清崎",
          message: "这类笔记总结应进入单本 AI 复盘，不走阅读指南。",
          ctaLabel: "生成 AI 复盘"
        }
      },
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: "gpt-4o-mini",
      basisNotice: "基于当前书籍笔记上下文回答。"
    });

    await expect(askReadingAssistant(request)).resolves.toMatchObject({
      action: {
        type: "bookReview",
        payload: {
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          author: "罗伯特·清崎",
          ctaLabel: "生成 AI 复盘"
        }
      }
    });
  });

  test("reading assistant stream invokes Tauri with stream id", async () => {
    vi.stubGlobal("__TAURI__", {});
    const request = {
      scope: "global" as const,
      message: "我最近适合读什么主题？",
      enabledContext: ["readingStats" as const]
    };
    invokeMock.mockResolvedValue({
      threadId: "thread_1",
      messageId: "msg_1",
      answer: "可以先围绕注意力和长期主义读。",
      suggestions: ["帮我列一个两周计划"],
      recommendedBooks: [],
      usedContext: [],
      generatedAt: "100",
      promptVersion: "reading-assistant-chat-v1.3",
      providerModel: "gpt-4o-mini",
      basisNotice: "基于当前阅读统计回答。"
    });

    await expect(askReadingAssistantStream("stream_1", request)).resolves.toMatchObject({
      threadId: "thread_1",
      answer: "可以先围绕注意力和长期主义读。"
    });
    expect(invokeMock).toHaveBeenCalledWith("ask_reading_assistant_stream", {
      request: {
        streamId: "stream_1",
        request
      }
    });
  });

  test("reading assistant stream listener maps event payload", async () => {
    const unlisten = vi.fn();
    const handler = vi.fn();
    listenMock.mockImplementation(async (_event, callback) => {
      callback({
        payload: {
          streamId: "stream_1",
          delta: "可以",
          content: "可以"
        }
      } as Parameters<typeof callback>[0]);
      return unlisten;
    });

    await expect(listenReadingAssistantStream(handler)).resolves.toBe(unlisten);
    expect(listenMock).toHaveBeenCalledWith(
      "reading-assistant-stream",
      expect.any(Function)
    );
    expect(handler).toHaveBeenCalledWith({
      streamId: "stream_1",
      delta: "可以",
      content: "可以"
    });
  });

  test("reading assistant stream cancel invokes Tauri with stream id", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue(undefined);

    await expect(cancelReadingAssistantStream("stream_1")).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("cancel_reading_assistant_stream", {
      streamId: "stream_1"
    });
  });

  test("reading assistant thread restores structured message output", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue({
      id: "thread_1",
      scope: "global",
      title: "推荐下一本书",
      contextSummary: {},
      createdAt: "100",
      updatedAt: "101",
      messages: [
        {
          id: "msg_1",
          role: "assistant",
          content: "基于你的阅读画像，建议先看这本。",
          status: "answered",
          usedContext: [],
          output: {
            suggestions: ["帮我比较前两本"],
            recommendedBooks: [
              {
                title: "可能性的艺术",
                author: "作者甲",
                reason: "延续成长主题。",
                fit: "适合继续追问选择和行动。",
                risk: "理论密度可能偏高。"
              },
              {
                author: "作者乙",
                reason: "缺少标题的项应被过滤。"
              }
            ],
            basisNotice: "基于当前阅读画像回答。",
            action: {
              type: "bookReview",
              payload: {
                bookId: "book_1",
                title: "富爸爸穷爸爸",
                author: "罗伯特·清崎",
                message: "这类笔记总结应进入单本 AI 复盘，不走阅读指南。",
                ctaLabel: "生成 AI 复盘"
              }
            }
          },
          createdAt: "101"
        }
      ]
    });

    await expect(getReadingAssistantThread("thread_1")).resolves.toMatchObject({
      id: "thread_1",
      messages: [
        {
          output: {
            suggestions: ["帮我比较前两本"],
            recommendedBooks: [
              {
                title: "可能性的艺术",
                author: "作者甲"
              }
            ],
            basisNotice: "基于当前阅读画像回答。",
            action: {
              type: "bookReview",
              payload: {
                bookId: "book_1",
                title: "富爸爸穷爸爸",
                ctaLabel: "生成 AI 复盘"
              }
            }
          }
        }
      ]
    });
    expect(invokeMock).toHaveBeenCalledWith("get_reading_assistant_thread", {
      threadId: "thread_1"
    });
  });

  test("reading assistant web preview does not fabricate answers", async () => {
    await expect(
      askReadingAssistant({
        scope: "global",
        message: "推荐下一本书",
        enabledContext: []
      })
    ).rejects.toThrow("AI 阅读助手需要在桌面应用中使用。");
    await expect(getReadingAssistantPreferences()).resolves.toEqual({
      usePersonalizedContext: true,
      useReadingMemory: true,
      allowRawBookNotes: false,
      saveConversationHistory: true
    });
    await expect(listReadingAssistantThreads()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("book detail keeps returned deep link but does not fabricate fallback", async () => {
    invokeMock
      .mockResolvedValueOnce({
        detail: { bookId: "b1", title: "书名" },
        progress: { bookId: "b1", progressPercent: 1 },
        chapters: [],
        deepLink: "weread://book/from-api"
      })
      .mockResolvedValueOnce({
        detail: { bookId: "b2", title: "无链接" },
        progress: { bookId: "b2", progressPercent: 0 },
        chapters: []
      });

    await expect(getBookDetail("b1")).resolves.toMatchObject({
      deepLink: "weread://book/from-api"
    });
    await expect(getBookDetail("b2")).resolves.toMatchObject({
      deepLink: ""
    });
  });

  test("search results preserve API deep links when present", async () => {
    invokeMock.mockResolvedValue({
      result: {
        scope: 10,
        groups: [
          {
            title: "电子书",
            books: [
              {
                bookId: "b1",
                title: "书名",
                deepLink: "weread://book/search-result"
              }
            ]
          }
        ]
      }
    });

    const response = await searchBooks({ keyword: "书名", scope: 10 });

    expect(response.result.results[0]?.deepLink).toBe("weread://book/search-result");
    expect(response.result.groups[0]?.books[0]?.deepLink).toBe("weread://book/search-result");
  });

  test("maps public reviews without exposing html content", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue({
      result: {
        bookId: "b1",
        reviewListType: 0,
        totalCount: 20,
        hasMore: true,
        has5Star: true,
        has1Star: false,
        hasRecent: true,
        nextMaxIdx: 12,
        synckey: 99,
        reviews: [
          {
            idx: 12,
            reviewId: "r1",
            content: "值得继续读的一本书。",
            htmlContent: "<p>不应直接渲染</p>",
            star: 100,
            starLevel: 5,
            createTime: 1770000000,
            chapterName: "第一章",
            author: {
              userVid: "u1",
              name: "读者甲",
              avatar: "avatar"
            }
          }
        ]
      }
    });

    const response = await getPublicReviews({ bookId: "b1", count: 5 });

    expect(invokeMock).toHaveBeenCalledWith("get_public_reviews", {
      bookId: "b1",
      reviewListType: 0,
      count: 5,
      maxIdx: undefined,
      synckey: undefined
    });
    expect(response.result.reviews[0]).toMatchObject({
      reviewId: "r1",
      content: "值得继续读的一本书。",
      starLevel: 5,
      chapterName: "第一章",
      author: {
        name: "读者甲"
      }
    });
    expect("htmlContent" in (response.result.reviews[0] ?? {})).toBe(false);
  });

  test("maps best bookmarks with range for on-demand read reviews only", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue({
      result: {
        bookId: "b1",
        chapterUid: 0,
        totalCount: 20,
        synckey: 12,
        items: [
          {
            bookmarkId: "bookmark-1",
            bookId: "b1",
            userVid: "u1",
            chapterUid: 101,
            chapterTitle: "第一章",
            range: "393-401",
            markText: "值得反复划线的句子",
            totalCount: 88
          }
        ]
      }
    });

    const response = await getBestBookmarks({ bookId: "b1" });

    expect(invokeMock).toHaveBeenCalledWith("get_best_bookmarks", {
      bookId: "b1",
      chapterUid: 0,
      synckey: undefined
    });
    expect(response.result).toMatchObject({
      bookId: "b1",
      chapterUid: 0,
      synckey: 12,
      totalCount: 20,
      items: [
        {
          bookmarkId: "bookmark-1",
          bookId: "b1",
          chapterUid: 101,
          chapterTitle: "第一章",
          range: "393-401",
          markText: "值得反复划线的句子",
          totalCount: 88
        }
      ]
    });
    expect("userVid" in (response.result.items[0] ?? {})).toBe(false);
  });

  test("maps read reviews for a selected best bookmark range", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue({
      result: {
        bookId: "b1",
        chapterUid: 101,
        range: "393-401",
        totalCount: 8,
        hasMore: true,
        maxIdx: 5,
        synckey: 12,
        reviews: [
          {
            reviewId: "rr1",
            content: "这段确实是全书关键。",
            abstractText: "值得反复划线的句子",
            createTime: 1770000000,
            range: "393-401",
            author: {
              userVid: "u1",
              name: "读者乙"
            }
          }
        ]
      }
    });

    const response = await getReadReviews({
      bookId: "b1",
      chapterUid: 101,
      range: "393-401"
    });

    expect(invokeMock).toHaveBeenCalledWith("get_read_reviews", {
      bookId: "b1",
      chapterUid: 101,
      range: "393-401",
      count: 5,
      maxIdx: undefined,
      synckey: undefined
    });
    expect(response.result).toMatchObject({
      bookId: "b1",
      chapterUid: 101,
      range: "393-401",
      hasMore: true,
      maxIdx: 5,
      synckey: 12,
      reviews: [
        {
          reviewId: "rr1",
          content: "这段确实是全书关键。",
          abstractText: "值得反复划线的句子",
          author: {
            name: "读者乙"
          }
        }
      ]
    });
    expect("userVid" in (response.result.reviews[0]?.author ?? {})).toBe(false);
  });

  test("choose, save and reset export directory commands keep selection separate from persistence", async () => {
    invokeMock
      .mockResolvedValueOnce({
        path: "D:/ReadingExports",
      })
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {
            exportDir: "D:/ReadingExports",
            defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            isCustomExportDir: true
          }
        }
      })
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {
            exportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            isCustomExportDir: false
          }
        }
      });

    const chosen = await chooseCustomExportDirectory();
    const saved = await saveCustomExportDirectory("D:/ReadingExports");
    const reset = await resetCustomExportDirectory();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "choose_custom_export_directory");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_custom_export_directory", {
      targetDir: "D:/ReadingExports"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "reset_custom_export_directory");
    expect(chosen.path).toBe("D:/ReadingExports");
    expect(saved.state.exportData.isCustomExportDir).toBe(true);
    expect(reset.state.exportData.isCustomExportDir).toBe(false);
  });

  test("save and reset WeRead proxy commands update network settings", async () => {
    invokeMock
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {},
          network: {
            wereadProxyUrl: "http://127.0.0.1:7890",
            isCustomWereadProxy: true
          }
        }
      })
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {},
          network: {
            isCustomWereadProxy: false
          }
        }
      });

    const saved = await saveWereadProxyUrl("http://127.0.0.1:7890");
    const reset = await resetWereadProxyUrl();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_weread_proxy_url", {
      proxyUrl: "http://127.0.0.1:7890"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "reset_weread_proxy_url");
    expect(saved.state.network.wereadProxyUrl).toBe("http://127.0.0.1:7890");
    expect(reset.state.network.isCustomWereadProxy).toBe(false);
  });

  test("AI provider settings commands pass preset and response format policy", async () => {
    invokeMock
      .mockResolvedValueOnce({ isValid: true, checkedAt: "1" })
      .mockResolvedValueOnce({
        credential: { hasCredential: true },
        provider: {
          baseUrl: "https://api.deepseek.com/v1",
          model: "deepseek-chat",
          presetId: "deepseek",
          responseFormatPolicy: "noResponseFormatFirst"
        }
      })
      .mockResolvedValueOnce({ isValid: true, checkedAt: "2" })
      .mockResolvedValueOnce({
        basic: "passed",
        jsonObject: "failed",
        jsonSchema: "failed",
        recommendedPolicy: "noResponseFormatFirst",
        checkedAt: "3",
        message: "建议使用宽松兼容模式。"
      })
      .mockResolvedValueOnce({
        models: [{ id: "deepseek-chat", ownedBy: "deepseek" }],
        fetchedAt: "4"
      });

    await validateAiCredential({
      apiKey: "sk-1234567890abcdef",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    await saveAiSettings({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    await testAiConnection({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    const probe = await probeAiProviderCapabilities({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    const models = await listAiProviderModels({
      baseUrl: "https://api.deepseek.com/v1"
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "validate_ai_credential", {
      apiKey: "sk-1234567890abcdef",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ai_settings", {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "test_ai_connection", {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "probe_ai_provider_capabilities", {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormatPolicy: "noResponseFormatFirst"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "list_ai_provider_models", {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com/v1"
    });
    expect(probe.recommendedPolicy).toBe("noResponseFormatFirst");
    expect(models.models[0]?.id).toBe("deepseek-chat");
  });

  test("settings save commands fail fast when native invoke does not settle", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    const savePromise = saveAiSettings({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      presetId: "openai",
      responseFormatPolicy: "jsonSchemaFirst"
    });
    const expectation = expect(savePromise).rejects.toThrow("本地设置保存超时");

    await vi.advanceTimersByTimeAsync(15_000);

    await expectation;
    expect(invokeMock).toHaveBeenCalledWith("save_ai_settings", {
      apiKey: undefined,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      presetId: "openai",
      responseFormatPolicy: "jsonSchemaFirst"
    });
  });

  test("WeRead proxy save command also fails fast when native invoke does not settle", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    const savePromise = saveWereadProxyUrl("http://127.0.0.1:7890");
    const expectation = expect(savePromise).rejects.toThrow("本地设置保存超时");

    await vi.advanceTimersByTimeAsync(15_000);

    await expectation;
    expect(invokeMock).toHaveBeenCalledWith("save_weread_proxy_url", {
      proxyUrl: "http://127.0.0.1:7890"
    });
  });

  test("exports report image through the configured application export directory", async () => {
    invokeMock.mockResolvedValue({
      fileName: "2026-05-report.png",
      path: "D:/ReadingExports/2026-05-report.png",
      exportedAt: "1800000000"
    });

    const result = await exportReportImage("2026-05-report.png", "data:image/png;base64,iVBORw0KGgo=");

    expect(invokeMock).toHaveBeenCalledWith("export_report_image", {
      fileName: "2026-05-report.png",
      pngBase64: "data:image/png;base64,iVBORw0KGgo="
    });
    expect(result).toEqual({
      fileName: "2026-05-report.png",
      path: "D:/ReadingExports/2026-05-report.png",
      exportedAt: "1800000000"
    });
  });

  test("clears only AI output cache through dedicated command", async () => {
    invokeMock.mockResolvedValue({
      deletedRows: 3,
      state: {
        credential: { hasCredential: true },
        syncStates: [],
        localData: {
          dataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          defaultDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          databasePath: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/reading-cache.sqlite3",
          databaseSizeBytes: 1024,
          cacheRowCount: 4,
          isCustomDataDir: false,
          tableCounts: [
            { table: "ai_outputs", rowCount: 0 },
            { table: "shelf_entries", rowCount: 4 },
            { table: "reading_item_states", rowCount: 2 }
          ]
        },
        exportData: {
          exportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          isCustomExportDir: false
        },
        appVersion: "0.1.0",
        supportsNativeUpdater: true
      }
    });

    const result = await clearAiOutputCache(true);

    expect(invokeMock).toHaveBeenCalledWith("clear_ai_output_cache", { confirm: true });
    expect(result.deletedRows).toBe(3);
    expect(result.state.localData.tableCounts).toContainEqual({ table: "ai_outputs", rowCount: 0 });
    expect(result.state.localData.tableCounts).toContainEqual({ table: "shelf_entries", rowCount: 4 });
    expect(result.state.localData.tableCounts).toContainEqual({
      table: "reading_item_states",
      rowCount: 2
    });
  });

  test("reads ai asset version detail with explicit version identity", async () => {
    invokeMock.mockResolvedValue({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash",
      promptVersion: "reading-route-v2.1",
      generatedAt: "140",
      updatedAt: "140",
      source: "cache",
      basisNotice: "基于本地缓存生成。",
      sourceStats: {},
      readingRoute: {
        routeOverview: "先读主书，再整理行动。",
        books: [],
        dependencies: [],
        reviewCheckpoints: [],
        nextActions: [],
        sourceStats: {
          currentBookCount: 1,
          candidateCount: 0,
          summaryCount: 0,
          statsSignalCount: 0,
          localStatusCount: 0
        },
        generatedAt: "140",
        promptVersion: "reading-route-v2.1",
        basisNotice: "基于本地缓存生成。"
      }
    });

    const detail = await getAIAssetVersionDetail({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });

    expect(invokeMock).toHaveBeenCalledWith("get_ai_asset_version_detail", {
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });
    expect(detail?.feature).toBe("reading-route");
    expect(detail?.readingRoute?.routeOverview).toBe("先读主书，再整理行动。");
  });

  test("reads ai asset version history within current book scope", async () => {
    invokeMock.mockResolvedValue([
      {
        feature: "book-review",
        scopeId: "book_1",
        inputHash: "summary_hash_v2",
        promptVersion: "book-notes-summary-v3",
        generatedAt: "220",
        updatedAt: "220",
        source: "cache",
        title: "第二版复盘",
        readingStage: "closing",
        readingStageLabel: "收束整理",
        progress: 100,
        refreshReason: "completed",
        isCurrent: false
      }
    ]);

    const versions = await getAIAssetVersionHistory({
      feature: "book-review",
      scopeId: "book_1"
    });

    expect(invokeMock).toHaveBeenCalledWith("get_ai_asset_version_history", {
      feature: "book-review",
      scopeId: "book_1"
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].inputHash).toBe("summary_hash_v2");
  });

  test("reads and saves ai review feedback through local database commands", async () => {
    const feedback = {
      actionItems: {
        "0:写一页复盘": {
          status: "completed" as const,
          note: "已完成",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      },
      reflectionQuestions: {}
    };
    invokeMock.mockResolvedValueOnce(feedback).mockResolvedValueOnce(feedback);

    const loaded = await getAiReviewFeedback({
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash"
    });
    const saved = await saveAiReviewFeedback({
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash",
      feedback
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_ai_review_feedback", {
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ai_review_feedback", {
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash",
      feedback
    });
    expect(loaded.actionItems["0:写一页复盘"].status).toBe("completed");
    expect(saved.actionItems["0:写一页复盘"].note).toBe("已完成");
  });

  test("reads and saves reading route feedback with asset identity", async () => {
    const feedback = {
      actionItems: {
        "0:今天安排45分钟读完第2章": {
          status: "completed" as const,
          note: "已整理成一页笔记",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      },
      reflectionQuestions: {}
    };
    invokeMock.mockResolvedValueOnce(feedback).mockResolvedValueOnce(feedback);

    const loaded = await getAiReviewFeedback({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });
    const saved = await saveAiReviewFeedback({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash",
      feedback
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_ai_review_feedback", {
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ai_review_feedback", {
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash",
      feedback
    });
    expect(loaded.actionItems["0:今天安排45分钟读完第2章"].status).toBe("completed");
    expect(saved.actionItems["0:今天安排45分钟读完第2章"].note).toBe("已整理成一页笔记");
  });

  test("passes reading route update context to generation command", async () => {
    const response = {
      bookId: "book_1",
      scopeId: "book:book_1",
      promptVersion: "reading-route-v2.1",
      inputHash: "route_hash_v2",
      source: "generated" as const,
      route: {
        routeOverview: "更新后的指南。",
        books: [],
        dependencies: [],
        reviewCheckpoints: [],
        nextActions: [],
        sourceStats: {
          currentBookCount: 1,
          candidateCount: 0,
          summaryCount: 0,
          statsSignalCount: 0,
          localStatusCount: 0
        },
        generatedAt: "150",
        promptVersion: "reading-route-v2.1",
        basisNotice: "基于上一版行动反馈生成。"
      }
    };
    invokeMock.mockResolvedValue(response);

    const result = await summarizeReadingRoute({
      request: {
        book: {
          bookId: "book_1",
          title: "深度工作"
        },
        candidates: []
      },
      regenerate: true,
      updateFrom: {
        feature: "reading-route",
        scopeId: "book:book_1",
        inputHash: "route_hash_v1"
      }
    });

    expect(invokeMock).toHaveBeenCalledWith("summarize_reading_route", {
      request: {
        book: {
          bookId: "book_1",
          title: "深度工作"
        },
        candidates: []
      },
      regenerate: true,
      updateFrom: {
        feature: "reading-route",
        scopeId: "book:book_1",
        inputHash: "route_hash_v1"
      }
    });
    expect(result.inputHash).toBe("route_hash_v2");
  });

  test("passes book review update context to generation command", async () => {
    const response = {
      bookId: "book_1",
      promptVersion: "book-notes-summary-v3",
      inputHash: "summary_hash_v2",
      source: "generated" as const,
      summary: {
        overview: "更新后的复盘。",
        keyIdeas: [],
        myFocus: [],
        actionItems: [],
        themeTags: [],
        representativeQuotes: [],
        reflectionQuestions: [],
        sourceStats: {
          highlightCount: 1,
          thoughtCount: 0,
          bookmarkCount: 0,
          chapterCount: 1,
          includedHighlightCount: 1,
          includedThoughtCount: 0
        },
        generatedAt: "150",
        promptVersion: "book-notes-summary-v3",
        basisNotice: "基于上一版反馈生成。"
      }
    };
    invokeMock.mockResolvedValue(response);

    const result = await summarizeBookNotes({
      bookId: "book_1",
      regenerate: true,
      updateFrom: {
        feature: "book-review",
        scopeId: "book_1",
        inputHash: "summary_hash_v1"
      }
    });

    expect(invokeMock).toHaveBeenCalledWith("summarize_book_notes", {
      bookId: "book_1",
      regenerate: true,
      updateFrom: {
        feature: "book-review",
        scopeId: "book_1",
        inputHash: "summary_hash_v1"
      }
    });
    expect(result.inputHash).toBe("summary_hash_v2");
  });

  test("maps updater metadata including release notes and publish date", async () => {
    invokeMock.mockResolvedValue({
      credential: { hasCredential: true },
      syncStates: [],
      localData: {},
      exportData: {},
      appVersion: "0.1.0",
      supportsNativeUpdater: true
    });
    checkMock.mockResolvedValue({
      currentVersion: "0.1.0",
      version: "0.1.1",
      body: "修复检查更新交互并补充更新摘要。",
      date: "2026-05-23T10:00:00.000Z"
    } as Awaited<ReturnType<typeof check>>);

    const status = await checkForAppUpdate();

    expect(status).toEqual({
      available: true,
      currentVersion: "0.1.0",
      supportsNativeUpdater: true,
      latestVersion: "0.1.1",
      notes: "修复检查更新交互并补充更新摘要。",
      publishedAt: "2026-05-23T10:00:00.000Z"
    });
  });

  test("reads remote manifest for unsupported platforms", async () => {
    invokeMock
      .mockResolvedValueOnce({
        credential: { hasCredential: true },
        syncStates: [],
        localData: {},
        exportData: {},
        appVersion: "1.0.1",
        supportsNativeUpdater: false
      })
      .mockResolvedValueOnce({
        version: "v1.0.2",
        notes: "Android 改为读取远程更新清单。",
        publishedAt: "2026-05-24T08:00:00.000Z"
      });

    const status = await checkForAppUpdate();

    expect(checkMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_remote_app_update_manifest");
    expect(status).toEqual({
      available: true,
      currentVersion: "1.0.1",
      supportsNativeUpdater: false,
      latestVersion: "v1.0.2",
      notes: "Android 改为读取远程更新清单。",
      publishedAt: "2026-05-24T08:00:00.000Z"
    });
  });

  test("keeps remote metadata when unsupported platform is already up to date", async () => {
    invokeMock
      .mockResolvedValueOnce({
        credential: { hasCredential: true },
        syncStates: [],
        localData: {},
        exportData: {},
        appVersion: "1.0.2",
        supportsNativeUpdater: false
      })
      .mockResolvedValueOnce({
        version: "v1.0.2",
        notes: "当前已是最新 APK 版本。",
        publishedAt: "2026-05-24T08:00:00.000Z"
      });

    const status = await checkForAppUpdate();

    expect(checkMock).not.toHaveBeenCalled();
    expect(status).toEqual({
      available: false,
      currentVersion: "1.0.2",
      supportsNativeUpdater: false,
      latestVersion: "v1.0.2",
      notes: "当前已是最新 APK 版本。",
      publishedAt: "2026-05-24T08:00:00.000Z"
    });
  });

  test("maps bookshelf archives from Tauri responses", async () => {
    vi.stubGlobal("__TAURI__", {});
    invokeMock.mockResolvedValue({
      snapshot: {
        entries: [
          {
            id: "b1",
            type: "book",
            title: "架构整洁之道",
            isTop: false,
            isSecret: false,
            rawJson: "{\"bookId\":\"b1\"}"
          }
        ],
        archives: [
          {
            id: "archive:0:tech",
            name: "技术栈",
            bookIds: ["b1", "missing"],
            matchedEntryCount: 1,
            missingBookCount: 1,
            rawJson: "{\"name\":\"技术栈\"}"
          }
        ],
        summary: {
          totalVisibleEntries: 1,
          bookCount: 1,
          albumCount: 0,
          mpCount: 0,
          publicCount: 1,
          secretCount: 0
        }
      },
      syncState: {
        section: "shelf",
        status: "success"
      }
    });

    const bookshelf = await getBookshelf();

    expect(bookshelf.snapshot.archives).toEqual([
      {
        id: "archive:0:tech",
        name: "技术栈",
        bookIds: ["b1", "missing"],
        matchedEntryCount: 1,
        missingBookCount: 1,
        raw: { name: "技术栈" }
      }
    ]);
  });

  test("uses exported web preview data for stats and cached review when Tauri is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 24, 10, 0, 0));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: 2,
        exportedAt: "1779592046",
        statsSyncState: {
          section: "stats",
          status: "success",
          lastSuccessAt: "1779589282",
          lastAttemptAt: "1779589282"
        },
        shelfSyncState: {
          section: "shelf",
          status: "success",
          lastSuccessAt: "1779533684",
          lastAttemptAt: "1779533684"
        },
        notesSyncState: {
          section: "notes",
          status: "success",
          lastSuccessAt: "1779587048",
          lastAttemptAt: "1779587048"
        },
        shelfEntries: [
          {
            id: "3300082699",
            type: "book",
            title: "巴别塔",
            author: "匡灵秀",
            cover: "cover-book",
            category: "文学-外国文学",
            isTop: 0,
            isSecret: 0,
            isFinished: 0,
            lastReadAt: 1769272411,
            rawJson: JSON.stringify({
              bookId: "3300082699",
              title: "巴别塔"
            })
          },
          {
            id: "audio-1",
            type: "album",
            title: "一小时听懂大历史",
            author: "播客编辑部",
            cover: "cover-audio",
            category: "历史-历史读物",
            isTop: 0,
            isSecret: 0,
            isFinished: 0,
            lastReadAt: 1769000000,
            rawJson: JSON.stringify({
              albumId: "audio-1",
              name: "一小时听懂大历史"
            })
          }
        ],
        shelfArchives: [
          {
            id: "archive:0:literature",
            name: "文学书单",
            bookIdsJson: JSON.stringify(["3300082699", "missing"]),
            matchedEntryCount: 1,
            missingBookCount: 1,
            rawJson: JSON.stringify({ name: "文学书单" })
          }
        ],
        readingItemStates: [
          {
            itemId: "34752158",
            itemType: "candidate",
            status: "toRead",
            title: "爵士乐宝典：即兴、编曲、乐曲大全",
            author: "马克·列文",
            cover: "candidate-cover",
            category: "艺术-音乐",
            note: "书籍详情页保存的本地候选",
            createdAt: "1779464743",
            updatedAt: "1779464743"
          }
        ],
        notebookBooks: [
          {
            bookId: "822995",
            title: "明朝那些事儿（全集）",
            author: "当年明月",
            cover: "notes-cover",
            reviewCount: 95,
            noteCount: 488,
            bookmarkCount: 9,
            totalNoteCount: 592,
            sort: 1779496560,
            rawJson: JSON.stringify({
              bookId: "822995",
              title: "明朝那些事儿（全集）"
            })
          }
        ],
        statsRows: [
          {
            mode: "weekly",
            baseTime: 1779033600,
            rawJson: JSON.stringify({
              baseTime: 1779033600,
              totalReadTime: 3090,
              readDays: 2,
              dayAverageReadTime: 441,
              compare: 1.448,
              readTimes: {
                1779033600: 2111,
                1779465600: 966
              },
              readLongest: [
                {
                  book: {
                    bookId: "822995",
                    title: "明朝那些事儿（全集）",
                    author: "当年明月",
                    cover: "cover"
                  },
                  readTime: 466,
                  tags: ["单日阅读最久"]
                }
              ],
              preferCategory: [
                {
                  categoryId: 200000,
                  categoryTitle: "历史",
                  parentCategoryTitle: "历史",
                  readingTime: 3090,
                  readingCount: 1
                }
              ]
            })
          },
          {
            mode: "weekly",
            baseTime: 1780243200,
            rawJson: JSON.stringify({
              baseTime: 1780243200,
              totalReadTime: 0,
              readDays: 0,
              readTimes: {}
            })
          },
          {
            mode: "overall",
            baseTime: 0,
            rawJson: JSON.stringify({
              baseTime: 0,
              totalReadTime: 4759747,
              readDays: 1431,
              preferCategory: [
                {
                  categoryId: 100012,
                  categoryTitle: "影视原著",
                  parentCategoryTitle: "精品小说",
                  readingTime: 168424,
                  readingCount: 5
                }
              ]
            })
          }
        ],
        reviewRows: [
          {
            scopeId: "overall:0",
            promptVersion: "reading-stats-review-v1",
            inputHash: "hash",
            outputJson: JSON.stringify({
              overview: "长期阅读投入稳定。",
              rhythmInsights: ["2024 年是峰值。"],
              preferenceInsights: ["影视原著投入最高。"],
              focusItems: ["《牧神记》是超长单本。"],
              nextActions: ["回看 2024。"],
              readingPersona: {
                summary: "这一阶段的阅读更像围绕少数主线持续推进。",
                suggestion: "下个周期可以补一本文学短书做横向对照。"
              },
              sourceStats: {
                mode: "overall",
                baseTime: 0,
                bucketCount: 9,
                longestItemCount: 10,
                categoryCount: 8
              },
              generatedAt: "1779465839",
              promptVersion: "reading-stats-review-v1",
              basisNotice: "基于结构化阅读统计生成。"
            }),
            providerModel: "gpt-5.2",
            createdAt: "1779465839",
            updatedAt: "1779465839"
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const credential = await getCredentialStatus();
    const aiSettings = await getAiSettingsState();
    const weeklyStats = await getReadingStats("weekly");
    const overallReview = await getLatestReadingStatsReview({ mode: "overall", baseTime: 0 });
    const bookshelf = await getBookshelf();
    const syncedBookshelf = await syncShelf();
    const readingStates = await listReadingItemStates();
    const notebookOverview = await getNotebookOverview();

    expect(credential.hasCredential).toBe(true);
    expect(aiSettings.provider.model).toBe("preview-readonly");
    expect(weeklyStats.stats.baseTime).toBe(1779033600);
    expect(weeklyStats.source).toBe("cache");
    expect(weeklyStats.stats.totalReadTimeSeconds).toBe(3090);
    expect(weeklyStats.stats.longestItems[0]?.title).toBe("明朝那些事儿（全集）");
    expect(weeklyStats.stats.categories[0]?.title).toBe("历史");
    expect(overallReview?.review.overview).toBe("长期阅读投入稳定。");
    expect(overallReview?.review.readingPersona?.summary).toContain("主线");
    expect(overallReview?.review.readingPersona?.suggestion).toContain("文学短书");
    expect(bookshelf.snapshot.summary.totalVisibleEntries).toBe(2);
    expect(bookshelf.snapshot.entries[0]?.title).toBe("巴别塔");
    expect(bookshelf.snapshot.archives).toEqual([
      {
        id: "archive:0:literature",
        name: "文学书单",
        bookIds: ["3300082699", "missing"],
        matchedEntryCount: 1,
        missingBookCount: 1,
        raw: { name: "文学书单" }
      }
    ]);
    expect(syncedBookshelf.syncState?.section).toBe("shelf");
    expect(readingStates).toHaveLength(1);
    expect(readingStates[0]?.status).toBe("toRead");
    expect(notebookOverview.summary.totalBookCount).toBe(1);
    expect(notebookOverview.summary.totalNoteCount).toBe(592);
    expect(notebookOverview.books[0]?.title).toBe("明朝那些事儿（全集）");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });
});
