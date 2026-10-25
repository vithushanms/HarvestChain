// Shared helpers for the data generators (gen-palette.mjs, gen-font.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '02_data.wat');
export const hex = (n) => n.toString(16).padStart(2, '0');
export const esc = (bytes) => bytes.map((b) => '\\' + hex(b)).join('');
export const isMain = (meta) => Boolean(process.argv[1]) && meta.url === pathToFileURL(process.argv[1]).href;

const begin = (name) => `;; >>> GENERATED ${name}: do not hand-edit (npm run gen)`;
const end = (name) => `;; <<< END GENERATED ${name}`;

// Text currently between the markers for `name` in 02_data.wat.
export function extract(name, file = DATA_FILE) {
  const t = readFileSync(file, 'utf8');
  const a = t.indexOf(begin(name)), b = t.indexOf(end(name));
  if (a < 0 || b < 0) throw new Error(`markers for ${name} missing in ${file}`);
  return t.slice(a + begin(name).length + 1, b);
}

export function splice(name, body, file = DATA_FILE) {
  const t = readFileSync(file, 'utf8');
  const a = t.indexOf(begin(name)), b = t.indexOf(end(name));
  if (a < 0 || b < 0) throw new Error(`markers for ${name} missing in ${file}`);
  writeFileSync(file, t.slice(0, a + begin(name).length + 1) + body + t.slice(b));
}
