# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Pre-implementation. The only source of truth is `requirement-spec.md` (game design spec, rev 2). Read the relevant section before changing behaviour; section numbers (§) below refer to it. Update this file once the build script, tests and directory layout actually exist — the commands below are what the spec prescribes, not yet verified.

## What this is

HarvestChain: a turn-based (per-day) farm supply-chain strategy game — grow → process → sell → distribute — **written entirely in hand-written WebAssembly text (`.wat`)**. Static app, no backend, no framework, no bundler, no asset files. Plays on phone portrait (360×640 min) and desktop from one build.

Deliverable is exactly three files: `index.html` (inlines the loader JS), `game.wasm`, `sw.js`.

## Hard constraints (violating these is a bug)

- **Integer-only Wasm.** No `f32`/`f64` anywhere. Money = `i32` dollars; multipliers = `i32` basis points (10000 = ×1.0); growth, saturation, drift all fixed-point. This is what makes determinism work.
- **All randomness through the xorshift32 RNG in `01_rng.wat`.** Same seed + input log must yield byte-identical state on every device (replays/share codes depend on it).
- **Wasm features:** MVP + `bulk-memory` + `sign-ext` + `mutable-globals` only. No SIMD, threads, GC, exceptions, multi-memory.
- **Size budgets enforced by the build (exceeding fails it):** `game.wasm` ≤ 20 KB gz / 48 KB raw; `index.html` ≤ 3 KB gz; `sw.js` ≤ 1 KB gz; total ≤ 24 KB gz. String tables ≤ 2.5 KB raw.
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
- **Input**: one state machine in `22_ui.wat` (idle → pressed → drag|tap, 8 px slop, 300 ms long-press) shared by touch and mouse.
- All text is templated from short string tables, not prose.

## Build & test (as specified; confirm once scripts exist)

Toolchain: `wat2wasm` (wabt), `wasm-opt -Oz` (Binaryen), Node (built-in `node:test`, no framework), Playwright for browser smoke.

Pipeline: concat `src/*.wat` → `build/game.wat` → `wat2wasm` → `wasm-opt -Oz` → `game.wasm`; build prints raw + gz sizes and fails on budget breach.

- Run tests: `node --test` (loads `build/game.wasm` directly)
- Single test: `node --test --test-name-pattern="<name>" <file>`

Test expectations (§14.5): every action's error codes; End Day step order on fixed seeds; spoilage (tile/storage/truck, Cold Store/Refrigeration exemptions); saturation + recovery; contracts/reputation; bankruptcy/loans/net worth; save→load byte-identical; determinism golden hashes for three 80-day runs; framebuffer hash tests per screen (any visual change fails them — update hashes deliberately); Playwright at 360×640 and 1280×800.

## Development order

Sim-first, tests-first (§14.6): memory/RNG/balance/state → actions + End Day (playable from test runner before any pixel) → draw primitives/fonts/sprites → layout/UI/input/loader → save/replay/overlay/QR → onboarding/polish. Hand-written WAT is deliberately expensive; resist scope creep beyond v1 (§16).
