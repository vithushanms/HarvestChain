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
;;                                     +5 flags u8 (b0 appleMature, b1 upgraded), +6 ghCrop u8 (crop+1)
;;   0x400  end

(global $STATE_LEN     i32 (i32.const 0x400))
(global $SAVE_VERSION  i32 (i32.const 1))
(global $MAGIC_HC      i32 (i32.const 0x4348)) ;; bytes 'H' 'C' little-endian

(global $S_SEED        i32 (i32.const 0x1004))
(global $S_DAY         i32 (i32.const 0x100C))
(global $S_GRID        i32 (i32.const 0x100E))
(global $S_CASH        i32 (i32.const 0x1010))
(global $S_TRUCK_COUNT i32 (i32.const 0x101E))
(global $S_DRIFT       i32 (i32.const 0x10F0))
(global $S_SAT         i32 (i32.const 0x1110))
(global $S_TRUCKS      i32 (i32.const 0x1160))
(global $S_TILES       i32 (i32.const 0x1200))

(global $TRUCK_STRIDE  i32 (i32.const 48))
(global $TILE_STRIDE   i32 (i32.const 8))
(global $NO_CONTRACT   i32 (i32.const 0xFF))
(global $BP_ONE        i32 (i32.const 10000))

;; load() error codes
(global $E_LOAD_LEN     i32 (i32.const 1))
(global $E_LOAD_MAGIC   i32 (i32.const 2))
(global $E_LOAD_VERSION i32 (i32.const 3))

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
    (br_if $wheat (local.tee $i (i32.sub (local.get $i) (i32.const 1))))))

;; Restore a save image of $len bytes at $ptr. Returns 0 or an E_LOAD_* code;
;; on error the current state is left untouched.
(func $load (param $ptr i32) (param $len i32) (result i32)
  (if (i32.or (i32.lt_u (local.get $len) (i32.const 4))
              (i32.gt_u (local.get $len) (global.get $STATE_SIZE)))
    (then (return (global.get $E_LOAD_LEN))))
  (if (i32.ne (i32.load16_u (local.get $ptr)) (global.get $MAGIC_HC))
    (then (return (global.get $E_LOAD_MAGIC))))
  (if (i32.ne (i32.load16_u offset=2 (local.get $ptr)) (global.get $SAVE_VERSION))
    (then (return (global.get $E_LOAD_VERSION))))
  (memory.fill (global.get $R_STATE) (i32.const 0) (global.get $STATE_SIZE))
  (memory.copy (global.get $R_STATE) (local.get $ptr) (local.get $len))
  (i32.const 0))

(func $save_ptr (result i32) (global.get $R_STATE))
(func $save_len (result i32) (global.get $STATE_LEN))
(func $io_buf   (result i32) (global.get $R_IO))
