// Deterministic scripted player. A pure function of game state: it reads state through
// readState and the exports, acts only through ex.act, and never uses Math.random or a clock.
// Over 240 days it exercises most of the game: loan, Well, Warehouse, Mill upgrade, Garage +
// second truck + Fast upgrade, City and Town hauls, contracts, Greenhouse, Cold Store and the
// Grape -> Press -> Cellar -> Wine chain. Golden hashes pin all of it.
import { readState } from '../helpers.mjs';

const ACT = { PLANT: 1, HARVEST_ALL: 3, BUILD: 4, UPGRADE_BLD: 6, SET_RECIPE: 7, BUY_LAND: 8, SELL_STAND: 9,
  TRUCK_LOAD: 10, TRUCK_SEND: 12, BUY_TRUCK: 13, UPGRADE_TRUCK: 14, ACCEPT: 15, DECLINE: 16,
  LOAN_TAKE: 17, LOAN_REPAY: 18 };
const B = { MILL: 0, PRESS: 2, CELLAR: 4, WAREHOUSE: 5, COLD: 6, GREENHOUSE: 7, WELL: 8, GARAGE: 9 };
const MILL_TILE = 27, WHEAT_TO_FLOUR = 0, GRAPE_TO_JUICE = 4, JUICE_TO_WINE = 7;
const FLOUR = 5, TOMATO = 2, GRAPE = 4, WINE = 12, TOWN = 1, CITY = 2, NONE = 255, FAST = 2;
const CROP_COST = [10, 12, 15, 40, 30];
const CROP_SEASONS = [7, 6, 3, 7, 6];
const RAW_KEEP = 10;

const count = (s, g) => { let n = 0; for (let a = 0; a < 8; a++) n += s.inv[g * 8 + a]; return n; };
const has = (s, b) => s.tiles.some((t) => t.kind === 2 && t.id === b);
const tileOf = (s, b) => s.tiles.findIndex((t) => t.kind === 2 && t.id === b);

// Observation log for tests: successful action ids and a few state-derived counters.
export const newLog = () => ({ ok: new Set(), loanDays: 0, cityTrips: 0, wineSeen: false, loadFails: 0, phase: [0, 0, 0] });

// One bot day (everything except end_day).
export function botDay(ex, mem, log) {
  let s = readState(mem());
  const act = (...a) => { const e = ex.act(...a); if (log) { if (e === 0) log.ok.add(a[0]); else if (a[0] === ACT.TRUCK_LOAD) log.loadFails++; }
    return e; };
  const fresh = () => (s = readState(mem()));
  if (s.status !== 0 && s.status !== 2) return;

  // money: a small loan on day 3 held until day 20, an emergency loan when broke
  const owed = s.loanPrincipal + s.loanInterest;
  if (owed === 0 && (s.day === 3 || s.cash < 0)) act(ACT.LOAN_TAKE, s.day === 3 ? 300 : 500, 0, 0);
  else if (owed > 0 && s.day >= 20 && s.cash > owed) act(ACT.LOAN_REPAY, owed, 0, 0);

  act(ACT.HARVEST_ALL, 0, 0, 0);

  // a free in-grid tile for a building (highest index first; the Mill tile is reserved)
  const build = (b) => {
    fresh();
    for (let i = 63; i >= 0; i--) {
      if (i === MILL_TILE || (i & 7) >= s.grid || (i >> 3) >= s.grid || s.tiles[i].kind !== 0) continue;
      return act(ACT.BUILD, i, b, 0) === 0 ? i : -1;
    }
    return -1;
  };

  // build the Mill on day 5 (or as soon as it is affordable) on the reserved tile
  if (s.day >= 5 && s.tiles[MILL_TILE].kind === 0 && s.cash >= 250) {
    if (act(ACT.BUILD, MILL_TILE, B.MILL, 0) === 0) act(ACT.SET_RECIPE, MILL_TILE, WHEAT_TO_FLOUR, 0);
  }

  // infrastructure as money and unlocks allow
  fresh();
  if (s.day >= 10 && !has(s, B.WELL)) build(B.WELL);
  fresh();
  if (s.cash > 800 && !has(s, B.WAREHOUSE)) build(B.WAREHOUSE);
  fresh();
  if (s.cash > 1000) act(ACT.UPGRADE_BLD, MILL_TILE, 0, 0);
  fresh();
  if (s.cash > 2500) {
    if (!has(s, B.GARAGE)) build(B.GARAGE);
    fresh();
    if (has(s, B.GARAGE) && !s.trucks[1].present) act(ACT.BUY_TRUCK, 0, 0, 0);
    fresh();
    if (s.trucks[1].present && s.trucks[1].phase === 0 && !(s.trucks[1].upg & 8)) act(ACT.UPGRADE_TRUCK, 1, FAST, 0);
  }
  fresh();
  if (s.day >= 41 && s.cash > 700 && !has(s, B.GREENHOUSE)) build(B.GREENHOUSE);
  fresh();
  if (ex.rank() >= 2 && s.cash > 800 && !has(s, B.COLD)) build(B.COLD);
  fresh();
  if (ex.rank() >= 3 && s.cash > 1300) {
    if (!has(s, B.PRESS) && build(B.PRESS) >= 0) act(ACT.SET_RECIPE, tileOf(readState(mem()), B.PRESS), GRAPE_TO_JUICE, 0);
    fresh();
    if (has(s, B.PRESS) && !has(s, B.CELLAR)) {
      const c = build(B.CELLAR);
      if (c >= 0) act(ACT.SET_RECIPE, c, JUICE_TO_WINE, 0);
    }
  }
  if (s.day % 7 === 0) act(ACT.DECLINE, 1, 0, 0);

  // sell raw goods above RAW_KEEP units at the Stand, and all the Wine
  fresh();
  for (let g = 0; g < 5; g++) {
    const n = count(s, g);
    if (n > RAW_KEEP) act(ACT.SELL_STAND, g, n - RAW_KEEP, 0);
  }
  if (count(s, WINE) > 0) act(ACT.SELL_STAND, WINE, count(s, WINE), 0);
  // re-read AFTER selling: contract stock checks must see what is really left
  fresh();

  // trucks: contracts first, then Tomato in Summer, then Flour (City for the fast truck 1)
  for (let t = 0; t < s.truckCount; t++) {
    if (!s.trucks[t].present || s.trucks[t].phase !== 0) continue;
    fresh();
    const cap = ex.truck_cap(t);
    let sent = false;
    for (let slot = 0; slot < 3 && !sent; slot++) {
      const c = s.board[slot];
      if (!c.qty || c.market === 0 || c.qty > cap || count(s, c.good) < c.qty) continue;
      if (c.deadline < s.day + (c.market === CITY ? 3 : 2)) continue;
      if (act(ACT.ACCEPT, slot, 0, 0) !== 0) continue;
      fresh();
      const idx = s.accepted.findIndex((a) => a.active && a.good === c.good && a.qty === c.qty && a.deadline === c.deadline);
      if (idx >= 0 && act(ACT.TRUCK_LOAD, t, c.good, c.qty) === 0 &&
          act(ACT.TRUCK_SEND, t, c.market, idx) === 0) sent = true;
      fresh();
    }
    if (sent) continue;
    if (t === 0 && ex.season() === 1 && count(s, TOMATO) >= 8) {
      if (act(ACT.TRUCK_LOAD, t, TOMATO, Math.min(count(s, TOMATO), cap)) === 0) act(ACT.TRUCK_SEND, t, TOWN, NONE);
    } else {
      const f = Math.min(count(s, FLOUR), cap);
      if (t === 1 ? f >= 8 : f >= 10) {
        if (act(ACT.TRUCK_LOAD, t, FLOUR, f) === 0) act(ACT.TRUCK_SEND, t, t === 1 ? CITY : TOWN, NONE);
      }
    }
  }

  fresh();

  // plant: Tomato in Greenhouses, then the cheapest in-season crop on every empty tile
  // (Tomato on every 4th tile in Summer, Grape on every 4th once a Press stands)
  const season = ex.season();
  for (let i = 0; i < 64; i++) {
    const t = s.tiles[i];
    if (t.kind === 2 && t.id === B.GREENHOUSE && t.ghCrop === 0 && s.cash > 100) act(ACT.PLANT, i, TOMATO, 0);
  }
  if (s.cash > 100) {
    let best = -1;
    for (let c = 0; c < 5; c++) if ((CROP_SEASONS[c] >> season) & 1 && (best < 0 || CROP_COST[c] < CROP_COST[best])) best = c;
    if (best >= 0) {
      for (let i = 0; i < 64; i++) {
        if (i === MILL_TILE || (i & 7) >= s.grid || (i >> 3) >= s.grid) continue;
        let crop = best;
        if (season === 1 && i % 4 === 0) crop = TOMATO;
        else if ((season === 1 || season === 2) && i % 4 === 1 && has(s, B.PRESS)) crop = GRAPE;
        if (s.tiles[i].kind === 0 && act(ACT.PLANT, i, crop, 0) !== 0) break;
      }
    }
  }

  // expand when rich
  fresh();
  if (s.ringsBought < 4) {
    const ring = ex.t_bal(5, s.ringsBought, 0);
    if (s.cash > 3 * ring) act(ACT.BUY_LAND, 0, 0, 0);
  }
}

// Play until `days` End Days have run or the game stops accepting them.
// An optional log (newLog()) records what the bot actually achieved.
export function runBot(ex, mem, days, log) {
  let n = 0;
  while (n < days) {
    botDay(ex, mem, log);
    if (log) { const s = readState(mem()); if (s.loanPrincipal > 0) log.loanDays++; }
    if (ex.end_day() !== 0) break;
    n++;
    if (log) {
      const s = readState(mem());
      s.trucks.forEach((t, i) => {
        if (t.present && t.phase === 2 && log.phase[i] === 1 && t.dest === CITY) log.cityTrips++;
        log.phase[i] = t.present ? t.phase : 0;
      });
      if (s.wineSold > 0 || count(s, WINE) > 0) log.wineSeen = true;
    }
  }
  return n;
}
