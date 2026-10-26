// Browser smoke tests (spec 14.2 loader + PWA). Run with `npm run test:e2e` (needs `npx playwright install chromium`).
// The specs start their own static server (tests/e2e/server.mjs) on a random port, so no webServer is configured.
export default {
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: 'build/e2e-results',
  workers: 2,
  timeout: 30000,
  projects: [
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  ],
};
