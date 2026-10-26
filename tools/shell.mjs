// Builds the shipped index.html and sw.js from the readable sources (used by tools/build.mjs and tests).
// All injected text goes through function replacers so `$&`, `$'`, `$$` in sources/manifest stay literal.
import { createHash } from 'node:crypto';
import { makeIcon } from './icon.mjs';

export const BG = '#1a1f2e';

export async function buildShell({ loader, swSrc, keys, wasm, icon = makeIcon() }) {
  const { minify } = await import('terser');
  const k = { ...keys };
  delete k._comment;
  // keycodes.json must be the consecutive list 1..n: the loader maps code = index + 1
  const names = Object.keys(k);
  names.forEach((n, i) => { if (k[n] !== i + 1) throw new Error(`keycodes.json: ${n} must be ${i + 1}`); });
  const keyList = names.join(' ');
  const manifest = JSON.stringify({
    name: 'HarvestChain', display: 'standalone', background_color: BG,
    icons: [{ src: `data:image/png;base64,${icon.toString('base64')}`, sizes: '192x192' }],
  });
  const terse = async (code) => {
    const r = await minify(code, { ecma: 2019, compress: { passes: 3, unsafe: true, toplevel: true }, mangle: { toplevel: true }, format: { comments: false } });
    if (!r.code) throw new Error('terser produced no output');
    return r.code;
  };
  const page = loader
    .replaceAll('%BG%', () => BG)
    .replace('%MANIFEST%', () => `data:application/manifest+json,${manifest.replaceAll('#', '%23')}`)
    .replace('/*KEYS*/', () => keyList);
  const m = page.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('loader has no <script>');
  const script = await terse(m[1]);
  if (/<\/script/i.test(script)) throw new Error('minified script contains </script');
  const MARK = '\u0000SCRIPT\u0000';
  const rest = page.replace(m[0], () => MARK)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/\s*\n\s*/g, '').replace(/\s*([{};,])\s*/g, '$1')}</style>`)
    .replace(/>\s+(?=[<\u0000])/g, '>').replace(/(?<=[>\u0000])\s+</g, '<')                 // whitespace between tags only; text and attribute values are left alone
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const html = rest.replace(MARK, () => `<script>${script}</script>`);
  if (html.includes('\u0000')) throw new Error('NUL byte in index.html');
  const version = createHash('sha256').update(wasm).update(html).digest('hex').slice(0, 8);
  const sw = await terse(swSrc.replace('%V%', () => version));
  return { html, sw, version };
}
