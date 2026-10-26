;; Load metrics, the stats overlay and its frame-time sparkline (spec §15.1, §15.2, §15.5; plan Task 7c).
;; Every number shown is measured by the loader and passed in, or read live (memory.size); the only
;; constant text is the honesty row ("TYPICAL ENGINE BUILD ... (TYPICAL, NOT MEASURED)").
;;
;; set_metrics(load_ms, transfer_bytes, wasm_enc_bytes, wasm_raw_bytes, endday_us, frame_us): the
;; loader calls it before every frame() with its latest numbers. load_ms = first frame - script start
;; (0 until measured: shown "--"); transfer_bytes = transferSize of the page, game.wasm and sw.js
;; (0 with a load time = everything came from a cache: "CACHED"); wasm_enc_bytes = game.wasm bytes on
;; the wire (encodedBodySize: the gzip size when the host compresses, else the raw size, so the
;; overlay calls it WIRE, not GZ); wasm_raw_bytes = decoded size; endday_us = the pointer / key call that moved
;; cur_day() (the count of End Days played from the farm: not replay seeks, Take Over or loads); frame_us = the previous frame() + blit. Negative values read as 0. Each
;; call with frame_us > 0 adds one sample to the 120-sample ring (endday_us and frame_us clamp to 10 s once, so the sum fits; shown ">10,000,000").
;; A change of load_ms / transfer redraws (the Title and Results show "LOADED IN 47 MS ^ 18.2 KB").
;;
;; Overlay: Backquote (key 14) toggles it anywhere; Esc closes it first; a triple tap on the top-left
;; 44 x 44 CSS px corner (three downs within 600 ms of the set_now clock) toggles it. The first two taps of
;; a triple tap reach whatever is under them (the DAY box opens the Gazette; that is accepted: no tap
;; is delayed or swallowed for a gesture that may never complete); the third down is consumed. The
;; panel sits at the top-left of the farm viewport (LR_GRID), so it never covers the top bar, End Day,
;; the tabs or the side panel; it is render-only: on the farm it passes taps through except its header row
;; (hit 0x3DA, >= min_touch tall), which closes it; over a screen its body also absorbs taps (hit 0x3DB). While open, frame() redraws every frame (returns
;; 1), so the sparkline shows real, continuous frame times. Announced "STATS ON" / "STATS OFF".
;; Sparkline: one bar per sample, newest right, fixed scale 0..20 ms with the 16.7 ms (60 fps)
;; frame budget marked; a bar over the budget is tomato red. Large text draws at scale 2 when the panel fits the viewport (320x568 and up), else falls back to scale 1 (t_ovl 11 reads the scale).
;;
;; Memory (R_LAYOUT, was free): 0xAC40..0xAE1F frame ring (120 x i32 us), 0xAE20..0xAF1F row text
;; builders (value; label + value for the t_ovl_line test hook).

(global $met_ms (mut i32) (i32.const 0))
(global $met_bytes (mut i32) (i32.const 0))
(global $met_enc (mut i32) (i32.const 0))
(global $met_raw (mut i32) (i32.const 0))
(global $met_ed (mut i32) (i32.const 0))
(global $met_fr (mut i32) (i32.const 0))
(global $fr_i (mut i32) (i32.const 0))         ;; ring: next slot, samples held (<= 120)
(global $fr_n (mut i32) (i32.const 0))
(global $ovl_on (mut i32) (i32.const 0))
(global $tt_n (mut i32) (i32.const 0))         ;; triple tap: corner downs so far, time of the first
(global $tt_t (mut i32) (i32.const 0))
(global $ov_r (mut i32) (i32.const 0))         ;; panel as last drawn: x, y, w, h (test hook t_ovl)
(global $ov_y (mut i32) (i32.const 0))
(global $ov_w (mut i32) (i32.const 0))
(global $ov_h (mut i32) (i32.const 0))
(global $ov_s (mut i32) (i32.const 1))                ;; the scale it drew at (t_ovl 11)
(global $sp_x (mut i32) (i32.const 0))         ;; sparkline box as last drawn
(global $sp_y (mut i32) (i32.const 0))
(global $sp_w (mut i32) (i32.const 0))
(global $sp_h (mut i32) (i32.const 0))
(global $FRING i32 (i32.const 0xAC40))
(global $OVLBUF i32 (i32.const 0xAE20))

(func $set_metrics (param $ms i32) (param $tb i32) (param $enc i32) (param $raw i32) (param $ed i32) (param $fr i32)
  (local.set $ms (call $imax (local.get $ms) (i32.const 0)))
  (local.set $tb (call $imax (local.get $tb) (i32.const 0)))
  (if (i32.or (i32.ne (local.get $ms) (global.get $met_ms)) (i32.ne (local.get $tb) (global.get $met_bytes)))
    (then (global.set $dirty (i32.const 1))))
  (global.set $met_ms (local.get $ms)) (global.set $met_bytes (local.get $tb))
  (global.set $met_enc (call $imax (local.get $enc) (i32.const 0))) (global.set $met_raw (call $imax (local.get $raw) (i32.const 0)))
  ;; one clamp for everything measured in us: 10 s (a sum of 120 samples fits an i32; shown as ">10,000,000")
  (local.set $ed (call $imin (call $imax (local.get $ed) (i32.const 0)) (i32.const 10000000)))
  (local.set $fr (call $imin (call $imax (local.get $fr) (i32.const 0)) (i32.const 10000000)))
  (global.set $met_ed (local.get $ed))
  (global.set $met_fr (local.get $fr))
  (if (i32.gt_s (local.get $fr) (i32.const 0)) (then
    (i32.store (i32.add (global.get $FRING) (i32.shl (global.get $fr_i) (i32.const 2))) (local.get $fr))
    (global.set $fr_i (i32.rem_u (i32.add (global.get $fr_i) (i32.const 1)) (i32.const 120)))
    (global.set $fr_n (call $imin (i32.add (global.get $fr_n) (i32.const 1)) (i32.const 120))))))
(global $ed_n (mut i32) (i32.const 0))           ;; End Days played from the farm (not replay seeks, Take Over or loads)
(func $cur_day (result i32) (global.get $ed_n))

;; Ring sample j (0 = oldest held).
(func $fr_at (param $j i32) (result i32)
  (i32.load (i32.add (global.get $FRING)
    (i32.shl (i32.rem_u (i32.add (i32.sub (i32.add (global.get $fr_i) (i32.const 120)) (global.get $fr_n)) (local.get $j)) (i32.const 120)) (i32.const 2)))))

;; A measured value: "--" while 0, else n (thousands commas); u = 1024: KB with one decimal, rounded
;; half up (18,637 B -> "18.2"; i64 so 2^31 - 1 B cannot overflow).
(func $s_met (param $v i32) (param $u i32)
  (if (i32.le_s (local.get $v) (i32.const 0)) (then (call $sc (i32.const 45)) (call $sc (i32.const 45)) (return)))
  (if (i32.eq (local.get $u) (i32.const 1)) (then
    (if (i32.ge_u (local.get $v) (i32.const 10000000)) (then (call $sc (i32.const 62)) (local.set $v (i32.const 10000000))))   ;; the clamp: ">10,000,000"
    (call $sn (local.get $v) (i32.const 2)) (return)))
  (local.set $v (i32.wrap_i64 (i64.div_u (i64.add (i64.mul (i64.extend_i32_u (local.get $v)) (i64.const 10)) (i64.const 512)) (i64.const 1024))))
  (call $sn (i32.div_u (local.get $v) (i32.const 10)) (i32.const 2)) (call $sc (i32.const 46)) (call $sn0 (i32.rem_u (local.get $v) (i32.const 10))))
;; Transfer: "18.2 KB", "CACHED" (a load time but nothing transferred) or "-- KB".
(func $s_xfer
  (if (i32.and (i32.eqz (global.get $met_bytes)) (i32.gt_s (global.get $met_ms) (i32.const 0)))
    (then (call $si (global.get $STR_CACHED)))
    (else (call $s_met (global.get $met_bytes) (i32.const 1024)) (call $si (global.get $STR_KB)))))
;; "LOADED IN 47 MS ^ 18.2 KB" into SB1 (Title and Results footers).
(func $s_load
  (call $sb (global.get $SB1)) (call $si (global.get $STR_LOADED)) (call $s_met (global.get $met_ms) (i32.const 1)) (call $si (global.get $STR_MS))
  (call $si (global.get $STR_DOTS)) (call $s_xfer))

;; Overlay row i (1..8): its measured value as text (labels are $STR_OVL + i; 0 = the header).
;;   1 WASM RAW 60.7 KB  2 WASM WIRE 32.5 KB  3 TRANSFER 18.2 KB / CACHED  4 LOAD TIME 47 MS
;;   5 MEMORY 16 PAGES ^ 1,024 KB (memory.size, live)  6 LAST END DAY 812 US  7 LAST FRAME 2,300 US
;;   8 FRAME MIN/AVG/MAX 1,900 / 3,012 / 35,560 US (over the ring)
(func $ovl_val (param $i i32) (result i32)
  (local $a i32) (local $b i32) (local $s i32) (local $j i32) (local $v i32)
  (global.set $sblim (i32.const 120))
  (call $sb (global.get $OVLBUF))
  (if (i32.lt_u (local.get $i) (i32.const 3)) (then
    (call $s_met (select (global.get $met_raw) (global.get $met_enc) (i32.eq (local.get $i) (i32.const 1))) (i32.const 1024)) (call $si (global.get $STR_KB))))
  (if (i32.eq (local.get $i) (i32.const 3)) (then (call $s_xfer)))
  (if (i32.eq (local.get $i) (i32.const 4)) (then (call $s_met (global.get $met_ms) (i32.const 1)) (call $si (global.get $STR_MS))))
  (if (i32.eq (local.get $i) (i32.const 5)) (then
    (call $sn0 (memory.size)) (call $si (global.get $STR_PAGES)) (call $si (global.get $STR_DOTS))
    (call $sn (i32.shl (memory.size) (i32.const 6)) (i32.const 2)) (call $si (global.get $STR_KB))))
  (if (i32.eq (local.get $i) (i32.const 6)) (then (call $s_met (global.get $met_ed) (i32.const 1)) (call $si (global.get $STR_US))))
  (if (i32.eq (local.get $i) (i32.const 7)) (then (call $s_met (global.get $met_fr) (i32.const 1)) (call $si (global.get $STR_US))))
  (if (i32.eq (local.get $i) (i32.const 8)) (then
    (local.set $a (i32.const 0x7FFFFFFF))
    (block $d (loop $l
      (br_if $d (i32.ge_u (local.get $j) (global.get $fr_n)))
      (local.set $v (call $fr_at (local.get $j)))
      (local.set $a (call $imin (local.get $a) (local.get $v))) (local.set $b (call $imax (local.get $b) (local.get $v)))
      (local.set $s (i32.add (local.get $s) (local.get $v)))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $l)))
    (call $s_met (select (local.get $a) (i32.const 0) (global.get $fr_n)) (i32.const 1)) (call $si (global.get $STR_SLASH))
    (call $s_met (i32.div_u (local.get $s) (call $imax (global.get $fr_n) (i32.const 1))) (i32.const 1)) (call $si (global.get $STR_SLASH))
    (call $s_met (local.get $b) (i32.const 1)) (call $si (global.get $STR_US))))
  (global.set $sblim (i32.const 55))
  (global.get $OVLBUF))
;; Test hook: "LABEL VALUE" of row i (0 header, 9..11 the honesty lines).
(func $t_ovl_line (param $i i32) (result i32)
  (if (i32.ge_u (local.get $i) (i32.const 9)) (then (return (call $str (i32.add (global.get $STR_TYP) (i32.sub (local.get $i) (i32.const 9)))))))
  (if (local.get $i) (then (drop (call $ovl_val (local.get $i)))) (else (i32.store8 (global.get $OVLBUF) (i32.const 0))))
  (global.set $sblim (i32.const 120))
  (call $sb (i32.add (global.get $OVLBUF) (i32.const 120))) (call $si (i32.add (global.get $STR_OVL) (local.get $i)))
  (if (local.get $i) (then (call $sp) (call $ss (global.get $OVLBUF))))
  (global.set $sblim (i32.const 55))
  (i32.add (global.get $OVLBUF) (i32.const 120)))

(func $ovl_toggle
  (global.set $ovl_on (i32.eqz (global.get $ovl_on)))
  (global.set $tt_n (i32.const 0))
  (call $sb (global.get $OVLBUF)) (call $si (global.get $STR_OVL)) (call $sp) (call $si (select (global.get $STR_ON) (global.get $STR_OFF) (global.get $ovl_on)))
  (call $announce (global.get $OVLBUF))
  (global.set $dirty (i32.const 1)))
;; A down at css (x, y): 1 when it completes a triple tap on the top-left corner (overlay toggled;
;; the caller drops the press).
(func $tt_down (param $x i32) (param $y i32) (result i32)
  (if (i32.or (i32.ge_u (local.get $x) (i32.const 44)) (i32.ge_u (local.get $y) (i32.const 44)))
    (then (global.set $tt_n (i32.const 0)) (return (i32.const 0))))
  (if (i32.or (i32.eqz (global.get $tt_n)) (i32.gt_s (call $since (global.get $tt_t)) (i32.const 600)))
    (then (global.set $tt_n (i32.const 0)) (global.set $tt_t (global.get $now))))
  (global.set $tt_n (i32.add (global.get $tt_n) (i32.const 1)))
  (if (i32.lt_u (global.get $tt_n) (i32.const 3)) (then (return (i32.const 0))))
  (call $ovl_toggle)
  (i32.const 1))

;; The rows from y: label left (paper), value right (bright); a value that does not fit beside its
;; label goes right-aligned on the next line. $nodraw = 1 only measures. Returns the height used.
(func $ovl_rows (param $x i32) (param $y i32) (param $w i32) (result i32)
  (local $i i32) (local $y0 i32) (local $l i32) (local $v i32) (local $vw i32) (local $ts i32)
  (local.set $y0 (local.get $y))
  (local.set $ts (global.get $tscale))
  (local.set $i (i32.const 1))
  (loop $r
    (global.set $tscale (local.get $ts))
    (local.set $l (call $str (i32.add (global.get $STR_OVL) (local.get $i))))
    (local.set $v (call $ovl_val (local.get $i)))
    ;; (a value wider than the panel, e.g. absurd numbers in large text, is drawn at scale 1)
    (if (i32.gt_s (call $tw (local.get $v)) (local.get $w)) (then (global.set $tscale (i32.const 1))))
    (local.set $vw (call $tw (local.get $v)))
    (global.set $tscale (local.get $ts))
    (if (i32.eqz (global.get $nodraw)) (then (drop (call $txt (local.get $x) (local.get $y) (local.get $l) (call $pal (i32.const 47))))))
    (if (i32.gt_s (i32.add (i32.add (call $tw (local.get $l)) (local.get $vw)) (i32.mul (i32.const 12) (global.get $tscale))) (local.get $w))
      (then (local.set $y (i32.add (local.get $y) (i32.add (call $lh) (i32.const 3))))))
    (if (i32.eqz (global.get $nodraw)) (then
      (if (i32.gt_s (call $tw (local.get $v)) (local.get $w)) (then (global.set $tscale (i32.const 1))))
      (drop (call $txt (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $vw)) (local.get $y) (local.get $v) (call $pal (i32.const 59))))
      (global.set $tscale (local.get $ts))))
    (local.set $y (i32.add (local.get $y) (i32.add (call $lh) (i32.const 3))))
    (br_if $r (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 9))))
  (i32.sub (local.get $y) (local.get $y0)))
;; The honesty row (three strings, each wrapped in w); the height used.
(func $ovl_typ (param $x i32) (param $y i32) (param $w i32) (result i32)
  (local $h i32) (local $i i32)
  (loop $l
    (local.set $h (i32.add (local.get $h) (call $ui_wrap (local.get $x) (i32.add (local.get $y) (local.get $h)) (local.get $w)
      (call $str (i32.add (global.get $STR_TYP) (local.get $i))) (call $pal (i32.const 47)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (local.get $h))

;; The overlay, drawn last in $render (over toasts) when on: at the top-left of the farm viewport
;; (on the farm screen within it, so the side panel / tabs / top bar stay clear; over a screen it may
;; use the width to the right edge), as wide as its widest row needs.
(func $draw_stats
  (local $x i32) (local $y i32) (local $w i32) (local $h i32) (local $g i32) (local $hh i32) (local $p i32)
  (local $ix i32) (local $iw i32) (local $sh i32) (local $k i32) (local $j i32) (local $v i32) (local $by i32)
  (local $mx i32) (local $aw i32) (local $t i32)
  (if (i32.eqz (global.get $ovl_on)) (then (return)))
  (local.set $g (global.get $lgap))
  (local.set $p (i32.add (local.get $g) (i32.const 3)))
  (local.set $x (i32.add (call $lay_x (global.get $LR_GRID)) (local.get $g)))
  (local.set $y (i32.add (call $lay_y (global.get $LR_GRID)) (local.get $g)))
  (local.set $aw (select (i32.sub (call $lay_w (global.get $LR_GRID)) (i32.shl (local.get $g) (i32.const 1)))
    (i32.sub (i32.sub (global.get $fb_w) (local.get $x)) (local.get $g)) (i32.eqz (global.get $scr))))
  (local.set $mx (i32.sub (call $lay_h (global.get $LR_GRID)) (i32.shl (local.get $g) (i32.const 1))))
  ;; measure at the UI text scale; scale 1 when the panel would not fit the viewport
  (global.set $tscale (call $ui_ts))
  (loop $fit
    ;; width: room for 46 characters (the longest label + a 24-character value), not the live
    ;; values, so the panel does not jitter as the numbers change; within the available width
    (local.set $w (call $imin (i32.add (i32.mul (i32.const 276) (global.get $tscale)) (i32.shl (local.get $p) (i32.const 1))) (local.get $aw)))
    (local.set $iw (i32.sub (local.get $w) (i32.shl (local.get $p) (i32.const 1))))
    (local.set $hh (call $imax (call $min_touch) (i32.add (call $lh) (i32.shl (local.get $g) (i32.const 2)))))
    (local.set $sh (i32.const 24))
    (global.set $nodraw (i32.const 1))
    (local.set $h (i32.add (i32.add (local.get $hh) (call $ovl_rows (i32.const 0) (i32.const 0) (local.get $iw)))
      (i32.add (i32.add (local.get $sh) (call $ovl_typ (i32.const 0) (i32.const 0) (local.get $iw))) (i32.shl (local.get $p) (i32.const 1)))))
    (global.set $nodraw (i32.const 0))
    (if (i32.and (i32.gt_s (local.get $h) (local.get $mx)) (i32.gt_s (global.get $tscale) (i32.const 1))) (then
      (global.set $tscale (i32.const 1)) (br $fit))))
  (local.set $ix (i32.add (local.get $x) (local.get $p)))
  (global.set $ov_s (global.get $tscale)) (global.set $ov_r (local.get $x)) (global.set $ov_y (local.get $y)) (global.set $ov_w (local.get $w)) (global.set $ov_h (local.get $h))
  ;; a dark instrument panel: ink face; header "STATS" in wheat, a paper close chip on the right
  (call $panel_c (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 0x3E3D3C))
  (drop (call $txt (local.get $ix) (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $hh) (call $lh)) (i32.const 1)))
    (call $str (global.get $STR_OVL)) (call $pal (i32.const 19))))
  (local.set $t (i32.add (i32.mul (i32.const 9) (global.get $tscale)) (i32.const 6)))
  (local.set $v (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $t) (local.get $p))))
  (local.set $by (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $hh) (local.get $t)) (i32.const 1))))
  (call $rrect (local.get $v) (local.get $by) (local.get $t) (local.get $t) (i32.const 2) (call $pal (i32.const 59)))
  (call $ui_icon (global.get $I_CLOSE) (i32.add (local.get $v) (i32.const 3)) (i32.add (local.get $by) (i32.const 3)) (global.get $tscale))
  (call $hline (i32.add (local.get $x) (i32.const 2)) (i32.add (local.get $y) (local.get $hh)) (i32.sub (local.get $w) (i32.const 4)) (call $pal (i32.const 62)))
  ;; over a screen the body absorbs taps (hit 0x3DB, ignored by $tap): buttons under it stay dead; on the
  ;; farm the panel only covers plots, which keep working through it
  (if (global.get $scr) (then (drop (call $hit_add (local.get $x) (i32.add (local.get $y) (local.get $hh)) (local.get $w) (i32.sub (local.get $h) (local.get $hh)) (i32.const 0x3DB)))))
  (drop (call $hit_add (local.get $x) (local.get $y) (local.get $w) (local.get $hh) (i32.const 0x3DA)))
  (local.set $by (i32.add (i32.add (local.get $y) (local.get $hh)) (local.get $p)))
  (local.set $by (i32.add (local.get $by) (call $ovl_rows (local.get $ix) (local.get $by) (local.get $iw))))
  ;; sparkline across the inner width (1..3 px a sample, newest right): 0..20 ms, the 16.7 ms (60 fps)
  ;; budget as a wheat line; bars over it tomato red
  (local.set $k (call $clamp (i32.div_s (local.get $iw) (i32.const 120)) (i32.const 1) (i32.const 3)))
  (local.set $ix (i32.add (local.get $ix) (i32.shr_s (i32.sub (local.get $iw) (i32.mul (local.get $k) (i32.const 120))) (i32.const 1))))
  (call $rect (local.get $ix) (local.get $by) (i32.mul (local.get $k) (i32.const 120)) (local.get $sh) (call $pal (i32.const 60)))
  (global.set $sp_x (local.get $ix)) (global.set $sp_y (local.get $by)) (global.set $sp_w (i32.mul (local.get $k) (i32.const 120))) (global.set $sp_h (local.get $sh))
  (call $hline (local.get $ix) (i32.sub (i32.add (local.get $by) (local.get $sh)) (i32.div_s (i32.mul (local.get $sh) (i32.const 16667)) (i32.const 20000)))
    (i32.mul (local.get $k) (i32.const 120)) (call $pal (i32.const 18)))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $j) (global.get $fr_n)))
    (local.set $v (call $fr_at (local.get $j)))
    (local.set $t (call $imax (i32.const 1) (i32.div_s (i32.mul (call $imin (local.get $v) (i32.const 20000)) (local.get $sh)) (i32.const 20000))))
    (call $rect (i32.add (local.get $ix) (i32.mul (i32.add (i32.sub (i32.const 120) (global.get $fr_n)) (local.get $j)) (local.get $k)))
      (i32.sub (i32.add (local.get $by) (local.get $sh)) (local.get $t)) (local.get $k) (local.get $t)
      (call $pal (select (i32.const 26) (i32.const 15) (i32.gt_s (local.get $v) (i32.const 16667)))))
    (local.set $j (i32.add (local.get $j) (i32.const 1)))
    (br $l)))
  (drop (call $ovl_typ (i32.add (local.get $x) (local.get $p)) (i32.add (local.get $by) (i32.add (local.get $sh) (local.get $p))) (local.get $iw)))
  (global.set $tscale (call $ui_ts)))

;; Test hook t_ovl(k): 0 on, 1 samples held, 2..5 panel x, y, w, h, 6..9 sparkline x, y, w, h as last
;; drawn, 10: the load line ($s_load) text, 11: the text scale the panel was really drawn at.
(func $t_ovl (param $k i32) (result i32)
  (if (i32.eq (local.get $k) (i32.const 6)) (then (return (global.get $sp_x))))
  (if (i32.eq (local.get $k) (i32.const 7)) (then (return (global.get $sp_y))))
  (if (i32.eq (local.get $k) (i32.const 8)) (then (return (global.get $sp_w))))
  (if (i32.eq (local.get $k) (i32.const 9)) (then (return (global.get $sp_h))))
  (if (i32.eq (local.get $k) (i32.const 10)) (then (call $s_load) (return (global.get $SB1))))
  (if (i32.eq (local.get $k) (i32.const 11)) (then (return (global.get $ov_s))))
  (if (i32.eqz (local.get $k)) (then (return (global.get $ovl_on))))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (return (global.get $fr_n))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (return (global.get $ov_r))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (return (global.get $ov_y))))
  (if (i32.eq (local.get $k) (i32.const 4)) (then (return (global.get $ov_w))))
  (global.get $ov_h))
