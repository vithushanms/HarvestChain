;; Farm screen (plan Task 5a): top bar, tab bar, the tile sheet (bottom sheet in portrait /
;; tablet, side panel in laptop) and the player actions behind them. Every action goes through
;; $act / $end_day; errors toast their mapped string (and shake the sheet), successes are
;; announced. Drawing helpers are in 22_ui.wat.
;;
;; Sheet content by plot: next-ring wild land -> BUY LAND; other wild land -> why not; empty
;; plot -> PLANT / BUILD toggle + crop picker (5) or build picker (10, scrolls); crop (or a planted
;; Greenhouse) -> growth bar, ripe / rot state, yield + storage, HARVEST, CLEAR (two taps);
;; building -> upkeep, recipe selector (processors), capacity / cellar aging / role, UPGRADE,
;; DEMOLISH (two taps within 3 s); an empty Greenhouse adds its all-season crop picker.
;; Laptop with nothing selected: storage, ripe count, hints; the header shows the hovered plot.
;;
;; Dynamic hit codes (HIT_PANEL_BASE block): 0x200 PICK_PLANT  0x201 PICK_BUILD  0x202 HARVEST
;;   0x203 DEMOLISH  0x204 UPGRADE  0x205 RECIPE_PREV  0x206 RECIPE_NEXT  0x207 BUY_LAND
;;   0x210 + crop PLANT   0x220 + building BUILD.   Top bar: HIT_HARVALL (2) when a crop is ripe.

(global $ux (mut i32) (i32.const 0))           ;; sheet content cursor: x, y, width, column
(global $uy (mut i32) (i32.const 0))
(global $uw (mut i32) (i32.const 0))
(global $ucol (mut i32) (i32.const 0))
(data (i32.const 0x930) "\13\14\15\0a\16")     ;; tab icons: house, gear, stall, truck, hammer

;; ---------------------------------------------------------------- farm queries

(func $crop_count (result i32)
  (local $i i32) (local $n i32)
  (loop $l
    (if (call $in_grid (local.get $i)) (then
      (local.set $n (i32.add (local.get $n) (i32.ge_s (call $tile_crop (call $tile_ptr (local.get $i))) (i32.const 0))))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (local.get $n))
(func $ripe_count (result i32)
  (local $i i32) (local $n i32)
  (loop $l
    (if (call $in_grid (local.get $i)) (then
      (local.set $n (i32.add (local.get $n) (call $tile_ripe (call $tile_ptr (local.get $i)))))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (local.get $n))

;; Storage units that will spoil tonight (estimate for the End Day summary): $rot per good,
;; skipping goods a processor is set to consume (it eats the oldest units first), so this never
;; over-reports.
(func $spoil_est (result i32)
  (local $i i32) (local $p i32) (local $mask i32) (local $g i32) (local $n i32)
  (loop $t
    (local.set $p (call $tile_ptr (local.get $i)))
    (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)) (i32.ne (i32.load8_u offset=7 (local.get $p)) (i32.const 0)))
      (then (local.set $mask (i32.or (local.get $mask)
        (i32.shl (i32.const 1) (call $bal (global.get $T_RECIPE) (call $imin (i32.sub (i32.load8_u offset=7 (local.get $p)) (i32.const 1)) (i32.const 7)) (i32.const 1)))))))
    (br_if $t (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (loop $gl
    (if (i32.eqz (i32.and (local.get $mask) (i32.shl (i32.const 1) (local.get $g))))
      (then (local.set $n (i32.add (local.get $n) (call $rot (local.get $g))))))
    (br_if $gl (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS))))
  (local.get $n))

;; Harvest units for crop c (bumper harvest event included), as $harvest_tile computes them.
(func $yield (param $c i32) (result i32)
  (local $u i32)
  (local.set $u (call $bal (global.get $T_CROP) (local.get $c) (i32.const 2)))
  (if (call $event_active (global.get $EV_BUMPER))
    (then (local.set $u (i32.div_u (i32.mul (local.get $u) (call $k (global.get $K_BUMPER_BP))) (i32.const 10000)))))
  (local.get $u))

;; String id naming what stands on the tile (crop, building or EMPTY PLOT).
(func $tile_name (param $p i32) (result i32)
  (if (i32.ge_s (call $tile_crop (local.get $p)) (i32.const 0))
    (then (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 1))
      (then (return (i32.add (global.get $STR_GOOD) (call $tile_crop (local.get $p))))))))
  (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
    (then (return (i32.add (global.get $STR_BLD) (call $clamp (i32.load8_u offset=1 (local.get $p)) (i32.const 0) (i32.const 9))))))
  (global.get $STR_EMPTY))

;; "PLOT x,y" (1-based) into the current builder.
(func $s_plot (param $i i32)
  (call $si (global.get $STR_PLOT))
  (call $sn0 (i32.add (i32.and (local.get $i) (i32.const 7)) (i32.const 1)))
  (call $sc (i32.const 44))
  (call $sn0 (i32.add (i32.shr_u (local.get $i) (i32.const 3)) (i32.const 1))))

;; One-line tile status into SB3 ("PLOT 2,1: WHEAT, 1 DAYS" / "... RIPE" / "WILD LAND" ...).
(func $tile_info (param $i i32)
  (local $p i32) (local $c i32)
  (local.set $p (call $tile_ptr (local.get $i)))
  (call $sb (global.get $SB3))
  (call $s_plot (local.get $i))
  (call $sc (i32.const 58)) (call $sc (i32.const 32))
  (if (i32.eqz (call $in_grid (local.get $i))) (then (call $si (global.get $STR_WILD)) (return)))
  (call $si (call $tile_name (local.get $p)))
  (local.set $c (call $tile_crop (local.get $p)))
  (if (i32.ge_s (local.get $c) (i32.const 0)) (then
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
      (then (call $sc (i32.const 32)) (call $si (i32.add (global.get $STR_GOOD) (local.get $c)))))
    (if (call $tile_ripe (local.get $p))
      (then (call $sc (i32.const 32)) (call $si (global.get $STR_RIPE)))
      (else (call $sep) (call $s_days (call $days_left (local.get $p) (local.get $c))))))))

(func $days_left (param $p i32) (param $c i32) (result i32)
  (i32.div_s (i32.add (i32.sub (call $grow_target (local.get $p) (local.get $c)) (i32.load16_u offset=2 (local.get $p))) (i32.const 99)) (i32.const 100)))

;; Recipe row r as "2 WHEAT > 1 FLOUR" into the current builder.
(func $s_recipe (param $r i32)
  (call $sn0 (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 2)))
  (call $sc (i32.const 32))
  (call $si (i32.add (global.get $STR_GOOD) (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 1))))
  (call $sc (i32.const 32)) (call $sc (i32.const 62)) (call $sc (i32.const 32)) (call $sc (i32.const 49)) (call $sc (i32.const 32))
  (call $si (i32.add (global.get $STR_GOOD) (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 3)))))

;; Next (dir 1) / previous (dir 0) recipe setting of the building on tile p, cycling OFF and the
;; rows of its building; returns the SET_RECIPE argument (row, or 255 = off).
(func $next_recipe (param $p i32) (param $dir i32) (result i32)
  (local $v i32)
  (local.set $v (i32.load8_u offset=7 (local.get $p)))
  (loop $l
    (local.set $v (i32.rem_u (i32.add (local.get $v) (select (i32.const 1) (i32.const 8) (local.get $dir))) (i32.const 9)))
    (br_if $l (i32.and (i32.ne (local.get $v) (i32.const 0))
      (i32.ne (call $bal (global.get $T_RECIPE) (i32.sub (local.get $v) (i32.const 1)) (i32.const 0)) (i32.load8_u offset=1 (local.get $p))))))
  (select (i32.sub (local.get $v) (i32.const 1)) (i32.const 255) (local.get $v)))

;; Why building b is locked ("NEEDS MILL" / "NEEDS *3" / "FROM DAY 41") in SB3.
(func $lock_reason (param $b i32) (result i32)
  (local $k i32) (local $a i32)
  (local.set $k (call $bal (global.get $T_BLD) (local.get $b) (i32.const 4)))
  (local.set $a (call $bal (global.get $T_BLD) (local.get $b) (i32.const 5)))
  (call $sb (global.get $SB3))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (call $si (global.get $STR_NEEDS)) (call $si (i32.add (global.get $STR_BLD) (local.get $a)))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (call $si (global.get $STR_NEEDS_STAR)) (call $sn0 (local.get $a))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (call $si (global.get $STR_FROM_DAY)) (call $sn0 (local.get $a))))
  (global.get $SB3))

;; ---------------------------------------------------------------- actions

(func $fail_s (param $s i32)
  (call $toast (i32.const 2) (local.get $s))
  (global.set $shake_t (select (i32.const -2) (i32.const -1) (global.get $flag_reduced))))
(func $fail (param $e i32) (call $fail_s (call $err_str (local.get $e))))

(func $select (param $i i32) (param $open i32)
  (if (i32.ne (local.get $i) (global.get $sel_tile)) (then
    (global.set $scroll (i32.const 0)) (global.set $pick (i32.const 0)) (global.set $arm (i32.const 0))))
  (global.set $sel_tile (local.get $i))
  (if (i32.eqz (global.get $place)) (then (global.set $tab (i32.const 0)) (global.set $dsp (i32.const -1))))
  (call $tile_info (local.get $i))
  (call $announce (global.get $SB3))
  (if (local.get $open) (then (call $open_sheet)))
  (global.set $dirty (i32.const 1)))

(func $close
  ;; (an open screen goes back instead: the close button, a sheet drag-dismiss)
  (if (global.get $scr) (then (call $back) (return)))
  (global.set $sel_tile (i32.const -1)) (global.set $sheet (i32.const 0)) (global.set $scroll (i32.const 0))
  (global.set $arm (i32.const 0)) (global.set $pick (i32.const 0))
  (global.set $tab (i32.const 0)) (global.set $place (i32.const 0)) (global.set $dsp (i32.const -1))
  (call $layout_panel (i32.const 0))
  (global.set $dirty (i32.const 1)))

(func $tap (param $c i32)
  (local $t i32)
  (if (i32.or (global.get $scr) (i32.ge_u (local.get $c) (i32.const 0x3C0))) (then (call $ovl_tap (local.get $c)) (return)))
  (if (i32.eq (local.get $c) (global.get $HIT_ENDDAY)) (then (call $do_endday) (return)))
  (if (i32.eq (local.get $c) (global.get $HIT_HARVALL)) (then (call $do_harvest_all) (return)))
  (if (i32.eq (local.get $c) (global.get $HIT_CLOSE)) (then (call $close) (return)))
  (if (i32.eq (local.get $c) (global.get $HIT_DAY)) (then (call $open (i32.const 2)) (return)))   ;; the Gazette
  (if (i32.lt_u (i32.sub (local.get $c) (global.get $HIT_TAB0)) (i32.const 5)) (then (call $set_tab (i32.sub (local.get $c) (global.get $HIT_TAB0))) (return)))
  (if (i32.eq (local.get $c) (global.get $HIT_GRID)) (then
    (local.set $t (call $tile_at (global.get $in_lx) (global.get $in_ly)))
    (if (global.get $place) (then (call $place_at (local.get $t)) (return)))
    (if (i32.or (i32.lt_s (local.get $t) (i32.const 0))
                (i32.and (i32.eq (local.get $t) (global.get $sel_tile)) (global.get $sheet)))
      (then (call $close))
      (else (call $select (local.get $t) (i32.const 1))))
    (return)))
  (if (i32.ge_u (local.get $c) (i32.const 0x200)) (then (call $panel_btn (local.get $c)))))

(func $wx (param $o i32) (result i32)
  (call $clamp (i32.load8_u (i32.add (global.get $S_WEATHER) (local.get $o))) (i32.const 0) (i32.const 5)))

(func $do_endday
  (local $c0 i32) (local $n0 i32) (local $sp i32) (local $e i32) (local $v i32)
  (local.set $c0 (i32.load (global.get $S_CASH)))
  (local.set $n0 (call $crop_count))
  (local.set $sp (call $spoil_est))
  (local.set $e (call $end_day))
  (if (local.get $e) (then (call $fail (local.get $e)) (return)))
  (global.set $want_save (i32.const 1))
  (global.set $arm (i32.const 0))
  (call $sb (global.get $SB3))
  (call $si (global.get $STR_DAY)) (call $sn0 (i32.load16_u (global.get $S_DAY))) (call $sc (i32.const 32))
  (local.set $v (i32.sub (i32.load (global.get $S_CASH)) (local.get $c0)))
  (if (i32.ge_s (local.get $v) (i32.const 0)) (then (call $sc (i32.const 43))))
  (call $sn (local.get $v) (i32.const 1))
  (local.set $v (call $ripe_count))
  (if (local.get $v) (then (call $sep) (call $sn0 (local.get $v)) (call $si (global.get $STR_NOW_RIPE))))
  (local.set $v (i32.sub (local.get $n0) (call $crop_count)))
  (if (i32.gt_s (local.get $v) (i32.const 0)) (then (call $sep) (call $sn0 (local.get $v)) (call $si (global.get $STR_LOST))))
  (if (local.get $sp) (then (call $sep) (call $sn0 (local.get $sp)) (call $si (global.get $STR_SPOILED))))
  (call $toast (i32.const 1) (global.get $SB3))
  (memory.copy (global.get $SUMMARY) (global.get $SB3) (i32.const 56))   ;; the Gazette's first line
  (call $after_end))

(func $do_harvest_all
  (local $n0 i32) (local $h i32) (local $e i32)
  (local.set $n0 (call $ripe_count))
  (if (i32.eqz (local.get $n0)) (then (call $fail_s (call $str (global.get $STR_NO_RIPE))) (return)))
  (local.set $e (call $act (i32.const 3) (i32.const 0) (i32.const 0) (i32.const 0)))
  (if (local.get $e) (then (call $fail (local.get $e)) (return)))
  (local.set $h (i32.sub (local.get $n0) (call $ripe_count)))
  (if (i32.eqz (local.get $h)) (then (call $fail (global.get $E_STORAGE_FULL)) (return)))
  (global.set $want_save (i32.const 1))
  (call $sb (global.get $SB3))
  (call $si (global.get $STR_HARVESTED)) (call $sn0 (local.get $h)) (call $si (global.get $STR_PLOTS))
  (if (i32.lt_u (local.get $h) (local.get $n0)) (then (call $sep) (call $si (i32.add (global.get $STR_ERR) (global.get $E_STORAGE_FULL)))))
  (call $toast (i32.const 3) (global.get $SB3)))

;; A sheet button. Disabled buttons toast their reason; DEMOLISH arms on the first tap.
(func $panel_btn (param $c i32)
  (local $r i32) (local $e i32) (local $i i32) (local $p i32) (local $verb i32) (local $name i32) (local $a i32)
  (local.set $r (call $btn_find (local.get $c)))
  (if (i32.and (i32.ne (local.get $r) (i32.const 0)) (i32.eqz (i32.load offset=4 (local.get $r)))) (then
    (call $fail_s (select (i32.add (local.get $r) (i32.const 36)) (i32.add (local.get $r) (i32.const 8))
      (i32.load8_u offset=36 (local.get $r))))
    (return)))
  (if (call $tab_btn (local.get $c)) (then (return)))
  (local.set $i (global.get $sel_tile))
  ;; Process tab recipe arrows 0x340 / 0x380 + tile act on that tile like the sheet's 0x205 / 0x206
  (if (i32.ge_u (local.get $c) (i32.const 0x340)) (then
    (local.set $i (i32.and (local.get $c) (i32.const 63)))
    (local.set $c (i32.add (i32.const 0x205) (i32.ge_u (local.get $c) (i32.const 0x380))))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x200)) (i32.const 2)) (then
    (global.set $pick (i32.sub (local.get $c) (i32.const 0x200)))
    (global.set $scroll (i32.const 0)) (global.set $dirty (i32.const 1))
    (return)))
  (if (i32.eq (local.get $c) (i32.const 0x203)) (then (if (i32.eqz (call $armed (local.get $c))) (then (return)))))
  (global.set $arm (i32.const 0))
  (if (i32.and (i32.lt_s (local.get $i) (i32.const 0)) (i32.ne (local.get $c) (i32.const 0x207))) (then (return)))
  (local.set $p (call $tile_ptr (local.get $i)))
  (local.set $name (call $tile_name (local.get $p)))
  (local.set $e (global.get $E_BAD_ARG))
  (if (i32.eq (local.get $c) (i32.const 0x202)) (then
    ;; name the crop BEFORE acting: a harvested Greenhouse forgets its crop
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)) (then (local.set $name (i32.add (global.get $STR_GOOD) (call $tile_crop (local.get $p))))))
    (local.set $e (call $act (i32.const 2) (local.get $i) (i32.const 0) (i32.const 0))) (local.set $verb (global.get $STR_HARVESTED))))
  (if (i32.eq (local.get $c) (i32.const 0x203)) (then
    (local.set $e (call $act (i32.const 5) (local.get $i) (i32.const 0) (i32.const 0))) (local.set $verb (global.get $STR_CLEARED))))
  (if (i32.eq (local.get $c) (i32.const 0x204)) (then
    (local.set $e (call $act (i32.const 6) (local.get $i) (i32.const 0) (i32.const 0))) (local.set $verb (global.get $STR_UPGRADED))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x210)) (i32.const 5)) (then
    (local.set $a (i32.sub (local.get $c) (i32.const 0x210)))
    (local.set $e (call $act (i32.const 1) (local.get $i) (local.get $a) (i32.const 0)))
    (local.set $verb (global.get $STR_PLANTED)) (local.set $name (i32.add (global.get $STR_GOOD) (local.get $a)))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x220)) (i32.const 10)) (then
    (local.set $a (i32.sub (local.get $c) (i32.const 0x220)))
    (local.set $e (call $act (i32.const 4) (local.get $i) (local.get $a) (i32.const 0)))
    (if (i32.eq (local.get $e) (global.get $E_LOCKED)) (then (call $fail_s (call $lock_reason (local.get $a))) (return)))
    (local.set $verb (global.get $STR_BUILT)) (local.set $name (i32.add (global.get $STR_BLD) (local.get $a)))))
  (call $sb (global.get $SB3))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x205)) (i32.const 2)) (then
    (local.set $a (call $next_recipe (local.get $p) (i32.sub (local.get $c) (i32.const 0x205))))
    (local.set $e (call $act (i32.const 7) (local.get $i) (local.get $a) (i32.const 0)))
    (call $si (global.get $STR_RECIPE)) (call $sc (i32.const 58)) (call $sc (i32.const 32))
    (if (i32.eq (local.get $a) (i32.const 255)) (then (call $si (global.get $STR_OFF))) (else (call $s_recipe (local.get $a))))))
  (if (i32.eq (local.get $c) (i32.const 0x207)) (then
    (local.set $e (call $act (i32.const 8) (i32.const 0) (i32.const 0) (i32.const 0)))
    (if (i32.eqz (local.get $e)) (then
      ;; no explicit refit (ruling C6): $scene_fit reads the grid size on every draw / hit test
      (call $si (global.get $STR_LAND_BOUGHT)) (call $s_farm_size (i32.load8_u (global.get $S_GRID)))))))
  (if (local.get $e) (then (call $fail (local.get $e)) (return)))
  (global.set $want_save (i32.const 1))
  (global.set $dirty (i32.const 1))
  (if (local.get $verb) (then (call $si (local.get $verb)) (call $si (local.get $name))))
  (call $announce (global.get $SB3)))

;; Two-step button c: 1 when this tap confirms it. The confirming tap counts only 400 ms after
;; arming (no accidental double tap); the first tap, or one after the 3 s window (frames may not
;; have run), arms it.
(func $armed (param $c i32) (result i32)
  (if (i32.and (i32.eq (global.get $arm) (local.get $c)) (i32.eqz (call $arm_live))) (then (return (i32.const 0))))
  (if (i32.or (i32.ne (global.get $arm) (local.get $c)) (i32.ge_s (call $since (global.get $arm_t)) (i32.const 3000))) (then
    (global.set $arm (local.get $c)) (global.set $arm_t (i32.const -1)) (global.set $arm_lv (i32.const 0))
    (call $announce (call $str (global.get $STR_TAP_AGAIN)))
    (global.set $dirty (i32.const 1))
    (return (i32.const 0))))
  (global.set $arm (i32.const 0))
  (i32.const 1))

;; "FARM 5X5" into the current builder.
(func $s_farm_size (param $g i32)
  (call $si (global.get $STR_FARM_SIZE)) (call $sn0 (local.get $g))
  (call $si (global.get $STR_X)) (call $sn0 (local.get $g)))

;; ---------------------------------------------------------------- top bar and tabs

;; Fill layout rect id with palette colour c.
(func $rect_r (param $id i32) (param $c i32)
  (call $rect (call $lay_x (local.get $id)) (call $lay_y (local.get $id)) (call $lay_w (local.get $id)) (call $lay_h (local.get $id)) (call $pal (local.get $c))))

;; Top-bar info card (rect id): line 1 = [icon] s1 (colour c1), line 2 = s2 (secondary) or, with
;; s2 = 0, the weather row (season, today, arrow, forecast). Falls back to one line / scale 1.
(func $card (param $id i32) (param $icon i32) (param $s1 i32) (param $c1 i32) (param $s2 i32) (param $pr i32)
  (local $x i32) (local $y i32) (local $w i32) (local $h i32) (local $lw i32) (local $two i32) (local $ty i32) (local $s i32) (local $tx i32)
  (local.set $x (call $lay_x (local.get $id))) (local.set $y (call $lay_y (local.get $id)))
  (local.set $w (call $lay_w (local.get $id))) (local.set $h (call $lay_h (local.get $id)))
  (if (i32.eqz (local.get $w)) (then (return)))
  (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 3) (call $pal (i32.const 60)))
  (call $rrect (i32.add (local.get $x) (i32.const 1)) (i32.add (i32.add (local.get $y) (i32.const 1)) (local.get $pr))
    (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.add (i32.const 2) (select (i32.const 2) (i32.const 0) (local.get $pr)))) (i32.const 2)
    (call $pal (select (i32.const 58) (i32.const 59) (local.get $pr))))
  (local.set $y (i32.add (local.get $y) (local.get $pr)))
  (global.set $tscale (call $ui_ts))
  (block $fits (loop $try
    (local.set $s (global.get $tscale))
    (local.set $lw (i32.add (call $tw (local.get $s1)) (select (i32.add (i32.mul (i32.const 9) (local.get $s)) (i32.const 3)) (i32.const 0) (i32.ge_s (local.get $icon) (i32.const 0)))))
    (br_if $fits (i32.or (i32.le_s (local.get $lw) (i32.sub (local.get $w) (i32.const 6))) (i32.eq (local.get $s) (i32.const 1))))
    (global.set $tscale (i32.const 1))
    (br $try)))
  (local.set $two (i32.ge_s (local.get $h) (i32.add (i32.mul (call $lh) (i32.const 2)) (i32.const 8))))
  (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (i32.add (i32.mul (call $lh) (i32.add (local.get $two) (i32.const 1))) (i32.mul (local.get $two) (i32.const 4)))) (i32.const 1))))
  (local.set $tx (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (select (local.get $lw)
    (i32.add (local.get $lw) (i32.add (i32.mul (i32.const 40) (local.get $s)) (i32.const 3))) (i32.or (local.get $two) (i32.ne (local.get $s2) (i32.const 0))))) (i32.const 1))))
  (if (i32.ge_s (local.get $icon) (i32.const 0)) (then
    (call $ui_icon (local.get $icon) (local.get $tx) (i32.sub (local.get $ty) (local.get $s)) (local.get $s))
    (local.set $tx (i32.add (local.get $tx) (i32.add (i32.mul (i32.const 9) (local.get $s)) (i32.const 3))))))
  (local.set $tx (i32.add (local.get $tx) (call $txt (local.get $tx) (local.get $ty) (local.get $s1) (call $pal (local.get $c1)))))
  (if (local.get $two) (then
    (local.set $ty (i32.add (i32.add (local.get $ty) (call $lh)) (i32.const 4)))
    (local.set $tx (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w)
      (select (call $tw (local.get $s2)) (i32.add (i32.mul (i32.const 40) (local.get $s)) (i32.const 0)) (local.get $s2))) (i32.const 1)))))
    (else (local.set $tx (i32.add (local.get $tx) (i32.add (local.get $s) (i32.const 3))))))
  (if (local.get $s2)
    (then (if (local.get $two) (then
      ;; the second line fits on its own (it may drop to scale 1 while line 1 stays large)
      (call $fit (local.get $s2) (i32.sub (local.get $w) (i32.const 6)))
      (drop (call $txt (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (call $tw (local.get $s2))) (i32.const 1)))
        (i32.add (local.get $ty) (i32.sub (local.get $s) (global.get $tscale))) (local.get $s2) (call $pal (i32.const 63)))))))
    (else
      ;; season, today's weather, arrow, forecast: 4 icons of 9s + gaps = 40s
      (call $ui_icon (i32.load8_u (i32.add (i32.const 0x923) (call $season))) (local.get $tx) (i32.sub (local.get $ty) (local.get $s)) (local.get $s))
      (call $ui_icon (i32.add (global.get $I_SUN) (call $wx (i32.const 0))) (i32.add (local.get $tx) (i32.mul (i32.const 11) (local.get $s))) (i32.sub (local.get $ty) (local.get $s)) (local.get $s))
      (call $ui_icon (global.get $I_ARROW_R) (i32.add (local.get $tx) (i32.mul (i32.const 20) (local.get $s))) (i32.sub (local.get $ty) (local.get $s)) (local.get $s))
      (call $ui_icon (i32.add (global.get $I_SUN) (call $wx (i32.const 2))) (i32.add (local.get $tx) (i32.mul (i32.const 31) (local.get $s))) (i32.sub (local.get $ty) (local.get $s)) (local.get $s))))
  (global.set $tscale (call $ui_ts)))

(func $draw_top
  (local $n i32) (local $c i32)
  (call $rect_r (global.get $LR_TOPBAR) (i32.const 61))
  (call $hline (i32.const 0) (i32.sub (call $lay_h (global.get $LR_TOPBAR)) (i32.const 1)) (call $lay_w (global.get $LR_TOPBAR)) (call $pal (i32.const 60)))
  (call $sb (global.get $SB0))
  (call $si (global.get $STR_DAY)) (call $sn0 (i32.load16_u (global.get $S_DAY)))
  (call $card (global.get $LR_DAYBOX) (i32.const -1) (global.get $SB0) (i32.const 61) (i32.const 0)
    (i32.eq (global.get $press) (global.get $HIT_DAY)))
  (local.set $c (i32.load (global.get $S_CASH)))
  (call $sb (global.get $SB0)) (call $sn (local.get $c) (i32.const 1))
  (call $card (i32.const 2) (global.get $I_COIN) (global.get $SB0) (select (i32.const 37) (i32.const 61) (i32.lt_s (local.get $c) (i32.const 0)))
    (call $str (global.get $STR_CASH)) (i32.const 0))
  (call $sb (global.get $SB0)) (call $sn0 (call $rank))
  (call $sb (global.get $SB1)) (call $sn0 (i32.load8_u (global.get $S_REP))) (call $si (global.get $STR_PTS))
  (call $card (i32.const 3) (global.get $I_STAR) (global.get $SB0) (i32.const 61) (global.get $SB1) (i32.const 0))
  (local.set $n (call $ripe_count))
  (if (local.get $n) (then
    (call $btn_r (global.get $HIT_HARVALL) (global.get $LR_HARVALL) (call $str (global.get $STR_HARVEST)) (global.get $I_BASKET) (i32.const 2) (i32.const 1))
    (call $ui_badge (i32.add (call $lay_x (global.get $LR_HARVALL)) (call $lay_w (global.get $LR_HARVALL)))
      (i32.sub (call $lay_y (global.get $LR_HARVALL)) (i32.const 1)) (local.get $n))))
  (call $btn_r (global.get $HIT_ENDDAY) (global.get $LR_ENDDAY) (call $str (global.get $STR_END_DAY)) (global.get $I_MOON) (i32.const 1)
    (i32.ne (i32.and (i32.load8_u (global.get $S_STATUS)) (i32.const 1)) (i32.const 1))))
;; $btn over layout rect id.
(func $btn_r (param $code i32) (param $id i32) (param $label i32) (param $icon i32) (param $style i32) (param $en i32)
  (call $btn (local.get $code) (call $lay_x (local.get $id)) (call $lay_y (local.get $id)) (call $lay_w (local.get $id)) (call $lay_h (local.get $id))
    (local.get $label) (local.get $icon) (local.get $style) (local.get $en)))

;; Five tabs (icon + label); the current one ($tab) is raised with a barn-red top edge.
(func $draw_tabs
  (local $i i32) (local $x i32) (local $y i32) (local $w i32) (local $h i32) (local $s i32) (local $ic i32) (local $font i32)
  (local $lw i32) (local $ty i32) (local $is i32)
  (if (i32.eqz (call $lay_w (global.get $LR_TABS))) (then (return)))
  (call $rect_r (global.get $LR_TABS) (i32.const 57))
  (call $hline (call $lay_x (global.get $LR_TABS)) (call $lay_y (global.get $LR_TABS)) (call $lay_w (global.get $LR_TABS)) (call $pal (i32.const 61)))
  ;; one text scale / font for all five labels: the UI scale, scale 1, or the 3x5 badge font,
  ;; whichever fits the narrowest tab ("PROCESS" is the longest label)
  (local.set $w (call $lay_w (global.get $LR_TAB0)))
  (local.set $h (call $lay_h (global.get $LR_TAB0)))
  (local.set $s (call $str (i32.add (global.get $STR_TAB) (i32.const 1))))
  (global.set $tscale (call $ui_ts))
  (if (i32.or (i32.gt_s (i32.add (i32.mul (i32.const 16) (global.get $tscale)) (i32.const 6)) (local.get $h))
              (i32.gt_s (call $tw (local.get $s)) (i32.sub (local.get $w) (i32.const 4))))
    (then (global.set $tscale (i32.const 1))))
  (local.set $font (i32.or (i32.gt_s (call $tw (local.get $s)) (i32.sub (local.get $w) (i32.const 4))) (i32.gt_s (i32.const 22) (local.get $h))))
  (local.set $lw (global.get $tscale))
  (loop $l
    (global.set $tscale (local.get $lw))
    (local.set $x (call $lay_x (i32.add (global.get $LR_TAB0) (local.get $i))))
    (local.set $y (call $lay_y (i32.add (global.get $LR_TAB0) (local.get $i))))
    (local.set $w (call $lay_w (i32.add (global.get $LR_TAB0) (local.get $i))))
    (local.set $h (call $lay_h (i32.add (global.get $LR_TAB0) (local.get $i))))
    (if (i32.eq (local.get $i) (global.get $tab)) (then
      (call $rect (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1)) (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.const 1)) (call $pal (i32.const 59)))
      (call $rect (i32.add (local.get $x) (i32.const 3)) (i32.add (local.get $y) (i32.const 1)) (i32.sub (local.get $w) (i32.const 6)) (i32.const 3) (call $pal (i32.const 38)))))
    (if (local.get $i) (then (call $vline (local.get $x) (i32.add (local.get $y) (i32.const 3)) (i32.sub (local.get $h) (i32.const 6)) (call $pal (i32.const 56)))))
    (local.set $ic (i32.load8_u (i32.add (i32.const 0x930) (local.get $i))))
    (local.set $s (call $str (i32.add (global.get $STR_TAB) (local.get $i))))
    ;; icon at the UI scale when the tab is tall enough, label below it
    (local.set $is (select (call $ui_ts) (global.get $tscale)
      (i32.le_s (i32.add (i32.mul (i32.const 9) (call $ui_ts)) (i32.add (call $lh) (i32.const 8))) (local.get $h))))
    (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h)
      (i32.add (i32.mul (i32.const 9) (local.get $is)) (i32.add (i32.sub (i32.const 9) (i32.shl (local.get $font) (i32.const 1))) (i32.mul (i32.const 6) (i32.sub (global.get $tscale) (i32.const 1)))))) (i32.const 1))))
    (call $ui_icon (local.get $ic) (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (i32.mul (i32.const 9) (local.get $is))) (i32.const 1)))
      (local.get $ty) (local.get $is))
    (drop (call $text (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (call $text_w (local.get $s) (local.get $font))) (i32.const 1)))
      (i32.add (i32.add (local.get $ty) (i32.mul (i32.const 9) (local.get $is))) (i32.sub (i32.const 2) (local.get $font)))
      (local.get $s) (call $pal (select (i32.const 61) (i32.const 63) (i32.eq (local.get $i) (global.get $tab)))) (local.get $font)))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 5))))
  (global.set $tscale (call $ui_ts)))

;; ---------------------------------------------------------------- sheet

(func $rowh (result i32)
  (call $imax (call $min_touch) (i32.add (i32.mul (i32.const 14) (call $ui_ts)) (i32.add (i32.shl (global.get $lgap) (i32.const 1)) (i32.const 13)))))
(func $btnh (result i32)
  (call $imax (call $min_touch) (i32.add (i32.mul (i32.const 7) (call $ui_ts)) (i32.add (i32.shl (global.get $lgap) (i32.const 1)) (i32.const 10)))))

;; Place a button in the current row of a cols-column grid; full rows advance the cursor.
(func $put (param $code i32) (param $label i32) (param $icon i32) (param $style i32) (param $en i32) (param $cols i32) (param $h i32)
  (local $w i32)
  (local.set $w (i32.div_s (i32.sub (global.get $uw) (i32.mul (i32.sub (local.get $cols) (i32.const 1)) (global.get $lgap))) (local.get $cols)))
  (call $btn (local.get $code) (i32.add (global.get $ux) (i32.mul (global.get $ucol) (i32.add (local.get $w) (global.get $lgap)))) (global.get $uy)
    (local.get $w) (local.get $h) (local.get $label) (local.get $icon) (local.get $style) (local.get $en))
  (global.set $ucol (i32.add (global.get $ucol) (i32.const 1)))
  (if (i32.ge_s (global.get $ucol) (local.get $cols)) (then
    (global.set $ucol (i32.const 0))
    (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $h) (global.get $lgap)))))))
;; Columns for a pair of action buttons: 2 when two ~14-char labels with icons fit at the UI
;; text scale, else 1 (large text on a phone stacks them).
(func $pcols (result i32)
  (i32.add (i32.const 1) (i32.ge_s (i32.shr_s (global.get $uw) (i32.const 1)) (i32.add (i32.mul (i32.const 93) (call $ui_ts)) (i32.const 20)))))
(func $flush (param $h i32)
  (if (global.get $ucol) (then
    (global.set $ucol (i32.const 0))
    (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $h) (global.get $lgap)))))))

;; $ui_label of the text in SB1.
(func $lab (param $icon i32) (param $c i32) (call $ui_label (local.get $icon) (global.get $SB1) (local.get $c)))
;; Label log for tests (on only via the t_lab_on hook, so the shipping build drops it): every
;; label line and button second line / right text drawn, NUL-separated at 0xA100..0xA8FF,
;; reset by $render.
(func $lab_log (param $s i32)
  (local $x i32)
  (if (i32.and (global.get $lab_on) (i32.ne (local.get $s) (i32.const 0))) (then
    (local.set $x (i32.add (call $strlen (local.get $s)) (i32.const 1)))
    (if (i32.lt_u (i32.add (global.get $lab_p) (local.get $x)) (i32.const 0xA900)) (then
      (memory.copy (global.get $lab_p) (local.get $s) (local.get $x))
      (global.set $lab_p (i32.add (global.get $lab_p) (local.get $x))))))))
;; A wrapped text line at the cursor with an optional glyph icon (palette colour c).
(func $ui_label (param $icon i32) (param $s i32) (param $c i32)
  (local $x i32)
  (call $lab_log (local.get $s))
  (global.set $tscale (call $ui_ts))
  (local.set $x (global.get $ux))
  (if (i32.ge_s (local.get $icon) (i32.const 0)) (then
    (call $ui_icon (local.get $icon) (local.get $x) (i32.sub (global.get $uy) (global.get $tscale)) (global.get $tscale))
    (local.set $x (i32.add (local.get $x) (i32.add (i32.mul (i32.const 9) (global.get $tscale)) (i32.const 4))))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (i32.const 2)
    (call $ui_wrap (local.get $x) (global.get $uy) (i32.sub (i32.add (global.get $ux) (global.get $uw)) (local.get $x)) (local.get $s) (call $pal (local.get $c)))))))

;; The content height is known only after the body is laid out: when the scroll position is past
;; the new end (content shrank, e.g. after a resize), the sheet is drawn again at the clamped
;; position with its hit regions and draw-list entries rolled back, so taps never see stale rows.
(func $draw_sheet
  (global.set $scroll_max (i32.const 0))
  (if (call $lay_w (global.get $LR_PANEL)) (then
    (call $draw_box (call $lay_x (global.get $LR_PANEL)) (call $lay_y (global.get $LR_PANEL))
      (call $lay_w (global.get $LR_PANEL)) (call $lay_h (global.get $LR_PANEL))))))
;; A paper card at (x0, y0, w, h): header (icon, title, subtitle), close button (the PANEL_CLOSE
;; geometry), clipped scrolling body. Shared by the sheet / side panel and the screens
;; (22c_screens.wat); $box_need = the height the content wants.
(func $draw_box (param $x0 i32) (param $y0 i32) (param $w i32) (param $h i32)
  (local $x i32) (local $y i32) (local $g i32) (local $hh i32) (local $oy i32) (local $ox i32)
  (local $c i32) (local $t i32) (local $hn i32) (local $bn i32)
  (local.set $hn (call $hit_n)) (local.set $bn (global.get $btn_n))
  (global.set $scroll_max (i32.const 0))
  (local.set $g (global.get $lgap))
  (local.set $oy (i32.shr_s (i32.mul (i32.sub (i32.const 256) (global.get $slide_p)) (local.get $h)) (i32.const 8)))
  (if (i32.ge_s (global.get $shake_t) (i32.const 0)) (then
    (local.set $ox (i32.sub (i32.shl (i32.and (i32.shr_u (call $since (global.get $shake_t)) (i32.const 5)) (i32.const 1)) (i32.const 2)) (i32.const 2)))))
  (local.set $x (i32.add (local.get $x0) (local.get $ox)))
  (local.set $y (i32.add (local.get $y0) (local.get $oy)))
  (call $ui_panel (local.get $x) (local.get $y) (local.get $w) (i32.add (local.get $h) (i32.const 3)))
  (local.set $hh (call $imax (call $min_touch) (call $S (i32.const 36))))
  ;; Results / Game Over: a taller header for the title at twice the text scale
  (if (call $big_head) (then (local.set $hh (i32.add (local.get $hh) (i32.add (i32.mul (call $ui_ts) (i32.const 7)) (global.get $lgap))))))
  (call $sheet_head (i32.add (local.get $x) (i32.shl (local.get $g) (i32.const 1))) (i32.add (local.get $y) (local.get $g))
    (i32.sub (local.get $w) (i32.add (local.get $hh) (i32.shl (local.get $g) (i32.const 2)))) (local.get $hh))
  ;; close: a selected plot or a tab; screens: Gazette, Journal, How to play
  (if (select (i32.and (i32.const 0x4C) (i32.shl (i32.const 1) (global.get $scr)))
              (i32.or (i32.ge_s (global.get $sel_tile) (i32.const 0)) (global.get $tab)) (global.get $scr)) (then
    (call $btn (global.get $HIT_CLOSE) (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $hh) (local.get $g))) (i32.add (local.get $y) (local.get $g))
      (local.get $hh) (local.get $hh) (i32.const 0) (global.get $I_CLOSE) (i32.const 0) (i32.const 1))))
  (local.set $t (i32.add (i32.add (local.get $y) (local.get $hh)) (i32.shl (local.get $g) (i32.const 1))))
  (call $hline (i32.add (local.get $x) (local.get $g)) (i32.sub (local.get $t) (i32.const 1)) (i32.sub (local.get $w) (i32.shl (local.get $g) (i32.const 1))) (call $pal (i32.const 57)))
  (global.set $clip_t (local.get $t))
  (global.set $clip_b (call $imin (i32.sub (i32.add (local.get $y) (local.get $h)) (local.get $g)) (global.get $fb_h)))
  (global.set $ux (i32.add (local.get $x) (i32.shl (local.get $g) (i32.const 1))))
  (global.set $uw (i32.sub (local.get $w) (i32.add (i32.shl (local.get $g) (i32.const 2)) (i32.const 3))))
  (global.set $uy (i32.add (i32.sub (local.get $t) (global.get $scroll)) (local.get $g)))
  (global.set $ucol (i32.const 0))
  (call $sheet_body)
  (call $flush (call $rowh))
  (local.set $c (i32.sub (i32.add (global.get $uy) (global.get $scroll)) (local.get $t)))
  (global.set $box_need (i32.add (i32.sub (local.get $t) (local.get $y)) (i32.add (local.get $c) (local.get $g))))
  (global.set $scroll_max (call $imax (i32.const 0) (i32.sub (local.get $c) (i32.sub (global.get $clip_b) (local.get $t)))))
  (if (i32.gt_s (global.get $scroll) (global.get $scroll_max)) (then
    (global.set $scroll (global.get $scroll_max))
    (call $lput (global.get $L_HITN) (local.get $hn)) (global.set $btn_n (local.get $bn))
    (global.set $clip_t (i32.const 0)) (global.set $clip_b (i32.const 0x7FFFFFFF))
    (call $draw_box (local.get $x0) (local.get $y0) (local.get $w) (local.get $h))
    (return)))
  ;; scroll bar
  (if (global.get $scroll_max) (then
    (local.set $h (i32.sub (global.get $clip_b) (local.get $t)))
    (call $rect (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $g) (i32.const 3))) (local.get $t) (i32.const 2) (local.get $h) (call $pal (i32.const 57)))
    (call $rect (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $g) (i32.const 3)))
      (i32.add (local.get $t) (i32.div_s (i32.mul (global.get $scroll) (local.get $h)) (local.get $c)))
      (i32.const 2) (i32.div_s (i32.mul (local.get $h) (local.get $h)) (local.get $c)) (call $pal (i32.const 62)))))
  (global.set $clip_t (i32.const 0))
  (global.set $clip_b (i32.const 0x7FFFFFFF)))

;; Header: icon, title, subtitle (laptop: the hovered plot's status).
(func $sheet_head (param $x i32) (param $y i32) (param $w i32) (param $hh i32)
  (local $i i32) (local $p i32) (local $icon i32) (local $title i32) (local $c i32) (local $is i32) (local $ty i32) (local $two i32)
  (local.set $i (global.get $sel_tile))
  (local.set $icon (i32.load8_u (i32.add (i32.const 0x930) (global.get $tab))))
  (local.set $title (call $str (i32.add (global.get $STR_TAB) (global.get $tab))))
  (call $sb (global.get $SB1))
  (if (global.get $scr) (then (call $ovl_head) (local.set $icon (global.get $oh_icon)) (local.set $title (global.get $oh_title)))
  (else (if (i32.lt_s (local.get $i) (i32.const 0))
    (then (if (i32.ge_s (global.get $dsp) (i32.const 0)) (then (call $s_step)) (else
          (call $si (global.get $STR_DAY)) (call $sn0 (i32.load16_u (global.get $S_DAY))) (call $sep)
          (call $si (i32.add (global.get $STR_SEA) (call $season))))))
    (else
      (local.set $p (call $tile_ptr (local.get $i)))
      (call $s_plot (local.get $i))
      (local.set $title (call $str (call $tile_name (local.get $p))))
      (local.set $icon (i32.const 79))
      (local.set $c (call $tile_crop (local.get $p)))
      (if (i32.ge_s (local.get $c) (i32.const 0)) (then (local.set $icon (i32.add (i32.const 64) (local.get $c)))))
      (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
        (then (local.set $icon (i32.add (i32.const 80) (call $clamp (i32.load8_u offset=1 (local.get $p)) (i32.const 0) (i32.const 9))))))
      (if (i32.eqz (call $in_grid (local.get $i))) (then
        (local.set $icon (i32.const 78)) (local.set $title (call $str (global.get $STR_WILD)))))))))
  (if (i32.and (i32.eq (call $lget (global.get $L_MODE)) (i32.const 2))
               (i32.and (i32.ge_s (global.get $hover_tile) (i32.const 0)) (i32.ne (global.get $hover_tile) (local.get $i)))) (then
    (call $tile_info (global.get $hover_tile))
    (call $sb (global.get $SB1)) (call $ss (global.get $SB3))))
  (local.set $is (select (i32.sub (local.get $hh) (i32.const 2)) (i32.mul (i32.const 9) (call $ui_ts)) (i32.ge_u (local.get $icon) (i32.const 64))))
  (call $ui_icon (local.get $icon) (local.get $x) (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $hh) (local.get $is)) (i32.const 1)))
    (select (local.get $is) (call $ui_ts) (i32.ge_u (local.get $icon) (i32.const 64))))
  (local.set $x (i32.add (local.get $x) (i32.add (local.get $is) (i32.add (global.get $lgap) (i32.const 2)))))
  (local.set $w (i32.sub (local.get $w) (i32.add (local.get $is) (i32.add (global.get $lgap) (i32.const 2)))))
  (call $fit (local.get $title) (local.get $w))
  (local.set $two (i32.ge_s (local.get $hh) (i32.add (i32.mul (call $lh) (i32.const 2)) (i32.const 3))))
  (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $hh) (i32.add (i32.mul (call $lh) (i32.add (local.get $two) (i32.const 1))) (i32.mul (local.get $two) (i32.const 3)))) (i32.const 1))))
  ;; Results / Game Over: the title at twice the UI scale (when it fits) over a UI-scale subtitle
  (if (call $big_head) (then
    (global.set $tscale (i32.shl (call $ui_ts) (i32.const 1)))
    (if (i32.gt_s (call $tw (local.get $title)) (local.get $w)) (then (call $fit (local.get $title) (local.get $w))))
    (local.set $two (i32.const 1))
    (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $hh) (i32.add (call $lh) (i32.add (i32.mul (call $ui_ts) (i32.const 7)) (i32.const 3)))) (i32.const 1))))))
  (drop (call $txt (local.get $x) (local.get $ty) (local.get $title) (call $pal (i32.const 60))))
  (if (local.get $two) (then
    (local.set $ty (i32.add (local.get $ty) (i32.add (call $lh) (i32.const 3))))
    (call $fit (global.get $SB1) (local.get $w))
    (drop (call $txt (local.get $x) (local.get $ty) (global.get $SB1) (call $pal (i32.const 63))))))
  (global.set $tscale (call $ui_ts)))

;; Picker rows (one table-driven list): k 0 crops in season, 1 crops in any season (Greenhouse),
;; 2 buildings (unlock reason, upkeep, owned count). Disabled rows carry their reason.
(func $pick_rows (param $k i32)
  (local $i i32) (local $why i32) (local $cost i32) (local $b i32)
  (local.set $b (i32.eq (local.get $k) (i32.const 2)))
  (loop $l
    (local.set $cost (call $bal (select (global.get $T_BLD) (global.get $T_CROP) (local.get $b)) (local.get $i) (i32.const 0)))
    (local.set $why (i32.const 0))
    (if (i32.lt_s (i32.load (global.get $S_CASH)) (local.get $cost)) (then (local.set $why (call $err_str (global.get $E_CASH)))))
    ;; ($lock_reason builds in SB3: before SB1 is started)
    (if (i32.and (local.get $b) (i32.eqz (call $bld_unlocked (local.get $i)))) (then (local.set $why (call $lock_reason (local.get $i)))))
    (call $sb (global.get $SB1))
    (if (local.get $b)
      (then
        (call $si (global.get $STR_UPKEEP)) (call $sn (call $bal (global.get $T_BLD) (local.get $i) (i32.const 1)) (i32.const 1)) (call $si (global.get $STR_PER_DAY))
        (if (call $count_bld (local.get $i)) (then (call $sep) (call $sn0 (call $count_bld (local.get $i))) (call $si (global.get $STR_OWNED)))))
      (else
        (if (i32.eqz (i32.or (local.get $k) (i32.and (call $bal (global.get $T_CROP) (local.get $i) (i32.const 5)) (i32.shl (i32.const 1) (call $season)))))
          (then (local.set $why (call $err_str (global.get $E_SEASON)))))
        (call $s_days (call $bal (global.get $T_CROP) (local.get $i) (i32.const 1)))
        (call $sep) (call $si (select (global.get $STR_SEASON_ANY) (global.get $STR_IN_SEASON) (local.get $k)))))
    (call $sb (global.get $SB2)) (call $sn (local.get $cost) (i32.const 1))
    (global.set $b_row (i32.const 1)) (global.set $b_sub (global.get $SB1)) (global.set $b_right (global.get $SB2)) (global.set $b_why (local.get $why))
    (local.set $cost (i32.add (i32.shl (local.get $b) (i32.const 4)) (local.get $i)))
    (call $put (i32.add (i32.const 0x210) (local.get $cost)) (call $str (i32.add (select (global.get $STR_BLD) (global.get $STR_GOOD) (local.get $b)) (local.get $i)))
      (i32.add (i32.const 64) (local.get $cost)) (i32.const 0) (i32.eqz (local.get $why)) (call $lget (global.get $L_COLS)) (call $rowh))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (select (i32.const 10) (i32.const 5) (local.get $b))))))

;; Two-step button (label / alt label text): the alt label while armed, drawn dimmed (style 5) for
;; the first 400 ms while the confirming tap is not live yet, then danger red.
(func $put_two (param $code i32) (param $label i32) (param $alt i32) (param $icon i32) (param $cols i32) (param $h i32)
  (local $a i32)
  (local.set $a (i32.eq (global.get $arm) (local.get $code)))
  (call $put (local.get $code) (select (local.get $alt) (local.get $label) (local.get $a))
    (local.get $icon) (select (select (i32.const 4) (i32.const 5) (call $arm_live)) (i32.const 0) (local.get $a)) (i32.const 1) (local.get $cols) (local.get $h)))
(func $put_demolish (param $label i32) (param $cols i32) (param $h i32)
  (call $put_two (i32.const 0x203) (call $str (local.get $label)) (call $str (global.get $STR_TAP_AGAIN)) (global.get $I_TRASH) (local.get $cols) (local.get $h)))

;; "FARM 4X4 > 5X5" and BUY LAND $x for the next ring of a farm of side n (< maxGrid).
(func $land_ui (param $n i32)
  (local $v i32) (local $t i32)
  (local.set $v (call $bal (global.get $T_LAND) (i32.sub (local.get $n) (call $k (global.get $K_START_GRID))) (i32.const 0)))
  (call $sb (global.get $SB1)) (call $s_farm_size (local.get $n)) (call $sc (i32.const 32)) (call $sc (i32.const 62)) (call $sc (i32.const 32))
  (call $sn0 (i32.add (local.get $n) (i32.const 1))) (call $si (global.get $STR_X)) (call $sn0 (i32.add (local.get $n) (i32.const 1)))
  (call $lab (global.get $I_PLUS) (i32.const 61))
  (call $sb (global.get $SB2)) (call $si (global.get $STR_BUY_LAND)) (call $sc (i32.const 32)) (call $sn (local.get $v) (i32.const 1))
  (global.set $b_why (call $err_str (global.get $E_CASH)))
  (local.set $t (i32.ge_s (i32.load (global.get $S_CASH)) (local.get $v)))
  ;; disabled: label + reason need the two-line row height
  (call $put (i32.const 0x207) (global.get $SB2) (global.get $I_PLUS) (i32.const 2)
    (local.get $t) (i32.const 1) (select (call $btnh) (call $rowh) (local.get $t))))

;; Recipe selector [<] "2 WHEAT > 1 FLOUR" [>] for the building at p; codes c (prev), c + 0x40 or
;; c + 1 (next): the sheet uses 0x205 / 0x206, the Process tab 0x340 / 0x380 + tile.
(func $recipe_sel (param $p i32) (param $c i32)
  (local $bh i32) (local $v i32) (local $n i32) (local $t i32)
  (local.set $bh (call $btnh))
  (call $btn (local.get $c) (global.get $ux) (global.get $uy) (local.get $bh) (local.get $bh) (i32.const 0) (global.get $I_ARROW_L) (i32.const 0) (i32.const 1))
  (call $btn (i32.add (local.get $c) (select (i32.const 1) (i32.const 0x40) (i32.lt_u (local.get $c) (i32.const 0x300))))
    (i32.sub (i32.add (global.get $ux) (global.get $uw)) (local.get $bh)) (global.get $uy) (local.get $bh) (local.get $bh) (i32.const 0) (global.get $I_ARROW_R) (i32.const 0) (i32.const 1))
  (local.set $v (i32.add (global.get $ux) (i32.add (local.get $bh) (global.get $lgap))))
  (local.set $n (i32.sub (global.get $uw) (i32.shl (i32.add (local.get $bh) (global.get $lgap)) (i32.const 1))))
  (call $rrect (local.get $v) (global.get $uy) (local.get $n) (i32.sub (local.get $bh) (i32.const 2)) (i32.const 2) (call $pal (i32.const 57)))
  (call $sb (global.get $SB1))
  (local.set $t (i32.load8_u offset=7 (local.get $p)))
  (if (local.get $t) (then (call $s_recipe (i32.sub (local.get $t) (i32.const 1)))) (else (call $si (global.get $STR_OFF))))
  (call $fit (global.get $SB1) (i32.sub (local.get $n) (i32.const 4)))
  (drop (call $txt (i32.add (local.get $v) (i32.shr_s (i32.sub (local.get $n) (call $tw (global.get $SB1))) (i32.const 1)))
    (i32.add (global.get $uy) (i32.shr_s (i32.sub (i32.sub (local.get $bh) (i32.const 2)) (call $lh)) (i32.const 1)))
    (global.get $SB1) (call $pal (select (i32.const 61) (i32.const 63) (local.get $t)))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $bh) (global.get $lgap)))))

(func $sheet_body
  (local $i i32) (local $p i32) (local $c i32) (local $b i32) (local $n i32) (local $v i32) (local $t i32) (local $why i32) (local $bh i32) (local $j i32)
  (if (global.get $scr) (then (call $ovl_body) (return)))
  (if (global.get $tab) (then (call $tab_body) (return)))
  (local.set $bh (call $btnh))
  (local.set $i (global.get $sel_tile))
  (if (i32.lt_s (local.get $i) (i32.const 0)) (then
    ;; laptop overview: storage, ripe count, how to start
    (call $sb (global.get $SB1)) (call $si (global.get $STR_STORAGE))
    (call $sn0 (call $storage_used)) (call $sc (i32.const 47)) (call $sn0 (call $storage_cap))
    (call $lab (global.get $I_CRATE) (i32.const 61))
    (local.set $n (call $ripe_count))
    (call $sb (global.get $SB1))
    (if (local.get $n) (then (call $sn0 (local.get $n)) (call $si (global.get $STR_NOW_RIPE)))
                       (else (call $si (global.get $STR_NO_RIPE))))
    (call $lab (global.get $I_BASKET) (i32.const 61))
    (call $ui_label (i32.const -1) (call $str (global.get $STR_HINT)) (i32.const 63))
    (call $ui_label (i32.const -1) (call $str (global.get $STR_KEYS)) (i32.const 63))
    (return)))
  (local.set $p (call $tile_ptr (local.get $i)))
  (if (i32.eqz (call $in_grid (local.get $i))) (then
    ;; wild land: the next ring can be bought
    (local.set $n (i32.load8_u (global.get $S_GRID)))
    (if (i32.and (i32.lt_u (local.get $n) (call $k (global.get $K_MAX_GRID)))
                 (i32.and (i32.le_u (i32.and (local.get $i) (i32.const 7)) (local.get $n)) (i32.le_u (i32.shr_u (local.get $i) (i32.const 3)) (local.get $n))))
      (then (call $land_ui (local.get $n)))
      (else (call $ui_label (global.get $I_LOCK) (call $str (global.get $STR_NEXT_RING)) (i32.const 63))))
    (return)))
  (if (i32.eqz (i32.load8_u (local.get $p))) (then
    ;; empty plot: PLANT / BUILD toggle and the matching picker
    (call $put (i32.const 0x200) (call $str (global.get $STR_PLANT)) (global.get $I_SPROUT) (select (i32.const 0) (i32.const 3) (global.get $pick)) (i32.const 1) (i32.const 2) (local.get $bh))
    (call $put (i32.const 0x201) (call $str (i32.add (global.get $STR_TAB) (i32.const 4))) (global.get $I_HAMMER) (select (i32.const 3) (i32.const 0) (global.get $pick)) (i32.const 1) (i32.const 2) (local.get $bh))
    (call $pick_rows (i32.shl (global.get $pick) (i32.const 1)))
    (return)))
  (local.set $c (call $tile_crop (local.get $p)))
  (local.set $b (i32.load8_u offset=1 (local.get $p)))
  (if (i32.ge_s (local.get $c) (i32.const 0)) (then
    ;; crop (or planted Greenhouse): growth, ripeness, yield, storage, HARVEST, CLEAR / DEMOLISH
    (local.set $t (call $grow_target (local.get $p) (local.get $c)))
    (local.set $v (call $tile_ripe (local.get $p)))
    (call $sb (global.get $SB1))
    (if (local.get $v)
      (then
        (call $si (global.get $STR_RIPE))
        (local.set $n (call $bal (global.get $T_CROP) (local.get $c) (i32.const 4)))
        (if (local.get $n) (then
          (call $sep)
          (local.set $n (i32.sub (local.get $n) (i32.load8_u offset=4 (local.get $p))))
          (if (i32.gt_s (local.get $n) (i32.const 0))
            (then (call $si (global.get $STR_ROTS_IN)) (call $s_days (local.get $n)))
            (else (call $si (global.get $STR_ROTTING)))))))
      (else (call $si (global.get $STR_READY_IN)) (call $s_days (call $days_left (local.get $p) (local.get $c)))))
    (call $lab (select (global.get $I_CHECK) (global.get $I_CLOCK) (local.get $v)) (i32.const 61))
    (local.set $n (i32.add (i32.const 4) (i32.shl (call $ui_ts) (i32.const 1))))
    (call $ui_bar (global.get $ux) (global.get $uy) (global.get $uw) (local.get $n) (i32.load16_u offset=2 (local.get $p)) (local.get $t)
      (select (i32.const 10) (i32.const 18) (local.get $v)))
    (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $n) (i32.add (global.get $lgap) (i32.const 2)))))
    (call $sb (global.get $SB1))
    (call $si (global.get $STR_YIELD)) (call $sn0 (call $yield (local.get $c))) (call $sep)
    (call $si (global.get $STR_STORAGE)) (call $sn0 (call $storage_used)) (call $sc (i32.const 47)) (call $sn0 (call $storage_cap))
    (call $lab (global.get $I_CRATE) (i32.const 63))
    (local.set $why (i32.const 0))
    (if (i32.eqz (call $storage_fits (call $yield (local.get $c)))) (then (local.set $why (call $err_str (global.get $E_STORAGE_FULL)))))
    (if (i32.eqz (local.get $v)) (then (local.set $why (call $err_str (global.get $E_NOT_RIPE)))))
    (global.set $b_why (local.get $why))
    (local.set $n (select (call $rowh) (local.get $bh) (local.get $why)))
    (call $put (i32.const 0x202) (call $str (global.get $STR_HARVEST)) (global.get $I_BASKET) (i32.const 2) (i32.eqz (local.get $why)) (call $pcols) (local.get $n))
    (call $put_demolish (select (global.get $STR_DEMOLISH) (global.get $STR_CLEAR) (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))) (call $pcols) (local.get $n))
    (return)))
  ;; building
  (call $sb (global.get $SB1))
  (call $si (global.get $STR_UPKEEP)) (call $sn (call $bal (global.get $T_BLD) (local.get $b) (i32.const 1)) (i32.const 1)) (call $si (global.get $STR_PER_DAY))
  (call $lab (global.get $I_COIN) (i32.const 61))
  (if (i32.le_u (local.get $b) (i32.const 4))
    (then
      (call $recipe_sel (local.get $p) (i32.const 0x205))
      (call $sb (global.get $SB1))
      (if (i32.eq (local.get $b) (global.get $BLD_CELLAR))
        (then
          ;; cellar: units aging and days until the next batch is Wine
          (local.set $t (i32.add (global.get $S_CELLAR) (i32.mul (local.get $i) (i32.const 5))))
          (local.set $n (i32.const 0)) (local.set $why (i32.const 0)) (local.set $j (i32.const 5))
          (loop $cl
            (local.set $j (i32.sub (local.get $j) (i32.const 1)))
            (local.set $v (i32.load8_u (i32.add (local.get $t) (local.get $j))))
            (local.set $n (i32.add (local.get $n) (local.get $v)))
            (if (local.get $v) (then (local.set $why (i32.add (local.get $j) (i32.const 1)))))
            (br_if $cl (local.get $j)))
          (call $si (global.get $STR_AGING)) (call $sn0 (local.get $n))
          (if (local.get $n) (then (call $sep) (call $si (global.get $STR_READY_IN)) (call $s_days (local.get $why)))))
        (else
          (call $si (i32.add (global.get $STR_CAP) (i32.const 0)))
          (call $sn0 (i32.mul (call $bal (global.get $T_BLD) (local.get $b) (i32.const 2))
            (select (call $k (global.get $K_BLD_UPG_CAP_MULT)) (i32.const 1) (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2)))))
          (call $si (global.get $STR_PER_DAY))))
      (call $lab (global.get $I_GEAR) (i32.const 63)))
    (else
      (local.set $n (call $bal (global.get $T_BLD) (local.get $b) (i32.const 3)))
      (if (local.get $n) (then
        (call $sc (i32.const 43)) (call $sn0 (local.get $n)) (call $sc (i32.const 32)) (call $si (global.get $STR_STORAGE))
        (call $lab (global.get $I_CRATE) (i32.const 61))))
      (call $ui_label (global.get $I_CHECK) (call $str (i32.add (global.get $STR_BINFO) (local.get $b))) (i32.const 63))))
  (if (i32.eq (local.get $b) (global.get $BLD_GREENHOUSE)) (then
    (call $ui_label (global.get $I_SPROUT) (call $str (global.get $STR_PICK)) (i32.const 61))
    (call $pick_rows (i32.const 1))
    (call $flush (call $rowh))))
  (if (i32.le_u (local.get $b) (i32.const 3)) (then
    (local.set $v (i32.div_u (i32.mul (call $bal (global.get $T_BLD) (local.get $b) (i32.const 0)) (call $k (global.get $K_BLD_UPG_PCT))) (i32.const 10000)))
    (local.set $t (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2)))
    (call $sb (global.get $SB2)) (call $si (global.get $STR_UPGRADE))
    (if (i32.eqz (local.get $t)) (then (call $sc (i32.const 32)) (call $sn (local.get $v) (i32.const 1))))
    (global.set $b_why (select (call $str (global.get $STR_MAX_LEVEL)) (call $err_str (global.get $E_CASH)) (local.get $t)))
    (call $put (i32.const 0x204) (global.get $SB2) (global.get $I_UP) (i32.const 0)
      (i32.and (i32.eqz (local.get $t)) (i32.ge_s (i32.load (global.get $S_CASH)) (local.get $v))) (call $pcols) (call $rowh))
    (call $put_demolish (global.get $STR_DEMOLISH) (call $pcols) (call $rowh))
    (return)))
  (call $put_demolish (global.get $STR_DEMOLISH) (i32.const 1) (local.get $bh)))
