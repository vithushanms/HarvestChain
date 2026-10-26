// Task 7a loader glue: #code links, paste, clipboard copy, origin, input-log persistence ('hc.log'),
// and the poisoned-save mark around boot. Run: npm run test:e2e.
import { test, expect, haveBrowser } from './fixtures.mjs';
import { loadGame } from '../helpers.mjs';
import { runBot } from '../sim/bot.mjs';
import jsQR from 'jsqr';

test.skip(!haveBrowser, 'chromium not installed (npx playwright install chromium)');
const noErrors = (errors) => expect(errors, errors.join('\n')).toEqual([]);

// A real share code made by the module: the seed-1 bot for 6 days.
const CODE = await (async () => {
  const g = await loadGame(); g.ex.init(1); runBot(g.ex, g.mem, 6);
  const n = g.ex.share_build();
  return Buffer.from(g.mem().slice(g.ex.share_ptr(), g.ex.share_ptr() + n)).toString('latin1');
})();
const WATCH = 0x3D8, COPY = 0x3C8, SCR = 20;
const ui = (page, k) => page.evaluate((i) => window.__hc.ex.t_ui(i), k);
const rp = (page, k) => page.evaluate((i) => window.__hc.ex.t_rp(i), k);
const paste = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, text);

test('a #code link opens the Title with WATCH SHARED RUN; the hash is dropped; WATCH opens the viewer', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.open('#' + CODE, { title: true });
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await ui(page, SCR)).toBe(1);
  expect(await rp(page, 5)).toBe(1);
  expect(await rp(page, 1)).toBe(6);
  await game.tap(await game.hit(WATCH));
  expect(await ui(page, SCR)).toBe(7);
  expect(await game.announce()).toMatch(/^REPLAY\. DAY 0 OF 6/);
  await game.press('Escape');
  expect(await ui(page, SCR)).toBe(1);
  noErrors(errors);
});

test('a garbage hash is ignored without errors (and stays in the address bar)', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.open('#!!garbage' + CODE.slice(3), { title: true });
  expect(await rp(page, 5)).toBe(0);
  expect(await game.hit(WATCH)).toBeNull();
  expect(await page.evaluate(() => location.hash)).not.toBe('');
  noErrors(errors);
});

test('pasting a link or a bare code makes it the pending replay; other text is ignored', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.open('', { title: true });
  await paste(page, 'hello there');
  await game.settle();
  expect(await rp(page, 5)).toBe(0);
  await paste(page, `  https://somewhere.test/x/#${CODE}\n`);
  await game.settle();
  expect(await rp(page, 5)).toBe(1);
  expect(await game.hit(WATCH)).not.toBeNull();
  await game.reload({ title: true });
  expect(await rp(page, 5)).toBe(0);
  await game.start();                                   // mid-game: a bare code takes the player to the Title
  await paste(page, CODE);
  await game.settle();
  expect(await ui(page, SCR)).toBe(1);
  expect(await rp(page, 5)).toBe(1);
  noErrors(errors);
});

test('COPY CODE writes the share link (page URL + # + code) to the clipboard and toasts COPIED!', async ({ game, errors, page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await game.hooks();
  await game.open();
  // jump to the last day, then End Day -> Results
  await page.evaluate(() => { const ex = window.__hc.ex; new DataView(ex.memory.buffer).setUint16(0x100C, 240, true); });
  await game.press('KeyE');
  expect(await ui(page, SCR)).toBe(4);
  await game.tap(await game.hit(COPY));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const want = await page.evaluate(() => { const ex = window.__hc.ex; ex.share_build();
    return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.share_ptr(), ex.share_len())); });
  const here = await page.evaluate(() => location.href.split('#')[0]);
  expect(clip).toBe(`${here}#${want}`);
  expect(clip.startsWith(game.url)).toBe(true);
  expect(await game.announce()).toBe('COPIED!');
  expect(await page.evaluate(() => window.__hc.ex.want_copy())).toBe(0);
  // the copied link opens the same run elsewhere
  const p2 = await page.context().newPage();
  await p2.goto(clip);
  await p2.waitForFunction(() => window.__hc && window.__hc.t1 > 0);
  expect(await p2.evaluate(() => location.hash)).toBe('');   // taken by the module (shipping build: no t_ hooks here)
  noErrors(errors);
});

test('a short run played to Results shows a QR in the page canvas that decodes to page URL + # + code', async ({ game, errors, page }) => {
  await game.hooks();
  await game.open();
  // a few real days through the UI, then jump to the last day and End Day -> Results
  await game.press('KeyE');
  await game.press('KeyE');
  await page.evaluate(() => { const ex = window.__hc.ex; new DataView(ex.memory.buffer).setUint16(0x100C, 240, true); });
  await game.press('KeyE');
  expect(await ui(page, SCR)).toBe(4);
  expect(await page.evaluate(() => window.__hc.ex.t_qr(3))).toBeGreaterThanOrEqual(2);
  // the pixels the loader put on the canvas (whole canvas: jsQR has to find the code among the UI)
  const img = await page.evaluate(() => {
    const c = document.getElementById('c');
    return { w: c.width, h: c.height, d: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
  });
  const r = jsQR(Uint8ClampedArray.from(img.d), img.w, img.h);
  expect(r, 'canvas QR decodes').not.toBeNull();
  const code = await page.evaluate(() => { const ex = window.__hc.ex; ex.share_build();
    return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.share_ptr(), ex.share_len())); });
  const here = await page.evaluate(() => location.href.split('#')[0]);
  expect(r.data).toBe(`${here}#${code}`);
  // the decoded link opens the run elsewhere (WATCH SHARED RUN on the Title)
  const p2 = await page.context().newPage();
  await p2.goto(r.data);
  await p2.waitForFunction(() => window.__hc && window.__hc.t1 > 0);
  expect(await p2.evaluate(() => location.hash)).toBe('');
  noErrors(errors);
});

test('the input log is stored beside the save and restored only when it matches it', async ({ game, errors }) => {
  const { page } = game;
  await game.hooks();
  await game.open();
  await game.press('KeyE');
  await game.press('KeyE');
  expect((await game.save()).day).toBe(3);
  const log = await game.raw('hc.log');
  expect(log).toMatch(/^[A-Za-z0-9_-]{12,}$/);
  await game.reload();
  expect(await page.evaluate(() => window.__hc.ex.t_log_st())).toBe(0);
  expect(await page.evaluate(() => window.__hc.ex.share_build())).toBe(log.length);
  // tampered: another valid log (the bot's) under this save -> NONE, no share code
  await game.setRaw('hc.log', CODE);
  await game.reload();
  expect(await page.evaluate(() => window.__hc.ex.t_log_st())).toBe(2);
  expect(await page.evaluate(() => window.__hc.ex.share_build())).toBe(0);
  await game.setRaw('hc.log', 'garbage!');
  await game.reload();
  expect(await page.evaluate(() => window.__hc.ex.t_log_st())).toBe(2);
  noErrors(errors);
});

test('a trap in ui_boot after a restore marks the save: the next boot starts fresh, the bad copy is kept', async ({ game, errors }) => {
  const { page } = game;
  await game.instrument();
  await page.addInitScript(() => { if (sessionStorage.getItem('trapOnce')) { sessionStorage.removeItem('trapOnce'); window.__trap = 'ui_boot'; } });
  await game.open();
  await game.press('KeyE');
  const good = await game.raw('hc.save');
  await page.evaluate(() => sessionStorage.setItem('trapOnce', '1'));
  await page.reload();                                  // restore, then ui_boot traps -> main() rejects
  await expect(page.getByRole('alert')).toContainText('COULD NOT LOAD GAME');
  expect(await game.raw('hc.bad')).toBe('1');
  expect(await game.raw('hc.save.bad')).toBe(good);
  await game.reload({ title: true });                   // no restore: a plain Title (NEW GAME first)
  expect(await game.announce()).toMatch(/^HARVESTCHAIN\. NEW GAME/);
  expect(await game.raw('hc.bad')).toBe('1');           // still marked until a new save replaces it
  await game.start();
  expect(await game.raw('hc.bad')).toBeFalsy();
  expect(await game.raw('hc.save.bad')).toBe(good);
  noErrors(errors.filter((e) => !/boom/.test(e)));
});

test('a trap after the first good frame does not mark a healthy save', async ({ game }) => {
  const { page } = game;
  await game.instrument();
  await game.open();
  await game.press('KeyE');
  await game.reload();                                  // a restored boot: marked, then cleared by the first frame
  expect(await game.raw('hc.bad')).toBeFalsy();
  await page.evaluate(() => { window.__trap = 'key'; });
  await page.keyboard.press('KeyH');
  await expect(page.getByRole('alert')).toContainText('SOMETHING WENT WRONG');
  expect(await game.raw('hc.bad')).toBeFalsy();
  await page.evaluate(() => { window.__trap = null; });
  await game.reload({ title: true });
  expect(await game.announce()).toMatch(/^HARVESTCHAIN\. CONTINUE/);
});
