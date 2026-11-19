import { defineConfig } from '@playwright/test'

// The e2e tests launch the built Electron app (out/), always with TORNO_TEST=1
// so no window is ever shown. One worker: the tests share one GPU and display.
// And no kernel the app starts under test lets a build go for want of memory: the specs pass their environment on.
process.env.TORNO_KEEP_BUILDS = '1'

export default defineConfig({
  testDir: './e2e',
  // The evals run the real Claude Code: never a test (`src/evals.test.ts`).
  testIgnore: ['**/evals/**'],
  workers: 1,
  // A runner's timing flakes a spec now and then (a double click that lands as two clicks while the window is busy):
  // CI tries a failed spec once more, and the report says which passed only on the second try. A desktop does not.
  retries: process.env.CI ? 1 : 0,
  // A runner is slower than the desktop the timings were set on (the kernel's first build most of all): CI gets twice
  // the test timeout and three times the wait for an expectation.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: 'list',
  outputDir: './e2e/.results'
})
