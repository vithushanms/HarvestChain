# Phase 2 rulings and deferred minors

Decisions made while executing the phase 2 plan (spec silent or conflicting), with cost-if-wrong. Collected from the execution ledger.

## Rulings
- R1: Ruling: init's tomorrow/forecast roll moves to Task 2 (T2 extends init); T1 init sets today Sunny, status 0, nextEventDay 5 only — T1 cannot call code that doesn't exist — cost if wrong: none
- R2: Ruling: no contract stub; Task 7 extends init to fill the board — avoids stub-then-replace churn — cost if wrong: none
- R3: Ruling: Task 1 replaces the phase-1 "init seeds the RNG" assertion with: init(42) twice → identical rng word; init(42) vs init(43) → different; seed field = 42 — keeps the test meaningful as later tasks add init rolls — cost if wrong: weaker pin on exact RNG word (golden hashes in T8 cover it)
- R4: Ruling: $rank() (T_REP thresholds) is implemented in Task 4 in 04_inv.wat and exported as rank; Task 7 consumes it — T4 needs it for unlock predicates — cost if wrong: none
- R5: Ruling: Task 5 wires every step whose logic already exists (1–5, step 8 via $drift_tick/$sat_recover, step 10 via $events_tick/$weather_advance + day+1); steps 6, 7, 9, 11 are empty stubs filled by T6/T7/T8 — §4 order must be real as early as possible — cost if wrong: none
- R6: Ruling: Task 6 TRUCK_SEND accepts c=255 only (else E_CONTRACT); Task 7 adds tag validation and fulfilment — cost if wrong: none
- R7: Ruling: Task 1 adds test hook t_put_bld(tile, bld) to exports — needed by its own tests and later tasks — cost if wrong: a few bytes
- Task 1: Ruling: extend load() field validation for appended fields (status ≤3, weather ≤5, events/board/accepted ids, cellar buckets) — assigned to Task 8 — crafted saves could index tables out of range — cost if wrong: one more task scope item
- Task 2: Ruling: forecast-accuracy test range 0.80–0.92 not plan's 0.75–0.85 — Decision 2 (80% copy + coincident re-roll) yields ≈0.88; Decision is binding, plan's test range was wrong — cost if wrong: none
- Task 2: Ruling: canonical RNG order uses real branches — forecast: rng_range(100) check first, fresh weather roll only on miss; event: Festival skips the duration draw — matches Decision 2/15 text and the report; select evaluates both arms — cost if wrong: none yet (no goldens)
- Task 4: Ruling: DEMOLISH of a stocked Warehouse/Cold Store is allowed; stock above cap is kept, but no addition (harvest, unload, processing output, wine) may happen while used+units > cap — spec blocks only purchases, not demolition — cost if wrong: player can over-hold briefly
- Task 5: Ruling: storage perishables (and tile ripeAge) age in step 2; step 5 removes expired storage units and rots ripe tiles at ripeAge ≥ spoilDays — spec step 2 says 'perishables age', step 5 'removes expired'; makes the plan's GJ heatwave→cellar order test meaningful — cost if wrong: perishables one step earlier/later
- Task 5: Ruling: Decision 13 hint-good roll (2× rng_range(13) at step 10, after weather_advance) assigned to Task 8 — omitted from R5 list; no goldens exist yet — cost if wrong: none
- Task 5: Ruling: batch room check (used − inQty·batches + outputs ≤ cap) acceptable for processing; cellar Wine via $storage_fits — inputs leave storage — cost if wrong: none
- Task 5: Ruling: tile ripeAge must NOT tick in the End Day the crop ripens (only crops ripe at start of step 2 age) — spec 'spoil timer from the day they ripen' + '2 days' implies two mornings to harvest — goes into fix round with review findings
- Task 6: Ruling: all present trucks' cargo (home or away) ages in step 5 (+1, +2 Heatwave) unless refrigerated, then spoils at age ≥ perishDays — Decision 16 + spec 'non-refrigerated trucks' — cost if wrong: none
- Ruling: '3D renders' = software-rendered lit isometric 3D (extruded boxes, prisms, spheres, shaded faces, shadows) drawn by the Wasm into the framebuffer with integer maths — spec forbids asset files and floats, so no WebGL/images — cost if wrong: user may have wanted real WebGL; spec's 'zero asset files' goal would be broken by that
- Ruling: commit trailer now 'Co-Authored-By: Claude Sonnet 5.5' per updated attribution reminder
- Task 7: Ruling: step 10 canonical RNG order = events_tick, weather_advance, hint goods (Task 8), day += 1, then board refresh when new day % 5 == 0 — keeps Task 8's hint roll slot fixed — cost if wrong: none
- Task 7: Ruling: contract generation RNG order = good, [market only if tier>0], qty, deadline (if/else, no select); eligible goods = ids with tier ≤ (rank≥3 ? 2 : 1) ascending — Decision 17 — cost if wrong: none
- Task 7: Ruling: expiry at step 7 when deadline ≤ day and no outbound truck carries that slot; arrival-day rule: send validates day+travel(+1 RoadClosure on City) ≤ deadline — consistent with Decision 16/18 — cost if wrong: none
- Task 8: Ruling: bankruptcy per Decision 20 (grace only with an outstanding loan; GameOver when grace > graceDays); net worth computed once before milestone payouts in a check; milestones/run-end only while status Playing; bankruptcy applies in Endless too — cost if wrong: loophole of sitting negative with no loan
- Task 8: Ruling: Task 5/7 minors (storm/drought odds, drought kill streak, MAX_AGE → T_K; accepted loop cap; cargo_take MAX_AGE) bundled into Task 8 — same files, keeps RNG values identical — cost if wrong: none
- Task 8: Ruling: re-graded load-validation minors by effect: loan wrap, stale truck tag, event daysLeft 0 enter the fix pass (corrupt-save hardening in the same function); grid-vs-rings, enum-bound literals, u16 day wrap deferred
- Final: Ruling: contract deliveries DO count toward procSold/wineSold (a delivery is a sale; milestones 'first processed good', 'sell 10 Wine') — cost if wrong: milestones fire slightly earlier
- Final: Ruling: cashBack held by returning trucks IS included in net worth (money already earned, only not yet home); cargo still excluded — cost if wrong: NW overstated by in-transit proceeds
- Final: Ruling: day counter saturates at 65535 instead of wrapping — cost if wrong: Endless freezes at day 65535 (unreachable)
- Final: Ruling: Bumper 'while active', tomorrow's-weather season lag, Cold Store per-store 20 units, negative cash without loan ignored — reviewer set these aside; they stand per Decisions 2/7/15/20 — cost if wrong: small balance differences
- Final: Ruling: strip t_* test hooks from shipping build deferred to phase 4 (build flag) — costs ~360 B gz — cost if wrong: none

## Deferred minors
- Task 1: minor (deferred): K coldPerStore/warehouseStorage duplicate T_BLD storageBonus, unused
- Task 1: minor (deferred): T_WEATHER asserted in tests/sim/inv.test.mjs not balance.test.mjs
- Task 1: minor (deferred): tools/state.json reformatted, missing trailing newline
- Task 1: minor (deferred): $storage_cap/$count_bld hard-code 10 buildings / 64 tiles
- Task 1: minor (deferred): $inv_add/t_give no overflow/age guard (HARVEST must check cap — Task 4)
- Task 1: minor (deferred): $in_grid/$year/$inv_add no direct tests yet
- Task 2: minor (deferred): weather.test.mjs:107 redundant notDeepEqual assert
- Task 3: minor (deferred): $sat_recover garbage if sat>10000 (corrupt save) → covered by Task 8 load validation (bound sat ≤10000, drift 7000..13000)
- Task 3: minor (deferred): $price/$sell_units don't range-check m/g; callers must validate (Task 4 SELL_STAND, Task 6 arrival)
- Task 3: minor (deferred): pricing.test.mjs hardcoded offsets, pointless r0 assert, stale comment
- Task 4: minor (deferred): $K_BLD_UPG_PCT declared out of index order in 03_balance.wat
- Task 4: minor (deferred): SELL_STAND test weak (seed-dependent probe, no oldest-first/saturation check)
- Task 4: minor (deferred): missing tests — HARVEST_ALL greenhouse/apple, status guard on BUILD/DEMOLISH/BUY_LAND/SELL_STAND, check order, Garage demolish on non-garage
- Task 5: minor (deferred): $STORM_ODDS/$DROUGHT_ODDS/$DROUGHT_KILL_STREAK/$MAX_AGE globals in 12_endday.wat, not 03_balance (violates 'all numbers in balance')
- Task 5: minor (deferred): recipe row count hard-coded 8 in 12_endday.wat:214
- Task 5: minor (deferred): redundant $storage_fits(n) at 12_endday.wat:241
- Task 5: minor (deferred): age-cap-7 test doesn't exercise clamp
- Task 5: minor (deferred): step-order test only pins processing-before-spoilage
- Task 5: minor (deferred): no-op t_give(CORN,0,0) in endday.test.mjs:307
- Task 6: minor (deferred): commit trailer names Opus 5.5 though implementer ran on Sonnet (template text)
- Task 6: minor (deferred): tautological assertion trucks.test.mjs:52
- Task 6: minor (deferred): Fast-doesn't-shorten-Town test can't discriminate (Town travelDays 1 == fastDays 1)
- Task 6: minor (deferred): literals 3/12/32 in 16_trucks.wat should be named globals
- Task 6: minor (deferred): trucks.test.mjs arrival() hardcodes travel days; City reference relies on seed-42 drift pending 0
- Task 7: minor (deferred): u16 deadline wraps near day 65535 (unreachable)
- Task 8: minor (deferred): grid vs ringsBought consistency not checked in load
- Task 8: minor (deferred): enum-bound literals (13 goods, 4 seasons, load bounds) → named globals
- Task 8: minor (deferred): u16 day wraps after 65535 Endless days then fails load (unreachable)
- Task 8: minor (deferred): $state_bad trucks reads accepted[tag] before tag≤2 check (wasm evaluates both i32.or operands) — bounded read, no trap observed
- Task 8: minor (deferred): events loop uses $i without explicit init; no isolated tests for interest>2^30 and tag>2 clauses
