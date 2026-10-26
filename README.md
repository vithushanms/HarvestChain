# HarvestChain

A small turn-based farm supply-chain strategy game: grow, process, sell, deliver. It is written entirely in hand-written WebAssembly text (`.wat`), including an integer-only software renderer that draws a lit isometric 3D farm. It ships as three static files (`index.html`, `game.wasm` and `sw.js`) with no framework, no asset files and no backend. It plays on a phone in portrait (360×640 and up) and on a desktop from one build.

The design spec is [`requirement-spec.md`](requirement-spec.md). The implementation plans are in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## How to play

**Goal.** A run lasts 240 days: three years of four 20-day seasons. Over that time, build up your net worth and your score:
- Net worth is cash, plus half the value of your buildings and land, minus what you owe. Inventory does not count.
- Score is net worth + 100 × reputation + 50 × contracts done.

The Journal shows seven milestones. Each pays out once. The run ends at day 240, or early when your net worth reaches $50,000; the Results screen then shows your score. After that you can carry on in Endless mode. If you have a loan and your cash stays below zero for too long, you go bankrupt.

**The daily loop**
1. Plant crops on your plots (Wheat, Corn, Tomato, Apple, Grape; each has its own seasons).
2. Press **End Day**. Overnight, weather happens, crops grow, buildings process, goods spoil, trucks drive, contracts resolve, prices drift and upkeep and loan interest are paid.
3. Harvest crops when they are ripe.
4. Process crops into goods worth more. The Mill makes flour, the Bakery bread, the Cannery sauce, the Press juice and the Cellar ages juice into wine.
5. Sell your goods at the Farm Stand, or truck them to Town or the City for better prices. Selling a lot of one good in one market pushes its price down for a while.

A morning Gazette shows the weather, the forecast (80% sure), price hints and alerts. You can switch it off.

**Tabs**
- **Farm**: tap a plot to plant, harvest, build, upgrade or clear it.
- **Process**: set each building's recipe.
- **Market**: today's prices for the Stand, Town and City; the Farm Stand sell panel; contracts.
- **Trucks**: dispatch a truck in four steps (destination, cargo, which contract it serves, confirm). You can also upgrade a truck with +20 capacity, a Fridge (no spoilage) or Fast (shorter trips).
- **Build**: buildings, more land, and loans.

Buildings unlock as you go. Each building's card says what it needs.

**Contracts.** Accept a contract on the Market tab, then truck the goods to its market before the deadline. A delivered contract pays and raises your reputation; a missed one lowers it.

**Tutorial.** Your first New Game starts a guided first two days with six spotlight hints: plant, End Day, harvest, sell, build a Mill, send a truck. The starting Wheat ripens overnight, which is why it takes two days. Tap **SKIP** to leave it. To see it again, use **How to play → Replay tutorial**.

**Share and replay.**
- The Results screen gives you a share code. **Copy code** puts a link on the clipboard: the page URL plus `#` and the code.
- Opening that link, or pasting a link or code anywhere on the page, puts **Watch shared run** on the Title. The replay viewer can play, pause, step by day, scrub, change speed or **Take over** the run from any day.
- The game is deterministic, so a replay is the seed plus your input log.
- A short run's link is also drawn as a QR code. A long run's link is too long for a QR code; copy the code instead.

**Stats overlay.** Press <kbd>`</kbd>, or tap the top-left corner three times quickly. The overlay shows numbers measured live: wasm size, transfer size, load time, memory, the last End Day time, frame times and a frame-time graph.

**Controls**
- **Touch / mouse**:
  - Tap a plot, a button or a tab.
  - Drag a sheet to scroll it.
  - Hold a plot for 300 ms to see its details.
  - Buttons act when you release them over the button. Two-step buttons (Demolish, New Game over a save) need a second tap.
- **Keyboard**:

| Key | Action |
|---|---|
| <kbd>E</kbd> | End Day |
| <kbd>H</kbd> | Harvest all |
| <kbd>1</kbd>–<kbd>5</kbd> | Farm / Process / Market / Trucks / Build tab |
| Arrow keys | Move the plot cursor |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Open the selected plot, or press a screen's main button |
| <kbd>Esc</kbd> | Back / close |
| <kbd>J</kbd> | Journal |
| <kbd>R</kbd> | Watch the replay of the finished run (Results) |
| <kbd>`</kbd> | Stats overlay |

- **Accessibility**:
  - Large text toggle on the Title.
  - Reduced motion follows the OS `prefers-reduced-motion` setting.
  - Every action is announced through an `aria-live` region.

## Running it

You need Node.js 24 and npm. The WebAssembly toolchain (`wat2wasm` from wabt and `wasm-opt` from Binaryen) comes in as pinned npm devDependencies, so nothing is installed globally.

```sh
npm install
npm run build      # src/*.wat -> build/game.wasm (+ build/game.test.wasm); writes index.html, sw.js; prints sizes
npm run dist       # build, then dist/ = index.html + game.wasm + sw.js (the whole game)
python3 -m http.server 8000 --directory dist
# open http://localhost:8000/
```

The service worker needs `http://localhost` or HTTPS. Opened from `file://`, the game still runs, but without offline support.

## Development

| Command | What it does |
|---|---|
| `npm test` | Builds, then runs every `tests/**/*.test.mjs` with `node:test`: sim, render, UI, replay, QR, build and memory map (564 tests, about 30 s). |
| `node --test tests/state.test.mjs` | One file. Build first: tests load `build/game.test.wasm`. |
| `node --test --test-name-pattern="round-trip" tests/state.test.mjs` | One test. |
| `npm run test:e2e` | Runs `npm run dist`, then Playwright (chromium, phone 360×640@2 and desktop 1280×800). Run `npx playwright install chromium` once first. 130 tests. |
| `npm run check:dist` | Rebuilds and fails if the committed `index.html` / `sw.js` differ from the build output. |
| `npm run gen` | Regenerates the data from `tools/gen-*.mjs`: palette, font, models, strings + icons, QR tables. Tests fail if the committed data drifts. |
| `npm run size-report` | Shows the shipping binary's sections, top functions and data segments, and code bytes per source file (`tools/size-report.mjs`). |
| `node tools/dump-ppm.mjs all` | Renders the canned farm scenes to `build/*.png`. Other modes: `ui`, `ui <prefix>` and `<state> <w> <h> [dpr] [--large]`; see the file header. Visual changes are checked by eye this way. |

`tools/play.html` is a dev harness that drives the sim without graphics (`npm run build && python3 -m http.server 8000`, then open `/tools/play.html`).

## Architecture

```
index.html (loader, ~3.4 KB gz) ──instantiateStreaming──▶ game.wasm (no imports)
  resize / pointer / key / set_now ──▶  input state machine, layout, hit regions
  frame(now) while it returns non-zero  ──▶  scene + UI drawn into an RGBA framebuffer in linear memory
  putImageData(fb)  ◀──  fb_ptr / fb_w / fb_h
  localStorage hc.save / hc.prefs / hc.log  ◀──▶  save_ptr / load / need_save, get_flags / set_pref
  aria-live  ◀──  announce_ptr / announce_len / announce_seq
sw.js: cache-first for ./, index.html, game.wasm
```

**Source layers.** `src/*.wat` are fragments. `tools/build.mjs` concatenates them in filename order inside one `(module …)`; WAT has no includes, so every `$name` must be unique across files. The layers are:
- `0x`: memory map, RNG, data (palette, fonts, generated strings and icons) and balance tables.
- `1x`: the simulation. State and save, actions, the End Day pipeline, pricing, weather, contracts and trucks.
- `2x`: presentation:
  - `20_layout`: layouts and hit regions.
  - `21_draw`, `21b_iso`, `21c_scene`: the 2D primitives and fonts; the isometric 3D rasteriser with light ramps; the farm scene and its generated model table.
  - `22_ui`, `22a`–`22d`: input, the frame loop and widgets; the Farm sheet; the other tabs; the screens; onboarding.
  - `22z_boot`: loader boot.
  - `23_overlay`: the stats overlay.
  - `24_replay`: recording, share codes and the viewer.
  - `25_qr`: the QR encoder.
- `30_exports.wat`: the export list.

**Memory.** One linear memory with a fixed map and no allocator. The full map is the header of [`src/00_memory.wat`](src/00_memory.wat); `tests/memory-map.test.mjs` checks that no two regions overlap.
- Game state (the save image) is at `0x1000`, the input log at `0x5000` and the balance tables at `0x6000`.
- UI state lives at `0x8000..0xFFFF`, outside the save image.
- IO staging is at `0x10000`, the QR encoder at `0x14000`, and the framebuffer starts at `0x18000`. `resize` grows memory to fit it.

**Generators.** The palette, fonts, 3D models, UI strings and icons, and QR tables are generated into the `.wat` files by `tools/gen-*.mjs` (`npm run gen`). Never hand-edit the generated sections.

**Determinism rules.** Replays and share codes depend on these:
- Integer-only maths: there is no `f32`/`f64` anywhere.
- Every random number comes from `$rng_next` in `01_rng.wat`, at a fixed list of draw sites. The order of those sites is part of the contract.
- Presentation files (numeric prefix ≥ 20) must never call the sim RNG; the build fails if they do. Visual randomness uses a render-only `$noise`.
- Rendering never writes sim state, and is a pure function of state, UI state, size, flags and time. `tests/render/determinism-render.test.mjs` renders every state fresh and after other states.
- Every time-based input rule reads one clock, which `frame(now)` and `set_now(now)` set. The loader calls `set_now` before each pointer or key event.

## Testing

- **Unit (`node:test`)**: every action's error codes leave state bytes unchanged; the End Day order on fixed seeds; spoilage, saturation, contracts, loans and net worth; save → load is byte-identical; layout sizes and non-overlap at every size × large text; touch targets ≥ 44 CSS px.
- **Golden hashes**:
  - `tests/golden.json` pins the sim state after 80 bot days (seeds 1–3) and 240 days (seed 1). The bot in `tests/sim/bot.mjs` loans, builds everything, runs two trucks, fulfils contracts and makes wine.
  - `tests/render/golden-render.json` pins framebuffer hashes for 14 farm scenes and 58 UI states at two sizes, plus the iso showcase and three QR codes.
  - After a deliberate change, run `UPDATE_GOLDEN=1 npm test`, review the PNGs and say in the commit why the hashes moved.
- **Replays**: the bot's 240-day log replays byte-identically from its share code. Every produced QR code is decoded back with jsQR.
- **e2e (Playwright)**: load time, the play flow, save / reload, corrupt saves and prefs, offline through the service worker, the overlay, replay links, the tutorial, and the packaged `dist/` at `/` and under `/sub/path/`.

## Sizes and performance

Measured on 2026-10-26 (Apple M3 Pro, Node 24, Chromium from Playwright 1.57). The game's own stats overlay shows the same numbers live.

| | raw | gzip -9 |
|---|---|---|
| `game.wasm` | 67,717 B | 36,265 B |
| `index.html` | 6,729 B | 3,373 B |
| `sw.js` | 502 B | 320 B |
| **total transfer** | | **39,958 B** |

| Measure | Result |
|---|---|
| First frame (e2e, from navigation start, local server) | 23.9 ms (phone 360×640@2), 22.9 ms (desktop 1280×800) |
| End Day (5 bot runs × 239 days) | median 5 µs, p95 8 µs, max 33 µs |
| Full redraw, 360×640 logical | median 0.43 ms (sunny), 0.45 ms (storm), p95 0.47 ms |
| Full redraw, 640×400 logical (1280×800 CSS) | median 0.60 ms (sunny), 0.63 ms (storm), p95 0.66 ms |

The redraws are `frame()` calls in Node (wasm only). The browser adds `putImageData`.

## Deploying (GitHub Pages)

1. Run `npm run dist`.
2. Publish the **contents** of `dist/` (three files) as the site root. For example, push them to a `gh-pages` branch, or set the Pages source to a folder that holds them. A project site under `https://user.github.io/HarvestChain/` works: every URL the loader and the service worker use is relative (the e2e suite serves `dist/` under `/sub/path/` to check this).
3. Serve it over HTTPS. Pages does, and the service worker requires it.

The service worker is cache-first, so a new deploy shows up **one load late**: the first visit after a deploy still runs the cached version while the new worker installs, and the next load gets the new one. The cache name is a hash of `game.wasm` + `index.html`, and old `hc-*` caches are deleted.

CI (`.github/workflows/ci.yml`) runs the unit tests, `check:dist` and the e2e suite on every push and pull request, and uploads `dist/` as an artifact. It does not deploy.

## Known limitations and spec deviations

- There is no sound (a spec non-goal).
- The bitmap font is uppercase only.
- Accessibility is limited to the canvas plus an `aria-live` announcer. There is no DOM mirror of the UI.
- PWA install is unverified. The manifest is an inline `data:` URI with one 192 px icon and no `start_url`, so that `index.html` stays within its budget.
- QR codes are drawn only for short runs: links up to 858 B, QR version 20-L. A full 240-day run's link is about 4.9 KB, so it is shared as a copied code.
- The following deviate from the spec by ruling:
  - The `game.wasm` ceiling is **40 KB gz / 100 KB raw**; the spec target is 20 KB gz. The build warns above the target and fails above the ceiling.
  - `index.html` is ≤ 4 KB gz; the spec says 3 KB.
  - Total transfer is about 39 KB gz; the spec target is 24 KB.
  - The string table is **3.4 KB**; the spec budget is 2.5 KB.
  - Share codes use a compact varint + RLE log with **no DEFLATE**.
  - The starting Wheat is unripe on day 1, so the tutorial spans two days.
  - The framebuffer can reach 1280×539 logical pixels (2.8 MB), not the spec's "≤ 2.6 MB".
