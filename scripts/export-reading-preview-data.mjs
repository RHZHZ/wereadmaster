import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const defaultDataDir = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "com.wxreadmaster.personal-reading")
  : path.join(workspaceRoot, ".codex-temp");
const defaultDbPath = path.join(defaultDataDir, "reading-cache.sqlite3");
const defaultOutputPath = path.join(
  workspaceRoot,
  ".codex-temp",
  "reading-preview-data.json"
);

const dbPath = path.resolve(process.argv[2] ?? defaultDbPath);
const outputPath = path.resolve(process.argv[3] ?? defaultOutputPath);

const statsRows = runSqliteJson(
  dbPath,
  `
    SELECT
      mode,
      base_time AS baseTime,
      raw_json AS rawJson,
      updated_at AS updatedAt
    FROM reading_stats
    ORDER BY mode, base_time;
  `
);

const statsSyncState =
  runSqliteJson(
    dbPath,
    `
      SELECT
        section,
        status,
        last_success_at AS lastSuccessAt,
        last_attempt_at AS lastAttemptAt,
        error_code AS errorCode,
        error_message AS errorMessage
      FROM sync_state
      WHERE section = 'stats'
      LIMIT 1;
    `
  )[0] ?? null;

const shelfSyncState =
  runSqliteJson(
    dbPath,
    `
      SELECT
        section,
        status,
        last_success_at AS lastSuccessAt,
        last_attempt_at AS lastAttemptAt,
        error_code AS errorCode,
        error_message AS errorMessage
      FROM sync_state
      WHERE section = 'shelf'
      LIMIT 1;
    `
  )[0] ?? null;

const notesSyncState =
  runSqliteJson(
    dbPath,
    `
      SELECT
        section,
        status,
        last_success_at AS lastSuccessAt,
        last_attempt_at AS lastAttemptAt,
        error_code AS errorCode,
        error_message AS errorMessage
      FROM sync_state
      WHERE section = 'notes'
      LIMIT 1;
    `
  )[0] ?? null;

const shelfEntries = runSqliteJson(
  dbPath,
  `
    SELECT
      id,
      type,
      title,
      author,
      cover,
      category,
      is_top AS isTop,
      is_secret AS isSecret,
      is_finished AS isFinished,
      last_read_at AS lastReadAt,
      raw_json AS rawJson
    FROM shelf_entries
    ORDER BY is_top DESC, last_read_at DESC, title ASC;
  `
);

const shelfArchives = runOptionalSqliteJson(
  dbPath,
  `
    SELECT
      id,
      name,
      book_ids_json AS bookIdsJson,
      matched_entry_count AS matchedEntryCount,
      missing_book_count AS missingBookCount,
      raw_json AS rawJson
    FROM shelf_archives
    ORDER BY sort_order ASC, name ASC, id ASC;
  `
);

const readingItemStates = runSqliteJson(
  dbPath,
  `
    SELECT
      item_id AS itemId,
      item_type AS itemType,
      status,
      title,
      author,
      cover,
      category,
      note,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM reading_item_states
    ORDER BY updated_at DESC, title ASC, item_id ASC;
  `
);

const notebookBooks = runSqliteJson(
  dbPath,
  `
    SELECT
      book_id AS bookId,
      title,
      author,
      cover,
      review_count AS reviewCount,
      note_count AS noteCount,
      bookmark_count AS bookmarkCount,
      total_note_count AS totalNoteCount,
      sort,
      raw_json AS rawJson
    FROM notebook_books
    ORDER BY total_note_count DESC, sort DESC, title ASC;
  `
);

const reviewRows = runSqliteJson(
  dbPath,
  `
    SELECT
      scope_id AS scopeId,
      prompt_version AS promptVersion,
      input_hash AS inputHash,
      output_json AS outputJson,
      source_count AS sourceCount,
      provider_model AS providerModel,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM ai_outputs
    WHERE feature = 'reading-stats-review'
    ORDER BY updated_at DESC;
  `
);

const payload = {
  schemaVersion: 2,
  exportedAt: String(Math.floor(Date.now() / 1000)),
  dbPath,
  statsSyncState,
  shelfSyncState,
  notesSyncState,
  shelfEntries,
  shelfArchives,
  readingItemStates,
  notebookBooks,
  statsRows,
  reviewRows
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

console.log(
  JSON.stringify(
    {
      outputPath,
      statsRowCount: statsRows.length,
      reviewRowCount: reviewRows.length,
      shelfEntryCount: shelfEntries.length,
      shelfArchiveCount: shelfArchives.length,
      readingItemStateCount: readingItemStates.length,
      notebookBookCount: notebookBooks.length
    },
    null,
    2
  )
);

function runSqliteJson(dbFilePath, sql) {
  const output = execFileSync("sqlite3", [dbFilePath, ".mode json", collapseSql(sql)], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();

  if (!output) {
    return [];
  }

  return JSON.parse(output);
}

function runOptionalSqliteJson(dbFilePath, sql) {
  try {
    return runSqliteJson(dbFilePath, sql);
  } catch (error) {
    if (String(error?.stderr ?? error?.message ?? "").includes("no such table")) {
      return [];
    }

    throw error;
  }
}

function collapseSql(sql) {
  return sql
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}
