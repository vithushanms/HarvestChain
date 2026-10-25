# HarvestChain — Game Design Spec

**Date:** 2026-10-25
**Status:** Draft for approval (rev 2 — hand-written WebAssembly)
**Working name:** HarvestChain (owner may rename; alternatives considered: FieldToFork, Rootworks, Cropchain)

---

## 1. Intent

A small, fun, web-based **farm supply-chain strategy game**. The player plans a farm, grows crops, processes them into higher-value goods, and sells and distributes those goods across markets. The whole chain — **grow → process → sell → distribute** — is the game.

It must play equally well on a **phone (portrait, one thumb)** and a **laptop (mouse + keyboard)** from a single web build. No app store, no account, no backend.

The owner's own words: *"planning farm to process to selling end product and distribution — entire chain."* Tension comes from *all* of: limited land, limited money, time pressure, fluctuating market prices, weather, and competition for contracts.

**Second intent (owner's decision, 2026-10-25): the whole game is hand-written WebAssembly.** Simulation, rendering, UI, text — all in WebAssembly text format (`.wat`), assembled to a single `.wasm`, with a tiny fixed JavaScript loader. The game is also a **showcase of what hand-written Wasm genuinely wins at: size, load speed, steady frame timing, and bit-exact determinism**. Raw speed is *not* the pitch. The showcase features in §15 exist to make those four wins visible to a player, not just to a developer.

## 2. Goals, non-goals, anti-goals

**Goals**
- Fun in the first 5 minutes; strategic depth by minute 30.
- A full run (3 in-game years) takes roughly 2–3 hours of play, resumable across sessions.
- Every decision is a trade-off between the five pressures (land, money, time, market, weather).
- Touch-first UI that is also comfortable with a mouse. One codebase, responsive.
- Works offline after first load (installable PWA).
- **Tiny and instant:** total transfer under **24 KB gzipped**, first interactive frame under **100 ms** after the HTML arrives, on a mid-range phone.
- **Bit-exact determinism:** the same seed and input log produce the same game on every device, so a whole run is shareable as a short code.
- **Zero asset files:** every tile, icon, glyph, and texture is generated or packed inside the `.wasm`.

**Non-goals (v1)**
- Multiplayer, leaderboards, accounts, any server.
- Animals / livestock (planned v2 — see §16).
- Real-time ticking clock. The game is **turn-based by day**.
- Monetisation, ads, analytics.
- Sound and music (v2 candidate: procedural chiptune generated in Wasm).
- **Fitting the full game in a QR code.** A QR holds ~3 KB; this game's strings and UI alone exceed that. QR codes carry *runs* (seed + replay), not the game. A sub-3 KB "HarvestChain Mini" is an optional spin-off (§16).
- Screen-reader support of the game canvas beyond a live-region announcer (§13).
- Hand-written SIMD. Nothing in a turn-based farm game needs it; listed in §16 as a possible weather-particle flourish.

**Anti-goals (would make it a failure even if it "works")**
- Idle-game feel: waiting on timers with nothing to decide.
- Needing two hands or precision taps on a phone.
- A "correct build order" that trivialises every run. Weather, prices, and contracts must vary enough per run that plans need adjusting.
- Punishing the player for walking away. Turn-based means nothing happens until they press **End Day**.
- Pitching Wasm as "faster". The visible claims are size, load time, steady frames, determinism — and every number shown must be measured live, never hard-coded.
- Letting the Wasm constraint shrink the *game*. The design in §4–§12 is the product; §14 is how it is built.

## 3. Platform & constraints

- Browser game, **standalone static app** in its own folder (`harvestchain/`), hosted on GitHub Pages or any static host at its own URL. It is *not* a route inside the existing `site-kit` Next.js site; the personal site links to it. (Author's call, unchallenged.)
- Deliverable is **three files**: `index.html` (inlines the loader JS), `game.wasm`, `sw.js`. No framework, no bundler, no fonts, no images.
- Targets: iOS Safari 16.4+, Android Chrome, desktop Chrome/Firefox/Safari, current versions. Baseline Wasm MVP only — no SIMD, threads, or GC proposals in v1, so one binary runs everywhere.
- Smallest layout: **360 × 640 CSS px** portrait. Must also use space well at 1440 × 900.
- Minimum touch target 44 × 44 CSS px, enforced in the Wasm layout code at every scale.
- No horizontal scrolling. The game renders to one `<canvas>` sized to the viewport.
- Save in `localStorage`; autosave at end of every day; one save slot in v1 with "New game" confirm.
- **Size budget:** `game.wasm` ≤ 20 KB gzipped (≤ 48 KB raw), `index.html` ≤ 3 KB gzipped, `sw.js` ≤ 1 KB gzipped. Budgets are enforced in the build script; exceeding one fails the build.
- **Time budget:** first interactive frame < 100 ms after `index.html` is parsed (measured by the in-game load timer, §15); End Day resolution < 1 ms; full redraw at 360 × 640 < 4 ms on a 2021 mid-range Android phone.
- **Development cost is accepted:** hand-written WAT is roughly 5–10× the effort of TypeScript for the same feature. That is the point of the project, not a problem to engineer away. It does mean v1 must be built sim-first, tests-first (§14), and that scope creep in §4–§12 is now expensive.

## 4. Core loop (one in-game day)

Each day is a **turn**. The player acts freely, then presses **End Day**.

**Morning (player phase)**
1. Read the **Daily Gazette**: today's weather, tomorrow's forecast, one market hint, active events.
2. Harvest ripe crops (tap tile → Harvest, or **Harvest All**).
3. Plant empty plots.
4. Queue goods into processors (Mill, Press, …).
5. Load trucks and dispatch them to markets; sell at the Farm Stand.
6. Accept / decline contracts.
7. Buy land, build or upgrade buildings, take or repay loans.

**End Day (resolution, fixed order, deterministic)**
1. Apply today's weather effects to crops.
2. Crops grow one day; perishables age.
3. Processors consume inputs and produce outputs (up to daily capacity).
4. Aging goods (Wine) advance.
5. Spoilage removes expired perishables (storage and in non-refrigerated trucks).
6. Trucks advance one day; arriving trucks sell cargo at destination prices and begin the return trip; returning trucks come home with cash.
7. Contracts: fulfilled ones pay out; expired ones apply penalties.
8. Market prices update (random walk + event modifiers + demand recovery).
9. Daily upkeep deducted; loan interest accrued.
10. Season rollover check; next-day events rolled.
11. Bankruptcy check (§10). Autosave.

Target decision time per day: 20–90 seconds. 240 days per full run.

## 5. The farm

**Grid.** Square grid of **plots**. Start **4 × 4** (16 plots). Expand by buying the next ring up to **8 × 8** (64 plots). Each plot holds exactly one of: empty field, a crop, or a building. All buildings are 1 × 1 in v1.

**Land prices.** Each expansion buys a full ring. Ring costs: 5×5 → \$600, 6×6 → \$1,400, 7×7 → \$3,000, 8×8 → \$6,000.

**Starting state.** Day 1, Spring. \$500 cash. 16 plots: 4 pre-planted Wheat (day 2 of growth), 1 Farm Stand (fixed, does not occupy a plot), 1 small truck, base storage 30 units, no buildings.

## 6. Crops

Five crops in v1, chosen so each has a distinct role.

| Crop | Seed cost | Grow days | Yield / harvest | Raw price (base) | Seasons | Notes |
|---|---|---|---|---|---|---|
| Wheat | \$10 | 3 | 4 units | \$8 | Spring, Summer, Autumn | Safe starter. Never spoils. |
| Corn | \$12 | 4 | 5 units | \$7 | Summer, Autumn | High volume, low value. Never spoils. |
| Tomato | \$15 | 3 | 6 units | \$10 | Spring, Summer | **Perishable: spoils 2 days after harvest** unless processed. Highest raw margin. |
| Apple | \$40 | 8 to mature, then every 3 | 8 units | \$12 | Spring–Autumn harvests; tree survives Winter | Long-term investment. Occupies plot permanently. |
| Grape | \$30 | 6 | 5 units | \$15 | Summer, Autumn | Gateway to Wine, the highest-value chain. Spoils in 3 days. |

**Season rules.** Out-of-season planting is blocked (button disabled with reason). A crop still growing when its season ends keeps growing at **half speed**; in **Winter** nothing grows except inside a **Greenhouse**. Apple trees pause in Winter and resume in Spring.

**Growth display.** Three visual stages per crop (sprout / growing / ripe) plus a small day counter on the tile.

**Harvest and storage (author's call).** Harvesting moves units into storage; a harvest that would exceed storage capacity is **blocked** (the tile shows a "Storage full" badge; Harvest All skips it). A ripe crop waits on its tile. Ripe **Wheat, Corn, and Apple wait indefinitely**; ripe **Tomato and Grape start their spoil timer on the tile** from the day they ripen and rot in place when it expires. Apple trees hold one harvest of 8 until picked — yields do **not** accumulate; the next 3-day cycle starts after picking. Storage therefore caps throughput and makes Warehouse / Cold Store a real decision.

## 7. Processing (buildings)

Buildings sit on a plot, cost money to build, and cost **upkeep per day**. Each processor has a **daily input capacity**. Inputs are pulled from storage automatically in the morning if the player has queued a recipe ("Auto: Wheat → Flour"), or manually per day.

| Building | Build cost | Upkeep / day | Recipe(s) (per day capacity) | Unlock |
|---|---|---|---|---|
| **Mill** | \$250 | \$3 | 2 Wheat → 1 Flour; 2 Corn → 1 Cornmeal (cap 8 input units) | Start |
| **Cannery** | \$400 | \$4 | 3 Tomato → 1 Sauce (cap 9 input) | Start |
| **Press** | \$350 | \$4 | 2 Apple → 1 Apple Juice; 2 Grape → 1 Grape Juice (cap 8 input) | Start |
| **Bakery** | \$600 | \$5 | 1 Flour → 1 Bread; 1 Cornmeal → 1 Cornbread (cap 6 input) | Own a Mill (sole condition) |
| **Cellar** | \$900 | \$6 | 1 Grape Juice → 1 Wine, **ages 5 days** (holds 10 aging) | Reputation ★3 |
| **Warehouse** | \$300 | \$2 | +40 storage capacity; stackable | Start |
| **Cold Store** | \$500 | \$5 | +20 storage; perishables inside do not spoil | Reputation ★2 |
| **Greenhouse** | \$450 | \$4 | Occupies its plot; grows **one** crop of any season, any time, at normal speed; immune to weather | Year 1 Autumn |
| **Well** | \$200 | \$1 | Negates Drought for all crops | Start |
| **Garage** | \$500 | \$3 | +1 truck slot (max 3 trucks total); enables truck upgrades | Start |

**Upgrades (v1, one tier each):** Mill II / Cannery II / Press II / Bakery II double capacity for 80% of build cost.

**Goods and base prices**

| Tier | Good | Base price | Perishable? |
|---|---|---|---|
| 0 | Wheat / Corn / Tomato / Apple / Grape | 8 / 7 / 10 / 12 / 15 | T: 2d, G: 3d, others no |
| 1 | Flour | 22 | no |
| 1 | Cornmeal | 18 | no |
| 1 | Sauce | 40 | no |
| 1 | Apple Juice | 30 | 6 days |
| 1 | Grape Juice | 38 | 4 days |
| 2 | Bread | 35 | 3 days |
| 2 | Cornbread | 28 | 3 days |
| 2 | Wine | 120 | no |

Value is designed so each processing step beats selling raw by 30–60% while costing a plot, build money, upkeep, and time — and perishables punish over-production.

## 8. Markets & prices

Three market tiers plus contracts.

| Market | Price multiplier | Reach | Capacity | Notes |
|---|---|---|---|---|
| **Farm Stand** | ×0.8 | Instant, no truck | Unlimited volume, saturates **2% per unit** | Always open. |
| **Town Market** | ×1.0 | Truck, **1 day each way** | Per truck, saturates **1.5% per unit** | Standard. |
| **City Market** | ×1.4 for tier 1–2 goods, ×0.6 for raw | Truck, **2 days each way** | Per truck, saturates **1% per unit** | Wants processed goods only. |

**Demand saturation applies to every market** (author's call). Each unit of a good sold at a market lowers that market's price for that good by the market's saturation rate, floor 50%. Saturation **recovers overnight**: Farm Stand fully, Town by 50% of the gap per day, City by 34% per day (so a 3-truck Wine convoy to the City depresses Wine there for about three days). This is the "demand recovery" in End Day step 8 and is what keeps a single high-value chain from being a money printer.

**Price model.** Every good has a market price per market: `base × marketMultiplier × drift × eventModifier × saturation`. `drift` is a bounded random walk per good (step ±5% per day, clamped 0.7–1.3). Event modifiers come from the Gazette (e.g. "City bread craze: Bread ×1.5 for 5 days"). The Gazette always prints **tomorrow's drift direction** for two random goods so planning is possible.

**Contracts.** Posted on a board; 2–3 visible at a time, refreshed every 5 days or when one is taken. Format: *"Deliver 12 Sauce to Town by Day 34 → \$720 (×1.5)."* Payout is **×1.5 of base price, fixed at posting** — not affected by drift, events, or saturation. Taking one locks it in; deliver by dispatching a truck tagged to the contract.

Fulfilment rules (author's calls):
- **Exact quantity only.** The cargo picker enforces the contract quantity for tagged goods; no partial delivery. Any extra untagged cargo on the same truck sells at market price as normal.
- **Deadline = arrival day.** The truck must arrive at the destination on or before Day N; the UI shows the arrival day before Send and blocks tagging if it cannot make it.
- **On time:** payout + **1 Reputation point**.
- **Late or never delivered:** −1 Reputation point and a cash penalty of 10% of contract value. A late tagged shipment sells its goods at that day's market price instead.
- Only one contract may be tagged per truck trip.

**Reputation** is a point counter mapped to a star rank: ★1 at 0 pts, ★2 at 3, ★3 at 8, ★4 at 15, ★5 at 25 (points floor at 0). Rank gates Cold Store (★2), Cellar (★3), and the size and payout of contracts offered. Milestones observe reputation; they never set it. Starting Reputation 0 pts (★1).

## 9. Distribution (trucks)

Trucks are the physical layer between farm and market. Starting truck: **capacity 20 units**, unrefrigerated.

- Dispatch: choose destination, drag/tap goods from storage into the truck, optionally tag a contract, **Send**. Truck is away for the round trip; cargo sells on arrival at that day's prices; truck returns with cash.
- A truck in transit shows on a small **route strip** (Farm — Town — City) with days remaining.
- Perishables in an unrefrigerated truck keep aging; they can spoil before arrival (the UI warns before Send).
- **Upgrades** (need Garage): Capacity +20 (\$300, twice), **Refrigeration** (\$400, stops spoilage in transit), **Fast** (\$500, −1 day on City round trip).
- Extra trucks: \$450 each (max 3).

The choice "which goods go on the one truck going to the City this week" is intended to be a central decision.

## 10. Money, loans, bankruptcy

- Start \$500. Daily upkeep is the sum of building upkeep.
- **Loan:** borrow up to \$1,500 at **1% per day** compound interest; repay any amount any morning. Only one loan at a time.
- **Bankruptcy:** if cash is negative at the end of a day and no loan room remains, the player gets a **3-day grace** warning. Still negative after 3 days → **Game Over** screen with final score and a *Try again* button. Cash can go negative only from upkeep/interest; purchases are blocked when unaffordable.

## 11. Time, seasons, weather, events

- A **year = 4 seasons × 20 days = 80 days**. A run = **3 years = 240 days**, then **Endless** continues if the player wants.
- Season affects what can be planted (§6) and base weather odds.

**Weather (one per day, shown in Gazette with tomorrow's forecast; forecast is 80% accurate):**

| Weather | Effect | Mitigation |
|---|---|---|
| Sunny | Normal | — |
| Rain | +10% growth that day | — |
| Drought (Summer-weighted) | Crops don't grow that day; 3-day streak kills 25% of standing crops | Well |
| Storm (Spring/Autumn) | Destroys 20% of ripe/growing crops (random tiles) | Greenhouse crops immune |
| Frost (Autumn/Winter) | Kills Tomato and Grape tiles outright | Greenhouse |
| Heatwave (Summer) | Perishables spoil 1 day faster | Cold Store |

**Market/news events (roll ~every 4–6 days, last 3–7 days):** demand surge for a good (×1.5), glut (×0.6), road closure (City trips +1 day), festival (Farm Stand saturation disabled for 2 days), fuel spike (dispatch costs \$20 per trip while active), bumper harvest (all yields +50% next harvest).

Both weather and events are generated from the **seeded integer RNG** so a run is reproducible in tests and shareable as a seed + input log (§15.4).

## 12. Progression & win condition

**Unlock model (author's call).** Every building's unlock is a **predicate on game state** listed in its §7 row (owning a building, a reputation rank, a season reached). Milestones are a **separate, observe-only system**: they watch state, pay cash, and never unlock or set anything themselves. This keeps `unlocks` as per-item predicates and avoids a milestone dependency graph.

**Net worth (author's call).** `cash + 50% of build cost of standing buildings and upgrades + 50% of land purchase prices − outstanding loan principal and interest`. **Inventory is deliberately excluded**: goods only count once sold, so the \$50,000 target cannot be reached by hoarding Wine; it has to move through the distribution layer.

**Milestones (Journal).** Shown as a checklist; each pays a cash bonus.

1. Sell your first processed good — \$100
2. Reach \$2,000 net worth — \$200
3. Complete 3 contracts — \$200
4. Survive Year 1 with ≥ \$3,000 net worth — \$500
5. Reach Reputation ★3 — \$300
6. Sell 10 Wine — \$1,000
7. Reach **\$50,000 net worth** within 240 days — **Run complete**

**Run end.** The moment net worth reaches \$50,000 (checked at End Day) the **Results screen** appears with score and a *Continue in Endless* button; Endless keeps playing with no further milestones. If Day 240 ends without reaching it, Results also appears, scored as-is, with the same Endless option.

**Score** at run end (or at Game Over): net worth + 100 × Reputation points + 50 × contracts completed. Shown on the Results screen with a shareable text summary.

**Difficulty (v1):** one setting, tuned to be comfortable but not trivial. Difficulty toggle is v2.

## 13. UI & UX

Design brief: **warm pixel art, rendered by the Wasm module into a framebuffer** — the natural fit for a hand-drawn-in-bytes game, and the visual proof that there are no asset files. Logical resolution is chosen per viewport (§14) and scaled with integer nearest-neighbour so pixels stay crisp. Earthy 16-colour palette (soil brown, wheat gold, leaf green, sky blue, barn red as accent) stored as one 64-byte table. Two bitmap fonts packed in the module: **5 × 7 for body, 3 × 5 for tile badges**, uppercase + digits + a dozen symbols. UI chrome (bars, tabs, panels, buttons) is drawn procedurally — flat fills, 1 px borders, 2 px rounded corners — never bitmaps. **Every state must be legible without colour alone** (glyph icons + text labels on prices, badges on tiles).

All text is **templated from short string tables**, not free prose: Gazette lines are built as `[GOOD] [ARROW] [MARKET]` / `[WEATHER] TOMORROW` / `[EVENT NAME] · [N] DAYS`. Onboarding hints and milestone blurbs are ≤ 40 characters each. Total string table budget: 2.5 KB raw.

**Layout engine.** The module receives the canvas size each frame and lays out from a small set of anchored rectangles (top bar, grid, tab bar, panel). The same code produces the portrait, landscape, and tablet arrangements below — layouts are data, not separate renderers.

### Mobile (portrait, ≤ 768 px)
- **Top bar:** Day / Season / weather icon (tap → Gazette); cash; Reputation ★; **End Day** button (primary, right side, always visible).
- **Centre:** farm grid, full width, square tiles. 8 × 8 at 360 px ≈ 42 px tiles — acceptable, since selection opens a sheet rather than relying on in-tile controls.
- **Bottom tab bar:** Farm · Process · Market · Trucks · Build.
- Tapping a tile opens a **bottom panel** (drawn in-canvas, slides up over the lower 45%) with that tile's status and actions (Plant → crop picker; Harvest; Build → building picker; Demolish). Dismiss by tapping outside, the ✕, or a downward drag ≥ 40 px.
- **Harvest All** button appears in the top bar when any crop is ripe.
- Toasts (top, non-blocking, 3 s) for events and sales; the Gazette is a full-screen panel each morning (dismissable, "don't auto-open" toggle).

### Laptop (≥ 1024 px)
- Two-column: grid left (max 640 CSS px), **side panel** right with the same five tabs as the bottom bar.
- Hover highlights tiles and shows a one-line status in the panel header; click selects into the side panel instead of a bottom panel.
- Keyboard: `E` End Day, `1–5` tabs, `H` Harvest All, `Esc` close, arrow keys move tile cursor, `Enter` opens tile, `` ` `` stats overlay, `R` replay viewer on the Results screen.

### Tablet (768–1023 px)
- Mobile layout with larger tiles and a two-column bottom panel.

### Accessibility within a canvas (author's call)
A canvas has no DOM for assistive tech. v1 commits to: full keyboard operability on desktop; a hidden `aria-live` region that the loader fills from a message buffer the module writes (tile focus changes, sales, events, End Day summary); colour contrast ≥ 4.5:1 across the palette; a **large-text toggle** that switches the layout to 1.5× scale; `prefers-reduced-motion` disables panel slides and particle weather. Full screen-reader navigation of the grid is a stated limitation.

### Key screens
1. **Title / Continue / New Game / Daily Seed** (custom seed optional, "How to play" link, load-timer footer)
2. **Farm** (default)
3. **Process** — list of buildings with input/output queues and "Auto" toggles
4. **Market** — price board (per market, with trend arrows and event badges), Farm Stand sell panel, Contract board
5. **Trucks** — truck cards, route strip, dispatch flow (destination → cargo → confirm)
6. **Build** — grid of buildings with cost/upkeep/unlock state; land expansion button
7. **Gazette** (morning sheet)
8. **Journal** (milestones) and **Results** (end of run / game over; score, share code, in-canvas QR, replay viewer)
9. **Stats overlay** (toggle, §15.2) and **Replay viewer** (§15.4)

### Onboarding
A 6-step guided first day using the real UI with spotlight hints (plant, harvest, sell at Farm Stand, build Mill, send truck, End Day). Skippable. No separate tutorial level.

## 14. Technical design — hand-written WebAssembly (owner's decision; details are the author's calls)

### 14.1 Shape of the system

```
index.html  ── inlines loader.js (≤ 3 KB gz) ──┐
                                               ├─ instantiates ─▶ game.wasm (≤ 20 KB gz)
sw.js       ── caches the three files ─────────┘        │
                                                        │ exports: init, pointer, key, resize,
                                                        │          frame, save_len, load, replay_*
                                                        │ memory:  framebuffer · state · strings
                                                        ▼
                                              <canvas> ◀── putImageData(framebuffer) each dirty frame
```

**Everything that is "the game" is in `game.wasm`:** state, rules, End Day pipeline, RNG, pricing, layout, text rendering, tile art, UI panels, input handling, save encoding, replay log, stats overlay. The loader is **dumb glue** and must stay that way: it owns nothing about the game and never changes between content updates.

### 14.2 The loader (`index.html`, plain JS, no dependencies)

Responsibilities, exhaustively:
1. Record `performance.now()` at script start for the load timer.
2. `fetch` + `WebAssembly.instantiateStreaming` `game.wasm`.
3. Create one `<canvas>`, size it to the viewport × `devicePixelRatio` capped at 2, `image-rendering: pixelated`; call `resize(w, h, dpr)` on `resize`/`orientationchange`.
4. Translate `pointerdown/move/up`, `wheel`, `keydown/up` into `pointer(x, y, type)` / `key(code, down)` calls. Nothing else — hit-testing is in Wasm.
5. Run `frame(now_ms)` via `requestAnimationFrame` **only while the module's `dirty` flag or an animation is active**; otherwise idle at zero CPU.
6. Blit: wrap the framebuffer region of `memory.buffer` in an `ImageData` and `putImageData` once per frame.
7. Persistence: on module request (an exported `want_save` flag set after End Day, or `visibilitychange`), copy `save_len()` bytes from the save region to `localStorage['hc.save']` as base64; on start, decode and call `load(ptr, len)` if present.
8. Hash loader: if `location.hash` is non-empty, decode it and call `replay_load(ptr, len)` (§15.4).
9. Fill the hidden `aria-live` element from the announce buffer when its sequence counter changes.
10. Register `sw.js`.

The loader is checked into the repo *minified and readable side by side*; the readable version is the source of truth.

### 14.3 The module (`src/*.wat`)

- **One module, many source files.** WAT has no `include`; a ~30-line build script concatenates `src/*.wat` in a fixed order into `build/game.wat`, then `wat2wasm` (wabt) → `wasm-opt -Oz` (Binaryen) → `game.wasm`. The build prints raw and gzipped sizes and fails if a budget in §3 is exceeded.
- **Baseline Wasm 1.0 + `bulk-memory` + `sign-ext` + `mutable-globals`** (all universally shipped). No SIMD, threads, GC, exceptions, or multi-memory in v1.
- **Integer-only.** No `f32`/`f64` anywhere. Money is `i32` dollars; multipliers are `i32` basis points (10 000 = ×1.0); growth, saturation, drift all fixed-point. This is what makes determinism free and the binary small.
- **One linear memory, fixed map.** Hand-laid regions, no allocator, no stack discipline beyond Wasm's own:

| Region | Size | Contents |
|---|---|---|
| `0x0000` | 4 KB | Globals mirror, scratch, string tables, palette, fonts, glyph icons |
| `0x1000` | 16 KB | **Game state** — the save image, byte-identical to what is persisted |
| `0x5000` | 4 KB | Replay/input log (§15.4) |
| `0x6000` | 8 KB | Balance tables — every number in §5–§12 as data |
| `0x8000` | 64 KB | Layout rects, hit regions, draw lists, announce buffer |
| `0x18000` | ≤ 2.6 MB | Framebuffer, RGBA, logical resolution (max 1280 × 720 × 4) |

- **Game state is a plain struct in memory.** `state.wat` documents every offset in a comment header; `tools/state.json` mirrors it so tests can read fields by name.
- **Source layout** (`src/`, concatenation order):
  1. `00_memory.wat` — memory, globals, region constants
  2. `01_rng.wat` — xorshift32, seeded; **every** random call goes through it
  3. `02_data.wat` — palette, fonts, icons, string tables (data segments)
  4. `03_balance.wat` — balance tables (data segments) + accessors
  5. `10_state.wat` — state layout, `init(seed)`, `load`, `save_len`
  6. `11_actions.wat` — each player action as a function returning `0` or an error code; validation lives here
  7. `12_endday.wat` — the §4 pipeline, one function per step, called in order
  8. `13_pricing.wat`, `14_weather.wat`, `15_contracts.wat`, `16_trucks.wat`
  9. `20_layout.wat` — rect anchoring for portrait/landscape/tablet + large-text
  10. `21_draw.wat` — fill, rect, line, glyph, text, icon, tile sprites
  11. `22_ui.wat` — screens, panels, tabs, toasts, hit-testing, input state machine
  12. `23_overlay.wat` — load timer, stats overlay, frame-time graph (§15)
  13. `24_replay.wat` — input log append, encode/decode, playback
  14. `30_exports.wat` — the public surface in §14.1
- **Rendering** is immediate-mode into the framebuffer each dirty frame. Tile sprites are 16 × 16, 4 bpp indexed into the palette, packed in `02_data.wat`; crop stages are three sprites each. Logical resolution: canvas CSS size scaled so the grid tile is an integer multiple of 16 px; the result is nearest-neighbour upscaled by the canvas itself.
- **Input** is a small state machine in `22_ui.wat`: idle → pressed → (drag | tap) with a 8 px slop and 300 ms long-press, so touch and mouse share one path.

### 14.4 Persistence and versioning

- The save is the raw 16 KB state region, prefixed by a 4-byte magic `HC` + 2-byte version. `load` rejects a wrong magic and runs a per-version migration function for older versions (append-only state layout makes most migrations no-ops).
- Autosave after End Day and on `visibilitychange`. One slot, `hc.save`.

### 14.5 Testing

- **Test runner:** Node's built-in `node:test`, loading `build/game.wasm` directly. No test framework dependency.
- **State access in tests** via `tools/state.json` offsets. A helper `readState(mem)` returns a plain object.
- Required coverage of the sim, all driven through exports:
  - every action's validation error codes (plant out of season, build unaffordable, storage full, tag an impossible contract…);
  - `endDay` step by step on fixed seeds, asserting the §4 order (growth before processing, processing before spoilage…);
  - spoilage on tiles, in storage, in trucks; Cold Store and Refrigeration exemptions;
  - saturation and overnight recovery per market; drift clamping;
  - contract payout, late penalty, reputation thresholds;
  - bankruptcy grace, loan interest, net worth excluding inventory;
  - save → load round-trip is byte-identical; migration from v1 fixtures.
- **Determinism:** the same seed + input log run twice must yield identical state bytes; a golden-hash test for three canned 80-day runs guards against accidental drift.
- **Rendering:** hash the framebuffer at fixed seed/size for a handful of screens; the test fails on any change so visual edits are deliberate.
- **Browser smoke:** Playwright at 360 × 640 and 1280 × 800 — load, plant, End Day, sell, reload-restores-save, hash-loads-replay. Also asserts the load-timer value is under 100 ms in the headless profile.

### 14.6 Development order (author's strong recommendation)

1. Memory map, RNG, balance data, state init — with tests.
2. Actions and End Day pipeline — tests before each step. **Playable from the test runner before a single pixel exists.**
3. Draw primitives, fonts, sprites; framebuffer hash tests.
4. Layout + UI + input; loader; Playwright smoke.
5. Save/load, replay, stats overlay, QR export.
6. Onboarding, polish, balance passes.

## 15. Wasm showcase features

These exist to make the four real advantages — size, load time, steady frames, determinism — visible to a player. Each must show **live-measured** numbers.

### 15.1 Load timer
A small line under the title: *"Loaded in 47 ms · 18.2 KB"*. `ms` is from loader script start to the first `frame()` return; `KB` is the actual compressed transfer size read from `performance.getEntriesByType('resource')`. Also shown on the Results screen.

### 15.2 Stats overlay
Toggle with `` ` `` or a triple-tap on the top-left corner. Drawn by the module itself (`23_overlay.wat`): wasm bytes raw/gz, total transfer, load ms, memory pages in use, last End Day µs, last frame ms, and a **120-sample frame-time sparkline**. Below it, a static reference row — *"Typical engine build of a game this size: 5–15 MB, 2–6 s"* — labelled as typical, not measured, so it is honest.

### 15.3 Zero asset files
The Build and Title screens carry a one-line footer: *"0 image files · 0 font files · 1 wasm"*. Everything drawn is from data segments or procedural code. Field tiles get a seed-derived two-tone dither so no two farms look identical.

### 15.4 Replays and share codes (the determinism showcase)
- Every player action is appended to the **input log** as a compact record (day, action id, args). A full 240-day run is typically under 2 KB.
- **Share code** = base64url( seed · version · deflated input log ). Shown on the Results screen with Copy and a **QR code rendered in-canvas** encoding `https://<host>/#<code>`. The hash is never sent to the server.
- Scanning or opening the link runs the **replay viewer**: the module replays the log day by day with a scrubber; the viewer can stop at any day and **take over** as a new run (the log is truncated there, seed kept).
- A **daily seed** mode (seed = date) lets two people compare runs with the same weather and prices.

### 15.5 Steady frames
The sparkline in §15.2 is the proof. With no GC and no allocation, frame times are flat. Weather effects (rain/storm) draw a few hundred scalar particles so the overlay has something to show moving; it must stay flat during them.

### 15.6 Look under the hood (optional, after v1 is complete)
A panel listing the module's section sizes, function count, and a live per-frame call-count histogram from a counter array the hot functions increment. Not a disassembly view.

## 16. Scope

**v1 (this spec):** §4–§15 excluding §15.6.

**v2 candidates (not designed yet):** livestock (cows → milk → cheese, chickens → eggs), a second difficulty, a Research tree, 2 × 2 buildings, procedural chiptune music generated in Wasm, cloud save, §15.6, SIMD weather particles if a device survey shows universal support.

**Optional spin-off — "HarvestChain Mini":** a sub-3 KB arcade game (e.g. a single-crop plant-and-sell timing game) written against the same loader so **the whole game fits in a QR code** printed on a card. Same loader, same hash mechanism, separate `.wasm`. Only worth doing after v1 ships; designed separately.

## 17. Left to the builder

- Final 16 × 16 sprite art and the three growth-stage sprites per crop; glyph icon set.
- Exact animation and transition timings (within reduced-motion rules).
- Copy for Gazette templates, toasts, milestone blurbs, and the onboarding hints, within the 2.5 KB string budget.
- Number tuning after playtest — §6–§11 numbers are the starting balance, kept in `03_balance.wat`. The intent to preserve: each processing step is worth it but never free; perishables create real pressure; a careful player finishes Year 1 at roughly \$3–5k.
- Exact memory offsets within the regions of §14.3; the replay record encoding; the QR encoder's error-correction level.
- Choice of base64url vs a denser alphabet for share codes.

## 18. Success criteria

- A new player finishes the guided first day in under 3 minutes on a phone, one-handed.
- A tester who plays 30 minutes can name at least one trade-off they changed their mind about mid-run.
- Two runs with different seeds produce visibly different "best plans".
- **`game.wasm` ≤ 20 KB gzipped; total transfer ≤ 24 KB gzipped**, enforced by the build.
- **Load timer reads < 100 ms** on a 2021 mid-range Android phone over 4G after HTML arrives; < 50 ms on a laptop.
- **Frame-time sparkline stays within ±1 ms** during storm particles on that phone.
- **Determinism:** a share code from an iPhone replays byte-identically on Android and desktop; golden-hash tests green.
- Lighthouse PWA installable; works offline on reload; no horizontal scroll at 360 px.
- Sim test suite green; framebuffer hash tests green.
