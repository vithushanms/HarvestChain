;; Isometric 3D software rasteriser (integer only, no sim RNG, no memory scratch: all
;; working values live in locals/globals, so drawing changes nothing below the framebuffer).
;;
;; Projection (2:1 dimetric). World units: 16 per tile on x/y, z up. $iso_hw = half the
;; tile-diamond width in px (diamond is 2*hw wide, hw tall; a 16-unit cube is hw px tall).
;;   sx = ox + round((wx - wy) * hw / 16)        sy = oy + round((wx + wy - 2*wz) * hw / 32)
;; round = floor(v + 1/2) via arithmetic shift (deterministic, one rounding per axis), so a
;; world point always lands on the same pixel and faces sharing world vertices share edges.
;; World inputs are clamped to +-32767 and hw to 1..64, so nothing overflows i32.
;; $iso_proj writes the result to globals $sx/$sy (no multi-value); $iso_pk packs it as
;; (sy << 16) | (sx & 0xFFFF) (both clamped to +-16383) for compact vertex passing.
;;
;; Polygons: $poly6 fills a convex polygon of up to 6 vertices (repeat the last vertex for
;; fewer); $poly3/$poly4 wrap it. Sampling at pixel centres with a top-left rule: row y is in
;; the polygon when ymin <= y < ymax (integer vertices), and pixel x when its centre lies in
;; [x_left, x_right), x_edge evaluated exactly as a rational per row (one i32 division per
;; edge per row, none per pixel). Neighbours sharing an edge therefore tile with no gap and
;; no double cover. Any vertex beyond +-8191 rejects the polygon (never needed on screen).
;;
;; Solids (light from the upper-left; palette idx = hue*4 + step):
;;   $iso_box   top step 3, left (+y) face step 2, right (+x) face step 1
;;   $iso_prism gabled roof; axis 0 = ridge along x, 1 = along y; slopes 2/3 or 3/1, gable 1/2
;;   $iso_cyl   elliptical top step 3, side shaded per column left->right, Bayer-dithered
;;   $iso_sphere screen-space ball, smooth 4-step ramp + dither, highlight upper-left
;;              (+ a cream specular pip when $iso_spec = 1)
;; With $outline = 1 each solid is first stamped in its hue's step 0 at the four 1px
;; offsets, giving a crisp silhouette outline (painter-correct for free).
;; $iso_shadow: ground (z=0) hexagon = footprint swept toward +x/-y by $iso_sl units,
;; blended 50% toward TILLED step 0 so terrain shows through.
;; Painter's order is the caller's job: back to front by wx+wy, then wz.
;;
;; Writes go through one sink, $span: modes $pmode 0 = store, 1 = blend50 (shadow),
;; 2 = increment the pixel word (test hook: coverage counting). $force != 0 overrides colour,
;; ($odx,$ody) shift every write (outline passes).

(global $iso_ox (mut i32) (i32.const 0))
(global $iso_oy (mut i32) (i32.const 0))
(global $iso_hw (mut i32) (i32.const 16))
(global $iso_sl (mut i32) (i32.const 6))
(global $outline (mut i32) (i32.const 1))
(global $iso_spec (mut i32) (i32.const 0))   ;; 1 = specular pip on spheres (fruit, glass)
(global $sx (mut i32) (i32.const 0))
(global $sy (mut i32) (i32.const 0))
(global $pmode (mut i32) (i32.const 0))
(global $force (mut i32) (i32.const 0))
(global $odx (mut i32) (i32.const 0))
(global $ody (mut i32) (i32.const 0))
(global $xl (mut i32) (i32.const 0))
(global $xr (mut i32) (i32.const 0))
;; shape parameters: p0..p2 position, p3..p5 size, p6 hue, p7 axis
(global $p0 (mut i32) (i32.const 0)) (global $p1 (mut i32) (i32.const 0))
(global $p2 (mut i32) (i32.const 0)) (global $p3 (mut i32) (i32.const 0))
(global $p4 (mut i32) (i32.const 0)) (global $p5 (mut i32) (i32.const 0))
(global $p6 (mut i32) (i32.const 0)) (global $p7 (mut i32) (i32.const 0))
;; blob (sphere/cylinder) state: centre, bbox half-size, radius terms, top offset, kind
(global $bcx (mut i32) (i32.const 0)) (global $bcy (mut i32) (i32.const 0))
(global $brx (mut i32) (i32.const 0)) (global $brr (mut i32) (i32.const 0))
(global $binv (mut i32) (i32.const 0)) (global $bH (mut i32) (i32.const 0))
(global $bho (mut i32) (i32.const 0)) (global $bk (mut i32) (i32.const 0))

;; Faces: 4 vertex codes x 6 bits (x sel | y sel<<2 | z sel<<4; sel 0 lo, 1 hi, 2 mid) +
;; ramp step << 24. Box (top, left, right), prism axis 0, prism axis 1 (back, front, gable).
(global $ISO_FACES i32 (i32.const 0x600))
(data (i32.const 0x600)
  "\50\54\51\03" "\54\55\10\02" "\51\55\04\01"
  "\40\90\61\02" "\58\56\10\03" "\41\56\14\01"
  "\80\64\11\03" "\52\50\58\01" "\84\55\14\02")

(func $iso_set (param $ox i32) (param $oy i32) (param $hw i32)
  (global.set $iso_ox (call $clamp (local.get $ox) (i32.const -32767) (i32.const 32767)))
  (global.set $iso_oy (call $clamp (local.get $oy) (i32.const -32767) (i32.const 32767)))
  (global.set $iso_hw (call $clamp (local.get $hw) (i32.const 1) (i32.const 64))))

(func $iso_proj (param $x i32) (param $y i32) (param $z i32)
  (local.set $x (call $clamp (local.get $x) (i32.const -32767) (i32.const 32767)))
  (local.set $y (call $clamp (local.get $y) (i32.const -32767) (i32.const 32767)))
  (local.set $z (call $clamp (local.get $z) (i32.const -32767) (i32.const 32767)))
  (global.set $sx (i32.add (global.get $iso_ox)
    (i32.shr_s (i32.add (i32.mul (i32.sub (local.get $x) (local.get $y)) (global.get $iso_hw)) (i32.const 8)) (i32.const 4))))
  (global.set $sy (i32.add (global.get $iso_oy)
    (i32.shr_s (i32.add (i32.mul (i32.sub (i32.add (local.get $x) (local.get $y)) (i32.shl (local.get $z) (i32.const 1)))
                                 (global.get $iso_hw)) (i32.const 16)) (i32.const 5)))))

;; Project and pack: (sy << 16) | (sx & 0xFFFF), each clamped to +-16383.
(func $iso_pk (param $x i32) (param $y i32) (param $z i32) (result i32)
  (call $iso_proj (local.get $x) (local.get $y) (local.get $z))
  (i32.or (i32.shl (call $clamp (global.get $sy) (i32.const -16383) (i32.const 16383)) (i32.const 16))
          (i32.and (call $clamp (global.get $sx) (i32.const -16383) (i32.const 16383)) (i32.const 0xFFFF))))

;; The single pixel sink: span [x0, x1) on row y (shifted by odx/ody, clipped).
(func $span (param $x0 i32) (param $x1 i32) (param $y i32) (param $c i32)
  (local $p i32) (local $e i32)
  (local.set $y (i32.add (local.get $y) (global.get $ody)))
  (if (i32.ge_u (local.get $y) (global.get $fb_h)) (then (return)))
  (local.set $e (i32.add (global.get $R_FB) (i32.shl (i32.mul (local.get $y) (global.get $fb_w)) (i32.const 2))))
  (local.set $p (i32.add (local.get $e) (i32.shl
    (call $clamp (i32.add (local.get $x0) (global.get $odx)) (i32.const 0) (global.get $fb_w)) (i32.const 2))))
  (local.set $e (i32.add (local.get $e) (i32.shl
    (call $clamp (i32.add (local.get $x1) (global.get $odx)) (i32.const 0) (global.get $fb_w)) (i32.const 2))))
  (if (global.get $force) (then (local.set $c (global.get $force))))
  (block $done (loop $l
    (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
    (i32.store (local.get $p)
      (if (result i32) (global.get $pmode)
        (then (if (result i32) (i32.eq (global.get $pmode) (i32.const 1))
          (then (call $blend50 (i32.load (local.get $p)) (local.get $c)))
          (else (i32.add (i32.load (local.get $p)) (i32.const 1)))))
        (else (local.get $c))))
    (local.set $p (i32.add (local.get $p) (i32.const 4)))
    (br $l))))

;; One polygon edge against row y: widen [xl, xr) with the first pixel whose centre is at or
;; right of the edge's x at y + 1/2. Edges are oriented top->bottom so shared edges agree.
(func $edge (param $ax i32) (param $ay i32) (param $bx i32) (param $by i32) (param $y i32)
  (local $t i32) (local $n i32) (local $d i32)
  (if (i32.gt_s (local.get $ay) (local.get $by)) (then
    (local.set $t (local.get $ax)) (local.set $ax (local.get $bx)) (local.set $bx (local.get $t))
    (local.set $t (local.get $ay)) (local.set $ay (local.get $by)) (local.set $by (local.get $t))))
  (if (i32.and (i32.ge_s (local.get $y) (local.get $ay)) (i32.lt_s (local.get $y) (local.get $by))) (then
    (local.set $d (i32.sub (local.get $by) (local.get $ay)))
    (local.set $n (i32.sub (i32.mul (i32.sub (local.get $bx) (local.get $ax))
                                    (i32.add (i32.shl (i32.sub (local.get $y) (local.get $ay)) (i32.const 1)) (i32.const 1)))
                           (local.get $d)))
    (local.set $d (i32.shl (local.get $d) (i32.const 1)))
    ;; ceil(n / d), d > 0
    (local.set $t (i32.add (i32.add (local.get $ax) (i32.div_s (local.get $n) (local.get $d)))
                           (i32.gt_s (i32.rem_s (local.get $n) (local.get $d)) (i32.const 0))))
    (if (i32.lt_s (local.get $t) (global.get $xl)) (then (global.set $xl (local.get $t))))
    (if (i32.gt_s (local.get $t) (global.get $xr)) (then (global.set $xr (local.get $t)))))))

(func $far (param $v i32) (result i32)
  (i32.gt_u (i32.add (local.get $v) (i32.const 8191)) (i32.const 16382)))

(func $poly6 (param $x0 i32) (param $y0 i32) (param $x1 i32) (param $y1 i32) (param $x2 i32) (param $y2 i32)
             (param $x3 i32) (param $y3 i32) (param $x4 i32) (param $y4 i32) (param $x5 i32) (param $y5 i32) (param $c i32)
  (local $y i32) (local $ye i32)
  (if (i32.or (i32.or (i32.or (i32.or (call $far (local.get $x0)) (call $far (local.get $y0)))
                              (i32.or (call $far (local.get $x1)) (call $far (local.get $y1))))
                      (i32.or (i32.or (call $far (local.get $x2)) (call $far (local.get $y2)))
                              (i32.or (call $far (local.get $x3)) (call $far (local.get $y3)))))
              (i32.or (i32.or (call $far (local.get $x4)) (call $far (local.get $y4)))
                      (i32.or (call $far (local.get $x5)) (call $far (local.get $y5)))))
    (then (return)))
  ;; rows: one beyond each edge of the buffer so outline passes (ody = +-1) still reach it
  (local.set $y (local.get $y0))
  (local.set $ye (local.get $y0))
  (local.set $y (select (local.get $y1) (local.get $y) (i32.lt_s (local.get $y1) (local.get $y))))
  (local.set $ye (select (local.get $y1) (local.get $ye) (i32.gt_s (local.get $y1) (local.get $ye))))
  (local.set $y (select (local.get $y2) (local.get $y) (i32.lt_s (local.get $y2) (local.get $y))))
  (local.set $ye (select (local.get $y2) (local.get $ye) (i32.gt_s (local.get $y2) (local.get $ye))))
  (local.set $y (select (local.get $y3) (local.get $y) (i32.lt_s (local.get $y3) (local.get $y))))
  (local.set $ye (select (local.get $y3) (local.get $ye) (i32.gt_s (local.get $y3) (local.get $ye))))
  (local.set $y (select (local.get $y4) (local.get $y) (i32.lt_s (local.get $y4) (local.get $y))))
  (local.set $ye (select (local.get $y4) (local.get $ye) (i32.gt_s (local.get $y4) (local.get $ye))))
  (local.set $y (select (local.get $y5) (local.get $y) (i32.lt_s (local.get $y5) (local.get $y))))
  (local.set $ye (select (local.get $y5) (local.get $ye) (i32.gt_s (local.get $y5) (local.get $ye))))
  (local.set $y (call $clamp (local.get $y) (i32.const -1) (i32.add (global.get $fb_h) (i32.const 1))))
  (local.set $ye (call $clamp (local.get $ye) (i32.const -1) (i32.add (global.get $fb_h) (i32.const 1))))
  (block $done (loop $l
    (br_if $done (i32.ge_s (local.get $y) (local.get $ye)))
    (global.set $xl (i32.const 0x3FFFFFFF))
    (global.set $xr (i32.const -0x3FFFFFFF))
    (call $edge (local.get $x0) (local.get $y0) (local.get $x1) (local.get $y1) (local.get $y))
    (call $edge (local.get $x1) (local.get $y1) (local.get $x2) (local.get $y2) (local.get $y))
    (call $edge (local.get $x2) (local.get $y2) (local.get $x3) (local.get $y3) (local.get $y))
    (call $edge (local.get $x3) (local.get $y3) (local.get $x4) (local.get $y4) (local.get $y))
    (call $edge (local.get $x4) (local.get $y4) (local.get $x5) (local.get $y5) (local.get $y))
    (call $edge (local.get $x5) (local.get $y5) (local.get $x0) (local.get $y0) (local.get $y))
    (call $span (global.get $xl) (global.get $xr) (local.get $y) (local.get $c))
    (local.set $y (i32.add (local.get $y) (i32.const 1)))
    (br $l))))

(func $poly4 (param $x0 i32) (param $y0 i32) (param $x1 i32) (param $y1 i32) (param $x2 i32) (param $y2 i32)
             (param $x3 i32) (param $y3 i32) (param $c i32)
  (call $poly6 (local.get $x0) (local.get $y0) (local.get $x1) (local.get $y1) (local.get $x2) (local.get $y2)
    (local.get $x3) (local.get $y3) (local.get $x3) (local.get $y3) (local.get $x3) (local.get $y3) (local.get $c)))
(func $poly3 (param $x0 i32) (param $y0 i32) (param $x1 i32) (param $y1 i32) (param $x2 i32) (param $y2 i32) (param $c i32)
  (call $poly4 (local.get $x0) (local.get $y0) (local.get $x1) (local.get $y1) (local.get $x2) (local.get $y2)
    (local.get $x2) (local.get $y2) (local.get $c)))

;; Ramp position v (0..63, 16 per step) -> palette colour. Each step is a solid band with a
;; Bayer-dithered transition over its upper half (level 2f-8), so shading reads smooth, not noisy.
(func $ramp (param $hue i32) (param $v i32) (param $x i32) (param $y i32) (result i32)
  (local.set $v (call $clamp (local.get $v) (i32.const 0) (i32.const 63)))
  (call $hc (local.get $hue) (call $clamp
    (i32.add (i32.shr_u (local.get $v) (i32.const 4))
      (call $dither (local.get $x) (local.get $y) (i32.sub (i32.shl (i32.and (local.get $v) (i32.const 15)) (i32.const 1)) (i32.const 8))))
    (i32.const 0) (i32.const 3))))

;; Face-table vertex code -> packed screen point, from the box coordinate selectors.
(func $fsel (param $s i32) (param $lo i32) (param $len i32) (result i32)
  (i32.add (local.get $lo)
    (select (local.get $len) (select (i32.shr_s (local.get $len) (i32.const 1)) (i32.const 0) (i32.eq (local.get $s) (i32.const 2)))
            (i32.eq (local.get $s) (i32.const 1)))))
(func $fv (param $code i32) (result i32)
  (call $iso_pk
    (call $fsel (i32.and (local.get $code) (i32.const 3)) (global.get $p0) (global.get $p3))
    (call $fsel (i32.and (i32.shr_u (local.get $code) (i32.const 2)) (i32.const 3)) (global.get $p1) (global.get $p4))
    (call $fsel (i32.shr_u (local.get $code) (i32.const 4)) (global.get $p2) (global.get $p5))))

;; Blob pixel (dx, dy relative to the centre; x, y screen) -> colour, 0 = outside.
(func $bpx (param $dx i32) (param $dy i32) (param $x i32) (param $y i32) (result i32)
  (local $t i32) (local $d i32)
  (local.set $t (i32.mul (local.get $dx) (local.get $dx)))
  (if (global.get $bk)
    (then ;; sphere: highlight centre at (-bho, -bho)
      (if (i32.gt_s (i32.add (local.get $t) (i32.mul (local.get $dy) (local.get $dy))) (global.get $brr))
        (then (return (i32.const 0))))
      (local.set $dx (i32.add (local.get $dx) (global.get $bho)))
      (local.set $dy (i32.add (local.get $dy) (global.get $bho)))
      (local.set $d (i32.add (i32.mul (local.get $dx) (local.get $dx)) (i32.mul (local.get $dy) (local.get $dy))))
      (if (i32.and (i32.le_s (i32.shl (local.get $d) (i32.const 5)) (global.get $brr)) (i32.and (global.get $iso_spec) (i32.gt_s (global.get $brx) (i32.const 3))))
        (then (return (call $hc (global.get $H_PAPER) (i32.const 3)))))
      (return (call $ramp (global.get $p6)
        (i32.sub (i32.const 66) (i32.shr_u (i32.mul (local.get $d) (global.get $binv)) (i32.const 12)))
        (local.get $x) (local.get $y)))))
  ;; cylinder: top ellipse at dy = -bH, base ellipse at dy = 0; ellipse dx^2 + 4dy^2 <= rr
  (if (i32.gt_s (local.get $t) (global.get $brr)) (then (return (i32.const 0))))
  (local.set $d (i32.add (local.get $dy) (global.get $bH)))
  (if (i32.le_s (i32.add (local.get $t) (i32.shl (i32.mul (local.get $d) (local.get $d)) (i32.const 2))) (global.get $brr))
    (then (return (call $ramp (global.get $p6)
      (i32.sub (i32.const 60) (i32.shr_s (i32.mul (local.get $dx) (global.get $binv)) (i32.const 13)))
      (local.get $x) (local.get $y)))))
  (if (i32.or (i32.and (i32.le_s (local.get $dy) (i32.const 0)) (i32.ge_s (local.get $d) (i32.const 0)))
              (i32.le_s (i32.add (local.get $t) (i32.shl (i32.mul (local.get $dy) (local.get $dy)) (i32.const 2))) (global.get $brr)))
    (then (return (call $ramp (global.get $p6)
      (i32.sub (i32.const 26) (i32.shr_s (i32.mul (local.get $dx) (global.get $binv)) (i32.const 12)))
      (local.get $x) (local.get $y)))))
  (i32.const 0))

;; Iterate the blob bbox: dx in [-brx, brx], dy in [-bH - brx, brx] (clipped, 1px margin).
(func $blob
  (local $x i32) (local $y i32) (local $x1 i32) (local $y1 i32) (local $c i32)
  (local.set $y (call $clamp (i32.sub (i32.sub (global.get $bcy) (global.get $bH)) (global.get $brx)) (i32.const -1) (global.get $fb_h)))
  (local.set $y1 (call $clamp (i32.add (global.get $bcy) (global.get $brx)) (i32.const -1) (global.get $fb_h)))
  (block $dy (loop $ly
    (br_if $dy (i32.gt_s (local.get $y) (local.get $y1)))
    (local.set $x (call $clamp (i32.sub (global.get $bcx) (global.get $brx)) (i32.const -1) (global.get $fb_w)))
    (local.set $x1 (call $clamp (i32.add (global.get $bcx) (global.get $brx)) (i32.const -1) (global.get $fb_w)))
    (block $dx (loop $lx
      (br_if $dx (i32.gt_s (local.get $x) (local.get $x1)))
      (local.set $c (call $bpx (i32.sub (local.get $x) (global.get $bcx)) (i32.sub (local.get $y) (global.get $bcy))
                               (local.get $x) (local.get $y)))
      (if (local.get $c) (then (call $span (local.get $x) (i32.add (local.get $x) (i32.const 1)) (local.get $y) (local.get $c))))
      (local.set $x (i32.add (local.get $x) (i32.const 1)))
      (br $lx)))
    (local.set $y (i32.add (local.get $y) (i32.const 1)))
    (br $ly))))

;; One pass of a solid: kind 0 box, 1 prism (faces), >= 2 blob.
(func $shape (param $k i32)
  (local $f i32) (local $e i32) (local $w i32) (local $a i32) (local $b i32) (local $c i32) (local $d i32)
  (if (i32.ge_u (local.get $k) (i32.const 2)) (then (call $blob) (return)))
  (local.set $f (i32.add (global.get $ISO_FACES)
    (select (i32.add (i32.const 12) (i32.mul (i32.and (global.get $p7) (i32.const 1)) (i32.const 12))) (i32.const 0) (local.get $k))))
  (local.set $e (i32.add (local.get $f) (i32.const 12)))
  (loop $l
    (local.set $w (i32.load (local.get $f)))
    (local.set $a (call $fv (i32.and (local.get $w) (i32.const 63))))
    (local.set $b (call $fv (i32.and (i32.shr_u (local.get $w) (i32.const 6)) (i32.const 63))))
    (local.set $c (call $fv (i32.and (i32.shr_u (local.get $w) (i32.const 12)) (i32.const 63))))
    (local.set $d (call $fv (i32.and (i32.shr_u (local.get $w) (i32.const 18)) (i32.const 63))))
    (call $poly4
      (i32.extend16_s (local.get $a)) (i32.shr_s (local.get $a) (i32.const 16))
      (i32.extend16_s (local.get $b)) (i32.shr_s (local.get $b) (i32.const 16))
      (i32.extend16_s (local.get $c)) (i32.shr_s (local.get $c) (i32.const 16))
      (i32.extend16_s (local.get $d)) (i32.shr_s (local.get $d) (i32.const 16))
      (call $hc (global.get $p6) (i32.shr_u (local.get $w) (i32.const 24))))
    (local.set $f (i32.add (local.get $f) (i32.const 4)))
    (br_if $l (i32.lt_u (local.get $f) (local.get $e)))))

;; Draw solid kind k from p0..p7: optional outline (4 offset stamps in step 0), then shaded.
(func $solid (param $k i32)
  (local $i i32) (local $d i32)
  (global.set $p6 (i32.and (global.get $p6) (i32.const 15)))
  (if (global.get $outline) (then
    (global.set $force (call $hc (global.get $p6) (i32.const 0)))
    (loop $l
      (local.set $d (i32.sub (i32.shl (i32.and (local.get $i) (i32.const 1)) (i32.const 1)) (i32.const 1)))
      (global.set $odx (select (local.get $d) (i32.const 0) (i32.lt_u (local.get $i) (i32.const 2))))
      (global.set $ody (select (i32.const 0) (local.get $d) (i32.lt_u (local.get $i) (i32.const 2))))
      (call $shape (local.get $k))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 4))))))
  (global.set $force (i32.const 0))
  (global.set $odx (i32.const 0))
  (global.set $ody (i32.const 0))
  (call $shape (local.get $k)))

(func $setp (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32) (param $f i32) (param $hue i32)
  (global.set $p0 (local.get $a)) (global.set $p1 (local.get $b)) (global.set $p2 (local.get $c))
  (global.set $p3 (local.get $d)) (global.set $p4 (local.get $e)) (global.set $p5 (local.get $f))
  (global.set $p6 (local.get $hue)))

(func $iso_box (param $wx i32) (param $wy i32) (param $wz i32) (param $w i32) (param $d i32) (param $h i32) (param $hue i32)
  (call $setp (local.get $wx) (local.get $wy) (local.get $wz) (local.get $w) (local.get $d) (local.get $h) (local.get $hue))
  (call $solid (i32.const 0)))

;; Gabled roof over the footprint; h = ridge height above wz.
(func $iso_prism (param $wx i32) (param $wy i32) (param $wz i32) (param $w i32) (param $d i32) (param $h i32)
                 (param $hue i32) (param $axis i32)
  (call $setp (local.get $wx) (local.get $wy) (local.get $wz) (local.get $w) (local.get $d) (local.get $h) (local.get $hue))
  (global.set $p7 (local.get $axis))
  (call $solid (i32.const 1)))

;; Vertical cylinder: base centre (wx, wy, wz), radius r and height h in world units.
(func $iso_cyl (param $wx i32) (param $wy i32) (param $wz i32) (param $r i32) (param $h i32) (param $hue i32)
  (local $r2 i32)
  (call $iso_proj (local.get $wx) (local.get $wy) (local.get $wz))
  (global.set $bcx (global.get $sx))
  (global.set $bcy (global.get $sy))
  (call $iso_proj (local.get $wx) (local.get $wy) (i32.add (call $clamp (local.get $wz) (i32.const -32767) (i32.const 32767))
                                                           (call $clamp (local.get $h) (i32.const 0) (i32.const 4095))))
  (global.set $bH (i32.sub (global.get $bcy) (global.get $sy)))
  ;; screen x-radius = r * hw * sqrt(2) / 16
  (global.set $brx (i32.shr_u (i32.add (i32.mul (i32.mul (call $clamp (local.get $r) (i32.const 0) (i32.const 255)) (global.get $iso_hw))
                                                (i32.const 181)) (i32.const 1024)) (i32.const 11)))
  (call $blob_init (i32.const 0) (local.get $hue)))

(func $blob_init (param $k i32) (param $hue i32)
  (global.set $bk (local.get $k))
  (global.set $p6 (local.get $hue))
  (global.set $brr (i32.mul (global.get $brx) (i32.add (global.get $brx) (i32.const 1))))
  (global.set $bho (i32.div_u (i32.shl (global.get $brx) (i32.const 1)) (i32.const 5)))
  ;; cylinder: v slope 36 per diameter (<< 12); sphere: 66 at highlight -> 0 at 2 r^2
  (global.set $binv (select
    (i32.div_u (i32.const 1351680) (i32.add (i32.mul (i32.mul (global.get $brx) (global.get $brx)) (i32.const 10)) (i32.const 5)))
    (i32.div_u (i32.const 73728) (i32.add (global.get $brx) (i32.const 1)))
    (local.get $k)))
  ;; offscreen-far centres are skipped (bbox math stays small)
  (if (i32.or (call $far (global.get $bcx)) (call $far (global.get $bcy))) (then (return)))
  (call $solid (i32.add (local.get $k) (i32.const 2))))

;; Screen-space shaded ball (canopies, domes, fruit). r in px.
(func $iso_sphere (param $cx i32) (param $cy i32) (param $r i32) (param $hue i32)
  (global.set $bcx (local.get $cx))
  (global.set $bcy (local.get $cy))
  (global.set $brx (call $clamp (local.get $r) (i32.const 0) (i32.const 255)))
  (global.set $bH (i32.const 0))
  (call $blob_init (i32.const 1) (local.get $hue)))

;; Ground shadow: footprint (wx, wy, w, d) swept by (sl, -sl/2), blended toward dark soil.
(func $iso_shadow (param $wx i32) (param $wy i32) (param $w i32) (param $d i32)
  (local $x1 i32) (local $y1 i32) (local $a i32) (local $b i32)
  (local $p0 i32) (local $p1 i32) (local $p2 i32) (local $p3 i32) (local $p4 i32) (local $p5 i32)
  (local.set $x1 (i32.add (local.get $wx) (local.get $w)))
  (local.set $y1 (i32.add (local.get $wy) (local.get $d)))
  (local.set $a (global.get $iso_sl))
  (local.set $b (i32.shr_s (global.get $iso_sl) (i32.const 1)))
  (local.set $p0 (call $iso_pk (local.get $wx) (local.get $wy) (i32.const 0)))
  (local.set $p1 (call $iso_pk (i32.add (local.get $wx) (local.get $a)) (i32.sub (local.get $wy) (local.get $b)) (i32.const 0)))
  (local.set $p2 (call $iso_pk (i32.add (local.get $x1) (local.get $a)) (i32.sub (local.get $wy) (local.get $b)) (i32.const 0)))
  (local.set $p3 (call $iso_pk (i32.add (local.get $x1) (local.get $a)) (i32.sub (local.get $y1) (local.get $b)) (i32.const 0)))
  (local.set $p4 (call $iso_pk (local.get $x1) (local.get $y1) (i32.const 0)))
  (local.set $p5 (call $iso_pk (local.get $wx) (local.get $y1) (i32.const 0)))
  (global.set $pmode (i32.const 1))
  (call $poly6
    (i32.extend16_s (local.get $p0)) (i32.shr_s (local.get $p0) (i32.const 16))
    (i32.extend16_s (local.get $p1)) (i32.shr_s (local.get $p1) (i32.const 16))
    (i32.extend16_s (local.get $p2)) (i32.shr_s (local.get $p2) (i32.const 16))
    (i32.extend16_s (local.get $p3)) (i32.shr_s (local.get $p3) (i32.const 16))
    (i32.extend16_s (local.get $p4)) (i32.shr_s (local.get $p4) (i32.const 16))
    (i32.extend16_s (local.get $p5)) (i32.shr_s (local.get $p5) (i32.const 16))
    (call $hc (global.get $H_TILLED) (i32.const 0)))
  (global.set $pmode (i32.const 0)))

;; Flat ground quad over world rect (wx, wy, w, d) at height wz.
(func $iso_quad (param $wx i32) (param $wy i32) (param $wz i32) (param $w i32) (param $d i32) (param $c i32)
  (local $a i32) (local $b i32) (local $e i32) (local $f i32)
  (local.set $a (call $iso_pk (local.get $wx) (local.get $wy) (local.get $wz)))
  (local.set $b (call $iso_pk (i32.add (local.get $wx) (local.get $w)) (local.get $wy) (local.get $wz)))
  (local.set $e (call $iso_pk (i32.add (local.get $wx) (local.get $w)) (i32.add (local.get $wy) (local.get $d)) (local.get $wz)))
  (local.set $f (call $iso_pk (local.get $wx) (i32.add (local.get $wy) (local.get $d)) (local.get $wz)))
  (call $poly4
    (i32.extend16_s (local.get $a)) (i32.shr_s (local.get $a) (i32.const 16))
    (i32.extend16_s (local.get $b)) (i32.shr_s (local.get $b) (i32.const 16))
    (i32.extend16_s (local.get $e)) (i32.shr_s (local.get $e) (i32.const 16))
    (i32.extend16_s (local.get $f)) (i32.shr_s (local.get $f) (i32.const 16))
    (local.get $c)))

;; ---- demo scene (dev/test only): a lit diorama sized to the framebuffer ----
(func $iso_demo (param $kind i32)
  (local $i i32) (local $j i32) (local $hw i32) (local $c i32)
  (call $fill (call $hc (global.get $H_SKY) (i32.const 3)))
  (local.set $hw (i32.div_u (global.get $fb_w) (i32.const 14)))
  (call $iso_set (i32.shr_u (global.get $fb_w) (i32.const 1))
    (i32.sub (i32.shr_u (global.get $fb_h) (i32.const 1)) (i32.mul (local.get $hw) (i32.const 3))) (local.get $hw))
  (global.set $outline (i32.const 1))
  ;; soil slab + grass checker (a tilled 2x2 patch)
  (call $iso_box (i32.const 0) (i32.const 0) (i32.const -10) (i32.const 96) (i32.const 96) (i32.const 10) (global.get $H_SOIL))
  (loop $li
    (local.set $j (i32.const 0))
    (loop $lj
      (local.set $c (call $hc (select (global.get $H_GRASS) (global.get $H_GRASS2) (i32.and (i32.add (local.get $i) (local.get $j)) (i32.const 1)))
                              (i32.const 2)))
      (if (i32.and (i32.lt_u (i32.sub (local.get $i) (i32.const 4)) (i32.const 2)) (i32.lt_u (i32.sub (local.get $j) (i32.const 3)) (i32.const 2)))
        (then (local.set $c (call $hc (global.get $H_TILLED) (i32.add (i32.const 2) (i32.and (local.get $j) (i32.const 1)))))))
      (call $iso_quad (i32.shl (local.get $i) (i32.const 4)) (i32.shl (local.get $j) (i32.const 4)) (i32.const 0)
        (i32.const 16) (i32.const 16) (local.get $c))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $lj (i32.lt_u (local.get $j) (i32.const 6))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $li (i32.lt_u (local.get $i) (i32.const 6))))
  ;; shadows
  (global.set $iso_sl (i32.const 12))
  (call $iso_shadow (i32.const 18) (i32.const 18) (i32.const 28) (i32.const 26))
  (call $iso_shadow (i32.const 16) (i32.const 64) (i32.const 18) (i32.const 18))
  (global.set $iso_sl (i32.const 6))
  (call $iso_shadow (i32.const 66) (i32.const 14) (i32.const 14) (i32.const 14))
  (call $iso_shadow (i32.const 52) (i32.const 50) (i32.const 10) (i32.const 10))
  (call $iso_shadow (i32.const 70) (i32.const 64) (i32.const 10) (i32.const 10))
  (call $iso_shadow (i32.const 58) (i32.const 74) (i32.const 14) (i32.const 14))
  (call $iso_shadow (i32.const 82) (i32.const 82) (i32.const 8) (i32.const 8))
  ;; house (back), tree, silo, crates (front), back to front by wx+wy
  (call $iso_box (i32.const 20) (i32.const 20) (i32.const 0) (i32.const 26) (i32.const 22) (i32.const 18) (global.get $H_WOOD))
  (call $iso_prism (i32.const 18) (i32.const 18) (i32.const 18) (i32.const 30) (i32.const 26) (i32.const 14) (global.get $H_BARN) (i32.const 0))
  (call $iso_box (i32.const 30) (i32.const 42) (i32.const 0) (i32.const 8) (i32.const 1) (i32.const 11) (global.get $H_INK))
  (call $iso_cyl (i32.const 73) (i32.const 21) (i32.const 0) (i32.const 2) (i32.const 14) (global.get $H_WOOD))
  (call $iso_proj (i32.const 73) (i32.const 21) (i32.const 24))
  (call $iso_sphere (global.get $sx) (global.get $sy) (i32.div_u (i32.mul (local.get $hw) (i32.const 11)) (i32.const 16)) (global.get $H_GRASS))
  (call $iso_box (i32.const 52) (i32.const 50) (i32.const 0) (i32.const 10) (i32.const 10) (i32.const 8) (global.get $H_WOOD))
  (call $iso_cyl (i32.const 25) (i32.const 73) (i32.const 0) (i32.const 8) (i32.const 40) (global.get $H_STONE))
  (call $iso_cyl (i32.const 25) (i32.const 73) (i32.const 40) (i32.const 9) (i32.const 3) (global.get $H_BARN))
  (call $iso_box (i32.const 70) (i32.const 64) (i32.const 0) (i32.const 10) (i32.const 10) (i32.const 14) (global.get $H_CORN))
  (call $iso_box (i32.const 58) (i32.const 74) (i32.const 0) (i32.const 14) (i32.const 14) (i32.const 24) (global.get $H_STONE))
  (call $iso_box (i32.const 82) (i32.const 82) (i32.const 0) (i32.const 8) (i32.const 8) (i32.const 6) (global.get $H_TOMATO))
  (call $iso_proj (i32.const 86) (i32.const 86) (i32.const 10))
  (global.set $iso_spec (i32.const 1))
  (call $iso_sphere (global.get $sx) (global.get $sy) (i32.shr_u (local.get $hw) (i32.const 2)) (global.get $H_TOMATO))
  (global.set $iso_spec (i32.const 0)))

;; Test hooks.
(func $t_iso_proj (param $x i32) (param $y i32) (param $z i32) (result i32)
  (call $iso_pk (local.get $x) (local.get $y) (local.get $z)))
(func $t_iso_mode (param $o i32) (param $m i32)
  (global.set $outline (local.get $o)) (global.set $pmode (local.get $m)))
