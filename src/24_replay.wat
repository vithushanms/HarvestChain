;; Replays and share codes (spec §15.4; plan Task 7a). The input log, its base64url share code, the
;; validating loader and the replay viewer screen (scr 7, 22c_screens.wat routes it here).
;;
;; Recording: the exported / UI-called $init, $load, $act and $end_day are thin wrappers over the sim's
;; $init_do / $load_do / $act_do / $end_day_do. They only append to R_REPLAY (never the state or RNG):
;;   header  0 'R' (0x52)  1 ruleset (1 = the current sim)  2 seed u32 LE  6 record count u16 LE
;;   records op u8 1..19 = a SUCCESSFUL act(op, a, b, c) followed by the args that action uses
;;           (count per op: table at 0xF80) as unsigned LEB128 varints (<= 5 bytes);
;;           0x20..0x7F = 0aa i iiii: action i whose FIRST arg is aa - 1 (0..2: truck, contract slot,
;;           Wheat / Corn / Tomato), then its other args as varints;
;;           0x80..0xFF = 1ccc dddd: PLANT crop ccc on the tile d + 1 after the last planted tile (mod 64;
;;           the last planted tile starts at 63 and follows every PLANT, compact or not);
;;           0x1F = one successful End Day; 0x1E n = a run of n (>= 1) End Days. Consecutive End Days
;;           collapse in place: 1F -> 1E 02 -> 1E 03 ... (the run record is always the last one).
;;           An action that leaves the state bytes unchanged (HARVEST ALL with nothing ripe) is not
;;           recorded: replaying it could not change anything either.
;;   (240-day bot run: 3,600 B. A spec-literal one-op-per-action log needs about 6.6 KB, over the region.)
;; init resets the log (seed in the header); load marks it NONE (a resumed save has no history:
;; $rec_st 2) until replay_restore proves the stored log reproduces the loaded state byte for byte.
;; Overflow: a record that might not fit the 4 KB region (worst case 16 B) stops recording ($rec_st 1,
;; "RUN TOO LONG TO SHARE"); the game goes on. $rec_pause (viewer, restore check) records nothing.
;;
;; Share code = base64url (no padding) of the log bytes; the URL = origin (set_origin, <= 512 B) + '#'
;; + code, built in URL (share_url_ptr / len; the bare code without an origin).
;; replay_load(ptr, len) takes TEXT (a code, a URL with '#', surrounding whitespace) and returns 0 or
;; 1 length 2 magic 3 ruleset 4 structure 5 base64 / bounds 6 busy (viewer open); a valid log becomes
;; the pending shared run (the Title offers WATCH SHARED RUN) and nothing else changes.
;;
;; Viewer: entering copies the state (STATE_LEN) to SNAP and pauses recording. Position d = the state
;; after d End Days (d = N: every record applied). A seek forward applies records from the cursor; a
;; seek back re-inits from the seed. A record that fails -> "REPLAY INVALID AT DAY n", playback stops.
;; EXIT (button, Esc) copies SNAP back (byte-identical) and pops the back stack; nothing is saved while
;; the viewer is open (need_save reads 0). TAKE OVER (two taps over a save) re-records the log from
;; the seed up to the current position and continues as the live game (need_save).
;;
;; Memory (R_LAYOUT, free before this task): 0xB000..0xBFFF viewer log, 0xC000..0xC5AF SNAP,
;; 0xC800..0xDFFF URL / share code, 0xE000..0xEFFF base64 decode scratch. 0xF80..0xF93 arg counts.
;; Hit codes: 0x3C8 COPY CODE, 0x3D0 RESTART 0x3D1 -1 DAY 0x3D2 PLAY / PAUSE 0x3D3 +1 DAY 0x3D4 SPEED
;;   0x3D5 TAKE OVER 0x3D6 EXIT 0x3D7 scrubber (down / drag seeks) 0x3D8 WATCH SHARED RUN (Title)
;;   0x3D9 WATCH REPLAY (Results). Keys in the viewer: Esc exit, Enter / Space play, Left / Right step.

(global $LOG_CAP i32 (i32.const 4096))
(global $VLOG i32 (i32.const 0xB000))
(global $SNAP i32 (i32.const 0xC000))
(global $URL i32 (i32.const 0xC800))
(global $DEC i32 (i32.const 0xE000))
(global $rec_len (mut i32) (i32.const 0))
(global $rec_st (mut i32) (i32.const 2))       ;; 0 recording, 1 overflow, 2 none (no history)
(global $rec_pause (mut i32) (i32.const 0))
(global $rec_run (mut i32) (i32.const 0))      ;; offset of the last record when it is an End Day one
(global $rec_lt (mut i32) (i32.const 63))      ;; last planted tile (compact PLANT records), recording / playback
(global $rp_lt (mut i32) (i32.const 63))
(global $PRE i32 (i32.const 0xF000))
(global $org_n (mut i32) (i32.const 0))
(global $sh_n (mut i32) (i32.const 0))
(global $copy_req (mut i32) (i32.const 0))
(global $vp (mut i32) (i32.const 0))           ;; varint cursor, end, failure
(global $ve (mut i32) (i32.const 0))
(global $vbad (mut i32) (i32.const 0))
(global $chk_days (mut i32) (i32.const 0))     ;; $log_check results: End Days, End Day tail offset
(global $chk_run (mut i32) (i32.const 0))
(global $rp_pend (mut i32) (i32.const 0))      ;; a shared run waits in VLOG
(global $rp_vn (mut i32) (i32.const 0))        ;; VLOG length
(global $rp_N (mut i32) (i32.const 0))
(global $rp_day (mut i32) (i32.const 0))
(global $rp_b (mut i32) (i32.const 0))         ;; log being applied: base, end, cursor, End Days left in a run
(global $rp_e (mut i32) (i32.const 0))
(global $rp_off (mut i32) (i32.const 0))
(global $rp_left (mut i32) (i32.const 0))
(global $rp_play (mut i32) (i32.const 0))
(global $rp_t (mut i32) (i32.const 0))
(global $rp_spd (mut i32) (i32.const 0))       ;; 0 x1, 1 x2, 2 x4 (300 >> spd ms a day)
(global $rp_bad (mut i32) (i32.const 0))       ;; game day a record failed on, 0 = fine
(global $sb_x (mut i32) (i32.const 0))         ;; scrubber track as last drawn
(global $sb_w (mut i32) (i32.const 1))
(data (i32.const 0xF80) "\00\02\01\00\02\01\01\02\00\02\03\03\03\00\02\01\01\01\01\00")

;; ---------------------------------------------------------------- recording

(func $init (param $seed i32)
  (call $init_do (local.get $seed))
  (if (i32.eqz (global.get $rec_pause)) (then
    (i64.store (global.get $R_REPLAY) (i64.or (i64.const 0x0152) (i64.shl (i64.extend_i32_u (local.get $seed)) (i64.const 16))))
    (global.set $rec_len (i32.const 8)) (global.set $rec_st (i32.const 0)) (global.set $rec_run (i32.const 0))
    (global.set $rec_lt (i32.const 63)))))

(func $load (param $ptr i32) (param $len i32) (result i32)
  (local $e i32)
  (local.set $e (call $load_do (local.get $ptr) (local.get $len)))
  (if (i32.eqz (local.get $e)) (then (global.set $rec_st (i32.const 2))))
  (local.get $e))

;; 1 when nothing may be recorded now; a record that might not fit (n bytes) sets the overflow flag.
(func $rec_skip (param $n i32) (result i32)
  (if (i32.or (global.get $rec_pause) (global.get $rec_st)) (then (return (i32.const 1))))
  (if (i32.gt_u (i32.add (global.get $rec_len) (local.get $n)) (global.get $LOG_CAP)) (then
    (global.set $rec_st (i32.const 1)) (return (i32.const 1))))
  (i32.const 0))
(func $rec_count
  (i32.store16 offset=6 (global.get $R_REPLAY) (i32.add (i32.load16_u offset=6 (global.get $R_REPLAY)) (i32.const 1))))

(func $vput (param $p i32) (param $v i32) (result i32)
  (local $b i32)
  (loop $l
    (local.set $b (i32.and (local.get $v) (i32.const 0x7F)))
    (local.set $v (i32.shr_u (local.get $v) (i32.const 7)))
    (i32.store8 (local.get $p) (i32.or (local.get $b) (i32.shl (i32.ne (local.get $v) (i32.const 0)) (i32.const 7))))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (br_if $l (local.get $v)))
  (local.get $p))
;; Varint at $vp (< $ve), at most 5 bytes; $vbad on failure.
(func $vget (result i32)
  (local $v i32) (local $s i32) (local $b i32)
  (loop $l
    (if (i32.or (i32.ge_u (global.get $vp) (global.get $ve)) (i32.gt_u (local.get $s) (i32.const 28)))
      (then (global.set $vbad (i32.const 1)) (return (i32.const 0))))
    (local.set $b (i32.load8_u (global.get $vp)))
    (global.set $vp (i32.add (global.get $vp) (i32.const 1)))
    (local.set $v (i32.or (local.get $v) (i32.shl (i32.and (local.get $b) (i32.const 0x7F)) (local.get $s))))
    (local.set $s (i32.add (local.get $s) (i32.const 7)))
    (br_if $l (i32.and (local.get $b) (i32.const 0x80))))
  (local.get $v))

(func $act (param $id i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
  (local $e i32) (local $p i32) (local $k i32)
  (if (i32.eqz (i32.or (global.get $rec_pause) (global.get $rec_st)))
    (then (memory.copy (global.get $PRE) (global.get $R_STATE) (global.get $STATE_LEN))))
  (local.set $e (call $act_do (local.get $id) (local.get $a) (local.get $b) (local.get $c)))
  (if (i32.or (local.get $e) (call $rec_skip (i32.const 16))) (then (return (local.get $e))))
  ;; an action that changed nothing (HARVEST ALL with nothing ripe ...) needs no record
  (if (call $memeq (global.get $PRE) (global.get $R_STATE) (global.get $STATE_LEN)) (then (return (i32.const 0))))
  (local.set $p (i32.add (global.get $R_REPLAY) (global.get $rec_len)))
  (global.set $rec_run (i32.const 0))
  (call $rec_count)
  (if (i32.eq (local.get $id) (i32.const 1)) (then
    (local.set $k (i32.and (i32.sub (local.get $a) (global.get $rec_lt)) (i32.const 63)))
    (global.set $rec_lt (local.get $a))
    ;; PLANT 1..16 tiles after the last planted one (mod 64), crop < 8: one byte 1ccc dddd
    (if (i32.and (i32.lt_u (i32.sub (local.get $k) (i32.const 1)) (i32.const 16)) (i32.lt_u (local.get $b) (i32.const 8))) (then
      (i32.store8 (local.get $p) (i32.or (i32.or (i32.const 0x80) (i32.shl (local.get $b) (i32.const 4))) (i32.sub (local.get $k) (i32.const 1))))
      (global.set $rec_len (i32.add (global.get $rec_len) (i32.const 1)))
      (return (i32.const 0))))))
  (local.set $k (i32.load8_u (i32.add (i32.const 0xF80) (local.get $id))))
  ;; a first arg 0..2 (truck, contract slot, Wheat / Corn / Tomato ...) rides in the op byte: 0aa i iiii
  (if (i32.and (i32.ne (local.get $k) (i32.const 0)) (i32.lt_u (local.get $a) (i32.const 3))) (then
    (local.set $id (i32.or (local.get $id) (i32.shl (i32.add (local.get $a) (i32.const 1)) (i32.const 5))))
    (local.set $a (local.get $b)) (local.set $b (local.get $c)) (local.set $k (i32.sub (local.get $k) (i32.const 1)))))
  (i32.store8 (local.get $p) (local.get $id))
  (local.set $p (i32.add (local.get $p) (i32.const 1)))
  (if (local.get $k) (then (local.set $p (call $vput (local.get $p) (local.get $a)))))
  (if (i32.gt_u (local.get $k) (i32.const 1)) (then (local.set $p (call $vput (local.get $p) (local.get $b)))))
  (if (i32.gt_u (local.get $k) (i32.const 2)) (then (local.set $p (call $vput (local.get $p) (local.get $c)))))
  (global.set $rec_len (i32.sub (local.get $p) (global.get $R_REPLAY)))
  (i32.const 0))

(func $end_day (result i32)
  (local $e i32) (local $p i32)
  (local.set $e (call $end_day_do))
  (if (i32.or (local.get $e) (call $rec_skip (i32.const 6))) (then (return (local.get $e))))
  (if (global.get $rec_run)
    (then
      ;; extend the run: 1F -> 1E 02, 1E n -> 1E n+1 (the last record, so it may grow a byte)
      (local.set $p (i32.add (global.get $R_REPLAY) (global.get $rec_run)))
      (global.set $vp (i32.add (local.get $p) (i32.const 1))) (global.set $ve (i32.add (local.get $p) (i32.const 6)))
      (local.set $e (i32.const 1))
      (if (i32.ne (i32.load8_u (local.get $p)) (i32.const 0x1F)) (then (local.set $e (call $vget))))
      (i32.store8 (local.get $p) (i32.const 0x1E))
      (global.set $rec_len (i32.sub (call $vput (i32.add (local.get $p) (i32.const 1)) (i32.add (local.get $e) (i32.const 1)))
                                    (global.get $R_REPLAY))))
    (else
      (global.set $rec_run (global.get $rec_len))
      (i32.store8 (i32.add (global.get $R_REPLAY) (global.get $rec_len)) (i32.const 0x1F))
      (global.set $rec_len (i32.add (global.get $rec_len) (i32.const 1)))
      (call $rec_count)))
  (i32.const 0))

;; ---------------------------------------------------------------- validation, base64url

;; Structure of the log at b (n bytes): 0 or an error code (see the header). Sets $chk_days (End Days)
;; and $chk_run (offset of the last record when it is an End Day record, else 0). Never reads past b + n.
(func $log_check (param $b i32) (param $n i32) (result i32)
  (local $op i32) (local $k i32) (local $cnt i32) (local $d i32) (local $v i32) (local $last i32)
  (if (i32.or (i32.lt_u (local.get $n) (i32.const 8)) (i32.gt_u (local.get $n) (global.get $LOG_CAP))) (then (return (i32.const 1))))
  (if (i32.ne (i32.load8_u (local.get $b)) (i32.const 0x52)) (then (return (i32.const 2))))
  (if (i32.ne (i32.load8_u offset=1 (local.get $b)) (i32.const 1)) (then (return (i32.const 3))))
  (global.set $vp (i32.add (local.get $b) (i32.const 8)))
  (global.set $ve (i32.add (local.get $b) (local.get $n)))
  (global.set $vbad (i32.const 0))
  (block $done (loop $l
    (br_if $done (i32.ge_u (global.get $vp) (global.get $ve)))
    (local.set $last (global.get $vp))
    (local.set $op (i32.load8_u (global.get $vp)))
    (global.set $vp (i32.add (global.get $vp) (i32.const 1)))
    (local.set $cnt (i32.add (local.get $cnt) (i32.const 1)))
    (block $rec
      (if (i32.eq (local.get $op) (i32.const 0x1F)) (then (local.set $d (i32.add (local.get $d) (i32.const 1))) (br $rec)))
      (if (i32.eq (local.get $op) (i32.const 0x1E)) (then
        (local.set $v (call $vget))
        (if (i32.ge_u (i32.sub (local.get $v) (i32.const 1)) (i32.const 65535)) (then (return (i32.const 4))))
        (local.set $d (i32.add (local.get $d) (local.get $v)))
        (br $rec)))
      (br_if $rec (i32.ge_u (local.get $op) (i32.const 0x80)))
      (local.set $v (i32.and (local.get $op) (i32.const 0x1F)))
      (if (i32.ge_u (i32.sub (local.get $v) (i32.const 1)) (i32.const 19)) (then (return (i32.const 4))))
      (local.set $k (i32.sub (i32.load8_u (i32.add (i32.const 0xF80) (local.get $v))) (i32.ge_u (local.get $op) (i32.const 0x20))))
      (if (i32.lt_s (local.get $k) (i32.const 0)) (then (return (i32.const 4))))
      (loop $a (if (local.get $k) (then (drop (call $vget)) (local.set $k (i32.sub (local.get $k) (i32.const 1))) (br $a)))))
    (if (i32.or (global.get $vbad) (i32.gt_u (local.get $d) (i32.const 65535))) (then (return (i32.const 4))))
    (br $l)))
  (if (i32.ne (local.get $cnt) (i32.load16_u offset=6 (local.get $b))) (then (return (i32.const 4))))
  (global.set $chk_days (local.get $d))
  (global.set $chk_run (select (i32.sub (local.get $last) (local.get $b)) (i32.const 0) (i32.lt_u (i32.sub (local.get $op) (i32.const 0x1E)) (i32.const 2))))
  (i32.const 0))

;; base64url digit <-> 6-bit value (-1 for any other char)
(func $b64c (param $v i32) (result i32)
  (if (i32.lt_u (local.get $v) (i32.const 26)) (then (return (i32.add (local.get $v) (i32.const 65)))))
  (if (i32.lt_u (local.get $v) (i32.const 52)) (then (return (i32.add (local.get $v) (i32.const 71)))))
  (if (i32.lt_u (local.get $v) (i32.const 62)) (then (return (i32.sub (local.get $v) (i32.const 4)))))
  (select (i32.const 45) (i32.const 95) (i32.eq (local.get $v) (i32.const 62))))
(func $b64v (param $c i32) (result i32)
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 65)) (i32.const 26)) (then (return (i32.sub (local.get $c) (i32.const 65)))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 97)) (i32.const 26)) (then (return (i32.sub (local.get $c) (i32.const 71)))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 48)) (i32.const 10)) (then (return (i32.add (local.get $c) (i32.const 4)))))
  (if (i32.eq (local.get $c) (i32.const 45)) (then (return (i32.const 62))))
  (if (i32.eq (local.get $c) (i32.const 95)) (then (return (i32.const 63))))
  (i32.const -1))
;; n bytes at s -> base64url at d; returns the end of the text.
(func $b64_enc (param $s i32) (param $n i32) (param $d i32) (result i32)
  (local $acc i32) (local $bits i32) (local $e i32)
  (local.set $e (i32.add (local.get $s) (local.get $n)))
  (block $done (loop $l
    (br_if $done (i32.ge_u (local.get $s) (local.get $e)))
    (local.set $acc (i32.or (i32.shl (local.get $acc) (i32.const 8)) (i32.load8_u (local.get $s))))
    (local.set $s (i32.add (local.get $s) (i32.const 1)))
    (local.set $bits (i32.add (local.get $bits) (i32.const 8)))
    (loop $o (if (i32.ge_u (local.get $bits) (i32.const 6)) (then
      (local.set $bits (i32.sub (local.get $bits) (i32.const 6)))
      (i32.store8 (local.get $d) (call $b64c (i32.and (i32.shr_u (local.get $acc) (local.get $bits)) (i32.const 63))))
      (local.set $d (i32.add (local.get $d) (i32.const 1)))
      (br $o))))
    (br $l)))
  (if (local.get $bits) (then
    (i32.store8 (local.get $d) (call $b64c (i32.and (i32.shl (local.get $acc) (i32.sub (i32.const 6) (local.get $bits))) (i32.const 63))))
    (local.set $d (i32.add (local.get $d) (i32.const 1)))))
  (local.get $d))
;; Text at p (n bytes) -> log bytes in DEC: everything up to the last '#' and surrounding whitespace
;; are dropped, the rest must be base64url (length mod 4 != 1) of at most 4 KB. Bytes or -1. The text
;; itself is at most IO_SIZE (16 KB, the loader's staging area) long.
(func $b64_in (param $p i32) (param $n i32) (result i32)
  (local $e i32) (local $i i32) (local $v i32) (local $acc i32) (local $bits i32) (local $o i32)
  (if (i32.or (i32.gt_u (local.get $n) (global.get $IO_SIZE))
              (i32.gt_u (local.get $p) (i32.sub (i32.shl (memory.size) (i32.const 16)) (local.get $n))))
    (then (return (i32.const -1))))
  (local.set $e (i32.add (local.get $p) (local.get $n)))
  (local.set $i (local.get $p))
  (block $d (loop $h
    (br_if $d (i32.ge_u (local.get $i) (local.get $e)))
    (if (i32.eq (i32.load8_u (local.get $i)) (i32.const 35)) (then (local.set $p (i32.add (local.get $i) (i32.const 1)))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $h)))
  (loop $t (if (i32.and (i32.lt_u (local.get $p) (local.get $e)) (i32.le_u (i32.load8_u (local.get $p)) (i32.const 32)))
    (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $t))))
  (loop $t (if (i32.and (i32.gt_u (local.get $e) (local.get $p)) (i32.le_u (i32.load8_u (i32.sub (local.get $e) (i32.const 1))) (i32.const 32)))
    (then (local.set $e (i32.sub (local.get $e) (i32.const 1))) (br $t))))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $p) (local.get $e)))
    (local.set $v (call $b64v (i32.load8_u (local.get $p))))
    (if (i32.lt_s (local.get $v) (i32.const 0)) (then (return (i32.const -1))))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (local.set $acc (i32.and (i32.or (i32.shl (local.get $acc) (i32.const 6)) (local.get $v)) (i32.const 0xFFFF)))
    (local.set $bits (i32.add (local.get $bits) (i32.const 6)))
    (if (i32.ge_u (local.get $bits) (i32.const 8)) (then
      (if (i32.ge_u (local.get $o) (global.get $LOG_CAP)) (then (return (i32.const -1))))
      (local.set $bits (i32.sub (local.get $bits) (i32.const 8)))
      (i32.store8 (i32.add (global.get $DEC) (local.get $o)) (i32.shr_u (local.get $acc) (local.get $bits)))
      (local.set $o (i32.add (local.get $o) (i32.const 1)))))
    (br $l)))
  (select (i32.const -1) (local.get $o) (i32.ge_u (local.get $bits) (i32.const 6))))
;; Decode + check text at p into DEC: the log length, or -(error code).
(func $log_in (param $p i32) (param $n i32) (result i32)
  (local.set $n (call $b64_in (local.get $p) (local.get $n)))
  (if (i32.lt_s (local.get $n) (i32.const 0)) (then (return (i32.const -5))))
  (local.set $p (call $log_check (global.get $DEC) (local.get $n)))
  (select (i32.sub (i32.const 0) (local.get $p)) (local.get $n) (local.get $p)))

(func $replay_load (param $p i32) (param $n i32) (result i32)
  (if (i32.eq (global.get $scr) (i32.const 7)) (then (return (i32.const 6))))
  (local.set $n (call $log_in (local.get $p) (local.get $n)))
  (if (i32.lt_s (local.get $n) (i32.const 0)) (then (return (i32.sub (i32.const 0) (local.get $n)))))
  (memory.copy (global.get $VLOG) (global.get $DEC) (local.get $n))
  (global.set $rp_vn (local.get $n)) (global.set $rp_N (global.get $chk_days))
  (global.set $rp_pend (i32.const 1))
  (call $go (i32.const 1))
  (i32.const 0))

;; The log stored next to a save (loader 'hc.log'): accepted only when replaying it from its seed
;; reproduces the loaded state exactly; then recording continues where it left off. 0 or an error.
(func $replay_restore (param $p i32) (param $n i32) (result i32)
  (local $r i32)
  (global.set $rec_st (i32.const 2))
  (if (i32.eq (global.get $scr) (i32.const 7)) (then (return (i32.const 6))))
  (local.set $n (call $log_in (local.get $p) (local.get $n)))
  (if (i32.lt_s (local.get $n) (i32.const 0)) (then (return (i32.sub (i32.const 0) (local.get $n)))))
  (if (i32.ne (i32.load offset=2 (global.get $DEC)) (i32.load (global.get $S_SEED))) (then (return (i32.const 7))))
  (local.set $p (global.get $chk_run))
  (memory.copy (global.get $SNAP) (global.get $R_STATE) (global.get $STATE_LEN))
  (memory.copy (global.get $R_REPLAY) (global.get $DEC) (local.get $n))
  (global.set $rp_b (global.get $R_REPLAY)) (global.set $rp_e (i32.add (global.get $R_REPLAY) (local.get $n)))
  (global.set $rec_pause (i32.const 1))
  (call $rp_rewind)
  (loop $l (br_if $l (i32.eqz (local.tee $r (call $rp_next)))))
  (local.set $r (i32.and (i32.eq (local.get $r) (i32.const 1)) (call $memeq (global.get $R_STATE) (global.get $SNAP) (global.get $STATE_LEN))))
  (memory.copy (global.get $R_STATE) (global.get $SNAP) (global.get $STATE_LEN))
  (global.set $rec_pause (i32.const 0))
  (if (i32.eqz (local.get $r)) (then (return (i32.const 8))))
  (global.set $rec_len (local.get $n)) (global.set $rec_run (local.get $p)) (global.set $rec_st (i32.const 0))
  (global.set $rec_lt (global.get $rp_lt))
  (i32.const 0))

(func $memeq (param $a i32) (param $b i32) (param $n i32) (result i32)
  (loop $l (if (local.get $n) (then
    (if (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b))) (then (return (i32.const 0))))
    (local.set $a (i32.add (local.get $a) (i32.const 8))) (local.set $b (i32.add (local.get $b) (i32.const 8)))
    (local.set $n (i32.sub (local.get $n) (i32.const 8)))
    (br $l))))
  (i32.const 1))

;; ---------------------------------------------------------------- share code

(func $set_origin (param $n i32)
  (if (i32.gt_u (local.get $n) (i32.const 512)) (then (local.set $n (i32.const 0))))
  (memory.copy (global.get $URL) (global.get $R_IO) (local.get $n))
  (global.set $org_n (local.get $n)))
(func $share_ptr (result i32) (i32.add (i32.add (global.get $URL) (global.get $org_n)) (i32.const 1)))
(func $share_len (result i32) (global.get $sh_n))
(func $share_build (result i32)
  (global.set $sh_n (i32.const 0))
  (if (i32.eqz (global.get $rec_st)) (then
    (i32.store8 (i32.add (global.get $URL) (global.get $org_n)) (i32.const 35))
    (global.set $sh_n (i32.sub (call $b64_enc (global.get $R_REPLAY) (global.get $rec_len) (call $share_ptr)) (call $share_ptr)))))
  (global.get $sh_n))
(func $share_url_ptr (result i32) (select (global.get $URL) (call $share_ptr) (global.get $org_n)))
(func $share_url_len (result i32)
  (i32.add (global.get $sh_n) (select (i32.add (global.get $org_n) (i32.const 1)) (i32.const 0) (global.get $org_n))))
(func $want_copy (result i32) (global.get $copy_req))
(func $ack_copy
  (global.set $copy_req (i32.const 0))
  (call $toast (i32.const 3) (call $str (global.get $STR_COPIED))))

;; ---------------------------------------------------------------- playback

;; Position 0: a fresh game from the log's seed; the cursor at the first record.
(func $rp_rewind
  (call $init (i32.load offset=2 (global.get $rp_b)))
  (global.set $rp_off (i32.add (global.get $rp_b) (i32.const 8)))
  (global.set $rp_left (i32.const 0)) (global.set $rp_day (i32.const 0)) (global.set $rp_lt (i32.const 63)))
;; Apply records until one more End Day has run: 0, 1 = the log ended (trailing actions applied),
;; 2 = a record failed. The cursor is saved before each sim call (recording uses $vp too).
(func $rp_next (result i32)
  (local $op i32) (local $k i32) (local $a i32) (local $b i32) (local $c i32) (local $i i32)
  (loop $l
    (if (global.get $rp_left) (then
      (global.set $rp_left (i32.sub (global.get $rp_left) (i32.const 1)))
      (if (call $end_day) (then (return (i32.const 2))))
      (global.set $rp_day (i32.add (global.get $rp_day) (i32.const 1)))
      (return (i32.const 0))))
    (if (i32.ge_u (global.get $rp_off) (global.get $rp_e)) (then (return (i32.const 1))))
    (local.set $op (i32.load8_u (global.get $rp_off)))
    (global.set $vp (i32.add (global.get $rp_off) (i32.const 1))) (global.set $ve (global.get $rp_e))
    (if (i32.lt_u (i32.sub (local.get $op) (i32.const 0x1E)) (i32.const 2))
      (then
        (global.set $rp_left (i32.const 1))
        (if (i32.eq (local.get $op) (i32.const 0x1E)) (then (global.set $rp_left (call $vget))))
        (global.set $rp_off (global.get $vp)))
      (else
        (local.set $a (i32.const 0)) (local.set $b (i32.const 0)) (local.set $c (i32.const 0)) (local.set $i (i32.const 0))
        (local.set $k (i32.load8_u (i32.add (i32.const 0xF80) (i32.and (local.get $op) (i32.const 0x1F)))))
        (if (i32.ge_u (local.get $op) (i32.const 0x80))
          (then
            ;; compact PLANT 1ccc dddd: tile last + d + 1 (mod 64), crop c
            (local.set $a (i32.and (i32.add (global.get $rp_lt) (i32.add (i32.and (local.get $op) (i32.const 15)) (i32.const 1))) (i32.const 63)))
            (local.set $b (i32.and (i32.shr_u (local.get $op) (i32.const 4)) (i32.const 7)))
            (local.set $op (i32.const 1)) (local.set $k (i32.const 0)))
          (else (if (i32.ge_u (local.get $op) (i32.const 0x20)) (then
            ;; first arg inline (0aa i iiii): rotated into a after the varints are read
            (local.set $i (i32.sub (i32.shr_u (local.get $op) (i32.const 5)) (i32.const 1)))
            (local.set $op (i32.and (local.get $op) (i32.const 0x1F)))
            (local.set $k (i32.sub (local.get $k) (i32.const 1)))))))
        (if (local.get $k) (then (local.set $a (call $vget))))
        (if (i32.gt_u (local.get $k) (i32.const 1)) (then (local.set $b (call $vget))))
        (if (i32.gt_u (local.get $k) (i32.const 2)) (then (local.set $c (call $vget))))
        (if (i32.lt_u (i32.sub (i32.load8_u (global.get $rp_off)) (i32.const 0x20)) (i32.const 0x60)) (then
          (local.set $c (local.get $b)) (local.set $b (local.get $a)) (local.set $a (local.get $i))))
        (global.set $rp_off (global.get $vp))
        (if (i32.eq (local.get $op) (i32.const 1)) (then (global.set $rp_lt (local.get $a))))
        (if (call $act (local.get $op) (local.get $a) (local.get $b) (local.get $c)) (then (return (i32.const 2))))))
    (br $l))
  (i32.const 0))
;; Show the state after d End Days (clamped to 0..N; N = every record).
(func $rp_seek (param $d i32)
  (local $r i32)
  (local.set $d (call $clamp (local.get $d) (i32.const 0) (global.get $rp_N)))
  (if (i32.or (global.get $rp_bad) (i32.lt_u (local.get $d) (global.get $rp_day))) (then
    (global.set $rp_bad (i32.const 0)) (call $rp_rewind)))
  (block $x
    (loop $l (if (i32.lt_u (global.get $rp_day) (local.get $d)) (then
      (br_if $x (local.tee $r (call $rp_next)))
      (br $l))))
    (if (i32.eq (global.get $rp_day) (global.get $rp_N)) (then (local.set $r (call $rp_next)))))
  (if (i32.eq (local.get $r) (i32.const 2)) (then
    (global.set $rp_bad (i32.load16_u (global.get $S_DAY))) (global.set $rp_play (i32.const 0))))
  (global.set $dirty (i32.const 1)))

;; Open the viewer on the log in VLOG (position 0, paused); the live state waits in SNAP.
(func $rp_enter
  (drop (call $log_check (global.get $VLOG) (global.get $rp_vn)))
  (global.set $rp_N (global.get $chk_days))
  (memory.copy (global.get $SNAP) (global.get $R_STATE) (global.get $STATE_LEN))
  (global.set $rec_pause (i32.const 1))
  (global.set $rp_b (global.get $VLOG)) (global.set $rp_e (i32.add (global.get $VLOG) (global.get $rp_vn)))
  (global.set $rp_bad (i32.const 0)) (global.set $rp_play (i32.const 0)) (global.set $rp_spd (i32.const 0))
  (memory.fill (global.get $TOASTS) (i32.const 0) (i32.const 192))
  (call $rp_rewind)
  (call $open (i32.const 7)))
;; WATCH REPLAY (Results) / R: the run recorded so far.
(func $rp_own
  (if (global.get $rec_st) (then (return)))
  (memory.copy (global.get $VLOG) (global.get $R_REPLAY) (global.get $rec_len))
  (global.set $rp_vn (global.get $rec_len)) (global.set $rp_pend (i32.const 0))
  (call $rp_enter))
(func $rp_exit
  (memory.copy (global.get $R_STATE) (global.get $SNAP) (global.get $STATE_LEN))
  (global.set $rec_pause (i32.const 0)) (global.set $rp_play (i32.const 0))
  (call $pop))

(func $rp_tap (param $c i32)
  (local $d i32)
  (if (i32.eq (local.get $c) (i32.const 0x3C8)) (then (if (call $share_build) (then (global.set $copy_req (i32.const 1)))) (return)))
  (if (i32.eq (local.get $c) (i32.const 0x3D8)) (then (call $rp_enter) (return)))
  (if (i32.eq (local.get $c) (i32.const 0x3D9)) (then (call $rp_own) (return)))
  (if (i32.ne (global.get $scr) (i32.const 7)) (then (return)))
  (if (i32.eq (local.get $c) (i32.const 0x3D4)) (then (global.set $rp_spd (i32.rem_u (i32.add (global.get $rp_spd) (i32.const 1)) (i32.const 3))) (return)))
  (if (i32.eq (local.get $c) (i32.const 0x3D2)) (then
    (if (i32.eqz (global.get $rp_play)) (then
      (if (i32.ge_u (global.get $rp_day) (global.get $rp_N)) (then (call $rp_seek (i32.const 0))))
      (global.set $rp_t (i32.const -1))))
    (global.set $rp_play (i32.eqz (global.get $rp_play)))
    (return)))
  (global.set $rp_play (i32.const 0))
  (local.set $d (global.get $rp_day))
  (if (i32.eq (local.get $c) (i32.const 0x3D0)) (then (call $rp_seek (i32.const 0))))
  (if (i32.eq (local.get $c) (i32.const 0x3D1)) (then (call $rp_seek (i32.sub (local.get $d) (i32.const 1)))))
  (if (i32.eq (local.get $c) (i32.const 0x3D3)) (then (call $rp_seek (i32.add (local.get $d) (i32.const 1)))))
  (if (i32.eq (local.get $c) (i32.const 0x3D6)) (then (call $rp_exit)))
  (if (i32.eq (local.get $c) (i32.const 0x3D5)) (then
    (if (global.get $has_save) (then (if (i32.eqz (call $armed (local.get $c))) (then (return)))))
    ;; re-record from the seed up to here: init (not paused) restarts the log, the records re-apply
    (global.set $rec_pause (i32.const 0))
    (call $rp_rewind)
    (call $rp_seek (local.get $d))
    (global.set $rp_pend (i32.const 0)) (global.set $has_save (i32.const 1)) (global.set $want_save (i32.const 1))
    (call $ui_reset)
    (call $after_state))))
(func $rp_key (param $k i32)
  (if (i32.eq (local.get $k) (i32.const 8)) (then (call $rp_exit)))
  (if (i32.or (i32.eq (local.get $k) (i32.const 13)) (i32.eq (local.get $k) (i32.const 16))) (then (call $rp_tap (i32.const 0x3D2))))
  (if (i32.eq (local.get $k) (i32.const 11)) (then (call $rp_tap (i32.const 0x3D1))))
  (if (i32.eq (local.get $k) (i32.const 12)) (then (call $rp_tap (i32.const 0x3D3))))
  (global.set $dirty (i32.const 1)))
;; Scrubber press / drag at logical x.
(func $rp_scrub (param $x i32)
  (global.set $rp_play (i32.const 0))
  (call $rp_seek (i32.div_s (i32.add (i32.mul (i32.sub (local.get $x) (global.get $sb_x)) (global.get $rp_N)) (i32.shr_u (global.get $sb_w) (i32.const 1)))
    (global.get $sb_w))))
;; Playback: one day every 300 >> speed ms of frame time; 1 while playing.
(func $rp_frame (result i32)
  (local $iv i32)
  (if (i32.or (i32.ne (global.get $scr) (i32.const 7)) (i32.eqz (global.get $rp_play))) (then (return (i32.const 0))))
  (global.set $rp_t (call $stamp (global.get $rp_t)))
  (local.set $iv (i32.shr_u (i32.const 300) (global.get $rp_spd)))
  (if (i32.gt_s (call $since (global.get $rp_t)) (i32.const 1000)) (then (global.set $rp_t (i32.sub (global.get $now) (local.get $iv)))))
  (loop $l (if (i32.and (global.get $rp_play) (i32.ge_s (call $since (global.get $rp_t)) (local.get $iv))) (then
    (global.set $rp_t (i32.add (global.get $rp_t) (local.get $iv)))
    (call $rp_seek (i32.add (global.get $rp_day) (i32.const 1)))
    (if (i32.ge_u (global.get $rp_day) (global.get $rp_N)) (then (global.set $rp_play (i32.const 0))))
    (br $l))))
  (i32.const 1))

;; ---------------------------------------------------------------- drawing

;; Viewer card body: the failure line, the scrubber, the transport and TAKE OVER / EXIT rows.
(func $rp_body
  (local $h i32) (local $y i32)
  (if (global.get $rp_bad) (then
    (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_SCR) (i32.const 6))) (call $si (global.get $STR_INVALID)) (call $sn0 (global.get $rp_bad))
    (call $lab (global.get $I_WARN) (i32.const 37))))
  (local.set $h (call $btnh))
  (global.set $sb_x (global.get $ux)) (global.set $sb_w (call $imax (global.get $uw) (i32.const 1)))
  (local.set $y (i32.add (global.get $uy) (i32.shr_s (i32.sub (local.get $h) (i32.const 10)) (i32.const 1))))
  (call $ui_bar (global.get $ux) (local.get $y) (global.get $uw) (i32.const 10) (global.get $rp_day) (global.get $rp_N) (i32.const 18))
  (call $rrect (i32.add (global.get $ux) (i32.sub (i32.div_s (i32.mul (global.get $uw) (global.get $rp_day)) (call $imax (global.get $rp_N) (i32.const 1))) (i32.const 3)))
    (i32.sub (local.get $y) (i32.const 4)) (i32.const 7) (i32.const 18) (i32.const 2) (call $pal (i32.const 60)))
  (if (i32.and (i32.ge_s (global.get $uy) (global.get $clip_t)) (i32.le_s (i32.add (global.get $uy) (local.get $h)) (global.get $clip_b)))
    (then (drop (call $hit_add (global.get $ux) (global.get $uy) (global.get $uw) (local.get $h) (i32.const 0x3D7)))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $h) (global.get $lgap))))
  (call $put (i32.const 0x3D0) (call $str (global.get $STR_RESTART)) (i32.const -1) (i32.const 0) (i32.const 1) (i32.const 3) (local.get $h))
  (call $sb (global.get $SB2)) (call $sc (i32.const 45)) (call $sc (i32.const 49)) (call $si (global.get $STR_DAY1))
  (call $put (i32.const 0x3D1) (global.get $SB2) (i32.const -1) (i32.const 0) (i32.const 1) (i32.const 3) (local.get $h))
  (call $sb (global.get $SB2)) (call $sc (i32.const 43)) (call $sc (i32.const 49)) (call $si (global.get $STR_DAY1))
  (call $put (i32.const 0x3D3) (global.get $SB2) (i32.const -1) (i32.const 0) (i32.const 1) (i32.const 3) (local.get $h))
  (call $put (i32.const 0x3D2) (call $str (select (global.get $STR_PAUSE) (global.get $STR_PLAY) (global.get $rp_play)))
    (select (i32.const -1) (global.get $I_ARROW_R) (global.get $rp_play)) (i32.const 2) (i32.const 1) (i32.const 2) (local.get $h))
  (call $sb (global.get $SB2)) (call $si (global.get $STR_SPEED)) (call $si (global.get $STR_X)) (call $sn0 (i32.shl (i32.const 1) (global.get $rp_spd)))
  (call $put (i32.const 0x3D4) (global.get $SB2) (global.get $I_CLOCK) (i32.const 0) (i32.const 1) (i32.const 2) (local.get $h))
  (call $put_two (i32.const 0x3D5) (call $str (global.get $STR_TAKE_OVER)) (call $str (global.get $STR_REPLACES)) (i32.const -1) (i32.const 2) (local.get $h))
  (call $put (i32.const 0x3D6) (call $str (global.get $STR_EXIT)) (global.get $I_CLOSE) (i32.const 0) (i32.const 1) (i32.const 2) (local.get $h)))

;; Results / Game Over share slot: the code's first 24 chars and length, then COPY CODE and WATCH
;; REPLAY with the QR of the share link: beside them (QR left, buttons stacked right) when it fits there
;; at >= 2 px a module, else below them across the card, else (a link over 858 B, a long run) the line
;; "TOO LONG FOR QR - COPY CODE". The QR is at most 1/3 of the screen tall; the card scrolls when the
;; panel gets taller than the screen. The reason instead of all this when the run cannot be shared.
(func $share_ui
  (local $n i32) (local $i i32) (local $bh i32) (local $w i32) (local $q i32) (local $y i32) (local $hm i32)
  (global.set $qr_ak (i32.const 0))
  (if (global.get $rec_st) (then
    (call $ui_label (global.get $I_LOCK) (call $str (select (global.get $STR_TOO_LONG) (global.get $STR_NO_SHARE) (i32.eq (global.get $rec_st) (i32.const 1)))) (i32.const 61))
    (return)))
  (local.set $n (call $share_build))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_SHARE))
  (loop $l
    (call $sc (i32.load8_u (i32.add (call $share_ptr) (local.get $i))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (call $imin (local.get $n) (i32.const 24)))))
  (call $si (global.get $STR_ELLIPSIS)) (call $sp) (call $sn (local.get $n) (i32.const 2))
  ;; (not read out: a screen reader would spell the code; the buttons say what it is)
  (local.set $i (global.get $lab_on)) (global.set $lab_on (i32.const 0))
  (call $lab (global.get $I_UP) (i32.const 61))
  (global.set $lab_on (local.get $i))
  (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
  (local.set $bh (call $btnh))
  (local.set $hm (i32.div_s (global.get $fb_h) (i32.const 3)))
  ;; QR column: at most half the card, leaving the buttons the width of a two-label row ($pcols)
  (local.set $w (call $imin (i32.shr_s (global.get $uw) (i32.const 1))
    (i32.sub (global.get $uw) (i32.add (i32.add (i32.mul (i32.const 93) (call $ui_ts)) (i32.const 20)) (global.get $lgap)))))
  (local.set $y (global.get $uy))
  (local.set $q (call $share_qr_slot (global.get $ux) (local.get $y) (local.get $w) (local.get $hm)))
  (if (local.get $q)
    (then
      ;; buttons stacked right of the QR, centred against it
      (global.set $ux (i32.add (global.get $ux) (i32.add (local.get $w) (global.get $lgap))))
      (global.set $uw (i32.sub (global.get $uw) (i32.add (local.get $w) (global.get $lgap))))
      (global.set $uy (i32.add (local.get $y) (call $imax (i32.const 0)
        (i32.shr_s (i32.sub (local.get $q) (i32.add (i32.shl (local.get $bh) (i32.const 1)) (global.get $lgap))) (i32.const 1)))))
      (call $share_btns (i32.const 1) (local.get $bh))
      (global.set $ux (i32.sub (global.get $ux) (i32.add (local.get $w) (global.get $lgap))))
      (global.set $uw (i32.add (global.get $uw) (i32.add (local.get $w) (global.get $lgap))))
      (global.set $uy (i32.add (global.get $lgap) (call $imax (global.get $uy) (i32.add (local.get $y) (local.get $q))))))
    (else
      (call $share_btns (call $pcols) (local.get $bh))
      (local.set $q (call $share_qr_slot (global.get $ux) (global.get $uy) (global.get $uw) (local.get $hm)))
      (if (local.get $q)
        (then (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $q) (global.get $lgap)))))
        (else
          (call $sb (global.get $SB1)) (call $si (global.get $STR_QR_LONG)) (call $si (global.get $STR_COPY))
          (call $lab (global.get $I_WARN) (i32.const 61))
          (global.set $uy (i32.add (global.get $uy) (global.get $lgap))))))))
(func $share_btns (param $c i32) (param $bh i32)
  (call $put (i32.const 0x3C8) (call $str (global.get $STR_COPY)) (global.get $I_PLUS) (i32.const 0) (i32.const 1) (local.get $c) (local.get $bh))
  (call $sb (global.get $SB2)) (call $si (global.get $STR_WATCH)) (call $si (i32.add (global.get $STR_SCR) (i32.const 6)))
  (call $put (i32.const 0x3D9) (global.get $SB2) (global.get $I_CLOCK) (i32.const 0) (i32.const 1) (local.get $c) (local.get $bh)))
;; The QR of the share link (share_url_ptr / len, re-encoded on every draw: the matrix is shared
;; scratch) with the largest integer scale whose square (quiet zone included) fits w x h, centred
;; across w at the top of the slot; the height used, or 0 (nothing drawn) when the link is over 858 B
;; or the scale would be under 2 px a module.
(func $share_qr_slot (param $x i32) (param $y i32) (param $w i32) (param $h i32) (result i32)
  (local $s i32) (local $p i32)
  (if (i32.eqz (call $qr_encode (call $share_url_ptr) (call $share_url_len))) (then (return (i32.const 0))))
  (local.set $s (i32.div_s (call $imin (local.get $w) (local.get $h)) (i32.add (call $qr_size) (i32.const 8))))
  (if (i32.lt_s (local.get $s) (i32.const 2)) (then (return (i32.const 0))))
  (local.set $p (call $qr_pixels (local.get $s)))
  (global.set $qr_at (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (local.get $p)) (i32.const 1))))
  (global.set $qr_ay (local.get $y)) (global.set $qr_as (local.get $p)) (global.set $qr_ak (local.get $s))
  (global.set $qr_ct (global.get $clip_t)) (global.set $qr_cb (global.get $clip_b))
  (call $qr_draw (global.get $qr_at) (local.get $y) (local.get $s))
  (local.get $p))

;; Test hooks.
(global $qr_at (mut i32) (i32.const 0))   ;; last share QR drawn: x, y, side, scale (0 = none)
(global $qr_ay (mut i32) (i32.const 0))
(global $qr_as (mut i32) (i32.const 0))
(global $qr_ak (mut i32) (i32.const 0))
(global $qr_ct (mut i32) (i32.const 0))   ;; the card body's clip when it was drawn
(global $qr_cb (mut i32) (i32.const 0))
(func $t_qr (param $k i32) (result i32)
  (if (i32.eqz (local.get $k)) (then (return (global.get $qr_at))))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (return (global.get $qr_ay))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (return (global.get $qr_as))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (return (global.get $qr_ak))))
  (if (i32.eq (local.get $k) (i32.const 4)) (then (return (global.get $qr_ct))))
  (global.get $qr_cb))
(func $t_log_len (result i32) (global.get $rec_len))
(func $t_log_st (result i32) (global.get $rec_st))
(func $t_rp (param $k i32) (result i32)
  (if (i32.eqz (local.get $k)) (then (return (global.get $rp_day))))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (return (global.get $rp_N))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (return (global.get $rp_play))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (return (global.get $rp_spd))))
  (if (i32.eq (local.get $k) (i32.const 4)) (then (return (global.get $rp_bad))))
  (if (i32.eq (local.get $k) (i32.const 5)) (then (return (global.get $rp_pend))))
  (global.get $copy_req))
