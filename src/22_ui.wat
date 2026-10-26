;; UI kit, input state machine, frame loop, toasts and the announce buffer (spec §13, §14.3;
;; plan Task 5a). Screens live in 22a_farm.wat. Pure presentation: reads the sim state and
;; changes it only through $act / $end_day / $init; never calls the sim RNG. All UI state is
;; wasm globals plus the R_LAYOUT block below, never the save image.
;;
;; R_LAYOUT use (absolute addresses; 0x8000..0x8BFF is 20_layout.wat):
;;   0x8C00..0x8CFF  four 64 B text builders SB0..SB3 ($sb / $sc / $ss / $si / $sn)
;;   0x8D00          8 zero bytes (an empty tile record for the 3D icon renderer; never written)
;;   0x8D10..0x8DCF  toasts: 3 x 64 B {t0 i32 (-1 = stamp at the next frame), kind i32
;;                   (0 none, 1 info, 2 error, 3 good), text 56 B}; slot 0 is the oldest
;;   0x8E00..0x8FFF  announce ring (512 B): each message is written after the previous one,
;;                   wrapping to the start; announce_ptr/len point at the latest, announce_seq
;;                   counts messages (the loader mirrors it into an aria-live region)
;;   0x9000..0x99FF  draw list of the buttons drawn this frame: 40 x 64 B {code i32, enabled i32,
;;                   label 28 B, reason 28 B} (tests read it; taps on disabled buttons toast the reason)
;;   0x9A00..0x9A3F  $ui_wrap line buffer
;; Static data at 0x0900 (00_memory.wat): button styles (6 x 5 palette indices: border, face,
;; pressed face, text, second line) and the season -> icon map at 0x0920.
;;
;; Frame loop (ruling C5): frame(now_ms) draws when something is dirty or moving and returns
;; 1 while a slide / press / shake / rain or storm particles need the next frame, 2 when only
;; static timers (a toast on screen, an armed TAP AGAIN) or ambient motion (clouds, sway) run
;; (loader re-calls after ~83 ms), 0 when idle under reduced motion. Draws never change the sim
;; state. Timers store -1 = "starts at the next frame" because pointer/key events carry no
;; timestamp.
;;
;; Input (one path for touch and mouse; all thresholds in CSS px): idle -> pressed (down) ->
;; drag once the pointer leaves an 8 px slop, else tap on up (buttons: only when released inside
;; the pressed button, however long it was held); a press held 300 ms (frame timestamps) on a
;; plot is a long press (tile info toast, no tap). Two-step buttons (DEMOLISH) ignore their
;; confirming tap for 400 ms after arming and disarm after 3 s. A drag that starts in the
;; sheet scrolls it; on a portrait/tablet sheet scrolled to the top, a downward drag >= 40 px
;; dismisses it. Moves with no button pressed are hover (laptop: tile highlight + status line).
;; Before a press is resolved against the hit table, a dirty UI is redrawn so the regions match
;; what the player sees; relayouts (open/close/resize/refit) clear the dynamic regions.
;;
;; Keys (key(code, down); loader maps KeyboardEvent.code via tools/keycodes.json):
;;   1 KeyE end day    2 KeyH harvest all    3..7 Digit1..5 tabs (only Farm exists in 5a)
;;   8 Escape close    9 ArrowUp 10 ArrowDown 11 ArrowLeft 12 ArrowRight: move the tile cursor
;;   (Right/Left = +-x, Down/Up = +-y on the board, clamped to the owned grid + the next ring)
;;   13 Enter / 16 Space open the selected plot    14 Backquote (stats, Task 7)    15 KeyR (replay, Task 7)
;;   Auto-repeat: a key acts once per press. A down (any non-zero value) for a code already held
;;   is ignored until its up (down = 0); codes >= 32 are ignored. The loader should also drop
;;   events with event.repeat and send an up for held keys on window blur.

(global $now (mut i32) (i32.const 0))
(global $dirty (mut i32) (i32.const 1))
(global $want_save (mut i32) (i32.const 0))
(global $sheet (mut i32) (i32.const 0))        ;; bottom sheet open (laptop: the side panel always shows)
(global $pick (mut i32) (i32.const 0))         ;; empty plot: 0 crop picker, 1 build picker
(global $scroll (mut i32) (i32.const 0))
(global $scroll_max (mut i32) (i32.const 0))
(global $slide_t (mut i32) (i32.const -2))     ;; -2 none, -1 pending, else start time
(global $slide_p (mut i32) (i32.const 256))    ;; sheet slide progress 0..256
(global $shake_t (mut i32) (i32.const -2))
(global $arm (mut i32) (i32.const 0))          ;; armed two-step button code (demolish)
(global $arm_t (mut i32) (i32.const 0))
(global $arm_lv (mut i32) (i32.const 0))       ;; $arm_live as last drawn
(global $keys (mut i32) (i32.const 0))         ;; held key codes (bit per code < 32): auto-repeat filter
(global $in_st (mut i32) (i32.const 0))        ;; 0 idle, 1 pressed, 2 drag
(global $in_x (mut i32) (i32.const 0))         ;; down position, css
(global $in_y (mut i32) (i32.const 0))
(global $in_lx (mut i32) (i32.const 0))        ;; down position, logical
(global $in_ly (mut i32) (i32.const 0))
(global $in_t (mut i32) (i32.const 0))
(global $in_code (mut i32) (i32.const 0))
(global $in_lp (mut i32) (i32.const 0))
(global $in_s0 (mut i32) (i32.const 0))
(global $press (mut i32) (i32.const 0))        ;; code drawn pressed
(global $ann_seq (mut i32) (i32.const 0))
(global $ann_p (mut i32) (i32.const 0x8E00))
(global $ann_len (mut i32) (i32.const 0))
(global $btn_n (mut i32) (i32.const 0))
(global $sbp (mut i32) (i32.const 0x8C00))
(global $sb0 (mut i32) (i32.const 0x8C00))
(global $sblim (mut i32) (i32.const 55))       ;; builder capacity in chars (27 for draw-list fields)
(global $b_sub (mut i32) (i32.const 0))        ;; $btn extras, reset by every $btn
(global $b_right (mut i32) (i32.const 0))
(global $b_why (mut i32) (i32.const 0))
(global $b_row (mut i32) (i32.const 0))
(global $nodraw (mut i32) (i32.const 0))       ;; $ui_wrap measures only
(global $SB0 i32 (i32.const 0x8C00))
(global $SB1 i32 (i32.const 0x8C40))
(global $SB2 i32 (i32.const 0x8C80))
(global $SB3 i32 (i32.const 0x8CC0))
(global $TOASTS i32 (i32.const 0x8D10))
(global $WRAPBUF i32 (i32.const 0x9A00))
(global $BTNS i32 (i32.const 0x9000))

;; Button styles: border, face, pressed face, text, second line (palette idx = hue*4+step).
;;   0 card (paper)  1 primary (barn red)  2 go (green)  3 toggle on (ink)  4 danger  5 disabled
(data (i32.const 0x900)
  "\3d\3b\3a\3d\3f" "\24\26\25\3b\3a" "\08\09\08\3b\3a" "\3c\3e\3d\3b\3a" "\24\19\25\3b\3a" "\2e\39\39\3f\25"
  "\00\00"
  "\08\02\09\06")                              ;; 0x920 season -> icon: sprout, sun, leaf, snowflake

;; ---------------------------------------------------------------- strings and text building

;; Pointer to string id (the table at 0x7700 is walked; ids are small). Ids outside
;; [0, STR_COUNT) give the empty string at 0x8D00 (never written).
(func $str (param $id i32) (result i32)
  (local $p i32)
  (if (i32.ge_u (local.get $id) (global.get $STR_COUNT)) (then (return (i32.const 0x8D00))))
  (local.set $p (i32.const 0x7700))
  (block $d (loop $l
    (br_if $d (i32.eqz (local.get $id)))
    (loop $s
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $s (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))))
    (local.set $id (i32.sub (local.get $id) (i32.const 1)))
    (br $l)))
  (local.get $p))

(func $strlen (param $p i32) (result i32)
  (local $n i32)
  (block $d (loop $l
    (br_if $d (i32.eqz (i32.load8_u (i32.add (local.get $p) (local.get $n)))))
    (local.set $n (i32.add (local.get $n) (i32.const 1)))
    (br $l)))
  (local.get $n))

;; Text builder: $sb(buf) starts an empty string in buf (<= 55 chars, always terminated).
(func $sb (param $b i32)
  (global.set $sb0 (local.get $b)) (global.set $sbp (local.get $b))
  (i32.store8 (local.get $b) (i32.const 0)))
(func $sc (param $c i32)
  (if (i32.lt_u (i32.sub (global.get $sbp) (global.get $sb0)) (global.get $sblim)) (then
    (i32.store8 (global.get $sbp) (local.get $c))
    (global.set $sbp (i32.add (global.get $sbp) (i32.const 1)))
    (i32.store8 (global.get $sbp) (i32.const 0)))))
(func $ss (param $p i32)
  (block $d (loop $l
    (br_if $d (i32.eqz (i32.load8_u (local.get $p))))
    (call $sc (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (br $l))))
(func $si (param $id i32) (call $ss (call $str (local.get $id))))
;; Decimal n; money = 1 adds "$" and thousands commas ("-$1,234"). Unsigned digit loop, so
;; INT_MIN prints too.
(func $sn (param $n i32) (param $money i32)
  (local $p i32)
  (if (i32.lt_s (local.get $n) (i32.const 0))
    (then (call $sc (i32.const 45)) (local.set $n (i32.sub (i32.const 0) (local.get $n)))))
  (if (local.get $money) (then (call $sc (i32.const 36))))
  (local.set $p (i32.const 1))
  (loop $f
    (if (i32.ge_u (i32.div_u (local.get $n) (local.get $p)) (i32.const 10))
      (then (local.set $p (i32.mul (local.get $p) (i32.const 10))) (br $f))))
  (loop $d
    (call $sc (i32.add (i32.const 48) (i32.rem_u (i32.div_u (local.get $n) (local.get $p)) (i32.const 10))))
    (if (i32.and (local.get $money)
          (i32.or (i32.eq (local.get $p) (i32.const 1000))
                  (i32.or (i32.eq (local.get $p) (i32.const 1000000)) (i32.eq (local.get $p) (i32.const 1000000000)))))
      (then (call $sc (i32.const 44))))
    (local.set $p (i32.div_u (local.get $p) (i32.const 10)))
    (br_if $d (local.get $p))))
(func $sep (call $si (global.get $STR_SEP)))
;; "n DAYS" / "1 DAY"
(func $s_days (param $n i32)
  (call $sn (local.get $n) (i32.const 0))
  (call $si (select (global.get $STR_DAY1) (global.get $STR_DAYS) (i32.eq (local.get $n) (i32.const 1)))))

;; Error code -> message string.
(func $err_str (param $e i32) (result i32)
  (call $str (i32.add (global.get $STR_ERR) (call $clamp (local.get $e) (i32.const 0) (i32.const 19)))))

;; ---------------------------------------------------------------- drawing kit

(func $txt (param $x i32) (param $y i32) (param $s i32) (param $c i32) (result i32)
  (call $text (local.get $x) (local.get $y) (local.get $s) (local.get $c) (i32.const 0)))
(func $tw (param $s i32) (result i32) (call $text_w (local.get $s) (i32.const 0)))
(func $lh (result i32) (i32.mul (i32.const 7) (global.get $tscale)))
;; Text scale for a string that must fit avail px: $ui_ts, or 1 when it does not fit.
(func $fit (param $s i32) (param $avail i32)
  (global.set $tscale (call $ui_ts))
  (if (i32.gt_s (call $tw (local.get $s)) (local.get $avail)) (then (global.set $tscale (i32.const 1)))))

;; Icon id < 64: 9x9 glyph at scale s (9s px square). 64 + crop / 80 + building: a tiny 3D model
;; of the farm object on a grass slab inside an s x s box (the scene's own model renderer);
;; 78 / 79: the bare grass / tilled slab (wild land / empty plot).
(func $ui_icon (param $id i32) (param $x i32) (param $y i32) (param $s i32)
  (local $p i32) (local $n i32) (local $v i32) (local $m i32) (local $h i32) (local $hw i32) (local $se i32)
  (if (i32.ge_u (local.get $id) (i32.const 64)) (then
    (local.set $m (select (i32.add (i32.mul (i32.sub (local.get $id) (i32.const 64)) (i32.const 3)) (i32.const 2))
                          (i32.sub (local.get $id) (i32.const 65)) (i32.lt_u (local.get $id) (i32.const 80))))
    ;; 78 / 79: a bare grass / tilled-soil plot (wild land, empty plot)
    (if (i32.ge_u (i32.sub (local.get $id) (i32.const 78)) (i32.const 2)) (then (local.set $h (call $mheight (local.get $m)))))
    ;; diamond 2hw wide; height hw + (h + 2) hw / 16 (slab 2 units under the model)
    (local.set $hw (i32.div_u (i32.shl (local.get $s) (i32.const 4)) (i32.add (local.get $h) (i32.const 34))))
    (local.set $se (global.get $sc_sea))
    (global.set $sc_sea (i32.const 1)) (global.set $sway (i32.const 0)) (global.set $rot (i32.const 0))
    (global.set $cur_p (i32.const 0x8D00))
    (call $mc (i32.lt_u (local.get $id) (i32.const 80)) (i32.const 0) (i32.const 0) (i32.const 0))
    (global.set $cy0 (global.get $clip_t)) (global.set $cy1 (global.get $clip_b))
    (call $iso_set (i32.add (local.get $x) (i32.shr_u (local.get $s) (i32.const 1)))
      (i32.add (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $s)
          (i32.add (local.get $hw) (i32.shr_u (i32.mul (i32.add (local.get $h) (i32.const 2)) (local.get $hw)) (i32.const 4)))) (i32.const 1)))
        (i32.shr_u (i32.mul (local.get $h) (local.get $hw)) (i32.const 4)))
      (local.get $hw))
    (call $iso_box (i32.const 0) (i32.const 0) (i32.const -2) (i32.const 16) (i32.const 16) (i32.const 2)
      (select (global.get $H_TILLED) (global.get $H_GRASS) (i32.eq (local.get $id) (i32.const 79))))
    (if (i32.eqz (local.get $h)) (then (local.set $h (i32.ge_u (i32.sub (local.get $id) (i32.const 78)) (i32.const 2)))))
    (if (local.get $h) (then (call $model (local.get $m) (i32.const 0) (i32.const 0) (i32.const 1))))
    (global.set $cy0 (i32.const -0x3FFFFFFF)) (global.set $cy1 (i32.const 0x3FFFFFFF))
    (global.set $sc_sea (local.get $se))
    (return)))
  (local.set $p (i32.add (i32.const 0x640) (i32.mul (local.get $id) (i32.const 24))))
  (loop $l
    (local.set $v (i32.and (i32.shr_u (i32.load8_u (i32.add (local.get $p) (i32.shr_u (local.get $n) (i32.const 2))))
                                      (i32.shl (i32.and (local.get $n) (i32.const 3)) (i32.const 1))) (i32.const 3)))
    (if (local.get $v) (then
      (call $rect (i32.add (local.get $x) (i32.mul (i32.rem_u (local.get $n) (i32.const 9)) (local.get $s)))
                  (i32.add (local.get $y) (i32.mul (i32.div_u (local.get $n) (i32.const 9)) (local.get $s)))
                  (local.get $s) (local.get $s)
                  (call $pal (i32.load8_u (i32.add (i32.add (local.get $p) (i32.const 20)) (local.get $v)))))))
    (br_if $l (i32.lt_u (local.tee $n (i32.add (local.get $n) (i32.const 1))) (i32.const 81)))))

;; Paper panel: ink border, 2 px rounded corners, a light top edge.
(func $ui_panel (param $x i32) (param $y i32) (param $w i32) (param $h i32)
  (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 3) (call $pal (i32.const 61)))
  (call $rrect (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1))
    (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.const 2)) (i32.const 2) (call $pal (i32.const 58)))
  (call $hline (i32.add (local.get $x) (i32.const 3)) (i32.add (local.get $y) (i32.const 1)) (i32.sub (local.get $w) (i32.const 6)) (call $pal (i32.const 59))))

;; Progress bar: v of max filled with palette colour idx col.
(func $ui_bar (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $v i32) (param $max i32) (param $col i32)
  (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 2) (call $pal (i32.const 61)))
  (call $rect (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1))
    (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.const 2)) (call $pal (i32.const 57)))
  (local.set $w (i32.div_u (i32.mul (i32.sub (local.get $w) (i32.const 2)) (call $imin (local.get $v) (local.get $max)))
                           (call $imax (local.get $max) (i32.const 1))))
  (call $rect (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1)) (local.get $w)
    (i32.sub (local.get $h) (i32.const 2)) (call $pal (local.get $col)))
  (call $hline (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1)) (local.get $w)
    (call $pal (i32.or (local.get $col) (i32.const 3)))))

;; Count badge (number on a barn-red pill) with its top-right corner at (x, y).
(func $ui_badge (param $x i32) (param $y i32) (param $n i32)
  (local $w i32)
  (call $sb (global.get $SB3)) (call $sn (local.get $n) (i32.const 0))
  (local.set $w (i32.add (call $tw (global.get $SB3)) (i32.const 6)))
  (call $rrect (i32.sub (local.get $x) (local.get $w)) (local.get $y) (local.get $w) (i32.add (call $lh) (i32.const 5)) (i32.const 3) (call $pal (i32.const 60)))
  (call $rrect (i32.sub (i32.sub (local.get $x) (local.get $w)) (i32.const -1)) (i32.add (local.get $y) (i32.const 1))
    (i32.sub (local.get $w) (i32.const 2)) (i32.add (call $lh) (i32.const 3)) (i32.const 2) (call $pi (i32.const 0x935)))
  (drop (call $txt (i32.add (i32.sub (local.get $x) (local.get $w)) (i32.const 3)) (i32.add (local.get $y) (i32.const 3))
    (global.get $SB3) (call $pi (i32.const 0x936)))))
(data (i32.const 0x935) "\19\3b")             ;; count badge face (tomato 1), text (paper 3): 6.3:1

;; Word-wrapped text in width w; returns the height used. $nodraw = 1 only measures.
(func $ui_wrap (param $x i32) (param $y i32) (param $w i32) (param $s i32) (param $c i32) (result i32)
  (local $max i32) (local $n i32) (local $cut i32) (local $ch i32) (local $y0 i32)
  (local.set $max (call $imax (i32.const 1) (i32.div_s (i32.add (local.get $w) (global.get $tscale)) (i32.mul (i32.const 6) (global.get $tscale)))))
  (local.set $y0 (local.get $y))
  (block $done (loop $line
    (br_if $done (i32.eqz (i32.load8_u (local.get $s))))
    (local.set $n (i32.const 0)) (local.set $cut (i32.const 0))
    (block $e (loop $scan
      (local.set $ch (i32.load8_u (i32.add (local.get $s) (local.get $n))))
      (if (i32.eqz (local.get $ch)) (then (local.set $cut (local.get $n)) (br $e)))
      (br_if $e (i32.gt_u (local.get $n) (local.get $max)))
      (if (i32.eq (local.get $ch) (i32.const 32)) (then (local.set $cut (local.get $n))))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (br $scan)))
    (if (i32.gt_u (local.get $cut) (local.get $max)) (then (local.set $cut (i32.const 0))))
    (if (i32.eqz (local.get $cut)) (then (local.set $cut (local.get $max))))
    (call $sb (global.get $WRAPBUF))
    (local.set $n (i32.const 0))
    (loop $cp
      (call $sc (i32.load8_u (i32.add (local.get $s) (local.get $n))))
      (br_if $cp (i32.lt_u (local.tee $n (i32.add (local.get $n) (i32.const 1))) (local.get $cut))))
    (if (i32.eqz (global.get $nodraw)) (then (drop (call $txt (local.get $x) (local.get $y) (global.get $WRAPBUF) (local.get $c)))))
    (local.set $y (i32.add (local.get $y) (i32.add (call $lh) (i32.const 3))))
    (local.set $s (i32.add (local.get $s) (local.get $cut)))
    (loop $sp (if (i32.eq (i32.load8_u (local.get $s)) (i32.const 32))
      (then (local.set $s (i32.add (local.get $s) (i32.const 1))) (br $sp))))
    (br $line)))
  (i32.sub (local.get $y) (local.get $y0)))

;; Button: draws, records itself in the draw list and registers a hit region (only when fully
;; inside the clip rows, so a scrolled-off or half-visible row is not tappable). style per the table above;
;; disabled buttons use style 5 and show $b_why (reason) as their second line. Extras, reset
;; here: $b_row = list row (icon left, label + second line left-aligned, $b_right right-aligned),
;; $b_sub = second line text, $b_right = right text. label 0 = icon only, icon -1 = none.
;; The pressed button ($press) sinks 1 px into its lip.
(func $btn (param $code i32) (param $x i32) (param $y i32) (param $w i32) (param $h i32)
           (param $label i32) (param $icon i32) (param $style i32) (param $en i32)
  (local $st i32) (local $pr i32) (local $tc i32) (local $c2 i32) (local $f i32) (local $e i32)
  (local $two i32) (local $is i32) (local $iw i32) (local $tx i32) (local $ty i32) (local $lw i32) (local $pad i32) (local $s2 i32)
  (local $rw i32) (local $wide i32) (local $ls i32)
  (if (i32.and (i32.ge_s (local.get $y) (global.get $clip_t))
               (i32.le_s (i32.add (local.get $y) (local.get $h)) (global.get $clip_b)))
    (then (drop (call $hit_add (local.get $x) (local.get $y) (local.get $w) (local.get $h) (local.get $code)))))
  (if (i32.lt_u (global.get $btn_n) (i32.const 40)) (then
    (local.set $e (i32.add (global.get $BTNS) (i32.shl (global.get $btn_n) (i32.const 6))))
    (i32.store (local.get $e) (local.get $code))
    (i32.store offset=4 (local.get $e) (local.get $en))
    (global.set $sblim (i32.const 27))
    (call $sb (i32.add (local.get $e) (i32.const 8)))
    (if (local.get $label) (then (call $ss (local.get $label))))
    (call $sb (i32.add (local.get $e) (i32.const 36)))
    (if (i32.and (i32.eqz (local.get $en)) (i32.ne (global.get $b_why) (i32.const 0))) (then (call $ss (global.get $b_why))))
    (global.set $sblim (i32.const 55))
    (global.set $btn_n (i32.add (global.get $btn_n) (i32.const 1)))))
  (local.set $pr (i32.and (i32.eq (global.get $press) (local.get $code)) (local.get $en)))
  (if (i32.eqz (local.get $en)) (then (local.set $style (i32.const 5))))
  (local.set $st (i32.add (i32.const 0x900) (i32.mul (local.get $style) (i32.const 5))))
  (local.set $f (i32.load8_u (i32.add (local.get $st) (i32.add (i32.const 1) (local.get $pr)))))
  (local.set $tc (call $pal (i32.load8_u offset=3 (local.get $st))))
  (local.set $c2 (call $pal (i32.load8_u offset=4 (local.get $st))))
  (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 3) (call $pal (i32.load8_u (local.get $st))))
  (call $rrect (i32.add (local.get $x) (i32.const 1)) (i32.add (i32.add (local.get $y) (i32.const 1)) (local.get $pr))
    (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.const 4)) (i32.const 2) (call $pal (local.get $f)))
  (if (i32.and (i32.ne (local.get $style) (i32.const 0)) (i32.eqz (local.get $pr))) (then
    (call $hline (i32.add (local.get $x) (i32.const 3)) (i32.add (local.get $y) (i32.const 1)) (i32.sub (local.get $w) (i32.const 6))
      (call $pal (i32.or (local.get $f) (i32.const 3))))))
  (local.set $y (i32.add (local.get $y) (local.get $pr)))
  (local.set $h (i32.sub (local.get $h) (i32.const 2)))       ;; content box excludes the lip
  (local.set $pad (i32.add (global.get $lgap) (i32.const 2)))
  (local.set $s2 (select (global.get $b_why) (global.get $b_sub) (i32.and (i32.eqz (local.get $en)) (i32.ne (global.get $b_why) (i32.const 0)))))
  (if (i32.eqz (local.get $en)) (then (local.set $c2 (call $pal (i32.const 37)))))
  (local.set $two (i32.ne (local.get $s2) (i32.const 0)))
  (global.set $tscale (call $ui_ts))
  (if (global.get $b_row)
    (then
      (local.set $is (call $imin (i32.sub (local.get $h) (i32.shl (local.get $pad) (i32.const 1))) (i32.mul (i32.const 30) (global.get $tscale))))
      (if (i32.ge_s (local.get $icon) (i32.const 0)) (then
        (if (i32.lt_s (local.get $icon) (i32.const 64)) (then (local.set $is (i32.mul (i32.const 9) (global.get $tscale)))))
        (call $ui_icon (local.get $icon) (i32.add (local.get $x) (local.get $pad))
          (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (local.get $is)) (i32.const 1)))
          (select (local.get $is) (global.get $tscale) (i32.ge_s (local.get $icon) (i32.const 64))))))
      (local.set $tx (i32.add (i32.add (local.get $x) (local.get $pad)) (select (i32.add (local.get $is) (local.get $pad)) (i32.const 0) (i32.ge_s (local.get $icon) (i32.const 0)))))
      (local.set $lw (i32.sub (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $pad)) (local.get $tx)))
      ;; line positions at the UI text scale (a string that has to shrink keeps its line)
      (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (i32.add (i32.mul (call $lh) (i32.add (local.get $two) (i32.const 1))) (i32.mul (local.get $two) (i32.const 3)))) (i32.const 1))))
      (local.set $ls (i32.add (call $lh) (i32.const 3)))
      (if (global.get $b_right) (then
        (call $fit (global.get $b_right) (local.get $lw))
        (local.set $rw (i32.add (call $tw (global.get $b_right)) (local.get $pad)))
        ;; a second line too long to sit beside the right text gets the full width; the right
        ;; text then moves up to line 1
        (global.set $tscale (call $ui_ts))
        (if (local.get $two) (then (local.set $wide (i32.gt_s (call $tw (local.get $s2)) (i32.sub (local.get $lw) (local.get $rw))))))
        (call $fit (global.get $b_right) (local.get $lw))
        (drop (call $txt (i32.sub (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $pad)) (call $tw (global.get $b_right)))
          (select (local.get $ty) (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (call $lh)) (i32.const 1))) (local.get $wide))
          (global.get $b_right) (local.get $tc)))
        (local.set $lw (i32.sub (local.get $lw) (local.get $rw)))))
      (call $fit (local.get $label) (local.get $lw))
      (drop (call $txt (local.get $tx) (local.get $ty) (local.get $label) (local.get $tc)))
      (if (local.get $two) (then
        (call $fit (local.get $s2) (select (i32.add (local.get $lw) (local.get $rw)) (local.get $lw) (local.get $wide)))
        (drop (call $txt (local.get $tx) (i32.add (local.get $ty) (local.get $ls)) (local.get $s2) (local.get $c2))))))
    (else
      ;; centred: [icon] label, reason (if any) on a second centred line
      (if (local.get $label) (then (call $fit (local.get $label) (i32.sub (i32.sub (local.get $w) (i32.shl (local.get $pad) (i32.const 1)))
        (select (i32.add (i32.mul (i32.const 9) (call $ui_ts)) (i32.const 3)) (i32.const 0) (i32.ge_s (local.get $icon) (i32.const 0)))))))
      (local.set $iw (select (i32.mul (i32.const 9) (global.get $tscale)) (i32.const 0) (i32.ge_s (local.get $icon) (i32.const 0))))
      (local.set $lw (select (call $tw (local.get $label)) (i32.const 0) (local.get $label)))
      (local.set $tx (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w)
        (i32.add (i32.add (local.get $iw) (local.get $lw)) (select (i32.const 3) (i32.const 0) (i32.and (i32.ne (local.get $iw) (i32.const 0)) (i32.ne (local.get $lw) (i32.const 0)))))) (i32.const 1))))
      (local.set $ty (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (i32.add (i32.mul (call $lh) (i32.add (local.get $two) (i32.const 1))) (i32.mul (local.get $two) (i32.const 3)))) (i32.const 1))))
      (if (local.get $iw) (then
        (call $ui_icon (local.get $icon) (local.get $tx) (i32.sub (local.get $ty) (global.get $tscale)) (global.get $tscale))
        (local.set $tx (i32.add (local.get $tx) (i32.add (local.get $iw) (i32.const 3))))))
      (if (local.get $label) (then (drop (call $txt (local.get $tx) (local.get $ty) (local.get $label) (local.get $tc)))))
      (if (local.get $two) (then
        (call $fit (local.get $s2) (i32.sub (local.get $w) (i32.shl (local.get $pad) (i32.const 1))))
        (drop (call $txt (i32.add (local.get $x) (i32.shr_s (i32.sub (local.get $w) (call $tw (local.get $s2))) (i32.const 1)))
          (i32.add (i32.add (local.get $ty) (call $lh)) (i32.const 3)) (local.get $s2) (local.get $c2)))))))
  (global.set $tscale (call $ui_ts))
  (global.set $b_row (i32.const 0)) (global.set $b_sub (i32.const 0))
  (global.set $b_right (i32.const 0)) (global.set $b_why (i32.const 0)))

;; Draw-list record of the button with this code drawn last frame (0 when none).
(func $btn_find (param $code i32) (result i32)
  (local $i i32) (local $e i32)
  (local.set $i (global.get $btn_n))
  (loop $l
    (if (local.get $i) (then
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (local.set $e (i32.add (global.get $BTNS) (i32.shl (local.get $i) (i32.const 6))))
      (if (i32.eq (i32.load (local.get $e)) (local.get $code)) (then (return (local.get $e))))
      (br $l))))
  (i32.const 0))

;; ---------------------------------------------------------------- toasts and announce

(func $announce (param $s i32)
  (local $n i32) (local $d i32)
  (local.set $n (call $imin (call $strlen (local.get $s)) (i32.const 200)))
  (local.set $d (i32.add (global.get $ann_p) (global.get $ann_len)))
  (if (i32.gt_u (i32.add (local.get $d) (local.get $n)) (i32.const 0x9000)) (then (local.set $d (i32.const 0x8E00))))
  (memory.copy (local.get $d) (local.get $s) (local.get $n))
  (global.set $ann_p (local.get $d))
  (global.set $ann_len (local.get $n))
  (global.set $ann_seq (i32.add (global.get $ann_seq) (i32.const 1))))

;; New toast (kind 1 info, 2 error, 3 good) with a copy of text s; the oldest of 3 is dropped.
;; Also announced.
(func $toast (param $kind i32) (param $s i32)
  (local $p i32)
  (local.set $p (global.get $TOASTS))
  (block $f (loop $l
    (br_if $f (i32.eqz (i32.load offset=4 (local.get $p))))
    (local.set $p (i32.add (local.get $p) (i32.const 64)))
    (br_if $l (i32.lt_u (local.get $p) (i32.add (global.get $TOASTS) (i32.const 192))))
    (call $toast_drop (i32.const 0))
    (local.set $p (i32.add (global.get $TOASTS) (i32.const 128)))))
  (i32.store (local.get $p) (i32.const -1))
  (i32.store offset=4 (local.get $p) (local.get $kind))
  (call $sb (i32.add (local.get $p) (i32.const 8)))
  (call $ss (local.get $s))
  (call $announce (local.get $s))
  (global.set $dirty (i32.const 1)))
(func $toast_drop (param $i i32)
  (local $p i32)
  (if (i32.ge_u (local.get $i) (i32.const 3)) (then (return)))   ;; slots 0..2 only
  (local.set $p (i32.add (global.get $TOASTS) (i32.shl (local.get $i) (i32.const 6))))
  (memory.copy (local.get $p) (i32.add (local.get $p) (i32.const 64)) (i32.sub (i32.const 128) (i32.shl (local.get $i) (i32.const 6))))
  (memory.fill (i32.add (global.get $TOASTS) (i32.const 128)) (i32.const 0) (i32.const 64))
  (global.set $dirty (i32.const 1)))
(func $toast_n (result i32)
  (i32.add (i32.add (i32.ne (i32.load offset=4 (global.get $TOASTS)) (i32.const 0))
                    (i32.ne (i32.load offset=68 (global.get $TOASTS)) (i32.const 0)))
           (i32.ne (i32.load offset=132 (global.get $TOASTS)) (i32.const 0))))

;; Toasts stack down from the TOAST rect: dark slip, icon (error: warning, good: check), wrapped text.
(func $draw_toasts
  (local $i i32) (local $p i32) (local $k i32) (local $x i32) (local $y i32) (local $w i32) (local $h i32) (local $ix i32) (local $g i32)
  (local.set $x (call $lay_x (global.get $LR_TOAST)))
  (local.set $y (call $lay_y (global.get $LR_TOAST)))
  (local.set $w (call $lay_w (global.get $LR_TOAST)))
  (local.set $g (global.get $lgap))
  (global.set $tscale (call $ui_ts))
  (loop $l
    (local.set $p (i32.add (global.get $TOASTS) (i32.shl (local.get $i) (i32.const 6))))
    (local.set $k (i32.load offset=4 (local.get $p)))
    (if (i32.and (i32.ne (local.get $k) (i32.const 0)) (i32.gt_s (local.get $w) (i32.const 0))) (then
      (local.set $ix (select (i32.add (i32.mul (i32.const 9) (global.get $tscale)) (i32.const 4)) (i32.const 0) (i32.gt_u (local.get $k) (i32.const 1))))
      (global.set $nodraw (i32.const 1))
      (local.set $h (i32.add (call $ui_wrap (i32.const 0) (i32.const 0) (i32.sub (i32.sub (local.get $w) (i32.mul (local.get $g) (i32.const 4))) (local.get $ix))
        (i32.add (local.get $p) (i32.const 8)) (i32.const 0)) (i32.add (i32.shl (local.get $g) (i32.const 1)) (i32.const 1))))
      (global.set $nodraw (i32.const 0))
      (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 3) (call $pal (i32.const 60)))
      (call $rrect (i32.add (local.get $x) (i32.const 1)) (i32.add (local.get $y) (i32.const 1)) (i32.sub (local.get $w) (i32.const 2)) (i32.sub (local.get $h) (i32.const 2))
        (i32.const 2) (call $pal (i32.load8_u (i32.add (i32.const 0x92C) (local.get $k)))))
      (if (local.get $ix) (then
        (call $ui_icon (select (global.get $I_WARN) (global.get $I_CHECK) (i32.eq (local.get $k) (i32.const 2)))
          (i32.add (local.get $x) (i32.shl (local.get $g) (i32.const 1))) (i32.add (local.get $y) (local.get $g)) (global.get $tscale))))
      (drop (call $ui_wrap (i32.add (i32.add (local.get $x) (i32.shl (local.get $g) (i32.const 1))) (local.get $ix))
        (i32.add (i32.add (local.get $y) (local.get $g)) (i32.const 1))
        (i32.sub (i32.sub (local.get $w) (i32.mul (local.get $g) (i32.const 4))) (local.get $ix))
        (i32.add (local.get $p) (i32.const 8)) (call $pal (i32.const 59))))
      (local.set $y (i32.add (i32.add (local.get $y) (local.get $h)) (local.get $g)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3)))))
(data (i32.const 0x92C) "\00\3d\25\08")        ;; toast face per kind: -, ink, barn, grass

;; ---------------------------------------------------------------- input

(func $pointer (param $x i32) (param $y i32) (param $type i32)
  (local $lx i32) (local $ly i32) (local $dx i32) (local $dy i32) (local $t i32)
  (local.set $lx (call $css_to_fb_x (local.get $x)))
  (local.set $ly (call $css_to_fb_y (local.get $y)))
  (if (i32.eqz (local.get $type)) (then
    (if (global.get $dirty) (then (call $render)))
    (global.set $in_st (i32.const 1))
    (global.set $in_x (local.get $x)) (global.set $in_y (local.get $y))
    (global.set $in_lx (local.get $lx)) (global.set $in_ly (local.get $ly))
    (global.set $in_t (i32.const -1)) (global.set $in_lp (i32.const 0))
    (global.set $in_s0 (global.get $scroll))
    (global.set $in_code (call $hit_test (local.get $lx) (local.get $ly)))
    (global.set $press (global.get $in_code))
    (global.set $dirty (i32.const 1))
    (return)))
  (local.set $dx (i32.sub (local.get $x) (global.get $in_x)))
  (local.set $dy (i32.sub (local.get $y) (global.get $in_y)))
  (if (i32.eq (local.get $type) (i32.const 1)) (then
    (if (i32.eqz (global.get $in_st)) (then
      ;; hover (mouse with no button; laptop layout only)
      (local.set $t (i32.const -1))
      (if (i32.and (i32.eq (call $lget (global.get $L_MODE)) (i32.const 2))
                   (i32.eq (call $hit_test (local.get $lx) (local.get $ly)) (global.get $HIT_GRID)))
        (then (local.set $t (call $tile_at (local.get $lx) (local.get $ly)))))
      (if (i32.ne (local.get $t) (global.get $hover_tile)) (then
        (global.set $hover_tile (local.get $t)) (global.set $dirty (i32.const 1))))
      (return)))
    (if (i32.and (i32.eq (global.get $in_st) (i32.const 1))
          (i32.or (i32.gt_u (i32.add (local.get $dx) (i32.const 8)) (i32.const 16)) (i32.gt_u (i32.add (local.get $dy) (i32.const 8)) (i32.const 16))))
      (then (global.set $in_st (i32.const 2)) (global.set $press (i32.const 0)) (global.set $dirty (i32.const 1))))
    (if (i32.and (i32.eq (global.get $in_st) (i32.const 2)) (call $in_panel (global.get $in_code))) (then
      (global.set $scroll (call $clamp (i32.sub (global.get $in_s0) (call $css_to_fb_y (local.get $dy))) (i32.const 0) (global.get $scroll_max)))
      (global.set $dirty (i32.const 1))))
    (return)))
  ;; up (or anything else: cancel)
  (if (i32.eq (local.get $type) (i32.const 2)) (then
    (if (i32.and (i32.and (i32.eq (global.get $in_st) (i32.const 1)) (i32.eqz (global.get $in_lp)))
                 (i32.or (i32.eq (global.get $in_code) (global.get $HIT_GRID))
                         (i32.eq (call $hit_test (local.get $lx) (local.get $ly)) (global.get $in_code))))
      (then (call $tap (global.get $in_code))))
    (if (i32.and (i32.and (i32.eq (global.get $in_st) (i32.const 2)) (call $in_panel (global.get $in_code)))
                 (i32.and (i32.and (i32.eqz (global.get $in_s0)) (i32.ge_s (local.get $dy) (i32.const 40)))
                          (i32.ne (call $lget (global.get $L_MODE)) (i32.const 2))))
      (then (call $close)))))
  (global.set $in_st (i32.const 0))
  (global.set $press (i32.const 0))
  (global.set $dirty (i32.const 1)))

;; A press that began on the sheet / side panel (its body, buttons or close).
(func $in_panel (param $c i32) (result i32)
  (i32.or (i32.or (i32.eq (local.get $c) (global.get $HIT_PANEL)) (i32.eq (local.get $c) (global.get $HIT_CLOSE)))
          (i32.eq (i32.shr_u (local.get $c) (i32.const 8)) (i32.const 2))))

(func $key (param $code i32) (param $down i32)
  (local $i i32) (local $x i32) (local $y i32) (local $m i32)
  ;; auto-repeat filter: a down while the code is held is ignored; up releases it; any non-zero
  ;; down value counts as down; codes >= 32 are unmapped
  (if (i32.ge_u (local.get $code) (i32.const 32)) (then (return)))
  (local.set $m (i32.shl (i32.const 1) (local.get $code)))
  (if (i32.eqz (local.get $down)) (then
    (global.set $keys (i32.and (global.get $keys) (i32.xor (local.get $m) (i32.const -1))))
    (return)))
  (if (i32.and (global.get $keys) (local.get $m)) (then (return)))
  (global.set $keys (i32.or (global.get $keys) (local.get $m)))
  (if (i32.eq (local.get $code) (i32.const 1)) (then (call $do_endday)))
  (if (i32.eq (local.get $code) (i32.const 2)) (then (call $do_harvest_all)))
  (if (i32.eq (local.get $code) (i32.const 8)) (then (call $close)))
  (if (i32.or (i32.eq (local.get $code) (i32.const 13)) (i32.eq (local.get $code) (i32.const 16)))
    (then (if (i32.ge_s (global.get $sel_tile) (i32.const 0)) (then (call $select (global.get $sel_tile) (i32.const 1))))))
  (if (i32.lt_u (i32.sub (local.get $code) (i32.const 9)) (i32.const 4)) (then
    ;; arrows move the tile cursor over the owned grid + the next ring
    (local.set $i (global.get $sel_tile))
    (local.set $m (call $imin (i32.load8_u (global.get $S_GRID)) (i32.const 7)))
    (if (i32.ge_s (local.get $i) (i32.const 0)) (then
      (local.set $x (i32.and (local.get $i) (i32.const 7)))
      (local.set $y (i32.shr_u (local.get $i) (i32.const 3)))
      (if (i32.eq (local.get $code) (i32.const 9)) (then (local.set $y (i32.sub (local.get $y) (i32.const 1)))))
      (if (i32.eq (local.get $code) (i32.const 10)) (then (local.set $y (i32.add (local.get $y) (i32.const 1)))))
      (if (i32.eq (local.get $code) (i32.const 11)) (then (local.set $x (i32.sub (local.get $x) (i32.const 1)))))
      (if (i32.eq (local.get $code) (i32.const 12)) (then (local.set $x (i32.add (local.get $x) (i32.const 1)))))
      (local.set $i (i32.add (i32.shl (call $clamp (local.get $y) (i32.const 0) (local.get $m)) (i32.const 3))
                             (call $clamp (local.get $x) (i32.const 0) (local.get $m))))))
    (call $select (call $imax (local.get $i) (i32.const 0)) (global.get $sheet))))
  (global.set $dirty (i32.const 1)))

;; ---------------------------------------------------------------- frame loop

(func $stamp (param $t i32) (result i32)
  (select (global.get $now) (local.get $t) (i32.eq (local.get $t) (i32.const -1))))
(func $since (param $t i32) (result i32) (i32.sub (global.get $now) (local.get $t)))

(func $frame (param $now i32) (result i32)
  (local $anim i32) (local $low i32) (local $i i32) (local $p i32) (local $w i32) (local $lt i32)
  (global.set $now (local.get $now))
  (global.set $slide_t (call $stamp (global.get $slide_t)))
  (global.set $shake_t (call $stamp (global.get $shake_t)))
  (global.set $arm_t (call $stamp (global.get $arm_t)))
  (global.set $in_t (call $stamp (global.get $in_t)))
  ;; long press: 300 ms on a plot without moving (buttons ignore the hold time)
  (if (i32.and (i32.and (i32.eq (global.get $in_st) (i32.const 1)) (i32.eqz (global.get $in_lp)))
               (i32.and (i32.eq (global.get $in_code) (global.get $HIT_GRID))
                        (i32.ge_s (call $since (global.get $in_t)) (i32.const 300)))) (then
    (global.set $in_lp (i32.const 1))
    (global.set $press (i32.const 0))
    (local.set $lt (call $tile_at (global.get $in_lx) (global.get $in_ly)))
    (if (i32.ge_s (local.get $lt) (i32.const 0)) (then
      (call $tile_info (local.get $lt))
      (call $toast (i32.const 1) (global.get $SB3))))
    (global.set $dirty (i32.const 1))))
  ;; sheet slide (ease-out), shake, armed two-step button, toasts
  (global.set $slide_p (i32.const 256))
  (if (i32.ge_s (global.get $slide_t) (i32.const 0)) (then
    (local.set $p (call $imin (i32.div_s (i32.shl (call $since (global.get $slide_t)) (i32.const 8)) (i32.const 180)) (i32.const 256)))
    (if (i32.or (global.get $flag_reduced) (i32.ge_s (local.get $p) (i32.const 256)))
      (then (global.set $slide_t (i32.const -2)) (global.set $dirty (i32.const 1)))
      (else
        (local.set $p (i32.sub (i32.const 256) (local.get $p)))
        (global.set $slide_p (i32.sub (i32.const 256) (i32.shr_u (i32.mul (i32.mul (local.get $p) (local.get $p)) (local.get $p)) (i32.const 16))))
        (local.set $anim (i32.const 1))))))
  (if (i32.ge_s (global.get $shake_t) (i32.const 0)) (then
    (if (i32.or (global.get $flag_reduced) (i32.ge_s (call $since (global.get $shake_t)) (i32.const 300)))
      (then (global.set $shake_t (i32.const -2)) (global.set $dirty (i32.const 1)))
      (else (local.set $anim (i32.const 1))))))
  ;; armed button: drawn dimmed until live (400 ms; redraw when that flips), disarmed after 3 s;
  ;; low-rate frames meanwhile so the timeout runs under reduced motion too
  (if (global.get $arm) (then
    (local.set $low (i32.const 1))
    (if (i32.ne (call $arm_live) (global.get $arm_lv))
      (then (global.set $arm_lv (call $arm_live)) (global.set $dirty (i32.const 1))))
    (if (i32.ge_s (call $since (global.get $arm_t)) (i32.const 3000))
      (then (global.set $arm (i32.const 0)) (global.set $dirty (i32.const 1))))))
  ;; toasts are static until they expire: low-rate frames are enough
  (local.set $i (i32.const 0))
  (loop $tl
    (local.set $p (i32.add (global.get $TOASTS) (i32.shl (local.get $i) (i32.const 6))))
    (if (i32.load offset=4 (local.get $p)) (then
      (i32.store (local.get $p) (call $stamp (i32.load (local.get $p))))
      (if (i32.ge_s (call $since (i32.load (local.get $p))) (i32.const 3000))
        (then (call $toast_drop (local.get $i)) (br $tl)))
      (local.set $low (i32.const 1))))
    (br_if $tl (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (if (global.get $in_st) (then (local.set $anim (i32.const 1))))
  ;; rain and storm particles move every frame
  (local.set $w (i32.load8_u (global.get $S_WEATHER)))
  (if (i32.and (i32.eqz (global.get $flag_reduced)) (i32.or (i32.eq (local.get $w) (i32.const 1)) (i32.eq (local.get $w) (i32.const 3))))
    (then (local.set $anim (i32.const 1))))
  (if (i32.or (i32.or (global.get $dirty) (local.get $anim)) (i32.eqz (global.get $flag_reduced))) (then (call $render)))
  (global.set $dirty (i32.const 0))
  (if (local.get $anim) (then (return (i32.const 1))))
  (i32.shl (i32.or (local.get $low) (i32.eqz (global.get $flag_reduced))) (i32.const 1)))

;; The armed two-step button accepts its confirming tap only 400 ms after arming.
(func $arm_live (result i32)
  (i32.and (i32.ne (global.get $arm_t) (i32.const -1)) (i32.ge_s (call $since (global.get $arm_t)) (i32.const 400))))

;; One full redraw: scene, then chrome; rebuilds the dynamic hit regions and the draw list.
(func $render
  (call $hit_reset_dyn)
  (if (i32.ne (call $lget (global.get $L_MODE)) (i32.const 2)) (then (global.set $hover_tile (i32.const -1))))
  (global.set $btn_n (i32.const 0))
  (call $scene_time (global.get $now))
  (call $scene_draw)
  (global.set $tscale (call $ui_ts))
  (call $draw_top)
  (call $draw_tabs)
  (call $draw_sheet)
  (call $draw_toasts)
  (global.set $tscale (i32.const 1)))

;; ---------------------------------------------------------------- lifecycle

;; Reset every UI state (new game, load) and relayout. The farm is fitted to the grid size
;; by $scene_fit on every draw and hit test, so a grid change (BUY LAND, load) needs no extra
;; refit call (ruling C6).
(func $ui_reset
  (global.set $sel_tile (i32.const -1)) (global.set $hover_tile (i32.const -1))
  (global.set $sheet (i32.const 0)) (global.set $pick (i32.const 0)) (global.set $scroll (i32.const 0))
  (global.set $arm (i32.const 0)) (global.set $in_st (i32.const 0)) (global.set $press (i32.const 0)) (global.set $keys (i32.const 0))
  (global.set $slide_t (i32.const -2)) (global.set $shake_t (i32.const -2))
  (memory.fill (global.get $TOASTS) (i32.const 0) (i32.const 192))
  (call $layout_panel (i32.const 0))
  (global.set $dirty (i32.const 1)))
(func $ui_new_game (param $seed i32)
  (call $init (local.get $seed))
  (call $ui_reset)
  (global.set $want_save (i32.const 1)))
(func $ui_loaded (call $ui_reset))
(func $need_save (result i32) (global.get $want_save))
(func $ack_save (global.set $want_save (i32.const 0)))
(func $announce_ptr (result i32) (global.get $ann_p))
(func $announce_len (result i32) (global.get $ann_len))
(func $announce_seq (result i32) (global.get $ann_seq))

;; Test hooks.
(func $t_ui (param $k i32) (result i32)
  (if (i32.eqz (local.get $k)) (then (return (global.get $sel_tile))))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (return (global.get $sheet))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (return (global.get $pick))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (return (global.get $scroll))))
  (if (i32.eq (local.get $k) (i32.const 4)) (then (return (global.get $scroll_max))))
  (if (i32.eq (local.get $k) (i32.const 5)) (then (return (global.get $hover_tile))))
  (if (i32.eq (local.get $k) (i32.const 6)) (then (return (global.get $btn_n))))
  (if (i32.eq (local.get $k) (i32.const 7)) (then (return (call $toast_n))))
  (if (i32.eq (local.get $k) (i32.const 8)) (then (return (global.get $arm))))
  (if (i32.eq (local.get $k) (i32.const 9)) (then (return (global.get $dirty))))
  (if (i32.eq (local.get $k) (i32.const 10)) (then (return (global.get $slide_p))))
  (global.get $in_st))
(func $t_ui_btn (param $i i32) (result i32) (i32.add (global.get $BTNS) (i32.shl (local.get $i) (i32.const 6))))
(func $t_ui_toast (param $i i32) (result i32)
  (local $p i32)
  (local.set $p (i32.add (global.get $TOASTS) (i32.shl (local.get $i) (i32.const 6))))
  (select (i32.add (local.get $p) (i32.const 8)) (i32.const 0) (i32.load offset=4 (local.get $p))))
;; (t_str = $str, t_toast_drop = $toast_drop are exported directly)
(func $t_fmt (param $n i32) (param $m i32) (result i32)
  (call $sb (global.get $SB3)) (call $sn (local.get $n) (local.get $m)) (global.get $SB3))
