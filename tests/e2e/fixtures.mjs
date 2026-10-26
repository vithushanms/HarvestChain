// Shared e2e fixtures: static server, console-error collector, tap/key helpers, save-state reader.
import { test as base, expect, chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { startServer } from './server.mjs';
import { readState } from '../helpers.mjs';
import { STATE } from '../helpers.mjs';

export { expect };

// No browser installed -> skip (so a bare checkout does not fail); `npm run test:e2e` sets HC_E2E=1 to make it an error.
export const haveBrowser = existsSync(chromium.executablePath());
if (!haveBrowser && process.env.HC_E2E) throw new Error('chromium is not installed: run `npx playwright install chromium`');

// Per-project tap coordinates (CSS px). Layout is the module's business; these only point at known controls.
export const POS = {
  phone: { tile: [150, 400], wheat: [180, 476], endDay: [320, 26], tab: (i) => [36 + i * 72, 620] },
  desktop: { tile: [330, 540], wheat: [1000, 240], endDay: [1200, 25], tab: (i) => [812 + i * 104, 80] },
};

export const test = base.extend({
  server: [async ({}, use) => { const s = await startServer(); await use(s); await s.close(); }, { scope: 'worker' }],
  errors: async ({}, use) => { await use([]); },
  game: async ({ page, server, errors }, use, info) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const pos = POS[info.project.name];
    const mobile = info.project.use.isMobile;
    const g = {
      page, url: server.url, pos, mobile,
      open: async (path = '') => { await page.goto(server.url + path); await g.ready(); },
      ready: () => page.waitForFunction(() => window.__hc && window.__hc.t1 > 0),
      reload: async () => { await page.reload(); await g.ready(); },
      tap: async ([x, y]) => { if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await g.settle(); },
      press: async (code) => { await page.keyboard.press(code); await g.settle(); },
      // wait until the frame loop has gone idle or ambient-only for a moment
      settle: () => page.waitForTimeout(250),
      announce: () => page.evaluate(() => document.getElementById('a').textContent),
      frames: () => page.evaluate(() => window.__hc.n),
      raw: (k) => page.evaluate((key) => localStorage.getItem(key), k),
      setRaw: (k, v) => page.evaluate(([key, val]) => localStorage.setItem(key, val), [k, v]),
      // the persisted save decoded through tools/state.json (null when absent)
      save: async () => {
        const b64 = await g.raw('hc.save');
        if (!b64) return null;
        const bytes = Buffer.from(b64, 'base64');
        const mem = new Uint8Array(STATE.base + bytes.length);
        mem.set(bytes, STATE.base);
        return readState(mem);
      },
      // pixel statistics of the canvas as drawn by the loader
      pixels: () => page.evaluate(() => {
        const c = document.getElementById('c');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const seen = new Set();
        let sum = 0, sum2 = 0;
        const n = c.width * c.height;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const l = d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11;
          sum += l; sum2 += l * l;
          if (seen.size < 64) seen.add((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
        }
        return { w: c.width, h: c.height, variance: sum2 / n - (sum / n) ** 2, colors: seen.size };
      }),
    };
    await use(g);
  },
});
