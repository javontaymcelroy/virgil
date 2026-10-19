// End-to-end tests drive the Vite-served UI in WebKit (the app's engine) with a Tauri IPC
// shim (tests/e2e/tauri-shim.js), since tauri-driver has no macOS build.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  timeout: 20000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:1420", colorScheme: "light" },
  webServer: { command: "npm run dev", port: 1420, reuseExistingServer: true, timeout: 30000 },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } }],
});
