// Shared e2e fixtures: static server, console-error collector, tap/key helpers, save-state reader.
import { test as base, expect, chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
import { readState } from '../helpers.mjs';
import { STATE } from '../helpers.mjs';

export { expect };

// No browser installed -> skip (so a bare checkout does not fail); `npm run test:e2e` sets HC_E2E=1 to make it an error.
export const haveBrowser = existsSync(chromium.executablePath());
if (!haveBrowser && process.env.HC_E2E) throw new Error('chromium is not installed: run `npx playwright install chromium`');

export const test = base.extend({
  server: [async ({}, use) => { const s = await startServer(); await use(s); await s.close(); }, { scope: 'worker' }],
  errors: async ({}, use) => { await use([]); },
  game: async ({ page, server, errors }, use, info) => {
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const mobile = info.project.use.isMobile;
    const g = {
      page, url: server.url, mobile,
      // Serve build/game.test.wasm (t_* hooks) instead of the shipping module; taps are then derived from the module.
      hooks: async () => {
        // no service worker in hook mode: it would cache the shipping wasm and serve it after a reload
        await page.addInitScript(() => Object.defineProperty(navigator, 'serviceWorker', { value: undefined }));
        await page.route('**/game.wasm', (r) => r.fulfill({ body: readFileSync('build/game.test.wasm'), contentType: 'application/wasm' }));
      },
      // Wrap the instance's exports: call counts in __calls, pointer/key args in __log, throw from export named by __trap.
      instrument: () => page.addInitScript(() => {
        const calls = (window.__calls = {}); window.__log = []; window.__trap = null;
        const wrap = (r) => {
          const ex = {};
          for (const [k, v] of Object.entries(r.instance.exports)) {
            ex[k] = typeof v !== 'function' ? v : (...a) => {
              calls[k] = (calls[k] || 0) + 1;
              if (k === 'pointer' || k === 'key') window.__log.push([k, ...a]);
              if (window.__trap === k) throw new WebAssembly.RuntimeError('boom');
              return v(...a);
            };
          }
          return { module: r.module, instance: { exports: ex } };
        };
        const is = WebAssembly.instantiateStreaming, ia = WebAssembly.instantiate;
        WebAssembly.instantiateStreaming = (...a) => is.apply(WebAssembly, a).then(wrap);
        WebAssembly.instantiate = (...a) => ia.apply(WebAssembly, a).then((r) => (r.instance ? wrap(r) : r));
      }),
      // CSS-px centre of a hit region (needs hooks()); code is a HIT_* code
      hit: async (code) => page.evaluate((c) => {
        const ex = window.__hc.ex, k = innerWidth / ex.fb_w(), v = (i) => ex.t_hit(c, i);
        if (v(0) < 0) return null;
        return [(v(0) + v(2) / 2) * k, (v(1) + v(3) / 2) * k];
      }, code),
      tileAt: (i) => page.evaluate((i) => {
        const ex = window.__hc.ex, k = innerWidth / ex.fb_w();
        return [(ex.t_tile_rect(i, 0) + ex.t_tile_rect(i, 2) / 2) * k, (ex.t_tile_rect(i, 1) + ex.t_tile_rect(i, 3) / 2) * k];
      }, i),
      // CSS-px centre of the first drawn button whose label matches (needs hooks()); draw list = 64 x 64 B {code, enabled, label}
      button: (label) => page.evaluate((re) => {
        const ex = window.__hc.ex, m = new Uint8Array(ex.memory.buffer), k = innerWidth / ex.fb_w();
        for (let i = 0; i < 64; i++) {
          const p = ex.t_ui_btn(i);
          const code = new DataView(m.buffer).getInt32(p, true);
          let s = '';
          for (let j = 8; j < 36 && m[p + j]; j++) s += String.fromCharCode(m[p + j]);
          if (code && new RegExp(re).test(s)) {
            const v = (n) => ex.t_hit(code, n);
            if (v(0) >= 0) return [(v(0) + v(2) / 2) * k, (v(1) + v(3) / 2) * k];
          }
        }
        return null;
      }, label.source),
      // Every boot shows the Title (Task 5c): open / reload leave it with Enter (NEW GAME without a save,
      // CONTINUE with one) unless { title: true }. The morning Gazette's auto-open is off by default
      // (hc.prefs noGazette, only when the test has not stored prefs itself) so End Day keeps the farm.
      open: async (path = '', o = {}) => {
        if (!g.prefsSet) {
          g.prefsSet = 1;
          await page.addInitScript(() => { try { if (localStorage.getItem('hc.prefs') === null) localStorage.setItem('hc.prefs', '{"large":0,"noGazette":1}'); } catch {} });
        }
        await page.goto(server.url + path); await g.ready(); if (!o.title) await g.start();
      },
      ready: () => page.waitForFunction(() => window.__hc && window.__hc.t1 > 0),
      start: async () => { await page.keyboard.press('Enter'); await g.settle(); },
      reload: async (o = {}) => { await page.reload(); await g.ready(); if (!o.title) await g.start(); },
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
        let sum = 0, sum2 = 0, opaque = 0;
        const n = c.width * c.height;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const l = d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11;
          sum += l; sum2 += l * l; if (d[o + 3] === 255) opaque++;
          if (seen.size < 64) seen.add((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
        }
        return { w: c.width, h: c.height, opaque: opaque === n, variance: sum2 / n - (sum / n) ** 2, colors: seen.size };
      }),
    };
    await use(g);
  },
});
