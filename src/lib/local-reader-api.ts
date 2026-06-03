import { invoke } from "@tauri-apps/api/core";
import type {
  ImportLocalBookInput,
  ImportLocalBookResult,
  LocalBook,
  LocalBookText,
  LocalReadingProgress,
  SaveLocalReadingProgressInput
} from "./local-reader-types";

export async function importLocalBook(input: ImportLocalBookInput): Promise<ImportLocalBookResult> {
  assertLocalReaderRuntime("导入本地图书");
  return invoke<ImportLocalBookResult>("import_local_book", { input });
}

export async function chooseLocalBookFile(): Promise<string | undefined> {
  assertLocalReaderRuntime("选择本地图书文件");
  const filePath = await invoke<string | null>("choose_local_book_file");
  return filePath ?? undefined;
}

export async function listLocalBooks(): Promise<LocalBook[]> {
  if (!hasTauriRuntime()) {
    return shouldUseLocalReaderPreviewData() ? LOCAL_READER_PREVIEW_BOOKS : [];
  }

  return invoke<LocalBook[]>("list_local_books");
}

export async function getLocalBook(bookId: string): Promise<LocalBook | undefined> {
  if (!hasTauriRuntime()) {
    return shouldUseLocalReaderPreviewData()
      ? LOCAL_READER_PREVIEW_BOOKS.find((book) => book.id === bookId)
      : undefined;
  }

  const book = await invoke<LocalBook | null>("get_local_book", { bookId });
  return book ?? undefined;
}

export async function getLocalBookText(bookId: string): Promise<LocalBookText> {
  if (!hasTauriRuntime() && shouldUseLocalReaderPreviewData()) {
    return {
      bookId,
      content: LOCAL_READER_PREVIEW_TEXT[bookId] ?? LOCAL_READER_PREVIEW_TEXT.default
    };
  }

  assertLocalReaderRuntime("读取本地图书正文");
  return invoke<LocalBookText>("get_local_book_text", { bookId });
}

export async function getLocalReadingProgress(
  bookId: string
): Promise<LocalReadingProgress | undefined> {
  if (!hasTauriRuntime()) {
    return shouldUseLocalReaderPreviewData()
      ? LOCAL_READER_PREVIEW_PROGRESS[bookId]
      : undefined;
  }

  const progress = await invoke<LocalReadingProgress | null>("get_local_reading_progress", {
    bookId
  });
  return progress ?? undefined;
}

export async function saveLocalReadingProgress(
  input: SaveLocalReadingProgressInput
): Promise<LocalReadingProgress> {
  if (!hasTauriRuntime() && shouldUseLocalReaderPreviewData()) {
    return createPreviewProgress(
      input.bookId,
      input.progressPercent,
      new Date().toISOString(),
      input.locator,
      input.readTimeSeconds
    );
  }

  assertLocalReaderRuntime("保存本地阅读进度");
  return invoke<LocalReadingProgress>("save_local_reading_progress", { input });
}

function assertLocalReaderRuntime(action: string): void {
  if (!hasTauriRuntime()) {
    throw new Error(`${action}需要在桌面应用中执行。`);
  }
}

function hasTauriRuntime(): boolean {
  const runtime = globalThis as Record<string, unknown>;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}

function shouldUseLocalReaderPreviewData(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("local-reader-preview") === "1";
}

const LOCAL_READER_PREVIEW_BOOKS: LocalBook[] = [
  createPreviewBook("preview-zssn", "看见（柴静柴静）(Z-Library)", "未知作者", "epub", 1_784_320, "2025-05-20T21:34:00+08:00"),
  createPreviewBook("preview-moon", "月亮与六便士", "毛姆", "epub", 1_124_096, "2025-05-19T20:11:00+08:00"),
  createPreviewBook("preview-alive", "活着", "余华", "epub", 884_736, "2025-05-18T18:42:00+08:00"),
  createPreviewBook("preview-sapiens", "人类简史", "尤瓦尔·赫拉利", "epub", 2_228_224, "2025-05-17T16:08:00+08:00"),
  createPreviewBook("preview-three-body", "三体（全集）", "刘慈欣", "epub", 3_145_728, "2025-05-16T22:19:00+08:00"),
  createPreviewBook("preview-wanli", "万历十五年", "黄仁宇", "epub", 1_048_576, "2025-05-15T11:02:00+08:00"),
  createPreviewBook("preview-markdown", "阅读设计笔记", "本地 Markdown", "markdown", 64_512, "2025-05-14T18:20:00+08:00"),
  createPreviewBook("preview-prince", "小王子", "[法] 安托万·德·圣埃克苏佩里", "txt", 221_184, "2025-05-14T09:55:00+08:00"),
  createPreviewBook("preview-walden", "瓦尔登湖", "梭罗", "epub", 1_032_192, "2025-05-13T20:44:00+08:00")
];

const LOCAL_READER_PREVIEW_PROGRESS: Record<string, LocalReadingProgress> = {
  "preview-zssn": createPreviewProgress("preview-zssn", 68, "2025-05-20T21:34:00+08:00"),
  "preview-moon": createPreviewProgress("preview-moon", 34, "2025-05-19T20:11:00+08:00"),
  "preview-alive": createPreviewProgress("preview-alive", 12, "2025-05-18T18:42:00+08:00"),
  "preview-sapiens": createPreviewProgress("preview-sapiens", 41, "2025-05-17T16:08:00+08:00"),
  "preview-three-body": createPreviewProgress("preview-three-body", 55, "2025-05-16T22:19:00+08:00"),
  "preview-wanli": createPreviewProgress("preview-wanli", 100, "2025-05-15T11:02:00+08:00"),
  "preview-markdown": createPreviewProgress("preview-markdown", 9, "2025-05-14T18:20:00+08:00"),
  "preview-prince": createPreviewProgress("preview-prince", 23, "2025-05-14T09:55:00+08:00"),
  "preview-walden": createPreviewProgress("preview-walden", 27, "2025-05-13T20:44:00+08:00")
};

function createPreviewBook(
  id: string,
  title: string,
  author: string,
  format: LocalBook["format"],
  fileSize: number,
  updatedAt: string
): LocalBook {
  const storageExtension = format === "markdown" ? "md" : format;

  return {
    id,
    source: "local",
    title,
    author,
    format,
    fileHash: `${id}-hash`,
    fileSize,
    storagePath: `local-reader-preview/${id}/source.${storageExtension}`,
    importedAt: updatedAt,
    updatedAt
  };
}

function createPreviewProgress(
  bookId: string,
  progressPercent: number,
  updatedAt: string,
  locator = `preview:${bookId}`,
  readTimeSeconds = Math.round(progressPercent * 180)
): LocalReadingProgress {
  return {
    bookId,
    locator,
    progressPercent,
    readTimeSeconds,
    updatedAt
  };
}

const LOCAL_READER_PREVIEW_TEXT: Record<string, string> = {
  "preview-markdown": [
    "# 第一节：阅读边界",
    "",
    "Markdown 导入在首版保持文本阅读模式，保留原始标记，优先保证选区、划线和想法偏移稳定。",
    "",
    "```md",
    "# 代码块标题不应进入目录",
    "```",
    "",
    "## 第二节：划线与 AI",
    "",
    "用户仍然通过正文选区发起划线、写想法和向 AI 提问，不因为 Markdown 来源而自动发送整篇文档。"
  ].join("\n"),
  "preview-prince": [
    "第一章",
    "",
    "“很多时候，幸福并不来自宏大的事件，而是藏在我们注意不到的细节里。”",
    "",
    "我六岁那年，在一本描写原始森林的书里看到一幅精彩的图画。那本书叫《真实的故事》。",
    "",
    "于是我也想画出自己的第一幅作品。大人们看了以后，只问我为什么要画一顶帽子。",
    "",
    "这就是本地 TXT 阅读器预览文本。正式版本会从本机导入文件中读取 UTF-8 内容，并把滚动位置保存为本地阅读进度。",
    "",
    "第二章",
    "",
    "阅读器应该安静、轻便，不抢正文的注意力。后续再补充划线、标记和向 AI 提问时，也应当围绕选中文本出现，而不是把阅读页变成复杂工作台。",
    "",
    "清晨的第一缕阳光透过窗帘的缝隙落在桌面上，空气里还带着夜晚的凉意。",
    "",
    "我习惯在这个时间，给自己倒一杯温热的水，翻开一本书，或者只是静静地发呆。",
    "",
    "我们总在追赶未来，却常常错过了当下。其实，生活并不需要太多的计划和目标，只要愿意停下来，认真感受一朵花的香气、一次风的轻抚、一顿饭的温度，就足够了。",
    "",
    "朋友说，成年人的世界里，容易的事情越来越少。也许正是这样，但我们仍然可以选择用温柔的方式，去对待每一个平凡的日子。",
    "",
    "* * *",
    "",
    "傍晚散步回家，路灯一盏盏亮起。街边的小店飘出饭菜的香味，邻居家的孩子在院子里追逐着笑闹。",
    "",
    "那些看似普通的瞬间，拼凑成了我们生命中的大部分。",
    "",
    "当我们学会在平凡中发现美好，生活便会温柔地回馈我们力量。",
    "",
    "第三章",
    "",
    "本地版本和微信读书版本会继续隔离保存：进度、划线、章节位置和 AI 缓存都不会自动合并。",
    "",
    "本地阅读的价值，不是替代微信读书，而是把用户真正拥有的文件、进度与思考留在本机。",
    "",
    "如果同一本书同时存在于微信读书和本地书库，它们会作为两个版本被清晰标识，避免划线、笔记和 AI 缓存发生隐性冲突。"
  ].join("\n"),
  default: [
    "本地阅读预览",
    "",
    "这是用于浏览器预览的正文样本。桌面应用中会读取用户导入到本地书库的 TXT/EPUB 文本内容。",
    "",
    "“很多时候，幸福并不来自宏大的事件，而是藏在我们注意不到的细节里。”",
    "",
    "清晨的第一缕阳光透过窗帘的缝隙落在桌面上，空气里还带着夜晚的凉意。",
    "",
    "我习惯在这个时间，给自己倒一杯温热的水，翻开一本书，或者只是静静地发呆。",
    "",
    "阅读器应该安静、轻便，不抢正文的注意力。划线、想法和向 AI 提问都围绕选中文本出现，并按本地来源隔离保存。",
    "",
    "我们总在追赶未来，却常常错过了当下。其实，生活并不需要太多的计划和目标，只要愿意停下来，认真感受一朵花的香气、一次风的轻抚、一顿饭的温度，就足够了。",
    "",
    "朋友说，成年人的世界里，容易的事情越来越少。也许正是这样，但我们仍然可以选择用温柔的方式，去对待每一个平凡的日子。",
    "",
    "* * *",
    "",
    "傍晚散步回家，路灯一盏盏亮起。街边的小店飘出饭菜的香味，邻居家的孩子在院子里追逐着笑闹。",
    "",
    "那些看似普通的瞬间，拼凑成了我们生命中的大部分。",
    "",
    "当我们学会在平凡中发现美好，生活便会温柔地回馈我们力量。",
    "",
    "本地版本和微信读书版本会继续隔离保存：进度、划线、章节位置和 AI 缓存都不会自动合并。",
    "",
    "EPUB 当前使用保守文本抽取，不承诺完整精排版；本地进度、搜索、划线和想法仍按本地来源隔离保存。"
  ].join("\n")
};
