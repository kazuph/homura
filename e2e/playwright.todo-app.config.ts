import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.TODO_APP_PORT || "8793");
const baseURL = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
    },
  },
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND || `pnpm --dir examples/todo-app run dev:e2e`,
    cwd: repoRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
