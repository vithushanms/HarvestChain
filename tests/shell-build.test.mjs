// tools/shell.mjs: how index.html / sw.js are generated from the readable sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildShell } from '../tools/shell.mjs';

const keys = JSON.parse(readFileSync('tools/keycodes.json', 'utf8'));
const html = readFileSync('index.html', 'utf8');
const sw = readFileSync('sw.js', 'utf8');
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;
const tiny = (script) => `<!doctype html><html><head><meta name="x" content="a; b, c"><link rel="manifest" href='%MANIFEST%'><style>a{b:c}</style></head><body><p aria-label="one; two, three">x</p><script>${script}</script></body></html>`;

test('`$` replacement patterns in the sources stay literal; no NUL; words are not glued', async () => {
  const src = tiny("window.__a = '$&|$`|$$|$\\'|%V%'; window.__k = '/*KEYS*/';");
  const out = await buildShell({ loader: src, swSrc: "self.V='hc-%V%'; self.t='$&$\\'';", keys, wasm: Buffer.from('w') });
  assert.ok(out.html.includes('$&|$`|$$|$\'|%V%'), out.html);
  assert.ok(!out.html.includes('\u0000'));
  assert.match(out.html, /aria-label="one; two, three"/);
  assert.match(out.html, /content="a; b, c"/);
  assert.ok(out.sw.includes('$&$\''), out.sw);
  assert.match(out.sw, /hc-[0-9a-f]{8}/);
  assert.match(out.html, /href='data:application\/manifest\+json,\{"name":"HarvestChain"/);
});

test('a script string containing </script is escaped or rejected, never emitted raw', async () => {
  const r = await buildShell({ loader: tiny("window.__s = '</script><b>';"), swSrc: 'self.x=1', keys, wasm: Buffer.from('w') }).catch((e) => e);
  if (r instanceof Error) return;
  const body = r.html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(!/<\/script/i.test(body));
});

test('shipped index.html text reads correctly and keeps >= 200 B gz headroom for Task 7', () => {
  assert.match(html, /aria-label="HarvestChain farm game\. Keys: E end day, H harvest, 1-5 tabs"/);
  assert.ok(!html.includes('\u0000'));
  assert.ok(3 * 1024 - gz(html) >= 200, `index.html headroom is ${3 * 1024 - gz(html)} B gz`);
});

test('sw.js only deletes hc- caches', () => {
  assert.match(sw, /startsWith\(["']hc-["']\)/);
});
