// Packaging (Task 8b): the three files in dist/ (npm run dist) are the whole game. Served alone from a
// static server, at the root and under a sub-path (a GitHub Pages project site), the game loads, plays,
// saves, reloads and works offline through its service worker; every URL the loader and the worker use
// is relative, and nothing outside the three files is requested.
import { test, expect } from './fixtures.mjs';
import { startServer } from './server.mjs';

const FILES = ['', 'index.html', 'game.wasm', 'sw.js'];

for (const prefix of ['/', '/sub/path/']) {
  test(`dist works under ${prefix}: load, plant, End Day, reload, offline`, async ({ game, errors, page }) => {
    const server = await startServer({ dir: 'dist', prefix });
    try {
      await page.addInitScript(() => { try { if (localStorage.getItem('hc.prefs') === null) localStorage.setItem('hc.prefs', '{"large":0,"noGazette":1,"tut":1}'); } catch {} });
      await page.goto(server.url); await game.ready(); await game.start();
      expect((await game.pixels()).variance).toBeGreaterThan(200);
      // plant through the public act() export (the shipping binary has no test hooks to locate a plot),
      // then End Day with the real key: the loader persists the save
      const err = await page.evaluate(() => {
        const ex = window.__hc.ex;
        for (let i = 0; i < 64; i++) if (ex.act(1, i, 0, 0) === 0) return 0;
        return -1;
      });
      expect(err).toBe(0);
      await game.press('KeyE');
      const s = await game.save();
      expect(s.day).toBe(2);
      expect(s.tiles.some((t) => t.kind === 1)).toBe(true);
      await game.reload();
      expect((await game.save()).day).toBe(2);
      // the service worker registers relative to the page: scope = the sub-path, cache = the three files
      await page.evaluate(() => navigator.serviceWorker.ready);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope)).toBe(server.url);
      await page.reload();
      await game.ready();
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map((r) => new URL(r.url).pathname).sort());
      expect(cached).toEqual([prefix, `${prefix}game.wasm`, `${prefix}index.html`].sort());
      await page.context().setOffline(true);
      await page.reload();
      await game.ready();
      expect((await game.pixels()).variance).toBeGreaterThan(200);
      await page.context().setOffline(false);
      // only the shipped files were ever requested, all under the prefix
      expect([...new Set(server.hits)].every((h) => FILES.some((f) => h === prefix + f))).toBe(true);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}
