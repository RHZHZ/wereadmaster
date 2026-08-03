import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glossaryPath = path.join(repositoryRoot, "src", "lib", "glossary-data.json");
const sourceRoot = path.join(repositoryRoot, "src");

const CURRENT_DOCUMENTS = [
  "docs/functional-consolidation-blueprint.md",
  "docs/functional-consolidation-m1-implementation-plan.md",
  "docs/functional-consolidation-m2-implementation-plan.md",
  "docs/next-step-priority-design.md",
  "docs/ai-feature-plan.md",
  "docs/user-guide.md"
];

// Only unavoidable protocol or legacy-data literals belong here. UI copy must be fixed instead.
const TERM_EXEMPTIONS = new Map();

const glossary = JSON.parse(await readFile(glossaryPath, "utf8"));
validateGlossary(glossary);

const sourceFiles = await collectSourceFiles(sourceRoot);
const managedFiles = [
  ...sourceFiles,
  ...CURRENT_DOCUMENTS.map((relativePath) => path.join(repositoryRoot, relativePath))
];
const violations = [];

for (const filePath of managedFiles) {
  const relativePath = toPosix(path.relative(repositoryRoot, filePath));
  let content;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`无法读取 glossary 受管文件 ${relativePath}: ${error.message}`);
  }

  const lines = content.split(/\r?\n/u);
  for (const [lineIndex, line] of lines.entries()) {
    for (const entry of glossary.bannedTerms) {
      const canonical = glossary.terms[entry.useInstead];
      if (!containsBannedTerm(line, entry.banned, canonical) || isExempt(relativePath, entry.banned)) {
        continue;
      }

      violations.push({
        relativePath,
        line: lineIndex + 1,
        banned: entry.banned,
        useInstead: entry.useInstead,
        canonical
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Glossary 检查失败：发现受管产品术语违规。\n");
  for (const violation of violations) {
    console.error(
      `${violation.relativePath}:${violation.line}:${violation.banned} → ` +
        `${violation.useInstead}（${violation.canonical}）`
    );
  }
  process.exitCode = 1;
} else {
  console.log(`Glossary 检查通过：${managedFiles.length} 个受管文件无禁用词。`);
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") {
        continue;
      }
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }

    if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) {
      continue;
    }
    if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name) || entry.name === "glossary.ts") {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function isExempt(relativePath, bannedTerm) {
  return TERM_EXEMPTIONS.get(relativePath)?.has(bannedTerm) === true;
}

function containsBannedTerm(line, bannedTerm, canonicalTerm) {
  if (!line.includes(bannedTerm)) {
    return false;
  }

  if (!canonicalTerm.includes(bannedTerm) || canonicalTerm === bannedTerm) {
    return true;
  }

  return line.split(canonicalTerm).join("").includes(bannedTerm);
}

function validateGlossary(value) {
  if (!value || typeof value !== "object" || !value.terms || !Array.isArray(value.bannedTerms)) {
    throw new Error("glossary-data.json 结构无效。需要 terms 对象和 bannedTerms 数组。");
  }

  const seen = new Set();
  for (const entry of value.bannedTerms) {
    if (
      !entry ||
      typeof entry.banned !== "string" ||
      entry.banned.trim().length === 0 ||
      typeof entry.useInstead !== "string" ||
      typeof value.terms[entry.useInstead] !== "string"
    ) {
      throw new Error("glossary-data.json 包含无效禁用词映射。");
    }
    if (seen.has(entry.banned)) {
      throw new Error(`glossary-data.json 包含重复禁用词：${entry.banned}`);
    }
    seen.add(entry.banned);
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
