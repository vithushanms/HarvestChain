// quote(market, good, qty): read-only twin of $sell_units (shipping export, used by the Market
// SELL panel and the truck dispatch flow). It must return exactly what selling would pay and must
// not change a single state byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, STATE } from '../helpers.mjs';

const EV = { SURGE: 1, GLUT: 2, ROAD: 3, FESTIVAL: 4, FUEL: 5, BUMPER: 6 };
const bytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);

const G = await loadGame();
// Fresh state (seed 7) + pokes. quote() is proven not to change a byte, so selling right after it
// sells from the identical state.
function fresh(setup) { G.ex.init(7); setup(G.ex); return [G, G]; }

test('quote is exported by the shipping build (not a t_ hook)', async () => {
  const g = await loadGame('build/game.wasm');
  assert.equal(typeof g.ex.quote, 'function');
});

test('quote == t_sell_units dollars over many (market, good, qty, event, sat) cases; quote mutates nothing', async () => {
  let cases = 0;
  const events = [null, [EV.SURGE, 1], [EV.GLUT, 2], [EV.FESTIVAL, 0], [EV.SURGE, 0], [EV.ROAD, 2]];
  for (const ev of events) for (let m = 0; m < 3; m++) for (let good = 0; good < 13; good += 2)
    for (const qty of [0, 1, 2, 7, 26, 60]) for (const s0 of [10000, 9100, 5100, 4000]) {
      const setup = (ex) => {
        ex.t_set_sat(m, good, s0);
        ex.t_set_drift(good, 7000 + ((good * 977 + qty * 31) % 6001));
        if (ev) ex.t_put_event(0, ev[0], ev[1] === 0 ? 0 : m, good, 3);
      };
      const [a, b] = fresh(setup);
      const before = bytes(a);
      const q = a.ex.quote(m, good, qty);
      assert.deepEqual(bytes(a), before, 'quote leaves every state byte unchanged');
      const s = b.ex.t_sell_units(m, good, qty);
      assert.equal(q, s, `m${m} g${good} q${qty} sat${s0} ev${ev}`);
      cases++;
    }
  assert.ok(cases > 2000);
});

test('quote pins: Stand wheat 10 units walks saturation down 2%/unit; festival keeps the full price', async () => {
  const [a] = fresh(() => {});
  assert.equal(a.ex.quote(0, 0, 1), 6);
  assert.equal(a.ex.quote(0, 0, 10), 54);   // 6,6,6,6,5,5,5,5,5,5
  a.ex.t_put_event(0, EV.FESTIVAL, 0, 0, 2);
  assert.equal(a.ex.quote(0, 0, 10), 60, 'Festival: Farm Stand saturation disabled');
  assert.equal(a.ex.quote(1, 0, 10) < 80, true, 'Town still saturates under a Festival');
});
