// Task 7a: input log recording, share code, replay_load validation, replay_restore (src/24_replay.wat).
// Log format: header 'R' (0x52), ruleset 1, seed u32 LE, record count u16 LE; records = op byte
// (1..19 action id, 0x1F End Day, 0x1E n = a run of n End Days) + LEB128 args (only the args the
// action uses: ARGC below). Recording never touches the sim state or RNG (the goldens prove it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes, STATE } from '../helpers.mjs';
import { runBot } from './bot.mjs';

const LOG = 0x5000, CAP = 4096, LEN = STATE.length;
const ARGC = [0, 2, 1, 0, 2, 1, 1, 2, 0, 2, 3, 3, 3, 0, 2, 1, 1, 1, 1, 0];
const bytes = (g) => stateBytes(g.mem(), LEN);
const logOf = (g) => Buffer.from(g.mem().slice(LOG, LOG + g.ex.t_log_len()));
const codeOf = (g) => {
  const n = g.ex.share_build();
  return Buffer.from(g.mem().slice(g.ex.share_ptr(), g.ex.share_ptr() + n)).toString('latin1');
};
const put = (g, s) => { const io = g.ex.io_buf(); g.mem().set(Buffer.from(s, 'latin1'), io); return [io, s.length]; };
const load = (g, s) => g.ex.replay_load(...put(g, s));
const restore = (g, s) => g.ex.replay_restore(...put(g, s));
const b64 = (buf) => Buffer.from(buf).toString('base64url');

// Reference encoder / decoder (independent of the module).
const leb = (v) => { const o = []; v >>>= 0; do { let b = v & 0x7F; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
export function encodeLog(seed, recs) {
  const body = [];
  for (const r of recs) body.push(r[0], ...r.slice(1).flatMap(leb));
  const h = Buffer.alloc(8); h[0] = 0x52; h[1] = 1; h.writeUInt32LE(seed >>> 0, 2); h.writeUInt16LE(recs.length, 6);
  return Buffer.concat([h, Buffer.from(body)]);
}
export function decodeLog(buf) {
  const recs = []; let p = 8;
  const rd = () => { let v = 0, s = 0, b; do { b = buf[p++]; v |= (b & 0x7F) << s; s += 7; } while (b & 0x80); return v >>> 0; };
  let lt = 63;
  while (p < buf.length) {
    const op = buf[p++];
    if (op >= 0x80) { lt = (lt + (op & 15) + 1) & 63; recs.push([1, lt, (op >> 4) & 7]); continue; }
    if (op === 0x1F) recs.push([0x1F]);
    else if (op === 0x1E) recs.push([0x1E, rd()]);
    else if (op >= 0x20) { const id = op & 0x1F; recs.push([id, (op >> 5) - 1, ...Array.from({ length: ARGC[id] - 1 }, rd)]); }
    else recs.push([op, ...Array.from({ length: ARGC[op] }, rd)]);
    const r = recs[recs.length - 1];
    if (r[0] === 1) lt = r[1];
  }
  return { seed: buf.readUInt32LE(2), count: buf.readUInt16LE(6), recs };
}
// Apply a decoded log to a fresh instance; cb(day) after every End Day.
function applyLog(ex, log, cb) {
  ex.init(log.seed);
  let day = 0;
  for (const r of log.recs) {
    const n = r[0] === 0x1F ? 1 : r[0] === 0x1E ? r[1] : 0;
    if (!n) { const [op, a = 0, b = 0, c = 0] = r; assert.equal(ex.act(op, a, b, c), 0, `act ${r}`); continue; }
    for (let i = 0; i < n; i++) { assert.equal(ex.end_day(), 0); cb && cb(++day); }
  }
  return day;
}

test('init writes the header (magic, ruleset 1, seed, count 0); a fresh instance records nothing', async () => {
  const g = await loadGame();
  assert.equal(g.ex.t_log_st(), 2, 'no log before init');
  assert.equal(g.ex.act(3, 0, 0, 0), 0);
  assert.equal(g.ex.t_log_len(), 0);
  g.ex.init(0xDEADBEEF);
  assert.deepEqual([...logOf(g)], [0x52, 1, 0xEF, 0xBE, 0xAD, 0xDE, 0, 0]);
  assert.equal(g.ex.t_log_st(), 0);
  // a daily-seed game records its seed like any other
  const daily = Math.imul(20387, 0x9E3779B1) | 0;
  g.ex.init(daily);
  assert.equal(logOf(g).readInt32LE(2), daily);
});

test('format is pinned: only successful state-changing actions, used args, LEB128, compact PLANT, End Day runs', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(77);
  assert.equal(ex.act(1, 9, 0, 7), 0);           // PLANT tile 9 Wheat: 10 tiles after the start (63): 1000 1001
  assert.equal(ex.act(1, 10, 3, 0), 0);          // PLANT tile 10 Apple: next tile, crop 3: 1011 0000
  assert.equal(ex.act(1, 8, 0, 0), 0);           // tile 8 is behind tile 10: a full record 01 08 00
  assert.notEqual(ex.act(1, 63, 0, 0), 0);       // out of grid: not recorded
  assert.notEqual(ex.act(99, 1, 2, 3), 0);       // unknown action: not recorded
  assert.equal(ex.act(3, 5, 6, 7), 0);           // HARVEST_ALL with nothing ripe changes nothing: not recorded
  for (let i = 0; i < 3; i++) assert.equal(ex.end_day(), 0);
  assert.equal(ex.act(17, 300, 0, 0), 0);        // LOAN_TAKE 300 = AC 02
  assert.equal(ex.end_day(), 0);
  assert.deepEqual([...logOf(g).subarray(6)], [6, 0, 0x89, 0xB0, 0x01, 8, 0, 0x1E, 3, 0x11, 0xAC, 0x02, 0x1F]);
  assert.deepEqual(decodeLog(logOf(g)).recs, [[1, 9, 0], [1, 10, 3], [1, 8, 0], [0x1E, 3], [17, 300], [0x1F]]);
});

test('RLE round trip: 300 End Days are one record (1E AC 02); recording resumes after it', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(5);
  for (let i = 0; i < 300; i++) if (ex.end_day() !== 0) break;
  const days = readState(g.mem()).day - 1;
  assert.ok(days > 127, `ran ${days} days`);
  const want = [0x1E, ...leb(days)];
  assert.deepEqual([...logOf(g).subarray(8)], want);
  assert.equal(logOf(g).readUInt16LE(6), 1);
  if (readState(g.mem()).status === 0 || readState(g.mem()).status === 2) {
    assert.equal(ex.act(17, 5, 0, 0), 0); assert.equal(ex.end_day(), 0);
    assert.deepEqual([...logOf(g).subarray(8)], [...want, 0x11, 5, 0x1F]);
  }
  // the module's own code decodes to the same records
  assert.deepEqual(decodeLog(Buffer.from(codeOf(g), 'base64url')).recs, decodeLog(logOf(g)).recs);
});

test('240-day bot: the log replays on a fresh instance to identical state bytes after every day; size report', async () => {
  const a = await loadGame();
  a.ex.init(1);
  const snaps = [bytes(a)];
  const ed = a.ex.end_day;
  const ex = { ...a.ex, end_day: () => { const e = ed(); if (!e) snaps.push(bytes(a)); return e; } };
  assert.equal(runBot(ex, a.mem, 240), 240);
  assert.equal(a.ex.act(19, 0, 0, 0), 0);        // CONTINUE IN ENDLESS is recorded too
  const log = logOf(a);
  console.log(`240-day bot log: ${log.length} B (${decodeLog(log).recs.length} records), share code ${codeOf(a).length} chars`);
  assert.equal(a.ex.t_log_st(), 0, 'the bot run fits the 4 KB log');
  assert.ok(log.length <= CAP);
  const b = await loadGame();
  const dec = decodeLog(log);
  assert.equal(dec.count, dec.recs.length);
  const n = applyLog(b.ex, dec, (d) => assert.deepEqual(bytes(b), snaps[d], `day ${d}`));
  assert.equal(n, 240);
  assert.deepEqual(bytes(b), bytes(a));
});

test('overflow: recording stops at 4 KB, the flag is set, share disabled, the game goes on', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(9);
  for (let i = 0; i < 1000; i++) { assert.equal(ex.act(17, 1000, 0, 0), 0); assert.equal(ex.act(18, 1000, 0, 0), 0); }
  assert.equal(ex.t_log_st(), 1);
  const len = ex.t_log_len();
  assert.ok(len <= CAP && len > CAP - 16, `len ${len}`);
  const before = logOf(g);
  const s0 = readState(g.mem());
  assert.equal(ex.end_day(), 0);
  assert.equal(readState(g.mem()).day, s0.day + 1, 'the live game continues');
  assert.deepEqual(logOf(g), before);
  assert.equal(ex.share_build(), 0);
  assert.equal(ex.share_len(), 0);
  // the region past the log (balance tables at 0x6000) is untouched
  assert.equal(ex.t_bal(0, 0, 0), (await loadGame()).ex.t_bal(0, 0, 0));
  ex.init(10);
  assert.equal(ex.t_log_st(), 0, 'a new game records again');
});

test('share_build: base64url without padding of the log bytes; URL = origin + # + code', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(123);
  assert.equal(runBot(ex, g.mem, 12), 12);
  const code = codeOf(g);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.equal(code.length, Math.ceil((logOf(g).length * 4) / 3));
  assert.deepEqual(Buffer.from(code, 'base64url'), logOf(g));
  const str = (p, n) => Buffer.from(g.mem().slice(p, p + n)).toString('latin1');
  // no origin: the URL is the bare code
  assert.equal(str(ex.share_url_ptr(), ex.share_url_len()), code);
  const origin = 'https://example.test/harvest/';
  ex.set_origin(...put(g, origin).slice(1));
  ex.share_build();
  assert.equal(str(ex.share_url_ptr(), ex.share_url_len()), origin + '#' + code);
  assert.equal(str(ex.share_ptr(), ex.share_len()), code);
  ex.set_origin(5000);                              // too long: ignored, back to the bare code
  ex.share_build();
  assert.equal(str(ex.share_url_ptr(), ex.share_url_len()), code);
});

test('replay_load accepts a code, a URL, surrounding whitespace; it never touches state or the live log', async () => {
  const src = await loadGame();
  src.ex.init(42);
  runBot(src.ex, src.mem, 5);
  const code = codeOf(src);
  for (const text of [code, `https://x.test/#${code}`, `  ${code}\n`, `http://a/b?c#junk#${code}`]) {
    const g = await loadGame();
    g.ex.init(7);
    g.ex.act(1, 9, 0, 0);
    const s0 = bytes(g), l0 = logOf(g);
    assert.equal(load(g, text), 0, text.slice(0, 30));
    assert.deepEqual(bytes(g), s0);
    assert.deepEqual(logOf(g), l0);
    assert.equal(g.ex.t_rp(5), 1, 'pending replay');
    assert.equal(g.ex.t_rp(1), 5, 'N = 5 days');
  }
});

test('replay_load rejects garbage: base64, magic, ruleset, every truncation, counts, ops, varints, days, length', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(7);
  const s0 = bytes(g), l0 = logOf(g);
  const good = encodeLog(5, [[1, 9, 0], [3], [0x1E, 3], [17, 300], [0x1F], [12, 0, 1, 255]]);
  assert.equal(load(g, b64(good)), 0);
  const fresh = async () => { const h = await loadGame(); h.ex.init(7); return h; };
  const h = await fresh();
  const rej = (s, why) => {
    const e = load(h, s);
    assert.notEqual(e, 0, why);
    assert.equal(h.ex.t_rp(5), 0, `${why}: nothing pending`);
    return e;
  };
  rej(b64(good).slice(0, -1) + '!', 'bad char');
  rej(b64(good).slice(0, -1) + '=', 'padding');
  rej(b64(good) + 'A', 'length mod 4 = 1');
  rej('', 'empty');
  rej('#', 'empty after #');
  const m = Buffer.from(good); m[0] = 0x53; rej(b64(m), 'magic');
  const r = Buffer.from(good); r[1] = 2; rej(b64(r), 'ruleset');
  for (let n = 0; n < good.length; n++) rej(b64(good.subarray(0, n)), `truncated to ${n}`);
  const c = Buffer.from(good); c.writeUInt16LE(7, 6); rej(b64(c), 'count too high');
  c.writeUInt16LE(5, 6); rej(b64(c), 'count too low');
  for (const op of [0, 20, 0x1D, 0x20, 0x23, 0x40, 0x7F]) rej(b64(encodeLog(5, [[op]])), `op ${op}`);
  const v6 = Buffer.concat([encodeLog(5, [[17]]).subarray(0, 8), Buffer.from([17, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])]);
  v6.writeUInt16LE(1, 6); rej(b64(v6), 'varint over 5 bytes');
  rej(b64(encodeLog(5, [[0x1E, 0]])), 'empty run');
  rej(b64(encodeLog(5, [[0x1E, 65535], [0x1F]])), 'more than 65535 days');
  assert.equal(load(h, b64(encodeLog(5, [[0x1E, 65535]]))), 0, '65535 days is the limit');
  const h2 = await fresh();
  const big = encodeLog(5, Array.from({ length: 1400 }, () => [17, 300]));
  assert.ok(big.length > CAP);
  assert.notEqual(load(h2, b64(big)), 0, 'over 4 KB');
  assert.equal(h2.ex.replay_load(h2.ex.io_buf(), 0x7FFFFFFF), 5, 'absurd length');
  assert.equal(h2.ex.replay_load(0xFFFFFF00, 200), 5, 'out of memory bounds');
  assert.deepEqual(bytes(g), s0);
  assert.deepEqual(logOf(g), l0);
});

test('fuzz: 20,000 mutated logs never trap and never hang', async () => {
  const g = await loadGame(), ex = g.ex;
  ex.init(3);
  runBot(ex, g.mem, 30);
  const base = logOf(g), s0 = bytes(g);
  let seed = 12345;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  let ok = 0;
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) {
    let b = Buffer.from(base);
    const k = rnd(6);
    if (k === 0) b = b.subarray(0, rnd(b.length));
    else if (k === 1) for (let j = 1 + rnd(4); j--;) b[rnd(b.length)] = rnd(256);
    else if (k === 2) { const p = rnd(b.length); b = Buffer.concat([b.subarray(0, p), Buffer.from([rnd(256)]), b.subarray(p)]); }
    else if (k === 3) { const p = 8 + rnd(b.length - 8); b = Buffer.concat([b.subarray(0, p), b.subarray(p + 1)]); }
    else if (k === 4) { b[8 + rnd(b.length - 8)] = 0x80 | rnd(128); }
    else b = Buffer.from(Array.from({ length: rnd(64) }, () => rnd(256)));
    let s = b64(b);
    if (rnd(10) === 0) s = s.slice(0, rnd(s.length + 1)) + '#!$'[rnd(3)] + s.slice(rnd(s.length + 1));
    if (load(g, s) === 0) ok++;
  }
  const ms = performance.now() - t0;
  console.log(`fuzz: 20000 logs, ${ok} structurally valid, ${ms.toFixed(0)} ms`);
  assert.ok(ms < 5000, `${ms} ms`);
  assert.deepEqual(bytes(g), s0, 'state untouched');
  assert.deepEqual(logOf(g), base, 'live log untouched');
});

test('replay_restore: the matching log of a saved game keeps recording; a mismatched / tampered log is NONE', async () => {
  // uninterrupted reference: 20 days
  const full = await loadGame();
  full.ex.init(11);
  runBot(full.ex, full.mem, 20);
  // 10 days, save + code, a fresh instance loads both, 10 more days -> the same log and state
  const a = await loadGame();
  a.ex.init(11);
  runBot(a.ex, a.mem, 10);
  const save = bytes(a), code = codeOf(a);
  const b = await loadGame();
  b.mem().set(save, b.ex.io_buf());
  assert.equal(b.ex.load(b.ex.io_buf(), save.length), 0);
  assert.equal(b.ex.t_log_st(), 2, 'a loaded save has no history');
  assert.equal(b.ex.share_build(), 0);
  assert.equal(restore(b, code), 0);
  assert.deepEqual(bytes(b), save, 'verification leaves the loaded state as it was');
  assert.equal(b.ex.t_log_st(), 0);
  runBot(b.ex, b.mem, 10);
  assert.deepEqual(bytes(b), bytes(full));
  assert.deepEqual(logOf(b), logOf(full), 'the RLE tail continues exactly');
  // mismatches: another seed's log, a log with one action changed, a log one day short, garbage
  const other = await loadGame(); other.ex.init(12); runBot(other.ex, other.mem, 10);
  const dec = decodeLog(Buffer.from(code, 'base64url'));
  const tampered = encodeLog(11, dec.recs.map((r) => (r[0] === 3 ? [3] : r[0] === 1 ? [1, r[1], (r[2] + 1) % 5] : r)));
  const short = encodeLog(11, [...dec.recs.slice(0, -1)]);
  for (const [bad, why] of [[codeOf(other), 'seed'], [b64(tampered), 'tampered'], [b64(short), 'short'], ['!!', 'garbage'], ['', 'empty']]) {
    const c = await loadGame();
    c.mem().set(save, c.ex.io_buf());
    assert.equal(c.ex.load(c.ex.io_buf(), save.length), 0);
    assert.notEqual(restore(c, bad), 0, why);
    assert.equal(c.ex.t_log_st(), 2, why);
    assert.deepEqual(bytes(c), save, `${why}: state untouched`);
  }
});
