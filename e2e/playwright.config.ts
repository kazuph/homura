import { defineConfig } from "@playwright/test";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:8787",
    headless: true,
    browserName: "chromium",
    launchOptions: {
      executablePath: chromePath,
    },
  },
});
