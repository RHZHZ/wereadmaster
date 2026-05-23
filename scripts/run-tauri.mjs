import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const defaultKeyPath = join(homedir(), ".tauri", "wxreadmaster.key");
const cliEntry = join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js"
);

const args = process.argv.slice(2);
const needsSigningKey = args.includes("build") || args.includes("bundle");
const env = { ...process.env };

if (needsSigningKey && !env.TAURI_SIGNING_PRIVATE_KEY && existsSync(defaultKeyPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(defaultKeyPath, "utf8");
}

const child = spawn(process.execPath, [cliEntry, ...args], {
  stdio: "inherit",
  env,
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
