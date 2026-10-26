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
npm run build        # src/*.wat → build/game.wasm (shipping) + build/game.test.wasm (test hooks), prints sizes
npm test             # build, then run every test
```

Run a single file or a single test (build first — tests load `build/game.test.wasm`, the build with `t_*` hooks):

```sh
node --test tests/state.test.mjs
node --test --test-name-pattern="round-trip" tests/state.test.mjs
```

A healthy build prints two size lines: `game.wasm  <raw> B raw  <gz> B gz` (the shipping binary, with every `t_*` test-hook export stripped; the budgets below apply to it) and `game.test.wasm  <raw> B raw  <gz> B gz` (all exports; used by tests and dev tools; no budget).

Browser smoke tests (Playwright, chromium; dev-only): `npx playwright install chromium` once, then `npm run test:e2e` (builds, serves the repo root on a random port, runs phone 360x640@2 and desktop 1280x800; screenshots go to `build/shots/`). `npm test` does not need a browser. `npm run check:dist` rebuilds and fails if the committed `index.html` / `sw.js` differ from the build output (CI hint). `npm run build` also writes the shipped `index.html` (minified from `tools/loader.src.html`, the readable source of truth, with an inline data-URI manifest and a build-generated pixel-art icon) and `sw.js` (from `tools/sw.src.js`, cache name stamped with a hash of `game.wasm` + `index.html`) at the repo root and enforces `index.html` <= 4 KB gz, `sw.js` <= 1 KB gz; it prints the total transfer and warns above the spec's 24 KB.

To play the sim in a browser (no graphics yet), serve the repo root and open the dev harness:

```sh
npm run build && python3 -m http.server 8000
# then open http://localhost:8000/tools/play.html
```

## How it fits together

```
src/*.wat ──concat (filename order)──▶ build/game.wat ──wat2wasm──▶ wasm-opt -Oz ──▶ build/game.test.wasm
                                      └─ same text minus every (export "t_…") ─▶ build/game.prod.wat ─▶ … ─▶ build/game.wasm (ships)
                                                                                      ▲
                                                               tests/*.test.mjs ──────┘  (node:test)
```

- **`src/`** — `.wat` *fragments*. `tools/build.mjs` wraps them in `(module …)`, so no file opens or closes the module. The numeric prefix sets the order: `0x` core (memory, RNG, balance), `1x` simulation, `2x` presentation, `30_exports.wat` last.
- **`tools/build.mjs`** — the whole build. It also enforces the project's hard rules (see below).
- **`tools/state.json`** — the byte offsets of every game-state field. Tests decode memory through it.
- **`tools/balance.json`** — names of the balance tables, their columns and the enums (goods, buildings, markets…).
- **`tests/helpers.mjs`** — `loadGame()`, `readState()`, `stateBytes()`.

Memory is one fixed map with no allocator: state (the save image) at `0x1000`, balance tables at `0x6000`, IO staging for the loader at `0x10000..0x13FFF` (16 KB), the QR encoder at `0x14000..0x16DC0`, framebuffer from `0x18000`. The full map is in `src/00_memory.wat`; `tests/memory-map.test.mjs` fails if two regions overlap.

## The rules the build enforces

The build **fails** if any of these break:

| Rule | Why |
|---|---|
| No `f32` / `f64` anywhere in `src/` | Integer-only maths is what makes replays bit-exact across devices. Money is `i32` dollars; multipliers are basis points (10000 = ×1.0). |
| Only Wasm MVP + `bulk-memory`, `sign-ext`, `mutable-globals` | One binary that runs on every target browser, including iOS Safari 16.4. |
| `game.wasm` ≤ 40 KB gzipped and ≤ 100 KB raw | Spec target is 20 KB gz / 48 KB raw; the renderer + UI pushed past it, so the enforced ceiling was raised twice (rulings: 32, then 40 KB gz for replay/QR/overlay/onboarding) and the build warns while above the target. |
| `index.html` ≤ 4 KB gz (raised from the spec's 3 KB for replay/clipboard/metrics glue), `sw.js` ≤ 1 KB gz | Checked by the build. |
| No sim-RNG call (`call $rng_...`) in presentation files (numeric prefix ≥ 20) | Drawing code must never consume the sim RNG, or visuals would change replays. Use a render-only hash noise function. |

To look at the rendered farm (no browser needed), render the canned scenes in `tests/render/scenes.mjs` to PNG:

```sh
npm run build
node tools/dump-ppm.mjs all                       # every farm-* scene at 360x640 and 1280x800 -> build/*.png
node tools/dump-ppm.mjs farm-mid 360 640 --t 2500 # one scene at an animation time (--reduced, --zoom N, --crop x,y,w,h)
node tools/dump-ppm.mjs ui                        # every ui-* state (top bar, tabs, tile sheet, toasts) at 360x640@2,
                                                  # 1280x800 and large text -> build/ui-*.png
node tools/dump-ppm.mjs ui ui-dispatch            # only the matching states, + large text at 320x568
node tools/dump-ppm.mjs ui-build 768 1024 100 --large   # one UI state at any size
node tools/dump-ppm.mjs qr                        # QR encoder showcase (v5, v12, v20 at 360x640)
```

The UI states are scripted in `tests/render/uistates.mjs` through the same `pointer` / `key` / `frame` exports the loader uses.

The five tabs are Farm (tile sheet, `src/22a_farm.wat`) and Process, Market (prices / Farm Stand sell / contracts), Trucks (cards, route strip, the four-step dispatch flow) and Build (placement mode, land, loan) in `src/22b_tabs.wat`. Their content lives in the PANEL rect: a tall bottom sheet in portrait (the farm stays visible above it), the side panel on laptop. Every action goes through `act()`; the read-only `quote(market, good, qty)` export (what selling would pay, saturation included) prices the sell panel and the dispatch summary.

The screens over the farm live in `src/22c_screens.wat`: the Title (shown on every boot: Continue / New Game / Daily Seed / How to play / Journal, Large text and Auto gazette toggles, the zero-asset footer and the load line), the morning Gazette (after End Day unless switched off, or tap the DAY box), the Journal (milestones, score preview; Build tab, Title or `J`), Results / Game Over. They reuse the sheet's card (`$draw_box`) and `$put` rows; Esc closes the Gazette, Journal and How to play.

## Looking after it

**Changing game numbers (prices, costs, grow times…).** Every tunable number lives in `src/03_balance.wat` as u16 data, one commented row per entry. Edit the hex *and* the matching expected value in `tests/balance.test.mjs`; the test checks every value against the spec, so a typo shows up immediately. Values must fit in 0–65535. New scalars are appended as `T_K` columns at the end (and named in `tools/balance.json`); `warehouseStorage` is reserved and unused.

**Changing the game state.** The state layout is **append-only**: add new fields after the last one, never move or resize existing ones. Old saves load by migration, and moving a field silently corrupts them. For each change:
1. Add the field to the comment table at the top of `src/10_state.wat`, plus an `$S_*` offset global if code needs it.
2. Mirror it in `tools/state.json`.
3. Grow `$STATE_LEN` (and `"length"` in `state.json`).
4. Once the game has public players, bump `$SAVE_VERSION` and add a migration in `$load`.

`load` accepts only a save of exactly `$STATE_LEN` bytes whose every field is in range (non-zero RNG word, grid 4–8, 1–3 trucks, status, weather, day, drift/saturation windows, event/board/truck/tile enums, cellar buckets, grace, loan amounts) and rejects the rest before touching state, so growing the layout makes older saves fall back to New Game until a migration is written. Error codes: 1 length, 2 magic, 3 version, 4 out of bounds, 5 corrupt.

**Adding a source file.** Name it with the right numeric prefix so it concatenates in the right place. Remember that WAT has no includes — everything is one module, so names (`$foo`) must be unique across all files.

**Changing the farm art.** Crop, building, truck and prop models are data: readable primitive lists in `tools/gen-models.mjs` (boxes, prisms, cylinders, spheres, stem tufts, line segments, with ripe / upgraded / season conditions). Edit them there, run `npm run gen` to rewrite the table in `src/21c_scene.wat`, look at the PNGs, then refresh the render goldens (`UPDATE_GOLDEN=1 node --test tests/render/`), review and commit. A test fails if the committed table drifts from the generator.

**Changing UI text or icons.** Every word the UI shows is in the string table in `tools/gen-strings.mjs` (UPPERCASE, at most 40 chars a string; spec budget 2.5 KB, now about 2.8 KB pending a ruling), next to the 9x9 glyph icons drawn as ASCII art. Edit there, run `npm run gen` (rewrites `src/02b_strings.wat`), look at the PNGs, refresh the render goldens. A test fails if the committed table drifts from the generator. Keyboard codes the loader forwards are in `tools/keycodes.json` (documented in `src/22_ui.wat`).

**Golden hashes.** `tests/golden.json` pins the state after 80 bot days (seeds 1-3) and after 240 bot days (seed 1); the bot plays loans, every building, two trucks, contracts and Wine, and a test asserts which actions it covers. A missing file fails the test; after a deliberate rule change run `UPDATE_GOLDEN=1 npm test`, review why the hashes moved, and commit the file.

**Randomness.** Every random number must come from `$rng_next` / `$rng_range` in `src/01_rng.wat`, and only simulation code (prefix < 20) may draw. Never seed or roll anywhere else, or replays will diverge. The draw sites and their order are listed in `CLAUDE.md`.

**Exports.** The public surface is in `src/30_exports.wat`. Exports prefixed `t_` are test hooks; they stay in the shipping binary because they cost only a few bytes.

**Watching the size.** `npm run build` prints raw and gzipped sizes every time. If a change grows `game.wasm` noticeably (the shipping binary; `tests/prod.test.mjs` proves it has no `t_*` exports and renders byte-identically to the test build), look at `build/game.wat` (the concatenated source) to see what got bigger.

**Updating the toolchain.** `wabt` and `binaryen` are pinned to exact versions in `package.json`. To upgrade, change the version, run `npm install && npm test`, and check that the printed sizes have not jumped and that the feature-guard tests in `tests/build.test.mjs` still fail the bad fixtures for the right reason.

**When a test fails after a refactor.** The tests drive the game only through its exports and read state through `tools/state.json`. If you moved a field, check that `state.json` agrees with `src/10_state.wat` first — that is the most common cause.

## Known open questions

These are recorded in the phase 1 plan and get decided in later phases:

- Spec §14.3 gives the framebuffer as "≤ 2.6 MB", but 1280 × 720 × 4 is 3.69 MB (phase 3).
- The starting Wheat ripens after the first End Day, but onboarding expects a harvest on day 1 (phase 6).
- Weather odds, event frequency and the other numbers the spec left open are fixed in the phase 2 plan's Decisions (`docs/superpowers/plans/`).

## Offline and updates

`sw.js` is cache-first (`./`, `index.html`, `game.wasm`), so a new deploy shows up one load late: the first load after a deploy still serves the old cached files while the new worker installs; the next load gets the new version. The cache name is `hc-<first 8 hex of sha256(game.wasm + index.html)>` (a deliberate deviation from the brief's wasm byte-length versioning, so a loader-only change also bumps it); old `hc-*` caches are deleted on activate and other caches on the origin are left alone. e2e specs that need tap targets serve `build/game.test.wasm` (`t_hit`, `t_tile_rect`, `t_ui_btn`) through a Playwright route; the shipping page still uses `game.wasm`.

**Install (PWA).** The manifest is an inline `data:` URI with `display: standalone`, a background colour and one 192x192 icon; it has no `start_url` (falls back to the document URL) and no 512x512 icon, to keep `index.html` under its gz budget. Whether Chrome treats the page as installable with that manifest is **unverified**.

**Failure handling.** Any exception from a module call (a wasm trap) stops the frame loop and input and shows "SOMETHING WENT WRONG - RELOAD" as a `role=alert` line (the `aria-live` region stays). Poisoned saves: a boot that restores a save marks it bad (`localStorage['hc.bad'] = '1'`) before any module call that could trap on it (`load`, `replay_restore`, `set_env` / `set_flags` / `set_pref`, `ui_boot`, the first `frame()`), and clears the mark after the first good frame. A trap in that window (including one that makes the boot itself fail with "COULD NOT LOAD GAME") leaves the mark and copies the save to `hc.save.bad`; the next boot skips restoring it and shows a plain Title (no CONTINUE). The first successful save after that (a New Game) clears the mark; the copy is kept for debugging. A trap inside `load` / `replay_restore` while restoring is treated the same way, without the error screen: the mark and the copy stay, and the loader re-instantiates the module (the trapped instance may be left mid-replay) and boots a plain Title. A trap after the first good frame does not mark a healthy save. **Replays and share codes (loader side).** At boot the loader passes the page URL without its hash to `set_origin`; after the first good frame (outside the save-mark window, so a hostile hash that traps cannot blame the save) a `#code` is handed as text to `replay_load` (the module decodes and validates it; on success the hash is removed with `history.replaceState`, garbage is ignored). A paste anywhere (`document.onpaste`) of a link or a bare code does the same. After each pointer / key event the loader checks `want_copy()` and, still inside that user gesture, writes the share link (`share_url_ptr/len`) with `navigator.clipboard.writeText`, then calls `ack_copy()` (the module toasts COPIED!). With every save the input log is stored as its share code in `hc.log`; after restoring a save, `replay_restore` keeps it only if replaying it from its seed reproduces the saved state byte for byte (else the run shows no share code). A cancelled pointer (blur, `pointercancel`, a stale press) is sent as `pointer(-1, -1, 3)`: the module ends the press with no tap, scroll or sheet dismiss.
