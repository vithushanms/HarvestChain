# HarvestChain Phase 1 — Sim Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pipeline plus the first slice of `game.wasm`: memory map, seeded RNG, balance tables, game-state layout with `init`/`load`/`save_len`, all covered by `node:test` (spec §14.6 step 1).

**Architecture:** `src/*.wat` fragments are concatenated in filename order and wrapped in `(module …)` by `tools/build.mjs`, assembled with wabt `wat2wasm`, optimised with Binaryen `wasm-opt -Oz`, and size- and feature-checked. Tests instantiate `build/game.wasm` directly and read state through the offsets in `tools/state.json`. No floats; all values are fixed-point integers.

**Tech Stack:** Node 24 (ESM, `node:test`, `node:zlib`), npm devDependencies `wabt@1.0.39` (`wat2wasm`) and `binaryen@132.0.0` (`wasm-opt`). Nothing else.

**Spec:** `requirement-spec.md` (rev 2). Also read `CLAUDE.md`.

## Global Constraints

- Wasm features: MVP + `bulk-memory` + `sign-ext` + `mutable-globals` only. No SIMD, threads, GC, exceptions, multi-memory, multi-value, reference types.
- Integer-only: no `f32`/`f64` token anywhere in `src/`. Money is `i32` dollars. Multipliers are basis points (10000 = ×1.0).
- Every random call goes through `$rng_next` in `01_rng.wat`.
- Budgets: `game.wasm` ≤ 20 KB gzipped (20480 B) and ≤ 48 KB raw (49152 B); `index.html` ≤ 3 KB gz; `sw.js` ≤ 1 KB gz. The build fails on any breach.
- The state region `0x1000`–`0x4FFF` (16 KB) is the save image, byte-identical to what is persisted. Its layout is append-only.
- All balance numbers live in `03_balance.wat` data segments, never inlined in logic.
- No test framework. `node:test` + `node:assert/strict` only.

## Decisions this plan makes (the spec leaves them open or is inconsistent)

1. **Module wrapper:** `build.mjs` emits `(module` + the fragments + `)`. No source file opens or closes the module.
2. **Memory:** one memory, exported as `memory`, minimum 2 pages for now (enough for regions up to `0x18000`). Framebuffer growth is decided in phase 3. *Spec inconsistency to raise then:* §14.3 says the framebuffer is "≤ 2.6 MB" but 1280×720×4 = 3.69 MB.
3. **Save header:** 4 bytes at state offset 0 — ASCII `H`,`C` then u16 version `1`. The header lives *inside* the state region, so the state region is the save image.
4. **IO staging buffer** at `0x10000` (32 KB, inside the 64 KB scratch region). The loader writes save and replay bytes there before calling `load`/`replay_load`. Exports `io_buf()` and `save_ptr()` are added to the §14.1 surface because the loader needs those addresses.
5. **Test hooks** are exported with a `t_` prefix and stay in the shipping binary (a few bytes).
6. **Seed 0** (xorshift fixed point) is replaced with `0x6D2B79F5`. The stored seed stays 0. Only the RNG word changes.
7. **Grid indexing:** always 8×8 storage, `idx = y*8 + x`. The active area is `x,y < grid_size`. The start 4×4 is the top-left.
8. **Growth progress** is u16 in hundredths of a day (100 = 1 day), so rain +10% and half-speed are exact.
9. **Starting Wheat "day 2 of growth"** = progress 200, ripe after one End Day. *Open question for the onboarding phase:* §13 onboarding has the player harvest on day 1.
10. **Apple plantable seasons** = Spring, Summer, Autumn.
11. **Balance tables** use u16 little-endian fields (`i32.load16_u`). Every table value is asserted by tests against the spec, because hand-written hex is easy to typo.
12. Weather odds and event tables are **not** in this phase. The spec gives no numbers, so phase 2 decides them.
13. During development the layout grows by appending without bumping the version. The version stays 1 until the first public release.

## Review Focus

- **Seed 0:** a player types seed `0` (or a date hashes to 0). A naive xorshift returns 0 forever, so weather and prices freeze. Expect a normal, non-zero sequence. → test in Task 2.
- **Corrupt, truncated or future-version save** in `localStorage`. Expect `load` to return an error code and leave the current state bytes untouched (the loader then falls back to a new game). → tests in Task 4.
- **Stale state on re-init:** after a played game, New Game must not inherit bytes. Expect every state byte past the initialised fields to be 0. → test in Task 4.
- **u16 values above 32767** (the $50,000 net-worth target). Signed loads would return a negative number. Expect 50000. → assertion in Task 3.
- **Forbidden instruction slipping in** (a float op, or a SIMD/multi-value feature). Expect the build to fail with a clear message, not ship a binary that breaks on older Safari. → test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM, pinned devDeps, scripts `build`, `test` |
| `.gitignore` | `node_modules/`, `build/` |
| `tools/build.mjs` | concat → wat2wasm → wasm-opt → feature/float/size checks; `--src <dir>` and `--out <dir>` flags for tests |
| `tools/state.json` | state field offsets/types and enum ids — the tests' view of `10_state.wat` |
| `tools/balance.json` | balance table ids, column indices, row enums — the tests' view of `03_balance.wat` |
| `src/00_memory.wat` | memory, region constants as immutable globals |
| `src/01_rng.wat` | `$rng_seed`, `$rng_next`, `$rng_range` |
| `src/03_balance.wat` | balance data segments at `0x6000` + accessors |
| `src/10_state.wat` | layout comment header, `$init`, `$load`, `$save_len` |
| `src/30_exports.wat` | export list |
| `tests/helpers.mjs` | `loadGame()`, `readState()`, `stateBytes()` |
| `tests/build.test.mjs`, `tests/rng.test.mjs`, `tests/balance.test.mjs`, `tests/state.test.mjs` | tests |
| `tests/fixtures/float/*.wat`, `tests/fixtures/simd/*.wat` | minimal sources that must fail the build |

---

### Task 1: Repo, build pipeline, guard rails

**Files:**
- Create: `package.json`, `.gitignore`, `tools/build.mjs`, `src/00_memory.wat`, `src/30_exports.wat`, `tests/helpers.mjs`, `tests/build.test.mjs`, `tests/fixtures/float/00_bad.wat`, `tests/fixtures/simd/00_bad.wat`

**Interfaces:**
- Produces: `npm run build` → `build/game.wat`, `build/game.wasm`, and stdout line `game.wasm  <raw> B raw  <gz> B gz`. `node tools/build.mjs --src <dir> --out <dir>` exits non-zero with a message on failure.
- Produces (`00_memory.wat`): `(memory $mem 2)`; immutable i32 globals `$R_SCRATCH`=0x0000, `$R_STATE`=0x1000, `$R_REPLAY`=0x5000, `$R_BAL`=0x6000, `$R_LAYOUT`=0x8000, `$R_IO`=0x10000, `$R_FB`=0x18000, `$STATE_SIZE`=0x4000.
- Produces (`tests/helpers.mjs`): `loadGame(path = 'build/game.wasm') → Promise<{ ex, mem: () => Uint8Array }>` (`mem()` re-wraps `ex.memory.buffer` on each call).

- [ ] **Step 1: Scaffold.** `git init`. Write `package.json` with `"type": "module"`, `"private": true`, devDeps `"wabt": "1.0.39"` and `"binaryen": "132.0.0"` (exact versions), scripts `"build": "node tools/build.mjs"` and `"test": "npm run build && node --test \"tests/**/*.test.mjs\""`. Write `.gitignore`. Run `npm install`.

- [ ] **Step 2: Write the failing test** `tests/build.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const build = (src) => {
  const out = mkdtempSync(join(tmpdir(), 'hc-'));
  const r = spawnSync('node', ['tools/build.mjs', '--src', src, '--out', out], { encoding: 'utf8' });
  return { ...r, out };
};

test('real source builds and reports sizes', () => {
  const r = build('src');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /game\.wasm\s+\d+ B raw\s+\d+ B gz/);
  assert.ok(existsSync(join(r.out, 'game.wasm')));
});

test('float token in source fails the build', () => {
  const r = build('tests/fixtures/float');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /f32|f64/);
});

test('SIMD instruction fails the build', () => {
  const r = build('tests/fixtures/simd');
  assert.notEqual(r.status, 0);
});

test('memory is exported', async () => {
  const { loadGame } = await import('./helpers.mjs');
  const { ex } = await loadGame();
  assert.ok(ex.memory instanceof WebAssembly.Memory);
});
```

Fixtures: `float/00_bad.wat` = `(func (export "f") (result f32) (f32.const 1))`. `simd/00_bad.wat` = `(func (export "s") (drop (v128.const i32x4 0 0 0 0)))`.

- [ ] **Step 3: Run it and confirm it fails.** Run `node --test tests/build.test.mjs`. Expected: FAIL (`tools/build.mjs` is missing).

- [ ] **Step 4: Implement `tools/build.mjs`.**
  1. Read `*.wat` in `--src` (default `src`), sorted by filename.
  2. Strip `;;` line comments into a check-copy. If it matches `/\bf(32|64)\b/`, print `integer-only: found f32/f64 in <file>` to stderr and exit 1.
  3. Write `<out>/game.wat` = `"(module\n" + files.join("\n") + "\n)\n"`. Default `--out` is `build`.
  4. Run `wat2wasm` (from `node_modules/.bin`) with `--disable-simd --disable-multi-value --disable-reference-types --disable-saturating-float-to-int`, output to `game.raw.wasm`.
  5. Run `wasm-opt -Oz --mvp-features --enable-bulk-memory --enable-sign-ext --enable-mutable-globals`, output to `game.wasm`.
  6. Compute raw size and `gzipSync(buf, { level: 9 }).length`. Print the size line.
  7. Fail on a budget breach. Also check `index.html` and `sw.js` at the repo root, if they exist, against their gz budgets.
  8. Propagate child-process stderr and exit codes.

  Write `00_memory.wat` (globals above) and `30_exports.wat` (`(export "memory" (memory $mem))`). Write `tests/helpers.mjs` `loadGame` using `readFile` + `WebAssembly.instantiate`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run `npm test`. Expected: 4 passing.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "build: wat concat + wat2wasm + wasm-opt pipeline with budget and feature guards"`

---

### Task 2: Seeded RNG

**Files:**
- Create: `src/01_rng.wat`, `tests/rng.test.mjs`
- Modify: `src/30_exports.wat`

**Interfaces:**
- Consumes: `$R_STATE`. The RNG word lives at state offset `0x008` (defined in Task 4's layout; use the literal offset through a `$S_RNG` global = `0x1008` declared here).
- Produces: `$rng_seed (param $seed i32)` — stores `seed == 0 ? 0x6D2B79F5 : seed`. `$rng_next (result i32)` — xorshift32 (`x ^= x<<13; x ^= x>>>17; x ^= x<<5`), stores and returns x. `$rng_range (param $n i32) (result i32)` — `i32.rem_u(next, n)`, n > 0.
- Produces exports: `t_rng_seed(seed)`, `t_rng_next() → i32`, `t_rng_range(n) → i32`.

- [ ] **Step 1: Write the failing test** `tests/rng.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './helpers.mjs';
const { ex } = await loadGame();
const seq = (seed, n) => { ex.t_rng_seed(seed); return Array.from({ length: n }, () => ex.t_rng_next() >>> 0); };

test('xorshift32 reference sequence, seed 1', () => {
  assert.deepEqual(seq(1, 4), [270369, 67634689, 2647435461, 307599695]);
});
test('xorshift32 reference sequence, seed 42', () => {
  assert.deepEqual(seq(42, 4), [11355432, 2836018348, 476557059, 3648046016]);
});
test('seed 0 is remapped and never sticks at zero', () => {
  assert.deepEqual(seq(0, 4), [1085196063, 2447379481, 2618286376, 1701901981]);
});
test('rng_range is unsigned modulo', () => {
  ex.t_rng_seed(42);
  assert.equal(ex.t_rng_range(10), 2);            // 11355432 % 10
  assert.equal(ex.t_rng_range(1000), 348);        // 2836018348 % 1000 (unsigned)
});
test('same seed, same sequence', () => {
  assert.deepEqual(seq(12345, 50), seq(12345, 50));
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npm test`. Expected: FAIL, `ex.t_rng_seed is not a function`.
- [ ] **Step 3: Implement `01_rng.wat`** and add the three `t_` exports.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. All pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(rng): seeded xorshift32 with zero-seed remap"`

---

### Task 3: Balance tables

**Files:**
- Create: `src/03_balance.wat`, `tools/balance.json`, `tests/balance.test.mjs`
- Modify: `src/30_exports.wat`

**Interfaces:**
- Produces enums (in `tools/balance.json` under `"enums"`, and mirrored as a comment header in `03_balance.wat`):
  - goods: `Wheat 0, Corn 1, Tomato 2, Apple 3, Grape 4, Flour 5, Cornmeal 6, Sauce 7, AppleJuice 8, GrapeJuice 9, Bread 10, Cornbread 11, Wine 12` (crop id = good id for 0–4)
  - buildings: `Mill 0, Cannery 1, Press 2, Bakery 3, Cellar 4, Warehouse 5, ColdStore 6, Greenhouse 7, Well 8, Garage 9`
  - markets: `Stand 0, Town 1, City 2`
  - seasons: `Spring 0, Summer 1, Autumn 2, Winter 3` (season mask bit = 1 << season)
  - unlock kinds: `None 0, OwnsBuilding 1, RepRank 2, DayReached 3`
- Produces tables (u16 LE rows, contiguous from `$R_BAL`). Column order is exactly as listed. `tools/balance.json` records each table's `id`, `cols` names, and row count:
  - `T_CROP` (id 0), 5 rows: `seed, growDays, yield, regrowDays, spoilDays, seasonMask, good`
  - `T_GOOD` (id 1), 13 rows: `basePrice, perishDays, tier`
  - `T_BLD` (id 2), 10 rows: `cost, upkeep, inputCap, storageBonus, unlockKind, unlockArg`
  - `T_RECIPE` (id 3), 8 rows: `building, inGood, inQty, outGood, ageDays`
  - `T_MKT` (id 4), 3 rows: `multRawBp, multProcBp, travelDays, satPerUnitBp, recoverBp`
  - `T_LAND` (id 5), 4 rows: `ringCost`
  - `T_REP` (id 6), 5 rows: `pointsForRank` (row r = rank r+1)
  - `T_MILE` (id 7), 7 rows: `payout`
  - `T_K` (id 8), 1 row of scalars: `startCash, startStorage, truckCap, truckPrice, maxTrucks, truckCapUpgCost, truckCapUpgAmt, truckCapUpgMax, fridgeCost, fastCost, loanMax, loanRateBp, graceDays, daysPerSeason, runDays, bldUpgPctBp, driftStepBp, driftMinBp, driftMaxBp, satFloorBp, contractMultBp, latePenaltyBp, netWorthTarget, netWorthBldBp, netWorthLandBp, cellarHold, startGrid, maxGrid`
- Produces WAT accessor `$bal (param $tbl i32) (param $row i32) (param $col i32) (result i32)`, which uses an internal base/stride lookup per table id. Export `t_bal(tbl, row, col)`.

- [ ] **Step 1: Write the failing test** `tests/balance.test.mjs`. It loads `tools/balance.json`, defines `get(table, rowName|index, colName)` through `ex.t_bal`, and asserts every value from spec §5–§12 as one expected object per table. Exact expected data:

```js
const CROP = { // seed, growDays, yield, regrowDays, spoilDays, seasonMask, good
  Wheat: [10, 3, 4, 0, 0, 0b0111, 0], Corn: [12, 4, 5, 0, 0, 0b0110, 1],
  Tomato: [15, 3, 6, 0, 2, 0b0011, 2], Apple: [40, 8, 8, 3, 0, 0b0111, 3],
  Grape: [30, 6, 5, 0, 3, 0b0110, 4] };
const GOOD = { // basePrice, perishDays, tier
  Wheat: [8,0,0], Corn: [7,0,0], Tomato: [10,2,0], Apple: [12,0,0], Grape: [15,3,0],
  Flour: [22,0,1], Cornmeal: [18,0,1], Sauce: [40,0,1], AppleJuice: [30,6,1],
  GrapeJuice: [38,4,1], Bread: [35,3,2], Cornbread: [28,3,2], Wine: [120,0,2] };
const BLD = { // cost, upkeep, inputCap, storageBonus, unlockKind, unlockArg
  Mill: [250,3,8,0,0,0], Cannery: [400,4,9,0,0,0], Press: [350,4,8,0,0,0],
  Bakery: [600,5,6,0,1,0 /*Mill*/], Cellar: [900,6,0,0,2,3], Warehouse: [300,2,0,40,0,0],
  ColdStore: [500,5,0,20,2,2], Greenhouse: [450,4,0,0,3,41 /*Y1 Autumn day 1*/],
  Well: [200,1,0,0,0,0], Garage: [500,3,0,0,0,0] };
const RECIPE = [ // building, inGood, inQty, outGood, ageDays
  [0,0,2,5,0], [0,1,2,6,0], [1,2,3,7,0], [2,3,2,8,0],
  [2,4,2,9,0], [3,5,1,10,0], [3,6,1,11,0], [4,9,1,12,5] ];
const MKT = { // multRawBp, multProcBp, travelDays, satPerUnitBp, recoverBp
  Stand: [8000,8000,0,200,10000], Town: [10000,10000,1,150,5000], City: [6000,14000,2,100,3400] };
const LAND = [600, 1400, 3000, 6000];
const REP = [0, 3, 8, 15, 25];
const MILE = [100, 200, 200, 500, 300, 1000, 0];
const K = { startCash: 500, startStorage: 30, truckCap: 20, truckPrice: 450, maxTrucks: 3,
  truckCapUpgCost: 300, truckCapUpgAmt: 20, truckCapUpgMax: 2, fridgeCost: 400, fastCost: 500,
  loanMax: 1500, loanRateBp: 100, graceDays: 3, daysPerSeason: 20, runDays: 240,
  bldUpgPctBp: 8000, driftStepBp: 500, driftMinBp: 7000, driftMaxBp: 13000, satFloorBp: 5000,
  contractMultBp: 15000, latePenaltyBp: 1000, netWorthTarget: 50000, netWorthBldBp: 5000,
  netWorthLandBp: 5000, cellarHold: 10, startGrid: 4, maxGrid: 8 };
```

One `test()` per table, comparing all rows and columns. `netWorthTarget === 50000` covers the u16 Review Focus item.

- [ ] **Step 2: Run it and confirm it fails.** Run `npm test`. Expected: FAIL, `t_bal is not a function`.
- [ ] **Step 3: Implement `03_balance.wat`.** One `(data (i32.const …) "…")` segment per table, at offsets packed from `0x6000` (record the offsets in the file's comment header). Use one `;; Name` comment per row. `$bal` returns `i32.load16_u(base + (row*ncols + col)*2)`. Add the `t_bal` export. Write `tools/balance.json`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. All pass.
- [ ] **Step 5: Commit.** `git commit -am "feat(balance): spec §5–§12 balance tables as u16 data segments"`

---

### Task 4: State layout, init, save/load

**Files:**
- Create: `src/10_state.wat`, `tools/state.json`, `tests/state.test.mjs`
- Modify: `src/30_exports.wat`, `tests/helpers.mjs`

**Interfaces:**
- Consumes: `$R_STATE`, `$STATE_SIZE`, `$R_IO` (Task 1); `$rng_seed` (Task 2); `$bal` with `T_K` (Task 3) for start values.
- Produces the state layout. Offsets are relative to `0x1000`, documented in the `10_state.wat` header and in `tools/state.json` as `{ name: { off, type, count? , stride? } }`, with types `u8|u16|i32|u32`:

| off | field | type | notes |
|---|---|---|---|
| 0x000 | magic | u8×2 | `0x48 0x43` ("HC") |
| 0x002 | version | u16 | 1 |
| 0x004 | seed | u32 | as given |
| 0x008 | rng | u32 | xorshift word |
| 0x00C | day | u16 | 1-based |
| 0x00E | grid | u8 | 4..8 |
| 0x00F | rep | u8 | points |
| 0x010 | cash | i32 | signed |
| 0x014 | loanPrincipal | i32 | |
| 0x018 | loanInterest | i32 | |
| 0x01C | grace | u8 | days negative |
| 0x01D | flags | u8 | reserved |
| 0x01E | truckCount | u8 | |
| 0x020 | inv | u16 × 104 | `good*8 + age`, age 0..7 |
| 0x0F0 | drift | u16 × 13 | bp |
| 0x110 | sat | u16 × 39 | `market*13 + good`, bp |
| 0x160 | trucks | 3 × 48 B | +0 present u8, +1 dest u8, +2 phase u8 (0 home, 1 out, 2 back), +3 daysLeft u8, +4 upg u8 (bits0-1 capLvl, bit2 fridge, bit3 fast), +5 contract u8 (0xFF none), +8 cashBack i32, +16 cargo 8×{good u8, age u8, qty u16} |
| 0x200 | tiles | 64 × 8 B | +0 kind u8 (0 empty, 1 crop, 2 building), +1 id u8, +2 progress u16 (1/100 day), +4 ripeAge u8, +5 flags u8 (bit0 appleMature, bit1 upgraded), +6 ghCrop u8 (crop id+1, 0 none) |
| 0x400 | — | | `$STATE_LEN` = 0x400; later phases append and bump it |

- Produces exports: `init(seed)`, `save_ptr() → 0x1000`, `save_len() → $STATE_LEN`, `io_buf() → 0x10000`, `load(ptr, len) → i32` with error codes `0` ok, `1` bad length (`len < 4` or `len > 0x4000`), `2` bad magic, `3` unsupported version (≠ 1). On any error, state bytes are unchanged.
- `init(seed)` behaviour: `memory.fill` the whole 16 KB state region with 0; write the header, seed and `$rng_seed(seed)`; day 1; grid `startGrid`; cash `startCash`; rep 0; truckCount 1; truck 0 `present=1, contract=0xFF`, other trucks `contract=0xFF`; every drift and sat entry 10000; tiles `(0,0)…(3,0)` = crop Wheat with progress 200.
- Produces in `tests/helpers.mjs`: `readState(memU8) → object` (decoded via `tools/state.json`; arrays for `count` fields; trucks/tiles as arrays of objects) and `stateBytes(memU8, len) → Uint8Array` copy.

- [ ] **Step 1: Write the failing test** `tests/state.test.mjs`:

```js
test('init sets the §5 starting state', () => {
  ex.init(42); const s = readState(mem());
  assert.deepEqual([s.magic, s.version, s.seed, s.day, s.grid, s.rep, s.cash, s.truckCount],
                   [[0x48, 0x43], 1, 42, 1, 4, 0, 500, 1]);
  assert.equal(s.loanPrincipal + s.loanInterest + s.grace, 0);
  assert.ok(s.drift.every(v => v === 10000) && s.sat.every(v => v === 10000));
  assert.deepEqual(s.tiles.slice(0, 4).map(t => [t.kind, t.id, t.progress]), Array(4).fill([1, 0, 200]));
  assert.ok(s.tiles.slice(4).every(t => t.kind === 0));
  assert.deepEqual(s.trucks.map(t => [t.present, t.contract]), [[1, 255], [0, 255], [0, 255]]);
  assert.ok(s.inv.every(v => v === 0));
});
test('init seeds the RNG from the seed', () => {
  ex.init(42); assert.equal(ex.t_rng_next() >>> 0, 11355432);
});
test('save_len matches state.json and save_ptr is 0x1000', () => {
  assert.equal(ex.save_len(), stateJson.length); assert.equal(ex.save_ptr(), 0x1000);
});
test('re-init clears every byte of a dirty state region', () => {
  mem().fill(0xAB, 0x1000, 0x5000); ex.init(7);
  assert.ok(mem().subarray(0x1000 + ex.save_len(), 0x5000).every(b => b === 0));
});
test('save → load round-trip is byte-identical', () => {
  ex.init(42); ex.t_rng_next(); const saved = stateBytes(mem(), ex.save_len());
  ex.init(9); mem().set(saved, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), saved.length), 0);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), saved);
});
for (const [name, mutate, len, code] of [
  ['too short', b => b, 3, 1], ['too long', b => b, 0x4001, 1],
  ['bad magic', b => { b[0] = 0x58; }, null, 2], ['future version', b => { b[2] = 2; }, null, 3],
]) test(`load rejects ${name} and leaves state untouched`, () => {
  ex.init(42); const before = stateBytes(mem(), ex.save_len());
  const b = before.slice(); mutate(b); mem().set(b, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), len ?? b.length), code);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), before);
});
```

(The file's imports and `const { ex, mem } = await loadGame(); const stateJson = …` preamble follow the earlier test files.)

- [ ] **Step 2: Run it and confirm it fails.** Run `npm test`. Expected: FAIL, `ex.init is not a function`.
- [ ] **Step 3: Implement `10_state.wat`** (offset constants as globals `$S_*`; `$init`, `$load` validating before `memory.copy`, `$save_len`). Write `tools/state.json` (with top-level `"base": 4096, "length": 1024, "fields": {…}`). Extend `helpers.mjs`. Add the exports.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. All pass. The build prints sizes well under budget.
- [ ] **Step 5: Update `CLAUDE.md`** Build & test section with the real commands (`npm install`, `npm run build`, `npm test`, `node --test tests/state.test.mjs`, `node --test --test-name-pattern="round-trip" tests/state.test.mjs`) and remove the "not yet verified" caveat for those commands.
- [ ] **Step 6: Commit.** `git commit -am "feat(state): v1 state layout, init, save/load with validation"`

---

## Next plans (not this one)

Phase 2: actions + End Day pipeline + pricing/weather/contracts/trucks (decides the weather/event tables). Phase 3: draw/fonts/sprites. Phase 4: layout/UI/input/loader/Playwright. Phase 5: save wiring/replay/overlay/QR. Phase 6: onboarding/polish.
