# CLAUDE.md

This file guides Claude Code (claude.ai/code) when it works in this repository.

## What this is

HarvestChain is a turn-based farm supply-chain strategy game (grow → process → sell → distribute). It is written entirely in hand-written WebAssembly text (`.wat`). The module owns everything: the simulation, an integer-only isometric 3D software renderer, the UI and input, replays, share codes, QR codes and the stats overlay. `index.html` is dumb glue.

- The deliverable is three files: `index.html`, `game.wasm` and `sw.js`. `npm run dist` puts them in `dist/`.
- `requirement-spec.md` is the design spec; § numbers below refer to it.
- `docs/superpowers/plans/` holds the implementation plans and their rulings.
- `README.md` covers players, deploys, measured sizes and the spec deviations.

## Commands

```sh
npm install
npm run build        # src/*.wat -> build/game.wasm (shipping) + build/game.test.wasm (t_* hooks); writes index.html, sw.js
npm test             # build + every tests/**/*.test.mjs (node:test)
node --test tests/render/onboard.test.mjs                              # one file (build first)
node --test --test-name-pattern="round-trip" tests/state.test.mjs      # one test
npm run test:e2e     # dist + Playwright (npx playwright install chromium once)
npm run check:dist   # rebuild; fails if committed index.html / sw.js differ
npm run dist         # dist/{index.html,game.wasm,sw.js}
npm run gen          # regenerate palette, font, models, strings + icons, QR tables
npm run size-report  # sections, top functions / data segments, bytes per source file
node tools/dump-ppm.mjs all | ui | ui <prefix> | <state> <w> <h> [dpr] [--large]   # PNGs in build/
```

## Hard constraints (breaking one is a bug)

- **Integer-only Wasm.** No `f32`/`f64` token anywhere in `src/`; the build fails on one.
  - Money is `i32` dollars. Multipliers are basis points (10000 = ×1.0).
- **Wasm features:** MVP + `bulk-memory` + `sign-ext` + `mutable-globals` only.
- **Size budgets** (enforced by `tools/build.mjs` on the shipping binary):
  - `game.wasm` ≤ 40 KB gz / 100 KB raw. That ceiling is a ruling; the spec target is 20 KB, and the build warns above it.
  - `index.html` ≤ 4 KB gz.
  - `sw.js` ≤ 1 KB gz.
  - The string table is capped at 3,500 B by a test.
- **Determinism.** The same seed + input log gives byte-identical state on every device; replays and share codes depend on it.
  - All randomness goes through `$rng_next` / `$rng_range` (`01_rng.wat`), at the draw sites listed below.
  - Files with a numeric prefix ≥ 20 must never `call $rng_`; the build fails if one does. Use `$noise(a, b)` for visuals.
- **Render purity.**
  - Drawing reads sim state but never writes it.
  - A frame is a function of state, UI state, size, flags and time only.
  - `tests/render/determinism-render.test.mjs` renders every UI state and scene in fresh and reused instances.
  - Session-scoped by design: origin, loader metrics, overlay toggle, tutorial step and `memory.size`.
- **UI state lives outside the save image.** It belongs in `0x8000..0xFFFF` and globals, never in the state region. Prefs (large text, gazette, tutorial done) are loader-owned (`hc.prefs`) via `get_flags` / `set_pref`.
- **Accessibility and layout:**
  - Touch targets are ≥ 44 CSS px (`$min_touch`, enforced in layout code).
  - No horizontal scroll.
  - State is never shown by colour alone (glyph + text).
  - Every action is announced (`$announce` → aria-live).
- **Showcase numbers are measured live** (load ms, KB, frame / End Day µs, memory pages), never hard-coded.

## Source layout

`src/*.wat` are fragments. The build wraps them in one `(module …)` in filename order, so never write `(module` in them. WAT has no includes, so every `$name` must be unique across files.

| Prefix | Files |
|---|---|
| `0x` | `00_memory` (the memory map header), `01_rng`, `02_data` (palette, fonts), `02b_strings` (generated strings + icons), `03_balance` (every number from §5–§12 as u16 tables) |
| `1x` | sim: `10_state` (layout comment table = `tools/state.json`), `11_actions`, `12_endday`, `13_pricing`, `14_weather`, `15_contracts`, `16_trucks` |
| `2x` | `20_layout`, `21_draw`, `21b_iso`, `21c_scene` (+ generated model table), `22_ui` (input, frame loop, widgets), `22a_farm`, `22b_tabs`, `22c_screens`, `22d_onboard`, `22z_boot`, `23_overlay`, `24_replay`, `25_qr` |
| `30` | `30_exports.wat` (the export list; `t_*` = test hooks, stripped from the shipping build) |

- **Memory map:** see the header of `src/00_memory.wat`. Keep it accurate. `tests/memory-map.test.mjs` asserts the regions are disjoint.
- **Generated data:** do not hand-edit the generated sections. Edit `tools/gen-*.mjs` and run `npm run gen`; a test fails on drift.
  - palette (`gen-palette`), font (`gen-font`), models (`gen-models` → `21c_scene.wat`), strings + 9×9 icons (`gen-strings` → `02b_strings.wat`), QR tables (`gen-qr`).
  - The scene look / prop tables at `0x7100` in `21c_scene.wat` are hand-written.
- **Loader:**
  - `tools/loader.src.html` and `tools/sw.src.js` are the sources. The build minifies them into the committed root `index.html` / `sw.js`; never edit those two by hand.
  - Key codes are in `tools/keycodes.json`.
  - The loader holds no game logic (§14.2).

## Frame / input contract

- The loader calls these, in this order:
  - `set_now(performance.now())` before every `pointer(x, y, type)` (type 0 down, 1 move, 2 up, 3 cancel) and every `key(code, down)`.
  - `frame(now)`. It returns 0 = idle (stop calling), 1 = animating (rAF), 2 = ambient (call again after about 83 ms).
- Every time-based input rule reads `$now` (long press 300 ms, two-step arm 400 ms, triple tap). Timers store -1 for "starts now" and are stamped by `$stamps`.
- `$pointer` / `$key` are thin wrappers over `$pointer0` / `$key0`.
- `set_metrics(...)` runs before every frame.
- `need_save()` / `ack_save()`, then the loader persists `save_ptr` / `save_len`.
- The `announce_*` exports feed the aria-live region.

## UI conventions

- Hit regions:
  - `$hit_add` / `$btn` register them; the last one added wins.
  - Buttons record themselves in the draw list (64 records, read by tests through `t_ui_btn`).
  - A button is tappable only when fully inside the clip rows.
- Text:
  - Every word comes from the generated string table: `$str(id)`, `$STR_<KEY>`, groups indexed by number.
  - Text is UPPERCASE, ≤ 40 chars a string.
  - Text builders are `$sb` / `$si` / `$sn` / `$sc`.
  - `$ui_wrap` word-wraps; `$fit` shrinks to scale 1 only when a line cannot fit. Prefer one scale for a whole row or list (`$b_sub1`, the Market sub-tabs and the Title pairs show the pattern).
- Scrolling sheets use `$scroll` / `$scroll_max`, and a drag scrolls the sheet. Sheets and screens use `$put` rows on the `$draw_box` card.
- `$announce` (and screen announcements from the labels drawn) feeds aria-live.
- Visual changes must be looked at:
  1. `node tools/dump-ppm.mjs …`, then open the PNG with Read.
  2. Check 360×640, 320×568 large text and 1280×800.
  3. Update goldens deliberately (see the golden policy).

## Rules that bit before

- **`select` evaluates both arms.** Never put a call that draws RNG or mutates state inside a `select`; use `if/else`.
- **Booleans vs bitmasks.** Never `i32.and` a 0/1 boolean with a mask other than 1 (`(i32.and (i32.and x 2) bool)` is always 0). Shift the bit down first.
- **No floats**, not even for "just a ratio". Use basis points or fixed point.
- **State layout is append-only.** Mirror every change in `tools/state.json`; `load` validates every field before touching state.
- **Balance numbers live only in `03_balance.wat`.** Append new `T_K` columns at the end and name them in `tools/balance.json`.
- **A failing action never changes state bytes**; tests assert this for every error path.
- **The UI mirrors sim checks by calling the sim's own helpers** (`$load_slots`, `$carrier`, `$age_step`, `quote`), never copies of them.

## Sim facts

- **Actions** `act(id,a,b,c)→err`:

  | id | action | id | action | id | action |
  |---|---|---|---|---|---|
  | 1 | PLANT | 8 | BUY_LAND | 15 | ACCEPT |
  | 2 | HARVEST | 9 | SELL_STAND | 16 | DECLINE |
  | 3 | HARVEST_ALL | 10 | TRUCK_LOAD | 17 | LOAN_TAKE |
  | 4 | BUILD | 11 | TRUCK_UNLOAD | 18 | LOAN_REPAY |
  | 5 | DEMOLISH | 12 | TRUCK_SEND | 19 | CONTINUE |
  | 6 | UPGRADE_BLD | 13 | BUY_TRUCK | | |
  | 7 | SET_RECIPE | 14 | UPGRADE_TRUCK | | |

- **Errors:** 0 OK, 1 BAD_ARG, 2 STATUS, 3 TILE_OUT, 4 TILE_BUSY, 5 SEASON, 6 CASH, 7 LOCKED, 8 NOT_RIPE, 9 STORAGE_FULL, 10 NO_STOCK, 11 TRUCK_AWAY, 12 TRUCK_FULL, 13 NO_SLOT, 14 MAX, 15 NEED_GARAGE, 16 CONTRACT, 17 DEADLINE, 18 LOAN, 19 NOT_BUILDING.
- **Status:** only Playing (0) and Endless (2) accept actions. Results (1) accepts only CONTINUE. GameOver (3) accepts nothing. Enums are in `tools/balance.json`.
- **End Day order** (`12_endday.wat`, tested; don't reorder):
  1. weather
  2. grow + age
  3. process
  4. cellar
  5. spoil
  6. trucks
  7. contracts
  8. drift + saturation
  9. money (upkeep, then 1% loan interest)
  10. roll the day: events_tick, weather_advance, 2 hint goods, day += 1, board refresh when day % 5 == 0, then milestones + run end while Playing
  11. bankruptcy
- **RNG draw sites.** This is the whole list, and its order is the contract:
  - init: `rng_seed`, `weather_prime` (tomorrow, then forecast), then the board rolls.
  - step 1: storm, then drought (per crop tile).
  - step 8: drift ×13.
  - step 10: as listed above.
  - contract rolls, per slot: good, market when tier ≥ 1, qty, deadline.
  - ACCEPT and DECLINE each reroll their slot.
- **Net worth** = cash + 50% of building cost (+80% of cost again for upgraded) + 50% of land rings − debt. Inventory and cargo are excluded. Score = net worth + 100 × rep + 50 × contractsDone. Milestones are observe-only and pay once.

## Testing and golden policy

- Tests load `build/game.test.wasm`. `loadGame()` compiles each binary once per process, and `readState()` decodes through `tools/state.json`. Only `tests/build.test.mjs`, `tests/prod.test.mjs`, `tests/shell.test.mjs`, `tests/memory-map.test.mjs` and `tests/sim/quote.test.mjs` look at the shipping `build/game.wasm`.
- The goldens are:
  - `tests/golden.json`: the sim state after 80 bot days (seeds 1–3) and 240 days (seed 1).
  - `tests/render/golden-render.json`: framebuffer hashes for scenes, UI states, iso and QR.
- Regenerate them only after a deliberate change, with `UPDATE_GOLDEN=1 npm test`. Writes are merged under a lock. Review the PNGs and say in the commit why the hashes moved. Sim goldens must not move unless a rule changed.
- Replays: `tests/render/replay-*.test.mjs`. QR: every produced code is decoded with jsQR.
- e2e: `tests/e2e/*.spec.mjs` run against a tiny static server (`tests/e2e/server.mjs`, which can serve `dist/` under a prefix). Specs that need tap targets serve `game.test.wasm` through a Playwright route.

## Workspace

`.superpowers/` (plans, task briefs and reports for agent work), `.claude/`, `build/` and `dist/` are gitignored. Commit only source, generated data, the committed `index.html` / `sw.js` and tests.
