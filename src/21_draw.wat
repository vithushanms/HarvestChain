;; Framebuffer and 2D draw primitives (immediate mode, integer only, no sim RNG).
;; Pixels are i32 words 0xAABBGGRR (little-endian r,g,b,a bytes) so canvas ImageData reads
;; the buffer directly. Everything clips silently to [0,fb_w) x [0,fb_h).
;; Framebuffer at $R_FB; a canary word 0xCAFEF00D sits right after the last pixel.
;; Logical size (Decision 3): scale = max(1, round(min(w,h)*dpr/360)); logical = css*dpr/scale,
;; dpr capped at 2, clamped to 720x1280 (portrait) / 1280x720 (landscape).

(global $fb_w (mut i32) (i32.const 0))
(global $fb_h (mut i32) (i32.const 0))
(global $CANARY i32 (i32.const 0xCAFEF00D))

(func $resize (param $w i32) (param $h i32) (param $dpr i32)
  (local $pw i32) (local $ph i32) (local $s i32) (local $lw i32) (local $lh i32)
  (local $need i32) (local $pages i32)
  (local.set $dpr (select (local.get $dpr) (i32.const 100) (i32.gt_s (local.get $dpr) (i32.const 100))))
  (local.set $dpr (select (local.get $dpr) (i32.const 200) (i32.lt_s (local.get $dpr) (i32.const 200))))
  (local.set $pw (i32.div_u (i32.mul (local.get $w) (local.get $dpr)) (i32.const 100)))
  (local.set $ph (i32.div_u (i32.mul (local.get $h) (local.get $dpr)) (i32.const 100)))
  ;; pixelScale = max(1, round(min(pw,ph)/360))
  (local.set $s (i32.div_u
    (i32.add (select (local.get $pw) (local.get $ph) (i32.lt_u (local.get $pw) (local.get $ph))) (i32.const 180))
    (i32.const 360)))
  (local.set $s (select (local.get $s) (i32.const 1) (i32.gt_u (local.get $s) (i32.const 1))))
  (local.set $lw (i32.div_u (local.get $pw) (local.get $s)))
  (local.set $lh (i32.div_u (local.get $ph) (local.get $s)))
  (if (i32.ge_u (local.get $h) (local.get $w))
    (then
      (local.set $lw (select (local.get $lw) (i32.const 720) (i32.lt_u (local.get $lw) (i32.const 720))))
      (local.set $lh (select (local.get $lh) (i32.const 1280) (i32.lt_u (local.get $lh) (i32.const 1280)))))
    (else
      (local.set $lw (select (local.get $lw) (i32.const 1280) (i32.lt_u (local.get $lw) (i32.const 1280))))
      (local.set $lh (select (local.get $lh) (i32.const 720) (i32.lt_u (local.get $lh) (i32.const 720))))))
  (local.set $lw (select (local.get $lw) (i32.const 1) (i32.gt_u (local.get $lw) (i32.const 1))))
  (local.set $lh (select (local.get $lh) (i32.const 1) (i32.gt_u (local.get $lh) (i32.const 1))))
  ;; grow memory to fit pixels + canary
  (local.set $need (i32.add (i32.add (global.get $R_FB) (i32.shl (i32.mul (local.get $lw) (local.get $lh)) (i32.const 2))) (i32.const 4)))
  (local.set $pages (i32.sub (i32.shr_u (i32.add (local.get $need) (i32.const 65535)) (i32.const 16)) (memory.size)))
  ;; on grow failure (-1) fall back to an empty 0x0 framebuffer, never a stale size
  (if (i32.gt_s (local.get $pages) (i32.const 0))
    (then (if (i32.lt_s (memory.grow (local.get $pages)) (i32.const 0)) (then
      (global.set $fb_w (i32.const 0)) (global.set $fb_h (i32.const 0)) (return)))))
  (global.set $fb_w (local.get $lw))
  (global.set $fb_h (local.get $lh))
  (i32.store (i32.sub (local.get $need) (i32.const 4)) (global.get $CANARY)))

(func $fb_ptr (result i32) (global.get $R_FB))
(func $fb_w (result i32) (global.get $fb_w))
(func $fb_h (result i32) (global.get $fb_h))
(func $canary_ok (result i32)
  (i32.eq (i32.load (i32.add (global.get $R_FB) (i32.shl (i32.mul (global.get $fb_w) (global.get $fb_h)) (i32.const 2))))
          (global.get $CANARY)))

;; Clamp v to [lo, hi] (signed).
(func $clamp (param $v i32) (param $lo i32) (param $hi i32) (result i32)
  (select (local.get $lo)
    (select (local.get $hi) (local.get $v) (i32.gt_s (local.get $v) (local.get $hi)))
    (i32.lt_s (local.get $v) (local.get $lo))))

;; Palette entry -> pixel word.
(func $pal (param $i i32) (result i32)
  (i32.load (i32.add (global.get $PAL_ADDR) (i32.shl (i32.and (local.get $i) (i32.const 63)) (i32.const 2)))))
;; hue/step -> pixel word.
(func $hc (param $hue i32) (param $step i32) (result i32)
  (call $pal (i32.add (i32.shl (local.get $hue) (i32.const 2)) (local.get $step))))

(func $px (param $x i32) (param $y i32) (param $c i32)
  (if (i32.and (i32.lt_u (local.get $x) (global.get $fb_w)) (i32.lt_u (local.get $y) (global.get $fb_h)))
    (then (i32.store
      (i32.add (global.get $R_FB) (i32.shl (i32.add (i32.mul (local.get $y) (global.get $fb_w)) (local.get $x)) (i32.const 2)))
      (local.get $c)))))

;; Pixel word at (x,y), or -1 when outside.
(func $getpx (param $x i32) (param $y i32) (result i32)
  (if (result i32) (i32.and (i32.lt_u (local.get $x) (global.get $fb_w)) (i32.lt_u (local.get $y) (global.get $fb_h)))
    (then (i32.load (i32.add (global.get $R_FB) (i32.shl (i32.add (i32.mul (local.get $y) (global.get $fb_w)) (local.get $x)) (i32.const 2)))))
    (else (i32.const -1))))

(func $fill (param $c i32)
  (local $p i32) (local $e i32)
  (local.set $p (global.get $R_FB))
  (local.set $e (i32.add (local.get $p) (i32.shl (i32.mul (global.get $fb_w) (global.get $fb_h)) (i32.const 2))))
  (block $done (loop $l
    (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
    (i32.store (local.get $p) (local.get $c))
    (local.set $p (i32.add (local.get $p) (i32.const 4)))
    (br $l))))

(func $rect (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $c i32)
  (local $x1 i32) (local $y1 i32) (local $xx i32) (local $row i32)
  (local.set $x1 (i32.add (local.get $x) (local.get $w)))
  (local.set $y1 (i32.add (local.get $y) (local.get $h)))
  (if (i32.lt_s (local.get $x) (i32.const 0)) (then (local.set $x (i32.const 0))))
  (if (i32.lt_s (local.get $y) (i32.const 0)) (then (local.set $y (i32.const 0))))
  (if (i32.gt_s (local.get $x1) (global.get $fb_w)) (then (local.set $x1 (global.get $fb_w))))
  (if (i32.gt_s (local.get $y1) (global.get $fb_h)) (then (local.set $y1 (global.get $fb_h))))
  (block $out (loop $ly
    (br_if $out (i32.ge_s (local.get $y) (local.get $y1)))
    (local.set $xx (local.get $x))
    (local.set $row (i32.add (global.get $R_FB) (i32.shl (i32.mul (local.get $y) (global.get $fb_w)) (i32.const 2))))
    (block $rowdone (loop $lx
      (br_if $rowdone (i32.ge_s (local.get $xx) (local.get $x1)))
      (i32.store (i32.add (local.get $row) (i32.shl (local.get $xx) (i32.const 2))) (local.get $c))
      (local.set $xx (i32.add (local.get $xx) (i32.const 1)))
      (br $lx)))
    (local.set $y (i32.add (local.get $y) (i32.const 1)))
    (br $ly))))

(func $hline (param $x i32) (param $y i32) (param $w i32) (param $c i32)
  (call $rect (local.get $x) (local.get $y) (local.get $w) (i32.const 1) (local.get $c)))
(func $vline (param $x i32) (param $y i32) (param $h i32) (param $c i32)
  (call $rect (local.get $x) (local.get $y) (i32.const 1) (local.get $h) (local.get $c)))

;; Rect with corners cut by r (r=2: the top/bottom rows inset 2 and 1). r is clamped to
;; min(r, w/2, h/2, 32) (>= 0); fully off-screen or empty rects return at once.
(func $rrect (param $x i32) (param $y i32) (param $w i32) (param $h i32) (param $r i32) (param $c i32)
  (local $i i32) (local $in i32)
  (if (i32.or (i32.or (i32.le_s (local.get $w) (i32.const 0)) (i32.le_s (local.get $h) (i32.const 0)))
              (i32.or (i32.ge_s (local.get $x) (global.get $fb_w)) (i32.ge_s (local.get $y) (global.get $fb_h))))
    (then (return)))
  ;; x, y < 0 and w, h > 0 here, so the sums cannot overflow
  (if (i32.or (i32.and (i32.lt_s (local.get $x) (i32.const 0)) (i32.le_s (i32.add (local.get $x) (local.get $w)) (i32.const 0)))
              (i32.and (i32.lt_s (local.get $y) (i32.const 0)) (i32.le_s (i32.add (local.get $y) (local.get $h)) (i32.const 0))))
    (then (return)))
  (local.set $r (call $clamp (local.get $r) (i32.const 0) (i32.const 32)))
  (local.set $r (call $clamp (local.get $r) (i32.const 0) (i32.shr_s (local.get $w) (i32.const 1))))
  (local.set $r (call $clamp (local.get $r) (i32.const 0) (i32.shr_s (local.get $h) (i32.const 1))))
  (call $rect (local.get $x) (i32.add (local.get $y) (local.get $r)) (local.get $w)
    (i32.sub (local.get $h) (i32.shl (local.get $r) (i32.const 1))) (local.get $c))
  (block $done (loop $l
    (br_if $done (i32.ge_s (local.get $i) (local.get $r)))
    (local.set $in (i32.sub (local.get $r) (local.get $i)))
    (call $hline (i32.add (local.get $x) (local.get $in)) (i32.add (local.get $y) (local.get $i))
      (i32.sub (local.get $w) (i32.shl (local.get $in) (i32.const 1))) (local.get $c))
    (call $hline (i32.add (local.get $x) (local.get $in)) (i32.sub (i32.add (local.get $y) (local.get $h)) (i32.add (local.get $i) (i32.const 1)))
      (i32.sub (local.get $w) (i32.shl (local.get $in) (i32.const 1))) (local.get $c))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $l))))

;; Integer Bresenham. Endpoints beyond +-32767 are rejected (never needed, and unbounded
;; walks would stall); lines fully off one side of the buffer are rejected cheaply.
(func $line (param $x0 i32) (param $y0 i32) (param $x1 i32) (param $y1 i32) (param $c i32)
  (local $dx i32) (local $dy i32) (local $sx i32) (local $sy i32) (local $err i32) (local $e2 i32)
  (if (i32.gt_u (i32.add (local.get $x0) (i32.const 32767)) (i32.const 65534)) (then (return)))
  (if (i32.gt_u (i32.add (local.get $y0) (i32.const 32767)) (i32.const 65534)) (then (return)))
  (if (i32.gt_u (i32.add (local.get $x1) (i32.const 32767)) (i32.const 65534)) (then (return)))
  (if (i32.gt_u (i32.add (local.get $y1) (i32.const 32767)) (i32.const 65534)) (then (return)))
  (if (i32.and (i32.lt_s (local.get $x0) (i32.const 0)) (i32.lt_s (local.get $x1) (i32.const 0))) (then (return)))
  (if (i32.and (i32.lt_s (local.get $y0) (i32.const 0)) (i32.lt_s (local.get $y1) (i32.const 0))) (then (return)))
  (if (i32.and (i32.ge_s (local.get $x0) (global.get $fb_w)) (i32.ge_s (local.get $x1) (global.get $fb_w))) (then (return)))
  (if (i32.and (i32.ge_s (local.get $y0) (global.get $fb_h)) (i32.ge_s (local.get $y1) (global.get $fb_h))) (then (return)))
  (local.set $dx (i32.sub (local.get $x1) (local.get $x0)))
  (local.set $sx (i32.const 1))
  (if (i32.lt_s (local.get $dx) (i32.const 0))
    (then (local.set $dx (i32.sub (i32.const 0) (local.get $dx))) (local.set $sx (i32.const -1))))
  (local.set $dy (i32.sub (local.get $y1) (local.get $y0)))
  (local.set $sy (i32.const 1))
  (if (i32.lt_s (local.get $dy) (i32.const 0))
    (then (local.set $dy (i32.sub (i32.const 0) (local.get $dy))) (local.set $sy (i32.const -1))))
  (local.set $dy (i32.sub (i32.const 0) (local.get $dy)))   ;; -|dy|
  (local.set $err (i32.add (local.get $dx) (local.get $dy)))
  (loop $l
    (call $px (local.get $x0) (local.get $y0) (local.get $c))
    (if (i32.and (i32.eq (local.get $x0) (local.get $x1)) (i32.eq (local.get $y0) (local.get $y1))) (then (return)))
    (local.set $e2 (i32.shl (local.get $err) (i32.const 1)))
    (if (i32.ge_s (local.get $e2) (local.get $dy))
      (then (local.set $err (i32.add (local.get $err) (local.get $dy)))
            (local.set $x0 (i32.add (local.get $x0) (local.get $sx)))))
    (if (i32.le_s (local.get $e2) (local.get $dx))
      (then (local.set $err (i32.add (local.get $err) (local.get $dx)))
            (local.set $y0 (i32.add (local.get $y0) (local.get $sy)))))
    (br $l)))

;; Glyph slot for a character code, or -1 (blank).
(func $gidx (param $ch i32) (result i32)
  (if (i32.lt_u (i32.sub (local.get $ch) (i32.const 97)) (i32.const 26))
    (then (local.set $ch (i32.sub (local.get $ch) (i32.const 32)))))
  (if (i32.lt_u (i32.sub (local.get $ch) (i32.const 32)) (i32.const 64))
    (then (return (i32.sub (local.get $ch) (i32.const 32)))))
  (if (i32.lt_u (i32.sub (local.get $ch) (i32.const 1)) (i32.const 3))
    (then (return (i32.add (local.get $ch) (i32.const 63)))))
  (i32.const -1))

;; font 0 = body 5x7 (advance 6), 1 = badge 3x5 (advance 4).
(func $glyph (param $x i32) (param $y i32) (param $g i32) (param $c i32) (param $font i32)
  (local $w i32) (local $h i32) (local $nb i32) (local $base i32) (local $n i32) (local $tot i32)
  (local.set $font (i32.and (local.get $font) (i32.const 1)))
  (local.set $w (i32.sub (i32.const 5) (i32.shl (local.get $font) (i32.const 1))))
  (local.set $h (i32.sub (i32.const 7) (i32.shl (local.get $font) (i32.const 1))))
  (local.set $nb (i32.sub (i32.const 5) (i32.mul (local.get $font) (i32.const 3))))
  (local.set $base (i32.add (select (global.get $FONT_BADGE) (global.get $FONT_BODY) (local.get $font))
                            (i32.mul (local.get $g) (local.get $nb))))
  (local.set $tot (i32.mul (local.get $w) (local.get $h)))
  (block $done (loop $l
    (br_if $done (i32.ge_u (local.get $n) (local.get $tot)))
    (if (i32.and (i32.shr_u (i32.load8_u (i32.add (local.get $base) (i32.shr_u (local.get $n) (i32.const 3))))
                            (i32.and (local.get $n) (i32.const 7))) (i32.const 1))
      (then (call $px (i32.add (local.get $x) (i32.rem_u (local.get $n) (local.get $w)))
                      (i32.add (local.get $y) (i32.div_u (local.get $n) (local.get $w))) (local.get $c))))
    (local.set $n (i32.add (local.get $n) (i32.const 1)))
    (br $l))))

(func $text_w (param $s i32) (param $font i32) (result i32)
  (local $n i32)
  (local.set $font (i32.and (local.get $font) (i32.const 1)))
  (block $done (loop $l
    (br_if $done (i32.eqz (i32.load8_u (i32.add (local.get $s) (local.get $n)))))
    (local.set $n (i32.add (local.get $n) (i32.const 1)))
    (br $l)))
  (if (result i32) (local.get $n)
    (then (i32.sub (i32.mul (local.get $n) (i32.sub (i32.const 6) (i32.shl (local.get $font) (i32.const 1)))) (i32.const 1)))
    (else (i32.const 0))))

;; Draws a zero-terminated string; returns its width in pixels.
(func $text (param $x i32) (param $y i32) (param $s i32) (param $c i32) (param $font i32) (result i32)
  (local $ch i32) (local $g i32) (local $adv i32) (local $x0 i32)
  (local.set $font (i32.and (local.get $font) (i32.const 1)))
  (local.set $adv (i32.sub (i32.const 6) (i32.shl (local.get $font) (i32.const 1))))
  (local.set $x0 (local.get $x))
  (block $done (loop $l
    (local.set $ch (i32.load8_u (local.get $s)))
    (br_if $done (i32.eqz (local.get $ch)))
    (local.set $g (call $gidx (local.get $ch)))
    (if (i32.ge_s (local.get $g) (i32.const 0))
      (then (call $glyph (local.get $x) (local.get $y) (local.get $g) (local.get $c) (local.get $font))))
    (local.set $x (i32.add (local.get $x) (local.get $adv)))
    (local.set $s (i32.add (local.get $s) (i32.const 1)))
    (br $l)))
  (if (result i32) (i32.eq (local.get $x) (local.get $x0))
    (then (i32.const 0))
    (else (i32.sub (i32.sub (local.get $x) (local.get $x0)) (i32.const 1)))))

;; Render-only integer hash (never the sim RNG).
(func $noise (param $a i32) (param $b i32) (result i32)
  (local $h i32)
  (local.set $h (i32.xor (i32.mul (local.get $a) (i32.const 0x9E3779B1)) (i32.mul (local.get $b) (i32.const 0x85EBCA77))))
  (local.set $h (i32.mul (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 15))) (i32.const 0x2C1B3C6D)))
  (local.set $h (i32.mul (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 12))) (i32.const 0x297A2D39)))
  (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 15))))

;; Ordered dither: 1 when pixel (x,y) is "on" at coverage level 0..16 (Bayer 4x4). The signed
;; compare against entries 0..15 makes any level < 0 act as 0 and > 16 as 16.
(func $dither (param $x i32) (param $y i32) (param $level i32) (result i32)
  (i32.lt_s
    (i32.load8_u (i32.add (global.get $BAYER_ADDR)
      (i32.add (i32.shl (i32.and (local.get $y) (i32.const 3)) (i32.const 2)) (i32.and (local.get $x) (i32.const 3)))))
    (local.get $level)))

;; 50/50 per-channel average of two opaque pixel words (translucent glass, shadows).
(func $blend50 (param $d i32) (param $s i32) (result i32)
  (i32.or (i32.const 0xFF000000)
    (i32.add
      (i32.add (i32.shr_u (i32.and (local.get $d) (i32.const 0xFEFEFEFE)) (i32.const 1))
               (i32.shr_u (i32.and (local.get $s) (i32.const 0xFEFEFEFE)) (i32.const 1)))
      (i32.and (i32.and (local.get $d) (local.get $s)) (i32.const 0x01010101)))))

;; ---- demo scenes (dev/test only) ----
(func $demo_swatches
  (local $h i32) (local $s i32)
  (loop $lh
    (local.set $s (i32.const 0))
    (loop $ls
      (call $rect (i32.add (i32.const 4) (i32.mul (local.get $s) (i32.const 20))) (i32.add (i32.const 4) (i32.mul (local.get $h) (i32.const 12)))
        (i32.const 20) (i32.const 12) (call $hc (local.get $h) (local.get $s)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $ls (i32.lt_u (local.get $s) (i32.const 4))))
    (local.set $h (i32.add (local.get $h) (i32.const 1)))
    (br_if $lh (i32.lt_u (local.get $h) (i32.const 16)))))

(func $demo_text_block
  (local $ink i32) (local $d i32) (local $f i32) (local $y i32)
  (local.set $ink (call $hc (global.get $H_INK) (i32.const 0)))
  (local.set $d (global.get $DEMO_STR))
  (local.set $y (i32.const 6))
  (loop $lf
    (drop (call $text (i32.const 96) (local.get $y) (local.get $d) (local.get $ink) (local.get $f)))
    (drop (call $text (i32.const 96) (i32.add (local.get $y) (i32.shl (i32.sub (i32.const 9) (local.get $f)) (i32.const 0)))
      (i32.add (local.get $d) (i32.const 0x1B)) (local.get $ink) (local.get $f)))
    (drop (call $text (i32.const 96) (i32.add (local.get $y) (i32.shl (i32.sub (i32.const 9) (local.get $f)) (i32.const 1)))
      (i32.add (local.get $d) (i32.const 0x39)) (local.get $ink) (local.get $f)))
    (local.set $y (i32.const 42))
    (local.set $f (i32.add (local.get $f) (i32.const 1)))
    (br_if $lf (i32.lt_u (local.get $f) (i32.const 2)))))

(func $demo_shapes
  (local $x i32) (local $y i32) (local $w i32) (local $a i32) (local $b i32)
  ;; bordered panel with both fonts
  (call $rrect (i32.const 96) (i32.const 74) (i32.const 124) (i32.const 40) (i32.const 2) (call $hc (global.get $H_INK) (i32.const 1)))
  (call $rrect (i32.const 97) (i32.const 75) (i32.const 122) (i32.const 38) (i32.const 2) (call $hc (global.get $H_PAPER) (i32.const 3)))
  (drop (call $text (i32.const 104) (i32.const 82) (i32.add (global.get $DEMO_STR) (i32.const 0x4C)) (call $hc (global.get $H_INK) (i32.const 0)) (i32.const 0)))
  (drop (call $text (i32.const 104) (i32.const 98) (i32.add (global.get $DEMO_STR) (i32.const 0x5C)) (call $hc (global.get $H_INK) (i32.const 1)) (i32.const 1)))
  ;; End Day button
  (call $rrect (i32.const 96) (i32.const 122) (i32.const 100) (i32.const 28) (i32.const 2) (call $hc (global.get $H_BARN) (i32.const 0)))
  (call $rrect (i32.const 97) (i32.const 123) (i32.const 98) (i32.const 26) (i32.const 2) (call $hc (global.get $H_BARN) (i32.const 2)))
  (call $hline (i32.const 99) (i32.const 124) (i32.const 94) (call $hc (global.get $H_BARN) (i32.const 3)))
  (local.set $w (call $text_w (i32.add (global.get $DEMO_STR) (i32.const 0x54)) (i32.const 0)))
  (drop (call $text (i32.add (i32.const 96) (i32.shr_u (i32.sub (i32.const 100) (local.get $w)) (i32.const 1))) (i32.const 132)
    (i32.add (global.get $DEMO_STR) (i32.const 0x54)) (call $hc (global.get $H_PAPER) (i32.const 3)) (i32.const 0)))
  ;; dither ramp: sky -> grass over 17 levels
  (local.set $x (i32.const 0))
  (loop $lx
    (local.set $y (i32.const 0))
    (loop $ly
      (call $px (i32.add (i32.const 96) (local.get $x)) (i32.add (i32.const 160) (local.get $y))
        (select (call $hc (global.get $H_GRASS) (i32.const 2)) (call $hc (global.get $H_SKY) (i32.const 2))
          (call $dither (local.get $x) (local.get $y) (i32.shr_u (local.get $x) (i32.const 3)))))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br_if $ly (i32.lt_u (local.get $y) (i32.const 16))))
    (local.set $x (i32.add (local.get $x) (i32.const 1)))
    (br_if $lx (i32.lt_u (local.get $x) (i32.const 136))))
  ;; noise block: two-tone field
  (local.set $x (i32.const 0))
  (loop $nx
    (local.set $y (i32.const 0))
    (loop $ny
      (call $px (i32.add (i32.const 96) (local.get $x)) (i32.add (i32.const 184) (local.get $y))
        (call $hc (global.get $H_GRASS) (i32.add (i32.const 1) (i32.and (call $noise (local.get $x) (local.get $y)) (i32.const 1)))))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br_if $ny (i32.lt_u (local.get $y) (i32.const 16))))
    (local.set $x (i32.add (local.get $x) (i32.const 1)))
    (br_if $nx (i32.lt_u (local.get $x) (i32.const 64))))
  ;; line fan
  (local.set $x (i32.const 0))
  (loop $fx
    (call $line (i32.const 96) (i32.const 208) (i32.add (i32.const 96) (i32.mul (local.get $x) (i32.const 11))) (i32.const 244)
      (call $hc (global.get $H_WHEAT) (i32.and (local.get $x) (i32.const 3))))
    (local.set $x (i32.add (local.get $x) (i32.const 1)))
    (br_if $fx (i32.lt_u (local.get $x) (i32.const 13))))
  ;; blend50 overlap of two rects
  (local.set $a (call $hc (global.get $H_TOMATO) (i32.const 2)))
  (local.set $b (call $hc (global.get $H_WATER) (i32.const 2)))
  (call $rect (i32.const 96) (i32.const 252) (i32.const 40) (i32.const 24) (local.get $a))
  (call $rect (i32.const 116) (i32.const 262) (i32.const 40) (i32.const 24) (local.get $b))
  (call $rect (i32.const 116) (i32.const 262) (i32.const 20) (i32.const 14) (call $blend50 (local.get $a) (local.get $b))))

;; kind 0: swatches + fonts + shapes; kind 1: clipping stress at all four edges.
(func $demo (param $kind i32)
  (local $i i32) (local $c i32)
  (call $fill (call $hc (global.get $H_PAPER) (i32.const 2)))
  (if (i32.eqz (local.get $kind))
    (then (call $demo_swatches) (call $demo_text_block) (call $demo_shapes))
    (else
      (local.set $c (call $hc (global.get $H_BARN) (i32.const 2)))
      (loop $l
        (call $rrect (i32.sub (i32.mul (local.get $i) (i32.const 37)) (i32.const 20)) (i32.sub (i32.mul (local.get $i) (i32.const 53)) (i32.const 15)) (i32.const 60) (i32.const 40) (i32.const 2) (local.get $c))
        (call $line (i32.const -30) (i32.mul (local.get $i) (i32.const 50)) (i32.const 400) (i32.sub (i32.const 700) (i32.mul (local.get $i) (i32.const 40))) (local.get $c))
        (drop (call $text (i32.sub (i32.mul (local.get $i) (i32.const 33)) (i32.const 9)) (i32.sub (i32.mul (local.get $i) (i32.const 47)) (i32.const 4))
          (global.get $DEMO_STR) (call $hc (global.get $H_INK) (i32.const 0)) (i32.and (local.get $i) (i32.const 1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $l (i32.lt_u (local.get $i) (i32.const 14)))))))

;; Test hooks (draw).
(func $t_px (param $x i32) (param $y i32) (result i32) (call $getpx (local.get $x) (local.get $y)))
(func $t_text (param i32 i32 i32 i32 i32) (result i32)
  (call $text (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
