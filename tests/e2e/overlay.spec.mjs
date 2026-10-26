// Task 7c: the loader's live metrics (set_metrics), the stats overlay (Backquote / triple tap) and the
// load line after a service-worker (cached) reload. Run: npm run test:e2e.
import { statSync } from 'node:fs';
import { test, expect, haveBrowser } from './fixtures.mjs';

test.skip(!haveBrowser, 'chromium not installed (npx playwright install chromium)');
const noErrors = (errors) => expect(errors, errors.join('\n')).toEqual([]);
const kb = (b) => { const t = Math.floor((b * 10 + 512) / 1024); return `${Math.floor(t / 10).toLocaleString('en-US')}.${t % 10}`; };
const metrics = (page) => page.evaluate(() => window.__hc.m);
const line = (page, i) => page.evaluate((k) => {
  const ex = window.__hc.ex, m = new Uint8Array(ex.memory.buffer); let p = ex.t_ovl_line(k), s = '';
  while (m[p]) s += String.fromCharCode(m[p++]);
  return s;
}, i);
// a hash of the canvas as drawn by the loader
const canvas = (page) => page.evaluate(() => {
  const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + (d[i + 1] << 8) + (d[i + 2] << 16)) | 0;
  return h;
});

test('the loader passes plausible live numbers: load ms, wasm raw = file size, frame and End Day times', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();                                   // build/game.test.wasm, no service worker
  await game.open();
  const [ms, transfer, wire, raw] = await metrics(page);
  const size = statSync('build/game.test.wasm').size;
  expect(ms).toBeGreaterThanOrEqual(1);
  expect(ms).toBeLessThanOrEqual(5000);
  expect(raw).toBe(size);                               // decodedBodySize of the fetched module
  expect(wire).toBe(size);                              // the test server does not compress: WIRE = raw
  expect(transfer).toBeGreaterThan(size);               // + the page itself (and headers)
  expect(await line(page, 1)).toBe(`WASM RAW ${kb(size)} KB`);
  expect(await line(page, 4)).toBe(`LOAD TIME ${ms.toLocaleString('en-US')} MS`);
  const load = await page.evaluate(() => { const ex = window.__hc.ex, m = new Uint8Array(ex.memory.buffer); let p = ex.t_ovl(10), s = ''; while (m[p]) s += String.fromCharCode(m[p++]); return s; });
  expect(load).toBe(`LOADED IN ${ms.toLocaleString('en-US')} MS ^ ${kb(transfer)} KB`);   // the Title / Results load line
  await game.press('KeyE');
  await game.press('KeyH');                             // a frame after the End Day carries its timing
  const m = await metrics(page);
  expect(m[4]).toBeGreaterThan(0);
  expect(m[4]).toBeLessThan(200000);
  expect(m[5]).toBeGreaterThan(0);
  expect(m[5]).toBeLessThan(200000);
  expect(await line(page, 6)).toBe(`LAST END DAY ${m[4].toLocaleString('en-US')} US`);
  noErrors(errors);
});

test('Backquote opens the overlay (pixels change, frames keep coming); Esc closes it', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.open();
  const before = await canvas(page);
  await game.press('Backquote');
  expect(await page.evaluate(() => window.__hc.ex.t_ovl(0))).toBe(1);
  expect(await game.announce()).toBe('STATS ON');
  expect(await canvas(page)).not.toBe(before);
  const n0 = await game.frames();
  await page.waitForTimeout(300);
  expect(await game.frames() - n0).toBeGreaterThan(5);  // live: a frame every animation frame
  expect(await page.evaluate(() => window.__hc.ex.t_ovl(1))).toBeGreaterThan(5);
  await game.press('Escape');
  expect(await page.evaluate(() => window.__hc.ex.t_ovl(0))).toBe(0);
  expect(await game.announce()).toBe('STATS OFF');
  noErrors(errors);
});

test('a quick triple tap on the top-left corner of the canvas opens the overlay', async ({ game, errors }) => {
  const { page, mobile } = game;
  await game.hooks();
  await game.open();
  await game.settle();
  const before = await canvas(page);
  for (let i = 0; i < 3; i++) { if (mobile) await page.touchscreen.tap(8, 8); else await page.mouse.click(8, 8); }
  await game.settle();
  expect(await page.evaluate(() => window.__hc.ex.t_ovl(0))).toBe(1);
  expect(await canvas(page)).not.toBe(before);
  noErrors(errors);
});

test('under prefers-reduced-motion (idle, no frames) a triple tap 100-150 ms apart opens the overlay', async ({ game, errors }) => {
  const { page, mobile } = game;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await game.hooks();
  await game.open();
  await game.settle();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.waitForTimeout(1500);                      // idle: frame() has returned 0 and the loader has stopped
  for (const gap of [0, 130, 110]) {
    await page.waitForTimeout(gap);
    if (mobile) await page.touchscreen.tap(8, 8); else await page.mouse.click(8, 8);
  }
  await game.settle();
  expect(await page.evaluate(() => window.__hc.ex.t_ovl(0))).toBe(1);
  noErrors(errors);
});

test('after a service-worker reload nothing is transferred: the load line says CACHED', async ({ game, errors, page }) => {
  await game.open('', { title: true });
  expect((await metrics(page))[1]).toBeGreaterThan(0);  // the first load came over the network
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                                  // controlled by the SW from here on
  await game.ready();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.reload();
  await game.ready();
  await game.settle();
  const [ms, transfer, , raw] = await metrics(page);
  expect(transfer).toBe(0);
  expect(ms).toBeGreaterThanOrEqual(1);
  expect(raw).toBe(statSync('build/game.wasm').size);
  noErrors(errors);
});
