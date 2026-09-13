import { defineConfig, devices } from "@playwright/test";
import { CI_E2E_APP_ORIGIN } from "./config/ci-e2e-environment";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Browser E2E runs only against the disposable GitHub CI stack.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A failed scenario already fails CI; stop early to make diagnosis prompt.
  // A successful run must still execute all eight scenarios.
  maxFailures: 1,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: CI_E2E_APP_ORIGIN,
    headless: true,
    serviceWorkers: "block",
    acceptDownloads: false,
    // Login is real, so do not persist token-bearing traces, videos or HAR.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --config vite.e2e.config.ts --mode e2e",
    url: CI_E2E_APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
