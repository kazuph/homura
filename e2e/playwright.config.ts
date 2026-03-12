import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 1, // WASM instance may need recovery between bursts
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:8787",
    headless: true,
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
    },
  },
});
