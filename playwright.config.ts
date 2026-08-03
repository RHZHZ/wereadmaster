import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.PLAYWRIGHT_E2E_PORT ?? "41731";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eDist = `.codex-temp/playwright-dist-${e2ePort}-${process.pid}`;
const e2eOutput = `.codex-temp/playwright-results-${e2ePort}-${process.pid}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: e2eOutput,
  timeout: 120_000,
  expect: {
    timeout: 7_000
  },
  reporter: [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npx tsc && npx vite build --outDir ${e2eDist} && npx vite preview --outDir ${e2eDist} --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 300_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
