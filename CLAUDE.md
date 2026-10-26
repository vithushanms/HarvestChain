# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 1-2 of 6 done (sim foundation; then every action and the full End Day pipeline, playable via tests, `tests/sim/bot.mjs` and `tools/play.html`). Next: phase 3 (draw primitives). Plans live in `docs/superpowers/plans/`. The source of truth is `requirement-spec.md` (game design spec, rev 2). Read the relevant section before changing behaviour; section numbers (§) below refer to it.

## What this is

HarvestChain: a turn-based (per-day) farm supply-chain strategy game — grow → process → sell → distribute — **written entirely in hand-written WebAssembly text (`.wat`)**. Static app, no backend, no framework, no bundler, no asset files. Plays on phone portrait (360×640 min) and desktop from one build.

Deliverable is exactly three files: `index.html` (inlines the loader JS), `game.wasm`, `sw.js`.

## Hard constraints (violating these is a bug)

- **Integer-only Wasm.** No `f32`/`f64` anywhere. Money = `i32` dollars; multipliers = `i32` basis points (10000 = ×1.0); growth, saturation, drift all fixed-point. This is what makes determinism work.
- **All randomness through the xorshift32 RNG in `01_rng.wat`.** Same seed + input log must yield byte-identical state on every device (replays/share codes depend on it).
- **Wasm features:** MVP + `bulk-memory` + `sign-ext` + `mutable-globals` only. No SIMD, threads, GC, exceptions, multi-memory.
- **Size budgets enforced by the build (exceeding fails it):** `game.wasm` ≤ 32 KB gz / 80 KB raw (spec target 20 / 48; build warns above target); `index.html` ≤ 3 KB gz; `sw.js` ≤ 1 KB gz; total ≤ 24 KB gz. String tables ≤ 2.5 KB raw.
- **Time budgets:** first interactive frame < 100 ms; End Day < 1 ms; full redraw at 360×640 < 4 ms.
- **Loader is dumb glue.** It never contains game logic (no hit-testing, no rules). Its full responsibility list is §14.2 — don't add to it. Readable loader is source of truth; minified copy checked in beside it.
- **Showcase numbers must be measured live** (load ms, KB, frame times) — never hard-coded (§15).
- Min touch target 44×44 CSS px, enforced in Wasm layout code. No horizontal scroll. Not colour-only state (glyph + text).

## Architecture

```
index.html (loader) ──instantiateStreaming──▶ game.wasm
  forwards pointer/key/resize, calls frame(now) only while dirty,
  putImageData(framebuffer), persists save bytes to localStorage['hc.save'],
  feeds #hash to replay_load, mirrors announce buffer to aria-live
```

Exports: `init, pointer, key, resize, frame, save_len, load, replay_*` (+ `dirty`/`want_save` flags).

**One linear memory, fixed hand-laid map, no allocator** (exact offsets within regions are builder's choice):

| Region | Size | Contents |
|---|---|---|
| `0x0000` | 4 KB | globals mirror, scratch, strings, palette, fonts, icons |
| `0x1000` | 16 KB | game state = save image, byte-identical to persisted save |
| `0x5000` | 4 KB | replay/input log |
| `0x6000` | 8 KB | balance tables (every number from §5–§12) |
| `0x8000` | 64 KB | layout rects, hit regions, draw lists, announce buffer |
| `0x18000` | ≤ 2.6 MB | RGBA framebuffer (max 1280×720) |

**Source:** `src/*.wat`, concatenated in filename order by a small build script into `build/game.wat` (WAT has no include). Numeric prefixes group layers: `0x` core (memory, RNG, data, balance) → `1x` simulation (state, actions, End Day pipeline, pricing, weather, contracts, trucks) → `2x` presentation (layout, draw, UI/input, overlay, replay) → `30_exports.wat`. Order matters — new files must slot into the right prefix.

Key cross-file rules:
- **State layout** is documented in a comment header in `10_state.wat` and mirrored in `tools/state.json`; tests read fields by name through it. Change both together. Layout is **append-only** (keeps save migrations trivial). Save = magic `HC` + 2-byte version + state region; `load` migrates older versions.
- **Actions** (`11_actions.wat`) each return `0` or an error code; all validation lives there, not in UI.
- **End Day** (`12_endday.wat`) is one function per §4 step, called in fixed order. Order is tested; don't reorder.
- **Balance numbers live only in `03_balance.wat`** data tables, never inlined in logic.
- **Unlocks** are per-building predicates on state; **milestones are observe-only** (pay cash, never unlock/set anything) (§12).
- **Net worth excludes inventory** (§12).
- **Rendering** is immediate-mode per dirty frame; 16×16 4bpp sprites indexed into a 16-colour palette; integer nearest-neighbour scaling. Layouts (portrait/tablet/laptop/large-text) are data driving one renderer, not separate renderers.
- **Input**: one state machine in `22_ui.wat` (idle → pressed → drag|tap, 8 px slop, 300 ms long-press on plots only; buttons tap on release inside the button) shared by touch and mouse. Two-step buttons ignore the confirming tap for 400 ms. `key()` filters auto-repeat (held-code bitmask).
- All text is templated from short string tables, not prose.

## Phase 2 facts (sim rules)

- **Actions** `act(id,a,b,c)→err`: 1 PLANT, 2 HARVEST, 3 HARVEST_ALL, 4 BUILD, 5 DEMOLISH, 6 UPGRADE_BLD, 7 SET_RECIPE, 8 BUY_LAND, 9 SELL_STAND, 10 TRUCK_LOAD, 11 TRUCK_UNLOAD, 12 TRUCK_SEND, 13 BUY_TRUCK, 14 UPGRADE_TRUCK, 15 ACCEPT, 16 DECLINE, 17 LOAN_TAKE, 18 LOAN_REPAY, 19 CONTINUE. Errors: 0 OK, 1 BAD_ARG, 2 STATUS, 3 TILE_OUT, 4 TILE_BUSY, 5 SEASON, 6 CASH, 7 LOCKED, 8 NOT_RIPE, 9 STORAGE_FULL, 10 NO_STOCK, 11 TRUCK_AWAY, 12 TRUCK_FULL, 13 NO_SLOT, 14 MAX, 15 NEED_GARAGE, 16 CONTRACT, 17 DEADLINE, 18 LOAN, 19 NOT_BUILDING. A failing action never changes state bytes. Only Playing (0) and Endless (2) accept actions; Results (1) accepts only CONTINUE (-> Endless); GameOver (3) accepts nothing. Enums are in `tools/balance.json`.
- **Exports** beyond phase 1: `act, end_day, price, storage_cap/used, net_worth, score, rank, season, truck_cap` plus `t_*` hooks. `end_day` returns E_STATUS (2) outside Playing/Endless.
- **State** fields appended at 0x400+ (status, weather x3, droughtStreak, ringsBought, milestones, hintGood x2, nextEventDay, contractsDone, wineSold, procSold, driftNext, events, board, accepted, cellar); loan/grace live in the phase 1 block (0x14, 0x18, 0x1C). `load` validates every field and returns E_LOAD_CORRUPT (5) before touching state.
- **End Day order** (`12_endday.wat`): 1 weather, 2 grow+age, 3 process, 4 cellar, 5 spoil, 6 trucks, 7 contracts, 8 drift+saturation, 9 money (upkeep, then 1% compounding loan interest, floor), 10 roll day, 11 bankruptcy (loan outstanding + cash < 0 -> grace+1, Game Over once grace > graceDays; cash >= 0 resets it; negative cash without a loan is ignored).
- **Step 10 RNG order** (part of the determinism contract, golden hashes pin it): events_tick, weather_advance, hint goods (`rng_range(13)` twice, hintGood[0] then [1]), day += 1, board refresh when day % 5 == 0, then milestones + run end while Playing. Milestones use ONE net worth snapshot before any payout; milestone 3 only on the rollover into day 81; milestone 6 (net worth 50,000) or day > 240 -> Results. Endless runs no milestones or run-end checks.
- **Net worth** = cash + 50% of building cost (+80% of cost again for upgraded) + 50% of land rings - everything owed; inventory and truck cargo excluded, but cashBack held by present trucks counts. Contract deliveries count toward procSold (tier >= 1) and wineSold (Wine) like market sales. The day counter saturates at 65535. `score` = net worth + 100 x rep + 50 x contractsDone.
- **RNG draw sites** (the whole list; order is the determinism contract): init = `rng_seed`, `weather_prime` (tomorrow, then forecast), then the board rolls; step 1 storm (per crop tile) then drought (per crop tile); step 8 drift x13 (one draw per good); step 10 = events_tick, weather_advance, 2 hint goods, board refresh; contract rolls (per slot: good pick, market when tier >= 1, qty, deadline); ACCEPT and DECLINE both draw RNG (each rerolls the slot). Presentation code (files with numeric prefix >= 20) must never draw from the sim RNG: `tools/build.mjs` fails the build on `call $rng_` there. Visual effects use a separate render-only hash noise function (no state, no sim RNG).
- **`select` evaluates both value operands**: never put a call that consumes RNG or mutates state inside a `select`; use `if/else`. Also never `i32.and` a 0/1 boolean with a mask other than 1.
- **Tests:** `tests/sim/*.test.mjs`; `tests/sim/bot.mjs` is a deterministic scripted player; `tests/golden.json` holds SHA-256 of the state after 80 bot days for seeds 1-3 plus 240 bot days for seed 1 (the bot loans, builds every building, runs two trucks, fulfils contracts and makes Wine; a determinism test asserts its action coverage; a missing file FAILS the test; regenerate only with `UPDATE_GOLDEN=1` after a deliberate rule change, and review why it moved).

## Build & test

Toolchain is pinned npm devDependencies (`wabt` for `wat2wasm`, `binaryen` for `wasm-opt`); no global installs. Node 24, `node:test` only. Playwright arrives in phase 4.

- `npm install`
- `npm run build` — `tools/build.mjs`: wraps `src/*.wat` (filename order) in `(module …)` → `build/game.wat` → `wat2wasm` → `wasm-opt -Oz`, twice: `build/game.test.wasm` (all exports, incl. `t_*` hooks; tests and dev tools use it) and `build/game.wasm` (SHIPPING: every `t_*` export is filtered out of the concatenated text first, so wasm-opt drops code only the hooks kept alive; build fails if one survives). Prints one size line each; the budgets, warnings and `game.wasm  N B raw  M B gz` line are for the shipping binary, the `game.test.wasm` line is informational. Fails on any `f32`/`f64` token, disallowed Wasm feature, or budget breach.
- Dev harness (browser, no graphics): `npm run build && python3 -m http.server 8000`, then open `/tools/play.html`.
- `npm test` — build, then all `tests/**/*.test.mjs` (tests load `build/game.test.wasm` via `loadGame()`; only `tests/build.test.mjs` and `tests/prod.test.mjs` look at the shipping `build/game.wasm`; build first if running files directly). Never use `t_*` hooks from loader/shipping code.
- One file: `node --test tests/state.test.mjs`
- One test: `node --test --test-name-pattern="round-trip" tests/state.test.mjs`

`src/*.wat` files are fragments: never write `(module` in them. Tests reach internals through `t_*` exports and decode state via `tests/helpers.mjs` `readState()` (driven by `tools/state.json`); balance table/column names are in `tools/balance.json`.

Test expectations (§14.5): every action's error codes; End Day step order on fixed seeds; spoilage (tile/storage/truck, Cold Store/Refrigeration exemptions); saturation + recovery; contracts/reputation; bankruptcy/loans/net worth; save→load byte-identical; determinism golden hashes (three 80-day runs and one 240-day run); framebuffer hash tests per screen (any visual change fails them — update hashes deliberately); Playwright at 360×640 and 1280×800.

## Development order

Sim-first, tests-first (§14.6): memory/RNG/balance/state → actions + End Day (playable from test runner before any pixel) → draw primitives/fonts/sprites → layout/UI/input/loader → save/replay/overlay/QR → onboarding/polish. Hand-written WAT is deliberately expensive; resist scope creep beyond v1 (§16).
