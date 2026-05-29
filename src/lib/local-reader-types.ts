export type LocalBookFormat = "epub" | "txt";
export type LocalBookSource = "local";

export type LocalBook = {
  id: string;
  source: LocalBookSource;
  title: string;
  author?: string;
  format: LocalBookFormat;
  fileHash: string;
  fileSize: number;
  storagePath: string;
  coverPath?: string;
  importedAt: string;
  updatedAt: string;
};

export type ImportLocalBookInput = {
  filePath: string;
};

export type ImportLocalBookResult = {
  book: LocalBook;
  wasAlreadyImported: boolean;
};

export type LocalBookText = {
  bookId: string;
  content: string;
};

export type LocalReadingProgress = {
  bookId: string;
  locator: string;
  progressPercent: number;
  readTimeSeconds: number;
  updatedAt: string;
};

export type SaveLocalReadingProgressInput = {
  bookId: string;
  locator: string;
  progressPercent: number;
  readTimeSeconds?: number;
};
