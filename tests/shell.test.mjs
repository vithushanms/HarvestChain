// Node-level checks of the three shipped files (index.html, sw.js) and the boot/prefs exports.
// The browser behaviour is covered by tests/e2e (npm run test:e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { loadGame, readState } from './helpers.mjs';

const html = readFileSync('index.html', 'utf8');
const sw = readFileSync('sw.js', 'utf8');
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;

test('index.html and sw.js are within the size budgets; total transfer is reported', () => {
  assert.ok(gz(html) <= 4 * 1024, `index.html ${gz(html)} B gz`);   // (budget raised to 4 KB in Task 7a)
  assert.ok(gz(sw) <= 1024, `sw.js ${gz(sw)} B gz`);
  assert.ok(existsSync('build/game.wasm'));
});

test('index.html makes no external requests', () => {
  // The only allowed http(s) strings would be XML/SVG namespace constants.
  const urls = (html.match(/https?:\/\/[^\s"'<>)]*/g) || []).filter((u) => !/^https?:\/\/www\.w3\.org\//.test(u));
  assert.deepEqual(urls, []);
  assert.doesNotMatch(html, /<(link|script|img|iframe)\b[^>]*\b(src|href)=["']?(https?:)?\/\//i);
  assert.match(html, /rel="?manifest"?/);
  assert.match(html, /data:application\/manifest\+json/);
});

test('index.html wires the loader responsibilities', () => {
  for (const needle of ['game.wasm', 'instantiateStreaming', 'hc.save', 'hc.prefs', 'serviceWorker', 'putImageData',
    'aria-live', 'visibilitychange', 'getRandomValues', 'ui_boot', 'set_pref', 'replay_load', 'replay_restore', 'set_origin', 'want_copy', 'ack_copy', 'want_open', 'open_ptr', 'share_url_ptr', 'hc.log', 'onpaste', 'replaceState', 'image-rendering:pixelated', 'touch-action:none', 'set_metrics', 'cur_day', 'getEntriesByType?.', 'transferSize', 'set_now']) {
    assert.ok(html.includes(needle), `index.html lacks ${needle}`);
  }
  assert.ok(!html.includes('%'.concat('BG%')) && !html.includes('/*KEYS*/'), 'unreplaced build placeholder');
});

test('sw.js caches the shell cache-first under a stamped version and cleans old caches', () => {
  assert.match(sw, /hc-[0-9a-f]{8}/);
  for (const f of ['"./"', '"index.html"', '"game.wasm"']) assert.ok(sw.includes(f), `sw.js lacks ${f}`);
  assert.ok(sw.includes('skipWaiting') && sw.includes('claim') && sw.includes('caches.delete') && sw.includes('caches.match'));
});

test('boot exports: ui_boot, get_flags, set_pref', async () => {
  const { ex, mem } = await loadGame('build/game.wasm');
  for (const n of ['ui_boot', 'get_flags', 'set_pref', 'set_env', 'set_flags']) assert.equal(typeof ex[n], 'function', n);
  ex.resize(360, 640, 200);
  ex.set_env(1234, 20000);
  ex.set_flags(0, 0);
  assert.equal(ex.get_flags(), 0);
  ex.set_pref(0, 1); assert.equal(ex.get_flags(), 1);
  ex.set_pref(2, 1); assert.equal(ex.get_flags(), 5);
  ex.set_flags(1, 0); assert.equal(ex.get_flags(), 6, 'set_flags(reduced, large) keeps the gazette bit');
  ex.set_pref(0, 0); ex.set_pref(1, 0); ex.set_pref(2, 0);
  assert.equal(ex.get_flags(), 0);
  // no save: the Title over a fresh farm from the env seed, not saved until NEW GAME (Task 5c)
  ex.ui_boot(0);
  assert.equal(ex.need_save(), 0);
  assert.equal(readState(mem()).seed, 1234);
  ex.key(13, 1); ex.key(13, 0);        // Enter = NEW GAME on a Title without a save
  assert.equal(ex.need_save(), 1);
  assert.equal(readState(mem()).seed, 1234);
  // a save loads and boots without starting a new game
  ex.ack_save();
  const bytes = new Uint8Array(ex.memory.buffer, ex.save_ptr(), ex.save_len()).slice();
  ex.ui_boot(0);                       // different state to prove has_save=1 keeps what load() restored
  ex.set_env(99, 1);
  new Uint8Array(ex.memory.buffer).set(bytes, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), bytes.length), 0);
  ex.ack_save();
  ex.ui_boot(1);
  assert.equal(ex.need_save(), 0, 'has_save=1 does not request a new save');
  assert.equal(readState(mem()).seed, 1234);
});

// Task 7c: the loader's metrics collection (tools/loader.src.html `sizes`), run on fake performance entries.
test('loader sizes(): transfer of page + game.wasm + sw.js, wasm wire / decoded bytes, 0 when all cached', () => {
  const src = readFileSync('tools/loader.src.html', 'utf8');
  const m = src.match(/function sizes\(list\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'sizes() in the loader source');
  const sizes = new Function(`${m[0]}; return sizes;`)();
  const nav = (t, e = 5000) => ({ entryType: 'navigation', name: 'https://x.test/play/', transferSize: t, encodedBodySize: e, decodedBodySize: 9000 });
  const res = (name, t, e, d) => ({ entryType: 'resource', name, transferSize: t, encodedBodySize: e, decodedBodySize: d });
  // network: headers included in transferSize; the wasm compressed on the wire
  assert.deepEqual(sizes([nav(3400), res('https://x.test/play/game.wasm', 33600, 33255, 62191), res('https://x.test/play/sw.js?v=1', 620, 320, 502),
    res('https://x.test/play/other.png', 9999, 9999, 9999)]), [3400 + 33600 + 620, 33255, 62191]);
  // a non-compressing dev server: wire = raw
  assert.deepEqual(sizes([nav(6300), res('http://127.0.0.1:5/game.wasm#x', 62500, 62191, 62191)]), [6300 + 62500, 62191, 62191]);
  // everything from the service worker / HTTP cache: transferSize 0 -> 0 = "CACHED"
  assert.deepEqual(sizes([nav(0), res('https://x.test/game.wasm', 0, 33255, 62191)]), [0, 33255, 62191]);
  // no transferSize (older engines): encodedBodySize; no entries at all
  assert.deepEqual(sizes([{ entryType: 'navigation', name: 'a', encodedBodySize: 700 }, { entryType: 'resource', name: 'b/game.wasm', encodedBodySize: 300, decodedBodySize: 900 }]), [1000, 300, 900]);
  assert.deepEqual(sizes([]), [0, 0, 0]);
});
