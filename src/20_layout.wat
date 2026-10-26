;; Responsive layout engine and hit regions (spec §13, plan Task 4). Pure UI geometry: writes only
;; the R_LAYOUT block below (never the sim state, never the sim RNG).
;;
;; Everything is laid out and hit-tested in LOGICAL framebuffer pixels (the buffer resize() draws).
;; resize() keeps the CSS size; pointer coordinates arrive in CSS px and are converted with
;; $css_to_fb_x/$css_to_fb_y (c * fb / css). $min_touch = ceil(44 css px in logical px) (max of
;; both axes); every interactive rect is >= $min_touch in both dimensions in every mode, size and
;; text size. Large text = UI scale 1.5x (preferred sizes) and $ui_ts() = 2: Task 5 draws all text
;; at integer scale $ui_ts() (glyph advance 6*ts, height 7*ts). Where a label cannot fit its
;; rect at that scale (e.g. 7-letter tab labels at 320 css wide in large mode) draw it at scale 1.
;;
;; R_LAYOUT map (0x8000):
;;   0x8000..0x80FF  rect table: 16 rects x (x, y, w, h : i32), id*16. Rect ids (LR_*):
;;       0 TOPBAR   1 DAYBOX  2 CASHBOX  3 REPBOX  4 HARVALL  5 ENDDAY  6 GRID  7 TABS
;;       8..12 TAB0..TAB4 (Farm Process Market Trucks Build)  13 PANEL  14 PANEL_CLOSE  15 TOAST
;;     Unused/closed rects are all-zero. DAYBOX..ENDDAY lie in TOPBAR (one row, or two rows when
;;     they do not fit: DAY/CASH/REP then HARVALL/ENDDAY; one row = [day cash rep] left and
;;     [harvest end day] right-aligned, widths stretched <= 1.5x). HARVALL's slot is always reserved (shown
;;     only when a crop is ripe). TAB0..4 tile TABS exactly (widths differ by <= 1).
;;     GRID is the rect handed to $scene_viewport. TOAST floats over the top of GRID (non-blocking,
;;     not a hit region; the only rect allowed to overlap another).
;;   0x8100..0x817F  UI block, i32 each:
;;       +00 css_w  +04 css_h  +08 dpr_x100 (as passed to resize, css clamped to 16384)
;;       +0C mode (0 portrait, 1 tablet, 2 laptop/landscape)  +10 min_touch  +14 panel_open
;;       +18 seed  +1C daily_seed (set_env; Task 5 consumes)  +20 cols (panel columns: 2 tablet else 1)
;;       +24 hit_n  +28 hit_static_n   (0x8130..0x817F free for Task 5 UI scalars)
;;   0x8200..0x8BFF  hit table: 128 entries x 20 B (x, y, w, h, code : i32)
;;   0x8C00..0xFFFF  free (Task 5 UI state, toasts, announce buffer ...)
;;
;; Modes (CSS px): LAPTOP = w >= 1024 or (w > 1.2 h and w >= 600): top bar across the top, GRID left
;;   (max 640 css), right column = TABS above PANEL (<= 520 css; pair centred); the panel is always
;;   present. TABLET = 768 <= w < 1024 otherwise. PORTRAIT = the rest. Portrait and tablet: top bar,
;;   GRID full width, tab bar at the bottom; PANEL is a bottom sheet = the lower 45% of the screen
;;   (tab bar included) that exists only while open ($layout_panel(1)); then GRID shrinks to end where
;;   the sheet begins, so the scene re-fits above it and End Day (top bar) stays reachable.
;;   Tablet sheets are two columns ($lay cols = 2).
;;
;; Hit regions: table above; $hit_test returns the code of the LAST added region containing the point
;; (half-open). $layout registers the static chrome (bottom to top): GRID, TOPBAR, PANEL, TABs,
;; PANEL_CLOSE, DAYBOX, ENDDAY and records hit_static_n; Task 5 calls $hit_reset_dyn at the start of
;; each draw pass and adds dynamic buttons (HARVALL when ripe, panel buttons, ...) on top.
;; Codes: HIT_ENDDAY 1, HIT_HARVALL 2, HIT_DAY 3, HIT_CLOSE 4, HIT_PANEL 5 (absorbs taps),
;; HIT_GRID 6 (resolve the tile with $tile_at), HIT_TOPBAR 7 (inert), HIT_TAB0..4 10..14,
;; HIT_TILE 0x100|idx (free for Task 5), HIT_PANEL_BASE 0x200+n (dynamic panel buttons).

(global $flag_large (mut i32) (i32.const 0))

(global $LR_TOPBAR i32 (i32.const 0))
(global $LR_DAYBOX i32 (i32.const 1))
(global $LR_HARVALL i32 (i32.const 4))
(global $LR_ENDDAY i32 (i32.const 5))
(global $LR_GRID i32 (i32.const 6))
(global $LR_TABS i32 (i32.const 7))
(global $LR_TAB0 i32 (i32.const 8))
(global $LR_PANEL i32 (i32.const 13))
(global $LR_CLOSE i32 (i32.const 14))
(global $LR_TOAST i32 (i32.const 15))

(global $HIT_ENDDAY i32 (i32.const 1))
(global $HIT_HARVALL i32 (i32.const 2))
(global $HIT_DAY i32 (i32.const 3))
(global $HIT_CLOSE i32 (i32.const 4))
(global $HIT_PANEL i32 (i32.const 5))
(global $HIT_GRID i32 (i32.const 6))
(global $HIT_TOPBAR i32 (i32.const 7))
(global $HIT_TAB0 i32 (i32.const 10))
(global $HIT_TILE i32 (i32.const 0x100))
(global $HIT_PANEL_BASE i32 (i32.const 0x200))

(global $L_CSSW i32 (i32.const 0x100))
(global $L_CSSH i32 (i32.const 0x104))
(global $L_MODE i32 (i32.const 0x10C))
(global $L_MT i32 (i32.const 0x110))
(global $L_OPEN i32 (i32.const 0x114))
(global $L_SEED i32 (i32.const 0x118))
(global $L_DSEED i32 (i32.const 0x11C))
(global $L_COLS i32 (i32.const 0x120))
(global $L_HITN i32 (i32.const 0x124))
(global $L_HITS i32 (i32.const 0x128))
(global $L_HIT i32 (i32.const 0x200))
(global $lgap (mut i32) (i32.const 2))

(func $lget (param $o i32) (result i32) (i32.load (i32.add (global.get $R_LAYOUT) (local.get $o))))
(func $lput (param $o i32) (param $v i32) (i32.store (i32.add (global.get $R_LAYOUT) (local.get $o)) (local.get $v)))
(func $imax (param $a i32) (param $b i32) (result i32) (select (local.get $a) (local.get $b) (i32.gt_s (local.get $a) (local.get $b))))
(func $imin (param $a i32) (param $b i32) (result i32) (select (local.get $a) (local.get $b) (i32.lt_s (local.get $a) (local.get $b))))
(func $cdiv (param $a i32) (param $b i32) (result i32)
  (i32.div_u (i32.sub (i32.add (local.get $a) (local.get $b)) (i32.const 1)) (local.get $b)))

(func $lay_x (param $id i32) (result i32) (i32.load (i32.add (global.get $R_LAYOUT) (i32.shl (local.get $id) (i32.const 4)))))
(func $lay_y (param $id i32) (result i32) (i32.load offset=4 (i32.add (global.get $R_LAYOUT) (i32.shl (local.get $id) (i32.const 4)))))
(func $lay_w (param $id i32) (result i32) (i32.load offset=8 (i32.add (global.get $R_LAYOUT) (i32.shl (local.get $id) (i32.const 4)))))
(func $lay_h (param $id i32) (result i32) (i32.load offset=12 (i32.add (global.get $R_LAYOUT) (i32.shl (local.get $id) (i32.const 4)))))
(func $setr (param $id i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32)
  (local $p i32)
  (local.set $p (i32.add (global.get $R_LAYOUT) (i32.shl (local.get $id) (i32.const 4))))
  (i32.store (local.get $p) (local.get $x))
  (i32.store offset=4 (local.get $p) (local.get $y))
  (i32.store offset=8 (local.get $p) (local.get $w))
  (i32.store offset=12 (local.get $p) (local.get $h)))

;; UI text scale: 1 normally, 2 in large-text mode.
(func $ui_ts (result i32) (i32.add (i32.const 1) (global.get $flag_large)))
(func $min_touch (result i32) (call $lget (global.get $L_MT)))
(func $css_to_fb_x (param $c i32) (result i32)
  (if (result i32) (call $lget (global.get $L_CSSW))
    (then (i32.div_s (i32.mul (local.get $c) (global.get $fb_w)) (call $lget (global.get $L_CSSW))))
    (else (local.get $c))))
(func $css_to_fb_y (param $c i32) (result i32)
  (if (result i32) (call $lget (global.get $L_CSSH))
    (then (i32.div_s (i32.mul (local.get $c) (global.get $fb_h)) (call $lget (global.get $L_CSSH))))
    (else (local.get $c))))

;; css px * k/2 -> logical px, rounded up (k = 2 plain, 3 = large-text 1.5x). Needs css_w > 0.
(func $cu (param $v i32) (param $k i32) (result i32)
  (call $cdiv (i32.mul (i32.mul (local.get $v) (local.get $k)) (global.get $fb_w))
              (i32.shl (call $lget (global.get $L_CSSW)) (i32.const 1))))
(func $S (param $v i32) (result i32) (call $cu (local.get $v) (i32.add (i32.const 2) (global.get $flag_large))))

;; Spread n consecutive rects (widths preset in the table) over [x, x+avail) in one row, scaling
;; the widths to fill it (the last takes the remainder) with $lgap between them.
(func $spread (param $id i32) (param $n i32) (param $x i32) (param $y i32) (param $h i32) (param $avail i32)
  (local $i i32) (local $sum i32) (local $tot i32) (local $w i32) (local $cx i32)
  (local.set $tot (i32.sub (local.get $avail) (i32.mul (i32.sub (local.get $n) (i32.const 1)) (global.get $lgap))))
  (local.set $i (i32.const 0))
  (loop $s
    (local.set $sum (i32.add (local.get $sum) (call $lay_w (i32.add (local.get $id) (local.get $i)))))
    (br_if $s (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $n))))
  (local.set $cx (local.get $x))
  (local.set $i (i32.const 0))
  (loop $r
    (if (i32.eq (i32.add (local.get $i) (i32.const 1)) (local.get $n))
      (then (local.set $w (i32.sub (i32.add (local.get $x) (local.get $avail)) (local.get $cx))))
      (else (local.set $w (i32.div_u (i32.mul (call $lay_w (i32.add (local.get $id) (local.get $i))) (local.get $tot)) (local.get $sum)))))
    (call $setr (i32.add (local.get $id) (local.get $i)) (local.get $cx) (local.get $y) (local.get $w) (local.get $h))
    (local.set $cx (i32.add (i32.add (local.get $cx) (local.get $w)) (global.get $lgap)))
    (br_if $r (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $n)))))

;; ---------------------------------------------------------------- hit regions
(func $hit_clear (call $lput (global.get $L_HITN) (i32.const 0)) (call $lput (global.get $L_HITS) (i32.const 0)))
(func $hit_reset_dyn (call $lput (global.get $L_HITN) (call $lget (global.get $L_HITS))))
(func $hit_n (result i32) (call $lget (global.get $L_HITN)))
(func $hit_add (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $code i32) (result i32)
  (local $n i32) (local $p i32)
  (local.set $n (call $lget (global.get $L_HITN)))
  (if (i32.ge_u (local.get $n) (i32.const 128)) (then (return (i32.const 1))))
  (local.set $p (i32.add (i32.add (global.get $R_LAYOUT) (global.get $L_HIT)) (i32.mul (local.get $n) (i32.const 20))))
  (i32.store (local.get $p) (local.get $x))
  (i32.store offset=4 (local.get $p) (local.get $y))
  (i32.store offset=8 (local.get $p) (local.get $w))
  (i32.store offset=12 (local.get $p) (local.get $h))
  (i32.store offset=16 (local.get $p) (local.get $code))
  (call $lput (global.get $L_HITN) (i32.add (local.get $n) (i32.const 1)))
  (i32.const 0))
;; Code of the topmost (last added) region containing the logical point, else 0.
(func $hit_test (param $x i32) (param $y i32) (result i32)
  (local $n i32) (local $p i32)
  (local.set $n (call $lget (global.get $L_HITN)))
  (loop $l
    (if (local.get $n) (then
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (local.set $p (i32.add (i32.add (global.get $R_LAYOUT) (global.get $L_HIT)) (i32.mul (local.get $n) (i32.const 20))))
      (if (i32.and
            (i32.and (i32.ge_s (local.get $x) (i32.load (local.get $p))) (i32.ge_s (local.get $y) (i32.load offset=4 (local.get $p))))
            (i32.and (i32.lt_s (i32.sub (local.get $x) (i32.load (local.get $p))) (i32.load offset=8 (local.get $p)))
                     (i32.lt_s (i32.sub (local.get $y) (i32.load offset=4 (local.get $p))) (i32.load offset=12 (local.get $p)))))
        (then (return (i32.load offset=16 (local.get $p)))))
      (br $l))))
  (i32.const 0))
;; Register layout rect id as a hit region (skipped while empty).
(func $hit_rect (param $id i32) (param $code i32)
  (if (call $lay_w (local.get $id))
    (then (drop (call $hit_add (call $lay_x (local.get $id)) (call $lay_y (local.get $id))
                               (call $lay_w (local.get $id)) (call $lay_h (local.get $id)) (local.get $code))))))

;; ---------------------------------------------------------------- layout
(func $layout
  (local $W i32) (local $H i32) (local $cw i32) (local $ch i32) (local $g i32) (local $mt i32) (local $ts i32)
  (local $chw i32) (local $rh i32) (local $mode i32) (local $sx i32) (local $sw i32) (local $gw i32)
  (local $colw i32) (local $ws i32) (local $xs i32) (local $two i32) (local $top i32) (local $tabh i32)
  (local $ty i32) (local $ph i32) (local $i i32) (local $x i32) (local $nx i32) (local $bs i32) (local $sum i32)
  (local.set $W (global.get $fb_w)) (local.set $H (global.get $fb_h))
  (local.set $cw (call $lget (global.get $L_CSSW))) (local.set $ch (call $lget (global.get $L_CSSH)))
  (memory.fill (global.get $R_LAYOUT) (i32.const 0) (i32.const 0x100))
  (call $hit_clear)
  (global.set $dirty (i32.const 1))
  (if (i32.or (i32.or (i32.eqz (local.get $W)) (i32.eqz (local.get $H))) (i32.or (i32.eqz (local.get $cw)) (i32.eqz (local.get $ch))))
    (then (return)))
  (local.set $ts (call $ui_ts))
  (local.set $g (call $imax (i32.const 2) (call $S (i32.const 4))))
  (global.set $lgap (local.get $g))
  (local.set $mt (call $imax
    (call $cdiv (i32.mul (i32.const 44) (local.get $W)) (local.get $cw))
    (call $cdiv (i32.mul (i32.const 44) (local.get $H)) (local.get $ch))))
  (call $lput (global.get $L_MT) (local.get $mt))
  (local.set $mode (select (i32.const 2)
    (select (i32.const 1) (i32.const 0) (i32.ge_u (local.get $cw) (i32.const 768)))
    (i32.or (i32.ge_u (local.get $cw) (i32.const 1024))
            (i32.and (i32.gt_u (i32.mul (local.get $cw) (i32.const 5)) (i32.mul (local.get $ch) (i32.const 6)))
                     (i32.ge_u (local.get $cw) (i32.const 600))))))
  (call $lput (global.get $L_MODE) (local.get $mode))
  (call $lput (global.get $L_COLS) (i32.add (i32.const 1) (i32.eq (local.get $mode) (i32.const 1))))
  (local.set $chw (i32.mul (i32.const 6) (local.get $ts)))
  (local.set $rh (call $imax (call $imax (call $S (i32.const 48)) (local.get $mt))
                             (i32.add (i32.mul (i32.const 7) (local.get $ts)) (i32.add (i32.shl (local.get $g) (i32.const 1)) (i32.const 2)))))
  (local.set $tabh (call $imax (call $S (i32.const 52)) (local.get $mt)))
  ;; horizontal span holding the content (laptop: centred grid + column pair)
  (local.set $sw (local.get $W))
  (if (i32.eq (local.get $mode) (i32.const 2))
    (then
      (local.set $colw (call $imax (i32.div_u (i32.mul (local.get $W) (i32.const 45)) (i32.const 100))
                                   (i32.add (i32.mul (i32.const 5) (local.get $mt)) (i32.shl (local.get $g) (i32.const 1)))))
      (local.set $gw (i32.sub (local.get $W) (local.get $colw)))
      (if (i32.gt_s (local.get $gw) (call $cu (i32.const 640) (i32.const 2)))
        (then
          (local.set $gw (call $cu (i32.const 640) (i32.const 2)))
          (local.set $colw (call $imin (i32.sub (local.get $W) (local.get $gw))
            (call $imax (call $cu (i32.const 520) (i32.const 2))
                        (i32.add (i32.mul (i32.const 5) (local.get $mt)) (i32.shl (local.get $g) (i32.const 1))))))))
      (local.set $sw (i32.add (local.get $gw) (local.get $colw)))
      (local.set $sx (i32.shr_u (i32.sub (local.get $W) (local.get $sw)) (i32.const 1)))))
  (local.set $ws (local.get $sw))
  (local.set $xs (i32.add (local.get $sx) (i32.shr_u (i32.sub (local.get $sw) (local.get $ws)) (i32.const 1))))
  ;; top bar items: preferred widths (chars: day 9, cash 8, rep 4, harvest 9, end day 8)
  (call $setr (i32.const 1) (i32.const 0) (i32.const 0) (call $imax (local.get $mt) (i32.add (i32.mul (i32.const 9) (local.get $chw)) (i32.shl (local.get $g) (i32.const 1)))) (i32.const 0))
  (call $setr (i32.const 2) (i32.const 0) (i32.const 0) (call $imax (local.get $mt) (i32.add (i32.mul (i32.const 8) (local.get $chw)) (i32.shl (local.get $g) (i32.const 1)))) (i32.const 0))
  (call $setr (i32.const 3) (i32.const 0) (i32.const 0) (call $imax (local.get $mt) (i32.add (i32.mul (i32.const 4) (local.get $chw)) (i32.shl (local.get $g) (i32.const 1)))) (i32.const 0))
  (call $setr (i32.const 4) (i32.const 0) (i32.const 0) (call $imax (local.get $mt) (i32.add (i32.mul (i32.const 9) (local.get $chw)) (i32.shl (local.get $g) (i32.const 1)))) (i32.const 0))
  (call $setr (i32.const 5) (i32.const 0) (i32.const 0) (call $imax (local.get $mt) (i32.add (i32.mul (i32.const 8) (local.get $chw)) (i32.shl (local.get $g) (i32.const 1)))) (i32.const 0))
  (local.set $i (i32.const 1))
  (loop $sm
    (local.set $sum (i32.add (local.get $sum) (call $lay_w (local.get $i))))
    (br_if $sm (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 6))))
  (local.set $two (i32.gt_u (i32.add (local.get $sum) (i32.mul (local.get $g) (i32.const 6))) (local.get $ws)))
  (local.set $top (i32.add (i32.mul (i32.add (i32.const 1) (local.get $two)) (local.get $rh))
                           (i32.mul (i32.add (i32.const 2) (local.get $two)) (local.get $g))))
  (call $setr (global.get $LR_TOPBAR) (i32.const 0) (i32.const 0) (local.get $W) (local.get $top))
  (if (local.get $two)
    (then
      (call $spread (i32.const 1) (i32.const 3) (i32.add (local.get $xs) (local.get $g)) (local.get $g) (local.get $rh) (i32.sub (local.get $ws) (i32.shl (local.get $g) (i32.const 1))))
      (call $spread (i32.const 4) (i32.const 2) (i32.add (local.get $xs) (local.get $g)) (i32.add (local.get $rh) (i32.shl (local.get $g) (i32.const 1))) (local.get $rh) (i32.sub (local.get $ws) (i32.shl (local.get $g) (i32.const 1)))))
    (else
      ;; one row: [day cash rep] left, [harvest end day] right-aligned, widths stretched by <= 1.5x
      (local.set $bs (call $imin (i32.sub (local.get $ws) (i32.mul (local.get $g) (i32.const 6)))
                                 (i32.shr_u (i32.mul (local.get $sum) (i32.const 3)) (i32.const 1))))
      (local.set $nx (i32.div_u (i32.mul (local.get $bs) (i32.add (i32.add (call $lay_w (i32.const 1)) (call $lay_w (i32.const 2))) (call $lay_w (i32.const 3)))) (local.get $sum)))
      (call $spread (i32.const 1) (i32.const 3) (i32.add (local.get $xs) (local.get $g)) (local.get $g) (local.get $rh)
                    (i32.add (local.get $nx) (i32.shl (local.get $g) (i32.const 1))))
      (local.set $bs (i32.add (i32.sub (local.get $bs) (local.get $nx)) (local.get $g)))
      (call $spread (i32.const 4) (i32.const 2) (i32.sub (i32.add (local.get $xs) (i32.sub (local.get $ws) (local.get $g))) (local.get $bs))
                    (local.get $g) (local.get $rh) (local.get $bs))))
  (local.set $ph (call $imax (i32.sub (local.get $H) (local.get $top)) (i32.const 0)))   ;; content height
  (if (i32.eq (local.get $mode) (i32.const 2))
    (then
      (call $setr (global.get $LR_GRID) (local.get $sx) (local.get $top) (local.get $gw) (local.get $ph))
      (call $setr (global.get $LR_TABS) (i32.add (local.get $sx) (local.get $gw)) (local.get $top) (local.get $colw) (local.get $tabh))
      (call $setr (global.get $LR_PANEL) (i32.add (local.get $sx) (local.get $gw)) (i32.add (local.get $top) (local.get $tabh))
                  (local.get $colw) (call $imax (i32.sub (local.get $ph) (local.get $tabh)) (i32.const 0))))
    (else
      (local.set $ty (call $imax (i32.sub (local.get $H) (local.get $tabh)) (local.get $top)))
      (call $setr (global.get $LR_TABS) (i32.const 0) (local.get $ty) (local.get $W) (i32.sub (local.get $H) (local.get $ty)))
      (local.set $ph (i32.sub (local.get $ty) (local.get $top)))                       ;; grid height, panel closed
      (if (call $lget (global.get $L_OPEN))
        (then
          (local.set $i (call $imax (i32.sub (i32.div_u (i32.mul (local.get $H) (i32.const 45)) (i32.const 100)) (local.get $tabh))
                                    (i32.add (local.get $mt) (i32.shl (local.get $g) (i32.const 1)))))
          (local.set $i (call $imin (local.get $i) (local.get $ph)))
          (call $setr (global.get $LR_PANEL) (i32.const 0) (i32.sub (local.get $ty) (local.get $i)) (local.get $W) (local.get $i))
          (local.set $ph (i32.sub (local.get $ph) (local.get $i)))))
      (call $setr (global.get $LR_GRID) (i32.const 0) (local.get $top) (local.get $W) (local.get $ph))))
  ;; five tabs tile the bar exactly
  (local.set $sw (call $lay_w (global.get $LR_TABS)))
  (local.set $x (call $lay_x (global.get $LR_TABS)))
  (local.set $i (i32.const 0))
  (loop $t
    (local.set $nx (i32.add (call $lay_x (global.get $LR_TABS)) (i32.div_u (i32.mul (i32.add (local.get $i) (i32.const 1)) (local.get $sw)) (i32.const 5))))
    (call $setr (i32.add (global.get $LR_TAB0) (local.get $i)) (local.get $x) (call $lay_y (global.get $LR_TABS))
                (i32.sub (local.get $nx) (local.get $x)) (call $lay_h (global.get $LR_TABS)))
    (local.set $x (local.get $nx))
    (br_if $t (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 5))))
  ;; panel close button (top right of the panel) and the toast (top of the grid)
  (if (call $lay_w (global.get $LR_PANEL))
    (then
      (local.set $bs (call $imax (local.get $mt) (call $S (i32.const 36))))
      (call $setr (global.get $LR_CLOSE)
        (i32.sub (i32.add (call $lay_x (global.get $LR_PANEL)) (call $lay_w (global.get $LR_PANEL))) (i32.add (local.get $bs) (local.get $g)))
        (i32.add (call $lay_y (global.get $LR_PANEL)) (local.get $g)) (local.get $bs) (local.get $bs))))
  (local.set $bs (call $imin (i32.sub (call $lay_w (global.get $LR_GRID)) (i32.shl (local.get $g) (i32.const 1))) (call $S (i32.const 360))))
  (if (i32.gt_s (local.get $bs) (i32.const 0))
    (then (call $setr (global.get $LR_TOAST)
      (i32.add (call $lay_x (global.get $LR_GRID)) (i32.shr_u (i32.sub (call $lay_w (global.get $LR_GRID)) (local.get $bs)) (i32.const 1)))
      (i32.add (call $lay_y (global.get $LR_GRID)) (local.get $g)) (local.get $bs)
      (i32.add (i32.mul (i32.const 2) (i32.add (i32.mul (i32.const 7) (local.get $ts)) (local.get $g))) (local.get $g)))))
  ;; static chrome hit regions, bottom to top
  (call $hit_rect (global.get $LR_GRID) (global.get $HIT_GRID))
  (call $hit_rect (global.get $LR_TOPBAR) (global.get $HIT_TOPBAR))
  (call $hit_rect (global.get $LR_PANEL) (global.get $HIT_PANEL))
  (local.set $i (i32.const 0))
  (loop $h
    (call $hit_rect (i32.add (global.get $LR_TAB0) (local.get $i)) (i32.add (global.get $HIT_TAB0) (local.get $i)))
    (br_if $h (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 5))))
  (call $hit_rect (global.get $LR_CLOSE) (global.get $HIT_CLOSE))
  (call $hit_rect (global.get $LR_DAYBOX) (global.get $HIT_DAY))
  (call $hit_rect (global.get $LR_ENDDAY) (global.get $HIT_ENDDAY))
  (call $lput (global.get $L_HITS) (call $lget (global.get $L_HITN)))
  (call $scene_viewport (call $lay_x (global.get $LR_GRID)) (call $lay_y (global.get $LR_GRID))
                        (call $lay_w (global.get $LR_GRID)) (call $lay_h (global.get $LR_GRID))))

;; Open (1) / close (0) the bottom sheet (portrait + tablet; ignored in laptop mode) and relayout.
(func $layout_panel (param $open i32)
  (call $lput (global.get $L_OPEN) (i32.ne (local.get $open) (i32.const 0)))
  (call $layout))

;; Exports: loader/Task 5 entry points.
(func $set_flags (param $reduced i32) (param $large i32)
  (global.set $flag_reduced (i32.ne (local.get $reduced) (i32.const 0)))
  (global.set $flag_large (i32.ne (local.get $large) (i32.const 0)))
  (call $layout))
(func $set_env (param $seed i32) (param $daily i32)
  (call $lput (global.get $L_SEED) (local.get $seed))
  (call $lput (global.get $L_DSEED) (local.get $daily)))
(func $t_mode (result i32) (call $lget (global.get $L_MODE)))
(func $t_panel_open (result i32) (call $lget (global.get $L_OPEN)))
