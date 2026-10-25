// Deterministic scripted player. A pure function of game state: it reads state through
// readState and the exports, acts only through ex.act, and never uses Math.random or a clock.
import { readState } from '../helpers.mjs';

const ACT = { PLANT: 1, HARVEST_ALL: 3, BUILD: 4, SET_RECIPE: 7, BUY_LAND: 8, SELL_STAND: 9, TRUCK_LOAD: 10,
  TRUCK_SEND: 12, ACCEPT: 15, LOAN_TAKE: 17, LOAN_REPAY: 18 };
const MILL = 0, MILL_TILE = 27, WHEAT_TO_FLOUR = 0, FLOUR = 5, TOWN = 1, NONE = 255;
const CROP_COST = [10, 12, 15, 40, 30];
const CROP_SEASONS = [7, 6, 3, 7, 6];
const RAW_KEEP = 10;

const count = (s, g) => { let n = 0; for (let a = 0; a < 8; a++) n += s.inv[g * 8 + a]; return n; };

// One bot day (everything except end_day).
export function botDay(ex, mem) {
  let s = readState(mem());
  const act = (...a) => ex.act(...a);
  if (s.status !== 0 && s.status !== 2) return;

  // money: loan when broke, repay when comfortable
  const owed = s.loanPrincipal + s.loanInterest;
  if (s.cash < 0 && owed === 0) act(ACT.LOAN_TAKE, 500, 0, 0);
  else if (owed > 0 && s.cash > owed + 400) act(ACT.LOAN_REPAY, owed, 0, 0);

  act(ACT.HARVEST_ALL, 0, 0, 0);

  // build the Mill on day 5 (or as soon as it is affordable) on the reserved tile
  if (s.day >= 5 && s.tiles[MILL_TILE].kind === 0 && s.cash >= 250) {
    if (act(ACT.BUILD, MILL_TILE, MILL, 0) === 0) act(ACT.SET_RECIPE, MILL_TILE, WHEAT_TO_FLOUR, 0);
  }

  s = readState(mem());

  // sell raw goods above RAW_KEEP units at the Stand
  for (let g = 0; g < 5; g++) {
    const n = count(s, g);
    if (n > RAW_KEEP) act(ACT.SELL_STAND, g, n - RAW_KEEP, 0);
  }

  // contracts: accept one the stock can fill (Town, flour or a raw crop), then ship it
  const truck = s.trucks[0];
  if (truck.present && truck.phase === 0) {
    let sent = false;
    for (let slot = 0; slot < 3 && !sent; slot++) {
      const c = s.board[slot];
      if (!c.qty || c.market !== TOWN) continue;
      if (c.good !== FLOUR && c.good > 4) continue;
      if (count(s, c.good) < c.qty || c.qty > ex.truck_cap(0)) continue;
      if (c.deadline <= s.day) continue;
      if (act(ACT.ACCEPT, slot, 0, 0) !== 0) continue;
      s = readState(mem());
      const idx = s.accepted.findIndex((a) => a.active && a.good === c.good && a.qty === c.qty && a.deadline === c.deadline);
      if (idx >= 0 && act(ACT.TRUCK_LOAD, 0, c.good, c.qty) === 0 &&
          act(ACT.TRUCK_SEND, 0, TOWN, idx) === 0) sent = true;
    }
    // otherwise haul flour to Town for the better price
    if (!sent) {
      s = readState(mem());
      const f = Math.min(count(s, FLOUR), ex.truck_cap(0));
      if (f >= 10 && act(ACT.TRUCK_LOAD, 0, FLOUR, f) === 0) act(ACT.TRUCK_SEND, 0, TOWN, NONE);
    }
  }

  s = readState(mem());

  // plant the cheapest in-season crop on every empty tile (the Mill tile is reserved)
  if (s.cash > 100) {
    const season = ex.season();
    let best = -1;
    for (let c = 0; c < 5; c++) if ((CROP_SEASONS[c] >> season) & 1 && (best < 0 || CROP_COST[c] < CROP_COST[best])) best = c;
    if (best >= 0) {
      for (let i = 0; i < 64; i++) {
        if (i === MILL_TILE || (i & 7) >= s.grid || (i >> 3) >= s.grid) continue;
        if (s.tiles[i].kind === 0 && act(ACT.PLANT, i, best, 0) !== 0) break;
      }
    }
  }

  // expand when rich
  s = readState(mem());
  if (s.ringsBought < 4) {
    const ring = ex.t_bal(5, s.ringsBought, 0);
    if (s.cash > 3 * ring) act(ACT.BUY_LAND, 0, 0, 0);
  }
}

// Play until `days` End Days have run or the game stops accepting them.
export function runBot(ex, mem, days) {
  let n = 0;
  while (n < days) {
    botDay(ex, mem);
    if (ex.end_day() !== 0) break;
    n++;
  }
  return n;
}
