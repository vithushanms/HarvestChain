// Canned farm scenes for render tests and tools/dump-ppm.mjs. Each builder pokes the sim
// state directly (init + byte writes via tools/state.json offsets); nothing here runs actions.
import { STATE, loadGame } from '../helpers.mjs';

const F = STATE.fields;
const base = STATE.base;
export const CROP = { WHEAT: 0, CORN: 1, TOMATO: 2, APPLE: 3, GRAPE: 4 };
export const BLD = { MILL: 0, CANNERY: 1, PRESS: 2, BAKERY: 3, CELLAR: 4, WAREHOUSE: 5, COLD: 6, GREENHOUSE: 7, WELL: 8, GARAGE: 9 };
export const W = { SUNNY: 0, RAIN: 1, DROUGHT: 2, STORM: 3, FROST: 4, HEAT: 5 };
export const GROW = [300, 400, 300, 800, 600];  // growDays * 100 (apple regrow 300)

export function farm(ex) {
  const dv = () => new DataView(ex.memory.buffer);
  const put8 = (off, v) => dv().setUint8(base + off, v);
  const put16 = (off, v) => dv().setUint16(base + off, v, true);
  const tileOff = (i) => F.tiles.off + i * F.tiles.stride;
  const api = {
    grid(g) { put8(F.grid.off, g); return api; },
    day(d) { put16(F.day.off, d); return api; },
    weather(w) { ex.t_set_weather(w); return api; },
    clear() { for (let i = 0; i < 64; i++) for (let b = 0; b < 8; b++) put8(tileOff(i) + b, 0); return api; },
    // stage: number = progress, or 'ripe'
    crop(i, c, progress, o = {}) {
      const t = tileOff(i);
      put8(t, 1); put8(t + 1, c);
      put16(t + 2, progress === 'ripe' ? (o.mature ? 300 : GROW[c]) : progress);
      put8(t + 4, o.ripeAge ?? 0); put8(t + 5, o.mature ? 1 : 0); put8(t + 6, 0); put8(t + 7, 0);
      return api;
    },
    bld(i, b, o = {}) {
      const t = tileOff(i);
      put8(t, 2); put8(t + 1, b); put16(t + 2, o.progress ?? 0); put8(t + 4, 0);
      put8(t + 5, (o.upgraded ? 2 : 0) | (o.mature ? 1 : 0)); put8(t + 6, o.gh ?? 0); put8(t + 7, o.recipe ?? 0);
      return api;
    },
    truck(n, o) {
      const t = F.trucks.off + n * F.trucks.stride;
      put8(t, 1); put8(t + 1, o.dest ?? 0); put8(t + 2, o.phase ?? 0); put8(t + 3, o.daysLeft ?? 0);
      put8(t + 4, (o.cap ?? 0) | (o.fridge ? 4 : 0) | (o.fast ? 8 : 0)); put8(t + 5, 255);
      if (n + 1 > dv().getUint8(base + F.truckCount.off)) put8(F.truckCount.off, n + 1);
      return api;
    },
    fillStorage() { ex.t_give(0, Math.max(0, ex.storage_cap() - ex.storage_used()), 0); return api; },
  };
  return api;
}

const idx = (x, y) => y * 8 + x;

export const SCENES = {
  'farm-day1': (ex) => { ex.init(7); },
  'farm-mid': (ex) => {
    ex.init(3);
    farm(ex).clear().grid(6).day(30)
      .crop(idx(0, 0), CROP.WHEAT, 'ripe').crop(idx(1, 0), CROP.WHEAT, 120).crop(idx(2, 0), CROP.WHEAT, 40)
      .crop(idx(0, 1), CROP.CORN, 'ripe').crop(idx(1, 1), CROP.CORN, 200).crop(idx(2, 1), CROP.TOMATO, 'ripe')
      .crop(idx(0, 2), CROP.TOMATO, 150).crop(idx(1, 2), CROP.APPLE, 420).crop(idx(2, 2), CROP.GRAPE, 'ripe')
      .crop(idx(5, 0), CROP.GRAPE, 300).crop(idx(5, 1), CROP.APPLE, 'ripe', { mature: true })
      .bld(idx(4, 1), BLD.MILL, { recipe: 1 }).bld(idx(4, 3), BLD.CANNERY, { recipe: 1 })
      .bld(idx(1, 4), BLD.WAREHOUSE).bld(idx(3, 5), BLD.GARAGE).crop(idx(0, 5), CROP.CORN, 60)
      .truck(0, {}).truck(1, { phase: 1, dest: 1, daysLeft: 1 });
  },
  'farm-winter': (ex) => {
    ex.init(5);
    farm(ex).clear().grid(5).day(66)
      .crop(idx(0, 0), CROP.APPLE, 100, { mature: true }).crop(idx(1, 0), CROP.APPLE, 100, { mature: true })
      .crop(idx(0, 1), CROP.WHEAT, 150).crop(idx(1, 1), CROP.CORN, 120)
      .bld(idx(3, 0), BLD.BAKERY, { recipe: 1 }).bld(idx(3, 2), BLD.WAREHOUSE).bld(idx(1, 3), BLD.WELL)
      .bld(idx(3, 4), BLD.GREENHOUSE, { gh: CROP.TOMATO + 1, progress: 300 }).truck(0, {});
  },
  'farm-storm': (ex) => { SCENES['farm-mid'](ex); farm(ex).weather(W.STORM); },
  'farm-allbld': (ex) => {
    ex.init(11);
    const f = farm(ex).clear().grid(6).day(28);
    const spots = [idx(0, 0), idx(2, 0), idx(4, 0), idx(1, 2), idx(3, 2), idx(5, 2), idx(0, 4), idx(2, 4), idx(4, 4), idx(5, 5)];
    spots.forEach((s, b) => f.bld(s, b, { upgraded: b % 2 === 1, recipe: b < 4 ? 1 : 0,
      gh: b === BLD.GREENHOUSE ? CROP.GRAPE + 1 : 0, progress: b === BLD.GREENHOUSE ? 600 : 0 }));
    f.truck(0, {}).truck(1, { fridge: true }).truck(2, { fast: true });
  },
  'farm-full': (ex) => {
    ex.init(9);
    const f = farm(ex).clear().grid(8).day(35);
    for (let i = 0; i < 64; i++) {
      const n = (i * 7 + 3) % 16;
      if (n < 10 && i % 3 === 0) f.bld(i, n, { upgraded: i % 2 === 0, recipe: i % 4 === 0 ? 1 : 0,
        gh: n === BLD.GREENHOUSE ? CROP.CORN + 1 : 0, progress: 250 });
      else { const c = i % 5; f.crop(i, c, i % 4 === 0 ? 'ripe' : Math.floor(GROW[c] * ((i % 4) / 4))); }
    }
    f.truck(0, {}).truck(1, { phase: 1, dest: 2, daysLeft: 1 }).truck(2, { phase: 2, dest: 1, daysLeft: 1, fridge: true });
  },
  'farm-truck': (ex) => {
    ex.init(4);
    farm(ex).clear().grid(5).day(24)
      .crop(idx(0, 0), CROP.CORN, 'ripe').crop(idx(1, 0), CROP.CORN, 300).crop(idx(0, 1), CROP.TOMATO, 200)
      .bld(idx(3, 1), BLD.GARAGE, { upgraded: true }).bld(idx(2, 3), BLD.COLD)
      .truck(0, {}).truck(1, { phase: 1, dest: 2, daysLeft: 2, fast: true }).truck(2, { phase: 2, dest: 2, daysLeft: 1, fridge: true });
  },
  'farm-frost': (ex) => {
    ex.init(6);
    farm(ex).clear().grid(5).day(52).weather(W.FROST)
      .crop(idx(0, 0), CROP.GRAPE, 'ripe').crop(idx(1, 0), CROP.GRAPE, 400).crop(idx(2, 0), CROP.APPLE, 'ripe', { mature: true })
      .crop(idx(0, 1), CROP.WHEAT, 'ripe').crop(idx(1, 1), CROP.WHEAT, 200).bld(idx(3, 1), BLD.PRESS, { recipe: 1 })
      .bld(idx(1, 3), BLD.CELLAR, { upgraded: true }).truck(0, {});
  },
  'farm-ripe': (ex) => {
    ex.init(8);
    const f = farm(ex).clear().grid(5).day(12);
    for (let i = 0; i < 10; i++) f.crop(idx(i % 5, i / 5 | 0), i % 5, 'ripe', { mature: i % 5 === 3 });
    f.crop(idx(0, 2), CROP.TOMATO, 'ripe', { ripeAge: 1 }).bld(idx(3, 3), BLD.WAREHOUSE).fillStorage().truck(0, {});
  },
  'farm-rain': (ex) => { SCENES['farm-mid'](ex); farm(ex).weather(W.RAIN); },
  'farm-drought': (ex) => { SCENES['farm-mid'](ex); farm(ex).weather(W.DROUGHT); },
  'farm-heat': (ex) => { SCENES['farm-mid'](ex); farm(ex).weather(W.HEAT); },
  'farm-autumn': (ex) => { SCENES['farm-mid'](ex); farm(ex).day(48); },
  'farm-spring': (ex) => { SCENES['farm-mid'](ex); farm(ex).day(6); },
};

// Build a scene and draw it. Returns the game handle (framebuffer drawn).
export async function sceneGame(name, w = 360, h = 640, t = 1000, o = {}) {
  const g = await loadGame();
  g.ex.resize(w, h, 100);
  g.ex.t_scene_viewport(0, 0, 0, 0);   // resize() applies the layout GRID; scene goldens pin the default fit
  SCENES[name](g.ex);
  drawScene(g, t, o);
  return g;
}

export function drawScene(g, t = 1000, o = {}) {
  g.ex.t_scene_flags(o.reduced ? 1 : 0, o.sel ?? -1, o.hover ?? -1);
  g.ex.t_scene_time(t);
  g.ex.t_scene_draw();
}
