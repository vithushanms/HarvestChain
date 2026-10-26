// Browser smoke tests for the loader, persistence and the service worker (task 6).
// Run: npm run build && npm run test:e2e   (phone 360x640@2 touch, desktop 1280x800; chromium)
import { mkdirSync } from 'node:fs';
import { test, expect, haveBrowser } from './fixtures.mjs';
import { startServer } from './server.mjs';

test.skip(!haveBrowser, 'chromium not installed (npx playwright install chromium)');
mkdirSync('build/shots', { recursive: true });

const noErrors = (errors) => expect(errors, errors.join('\n')).toEqual([]);

test('loads, fills the viewport, draws, no console errors, no horizontal scroll', async ({ game, errors }, info) => {
  const { page } = game;
  await game.open();
  const vp = page.viewportSize();
  const rect = await page.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  expect(rect).toEqual([0, 0, vp.width, vp.height]);
  const px = await game.pixels();
  expect(px.variance).toBeGreaterThan(200);
  expect(px.colors).toBeGreaterThan(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('c')).imageRendering)).toBe('pixelated');
  expect(await page.evaluate(() => document.getElementById('c').getAttribute('role'))).toBe('img');
  expect((await game.save()).day).toBe(1);   // a fresh game is persisted straight away
  await page.screenshot({ path: `build/shots/${info.project.name}-fresh.png` });
  noErrors(errors);
});

test('load timer: first non-blank frame under 100 ms', async ({ game }, info) => {
  await game.open();
  const t1 = await game.page.evaluate(() => window.__hc.t1);
  info.annotations.push({ type: 'first-frame-ms', description: t1.toFixed(1) });
  console.log(`[${info.project.name}] first frame at ${t1.toFixed(1)} ms after navigation start`);
  expect(t1).toBeLessThan(100);
});

test('flow: tap tile, plant, End Day (tap + key), harvest, sell, reload restores', async ({ game, errors }, info) => {
  const { page } = game;
  await game.hooks();                       // taps below are derived from the module's own hit table
  await game.open();
  const before = await game.save();
  await game.tap(await game.tileAt(27));
  expect(await game.announce()).toMatch(/^PLOT 4,4/);
  await page.screenshot({ path: `build/shots/${info.project.name}-sheet.png` });
  await game.tap(await game.button(/^WHEAT/));
  expect(await game.announce()).toBe('PLANTED WHEAT');
  const planted = await game.save();
  expect(planted.cash).toBeLessThan(before.cash);
  await game.tap(await game.hit(1));        // HIT_ENDDAY
  expect(await game.announce()).toMatch(/^DAY 2/);
  expect((await game.save()).day).toBe(2);
  await game.press('KeyE');
  expect((await game.save()).day).toBe(3);
  await game.press('KeyE');
  await game.press('KeyH');
  expect(await game.announce()).toMatch(/^HARVESTED/);
  await game.tap(await game.hit(12));       // HIT_TAB0 + 2: Market
  expect(await game.announce()).toBe('MARKET');
  await game.tap(await game.button(/^SELL$/));
  await game.tap(await game.button(/^WHEAT/));
  await game.tap(await game.button(/^MAX$/));
  const cash0 = (await game.save()).cash;
  await game.tap(await game.button(/^SELL \$[1-9]/));
  const sold = await game.save();
  expect(sold.cash).toBeGreaterThan(cash0);
  await game.reload();
  const again = await game.save();
  expect([again.day, again.cash]).toEqual([sold.day, sold.cash]);
  noErrors(errors);
});

test('tabs: market screenshot and large text', async ({ game, errors }, info) => {
  const { page } = game;
  await game.hooks();
  await game.open();
  await game.press('Digit3');
  await page.screenshot({ path: `build/shots/${info.project.name}-market.png` });
  await game.press('Escape');
  await game.setRaw('hc.prefs', JSON.stringify({ large: 1, noGazette: 0 }));
  await game.reload();
  expect((await game.page.evaluate(() => window.__hc.ex.get_flags())) & 1).toBe(1);
  await page.screenshot({ path: `build/shots/${info.project.name}-large.png` });
  await game.tap(await game.tileAt(27));
  await page.screenshot({ path: `build/shots/${info.project.name}-large-sheet.png` });
  noErrors(errors);
});

test('prefs persist when the module flips them', async ({ game }) => {
  await game.open();
  await game.page.evaluate(() => { window.__hc.ex.set_pref(0, 1); });
  await game.page.evaluate(() => window.dispatchEvent(new Event('resize')));   // schedules a frame -> prefs sync
  await game.settle();
  expect(JSON.parse(await game.raw('hc.prefs')).large).toBe(1);
});

const bad = {
  'random bytes': () => Buffer.from(Array.from({ length: 1456 }, (_, i) => (i * 73 + 11) & 255)).toString('base64'),
  'not base64': () => '%%%not base64%%%',
  empty: () => '',
  'one byte': () => 'AA==',
  truncated: (good) => Buffer.from(good, 'base64').subarray(0, 300).toString('base64'),
  'oversized': () => Buffer.alloc(40000, 7).toString('base64'),
  'wrong magic': (good) => { const b = Buffer.from(good, 'base64'); b[0] = 0x58; b[1] = 0x58; return b.toString('base64'); },
  'future version': (good) => { const b = Buffer.from(good, 'base64'); b[2] = 0xff; b[3] = 0xff; return b.toString('base64'); },
};
for (const [name, make] of Object.entries(bad)) {
  test(`corrupt save (${name}) falls back to a new game`, async ({ game, errors }) => {
    await game.hooks();
    await game.open();
    await game.press('KeyE');
    const good = await game.raw('hc.save');
    expect((await game.save()).day).toBe(2);
    await game.setRaw('hc.save', make(good));
    await game.reload();
    const px = await game.pixels();
    expect(px.variance).toBeGreaterThan(200);
    expect((await game.save()).day).toBe(1);   // new game, and the bad save has been overwritten
    await game.tap(await game.tileAt(27));
    expect(await game.announce()).toMatch(/^PLOT/);
    noErrors(errors);
  });
}

for (const prefs of ['"x"', 'null', '[1,2]', '{"large":"yes","noGazette":[]}', 'garbage{', '{}', '42']) {
  test(`odd prefs ${prefs} are tolerated`, async ({ game, errors }) => {
    await game.open();
    await game.setRaw('hc.prefs', prefs);
    await game.reload();
    expect((await game.pixels()).variance).toBeGreaterThan(200);
    noErrors(errors);
  });
}

test('offline reload works after the service worker installs', async ({ game, errors, page }) => {
  await game.open();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                 // controlled by the SW from here on
  await game.ready();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map((r) => new URL(r.url).pathname).sort());
  expect(cached).toEqual(['/', '/game.wasm', '/index.html']);
  await page.context().setOffline(true);
  await page.reload();
  await game.ready();
  expect((await game.pixels()).variance).toBeGreaterThan(200);
  await page.context().setOffline(false);
  noErrors(errors);
});

test('held key (auto-repeat) acts once; blur releases held keys', async ({ game, errors }) => {
  const { page } = game;
  await game.open();
  await page.keyboard.down('KeyE');
  await page.keyboard.down('KeyE');     // playwright marks these as event.repeat
  await page.keyboard.down('KeyE');
  await page.keyboard.up('KeyE');
  await game.settle();
  expect((await game.save()).day).toBe(2);
  // two real (non-repeat) downs with no up between them: the module ignores the second until an up...
  const kd = () => page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', cancelable: true })));
  await kd(); await game.settle();
  expect((await game.save()).day).toBe(3);
  await kd(); await game.settle();
  expect((await game.save()).day).toBe(3);
  // ...but window blur sends the up, so the next press counts
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await kd(); await game.settle();
  expect((await game.save()).day).toBe(4);
  noErrors(errors);
});

test('ctrl/meta shortcuts are not swallowed; mapped keys are prevented', async ({ game }) => {
  await game.open();
  const r = await game.page.evaluate(() => {
    const f = (init) => { const e = new KeyboardEvent('keydown', { cancelable: true, ...init }); dispatchEvent(e); return e.defaultPrevented; };
    return [f({ code: 'KeyR', ctrlKey: true }), f({ code: 'KeyR', metaKey: true }), f({ code: 'KeyQ' }), f({ code: 'ArrowDown' })];
  });
  expect(r).toEqual([false, false, false, true]);
});

test('rotate keeps the game running and re-fits; resize storm does not crash', async ({ game, errors }) => {
  const { page } = game;
  await game.open();
  const { width: w, height: h } = page.viewportSize();
  await page.setViewportSize({ width: h, height: w });
  await game.settle();
  let rect = await page.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return [r.width, r.height]; });
  expect(rect).toEqual([h, w]);
  const px = await game.pixels();
  expect(px.variance).toBeGreaterThan(200);
  expect(px.opaque, 'every pixel drawn: a stale (detached/old-size) ImageData would leave transparent areas').toBe(true);
  expect(await page.evaluate(() => { const c = document.getElementById('c'), e = window.__hc.ex; return [c.width, c.height, e.fb_w(), e.fb_h()]; }))
    .toEqual(await page.evaluate(() => { const e = window.__hc.ex; return [e.fb_w(), e.fb_h(), e.fb_w(), e.fb_h()]; }));
  for (let i = 0; i < 30; i++) await page.setViewportSize({ width: 300 + ((i * 97) % 900), height: 400 + ((i * 53) % 500) });
  await page.setViewportSize({ width: w, height: h });
  await game.settle();
  rect = await page.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return [r.width, r.height]; });
  expect(rect).toEqual([w, h]);
  const px2 = await game.pixels();
  expect(px2.variance).toBeGreaterThan(200);
  expect(px2.opaque).toBe(true);
  await game.press('KeyE');
  expect((await game.save()).day).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  noErrors(errors);
});

test.describe('reduced motion', () => {
  test('idle loop stops calling frame()', async ({ game, errors }) => {
    await game.page.emulateMedia({ reducedMotion: 'reduce' });
    await game.open();
    expect(await game.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await game.page.evaluate(() => window.__hc.ex.get_flags() & 2)).toBe(2);
    await game.settle();
    await game.page.waitForTimeout(1500);   // let toasts / slides finish
    const n0 = await game.frames();
    await game.page.waitForTimeout(1000);
    const n1 = await game.frames();
    console.log(`frame() calls in 1 s idle: ${n1 - n0}`);
    expect(n1 - n0).toBeLessThanOrEqual(2);
    expect(await game.page.evaluate(() => window.__hc.ex.get_flags() & 2)).toBe(2);
    noErrors(errors);
  });
});

test('ambient motion is throttled (not a 60 fps loop)', async ({ game }) => {
  await game.open();
  await game.page.waitForTimeout(1500);
  const n0 = await game.frames();
  await game.page.waitForTimeout(1000);
  const n = (await game.frames()) - n0;
  console.log(`frame() calls in 1 s ambient: ${n}`);
  expect(n).toBeLessThanOrEqual(20);
});

test('hash without replay support is ignored; wrong wasm MIME falls back', async ({ game, errors, page }) => {
  await game.open('#not-a-valid-replay!!');
  expect((await game.pixels()).variance).toBeGreaterThan(200);
  const s = await startServer({ wasmMime: 'text/plain' });
  await page.goto(s.url);
  await game.ready();
  expect((await game.pixels()).variance).toBeGreaterThan(200);
  await s.close();
  noErrors(errors.filter((e) => !/MIME|streaming|Incorrect response/i.test(e)));
});

test('failed wasm load shows a readable message instead of a blank page', async ({ page, server }) => {
  await page.route('**/game.wasm', (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto(server.url);
  await expect(page.locator('body')).toContainText('COULD NOT LOAD GAME');
});

test('no external requests', async ({ game, page }) => {
  const seen = [];
  page.on('request', (r) => { if (!r.url().startsWith(game.url) && !r.url().startsWith('data:')) seen.push(r.url()); });
  await game.open();
  await page.waitForTimeout(300);
  expect(seen).toEqual([]);
});

// ---- failure handling and input robustness (review round 1) ----
const fire = (page, type, id, x = 10, y = 300) => page.evaluate(([t, i, px, py]) => {
  document.getElementById('c').dispatchEvent(new PointerEvent(t, { pointerId: i, isPrimary: true, button: 0, clientX: px, clientY: py, bubbles: true, cancelable: true }));
}, [type, id, x, y]);
const log = (page) => page.evaluate(() => window.__log.filter((l) => l[0] === 'pointer').map((l) => l.slice(1)));

for (const trap of ['frame', 'pointer', 'key']) {
  test(`a wasm trap in ${trap}() shows a message and stops all module calls`, async ({ game }) => {
    const { page } = game;
    await game.instrument();
    await game.open();
    const save0 = await game.raw('hc.save');
    await page.evaluate((t) => { window.__trap = t; }, trap);
    if (trap === 'frame') await page.evaluate(() => dispatchEvent(new Event('resize')));
    else if (trap === 'pointer') await fire(page, 'pointerdown', 1);
    else await page.keyboard.press('KeyE');
    await expect(page.locator('body')).toContainText('SOMETHING WENT WRONG');
    const n = await page.evaluate(() => JSON.stringify(window.__calls));
    await page.evaluate(() => { window.__trap = null; });
    await page.keyboard.press('KeyH');
    await page.evaluate(() => { dispatchEvent(new Event('resize')); dispatchEvent(new Event('blur')); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => JSON.stringify(window.__calls))).toBe(n);
    expect(await game.raw('hc.save')).toBe(save0);
  });
}

test('lost pointer capture releases the pointer; a new press is accepted', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await fire(page, 'pointerdown', 7);
  await page.evaluate(() => document.getElementById('c').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7, isPrimary: true, clientX: 10, clientY: 300 })));
  await fire(page, 'pointerdown', 8);
  const types = (await log(page)).map((l) => l[2]);
  expect(types).toEqual([0, 2, 0]);
});

test('blur sends a release for a pointer whose up never arrived', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await fire(page, 'pointerdown', 7);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await fire(page, 'pointerdown', 8);
  const types = (await log(page)).map((l) => l[2]);
  expect(types.at(0)).toBe(0);
  expect(types.slice(1, -1).at(-1)).toBe(2);
  expect(types.at(-1)).toBe(0);
});

test('a stale pointer (no events for over 1 s) does not block a new press', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await fire(page, 'pointerdown', 7);
  await fire(page, 'pointerdown', 8);                 // too soon: ignored
  expect((await log(page)).map((l) => l[2])).toEqual([0]);
  await page.waitForTimeout(1100);
  await fire(page, 'pointerdown', 8);
  expect((await log(page)).map((l) => l[2])).toEqual([0, 1, 2, 0]);   // stale one is cancelled off-canvas first
});

test('pointercancel on END DAY does not fire it', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.instrument();
  await game.open();
  const [x, y] = await game.hit(1);
  await fire(page, 'pointerdown', 3, x, y);
  await fire(page, 'pointercancel', 3, x, y);
  await game.settle();
  expect((await game.save()).day).toBe(1);
  const l = await log(page);
  expect(l.at(-1)).toEqual([-1, -1, 2]);
  expect(l.some((p) => p[2] === 2 && p[0] >= 0)).toBe(false);
  // a cancelled press on the board must not select a tile either
  const [tx, ty] = await game.tileAt(27);
  await fire(page, 'pointerdown', 4, tx, ty);
  await fire(page, 'pointercancel', 4, tx, ty);
  await game.settle();
  expect(await game.announce()).not.toMatch(/^PLOT/);
  noErrors(errors);
});

test('the loader itself drops auto-repeat keydowns', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await page.evaluate(() => { for (const repeat of [false, true, true, true]) dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat, cancelable: true })); });
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })));
  const keys = await page.evaluate(() => window.__log.filter((l) => l[0] === 'key').map((l) => l.slice(1)));
  expect(keys).toEqual([[1, 1], [1, 0]]);
});

test('a key-up with a modifier held still releases the key', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', cancelable: true }));
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', ctrlKey: true }));
  });
  const keys = await page.evaluate(() => window.__log.filter((l) => l[0] === 'key').map((l) => l.slice(1)));
  expect(keys).toEqual([[1, 1], [1, 0]]);
});

test('storage failures keep the save pending and are retried; no errors', async ({ game, errors }) => {
  const { page } = game;
  await game.open();
  await page.evaluate(() => { window.__real = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await game.press('KeyE');
  expect((await game.save()).day).toBe(1);            // not persisted
  await page.evaluate(() => { Storage.prototype.setItem = window.__real; });
  await page.waitForTimeout(2600);                    // throttled retry
  expect((await game.save()).day).toBe(2);
  noErrors(errors);
});

test('service worker only deletes its own old caches', async ({ game, page }) => {
  await game.open();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async () => { await caches.open('hc-00000000'); await caches.open('someone-else'); });
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.unregister(); });
  await page.reload();
  await game.ready();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => { const k = await caches.keys(); return !k.includes('hc-00000000'); });
  expect(await page.evaluate(() => caches.keys())).toContain('someone-else');
});
