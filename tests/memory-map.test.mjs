// Memory map guard (src/00_memory.wat): every documented region is disjoint from every other, the
// region bases match the constants in the sources, every data segment of the shipping binary lies
// in a region meant for constant data and no two segments overlap, and the loader's IO staging
// (0x10000..0x13FFF, 16 KB since the QR encoder took 0x14000..0x16DC0) holds the largest legal
// share text, a save and the origin with margin. A future overlap fails here loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadGame, STATE } from './helpers.mjs';

// [name, first byte, last byte (inclusive)]. Keep in step with the 00_memory.wat header.
const REGIONS = [
  ['scratch + palette / fonts / icons / UI tables + replay arg counts', 0x0000, 0x0FFF],
  ['sim state = save image', 0x1000, 0x4FFF],
  ['replay / input log', 0x5000, 0x5FFF],
  ['balance tables + scene models + string table', 0x6000, 0x7FFF],
  ['layout rect table, UI block, hit table (20_layout)', 0x8000, 0x8BFF],
  ['UI text builders, toasts, announce ring, button list, label log (22_ui)', 0x8C00, 0xA8FF],
  ['End Day summary + screen announce builder (22c_screens)', 0xAA00, 0xAC3F],
  ['stats overlay frame ring + row builders (23_overlay)', 0xAC40, 0xAF1F],
  ['replay viewer log VLOG', 0xB000, 0xBFFF],
  ['pre-viewer state SNAP', 0xC000, 0xC5AF],
  ['share URL / code', 0xC800, 0xDFFF],
  ['base64 decode scratch DEC', 0xE000, 0xEFFF],
  ['pre-action state PRE', 0xF000, 0xF5AF],
  ['IO staging (loader <-> module)', 0x10000, 0x13FFF],
  ['QR encoder table, scratch + matrix', 0x14000, 0x16DC0],
  ['framebuffer + canary (grows)', 0x18000, 0x7FFFFFFF],
];
// Where constant data segments may live.
const DATA_OK = [[0x0000, 0x0FFF], [0x6000, 0x7FFF], [0x14000, 0x14013]];

const src = readdirSync('src').filter((f) => f.endsWith('.wat')).map((f) => readFileSync(`src/${f}`, 'utf8')).join('\n');
const constOf = (name) => {
  const m = src.match(new RegExp(`\\(global \\$${name}\\s+i32\\s+\\(i32\\.const (0x[0-9a-fA-F]+|\\d+)\\)\\)`));
  assert.ok(m, `global $${name} found`);
  return Number(m[1]);
};
const region = (name) => REGIONS.find((r) => r[0] === name);

test('memory map: every documented region is disjoint and the table is sorted', () => {
  for (let i = 0; i < REGIONS.length; i++) {
    const [n, a, b] = REGIONS[i];
    assert.ok(a <= b, `${n}: start <= end`);
    for (let j = i + 1; j < REGIONS.length; j++) {
      const [m, c, d] = REGIONS[j];
      assert.ok(b < c || d < a, `${n} [0x${a.toString(16)}..0x${b.toString(16)}] overlaps ${m} [0x${c.toString(16)}..0x${d.toString(16)}]`);
    }
    if (i) assert.ok(REGIONS[i - 1][2] < a, 'sorted');
  }
});

test('memory map: region bases and sizes match the constants in the sources', () => {
  const at = (name) => region(name)[1];
  const end = (name) => region(name)[2];
  assert.equal(constOf('R_STATE'), at('sim state = save image'));
  assert.equal(constOf('STATE_SIZE'), end('sim state = save image') - at('sim state = save image') + 1);
  assert.ok(constOf('STATE_LEN') <= constOf('STATE_SIZE'));
  assert.equal(constOf('STATE_LEN'), STATE.length);
  // $memeq (24_replay.wat) compares 8 bytes at a time: the state length must be a multiple of 8
  assert.equal(constOf('STATE_LEN') % 8, 0, 'STATE_LEN % 8 (24_replay.wat $memeq)');
  assert.equal(constOf('R_REPLAY'), at('replay / input log'));
  assert.equal(constOf('LOG_CAP'), end('replay / input log') - at('replay / input log') + 1);
  assert.equal(constOf('R_BAL'), at('balance tables + scene models + string table'));
  assert.equal(constOf('R_LAYOUT'), at('layout rect table, UI block, hit table (20_layout)'));
  assert.equal(constOf('VLOG'), at('replay viewer log VLOG'));
  assert.equal(constOf('VLOG') + constOf('LOG_CAP') - 1, end('replay viewer log VLOG'));
  assert.equal(constOf('SNAP'), at('pre-viewer state SNAP'));
  assert.equal(constOf('SNAP') + constOf('STATE_LEN') - 1, end('pre-viewer state SNAP'));
  assert.equal(constOf('URL'), at('share URL / code'));
  assert.equal(constOf('DEC'), at('base64 decode scratch DEC'));
  assert.equal(constOf('DEC') + constOf('LOG_CAP') - 1, end('base64 decode scratch DEC'));
  assert.equal(constOf('PRE'), at('pre-action state PRE'));
  assert.equal(constOf('PRE') + constOf('STATE_LEN') - 1, end('pre-action state PRE'));
  assert.equal(constOf('R_IO'), at('IO staging (loader <-> module)'));
  assert.equal(constOf('IO_SIZE'), end('IO staging (loader <-> module)') - at('IO staging (loader <-> module)') + 1);
  assert.equal(constOf('IO_SIZE'), 0x4000);
  // QR: version table at the base, the matrix (97 x 97 at v20) ends at the region's last byte
  assert.equal(constOf('QR_GEN') & ~0xFFF, at('QR encoder table, scratch + matrix'));
  assert.ok(src.includes(`(data (i32.const 0x${at('QR encoder table, scratch + matrix').toString(16)})`), 'QR table segment at the base');
  assert.equal(constOf('QR_M') + 97 * 97 - 1, end('QR encoder table, scratch + matrix'));
  assert.ok(constOf('QR_GEN') < constOf('QR_CW') && constOf('QR_CW') + 1085 <= constOf('QR_OUT') && constOf('QR_OUT') + 1085 <= constOf('QR_M'));
  assert.equal(constOf('R_FB'), at('framebuffer + canary (grows)'));
  // End Day summary + stats overlay (23_overlay.wat): bases and ends come from the sources
  const OVL = 'stats overlay frame ring + row builders (23_overlay)';
  assert.equal(constOf('SUMMARY'), at('End Day summary + screen announce builder (22c_screens)'));
  assert.equal(constOf('FRING'), at(OVL));
  assert.equal(constOf('FRING') - 1, end('End Day summary + screen announce builder (22c_screens)'));
  assert.ok(constOf('FRING') + 120 * 4 <= constOf('OVLBUF'), 'the 120 x i32 frame ring ends before the row builders');
  // the builders: the value at OVLBUF, the label + value of t_ovl_line at OVLBUF + 120 (+ 120 B, so + 240 in all)
  assert.ok(constOf('OVLBUF') + 240 - 1 <= end(OVL), 'row builders fit the region');
  assert.equal(end(OVL), constOf('OVLBUF') + 0x100 - 1, 'the region ends 256 B after OVLBUF');
  assert.ok(end(OVL) < at('replay viewer log VLOG'));
  // the UI block (22_ui.wat): from R_LAYOUT + 0xC00; its label log is bounded by the literals in $ui_label / $render
  assert.equal(constOf('R_LAYOUT') + 0xC00, at('UI text builders, toasts, announce ring, button list, label log (22_ui)'));
  const ui = readFileSync('src/22_ui.wat', 'utf8'), farm = readFileSync('src/22a_farm.wat', 'utf8');
  assert.ok(ui.includes('(global.set $lab_p (i32.const 0xA100))'), 'label log starts at 0xA100');
  assert.ok(farm.includes('(i32.const 0xA900)'), 'label log is bounded at 0xA900');
  assert.equal(end('UI text builders, toasts, announce ring, button list, label log (22_ui)') + 1, 0xA900);
  assert.ok(end('UI text builders, toasts, announce ring, button list, label log (22_ui)') < constOf('SUMMARY'));
  assert.match(ui, /0xA100\.\.0xA8FF/);
  // qr_encode's overlap check names exactly the QR region
  const qr = readFileSync('src/25_qr.wat', 'utf8');
  assert.match(qr, /\(i32\.const 0x14000\)\)\s*\n\s*\(i32\.lt_u \(local\.get \$ptr\) \(i32\.const 0x16DC1\)\)/);
  // the memory header documents the same split
  const hdr = readFileSync('src/00_memory.wat', 'utf8');
  assert.match(hdr, /0x10000\.\.0x13FFF/);
  assert.match(hdr, /0x14000\.\.0x16DC0/);
});

// Active data segments of a wasm binary: [offset, length].
function dataSegments(buf) {
  let p = 8;
  const u = () => { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7F) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  const sl = () => { let v = 0, s = 0, b; do { b = buf[p++]; v |= (b & 0x7F) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) v |= -1 << s; return v; };
  const out = [];
  while (p < buf.length) {
    const id = buf[p++], size = u(), end = p + size;
    if (id === 11) {
      for (let n = u(); n > 0; n--) {
        const flags = u();
        assert.equal(flags, 0, 'active segments on memory 0 only');
        assert.equal(buf[p++], 0x41, 'i32.const offset');
        const off = sl();
        assert.equal(buf[p++], 0x0B);
        const len = u();
        out.push([off, len]);
        p += len;
      }
    }
    p = end;
  }
  return out;
}

test('memory map: every data segment of the shipping and test binaries lies in a constant-data region, none overlap', () => {
  for (const f of ['build/game.wasm', 'build/game.test.wasm']) {
    const segs = dataSegments(readFileSync(f)).sort((a, b) => a[0] - b[0]);
    assert.ok(segs.length > 5, `${f}: segments found`);
    for (const [o, n] of segs) {
      assert.ok(DATA_OK.some(([a, b]) => o >= a && o + n - 1 <= b), `${f}: data 0x${o.toString(16)}+${n} outside the constant-data regions`);
    }
    for (let i = 1; i < segs.length; i++) {
      assert.ok(segs[i - 1][0] + segs[i - 1][1] <= segs[i][0], `${f}: data segments overlap at 0x${segs[i][0].toString(16)}`);
    }
  }
});

test('IO staging (16 KB) holds the largest legal share text, a save and the origin with margin; module and loader agree', async () => {
  const IO = constOf('IO_SIZE'), LOG_CAP = constOf('LOG_CAP'), ORIGIN = 512;
  const maxCode = Math.ceil(LOG_CAP * 8 / 6);          // base64url, no padding: 5462 chars
  const maxUrl = ORIGIN + 1 + maxCode;
  // the three things the loader stages (one at a time) would fit even all at once, twice over
  assert.ok(2 * (maxUrl + STATE.length + ORIGIN) <= IO, `${maxUrl} + ${STATE.length} + ${ORIGIN} with 2x margin in ${IO}`);
  // the share URL buffer (URL..DEC) holds origin + '#' + the longest code
  assert.ok(constOf('URL') + maxUrl <= constOf('DEC'));
  // the loader rejects anything larger than the staging area
  const loader = readFileSync('tools/loader.src.html', 'utf8');
  assert.match(loader, new RegExp(`n > ${IO}\\)`), 'loader toIo cap = IO_SIZE');
  assert.doesNotMatch(loader, /32768|32 KB/);
  // module side: a real 240-day share code padded with whitespace up to exactly IO_SIZE is taken;
  // one byte more is refused as a bounds error (5) without touching anything
  const { runBot } = await import('./sim/bot.mjs');
  const g = await loadGame();
  g.ex.init(1);
  runBot(g.ex, g.mem, 240);
  const n = g.ex.share_build();
  const code = Buffer.from(g.mem().slice(g.ex.share_ptr(), g.ex.share_ptr() + n)).toString('latin1');
  assert.ok(code.length > 4000 && code.length <= maxCode, `bot code ${code.length} chars`);
  const io = g.ex.io_buf();
  assert.equal(io, constOf('R_IO'));
  const put = (s) => { g.mem().set(Buffer.from(s, 'latin1'), io); return s.length; };
  const big = 'https://example.org/hc/#' + code;
  const pad = ' '.repeat(IO - big.length);
  assert.equal(g.ex.replay_load(io, put(big + pad)), 0, 'IO_SIZE bytes of text accepted');
  const before = g.mem().slice(0, 0x10000);
  assert.equal(g.ex.replay_load(io, IO + 1), 5, 'IO_SIZE + 1 refused');
  assert.deepEqual(g.mem().slice(0, 0x10000), before);
  assert.equal(g.ex.replay_restore(io, IO + 1), 5);
});
