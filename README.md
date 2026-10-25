# HarvestChain

A small, turn-based farm supply-chain strategy game — grow → process → sell → distribute — written entirely in hand-written WebAssembly text (`.wat`). It ships as three static files (`index.html`, `game.wasm`, `sw.js`) with no framework, no assets and no backend, and aims to fit in under 24 KB gzipped.

The full design is in [`requirement-spec.md`](requirement-spec.md).

## Status

Phases 1 and 2 of 6 are done: the whole simulation (every player action and the full End Day pipeline, a complete 240-day run plus Endless mode) lives in `game.wasm` and is exercised by the test suite and by a scripted bot. There are no graphics yet; `tools/play.html` is a dev harness that drives the sim in a browser and now shows contracts, trucks, events and loans. Plans for each phase live in [`docs/superpowers/plans/`](docs/superpowers/plans/).

| Phase | Scope | State |
|---|---|---|
| 1 | Memory map, RNG, balance data, state init, save/load | done |
| 2 | Player actions + End Day pipeline (pricing, weather, contracts, trucks, loans, run end) | done |
| 3 | Draw primitives, fonts, sprites | next |
| 4 | Layout, UI, input, loader (`index.html`), browser smoke tests | — |
| 5 | Save wiring, replays/share codes, stats overlay, QR | — |
| 6 | Onboarding, polish, balance passes | — |

## Requirements

- Node.js 24 (anything ≥ 22 with `node --test` globs should work)
- npm

The WebAssembly toolchain (`wat2wasm` from wabt, `wasm-opt` from Binaryen) is installed as pinned npm devDependencies — no global installs.

## Running it

```sh
npm install          # once
npm run build        # src/*.wat → build/game.wasm, prints sizes
npm test             # build, then run every test
```

Run a single file or a single test (build first — tests load `build/game.wasm`):

```sh
node --test tests/state.test.mjs
node --test --test-name-pattern="round-trip" tests/state.test.mjs
```

A healthy build prints something like:

```
game.wasm  1180 B raw  777 B gz
```

## How it fits together

```
src/*.wat ──concat (filename order)──▶ build/game.wat ──wat2wasm──▶ wasm-opt -Oz ──▶ build/game.wasm
                                                                                      ▲
                                                               tests/*.test.mjs ──────┘  (node:test)
```

- **`src/`** — `.wat` *fragments*. `tools/build.mjs` wraps them in `(module …)`, so no file opens or closes the module. The numeric prefix sets the order: `0x` core (memory, RNG, balance), `1x` simulation, `2x` presentation, `30_exports.wat` last.
- **`tools/build.mjs`** — the whole build. It also enforces the project's hard rules (see below).
- **`tools/state.json`** — the byte offsets of every game-state field. Tests decode memory through it.
- **`tools/balance.json`** — names of the balance tables, their columns and the enums (goods, buildings, markets…).
- **`tests/helpers.mjs`** — `loadGame()`, `readState()`, `stateBytes()`.

Memory is one fixed map with no allocator: state (the save image) at `0x1000`, balance tables at `0x6000`, IO staging for the loader at `0x10000`, framebuffer from `0x18000`. The full map is in `src/00_memory.wat`.

## The rules the build enforces

The build **fails** if any of these break:

| Rule | Why |
|---|---|
| No `f32` / `f64` anywhere in `src/` | Integer-only maths is what makes replays bit-exact across devices. Money is `i32` dollars; multipliers are basis points (10000 = ×1.0). |
| Only Wasm MVP + `bulk-memory`, `sign-ext`, `mutable-globals` | One binary that runs on every target browser, including iOS Safari 16.4. |
| `game.wasm` ≤ 20 KB gzipped and ≤ 48 KB raw | The size budget is a product goal, not a guideline. |
| `index.html` ≤ 3 KB gz, `sw.js` ≤ 1 KB gz | Checked once those files exist. |

## Looking after it

**Changing game numbers (prices, costs, grow times…).** Every tunable number lives in `src/03_balance.wat` as u16 data, one commented row per entry. Edit the hex *and* the matching expected value in `tests/balance.test.mjs`; the test checks every value against the spec, so a typo shows up immediately. Values must fit in 0–65535.

**Changing the game state.** The state layout is **append-only**: add new fields after the last one, never move or resize existing ones. Old saves load by migration, and moving a field silently corrupts them. For each change:
1. Add the field to the comment table at the top of `src/10_state.wat`, plus an `$S_*` offset global if code needs it.
2. Mirror it in `tools/state.json`.
3. Grow `$STATE_LEN` (and `"length"` in `state.json`).
4. Once the game has public players, bump `$SAVE_VERSION` and add a migration in `$load`.

`load` accepts only a save of exactly `$STATE_LEN` bytes whose every field is in range (non-zero RNG word, grid 4–8, 1–3 trucks, status, weather, day, drift/saturation windows, event/board/truck/tile enums, cellar buckets, grace, loan amounts) and rejects the rest before touching state, so growing the layout makes older saves fall back to New Game until a migration is written. Error codes: 1 length, 2 magic, 3 version, 4 out of bounds, 5 corrupt.

**Adding a source file.** Name it with the right numeric prefix so it concatenates in the right place. Remember that WAT has no includes — everything is one module, so names (`$foo`) must be unique across all files.

**Randomness.** Every random number must come from `$rng_next` / `$rng_range` in `src/01_rng.wat`. Never seed or roll anywhere else, or replays will diverge.

**Exports.** The public surface is in `src/30_exports.wat`. Exports prefixed `t_` are test hooks; they stay in the shipping binary because they cost only a few bytes.

**Watching the size.** `npm run build` prints raw and gzipped sizes every time. If a change grows `game.wasm` noticeably, look at `build/game.wat` (the concatenated source) to see what got bigger.

**Updating the toolchain.** `wabt` and `binaryen` are pinned to exact versions in `package.json`. To upgrade, change the version, run `npm install && npm test`, and check that the printed sizes have not jumped and that the feature-guard tests in `tests/build.test.mjs` still fail the bad fixtures for the right reason.

**When a test fails after a refactor.** The tests drive the game only through its exports and read state through `tools/state.json`. If you moved a field, check that `state.json` agrees with `src/10_state.wat` first — that is the most common cause.

## Known open questions

These are recorded in the phase 1 plan and get decided in later phases:

- Spec §14.3 gives the framebuffer as "≤ 2.6 MB", but 1280 × 720 × 4 is 3.69 MB (phase 3).
- The starting Wheat ripens after the first End Day, but onboarding expects a harvest on day 1 (phase 6).
- Weather odds, event frequency and the other numbers the spec left open are fixed in the phase 2 plan's Decisions (`docs/superpowers/plans/`).
