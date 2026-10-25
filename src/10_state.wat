;; Game state layout v1 (spec §14.3–§14.4). Lives at $R_STATE; the region IS the save image.
;; Layout is append-only: new fields go after the last one and $STATE_LEN grows.
;; tools/state.json mirrors this header for tests — change both together.
;;
;;   off    field          type        notes
;;   0x000  magic          u8 x 2      'H' 'C'
;;   0x002  version        u16         1
;;   0x004  seed           u32
;;   0x008  rng            u32         xorshift word (01_rng.wat)
;;   0x00C  day            u16         1-based
;;   0x00E  grid           u8          side of the active square, 4..8
;;   0x00F  rep            u8          reputation points
;;   0x010  cash           i32         signed dollars
;;   0x014  loanPrincipal  i32
;;   0x018  loanInterest   i32
;;   0x01C  grace          u8          consecutive days with negative cash
;;   0x01D  flags          u8          reserved
;;   0x01E  truckCount     u8
;;   0x020  inv            u16 x 104   storage count at [good*8 + age], age 0..7
;;   0x0F0  drift          u16 x 13    price drift per good, bp
;;   0x110  sat            u16 x 39    saturation at [market*13 + good], bp
;;   0x160  trucks         3 x 48 B    +0 present u8, +1 dest u8, +2 phase u8 (0 home 1 out 2 back),
;;                                     +3 daysLeft u8, +4 upg u8 (b0-1 capLvl, b2 fridge, b3 fast),
;;                                     +5 contract u8 (0xFF none), +8 cashBack i32,
;;                                     +16 cargo 8 x {good u8, age u8, qty u16}
;;   0x200  tiles          64 x 8 B    index y*8+x; +0 kind u8 (0 empty 1 crop 2 building), +1 id u8,
;;                                     +2 progress u16 (1/100 day), +4 ripeAge u8,
;;                                     +5 flags u8 (b0 appleMature, b1 upgraded), +6 ghCrop u8 (crop+1),
;;                                     +7 recipe u8 (recipe row + 1, 0 none)
;;   --- appended in phase 2 (still version 1; nothing was shipped) ---
;;   0x400  status         u8          0 Playing 1 Results 2 Endless 3 GameOver
;;   0x401  weatherToday   u8          0 Sunny 1 Rain 2 Drought 3 Storm 4 Frost 5 Heatwave
;;   0x402  weatherTomorrow u8
;;   0x403  forecast       u8
;;   0x404  droughtStreak  u8
;;   0x405  ringsBought    u8
;;   0x406  milestones     u8          bit flags
;;   0x407  hintGood       u8 x 2      Gazette hint goods (0x407, 0x408)
;;   0x40A  nextEventDay   u16
;;   0x40C  contractsDone  u16
;;   0x40E  wineSold       u16
;;   0x410  procSold       u16
;;   0x412  driftNext      i16 x 13    pending drift step per good, bp
;;   0x42C  events         3 x 4 B     {kind u8, market u8, good u8, daysLeft u8}
;;   0x440  board          3 x 8 B     {good u8, market u8, qty u8, active u8, deadline u16, payout u16}
;;   0x458  accepted       3 x 8 B     same record
;;   0x470  cellar         64 x 5 B    aging buckets per tile, bucket 0 is next to finish
;;   0x5B0  end

(global $STATE_LEN     i32 (i32.const 0x5B0))
(global $SAVE_VERSION  i32 (i32.const 1))
(global $MAGIC_HC      i32 (i32.const 0x4348)) ;; bytes 'H' 'C' little-endian

(global $S_SEED        i32 (i32.const 0x1004))
(global $S_DAY         i32 (i32.const 0x100C))
(global $S_GRID        i32 (i32.const 0x100E))
(global $S_REP         i32 (i32.const 0x100F))
(global $S_CASH        i32 (i32.const 0x1010))
(global $S_TRUCK_COUNT i32 (i32.const 0x101E))
(global $S_LOAN_P      i32 (i32.const 0x1014))
(global $S_LOAN_I      i32 (i32.const 0x1018))
(global $S_GRACE       i32 (i32.const 0x101C))
(global $S_INV         i32 (i32.const 0x1020))
(global $S_DRIFT       i32 (i32.const 0x10F0))
(global $S_SAT         i32 (i32.const 0x1110))
(global $S_TRUCKS      i32 (i32.const 0x1160))
(global $S_TILES       i32 (i32.const 0x1200))
(global $S_STATUS      i32 (i32.const 0x1400))
(global $S_WEATHER     i32 (i32.const 0x1401)) ;; today; tomorrow +1, forecast +2
(global $S_DROUGHT     i32 (i32.const 0x1404))
(global $S_RINGS       i32 (i32.const 0x1405))
(global $S_MILESTONES  i32 (i32.const 0x1406))
(global $S_HINT        i32 (i32.const 0x1407))
(global $S_NEXT_EVENT  i32 (i32.const 0x140A))
(global $S_CONTRACTS_DONE i32 (i32.const 0x140C))
(global $S_WINE_SOLD   i32 (i32.const 0x140E))
(global $S_PROC_SOLD   i32 (i32.const 0x1410))
(global $S_DRIFT_NEXT  i32 (i32.const 0x1412))
(global $S_EVENTS      i32 (i32.const 0x142C))
(global $S_BOARD       i32 (i32.const 0x1440))
(global $S_ACCEPTED    i32 (i32.const 0x1458))
(global $S_CELLAR      i32 (i32.const 0x1470))

(global $TRUCK_STRIDE  i32 (i32.const 48))
(global $TILE_STRIDE   i32 (i32.const 8))
(global $RECIPE_OFF    i32 (i32.const 7))
(global $NO_CONTRACT   i32 (i32.const 0xFF))
(global $BP_ONE        i32 (i32.const 10000))

;; load() error codes
(global $E_LOAD_LEN     i32 (i32.const 1))
(global $E_LOAD_MAGIC   i32 (i32.const 2))
(global $E_LOAD_VERSION i32 (i32.const 3))
(global $E_LOAD_BOUNDS  i32 (i32.const 4))
(global $E_LOAD_CORRUPT i32 (i32.const 5))

;; Fresh game, spec §5 starting state.
(func $init (param $seed i32)
  (local $i i32)
  (local $p i32)
  (memory.fill (global.get $R_STATE) (i32.const 0) (global.get $STATE_SIZE))
  (i32.store16 (global.get $R_STATE) (global.get $MAGIC_HC))
  (i32.store16 offset=2 (global.get $R_STATE) (global.get $SAVE_VERSION))
  (i32.store (global.get $S_SEED) (local.get $seed))
  (call $rng_seed (local.get $seed))
  (i32.store16 (global.get $S_DAY) (i32.const 1))
  (i32.store8 (global.get $S_GRID) (call $k (global.get $K_START_GRID)))
  (i32.store (global.get $S_CASH) (call $k (global.get $K_START_CASH)))
  (i32.store8 (global.get $S_TRUCK_COUNT) (i32.const 1))
  ;; status 0 (Playing) and today Sunny (0) come from the fill; the first event is due on day 5.
  (i32.store16 (global.get $S_NEXT_EVENT) (call $k (global.get $K_FIRST_EVENT_DAY)))

  ;; Trucks: none carry a contract; truck 0 is the starting truck.
  (local.set $p (global.get $S_TRUCKS))
  (local.set $i (i32.const 3))
  (loop $trucks
    (i32.store8 offset=5 (local.get $p) (global.get $NO_CONTRACT))
    (local.set $p (i32.add (local.get $p) (global.get $TRUCK_STRIDE)))
    (br_if $trucks (local.tee $i (i32.sub (local.get $i) (i32.const 1)))))
  (i32.store8 (global.get $S_TRUCKS) (i32.const 1))

  ;; Drift (13 goods) and saturation (3 markets x 13 goods) all start at x1.0.
  (local.set $i (i32.const 0))
  (loop $drift
    (i32.store16 (i32.add (global.get $S_DRIFT) (i32.shl (local.get $i) (i32.const 1))) (global.get $BP_ONE))
    (br_if $drift (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 13))))
  (local.set $i (i32.const 0))
  (loop $sat
    (i32.store16 (i32.add (global.get $S_SAT) (i32.shl (local.get $i) (i32.const 1))) (global.get $BP_ONE))
    (br_if $sat (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 39))))

  ;; Four Wheat on row 0, two days grown (kind 1 = crop, id 0 = Wheat).
  (local.set $p (global.get $S_TILES))
  (local.set $i (i32.const 4))
  (loop $wheat
    (i32.store8 (local.get $p) (i32.const 1))
    (i32.store16 offset=2 (local.get $p) (i32.const 200))
    (local.set $p (i32.add (local.get $p) (global.get $TILE_STRIDE)))
    (br_if $wheat (local.tee $i (i32.sub (local.get $i) (i32.const 1)))))

  ;; Day 1 weather: roll tomorrow, then the forecast, from the Spring table (Decision 2).
  (call $weather_prime (i32.const 1))

  ;; Contract board: roll every visible slot after the weather prime (Decision 17).
  (call $board_refresh))

;; True when any of $n bytes at $p, $p+$stride, ... exceeds $max.
(func $bad8 (param $p i32) (param $n i32) (param $stride i32) (param $max i32) (result i32)
  (loop $l
    (if (i32.gt_u (i32.load8_u (local.get $p)) (local.get $max)) (then (return (i32.const 1))))
    (local.set $p (i32.add (local.get $p) (local.get $stride)))
    (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))
  (i32.const 0))

;; True when any of $n consecutive u16 at $p has ((v + $bias) & 0xFFFF) > $range.
;; The bias turns a lo..hi window, or a signed i16 window, into one unsigned compare.
(func $bad16 (param $p i32) (param $n i32) (param $bias i32) (param $range i32) (result i32)
  (loop $l
    (if (i32.gt_u (i32.and (i32.add (i32.load16_u (local.get $p)) (local.get $bias)) (i32.const 0xFFFF))
                  (local.get $range))
      (then (return (i32.const 1))))
    (local.set $p (i32.add (local.get $p) (i32.const 2)))
    (br_if $l (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))
  (i32.const 0))

;; True when the phase 2 fields of the save image at $s hold an impossible value.
(func $state_bad (param $s i32) (result i32)
  (local $i i32) (local $p i32) (local $v i32) (local $step i32) (local $seen i32)
  (local.set $step (call $k (global.get $K_DRIFT_STEP)))
  (if (i32.or
        (i32.or
          (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x400)) (i32.const 1) (i32.const 1) (i32.const 3))
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x401)) (i32.const 3) (i32.const 1) (i32.const 5)))
          (i32.or (call $bad16 (i32.add (local.get $s) (i32.const 0x00C)) (i32.const 1) (i32.const 0xFFFF) (i32.const 0xFFFE))
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x405)) (i32.const 1) (i32.const 1)
                    (i32.sub (call $k (global.get $K_MAX_GRID)) (call $k (global.get $K_START_GRID))))))
        (i32.or
          (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x406)) (i32.const 1) (i32.const 1) (i32.const 0x7F))
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x407)) (i32.const 2) (i32.const 1) (i32.const 12)))
          (i32.or (call $bad16 (i32.add (local.get $s) (i32.const 0x0F0)) (i32.const 13)
                    (i32.sub (i32.const 0) (call $k (global.get $K_DRIFT_MIN)))
                    (i32.sub (call $k (global.get $K_DRIFT_MAX)) (call $k (global.get $K_DRIFT_MIN))))
                  (call $bad16 (i32.add (local.get $s) (i32.const 0x110)) (i32.const 39) (i32.const 0) (global.get $BP_ONE)))))
    (then (return (i32.const 1))))
  (if (i32.or
        (i32.or
          (call $bad16 (i32.add (local.get $s) (i32.const 0x412)) (i32.const 13) (local.get $step) (i32.shl (local.get $step) (i32.const 1)))
          (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x42C)) (i32.const 3) (i32.const 4) (i32.const 6))
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x42D)) (i32.const 3) (i32.const 4) (i32.const 2))))
        (i32.or
          (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x42E)) (i32.const 3) (i32.const 4) (i32.const 12))
                  ;; board and accepted: six contiguous 8 B records
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x440)) (i32.const 6) (i32.const 8) (i32.const 12)))
          (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x441)) (i32.const 6) (i32.const 8) (i32.const 2))
                  (call $bad8 (i32.add (local.get $s) (i32.const 0x443)) (i32.const 6) (i32.const 8) (i32.const 1)))))
    (then (return (i32.const 1))))
  (if (i32.or
        (call $bad8 (i32.add (local.get $s) (i32.const 0x470)) (i32.const 320) (i32.const 1) (call $k (global.get $K_CELLAR_HOLD)))
        (i32.or (call $bad8 (i32.add (local.get $s) (i32.const 0x01C)) (i32.const 1) (i32.const 1)
                  (i32.add (call $k (global.get $K_GRACE_DAYS)) (i32.const 1)))
                ;; loan: principal <= loanMax, interest and the owed total <= 2^30 (the saturation cap)
                (i32.or (i32.gt_u (i32.load offset=0x014 (local.get $s)) (call $k (global.get $K_LOAN_MAX)))
                        (i32.or (i32.gt_u (i32.load offset=0x018 (local.get $s)) (i32.const 0x40000000))
                                (i32.gt_u (i32.add (i32.load offset=0x014 (local.get $s))
                                                   (i32.load offset=0x018 (local.get $s)))
                                          (i32.const 0x40000000))))))
    (then (return (i32.const 1))))
  ;; an active event has at least one day left
  (loop $events
    (local.set $p (i32.add (i32.add (local.get $s) (i32.const 0x42C)) (i32.shl (local.get $i) (i32.const 2))))
    (if (i32.and (i32.ne (i32.load8_u (local.get $p)) (i32.const 0)) (i32.eqz (i32.load8_u offset=3 (local.get $p))))
      (then (return (i32.const 1))))
    (br_if $events (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (local.set $i (i32.const 0))
  ;; trucks: slots below truckCount are present, the rest are not
  (loop $trucks
    (local.set $p (i32.add (i32.add (local.get $s) (i32.const 0x160)) (i32.mul (local.get $i) (global.get $TRUCK_STRIDE))))
    (local.set $v (i32.load8_u offset=5 (local.get $p)))
    (if (i32.or
          (i32.or (i32.ne (i32.load8_u (local.get $p))
                          (i32.lt_u (local.get $i) (i32.load8_u offset=0x01E (local.get $s))))
                  (call $bad8 (i32.add (local.get $p) (i32.const 1)) (i32.const 2) (i32.const 1) (i32.const 2)))
          (i32.or (call $bad8 (i32.add (local.get $p) (i32.const 16)) (i32.const 8) (i32.const 4) (i32.const 12))
                  (call $bad8 (i32.add (local.get $p) (i32.const 17)) (i32.const 8) (i32.const 4) (i32.const 7))))
      (then (return (i32.const 1))))
    ;; a contract tag needs an outbound truck, an active accepted slot, and is carried once
    (if (i32.ne (local.get $v) (global.get $NO_CONTRACT))
      (then
        (if (i32.or (i32.or (i32.ne (i32.load8_u offset=2 (local.get $p)) (i32.const 1)) (i32.gt_u (local.get $v) (i32.const 2)))
                    (i32.or (i32.eqz (i32.load8_u (i32.add (i32.add (local.get $s) (i32.const 0x45B)) (i32.shl (local.get $v) (i32.const 3)))))
                            (i32.and (local.get $seen) (i32.shl (i32.const 1) (local.get $v)))))
          (then (return (i32.const 1))))
        (local.set $seen (i32.or (local.get $seen) (i32.shl (i32.const 1) (local.get $v))))))
    (br_if $trucks (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  ;; tiles: kind 0..2, crop id 0..4 or building id 0..9, ghCrop 0..5, recipe 0..8
  (local.set $i (i32.const 0))
  (loop $tiles
    (local.set $p (i32.add (i32.add (local.get $s) (i32.const 0x200)) (i32.shl (local.get $i) (i32.const 3))))
    (local.set $v (i32.load8_u (local.get $p)))
    (if (i32.or
          (i32.or (i32.gt_u (local.get $v) (i32.const 2))
                  (i32.and (i32.ne (local.get $v) (i32.const 0))
                           (i32.gt_u (i32.load8_u offset=1 (local.get $p))
                                     (select (i32.const 4) (i32.const 9) (i32.eq (local.get $v) (i32.const 1))))))
          (i32.or (i32.gt_u (i32.load8_u offset=6 (local.get $p)) (i32.const 5))
                  (i32.gt_u (i32.load8_u offset=7 (local.get $p)) (i32.const 8))))
      (then (return (i32.const 1))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (i32.const 0))

;; Restore a save image of $len bytes at $ptr. Returns 0 or an E_LOAD_* code.
;; Everything is validated from the source bytes before the state is touched, so on
;; error the current state is unchanged. A v1 save must be exactly $STATE_LEN bytes:
;; zero is not a valid default for sentinel fields, so short saves are rejected.
(func $load (param $ptr i32) (param $len i32) (result i32)
  (local $v i32)
  (if (i32.ne (local.get $len) (global.get $STATE_LEN))
    (then (return (global.get $E_LOAD_LEN))))
  ;; ptr + len must lie inside memory; written as ptr <= size - len to avoid overflow.
  (if (i32.gt_u (local.get $ptr)
                (i32.sub (i32.shl (memory.size) (i32.const 16)) (local.get $len)))
    (then (return (global.get $E_LOAD_BOUNDS))))
  (if (i32.ne (i32.load16_u (local.get $ptr)) (global.get $MAGIC_HC))
    (then (return (global.get $E_LOAD_MAGIC))))
  (if (i32.ne (i32.load16_u offset=2 (local.get $ptr)) (global.get $SAVE_VERSION))
    (then (return (global.get $E_LOAD_VERSION))))
  ;; Field sanity: a zero RNG word would freeze every roll; grid and truck count
  ;; index fixed arrays later.
  (if (i32.eqz (i32.load offset=0x008 (local.get $ptr)))
    (then (return (global.get $E_LOAD_CORRUPT))))
  (local.set $v (i32.load8_u offset=0x00E (local.get $ptr)))
  (if (i32.or (i32.lt_u (local.get $v) (call $k (global.get $K_START_GRID)))
              (i32.gt_u (local.get $v) (call $k (global.get $K_MAX_GRID))))
    (then (return (global.get $E_LOAD_CORRUPT))))
  (local.set $v (i32.load8_u offset=0x01E (local.get $ptr)))
  (if (i32.or (i32.eqz (local.get $v))
              (i32.gt_u (local.get $v) (call $k (global.get $K_MAX_TRUCKS))))
    (then (return (global.get $E_LOAD_CORRUPT))))
  (if (call $state_bad (local.get $ptr)) (then (return (global.get $E_LOAD_CORRUPT))))
  ;; Copy first (memory.copy is overlap-safe), then clear the tail of the region.
  (memory.copy (global.get $R_STATE) (local.get $ptr) (local.get $len))
  (memory.fill (i32.add (global.get $R_STATE) (local.get $len)) (i32.const 0)
               (i32.sub (global.get $STATE_SIZE) (local.get $len)))
  (i32.const 0))

(func $save_ptr (result i32) (global.get $R_STATE))
(func $save_len (result i32) (global.get $STATE_LEN))
(func $io_buf   (result i32) (global.get $R_IO))
