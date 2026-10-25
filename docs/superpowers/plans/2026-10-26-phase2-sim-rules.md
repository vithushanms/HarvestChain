# HarvestChain Phase 2 — Sim Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player action and the full End Day pipeline (spec §4–§12) in `game.wasm`, so a whole 240-day run is playable from the test runner, before any pixel exists (spec §14.6 step 2).

**Architecture:** Player actions go through one exported dispatcher, `act(id, a, b, c) → err`. Each action validates first and mutates only on success. `end_day() → err` runs the §4 steps as one function each, in fixed order. Weather, events and price drift draw from `$rng_next` in a fixed call order, so a run is a pure function of seed + action sequence. State grows by appending to the phase 1 layout.

**Tech Stack:** As phase 1 (WAT fragments, wabt, Binaryen, `node:test`).

**Spec:** `requirement-spec.md` §4–§12, §14.3, §14.5. Phase 1 plan: `docs/superpowers/plans/2026-10-26-phase1-sim-foundation.md` (its Decisions still hold). Read `CLAUDE.md` and `README.md` first.

## Global Constraints

- All phase 1 Global Constraints apply: integer-only, all randomness via `$rng_next`/`$rng_range`, all numbers in `03_balance.wat`, append-only state, budgets enforced by the build.
- Money is `i32` dollars. Price maths runs in **cents** with basis-point multiplies (`v = v * bp / 10000`), so no intermediate exceeds i32. Unit price = `max(1, cents / 100)`.
- An action that returns non-zero must leave state bytes unchanged. Every action test asserts this.
- Actions are blocked with `E_STATUS` unless status is Playing or Endless. `act` never calls `$rng_next`, except `ACT_DECLINE` (contract reroll), which is logged like any action, so determinism holds.
- New tables go in `03_balance.wat` and `tools/balance.json`, with values asserted in `tests/balance.test.mjs`. New state fields go in `10_state.wat`, `tools/state.json` and `$STATE_LEN`.

## Decisions (spec silent or ambiguous)

1. **Weather enum:** `Sunny 0, Rain 1, Drought 2, Storm 3, Frost 4, Heatwave 5`. Season weights (percent, new table `T_WEATHER`, rows = seasons, cols = weathers):
   Spring `55,30,0,15,0,0` · Summer `50,15,20,0,0,15` · Autumn `45,25,0,15,15,0` · Winter `50,20,0,0,30,0`.
2. **Forecast:** at each End Day step 10, `today ← tomorrow`, then roll the next `tomorrow` from the new day's season table. `forecast = tomorrow` if `rng_range(100) < 80`, else a fresh roll from the same table (which may coincide). Day 1: today Sunny; tomorrow and forecast are rolled in `init`.
3. **Growth** in hundredths of a day per End Day. Base 100; Rain → 110; crop out of season (crop `seasonMask` lacks the current season) → half (50 / 55); Winter → 0; Drought → 0 unless a Well exists. Greenhouse crops always get 100 and ignore weather. A crop is ripe when `progress ≥ target`, where `target = growDays*100`, or `regrowDays*100` for a mature Apple. Growth stops at ripe.
4. **Apple:** first cycle 8 days. Harvesting sets `flags.appleMature` and resets progress. The tile is never cleared by harvest. Winter → 0 growth.
5. **Ripe spoiling on tile:** step 2 increments `ripeAge` for ripe Tomato/Grape (Heatwave +2 instead of +1, unless greenhouse). The tile is cleared when `ripeAge ≥ spoilDays`.
6. **Storm:** each non-greenhouse crop tile with `rng_range(5) == 0` loses its crop. An Apple tree survives but its progress resets to 0. **Frost:** non-greenhouse Tomato/Grape tiles are cleared. **Drought streak:** `droughtStreak` +1 on a Drought day without a Well, else reset to 0. On reaching 3: each non-greenhouse crop tile with `rng_range(4) == 0` is cleared (Apple tree resets progress), then the streak resets to 0. Tiles are iterated in index order, so RNG use is deterministic.
7. **Storage:** `cap = startStorage + 40·Warehouses + 20·ColdStores`, `used = Σ inv`. **Cold Store:** the first `20·ColdStores` perishable units, taken oldest-first across goods in id order, do not age. Heatwave ages unprotected storage perishables +2.
8. **Spoilage:** a unit is removed when `age ≥ perishDays`. Ages stop at 7 (buckets 0..7). Removal comes after aging.
9. **Inventory removal is always oldest-first** (highest age bucket first). Additions go to age 0.
10. **Processing (step 3):** each building tile with a recipe set (`tile.recipe` = recipe row + 1; a new tile byte 7) consumes whole batches of `inQty`, oldest-first, up to `inputCap` input units (×2 if upgraded), and adds outputs at age 0. This is the spec's "Auto" toggle. There is no separate manual mode (ruling). Tiles are processed in index order.
11. **Cellar:** a per-tile 5-bucket aging array (u8, new state region `cellar[64][5]`). Step 3 moves Grape Juice into bucket 4, up to `cellarHold` minus the units already aging. Step 4 shifts buckets down. Units leaving bucket 0 become Wine in storage. If storage is full they stay in bucket 0.
12. **Prices:** `cents = base*100`; then `×` market multiplier (raw = tier 0 uses `multRawBp`, else `multProcBp`), `×` drift[g], `×` the event modifier for (market, good) (product of active surge 15000 / glut 6000), `×` sat[m][g]. Selling a unit applies the current price, then `sat -= satPerUnitBp`, floored at `satFloorBp`. During Festival, Farm Stand sales do not lower sat.
13. **Drift:** each good keeps a pending step `driftNext[g] ∈ {-500, 0, +500}` (i16). Step 8 applies it with clamping to 7000..13000, then re-rolls via `rng_range(3) - 1` × `driftStepBp`. The Gazette's two hint goods (`hintGood[2]`) are rolled at step 10 with `rng_range(13)` and may coincide. Their direction = sign of `driftNext`.
14. **Saturation recovery (step 8):** `sat += (10000 - sat) * recoverBp / 10000`.
15. **Events:** 3 slots `{kind u8, market u8, good u8, daysLeft u8}`. Kinds `None 0, Surge 1, Glut 2, RoadClosure 3, Festival 4, FuelSpike 5, Bumper 6`. `nextEventDay` starts at `5`. At step 10, if `day+1 ≥ nextEventDay` and a slot is free: kind = `1 + rng_range(6)`, market = `rng_range(3)`, good = `rng_range(13)`, duration = `3 + rng_range(5)` (Festival is fixed at 2), then `nextEventDay = day + 1 + 4 + rng_range(3)`. Each step 10 decrements `daysLeft` of active events and frees slots at 0 *before* rolling. Bumper: while active, harvest yield ×3/2 (floor). RoadClosure: City trips sent while active take +1 day outbound. FuelSpike: sending a truck costs $20.
16. **Trucks:** capacity `truckCap + 20·capLvl`. Loading moves oldest-first from storage, keeping ages. Send sets `phase=1`, `daysLeft = travelDays(dest)` (+1 for City under RoadClosure). Fast on City: return leg is 1 instead of 2. Arrival day = `day + daysLeft`. Step 5 ages unrefrigerated cargo (Heatwave +2) and spoils it. Step 6: each away truck decrements; on outbound reaching 0 it fulfils its tagged contract (if any; payout straight to cash), sells the remaining cargo at the destination (proceeds to `cashBack`), and sets `phase=2` with `daysLeft = return leg`. On return reaching 0 it adds `cashBack` to cash and goes home. Truck slots = `1 + Garages`, max 3.
17. **Contracts:** board 3 slots, visible count = 2 below ★3 and 3 at ★3+. Accepted list max 3. Record `{good u8, market u8, qty u8, active u8, deadline u16, payout u16}` (8 B). Generation (`$contract_roll`): good from tier ≤ (rank ≥ 3 ? 2 : 1), chosen by `rng_range` over the eligible list; market = Town if tier 0, else `1 + rng_range(2)`; `qty = 6 + rng_range(5 + 3·rank)`; `deadline = day + 6 + rng_range(9)`; `payout = qty · basePrice · 15000/10000`. The board is fully re-rolled when `day % 5 == 0` at step 10. An accepted slot is re-rolled immediately. Decline re-rolls that slot.
18. **Contract fulfilment:** Send with a tag validates the market, `arrival ≤ deadline`, and cargo holding ≥ qty of the good. At arrival, qty units are taken for the contract (oldest-first) → cash += payout, rep +1, `contractsDone` +1, contract cleared. Step 7: an accepted contract with `deadline ≤ day` and no truck carrying it → rep −1 (floor 0), cash −10% of payout, cleared.
19. **Loans:** take only when `loanPrincipal + loanInterest == 0`, amount 1..1500. Repay pays interest first, then principal, up to the amount owed. Step 9: `loanInterest += (principal + interest) / 100` (floor).
20. **Bankruptcy (step 11):** `cash < 0` and a loan outstanding (no room) → `grace` +1, and Game Over once `grace > graceDays`. `cash < 0` with no loan → no grace count (the player is expected to borrow). `cash ≥ 0` → grace 0.
21. **Net worth:** `cash + 50%·Σ(build cost of standing buildings + 80% cost for upgraded ones) + 50%·Σ land rings bought − (principal + interest)`. Inventory is excluded.
22. **Milestones** (bit flags, checked at the end of step 10): first processed good sold (counter `procSold > 0`); net worth ≥ 2000; `contractsDone ≥ 3`; on the rollover into day 81 with net worth ≥ 3000; rank ≥ 3; `wineSold ≥ 10`; net worth ≥ 50000 → status Results. Each pays `T_MILE` once. After 240 days without the target → Results. `ACT_CONTINUE` moves Results → Endless (milestones stop).
23. **Status:** `Playing 0, Results 1, Endless 2, GameOver 3`.

## Actions (`act(id, a, b, c)`) and error codes

| id | name | a | b | c |
|---|---|---|---|---|
| 1 | PLANT | tile | crop | – |
| 2 | HARVEST | tile | – | – |
| 3 | HARVEST_ALL | – | – | – (returns 0 even if nothing ripe) |
| 4 | BUILD | tile | building | – |
| 5 | DEMOLISH | tile | – | – |
| 6 | UPGRADE_BLD | tile | – | – |
| 7 | SET_RECIPE | tile | recipe row or 255 | – |
| 8 | BUY_LAND | – | – | – |
| 9 | SELL_STAND | good | qty | – |
| 10 | TRUCK_LOAD | truck | good | qty |
| 11 | TRUCK_UNLOAD | truck | good | qty |
| 12 | TRUCK_SEND | truck | market (1/2) | accepted slot or 255 |
| 13 | BUY_TRUCK | – | – | – |
| 14 | UPGRADE_TRUCK | truck | kind (0 cap, 1 fridge, 2 fast) | – |
| 15 | ACCEPT | board slot | – | – |
| 16 | DECLINE | board slot | – | – |
| 17 | LOAN_TAKE | amount | – | – |
| 18 | LOAN_REPAY | amount | – | – |
| 19 | CONTINUE | – | – | – |

Errors: `OK 0, E_BAD_ARG 1, E_STATUS 2, E_TILE_OUT 3, E_TILE_BUSY 4, E_SEASON 5, E_CASH 6, E_LOCKED 7, E_NOT_RIPE 8, E_STORAGE_FULL 9, E_NO_STOCK 10, E_TRUCK_AWAY 11, E_TRUCK_FULL 12, E_NO_SLOT 13, E_MAX 14, E_NEED_GARAGE 15, E_CONTRACT 16, E_DEADLINE 17, E_LOAN 18, E_NOT_BUILDING 19`. Enums for actions and errors go in `tools/balance.json` under `"actions"` and `"errors"`.

## Exports added

`act(id,a,b,c)→i32`, `end_day()→i32` (0 or `E_STATUS`), `price(market, good)→i32`, `storage_cap()→i32`, `storage_used()→i32`, `net_worth()→i32`, `rank()→i32`, `season()→i32`, `truck_cap(truck)→i32`, plus test hooks `t_set_weather(today)`, `t_set_cash(v)`, `t_give(good, qty, age)`.

## Review Focus

- **Repeated Harvest All with full storage:** must skip the blocked tiles, harvest what fits, and never overflow `cap`. → test in Task 4.
- **Selling more than you hold, or 0 units:** expect `E_NO_STOCK` / `E_BAD_ARG` with state unchanged, and never negative inventory. → Task 3 / Task 6.
- **Demolishing a loaded Cellar or a Garage whose truck is away:** Cellar contents are lost (documented). A Garage cannot be demolished if that would drop slots below the owned truck count (`E_MAX`). → Task 4.
- **Very long Endless runs:** day u16 and counters must not wrap within 10,000 days, and cash arithmetic must not overflow at a realistic $10M. → Task 8 (simulate 2,000 days with a bot; assert no trap).
- **Same seed + same actions on a fresh instance → identical bytes**, including after save → load midway. → Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/03_balance.wat` | + `T_WEATHER`, `T_EVENT` (kind → durationFixed/modBp) and new K scalars (`fuelCost 20`, `bumperBp 15000`, `surgeBp 15000`, `glutBp 6000`, `festivalDays 2`, `contractRefreshDays 5`, `coldPerStore 20`, `warehouseStorage 40`, plus phase 1 review finding 5: milestone thresholds `2000, 3, 3000, 3, 10, 50000`, score weights `repScore 100, contractScore 50`, `boardVisibleLow 2, boardVisibleHigh 3, boardHighRank 3`, `repGain 1, repLoss 1`, `bldUpgCapMult 2`, `fastDays 1`, `offSeasonPct 50`, `rainBonus 10`) |
| `src/10_state.wat` | + appended fields (see Task 1) |
| `src/11_actions.wat` | `act` dispatcher + every action |
| `src/12_endday.wat` | `end_day` + one `$step_*` per §4 step |
| `src/13_pricing.wat` | price, sell-unit, drift, recovery |
| `src/14_weather.wat` | weather roll, forecast, events |
| `src/15_contracts.wat` | board, accept/decline, fulfilment, expiry, rank |
| `src/16_trucks.wat` | load/unload/send/arrive/return, truck upgrades |
| `src/04_inv.wat` | inventory add/take oldest-first, storage cap/used, season/year helpers, building counts |
| `tests/sim/*.test.mjs` | one file per task |
| `tests/sim/bot.mjs` | deterministic scripted player for long runs |
| `tests/golden.json` | golden hashes |

## State appended (Task 1, offsets continue from 0x400)

| off | field | type |
|---|---|---|
| 0x400 | status | u8 |
| 0x401 | weatherToday / 0x402 weatherTomorrow / 0x403 forecast | u8 ×3 |
| 0x404 | droughtStreak | u8 |
| 0x405 | ringsBought | u8 |
| 0x406 | milestones | u8 bits |
| 0x407 | hintGood | u8 ×2 (0x407, 0x408) |
| 0x40A | nextEventDay | u16 |
| 0x40C | contractsDone / 0x40E wineSold / 0x410 procSold | u16 ×3 |
| 0x412 | driftNext | i16 ×13 (→0x42C) |
| 0x42C | events | 3 × 4 B (→0x438) |
| 0x440 | board | 3 × 8 B (→0x458) |
| 0x458 | accepted | 3 × 8 B (→0x470) |
| 0x470 | cellar | 64 × 5 B (→0x5B0) |
| 0x5B0 | end (`$STATE_LEN` = 0x5B0) | |

Tile byte 7 becomes `recipe` (row+1, 0 none).

---

### Task 1: State extension, inventory and calendar helpers

**Files:** Create `src/04_inv.wat`, `tests/sim/inv.test.mjs`. Modify `src/10_state.wat`, `tools/state.json`, `src/03_balance.wat`, `tools/balance.json`, `tests/balance.test.mjs`, `src/30_exports.wat`.

**Interfaces — Produces:**
- `$inv_count(good)→i32`, `$inv_add(good, qty)` (age 0), `$inv_take(good, qty)→i32 taken` (oldest-first), `$storage_cap()`, `$storage_used()`, `$count_bld(bld)→i32`, `$season()` (`((day-1)/20)%4`), `$year()` (`(day-1)/80`), `$tile_ptr(idx)`, `$in_grid(idx)→bool`
- Exports: `storage_cap`, `storage_used`, `season`, `t_give(good, qty, age)`, `t_set_cash(v)`

- [ ] **Step 1: Write the failing tests:**
  - `storage cap is 30 at start and grows by 40 per Warehouse, 20 per Cold Store` (place buildings by writing tile bytes through `t_` helpers, or via BUILD in Task 4. Here use a `t_put_bld(tile, bld)` hook.)
  - `inv_take removes oldest first`: give Tomato 3 @age1, 2 @age0; take 4 → 1 left at age 0.
  - `season boundaries`: day 1 → 0, 20 → 0, 21 → 1, 61 → 3, 81 → 0.
  - `new balance tables match spec decisions` (T_WEATHER rows exactly as Decision 1; new K scalars).
  - `state length grows to 0x5B0`; `init sets status Playing, today Sunny, nextEventDay 5, rolls forecast`.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. `init` also rolls tomorrow + forecast per Decision 2 and fills the board via `$contract_roll` (a stub returning an empty slot until Task 7).
- [ ] **Step 4:** Run `npm test`. All pass. Update the RNG-sequence expectation in `state.test.mjs` ("init seeds the RNG"): it now checks `rng` state equals the value after the init rolls. Record a ruling.
- [ ] **Step 5:** Commit `feat(sim): state v1 extension, inventory and calendar helpers`.

### Task 2: Weather, forecast, events

**Files:** Create `src/14_weather.wat`, `tests/sim/weather.test.mjs`.

**Interfaces — Produces:** `$weather_roll(season)→w`, `$weather_advance()` (Decision 2), `$events_tick()` (Decision 15), `$event_mod(market, good)→bp`, `$event_active(kind)→bool`.

- [ ] Tests (write, see FAIL, implement, see PASS, commit `feat(sim): weather, forecast and events`):
  - `weather frequencies follow season weights`: 10,000 rolls per season, each weather within ±2 points of its weight; zero-weight weathers never appear.
  - `forecast matches tomorrow at about 80%`: 2,000 advances, rate within 0.75–0.85.
  - `events: at most 3 active, durations 3–7 (Festival 2), next roll 4–6 days later` (drive with `t_events_tick` over 500 ticks).
  - `event_mod multiplies surge × glut for the same market/good`.

### Task 3: Pricing and Farm Stand

**Files:** Create `src/13_pricing.wat`, `tests/sim/pricing.test.mjs`.

**Interfaces — Produces:** `$price(m, g)→dollars`, `$sell_units(m, g, qty)→dollars` (applies saturation per unit; Festival exempt on Stand; increments `procSold`/`wineSold` counters), `$drift_tick()`, `$sat_recover()`. Export `price`.

- [ ] Tests:
  - `base prices at x1.0`: Town Wheat 8; Stand Wheat 6 (8×0.8 = 6.4 → 6); City Wheat 4 (×0.6 = 4.8); City Wine 168.
  - `saturation per unit`: sell 10 Wheat at Stand → sat 8000; the 11th unit is priced at 6.4×0.8 = 5.12 → 5.
  - `saturation floors at 50%`.
  - `recovery`: Stand full, Town halves the gap, City 34% (sat 7000 → 8020).
  - `drift clamps to 0.7–1.3 over 1,000 ticks` and `driftNext ∈ {-500,0,500}`.
  - `festival disables Stand saturation`.
- [ ] Commit `feat(sim): pricing, saturation, drift`.

### Task 4: Farm actions and dispatcher

**Files:** Create `src/11_actions.wat`, `tests/sim/actions.test.mjs`.

**Interfaces — Produces:** `act` (export) dispatching ids 1–9 and 19 now (10–18 return `E_BAD_ARG` until Tasks 6–8). Each action is `$a_<name>`.

- [ ] Tests (each error case asserts state bytes unchanged):
  - PLANT: ok Wheat in Spring (cash −10); `E_SEASON` Corn in Spring; `E_TILE_OUT` tile (4,0) at grid 4; `E_TILE_BUSY` on a crop; `E_CASH`; Greenhouse accepts Tomato in Winter.
  - HARVEST: `E_NOT_RIPE`; ripe Wheat → +4 Wheat, tile empty; `E_STORAGE_FULL` when it doesn't fit; Apple keeps its tree and sets mature; Bumper ×1.5.
  - HARVEST_ALL skips tiles that don't fit and fills up to cap (Review Focus).
  - BUILD: Mill ok (−250); Bakery `E_LOCKED` without a Mill, ok with one; Cellar locked below ★3; Greenhouse locked before day 41.
  - DEMOLISH: clears a crop or building; a Garage refuses if slots < trucks (`E_MAX`).
  - UPGRADE_BLD: Mill → upgraded (−200); twice → `E_MAX`; Warehouse → `E_BAD_ARG`.
  - SET_RECIPE: Mill accepts rows 0/1, rejects row 2 (`E_BAD_ARG`).
  - BUY_LAND: 4→5 for 600; at 8 → `E_MAX`.
  - SELL_STAND: proceeds equal `$sell_units` result; `E_NO_STOCK`; qty 0 → `E_BAD_ARG`.
- [ ] Commit `feat(sim): farm actions and act dispatcher`.

### Task 5: End Day steps 1–5

**Files:** Create `src/12_endday.wat`, `tests/sim/endday.test.mjs`.

**Interfaces — Produces:** `$step_weather`, `$step_grow`, `$step_process`, `$step_age_cellar`, `$step_spoil` and `end_day` (export) calling all 11 steps in order. Steps 6–11 are stubs until Tasks 6–8, but `day` += 1 happens in step 10 now.

- [ ] Tests:
  - `starting wheat ripens after one end_day` (Sunny forced via `t_set_weather`).
  - `rain adds 10%, out of season halves, winter stops, greenhouse ignores weather`.
  - `drought streak of 3 kills ~25% of crops; Well prevents it` (64 tiles, seeded; count within a range, and the exact count pinned for seed 42).
  - `frost kills tomato/grape, not wheat; greenhouse immune`.
  - `processing: Mill with 10 wheat → 4 flour, 2 wheat left (cap 8)`; `upgraded → cap 16`.
  - `cellar: 10 GJ → 10 Wine after exactly 5 end_days; hold limit 10`.
  - `spoilage: tomato in storage gone after 2 end_days; Cold Store protects 20 units; heatwave ages +2`.
  - `step order: growth before processing before spoilage` (a harvest-free scenario where order changes the result, e.g. GJ age 3 + heatwave: processed into the cellar before spoiling).
- [ ] Commit `feat(sim): end day steps 1–5`.

### Task 6: Trucks

**Files:** Create `src/16_trucks.wat`, `tests/sim/trucks.test.mjs`. Wire ids 10–14 in `11_actions.wat` and step 6.

- [ ] Tests: load/unload keeps ages and enforces capacity; send to Town returns cash in 2 end_days; City in 4 (Fast: 3); RoadClosure +1; FuelSpike −$20; perishables spoil in an unrefrigerated truck, not in a refrigerated one; `E_TRUCK_AWAY` on reload; BUY_TRUCK needs a slot (`E_NO_SLOT`); UPGRADE_TRUCK needs a Garage, cap +20 twice then `E_MAX`.
- [ ] Commit `feat(sim): trucks and distribution`.

### Task 7: Contracts and reputation

**Files:** Create `src/15_contracts.wat`, `tests/sim/contracts.test.mjs`. Wire ids 15–16 and step 7. Replace the Task 1 stub.

- [ ] Tests: board shows 2 slots at ★1 and 3 at ★3; payout = qty×base×1.5; accept moves to accepted and re-rolls; at most 3 accepted (`E_MAX`); send with tag validates market (`E_CONTRACT`), deadline (`E_DEADLINE`), qty (`E_NO_STOCK`); on-time → payout, rep+1, contractsDone+1; expiry → rep−1 (floor 0), −10%; rank thresholds 0/3/8/15/25.
- [ ] Commit `feat(sim): contracts and reputation`.

### Task 8: Money, run end, determinism

**Files:** Modify `src/12_endday.wat`, `src/11_actions.wat`. Create `tests/sim/money.test.mjs`, `tests/sim/bot.mjs`, `tests/sim/determinism.test.mjs`, `tests/golden.json`.

- [ ] Tests: upkeep sum; loan take/repay rules and 1% compound; bankruptcy grace → GameOver on day 4 negative; net worth excludes inventory; milestones pay once; day 240 → Results; CONTINUE → Endless; actions after GameOver → `E_STATUS`.
- [ ] Bot (`bot.mjs`): a pure function of state, deterministic. Each day: harvest all, plant the cheapest in-season crop on empty tiles if cash > 100, sell all raw at the Stand above 10 units, build a Mill on day 5 and set its recipe, send the truck to Town with Flour when home, take a loan when cash < 0.
- [ ] Determinism: `same seed + bot twice → identical bytes`; `save at day 40, load into a fresh instance, continue → same bytes as uninterrupted`; `golden hashes for seeds 1, 2, 3 over 80 days` (SHA-256 of the state bytes; the first run writes `tests/golden.json` if missing, and later runs compare); `2,000-day endless bot run does not trap`.
- [ ] Update `README.md` status and `CLAUDE.md`. Commit `feat(sim): money, run end, determinism; phase 2 complete`.
