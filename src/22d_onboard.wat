;; Guided first days (spec §13 Onboarding; plan Task 8a): six spotlight hints over the REAL UI.
;; UI-only: the sim, its RNG, the save image and the replay log are never touched (no $act, no
;; state writes); progress is a pref (get_flags bit 3 = done / skipped, persisted by the loader in
;; hc.prefs; bits 4-6 = the step, session only).
;;
;; Steps (fact bit = step - 1), advanced by OBSERVING the sim between draws ($tut_tick), never by
;; injecting actions, so taps, keys and any order work; the step shown is the first fact not yet
;; seen (facts only accumulate):
;;   1 PLANT      a crop appeared (crop count rose)        2 END DAY   the day changed
;;   3 HARVEST    storage rose                             4 SELL      storage fell + cash rose, same day
;;   5 BUILD MILL a Mill exists                            6 TRUCK     a truck is on the road
;;   7 = the ALL SET card (done is set on reaching it; DONE / SKIP hides it).
;; Wheat sown on day 1 is not ripe on day 1, so the steps run over the first two days (the
;; starting Wheat ripens with the first End Day).
;; Start: every NEW GAME / DAILY SEED / TRY AGAIN ($fresh) while not done; never CONTINUE or
;; ui_boot; REPLAY TUTORIAL (How to play) clears done and restarts at step 1 (CONTINUE with a
;; save, else a NEW GAME). Hidden on every screen but the farm and the Gazette (START DAY is
;; the target there) and in the replay viewer (the facts resync after it).
;;
;; Targets ($tut_plan): a hit region code drawn this frame or a plot (0x10000 + tile, its ground
;; diamond box via $tile_rect). When the step's control is not on screen the hint points at
;; the one that gets there (the tab, the plot, CANCEL, START DAY). A plan whose control was not
;; drawn shows the card alone (never a stale rect). Drawing ($tut_draw, after the chrome and
;; before the toasts): the screen dims toward ink except a rounded hole around the target, a
;; wheat-gold ring with a soft glow that pulses (static under reduced motion), and a paper hint
;; card above or below it (whichever has room; never over the target, the top bar's End Day or
;; its own SKIP), with a tail pointing at the target. Input is never blocked: only the card
;; absorbs taps. Each new hint is announced ("STEP 2 OF 6: TAP END DAY").
;;
;; Hit codes: 0x3DC SKIP / DONE  0x3DD the card (inert)  0x3DE REPLAY TUTORIAL (How to play).
;; R_LAYOUT 0xA900..0xA9BF: hint text 0xA900, step line 0xA940, announcement 0xA980 (64 B each).

(global $tut (mut i32) (i32.const 0))          ;; 0 off, 1..6 step, 7 ALL SET
(global $tut_done (mut i32) (i32.const 0))     ;; pref bit 3
(global $tf (mut i32) (i32.const 0))           ;; facts seen (bit = step - 1)
(global $t_crops (mut i32) (i32.const 0))      ;; last observation
(global $t_store (mut i32) (i32.const 0))
(global $t_cash (mut i32) (i32.const 0))
(global $t_day (mut i32) (i32.const 0))
(global $t_day0 (mut i32) (i32.const 0))       ;; day the tutorial (re)started
(global $t_rs (mut i32) (i32.const 0))         ;; resync before observing (after the replay viewer)
(global $t_said (mut i32) (i32.const -1))      ;; last announced hint key
(global $tcode (mut i32) (i32.const 0))        ;; target: hit code, 0x10000 + tile, 0 none
(global $thint (mut i32) (i32.const 0))        ;; hint: string id (+0x400 = "TAP " first), -1 NEED
(global $tg_x (mut i32) (i32.const 0)) (global $tg_y (mut i32) (i32.const 0))
(global $tg_w (mut i32) (i32.const 0)) (global $tg_h (mut i32) (i32.const 0))
(global $tc_x (mut i32) (i32.const 0)) (global $tc_y (mut i32) (i32.const 0))
(global $tc_w (mut i32) (i32.const 0)) (global $tc_h (mut i32) (i32.const 0))
(global $TBUF i32 (i32.const 0xA900))

;; (Re)start at step s (1..7): the steps before it count as done; observe from the current state.
(func $tut_go (param $s i32)
  (global.set $tut (local.get $s))
  (global.set $tf (i32.sub (i32.shl (i32.const 1) (i32.sub (local.get $s) (i32.const 1))) (i32.const 1)))
  (global.set $t_day0 (i32.load16_u (global.get $S_DAY)))
  (global.set $t_said (i32.const -1))
  (call $tut_sync)
  (global.set $dirty (i32.const 1)))
(func $tut_sync
  (global.set $t_crops (call $crop_count))
  (global.set $t_store (call $storage_used))
  (global.set $t_cash (i32.load (global.get $S_CASH)))
  (global.set $t_day (i32.load16_u (global.get $S_DAY)))
  (global.set $t_rs (i32.const 0)))

;; Observe the sim since the last draw; advance to the first step whose fact is unseen.
(func $tut_tick
  (local $f i32) (local $s i32) (local $d i32) (local $t i32) (local $p i32)
  (if (i32.eqz (global.get $tut)) (then (return)))
  (if (i32.eq (global.get $scr) (i32.const 7)) (then (global.set $t_rs (i32.const 1)) (return)))
  (local.set $f (global.get $tf))
  (local.set $s (call $storage_used))
  (local.set $d (i32.load16_u (global.get $S_DAY)))
  (if (i32.eqz (global.get $t_rs)) (then
    (if (i32.gt_s (call $crop_count) (global.get $t_crops)) (then (local.set $f (i32.or (local.get $f) (i32.const 1)))))
    (if (i32.gt_s (local.get $s) (global.get $t_store)) (then (local.set $f (i32.or (local.get $f) (i32.const 4)))))
    (if (i32.and (i32.eq (local.get $d) (global.get $t_day))
          (i32.and (i32.lt_s (local.get $s) (global.get $t_store)) (i32.gt_s (i32.load (global.get $S_CASH)) (global.get $t_cash))))
      (then (local.set $f (i32.or (local.get $f) (i32.const 8)))))))
  (if (i32.ne (local.get $d) (global.get $t_day0)) (then (local.set $f (i32.or (local.get $f) (i32.const 2)))))
  (if (call $count_bld (i32.const 0)) (then (local.set $f (i32.or (local.get $f) (i32.const 16)))))
  (loop $l
    (local.set $p (call $truck_ptr (local.get $t)))
    (if (local.get $p) (then (if (i32.load8_u offset=2 (local.get $p)) (then (local.set $f (i32.or (local.get $f) (i32.const 32)))))))
    (br_if $l (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3))))
  (call $tut_sync)
  (global.set $tf (local.get $f))
  (if (i32.le_u (global.get $tut) (i32.const 6))
    (then (global.set $tut (call $imin (i32.add (i32.ctz (i32.xor (local.get $f) (i32.const -1))) (i32.const 1)) (i32.const 7)))))
  (if (i32.eq (global.get $tut) (i32.const 7)) (then (global.set $tut_done (i32.const 1)))))

;; ---------------------------------------------------------------- plan: target + hint

(func $tset (param $c i32) (param $h i32) (global.set $tcode (local.get $c)) (global.set $thint (local.get $h)))
(func $tstr (param $k i32) (result i32) (i32.add (global.get $STR_TUT) (local.get $k)))
(func $ttap (param $id i32) (result i32) (i32.or (local.get $id) (i32.const 0x400)))
;; Tile i is an owned empty plot.
(func $t_empty (param $i i32) (result i32)
  (i32.and (i32.ge_s (local.get $i) (i32.const 0))
    (i32.and (call $in_grid (local.get $i)) (i32.eqz (i32.load8_u (call $tile_ptr (local.get $i)))))))
;; Target an empty plot: the selected one, else the first (none: no target).
(func $t_plot
  (local $i i32)
  (global.set $tcode (i32.const 0))
  (global.set $thint (call $ttap (call $tstr (i32.const 0))))
  (if (call $t_empty (global.get $sel_tile)) (then (global.set $tcode (i32.or (i32.const 0x10000) (global.get $sel_tile))) (return)))
  (loop $l
    (if (call $t_empty (local.get $i)) (then (global.set $tcode (i32.or (i32.const 0x10000) (local.get $i))) (return)))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64)))))
;; Nothing to sell / send: harvest what is ripe (storage too full for a harvest: sell first), else End Day.
(func $t_goods
  (if (i32.and (i32.ne (call $ripe_count) (i32.const 0)) (i32.and (i32.eqz (call $storage_fits (i32.const 16))) (i32.ne (call $storage_used) (i32.const 0))))
    (then (call $t_sell) (return)))
  (if (call $ripe_count)
    (then (call $tset (global.get $HIT_HARVALL) (call $ttap (global.get $STR_HARVEST))))
    (else (call $tset (global.get $HIT_ENDDAY) (call $tstr (i32.const 2))))))
;; Sell at the Farm Stand: Market tab, SELL sub-tab, + on the first good in stock, SELL.
(func $t_sell
  (local $g i32)
  (if (i32.ne (global.get $tab) (i32.const 2)) (then (call $tset (i32.add (global.get $HIT_TAB0) (i32.const 2)) (call $tstr (i32.const 3))) (return)))
  (if (i32.ne (global.get $msub) (i32.const 1)) (then (call $tset (i32.const 0x231) (call $tstr (i32.const 4))) (return)))
  (if (call $qsum) (then (call $tset (i32.const 0x208) (call $tstr (i32.const 4))) (return)))
  (loop $l
    (if (i32.and (i32.eqz (call $inv_count (local.get $g))) (i32.lt_u (local.get $g) (i32.const 12)))
      (then (local.set $g (i32.add (local.get $g) (i32.const 1))) (br $l))))
  (call $tset (i32.add (i32.const 0x250) (local.get $g)) (call $ttap (call $tstr (i32.const 5)))))

(func $tut_plan
  (local $s i32) (local $r i32) (local $sheet i32)
  (local.set $s (global.get $tut))
  (call $tset (i32.const 0) (call $tstr (i32.const 10)))
  (if (i32.eq (global.get $scr) (i32.const 2)) (then (call $tset (i32.const 0x3C7) (call $ttap (global.get $STR_START_DAY))) (return)))
  (if (i32.eq (local.get $s) (i32.const 7)) (then (return)))
  ;; placing a building: the Mill step taps a plot; any other placement is cancelled first
  (if (global.get $place) (then
    (if (i32.and (i32.eq (local.get $s) (i32.const 5)) (i32.eq (global.get $place) (i32.const 1))) (then (call $t_plot) (return)))
    (call $tset (i32.const 0x233) (call $ttap (global.get $STR_CANCEL)))
    (return)))
  ;; the farm sheet of a selected empty plot is open
  (local.set $sheet (i32.and (call $t_empty (global.get $sel_tile)) (i32.eqz (global.get $tab))))
  (block $x (block $s6 (block $s5 (block $s4 (block $s3 (block $s2 (block $s1
    (br_table $s1 $s1 $s2 $s3 $s4 $s5 $s6 $x (local.get $s)))
    ;; 1 PLANT: the plot, then PLANT and the Wheat row
    (if (i32.eqz (local.get $sheet)) (then (call $t_plot) (return)))
    (if (global.get $pick) (then (call $tset (i32.const 0x200) (call $ttap (call $tstr (i32.const 1)))) (return)))
    (call $tset (i32.const 0x210) (call $ttap (call $tstr (i32.const 1))))
    ;; Wheat cannot be planted today (season, cash): time moves on
    (local.set $r (call $btn_find (i32.const 0x210)))
    (if (i32.eqz (select (i32.load offset=4 (local.get $r)) (i32.const 0) (local.get $r))) (then (call $tset (global.get $HIT_ENDDAY) (call $tstr (i32.const 2)))))
    (return))
    ;; 2 END DAY
    (call $tset (global.get $HIT_ENDDAY) (call $ttap (global.get $STR_END_DAY)))
    (return))
    ;; 3 HARVEST
    (call $t_goods)
    (return))
    ;; 4 SELL
    (if (call $storage_used) (then (call $t_sell)) (else (call $t_goods)))
    (return))
    ;; 5 BUILD MILL (Build tab, or the plot sheet's build picker); short of cash: sell first
    (if (i32.lt_s (i32.load (global.get $S_CASH)) (call $bal (global.get $T_BLD) (i32.const 0) (i32.const 0))) (then
      (if (call $storage_used) (then (call $t_sell)) (else (call $tset (global.get $HIT_ENDDAY) (i32.const 0))))
      (global.set $thint (i32.const -1))
      (return)))
    (call $tset (i32.add (global.get $HIT_TAB0) (i32.const 4)) (call $tstr (i32.const 6)))
    (if (i32.or (i32.eq (global.get $tab) (i32.const 4)) (i32.and (local.get $sheet) (global.get $pick)))
      (then (global.set $tcode (i32.const 0x220))))
    (return))
    ;; 6 SEND TRUCK: Trucks tab, DISPATCH, TOWN, load, NEXT, SEND
    (if (i32.eqz (call $storage_used)) (then (call $t_goods) (return)))
    (if (i32.ne (global.get $tab) (i32.const 3)) (then (call $tset (i32.add (global.get $HIT_TAB0) (i32.const 3)) (call $tstr (i32.const 7))) (return)))
    (call $tset (i32.const 0x20C) (call $tstr (i32.const 8)))
    ;; (truck 1 is always owned; while it is away the step is done)
    (if (i32.lt_s (global.get $dsp) (i32.const 0)) (then (global.set $tcode (i32.const 0x280)) (return)))
    (if (i32.eqz (global.get $dstep)) (then (global.set $tcode (i32.const 0x239))))
    (if (i32.eq (global.get $dstep) (i32.const 1)) (then
      (call $tset (select (i32.const 0x20C) (i32.const 0x209) (call $qsum)) (call $tstr (i32.const 9)))))
    (if (i32.eq (global.get $dstep) (i32.const 3)) (then (global.set $tcode (i32.const 0x20A))))))

;; Hint text (TBUF), step line (TBUF + 64: "STEP 2 OF 6", none on the ALL SET card).
(func $tut_text
  (call $sb (global.get $TBUF))
  (if (i32.eq (global.get $thint) (i32.const -1))
    (then
      (call $si (global.get $STR_NEED)) (call $sn (call $bal (global.get $T_BLD) (i32.const 0) (i32.const 0)) (i32.const 1))
      (call $si (call $tstr (i32.const 11))))
    (else
      (if (i32.and (global.get $thint) (i32.const 0x400)) (then (call $si (call $tstr (i32.const 14)))))
      (call $si (i32.and (global.get $thint) (i32.const 0x3FF)))))
  (call $sb (i32.add (global.get $TBUF) (i32.const 64)))
  (if (i32.le_u (global.get $tut) (i32.const 6)) (then
    (call $si (global.get $STR_STEP)) (call $sn0 (global.get $tut)) (call $si (global.get $STR_OF)) (call $sc (i32.const 54)))))

;; Target rect -> $tg_*; 0 when the target is not on screen (tg_w = 0).
(func $tut_rect (result i32)
  (local $n i32) (local $p i32)
  (global.set $tg_w (i32.const 0))
  (if (i32.ge_u (global.get $tcode) (i32.const 0x10000)) (then
    (call $tile_rect (i32.and (global.get $tcode) (i32.const 63)))
    (global.set $tg_x (global.get $tr_x)) (global.set $tg_y (global.get $tr_y))
    (global.set $tg_w (global.get $tr_w)) (global.set $tg_h (global.get $tr_h))
    (return (i32.const 1))))
  (if (i32.eqz (global.get $tcode)) (then (return (i32.const 0))))
  (local.set $n (call $hit_n))
  (loop $l
    (if (local.get $n) (then
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (local.set $p (i32.add (i32.add (global.get $R_LAYOUT) (global.get $L_HIT)) (i32.mul (local.get $n) (i32.const 20))))
      (if (i32.eq (i32.load offset=16 (local.get $p)) (global.get $tcode)) (then
        (global.set $tg_x (i32.load (local.get $p))) (global.set $tg_y (i32.load offset=4 (local.get $p)))
        (global.set $tg_w (i32.load offset=8 (local.get $p))) (global.set $tg_h (i32.load offset=12 (local.get $p)))
        (return (i32.const 1))))
      (br $l))))
  (i32.const 0))

;; ---------------------------------------------------------------- drawing

;; Row span of the hole shape (x, y, w, h) at row r -> [$sp_a, $sp_b), empty when off its rows:
;; a rect, or (dia) the ground diamond inscribed in it.
(global $sp_a (mut i32) (i32.const 0))
(global $sp_b (mut i32) (i32.const 0))
(func $rspan (param $r i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $dia i32)
  (local $d i32)
  (global.set $sp_a (i32.const 0)) (global.set $sp_b (i32.const 0))
  (local.set $d (i32.sub (i32.add (i32.shl (local.get $r) (i32.const 1)) (i32.const 1)) (i32.add (i32.shl (local.get $y) (i32.const 1)) (local.get $h))))
  (local.set $d (select (local.get $d) (i32.sub (i32.const 0) (local.get $d)) (i32.ge_s (local.get $d) (i32.const 0))))
  (if (i32.ge_s (local.get $d) (local.get $h)) (then (return)))
  (local.set $d (select (i32.div_s (i32.mul (local.get $w) (i32.sub (local.get $h) (local.get $d))) (i32.shl (local.get $h) (i32.const 1))) (i32.shr_s (local.get $w) (i32.const 1)) (local.get $dia)))
  (global.set $sp_a (i32.sub (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (local.get $d)))
  (global.set $sp_b (i32.add (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (local.get $d))))

;; Paint [a, b) of the row at p: dim (a quarter of the pixel + 3/4 ink) or the gold ring colour.
(global $t_ink (mut i32) (i32.const 0))
(func $tspan (param $p i32) (param $a i32) (param $b i32) (param $gold i32)
  (local $e i32)
  (local.set $e (i32.add (local.get $p) (i32.shl (call $clamp (local.get $b) (i32.const 0) (global.get $fb_w)) (i32.const 2))))
  (local.set $p (i32.add (local.get $p) (i32.shl (call $clamp (local.get $a) (i32.const 0) (global.get $fb_w)) (i32.const 2))))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $p) (local.get $e)))
    (i32.store (local.get $p) (select (local.get $gold)
      (i32.add (i32.and (i32.shr_u (i32.load (local.get $p)) (i32.const 2)) (i32.const 0x3F3F3F)) (global.get $t_ink)) (local.get $gold)))
    (local.set $p (i32.add (local.get $p) (i32.const 4)))
    (br $l))))

;; Spotlight: the screen dimmed toward ink except the hole (x, y, w, h; dia = the diamond in it),
;; ringed t px in wheat gold (2t px sideways on a diamond: the same line weight); t < 0: dim all.
(func $spot (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $t i32) (param $dia i32)
  (local $row i32) (local $p i32) (local $oa i32) (local $ob i32) (local $tx i32) (local $gold i32)
  (local.set $gold (call $pal (i32.const 19)))
  (local.set $tx (i32.shl (local.get $t) (local.get $dia)))
  (global.set $t_ink (i32.sub (call $pal (i32.const 60)) (i32.and (i32.shr_u (call $pal (i32.const 60)) (i32.const 2)) (i32.const 0x3F3F3F))))
  (loop $l
    (local.set $p (i32.add (global.get $R_FB) (i32.shl (i32.mul (local.get $row) (global.get $fb_w)) (i32.const 2))))
    (call $rspan (local.get $row) (i32.sub (local.get $x) (local.get $tx)) (i32.sub (local.get $y) (local.get $t))
      (i32.add (local.get $w) (i32.shl (local.get $tx) (i32.const 1))) (i32.add (local.get $h) (i32.shl (local.get $t) (i32.const 1))) (local.get $dia))
    (local.set $oa (global.get $sp_a)) (local.set $ob (global.get $sp_b))
    (if (i32.lt_s (local.get $t) (i32.const 0)) (then (local.set $ob (local.get $oa))))
    (call $tspan (local.get $p) (i32.const 0) (local.get $oa) (i32.const 0))
    (call $tspan (local.get $p) (local.get $ob) (global.get $fb_w) (i32.const 0))
    (call $rspan (local.get $row) (local.get $x) (local.get $y) (local.get $w) (local.get $h) (local.get $dia))
    (if (i32.eq (global.get $sp_a) (global.get $sp_b)) (then (global.set $sp_a (local.get $ob)) (global.set $sp_b (local.get $ob))))
    (call $tspan (local.get $p) (local.get $oa) (global.get $sp_a) (local.get $gold))
    (call $tspan (local.get $p) (global.get $sp_b) (local.get $ob) (local.get $gold))
    (br_if $l (i32.lt_u (local.tee $row (i32.add (local.get $row) (i32.const 1))) (global.get $fb_h)))))

;; Tail: a triangle of k rows from the card edge row y toward dir (1 down, -1 up), centred on x;
;; ink edge, paper inside.
(func $tail (param $x i32) (param $y i32) (param $k i32) (param $dir i32)
  (local $i i32) (local $n i32)
  (loop $l
    (local.set $n (i32.sub (local.get $k) (local.get $i)))
    (call $hline (i32.sub (local.get $x) (local.get $n)) (local.get $y) (i32.add (i32.shl (local.get $n) (i32.const 1)) (i32.const 1)) (call $pal (i32.const 61)))
    (call $hline (i32.sub (i32.add (local.get $x) (i32.const 2)) (local.get $n)) (local.get $y) (i32.sub (i32.shl (local.get $n) (i32.const 1)) (i32.const 3)) (call $pal (i32.const 58)))
    (local.set $y (i32.add (local.get $y) (local.get $dir)))
    (br_if $l (i32.lt_s (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $k)))))

(func $tut_draw
  (local $g i32) (local $mt i32) (local $t i32) (local $pad i32) (local $found i32) (local $gl i32) (local $ph i32)
  (local $cw i32) (local $ch i32) (local $bw i32) (local $bh i32) (local $txw i32) (local $hh i32) (local $sl i32)
  (local $k i32) (local $top i32) (local $bot i32) (local $hy0 i32) (local $hy1 i32) (local $up i32) (local $lab i32)
  (local $y i32) (local $key i32) (local $dir i32) (local $ax i32) (local $ay i32) (local $aw i32) (local $ah i32)
  (call $tut_tick)
  (global.set $tc_w (i32.const 0)) (global.set $tg_w (i32.const 0))
  (if (i32.or (i32.eqz (global.get $tut)) (i32.and (i32.ne (global.get $scr) (i32.const 0)) (i32.ne (global.get $scr) (i32.const 2))))
    (then (return)))
  (call $tut_plan)
  (call $tut_text)
  ;; a new hint is announced once: "STEP 2 OF 6: TAP END DAY"
  (local.set $key (i32.add (global.get $thint) (i32.shl (global.get $tut) (i32.const 12))))
  (if (i32.ne (local.get $key) (global.get $t_said)) (then
    (global.set $t_said (local.get $key))
    (call $sb (i32.add (global.get $TBUF) (i32.const 128)))
    (if (i32.le_u (global.get $tut) (i32.const 6)) (then
      (call $ss (i32.add (global.get $TBUF) (i32.const 64))) (call $sc (i32.const 58)) (call $sc (i32.const 32))))
    (call $ss (global.get $TBUF))
    (call $announce (i32.add (global.get $TBUF) (i32.const 128)))))
  (local.set $g (i32.add (global.get $lgap) (i32.const 2)))
  (local.set $mt (call $min_touch))
  (local.set $t (call $imax (i32.const 2) (i32.div_u (local.get $mt) (i32.const 22))))
  (local.set $pad (i32.add (local.get $g) (i32.const 1)))
  (local.set $found (call $tut_rect))
  ;; the ring breathes 0..t px out from the target, a ~1 s triangle wave (still under reduced motion)
  (local.set $gl (i32.and (i32.shr_u (global.get $now) (i32.const 6)) (i32.const 15)))
  (local.set $gl (select (i32.sub (i32.const 15) (local.get $gl)) (local.get $gl) (i32.gt_u (local.get $gl) (i32.const 7))))
  (local.set $gl (select (i32.const 0) (i32.div_u (i32.mul (local.get $gl) (i32.add (local.get $t) (i32.const 1))) (i32.const 8)) (global.get $flag_reduced)))
  (local.set $ph (i32.add (local.get $pad) (i32.shl (local.get $t) (i32.const 1))))
  (local.set $gl (i32.add (local.get $pad) (local.get $gl)))
  (if (local.get $found)
    (then (call $spot (i32.sub (global.get $tg_x) (local.get $gl)) (i32.sub (global.get $tg_y) (local.get $gl))
      (i32.add (global.get $tg_w) (i32.shl (local.get $gl) (i32.const 1))) (i32.add (global.get $tg_h) (i32.shl (local.get $gl) (i32.const 1)))
      (local.get $t) (i32.ge_u (global.get $tcode) (i32.const 0x10000))))
    (else (if (i32.eq (global.get $tut) (i32.const 7)) (then (call $spot (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const -1) (i32.const 0))))))
  ;; card: [step line / hint] [SKIP], sized to its text
  (global.set $tscale (call $ui_ts))
  (local.set $lab (call $str (select (call $tstr (i32.const 12)) (global.get $STR_ERR) (i32.le_u (global.get $tut) (i32.const 6)))))
  (local.set $bh (call $btnh))
  (local.set $bw (call $imax (local.get $mt) (i32.add (call $tw (local.get $lab)) (i32.mul (local.get $g) (i32.const 6)))))
  ;; it lives in the farm view (screens: anywhere), so it never covers the top bar, tabs or sheet
  (local.set $ax (call $lay_x (global.get $LR_GRID))) (local.set $ay (call $lay_y (global.get $LR_GRID)))
  (local.set $aw (call $lay_w (global.get $LR_GRID))) (local.set $ah (call $lay_h (global.get $LR_GRID)))
  (if (global.get $scr) (then (local.set $ax (i32.const 0)) (local.set $ay (i32.const 0)) (local.set $aw (global.get $fb_w)) (local.set $ah (global.get $fb_h))))
  (local.set $cw (call $imin (i32.sub (local.get $aw) (i32.shl (local.get $g) (i32.const 1))) (call $S (i32.const 440))))
  (local.set $txw (i32.sub (local.get $cw) (i32.add (local.get $bw) (i32.mul (local.get $g) (i32.const 6)))))
  (local.set $sl (select (i32.add (call $lh) (i32.add (local.get $g) (i32.const 3))) (i32.const 0) (i32.le_u (global.get $tut) (i32.const 6))))
  (global.set $nodraw (i32.const 1))
  (local.set $hh (i32.sub (call $ui_wrap (i32.const 0) (i32.const 0) (local.get $txw) (global.get $TBUF) (i32.const 0)) (i32.const 3)))
  (global.set $nodraw (i32.const 0))
  (local.set $ch (i32.add (call $imax (local.get $bh) (i32.add (local.get $sl) (local.get $hh))) (i32.shl (local.get $g) (i32.const 2))))
  ;; above or below the target (tail k px), on the side with more room in the area; centred on it
  (local.set $k (i32.div_u (local.get $mt) (i32.const 6)))
  (local.set $top (i32.add (local.get $ay) (local.get $g)))
  (local.set $bot (i32.sub (i32.add (local.get $ay) (local.get $ah)) (local.get $g)))
  ;; (a farm view too short for it: anywhere under the top bar)
  (if (i32.gt_s (local.get $ch) (i32.sub (local.get $bot) (local.get $top))) (then
    (local.set $top (i32.add (local.get $top) (i32.sub (i32.add (call $lay_y (global.get $LR_TOPBAR)) (call $lay_h (global.get $LR_TOPBAR))) (local.get $ay))))
    (local.set $bot (i32.sub (global.get $fb_h) (local.get $g)))))
  (global.set $tc_y (i32.add (local.get $ay) (i32.shr_s (i32.sub (local.get $ah) (local.get $ch)) (i32.const 1))))
  (global.set $tc_x (i32.add (local.get $ax) (i32.shr_s (i32.sub (local.get $aw) (local.get $cw)) (i32.const 1))))
  (if (local.get $found) (then
    (global.set $tc_x (i32.sub (i32.add (global.get $tg_x) (i32.shr_s (global.get $tg_w) (i32.const 1))) (i32.shr_s (local.get $cw) (i32.const 1))))
    (local.set $hy0 (i32.sub (global.get $tg_y) (i32.add (local.get $ph) (local.get $k))))
    (local.set $hy1 (i32.add (i32.add (global.get $tg_y) (global.get $tg_h)) (i32.add (local.get $ph) (local.get $k))))
    ;; (on a screen: below its button when there is room, off the screen's text)
    (local.set $dir (select (i32.const 1) (i32.const -1) (i32.ge_s (i32.sub (local.get $hy0) (local.get $top))
      (select (i32.const 0x7FFF) (i32.sub (local.get $bot) (local.get $hy1)) (i32.and (i32.ne (global.get $scr) (i32.const 0)) (i32.le_s (i32.add (local.get $hy1) (local.get $ch)) (local.get $bot)))))))
    (global.set $tc_y (select (i32.sub (local.get $hy0) (local.get $ch)) (local.get $hy1) (i32.eq (local.get $dir) (i32.const 1))))
    ;; (a target right of the farm view, the laptop panel: no tail)
    (if (i32.ge_s (global.get $tg_x) (i32.add (local.get $ax) (local.get $aw))) (then (local.set $dir (i32.const 0))))))
  (global.set $tc_y (call $clamp (global.get $tc_y) (local.get $top) (i32.sub (local.get $bot) (local.get $ch))))
  (global.set $tc_x (call $clamp (global.get $tc_x) (i32.add (local.get $ax) (local.get $g)) (i32.sub (i32.sub (i32.add (local.get $ax) (local.get $aw)) (local.get $g)) (local.get $cw))))
  (global.set $tc_w (local.get $cw)) (global.set $tc_h (local.get $ch))
  (drop (call $hit_add (global.get $tc_x) (global.get $tc_y) (local.get $cw) (local.get $ch) (i32.const 0x3DD)))
  ;; drop shadow, paper card, tail toward the target
  (call $rrect (i32.add (global.get $tc_x) (i32.const 2)) (i32.add (global.get $tc_y) (i32.const 3)) (local.get $cw) (local.get $ch) (i32.const 3) (call $pal (i32.const 60)))
  (call $ui_panel (global.get $tc_x) (global.get $tc_y) (local.get $cw) (local.get $ch))
  (if (local.get $dir) (then
    (call $tail (call $clamp (i32.add (global.get $tg_x) (i32.shr_s (global.get $tg_w) (i32.const 1)))
        (i32.add (global.get $tc_x) (i32.add (local.get $k) (i32.const 4))) (i32.sub (i32.add (global.get $tc_x) (local.get $cw)) (i32.add (local.get $k) (i32.const 4))))
      (select (i32.sub (i32.add (global.get $tc_y) (local.get $ch)) (i32.const 1)) (global.get $tc_y) (i32.eq (local.get $dir) (i32.const 1)))
      (local.get $k) (local.get $dir))))
  ;; a wheat-gold edge on the left marks the card as the guide's
  (call $rect (i32.add (global.get $tc_x) (i32.const 1)) (i32.add (global.get $tc_y) (i32.const 3)) (i32.const 3) (i32.sub (local.get $ch) (i32.const 6)) (call $pal (i32.const 18)))
  (local.set $y (i32.add (global.get $tc_y) (i32.add (i32.shl (local.get $g) (i32.const 1)) (i32.shr_s (i32.sub (i32.sub (local.get $ch) (i32.shl (local.get $g) (i32.const 2))) (i32.add (local.get $sl) (local.get $hh))) (i32.const 1)))))
  (if (local.get $sl) (then
    (drop (call $txt (i32.add (global.get $tc_x) (i32.mul (local.get $g) (i32.const 3))) (local.get $y) (i32.add (global.get $TBUF) (i32.const 64)) (call $pal (i32.const 63))))))
  (drop (call $ui_wrap (i32.add (global.get $tc_x) (i32.mul (local.get $g) (i32.const 3))) (i32.add (local.get $y) (local.get $sl)) (local.get $txw) (global.get $TBUF) (call $pal (i32.const 60))))
  (call $btn (i32.const 0x3DC) (i32.sub (i32.add (global.get $tc_x) (local.get $cw)) (i32.add (local.get $bw) (i32.shl (local.get $g) (i32.const 1))))
    (i32.add (global.get $tc_y) (i32.shr_s (i32.sub (local.get $ch) (local.get $bh)) (i32.const 1))) (local.get $bw) (local.get $bh)
    (local.get $lab) (select (global.get $I_CHECK) (i32.const -1) (i32.eq (global.get $tut) (i32.const 7))) (select (i32.const 2) (i32.const 0) (i32.eq (global.get $tut) (i32.const 7))) (i32.const 1))
  (global.set $tscale (call $ui_ts)))

;; ---------------------------------------------------------------- taps, prefs

;; SKIP / DONE, the card, REPLAY TUTORIAL; 1 when the tap was one of them.
(func $tut_tap (param $c i32) (result i32)
  (if (i32.eq (local.get $c) (i32.const 0x3DC)) (then
    (global.set $tut (i32.const 0)) (global.set $tut_done (i32.const 1)) (global.set $dirty (i32.const 1))
    (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 0x3DE)) (then
    (global.set $tut_done (i32.const 0))
    (call $back)
    (if (i32.eq (global.get $scr) (i32.const 1)) (then (call $ovl_tap (i32.sub (i32.const 0x3C1) (global.get $has_save)))))
    (call $tut_go (i32.const 1))
    (return (i32.const 1))))
  (i32.eq (local.get $c) (i32.const 0x3DD)))

;; set_pref(4, s): the step (0 off, 1..7); test hook and REPLAY state.
(func $tut_set (param $v i32)
  (if (local.get $v) (then (call $tut_go (call $clamp (local.get $v) (i32.const 1) (i32.const 7)))) (else (global.set $tut (i32.const 0))))
  (global.set $dirty (i32.const 1)))

;; Test hook: t_tut(k) = 0 step 1 done 2 facts 3..6 target rect 7..10 card rect 11 hint 12 target code
;; 13 hint text ptr 14 step line ptr (rects as last drawn; w = 0 when none).
(func $t_tut (param $k i32) (result i32)
  (block $x (block $14 (block $13 (block $12 (block $11 (block $10 (block $9 (block $8 (block $7 (block $6 (block $5 (block $4 (block $3 (block $2 (block $1 (block $0
    (br_table $0 $1 $2 $3 $4 $5 $6 $7 $8 $9 $10 $11 $12 $13 $14 $x (local.get $k)))
    (return (global.get $tut)))
    (return (global.get $tut_done)))
    (return (global.get $tf)))
    (return (global.get $tg_x)))
    (return (global.get $tg_y)))
    (return (global.get $tg_w)))
    (return (global.get $tg_h)))
    (return (global.get $tc_x)))
    (return (global.get $tc_y)))
    (return (global.get $tc_w)))
    (return (global.get $tc_h)))
    (return (global.get $thint)))
    (return (global.get $tcode)))
    (return (global.get $TBUF)))
    (return (i32.add (global.get $TBUF) (i32.const 64))))
  (i32.const -1))
