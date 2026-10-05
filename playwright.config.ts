import { defineConfig } from '@playwright/test'

// The product film is H.264, which every shipping browser plays but
// Playwright's bundled Chromium does not: that build omits proprietary
// codecs, so canPlayType('video/mp4; codecs="avc1.42E01E"') returns "" and
// any assertion that playback advances fails on a video that is perfectly
// fine in front of a customer. Google Chrome carries the codecs, so the
// journey checks run there and exercise the same decode path real visitors do.
//
// CHROME_PATH still wins when set, for a machine that has its own build.
const executablePath = process.env.CHROME_PATH

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : { channel: 'chrome' }),
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5179',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
  },
})
