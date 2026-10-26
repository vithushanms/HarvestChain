// Onboarding in the browser (Task 8a): a first visit starts the guided first days on NEW GAME;
// skipping or finishing persists in hc.prefs across reloads; odd prefs are tolerated.
import { test, expect, haveBrowser } from './fixtures.mjs';

test.skip(!haveBrowser, 'chromium not installed');

const SKIP = 0x3DC;
const step = (game) => game.page.evaluate(() => window.__hc.ex.t_tut(0));
const noErrors = (errors) => expect(errors).toEqual([]);
// a first visit: no hc.prefs at all (the fixture's default prefs are skipped)
const firstVisit = async (game, prefs) => {
  game.prefsSet = 1;
  await game.hooks();
  if (prefs !== undefined) await game.page.addInitScript((p) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('hc.prefs', p); sessionStorage.setItem('seeded', '1'); } } catch {} }, prefs);
  await game.open('', { title: true });
};

test('first visit: NEW GAME shows the tutorial; SKIP persists across a reload', async ({ game, errors }) => {
  await firstVisit(game);
  expect(JSON.parse(await game.raw('hc.prefs')).tut).toBe(0);   // (the loader writes the defaults after the first frame)
  await game.start();                                   // Enter = NEW GAME (no save)
  expect(await step(game)).toBe(1);
  expect(await game.announce()).toBe('STEP 1 OF 6: TAP AN EMPTY PLOT');
  await game.page.screenshot({ path: `build/shots/${game.mobile ? 'phone' : 'desktop'}-tutorial.png` });
  await game.tap(await game.hit(SKIP));
  expect(await step(game)).toBe(0);
  expect(JSON.parse(await game.raw('hc.prefs')).tut).toBe(1);
  await game.reload();                                  // Enter = CONTINUE
  expect((await game.page.evaluate(() => window.__hc.ex.get_flags())) & 8).toBe(8);
  expect(await step(game)).toBe(0);
  expect(await game.hit(SKIP)).toBe(null);
  noErrors(errors);
});

test('following the hints to the end (play): done persists', async ({ game, errors }) => {
  await firstVisit(game);
  await game.start();
  expect(await step(game)).toBe(1);
  // plant through the real UI: the plot, then the Wheat row
  const t = await game.page.evaluate(() => window.__hc.ex.t_tut(12) & 63);
  await game.tap(await game.tileAt(t));
  await game.tap(await game.hit(0x210));
  expect(await step(game)).toBe(2);
  await game.press('KeyE');
  expect(await step(game)).toBe(3);
  await game.press('Escape');                           // the morning Gazette (auto-open on a first visit)
  await game.press('KeyH');
  expect(await step(game)).toBe(4);
  // the rest by the module's own step setter, then the ALL SET card's DONE
  await game.page.evaluate(() => { window.__hc.ex.set_pref(4, 7); window.dispatchEvent(new Event('resize')); });
  await game.settle();
  expect(await step(game)).toBe(7);
  expect(JSON.parse(await game.raw('hc.prefs')).tut).toBe(1);
  await game.tap(await game.hit(SKIP));
  expect(await step(game)).toBe(0);
  await game.reload();
  expect(await step(game)).toBe(0);
  noErrors(errors);
});

for (const prefs of ['garbage{', 'null', '{"tut":"yes"}', '{"tut":0}']) {
  test(`prefs ${prefs}: tolerated, the tutorial still starts or stays done as stored`, async ({ game, errors }) => {
    await firstVisit(game, prefs);
    await game.start();
    expect(await step(game)).toBe(prefs === '{"tut":"yes"}' ? 0 : 1);
    expect((await game.pixels()).variance).toBeGreaterThan(200);
    noErrors(errors);
  });
}
