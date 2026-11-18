import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui', testIgnore:'**/._*',timeout: 30000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3321', headless: true, browserName: 'chromium', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/ui-server.mjs', url: 'http://127.0.0.1:3321/api/health', reuseExistingServer: false },
})
