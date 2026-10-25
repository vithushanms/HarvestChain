import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGame, readState, stateBytes, STATE } from '../helpers.mjs';
import { runBot, newLog } from './bot.mjs';

const LEN = STATE.length;
const GOLDEN = 'tests/golden.json';
const sha = (b) => createHash('sha256').update(b).digest('hex');

// Fresh instance, init(seed), bot for `days` End Days.
async function play(seed, days, log) {
  const g = await loadGame();
  g.ex.init(seed);
  assert.equal(runBot(g.ex, g.mem, days, log), days);
  return g;
}
const bytes = (g) => stateBytes(g.mem(), LEN);

test('same seed + same bot twice -> identical state bytes', async () => {
  const a = await play(7, 80), b = await play(7, 80);
  assert.deepEqual(bytes(a), bytes(b));
  const c = await play(8, 80);
  assert.notDeepEqual(bytes(a), bytes(c));
});

test('save at day 40, load into a FRESH instance, continue -> identical to the uninterrupted run', async () => {
  const full = await play(3, 80);
  const first = await play(3, 39);
  assert.equal(readState(first.mem()).day, 40);
  const saved = bytes(first);
  const fresh = await loadGame();
  fresh.mem().set(saved, fresh.ex.io_buf());
  assert.equal(fresh.ex.load(fresh.ex.io_buf(), saved.length), 0);
  assert.deepEqual(bytes(fresh), saved);
  assert.equal(runBot(fresh.ex, fresh.mem, 41), 41);
  assert.deepEqual(bytes(fresh), bytes(full));
});

test('golden SHA-256 of the state after 80 bot days (seeds 1-3) and 240 bot days (seed 1)', async () => {
  const got = {};
  for (const seed of [1, 2, 3]) got[seed] = sha(bytes(await play(seed, 80)));
  assert.equal(new Set(Object.values(got)).size, 3);
  got['1_240'] = sha(bytes(await play(1, 240)));
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + '\n');
    console.log(`wrote ${GOLDEN}`);
  }
  assert.ok(existsSync(GOLDEN), `${GOLDEN} is missing: run with UPDATE_GOLDEN=1 to create it, then review and commit`);
  assert.deepEqual(got, JSON.parse(readFileSync(GOLDEN, 'utf8')));
});

// Which actions the 240-day seed-1 bot run exercises. Not covered, and why: 2 HARVEST (HARVEST_ALL
// is the bot's harvest), 5 DEMOLISH and 11 TRUCK_UNLOAD (no natural point in the script; both are
// pinned by actions/trucks tests). 19 CONTINUE is issued by this test once the run ends in Results.
test('the 240-day bot run exercises the whole game, not just the early days', async () => {
  const log = newLog();
  const g = await play(1, 240, log);
  const s = readState(g.mem());
  assert.equal(s.status, 1);
  assert.equal(g.ex.act(19, 0, 0, 0), 0); log.ok.add(19);
  const ids = [...log.ok].sort((a, b) => a - b);
  console.log(`bot action coverage: ${ids.join(',')}; loan days ${log.loanDays}, City trips ${log.cityTrips}, contracts ${s.contractsDone}`);
  assert.deepEqual(ids, [1, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.ok(ids.length >= 15);
  assert.equal(log.loadFails, 0, 'the bot never tries to load stock it does not have');
  assert.ok(log.loanDays > 0, 'a loan was held');
  assert.ok(log.wineSeen && s.wineSold > 0, 'a Cellar produced Wine');
  assert.ok(log.cityTrips > 0, 'a City trip completed');
  assert.ok(s.contractsDone > 0, 'a contract was fulfilled');
  const bld = new Set(s.tiles.filter((t) => t.kind === 2).map((t) => t.id));
  for (const b of [0, 2, 4, 5, 6, 7, 8, 9]) assert.ok(bld.has(b), `building ${b} stands`);
  assert.ok(s.tiles[27].flags & 2, 'the Mill is upgraded');
  assert.ok(s.trucks[1].present && (s.trucks[1].upg & 8), 'second truck has the Fast upgrade');
});

test('240 days end in Results for seed 1; then only CONTINUE is accepted', async () => {
  const g = await play(1, 240);
  const s = readState(g.mem());
  assert.equal(s.day, 241); assert.equal(s.status, 1); assert.ok(s.cash > 0);
  assert.ok(s.milestones & 1 && s.milestones & 2, 'bot earns at least the first two milestones');
  const before = bytes(g);
  assert.equal(g.ex.end_day(), 2);
  for (let id = 1; id <= 18; id++) assert.equal(g.ex.act(id, 0, 0, 0), 2, `act ${id}`);
  assert.deepEqual(bytes(g), before);
  assert.equal(g.ex.act(19, 0, 0, 0), 0);
  assert.equal(readState(g.mem()).status, 2);
});

test('2,000 Endless days: no trap, day below 65535, cash never wraps', async () => {
  let survivor = null;
  const tried = [], skipped = [];
  for (let seed = 1; seed <= 10 && survivor === null; seed++) {
    tried.push(seed);
    const g = await loadGame();
    g.ex.init(seed);
    if (runBot(g.ex, g.mem, 240) !== 240) { // bankrupt before the run ended: not a candidate
      assert.equal(readState(g.mem()).status, 3, 'only bankruptcy may stop a run early');
      skipped.push(seed);
      continue;
    }
    assert.equal(g.ex.act(19, 0, 0, 0), 0);
    let prev = readState(g.mem()).cash, ran = 0, lo = prev, hi = prev;
    for (; ran < 2000; ran++) {
      if (runBot(g.ex, g.mem, 1) !== 1) break;
      const c = readState(g.mem()).cash;
      assert.ok(Math.abs(c - prev) < 1_000_000, `cash jumped ${prev} -> ${c}`);
      lo = Math.min(lo, c); hi = Math.max(hi, c); prev = c;
    }
    const s = readState(g.mem());
    if (ran === 2000) {
      survivor = seed;
      assert.equal(s.status, 2); assert.equal(s.day, 241 + 2000); assert.ok(s.day < 65535);
      assert.ok(Math.abs(hi) < 2 ** 30 && Math.abs(lo) < 2 ** 30, `cash range ${lo}..${hi}`);
    } else {
      assert.equal(s.status, 3, 'only bankruptcy may end an Endless run');
      skipped.push(seed);
    }
  }
  assert.ok(tried.length >= 1);
  assert.equal(tried.length, skipped.length + (survivor === null ? 0 : 1), 'every tried seed either survived or was skipped as GameOver');
  assert.notEqual(survivor, null, 'some seed in 1..10 must survive 2,000 Endless days');
});
