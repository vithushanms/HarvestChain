// Generates the UI string table and the 9x9 glyph icons as WAT data segments in
// src/02b_strings.wat (ruling C9). Run `npm run gen`; a test fails if the committed file drifts.
//
// Strings: zero-terminated, UPPERCASE, concatenated at STR_ADDR in id order; $str(id) walks
// the table. Groups that the UI indexes by number (goods, buildings, weather, seasons, tabs,
// error codes, building info) are contiguous; their first id is exported as $STR_<GROUP>.
// Char codes 1/2/3 are the font's star / up arrow / down arrow.
//
// Icons: 9x9, 2 bits per pixel (0 transparent, 1..3 = the icon's three palette indices),
// row-major, LSB first, 21 bytes + 3 colour bytes = 24 bytes per icon at ICON_ADDR.
import { esc, splice, isMain } from './gen-util.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '02b_strings.wat');
export const STR_ADDR = 0x7700, STR_END = 0x8000, ICON_ADDR = 0x0640, ICON_END = 0x1000;

const STAR = '\x01';
// [group or key, text]. A group entry is ['@NAME', [texts...]].
export const STRINGS = [
  ['@GOOD', ['WHEAT', 'CORN', 'TOMATO', 'APPLE', 'GRAPE', 'FLOUR', 'CORNMEAL', 'SAUCE', 'APPLE JUICE',
    'GRAPE JUICE', 'BREAD', 'CORNBREAD', 'WINE']],
  ['@BLD', ['MILL', 'CANNERY', 'PRESS', 'BAKERY', 'CELLAR', 'WAREHOUSE', 'COLD STORE', 'GREENHOUSE', 'WELL', 'GARAGE']],
  ['@WX', ['SUNNY', 'RAIN', 'DROUGHT', 'STORM', 'FROST', 'HEATWAVE']],
  ['@SEA', ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER']],
  ['@TAB', ['FARM', 'PROCESS', 'MARKET', 'TRUCKS', 'BUILD']],
  // error code -> message (enums.errors in tools/balance.json; E_LOCKED gets a computed reason)
  ['@ERR', ['DONE', "CAN'T DO THAT", 'RUN IS OVER', 'NOT YOUR LAND', 'PLOT IN USE', 'OUT OF SEASON',
    'NOT ENOUGH CASH', 'LOCKED', 'NOT RIPE YET', 'STORAGE FULL', 'NOT IN STOCK', 'TRUCK IS AWAY',
    'TRUCK IS FULL', 'NO FREE SLOT', 'LIMIT REACHED', 'NEEDS A GARAGE', 'NO SUCH CONTRACT',
    'PAST DEADLINE', 'LOAN NOT ALLOWED', 'NOT A BUILDING']],
  // one-line building role (processors show their live recipe instead)
  ['@BINFO', ['', '', '', '', '', 'MORE STORAGE', 'NO SPOILAGE', 'ANY SEASON', 'STOPS DROUGHT', '+1 TRUCK SLOT']],
  ['DAY', 'DAY '],
  ['END_DAY', 'END DAY'],
  ['HARVEST', 'HARVEST'],
  ['PLANT', 'PLANT'],
  ['UPGRADE', 'UPGRADE'],
  ['DEMOLISH', 'DEMOLISH'],
  ['CLEAR', 'CLEAR PLOT'],
  ['TAP_AGAIN', 'TAP AGAIN'],
  ['BUY_LAND', 'BUY LAND'],
  ['IN_SEASON', 'IN SEASON'],
  ['DAYS', ' DAYS'],
  ['DAY1', ' DAY'],
  ['RIPE', 'RIPE'],
  ['GROWING', 'GROWING'],
  ['UPKEEP', 'UPKEEP '],
  ['PER_DAY', '/DAY'],
  ['STORAGE', 'STORAGE '],
  ['EMPTY', 'EMPTY PLOT'],
  ['OFF', 'OFF'],
  ['MAX_LEVEL', 'MAX LEVEL'],
  ['AGING', 'AGING '],
  ['READY_IN', 'READY IN '],
  ['ROTS_IN', 'ROTS IN '],
  ['ROTTING', 'ROTTING'],
  ['TODAY', 'TODAY '],
  ['FORECAST', 'FORECAST '],
  ['PLANTED', 'PLANTED '],
  ['HARVESTED', 'HARVESTED '],
  ['BUILT', 'BUILT '],
  ['CLEARED', 'CLEARED '],
  ['UPGRADED', 'UPGRADED '],
  ['LAND_BOUGHT', 'LAND BOUGHT: '],
  ['HINT', 'TAP A PLOT TO PLANT OR BUILD'],
  ['KEYS', 'E END DAY  H HARVEST  ESC CLOSE'],
  ['NEEDS', 'NEEDS '],
  ['NEEDS_STAR', 'NEEDS ' + STAR],
  ['FROM_DAY', 'FROM DAY '],
  ['NEXT_RING', 'BUY THE NEARER RING FIRST'],
  ['FULL_FARM', 'FARM IS FULL SIZE'],
  ['WILD', 'WILD LAND'],
  ['CASH', 'CASH'],
  ['PTS', ' PTS'],
  ['LOST', ' LOST'],
  ['SPOILED', ' SPOILED'],
  ['NOW_RIPE', ' RIPE'],
  ['NO_RIPE', 'NOTHING RIPE'],
  ['PLOT', 'PLOT '],
  ['YIELD', 'YIELD '],
  ['CAP', ' CAP '],
  ['RECIPE', 'RECIPE'],
  ['FARM_SIZE', 'FARM '],
  ['STOCK', 'IN STORAGE'],
  ['PICK', 'PICK A CROP'],
  ['UNITS', ' UNITS'],
  ['SELECTED', 'SELECTED '],
  ['RUN_OVER', 'RUN IS OVER'],
  ['SEASON_ANY', 'ALL YEAR'],
  ['SEP', ', '],
  ['X', 'X'],
  ['PLOTS', ' PLOTS'],
];

// Icons: name, [c1, c2, c3] palette indices (hue*4 + step), 9 rows of 9 chars ('.' = clear).
// Hues: 0 SOIL 1 TILLED 2 GRASS 3 GRASS2 4 WHEAT 5 CORN 6 TOMATO 7 APPLE 8 GRAPE 9 BARN
//       10 WOOD 11 STONE 12 SKY 13 WATER 14 PAPER 15 INK
const P = (h, s) => h * 4 + s;
export const ICONS = [
  ['COIN', [P(4, 0), P(5, 2), P(5, 3)], [
    '..11111..',
    '.1223321.',
    '122121231',
    '122133221',
    '122212221',
    '122331221',
    '122212221',
    '.1222221.',
    '..11111..']],
  ['STAR', [P(4, 0), P(5, 2), P(5, 3)], [
    '....1....',
    '...131...',
    '...121...',
    '111232111',
    '.1222221.',
    '..12221..',
    '.1221221.',
    '.121.121.',
    '.11...11.']],
  ['SUN', [P(4, 1), P(5, 2), P(5, 3)], [
    '....1....',
    '.1.....1.',
    '...222...',
    '..23322..',
    '1.23222.1',
    '..22222..',
    '...222...',
    '.1.....1.',
    '....1....']],
  ['RAIN', [P(12, 1), P(11, 2), P(14, 3)], [
    '...333...',
    '.3333322.',
    '333332222',
    '.2222222.',
    '.........',
    '.1..1..1.',
    '1..1..1..',
    '..1..1..1',
    '.1..1..1.']],
  ['DROUGHT', [P(0, 0), P(5, 2), P(0, 2)], [
    '...222...',
    '..22222..',
    '.2222222.',
    '.........',
    '333333333',
    '3313331.3',
    '33313.333',
    '3.3331333',
    '333333333']],
  ['STORM', [P(11, 0), P(11, 1), P(5, 2)], [
    '...111...',
    '.1111122.',
    '111112222',
    '.2223222.',
    '....33...',
    '...33....',
    '..3333...',
    '....33...',
    '....3....']],
  ['FROST', [P(13, 1), P(13, 3), P(14, 3)], [
    '....2....',
    '.2..2..2.',
    '..2.2.2..',
    '...232...',
    '222333222',
    '...232...',
    '..2.2.2..',
    '.2..2..2.',
    '....2....']],
  ['HEAT', [P(15, 1), P(6, 2), P(14, 3)], [
    '...111...',
    '...131.2.',
    '...131...',
    '...121.2.',
    '...121...',
    '..12221..',
    '..12221..',
    '..12221..',
    '...111...']],
  ['SPROUT', [P(2, 0), P(2, 2), P(2, 3)], [
    '.........',
    '.33...22.',
    '3332.2221',
    '.3322221.',
    '..1221...',
    '....2....',
    '....2....',
    '...121...',
    '..11111..']],
  ['LEAF', [P(9, 1), P(4, 1), P(4, 2)], [
    '.....1111',
    '...112331',
    '..1223331',
    '.12233321',
    '.1223321.',
    '.123321..',
    '.12321...',
    '.1211....',
    '1........']],
  ['TRUCK', [P(15, 0), P(9, 2), P(13, 3)], [
    '.........',
    '22222....',
    '22222.22.',
    '22222.232',
    '222222222',
    '222222222',
    '111111111',
    '.11...11.',
    '.........']],
  ['ARROW_R', [P(15, 1), P(15, 2), P(15, 3)], [
    '.........',
    '....1....',
    '....11...',
    '1111111..',
    '11111111.',
    '1111111..',
    '....11...',
    '....1....',
    '.........']],
  ['ARROW_L', [P(15, 1), P(15, 2), P(15, 3)], [
    '.........',
    '....1....',
    '...11....',
    '..1111111',
    '.11111111',
    '..1111111',
    '...11....',
    '....1....',
    '.........']],
  ['CHECK', [P(2, 0), P(2, 2), P(2, 3)], [
    '.........',
    '.......11',
    '......121',
    '.1...121.',
    '121.121..',
    '.12121...',
    '..121....',
    '...1.....',
    '.........']],
  ['LOCK', [P(15, 1), P(11, 2), P(4, 2)], [
    '...111...',
    '..1...1..',
    '..1...1..',
    '.1111111.',
    '.1222221.',
    '.1223221.',
    '.1223221.',
    '.1222221.',
    '.1111111.']],
  ['WARN', [P(15, 0), P(5, 2), P(5, 1)], [
    '....1....',
    '...121...',
    '...121...',
    '..12121..',
    '..12121..',
    '.1221221.',
    '.1222221.',
    '122212221',
    '111111111']],
  ['CLOSE', [P(15, 1), P(15, 2), P(15, 3)], [
    '.........',
    '.11...11.',
    '.111.111.',
    '..11111..',
    '...111...',
    '..11111..',
    '.111.111.',
    '.11...11.',
    '.........']],
  ['BASKET', [P(10, 0), P(10, 2), P(4, 2)], [
    '..3.3.3..',
    '.3.333.3.',
    '..33333..',
    '111111111',
    '122121221',
    '.1212121.',
    '.1221221.',
    '.1212121.',
    '..11111..']],
  ['MOON', [P(15, 2), P(5, 2), P(5, 3)], [
    '...222...',
    '..2232...',
    '.2232....',
    '.232...3.',
    '.232.....',
    '.2232..3.',
    '..22322..',
    '...2222..',
    '.........']],
  ['HOUSE', [P(9, 0), P(9, 2), P(14, 3)], [
    '....1....',
    '...121...',
    '..12221..',
    '.1222221.',
    '111111111',
    '.1333331.',
    '.1311131.',
    '.1311131.',
    '.1111111.']],
  ['GEAR', [P(11, 0), P(11, 2), P(11, 3)], [
    '....1....',
    '.1.121.1.',
    '..12321..',
    '.1231321.',
    '1231.1321',
    '.1231321.',
    '..12221..',
    '.1.121.1.',
    '....1....']],
  ['STALL', [P(9, 1), P(9, 2), P(14, 3)], [
    '111111111',
    '232323232',
    '232323232',
    '.1.....1.',
    '.1.....1.',
    '.1.....1.',
    '111111111',
    '.1.....1.',
    '.1.....1.']],
  ['HAMMER', [P(11, 0), P(11, 2), P(10, 2)], [
    '.11111...',
    '1222221..',
    '1222221..',
    '.11331...',
    '...131...',
    '...131...',
    '...131...',
    '...131...',
    '...111...']],
  ['CLOCK', [P(15, 1), P(14, 3), P(15, 2)], [
    '..11111..',
    '.1222221.',
    '122232221',
    '122232221',
    '122233221',
    '122222221',
    '122222221',
    '.1222221.',
    '..11111..']],
  ['CRATE', [P(10, 0), P(10, 2), P(10, 3)], [
    '.........',
    '111111111',
    '133333331',
    '121212121',
    '111111111',
    '122121221',
    '121212121',
    '111111111',
    '.........']],
  ['UP', [P(2, 0), P(2, 2), P(2, 3)], [
    '....1....',
    '...131...',
    '..13331..',
    '.1222221.',
    '111222111',
    '..12221..',
    '..12221..',
    '..12221..',
    '..11111..']],
  ['TRASH', [P(15, 1), P(11, 2), P(11, 3)], [
    '...111...',
    '111111111',
    '.........',
    '.1333331.',
    '.1323231.',
    '.1323231.',
    '.1323231.',
    '.1222221.',
    '..11111..']],
  ['PLUS', [P(2, 0), P(2, 2), P(2, 3)], [
    '...111...',
    '...131...',
    '...121...',
    '111131111',
    '133222221',
    '111121111',
    '...121...',
    '...121...',
    '...111...']],
];

export function strBytes() {
  const out = [], ids = [], groups = {};
  let id = 0;
  for (const [k, v] of STRINGS) {
    const texts = Array.isArray(v) ? v : [v];
    if (k.startsWith('@')) groups[k.slice(1)] = id;
    else ids.push([k, id]);
    for (const t of texts) {
      if (t !== t.toUpperCase()) throw new Error(`string not uppercase: ${t}`);
      out.push({ id: id++, text: t, bytes: [...Buffer.from(t, 'latin1'), 0] });
    }
  }
  return { out, ids, groups, count: id, size: out.reduce((s, e) => s + e.bytes.length, 0) };
}

export function iconBytes() {
  return ICONS.map(([name, cols, rows]) => {
    if (rows.length !== 9 || rows.some((r) => r.length !== 9)) throw new Error(`icon ${name} must be 9x9`);
    const b = new Array(21).fill(0);
    rows.join('').split('').forEach((ch, n) => {
      const v = ch === '.' ? 0 : Number(ch);
      if (!(v >= 0 && v <= 3)) throw new Error(`icon ${name}: bad char ${ch}`);
      b[(n * 2) >> 3] |= v << ((n * 2) & 7);
    });
    return { name, bytes: [...b, ...cols] };
  });
}

const watStr = (t) => t.replace(/[^ -~]|["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

export function generate() {
  const s = strBytes();
  if (STR_ADDR + s.size > STR_END) throw new Error(`string table ${s.size} B overflows 0x${STR_END.toString(16)}`);
  const ic = iconBytes();
  if (ICON_ADDR + ic.length * 24 > ICON_END) throw new Error('icon table overflows');
  let t = `;; string table: ${s.count} strings, ${s.size} B at 0x${STR_ADDR.toString(16)} (budget 2560 B)\n`;
  t += `(data (i32.const 0x${STR_ADDR.toString(16)})\n`;
  for (const e of s.out) t += `  "${watStr(e.text)}\\00" ;; ${e.id}\n`;
  t += ')\n';
  for (const [g, id] of Object.entries(s.groups)) t += `(global $STR_${g} i32 (i32.const ${id}))\n`;
  for (const [k, id] of s.ids) t += `(global $STR_${k} i32 (i32.const ${id}))\n`;
  t += `;; icons: ${ic.length} x 24 B at 0x${ICON_ADDR.toString(16)}\n(data (i32.const 0x${ICON_ADDR.toString(16)})\n`;
  ic.forEach((e, i) => { t += `  "${esc(e.bytes)}" ;; ${i} ${e.name}\n`; });
  t += ')\n';
  ic.forEach((e, i) => { t += `(global $I_${e.name} i32 (i32.const ${i}))\n`; });
  return t;
}

if (isMain(import.meta)) {
  splice('strings', generate(), FILE);
  const s = strBytes();
  console.log(`strings: ${s.count} (${s.size} B), icons: ${ICONS.length}`);
}
