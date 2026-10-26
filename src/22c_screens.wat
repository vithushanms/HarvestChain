;; Screens over the farm (plan Task 5c): Title, morning Gazette, Journal, Results / Game Over and
;; How to play. One $scr state: 0 farm (+ tabs, 22a/22b) 1 Title 2 Gazette 3 Journal 4 Results
;; 5 Game Over 6 How to play 7 replay viewer (24_replay.wat: its body, keys and taps). An overlay is drawn over the dimmed full-screen farm scene (no top bar,
;; tabs or sheet); a full-screen HIT_PANEL region under its buttons absorbs every other tap, and
;; $key handles only Esc / Enter / J while one is open. The cards reuse the sheet machinery
;; ($draw_box: header, close button, clipped scrolling body, $put rows) and size themselves to their
;; content ($box_need from the previous pass; a change re-renders once). Pure presentation: the sim
;; changes only through $init / $act (CONTINUE = act 19); render-only frames leave it untouched.
;;
;; Navigation: $open(s) pushes the screen it came from on a back stack ($scr_ret, 4 bits a screen,
;; top in the low nibble; the farm also keeps its tab scroll); Esc, the close button, START DAY and
;; the How-to BACK / DONE pop it (Gazette, Journal, How to play only), so Gazette -> Journal -> Esc
;; -> Esc reaches the farm and How to play -> Journal -> Esc -> Esc the Title. Results /
;; Game Over / Title are left only through their buttons. End Day: Results / Game Over when the
;; status says so, else the Gazette unless its auto-open pref (get_flags bit 2) is off.
;; Two-step NEW GAME / DAILY SEED (over a save) share $armed with DEMOLISH (400 ms, 3 s).
;; Seeds: NEW GAME / TRY AGAIN take the env seed (set_env) and advance it, so each new game in a
;; session differs (TRY AGAIN also skips the seed being played); DAILY SEED = daily * 0x9E3779B1.
;;
;; Hit codes (panel range): 0x3C0 CONTINUE 0x3C1 NEW GAME 0x3C2 DAILY SEED 0x3C3 HOW TO PLAY
;;   0x3C4 LARGE TEXT 0x3C5 AUTO GAZETTE / DON'T SHOW 0x3C6 JOURNAL 0x3C7 START DAY (back)
;;   0x3C8 COPY CODE (share slot, 24_replay.wat; 0x3D0.. replay codes there) 0x3C9 CONTINUE IN ENDLESS 0x3CA TRY AGAIN
;;   0x3CB BACK (page) 0x3CC NEXT / DONE 0x3CD RESULTS (from the Journal); 0x2FF inert milestone rows.
;; R_LAYOUT: 0xAA00..0xAA3F last End Day summary, 0xAA40..0xAC3F announce / summary text builder (512 B).
;; Announcements: "TITLE. <label lines>, <button labels>", toggles with " ON" / " OFF", the font's
;; star / arrow glyphs as words and the '^' middle dot as a comma; the Journal says "n OF 7 DONE"
;; first and each milestone row's name before its progress line.

(global $scr (mut i32) (i32.const 0))
(global $scr_ret (mut i32) (i32.const 0))      ;; back stack (see Navigation)
(global $ret_scroll (mut i32) (i32.const 0))   ;; farm tab scroll when a screen opened over it
(global $scr_t (mut i32) (i32.const -2))       ;; when the screen opened (confetti), -1 = next frame
(global $has_save (mut i32) (i32.const 0))     ;; ui_boot(has_save); any new game makes one
(global $page (mut i32) (i32.const 0))         ;; How to play page 0..2
(global $ann_pend (mut i32) (i32.const 0))     ;; announce the screen after its next draw
(global $box_need (mut i32) (i32.const 0))     ;; card height the content needs (last pass)
(global $nest (mut i32) (i32.const 0))
(global $oh_icon (mut i32) (i32.const 0))      ;; card header icon / title ($ovl_head)
(global $oh_title (mut i32) (i32.const 0))
(global $rp_top (mut i32) (i32.const 0))       ;; replay viewer card top (the farm fits above it)
(global $ANNBUF i32 (i32.const 0xAA40))
(global $SUMMARY i32 (i32.const 0xAA00))
;; per screen: header icon (0x955; Gazette = today's weather) and
;; the Enter key's button (0x95C, low byte of 0x3Cx; Title: CONTINUE or NEW GAME)
(data (i32.const 0x955) "\00\00\02\1c\01\0f\08")
(data (i32.const 0x95C) "\00\c0\c7\c7\c9\ca\cc")
(data (i32.const 0x963) "\40\50\59")               ;; How to play page models: Wheat, Mill, Garage
(data (i32.const 0x966) "\1a\16\0a\32\22\26")      ;; confetti colours (tomato, corn, grass, sky, grape, barn)
(data (i32.const 0x96C) "\00\01\02\01\03\04\01")  ;; milestone -> progress prefix (STR_MP + n)

(func $go (param $s i32)
  (global.set $scr (local.get $s))
  (global.set $scroll (i32.const 0)) (global.set $arm (i32.const 0)) (global.set $page (i32.const 0))
  (global.set $hover_tile (i32.const -1)) (global.set $scr_t (i32.const -1))
  (global.set $ann_pend (i32.ne (local.get $s) (i32.const 0)))
  (global.set $dirty (i32.const 1)))
(func $open (param $s i32)
  (if (i32.eqz (global.get $scr)) (then (global.set $ret_scroll (global.get $scroll))))
  (global.set $scr_ret (i32.or (i32.shl (global.get $scr_ret) (i32.const 4)) (global.get $scr)))
  (call $go (local.get $s)))
;; Back from a Gazette / Journal / How to play: pop the screen it was opened from.
(func $pop
  (local $s i32)
  (local.set $s (i32.and (global.get $scr_ret) (i32.const 15)))
  (global.set $scr_ret (i32.shr_u (global.get $scr_ret) (i32.const 4)))
  (call $go (local.get $s))
  (if (i32.eqz (local.get $s)) (then (global.set $scroll (global.get $ret_scroll)))))
;; Results (status 1) / Game Over (3) when the run has ended (the End Day toasts are cleared:
;; the screen says it all).
(func $after_state
  (local $s i32)
  (local.set $s (i32.load8_u (global.get $S_STATUS)))
  (if (i32.and (local.get $s) (i32.const 1)) (then
    (memory.fill (global.get $TOASTS) (i32.const 0) (i32.const 192))
    (call $go (i32.add (i32.const 4) (i32.shr_u (local.get $s) (i32.const 1)))))))
;; After a successful End Day: the run's end takes precedence over the morning Gazette.
(func $after_end
  (call $after_state)
  (if (i32.eqz (i32.or (global.get $scr) (global.get $flag_gazoff))) (then (call $open (i32.const 2)))))
(func $fresh (param $seed i32)
  (call $ui_new_game (local.get $seed))
  (global.set $has_save (i32.const 1))
  ;; the guided first days (22d_onboard.wat) start with every new game until done or skipped; once
  ;; done, an ALL SET card left open does not follow into the new game
  (if (i32.eqz (global.get $tut_done)) (then (call $tut_go (i32.const 1))) (else (global.set $tut (i32.const 0)))))
(func $next_seed (result i32)
  (local $s i32)
  (local.set $s (call $lget (global.get $L_SEED)))
  (call $lput (global.get $L_SEED) (i32.add (local.get $s) (i32.const 1)))
  (local.get $s))
;; The Enter key's button on this screen.
(func $primary (result i32)
  (i32.or (i32.const 0x300) (select (i32.sub (i32.const 0xC1) (global.get $has_save))
    (i32.load8_u (i32.add (i32.const 0x95C) (global.get $scr))) (i32.eq (global.get $scr) (i32.const 1)))))

;; Overlay buttons (and the Build tab's JOURNAL). Only Gazette / Journal / How to play close.
(func $ovl_tap (param $c i32)
  (if (i32.eq (local.get $c) (global.get $HIT_CLOSE)) (then (call $back) (return)))
  ;; share / replay codes (24_replay.wat)
  (if (i32.or (i32.eq (local.get $c) (i32.const 0x3C8)) (i32.ge_u (local.get $c) (i32.const 0x3D0))) (then (call $rp_tap (local.get $c)) (return)))
  (global.set $dirty (i32.const 1))
  (block $x (block $k_res (block $k_next (block $k_prev (block $k_try (block $k_end (block $k_start
  (block $k_jour (block $k_gaz (block $k_large (block $k_how (block $k_new (block $k_cont
    (br_table $k_cont $k_new $k_new $k_how $k_large $k_gaz $k_jour $k_start $x $k_end $k_try $k_prev $k_next $k_res $x
      (i32.sub (local.get $c) (i32.const 0x3C0))))
    ;; CONTINUE: the farm, or the end-of-run screen of a finished save
    (call $go (i32.const 0)) (call $after_state) (br $x))
    ;; NEW GAME / DAILY SEED: two taps unless the Title has no save to replace
    (if (i32.eqz (i32.and (i32.eq (global.get $scr) (i32.const 1)) (i32.eqz (global.get $has_save))))
      (then (br_if $x (i32.eqz (call $armed (local.get $c))))))
    (if (i32.eq (local.get $c) (i32.const 0x3C2))
      (then (call $fresh (i32.mul (call $lget (global.get $L_DSEED)) (i32.const 0x9E3779B1))))
      (else (call $fresh (call $next_seed))))
    (br $x))
    (call $open (i32.const 6)) (br $x))
    (call $set_pref (i32.const 0) (i32.eqz (global.get $flag_large))) (call $say_tog (local.get $c)) (br $x))
    (global.set $flag_gazoff (i32.eqz (global.get $flag_gazoff))) (call $say_tog (local.get $c)) (br $x))
    (call $open (i32.const 3)) (br $x))
    (call $back) (br $x))
    ;; CONTINUE IN ENDLESS (act CONTINUE; $do toasts an error, requests the save)
    (if (i32.eqz (call $do (i32.const 19) (i32.const 0) (i32.const 0) (i32.const 0))) (then (call $go (i32.const 0))))
    (br $x))
    ;; TRY AGAIN: never the seed that just ended
    (if (i32.eq (call $lget (global.get $L_SEED)) (i32.load (global.get $S_SEED)))
      (then (drop (call $next_seed))))
    (call $fresh (call $next_seed)) (br $x))
    (if (global.get $page) (then (global.set $page (i32.sub (global.get $page) (i32.const 1)))) (else (call $back)))
    (br $x))
    (if (i32.lt_u (global.get $page) (i32.const 2)) (then (global.set $page (i32.add (global.get $page) (i32.const 1)))) (else (call $back)))
    (br $x))
    (call $after_state)))

;; ---------------------------------------------------------------- drawing

;; Dim the framebuffer to 3/4 (grey = a darker grey-scale for Game Over).
(func $dim (param $grey i32)
  (local $p i32) (local $e i32) (local $c i32)
  (local.set $p (global.get $R_FB))
  (local.set $e (i32.add (local.get $p) (i32.shl (i32.mul (global.get $fb_w) (global.get $fb_h)) (i32.const 2))))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $p) (local.get $e)))
    (local.set $c (i32.load (local.get $p)))
    (local.set $c (select
      (i32.or (i32.mul (i32.shr_u (i32.add (i32.add (i32.and (local.get $c) (i32.const 0xFF)) (i32.and (i32.shr_u (local.get $c) (i32.const 7)) (i32.const 0x1FE)))
        (i32.and (i32.shr_u (local.get $c) (i32.const 16)) (i32.const 0xFF))) (i32.const 3)) (i32.const 0x010101)) (i32.const 0xFF000000))
      (i32.sub (local.get $c) (i32.and (i32.shr_u (local.get $c) (i32.const 2)) (i32.const 0x3F3F3F)))
      (local.get $grey)))
    (i32.store (local.get $p) (local.get $c))
    (local.set $p (i32.add (local.get $p) (i32.const 4)))
    (br $l))))

(func $draw_ovl
  (local $w i32) (local $h i32) (local $bw i32) (local $bh i32) (local $mh i32)
  (local.set $w (global.get $fb_w)) (local.set $h (global.get $fb_h))
  ;; (the replay viewer: the farm undimmed above a card at the bottom)
  (if (i32.ne (global.get $scr) (i32.const 7)) (then (call $dim (i32.eq (global.get $scr) (i32.const 5)))))
  (drop (call $hit_add (i32.const 0) (i32.const 0) (local.get $w) (local.get $h) (global.get $HIT_PANEL)))
  (if (i32.eq (global.get $scr) (i32.const 1)) (then (call $title) (return)))
  (local.set $bw (call $imin (i32.sub (local.get $w) (i32.shl (global.get $lgap) (i32.const 1))) (call $S (i32.const 440))))
  (local.set $mh (i32.sub (local.get $h) (i32.shl (global.get $lgap) (i32.const 2))))
  (local.set $bh (call $imin (local.get $mh) (global.get $box_need)))
  (global.set $rp_top (i32.sub (local.get $h) (i32.add (local.get $bh) (i32.add (i32.shl (global.get $lgap) (i32.const 1)) (i32.const 3)))))
  (call $draw_box (i32.shr_s (i32.sub (local.get $w) (local.get $bw)) (i32.const 1))
    (select (global.get $rp_top) (i32.shr_s (i32.sub (local.get $h) (local.get $bh)) (i32.const 1)) (i32.eq (global.get $scr) (i32.const 7)))
    (local.get $bw) (local.get $bh))
  ;; the content height is known now: draw once more when the card should be another size
  (if (i32.and (i32.ne (call $imin (local.get $mh) (global.get $box_need)) (local.get $bh)) (i32.eqz (global.get $nest))) (then
    (global.set $nest (i32.const 1)) (call $render) (global.set $nest (i32.const 0)) (return)))
  (call $confetti))

;; Results confetti: stateless (position = f(index, time since the screen opened), render noise
;; only), one 6 s fall, none under reduced motion.
(func $confetti
  (local $i i32) (local $t i32) (local $n i32)
  (local.set $t (call $since (global.get $scr_t)))
  (if (i32.or (i32.or (i32.ne (global.get $scr) (i32.const 4)) (global.get $flag_reduced))
              (i32.ge_u (local.get $t) (i32.const 6000))) (then (return)))
  (loop $l
    (local.set $n (call $noise (local.get $i) (i32.const 77)))
    (call $rect
      (i32.add (i32.rem_u (i32.shr_u (local.get $n) (i32.const 16)) (global.get $fb_w))
               (i32.shr_s (call $sin (i32.add (i32.shr_u (local.get $t) (i32.const 7)) (local.get $i))) (i32.const 4)))
      (i32.sub (i32.shr_u (i32.mul (local.get $t) (i32.add (i32.const 8) (i32.and (local.get $n) (i32.const 15)))) (i32.const 6))
               (i32.add (i32.rem_u (i32.shr_u (local.get $n) (i32.const 4)) (global.get $fb_h)) (i32.const 8)))
      (i32.add (i32.const 3) (i32.and (local.get $i) (i32.const 1))) (i32.sub (i32.const 4) (i32.and (local.get $i) (i32.const 1)))
      (call $pi (i32.add (i32.const 0x966) (i32.rem_u (local.get $i) (i32.const 6)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 90)))))

;; Card header: icon, title, subtitle in SB1 (logged for the announcement).
(func $ovl_head
  (local $s i32)
  (local.set $s (global.get $scr))
  (global.set $oh_icon (i32.load8_u (i32.add (i32.const 0x955) (local.get $s))))
  (global.set $oh_title (call $str (i32.add (global.get $STR_SCR) (i32.sub (local.get $s) (i32.const 1)))))
  (call $sb (global.get $SB1))
  ;; (Results / Game Over: the days played, one less than the day counter)
  (call $si (global.get $STR_DAY)) (call $sn0 (i32.sub (i32.load16_u (global.get $S_DAY)) (i32.and (i32.load8_u (global.get $S_STATUS)) (i32.const 1))))
  (if (i32.eq (local.get $s) (i32.const 2)) (then
    ;; DAY 12, SPRING, YEAR 1
    (global.set $oh_icon (i32.add (global.get $I_SUN) (call $wx (i32.const 0))))
    (call $sep) (call $si (i32.add (global.get $STR_SEA) (call $season))) (call $si (global.get $STR_YEAR))
    (call $sn0 (i32.add (i32.div_u (i32.sub (i32.load16_u (global.get $S_DAY)) (i32.const 1))
      (i32.shl (call $k (global.get $K_DAYS_PER_SEASON)) (i32.const 2))) (i32.const 1)))))
  (if (i32.lt_u (i32.sub (local.get $s) (i32.const 3)) (i32.const 3)) (then
    ;; DAY 57 OF 240 (Journal: ", PLAYING")
    (call $si (global.get $STR_OF)) (call $sn0 (call $k (global.get $K_RUN_DAYS)))
    (if (i32.eq (local.get $s) (i32.const 3)) (then (call $sep) (call $ss (call $st_name))))
    (if (i32.eq (local.get $s) (i32.const 4)) (then (global.set $oh_title (call $res_title))))))
  (if (i32.eq (local.get $s) (i32.const 6)) (then
    (call $sb (global.get $SB1)) (call $si (global.get $STR_PAGE)) (call $sn0 (i32.add (global.get $page) (i32.const 1)))
    (call $si (global.get $STR_OF)) (call $sc (i32.const 51))))
  (if (i32.eq (local.get $s) (i32.const 7)) (then
    ;; REPLAY / DAY 12 OF 240 (days played at the viewer's position)
    (global.set $oh_icon (global.get $I_CLOCK))
    (call $sb (global.get $SB1)) (call $si (global.get $STR_DAY)) (call $sn0 (global.get $rp_day))
    (call $si (global.get $STR_OF)) (call $sn0 (global.get $rp_N))))
  (call $lab_log (global.get $SB1)))

;; Results / Game Over have the large card header.
(func $big_head (result i32) (i32.lt_u (i32.sub (global.get $scr) (i32.const 4)) (i32.const 2)))
(func $res_title (result i32)
  (call $str (select (i32.add (global.get $STR_SCR) (i32.const 3)) (global.get $STR_YEAR3)
    (i32.and (i32.load8_u (global.get $S_MILESTONES)) (i32.const 64)))))
(func $st_name (result i32)
  (local $s i32)
  (local.set $s (i32.load8_u (global.get $S_STATUS)))
  (if (result i32) (i32.and (local.get $s) (i32.const 1))
    (then (select (call $str (i32.add (global.get $STR_SCR) (i32.const 4))) (call $res_title) (i32.eq (local.get $s) (i32.const 3))))
    (else (call $str (i32.add (global.get $STR_ST) (i32.shr_u (local.get $s) (i32.const 1)))))))

(func $ovl_body
  (local $j i32)
  (if (i32.eq (global.get $scr) (i32.const 2)) (then (call $gazette) (return)))
  (if (i32.eq (global.get $scr) (i32.const 3)) (then (call $journal) (return)))
  (if (i32.eq (global.get $scr) (i32.const 7)) (then (call $rp_body) (return)))
  (if (i32.eq (global.get $scr) (i32.const 6)) (then
    ;; the page's lit 3D model, then its two lines
    (local.set $j (i32.shl (call $btnh) (i32.const 1)))
    (call $ui_icon (i32.load8_u (i32.add (i32.const 0x963) (global.get $page))) (i32.add (global.get $ux) (i32.shr_s (i32.sub (global.get $uw) (local.get $j)) (i32.const 1)))
      (global.get $uy) (local.get $j))
    (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $j) (global.get $lgap))))
    (local.set $j (i32.const 0))
    (loop $l
      (call $ui_label (i32.const -1) (call $str (i32.add (i32.add (global.get $STR_HOW) (i32.shl (global.get $page) (i32.const 1))) (local.get $j))) (i32.const 61))
      (br_if $l (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (i32.const 2))))
    (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
    (call $put (i32.const 0x3CB) (call $str (global.get $STR_BACK)) (global.get $I_ARROW_L) (i32.const 0) (i32.const 1) (i32.const 2) (call $btnh))
    (call $put (i32.const 0x3CC) (call $str (select (global.get $STR_ERR) (global.get $STR_NEXT) (i32.eq (global.get $page) (i32.const 2))))
      (global.get $I_ARROW_R) (i32.const 2) (i32.const 1) (i32.const 2) (call $btnh))
    ;; restart the guided first days (22d_onboard.wat)
    (call $put (i32.const 0x3DE) (call $str (i32.add (global.get $STR_TUT) (i32.const 13))) (global.get $I_SPROUT) (i32.const 0) (i32.const 1) (i32.const 1) (call $btnh))
    (return)))
  (call $results))

;; " X 100 = 1,200" style factor line tail into the current builder.
(func $s_times (param $n i32) (param $f i32)
  (call $sn0 (local.get $n)) (call $sp) (call $si (global.get $STR_X)) (call $sp) (call $sn0 (local.get $f))
  (call $sp) (call $sc (i32.const 61)) (call $sp) (call $sn (i32.mul (local.get $n) (local.get $f)) (i32.const 2)))
;; "1 PLOTS" -> "1 PLOT": drop the builder's last char when n = 1.
(func $unplural (param $n i32)
  (if (i32.eq (local.get $n) (i32.const 1)) (then
    (global.set $sbp (i32.sub (global.get $sbp) (i32.const 1)))
    (i32.store8 (global.get $sbp) (i32.const 0)))))

;; Morning sheet: yesterday's End Day summary, today / forecast, the two hint goods with tomorrow's
;; drift, market news, then read-only alerts (rot tomorrow, contracts due, loan, upkeep, storage).
(func $gazette
  (local $i i32) (local $g i32) (local $d i32) (local $n i32) (local $p i32)
  (if (i32.load8_u (global.get $SUMMARY)) (then (call $ui_label (global.get $I_MOON) (global.get $SUMMARY) (i32.const 61))))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_TODAY)) (call $si (i32.add (global.get $STR_WX) (call $wx (i32.const 0))))
  (call $lab (i32.add (global.get $I_SUN) (call $wx (i32.const 0))) (i32.const 61))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_FORECAST)) (call $si (i32.add (global.get $STR_WX) (call $wx (i32.const 2))))
  (call $sep) (call $sn0 (call $k (global.get $K_FORECAST_PCT))) (call $si (global.get $STR_SURE))
  (call $lab (i32.add (global.get $I_SUN) (call $wx (i32.const 2))) (i32.const 61))
  (call $rule)
  (loop $h
    (local.set $g (i32.load8_u (i32.add (global.get $S_HINT) (local.get $i))))
    (local.set $d (i32.load16_s (i32.add (global.get $S_DRIFT_NEXT) (i32.shl (local.get $g) (i32.const 1)))))
    ;; (the same good twice: one line)
    (if (i32.or (i32.eqz (local.get $i)) (i32.ne (local.get $g) (i32.load8_u (global.get $S_HINT)))) (then
      (call $sb (global.get $SB1)) (call $sg (local.get $g))
      (if (local.get $d)
        (then (call $sp) (call $sc (select (i32.const 2) (i32.const 3) (i32.gt_s (local.get $d) (i32.const 0)))))
        (else (call $si (global.get $STR_STEADY))))
      (call $si (global.get $STR_TOMORROW))
      (call $lab (global.get $I_STALL) (i32.const 61))))
    (br_if $h (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 2))))
  (call $news)
  (call $rule)
  ;; alerts (red text, warning / clock / coin / crate icons)
  (if (local.tee $n (call $rot_plots)) (then
    (call $sb (global.get $SB1)) (call $sn0 (local.get $n)) (call $si (global.get $STR_PLOTS)) (call $unplural (local.get $n))
    (call $si (global.get $STR_ROT)) (call $lab (global.get $I_WARN) (i32.const 37))))
  (if (local.tee $n (call $spoil_est)) (then
    (call $sb (global.get $SB1)) (call $sn0 (local.get $n)) (call $si (global.get $STR_UNITS)) (call $unplural (local.get $n))
    (call $si (global.get $STR_ROT)) (call $lab (global.get $I_WARN) (i32.const 37))))
  (local.set $i (i32.const 0))
  (loop $c
    (local.set $p (i32.add (global.get $S_ACCEPTED) (i32.shl (local.get $i) (i32.const 3))))
    (local.set $d (i32.sub (i32.load16_u offset=4 (local.get $p)) (i32.load16_u (global.get $S_DAY))))
    (if (i32.and (i32.ne (i32.load8_u offset=3 (local.get $p)) (i32.const 0)) (i32.le_u (local.get $d) (i32.const 2))) (then
      (call $sb (global.get $SB1)) (call $sg (i32.load8_u (local.get $p))) (call $sp) (call $si (global.get $STR_DUE)) (call $s_days (local.get $d))
      (call $lab (global.get $I_CLOCK) (i32.const 37))))
    (br_if $c (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (if (local.tee $n (call $loan_owed)) (then
    (call $sb (global.get $SB1)) (call $s_owed (local.get $n)) (call $si (global.get $STR_PER_DAY)) (call $lab (global.get $I_COIN) (i32.const 61))))
  (local.set $i (i32.const 0)) (local.set $n (i32.const 0))
  (loop $u
    (local.set $p (call $tile_ptr (local.get $i)))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
      (then (local.set $n (i32.add (local.get $n) (call $bal (global.get $T_BLD) (i32.load8_u offset=1 (local.get $p)) (i32.const 1))))))
    (br_if $u (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (if (local.get $n) (then
    (call $sb (global.get $SB1)) (call $si (global.get $STR_UPKEEP)) (call $sn (local.get $n) (i32.const 1)) (call $si (global.get $STR_PER_DAY))
    (call $lab (global.get $I_COIN) (i32.const 61))))
  (if (i32.ge_u (i32.mul (call $storage_used) (i32.const 10)) (i32.mul (call $storage_cap) (i32.const 9))) (then
    (call $sb (global.get $SB1)) (call $si (global.get $STR_STORAGE)) (call $sn0 (call $storage_used)) (call $sc (i32.const 47)) (call $sn0 (call $storage_cap))
    (call $sep) (call $si (global.get $STR_NEARLY)) (call $lab (global.get $I_CRATE) (i32.const 37))))
  (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
  (call $put (i32.const 0x3C7) (call $str (global.get $STR_START_DAY)) (global.get $I_SUN) (i32.const 2) (i32.const 1) (call $pcols) (call $btnh))
  (call $toggle (i32.const 0x3C5) (global.get $STR_DONT_SHOW) (global.get $flag_gazoff) (call $pcols) (call $btnh)))

;; A thin divider line at the cursor.
(func $rule
  (call $hline (global.get $ux) (global.get $uy) (global.get $uw) (call $pal (i32.const 57)))
  (global.set $uy (i32.add (global.get $uy) (i32.add (global.get $lgap) (i32.const 2)))))
;; On / off toggle: dark ink face (style 6) + check icon when on, paper + cross when off (never colour alone).
;; " ON" / " OFF" after a toggle's label (LARGE TEXT; AUTO GAZETTE on the Title, DON'T SHOW on the
;; Gazette), and the announcement of a tapped toggle.
(func $s_tog (param $c i32)
  (call $sp)
  (call $si (select (global.get $STR_ON) (global.get $STR_OFF)
    (select (global.get $flag_large) (i32.xor (global.get $flag_gazoff) (i32.eq (global.get $scr) (i32.const 1)))
      (i32.eq (local.get $c) (i32.const 0x3C4))))))
(func $say_tog (param $c i32)
  (call $sb (global.get $SB3))
  (call $si (select (global.get $STR_LARGE) (select (global.get $STR_AUTO_GAZ) (global.get $STR_DONT_SHOW) (i32.eq (global.get $scr) (i32.const 1)))
    (i32.eq (local.get $c) (i32.const 0x3C4))))
  (call $s_tog (local.get $c))
  (call $announce (global.get $SB3)))
(func $toggle (param $c i32) (param $s i32) (param $on i32) (param $cols i32) (param $h i32)
  (call $put (local.get $c) (call $str (local.get $s)) (select (global.get $I_CHECK) (global.get $I_CLOSE) (local.get $on))
    (select (i32.const 6) (i32.const 0) (local.get $on)) (i32.const 1) (local.get $cols) (local.get $h)))

;; Ripe plots whose crop rots tonight (End Day step 2 ages ripe crops by 1, a Heatwave more outside
;; a Greenhouse; step 5 removes those at spoilDays).
(func $rot_plots (result i32)
  (local $i i32) (local $p i32) (local $c i32) (local $sd i32) (local $n i32)
  (loop $l
    (if (call $in_grid (local.get $i)) (then
      (local.set $p (call $tile_ptr (local.get $i)))
      (local.set $c (call $tile_crop (local.get $p)))
      (if (i32.ge_s (local.get $c) (i32.const 0)) (then
        (local.set $sd (call $bal (global.get $T_CROP) (local.get $c) (i32.const 4)))
        (if (i32.and (i32.and (call $tile_ripe (local.get $p)) (i32.ne (local.get $sd) (i32.const 0)))
              (i32.ge_u (i32.add (i32.load8_u offset=4 (local.get $p))
                (select (i32.const 1) (call $age_step) (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)))) (local.get $sd)))
          (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (local.get $n))

;; Journal: net worth, reputation + points to the next star, score preview, then the milestone
;; checklist (T_MILE payouts, T_K targets) and the way back to Results / Game Over.
(func $journal
  (local $i i32) (local $r i32) (local $v i32) (local $m i32) (local $f i32)
  (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_MP) (i32.const 1))) (call $sn (call $net_worth) (i32.const 1))
  (call $lab (global.get $I_COIN) (i32.const 61))
  (local.set $r (call $rank))
  (call $sb (global.get $SB1)) (call $sc (i32.const 1)) (call $sn0 (local.get $r))
  (if (i32.lt_u (local.get $r) (i32.const 5)) (then
    (call $sep) (call $sn0 (i32.sub (call $bal (global.get $T_REP) (local.get $r) (i32.const 0)) (i32.load8_u (global.get $S_REP))))
    (call $si (global.get $STR_PTS)) (call $si (global.get $STR_TO)) (call $sc (i32.const 1)) (call $sn0 (i32.add (local.get $r) (i32.const 1)))))
  (call $lab (global.get $I_STAR) (i32.const 61))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_SCORE)) (call $sn (call $score) (i32.const 2))
  (call $lab (global.get $I_UP) (i32.const 61))
  (local.set $m (i32.load8_u (global.get $S_MILESTONES)))
  (loop $l
    (call $sb (global.get $SB1))
    (local.set $f (i32.and (i32.shr_u (local.get $m) (local.get $i)) (i32.const 1)))
    (block $p
      (if (local.get $f) (then (call $si (global.get $STR_ERR)) (br $p)))
      ;; year 1 is settled by the End Day into day 81; the run target only while playing
      (if (i32.and (i32.eq (local.get $i) (i32.const 3))
            (i32.ge_u (i32.load16_u (global.get $S_DAY)) (i32.add (i32.shl (call $k (global.get $K_DAYS_PER_SEASON)) (i32.const 2)) (i32.const 1))))
        (then (call $si (i32.add (global.get $STR_ERR) (i32.const 17))) (br $p)))
      (if (i32.and (i32.eq (local.get $i) (i32.const 6)) (i32.ne (i32.load8_u (global.get $S_STATUS)) (i32.const 0)))
        (then (call $si (i32.add (global.get $STR_ERR) (global.get $E_STATUS))) (br $p)))
      ;; "WINE 4 / 10", "NET WORTH $1,430 / $2,000 BY DAY 81", "REP *2 / *3"
      (call $si (i32.add (global.get $STR_MP) (i32.load8_u (i32.add (i32.const 0x96C) (local.get $i)))))
      (local.set $v (call $net_worth))
      (if (i32.eqz (local.get $i)) (then (local.set $v (i32.load16_u (global.get $S_PROC_SOLD)))))
      (if (i32.eq (local.get $i) (i32.const 2)) (then (local.set $v (i32.load16_u (global.get $S_CONTRACTS_DONE)))))
      (if (i32.eq (local.get $i) (i32.const 4)) (then (local.set $v (local.get $r))))
      (if (i32.eq (local.get $i) (i32.const 5)) (then (local.set $v (i32.load16_u (global.get $S_WINE_SOLD)))))
      (call $sn (local.get $v) (i32.and (i32.shr_u (i32.const 0x4A) (local.get $i)) (i32.const 1)))
      (call $sp) (call $sc (i32.const 47)) (call $sp)
      (if (i32.eq (local.get $i) (i32.const 4)) (then (call $sc (i32.const 1))))
      (call $sn (select (call $k (i32.add (global.get $K_MILE_WORTH1) (i32.sub (local.get $i) (i32.const 1)))) (i32.const 1) (local.get $i))
        (i32.and (i32.shr_u (i32.const 0x4A) (local.get $i)) (i32.const 1)))
      (if (i32.and (i32.const 0x48) (i32.shl (i32.const 1) (local.get $i))) (then
        (call $si (global.get $STR_BY_DAY))
        (call $sn0 (select (i32.add (i32.shl (call $k (global.get $K_DAYS_PER_SEASON)) (i32.const 2)) (i32.const 1)) (call $k (global.get $K_RUN_DAYS))
          (i32.eq (local.get $i) (i32.const 3)))))))
    ;; reward "+$200" (the run target pays nothing: no text)
    (local.set $v (call $bal (global.get $T_MILE) (local.get $i) (i32.const 0)))
    (call $sb (global.get $SB2)) (call $sc (i32.const 43)) (call $sn (local.get $v) (i32.const 1))
    (global.set $b_row (i32.const 1)) (global.set $b_sub (global.get $SB1)) (global.set $b_right (select (global.get $SB2) (i32.const 0) (local.get $v)))
    (call $put (i32.const 0x2FF) (call $str (i32.add (global.get $STR_MNAME) (local.get $i))) (select (global.get $I_STAR) (global.get $I_LOCK) (local.get $f))
      (select (i32.const 2) (i32.const 0) (local.get $f)) (i32.const 1) (call $lget (global.get $L_COLS)) (call $rowh))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 7))))
  (call $flush (call $rowh))
  (if (i32.and (i32.load8_u (global.get $S_STATUS)) (i32.const 1)) (then
    (call $put (i32.const 0x3CD) (call $st_name) (global.get $I_STAR) (i32.const 1) (i32.const 1) (i32.const 1) (call $btnh)))))

;; Results / Game Over: cause (Game Over), the score breakdown (TOTAL = score()), days and wine,
;; the shareable text summary, then the buttons.
(func $results
  (local $go i32) (local $n i32)
  (local.set $go (i32.eq (global.get $scr) (i32.const 5)))
  (if (local.get $go) (then (call $ui_label (global.get $I_WARN) (call $str (global.get $STR_CAUSE)) (i32.const 37))))
  (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_MP) (i32.const 1))) (call $sn (call $net_worth) (i32.const 1))
  (call $lab (global.get $I_COIN) (i32.const 61))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_REPUTATION)) (call $s_times (i32.load8_u (global.get $S_REP)) (call $k (global.get $K_REP_SCORE)))
  (call $lab (global.get $I_STAR) (i32.const 61))
  (local.set $n (i32.load16_u (global.get $S_CONTRACTS_DONE)))
  (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_MSUB) (i32.const 2))) (call $sp) (call $s_times (local.get $n) (call $k (global.get $K_CONTRACT_SCORE)))
  (call $lab (global.get $I_TRUCK) (i32.const 61))
  (call $sb (global.get $SB1)) (call $si (global.get $STR_MP)) (call $sn0 (i32.load16_u (global.get $S_WINE_SOLD))) (call $sp) (call $sg (i32.const 12))
  (call $lab (global.get $I_STALL) (i32.const 61))
  ;; the total, large and centred in wheat gold over an ink shadow: SCORE 21,340 (= score())
  (call $sb (global.get $SB1)) (call $si (global.get $STR_SCORE)) (call $sn (call $score) (i32.const 2))
  (call $lab_log (global.get $SB1))
  (global.set $tscale (i32.shl (call $ui_ts) (i32.const 1)))
  (call $center (global.get $SB1) (i32.add (global.get $uy) (global.get $lgap)) (i32.const 17))
  (global.set $uy (i32.add (global.get $uy) (i32.add (i32.mul (call $ui_ts) (i32.const 14)) (i32.mul (global.get $lgap) (i32.const 3)))))
  ;; shareable summary on a tinted slip: "HARVESTCHAIN DAY 240 . SCORE 21,340 . *4 . 22 CONTRACTS"
  (global.set $sblim (i32.const 120))
  (call $sb (global.get $ANNBUF)) (call $si (global.get $STR_SCR)) (call $sp) (call $si (global.get $STR_DAY))
  (call $sn0 (i32.sub (i32.load16_u (global.get $S_DAY)) (i32.const 1))) (call $si (global.get $STR_DOTS))
  (call $si (global.get $STR_SCORE)) (call $sn (call $score) (i32.const 2)) (call $si (global.get $STR_DOTS))
  (call $sc (i32.const 1)) (call $sn0 (call $rank)) (call $si (global.get $STR_DOTS))
  (call $sn0 (local.get $n)) (call $sp) (call $si (i32.add (global.get $STR_MSUB) (i32.const 2))) (call $unplural (local.get $n))
  (global.set $sblim (i32.const 55))
  (global.set $tscale (call $ui_ts))
  (global.set $nodraw (i32.const 1))
  (local.set $n (call $ui_wrap (i32.const 0) (i32.const 0) (i32.sub (global.get $uw) (i32.shl (global.get $lgap) (i32.const 2))) (global.get $ANNBUF) (i32.const 0)))
  (global.set $nodraw (i32.const 0))
  (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
  (call $rrect (global.get $ux) (global.get $uy) (global.get $uw) (i32.add (local.get $n) (i32.shl (global.get $lgap) (i32.const 1))) (i32.const 2) (call $pal (i32.const 57)))
  (global.set $ux (i32.add (global.get $ux) (i32.shl (global.get $lgap) (i32.const 1))))
  (global.set $uw (i32.sub (global.get $uw) (i32.shl (global.get $lgap) (i32.const 2))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (global.get $lgap) (i32.const 1))))
  (call $ui_label (i32.const -1) (global.get $ANNBUF) (i32.const 60))
  (global.set $ux (i32.sub (global.get $ux) (i32.shl (global.get $lgap) (i32.const 1))))
  (global.set $uw (i32.add (global.get $uw) (i32.shl (global.get $lgap) (i32.const 2))))
  (global.set $uy (i32.add (global.get $uy) (i32.shl (global.get $lgap) (i32.const 1))))
  (call $share_ui)
  (if (local.get $go)
    (then (call $put (i32.const 0x3CA) (call $str (global.get $STR_TRY)) (global.get $I_ARROW_R) (i32.const 1) (i32.const 1) (call $pcols) (call $btnh)))
    (else
      (call $sb (global.get $SB2)) (call $si (global.get $STR_CONTINUE)) (call $si (global.get $STR_IN)) (call $si (i32.add (global.get $STR_ST) (i32.const 1)))
      (call $put (i32.const 0x3C9) (global.get $SB2) (global.get $I_ARROW_R) (i32.const 2) (i32.const 1) (i32.const 1) (call $btnh))
      (call $put_two (i32.const 0x3C1) (call $str (global.get $STR_NEW_GAME)) (call $str (global.get $STR_REPLACES)) (global.get $I_PLUS) (call $pcols) (call $btnh))))
  (call $put (i32.const 0x3C6) (call $str (i32.add (global.get $STR_SCR) (i32.const 2))) (global.get $I_BOOK) (i32.const 0) (i32.const 1) (call $pcols) (call $btnh))
  ;; footer: the measured load line (spec §15.1), as on the Title
  (call $flush (call $btnh))
  (call $s_load)
  (call $lab (global.get $I_CLOCK) (i32.const 61)))

;; Title: the lit farm under a warm dim, extruded HARVESTCHAIN lettering, tagline, the button stack,
;; the zero-asset footer and the load line (Task 7 metrics; "--" until measured).
;; Top of the Title's button stack (c pair-row columns) above the 26 px footer; the farm fits above.
;; Rows: CONTINUE (with a save), NEW GAME, DAILY SEED, then HOW TO PLAY | JOURNAL and the two
;; toggles: 2 rows side by side, or 4 rows one per line.
(func $stack_top (param $c i32) (result i32)
  (i32.sub (i32.sub (global.get $fb_h) (i32.add (i32.mul (i32.sub (i32.add (i32.add (global.get $has_save) (global.get $rp_pend)) (i32.const 8)) (i32.shl (local.get $c) (i32.const 1)))
    (i32.add (call $btnh) (global.get $lgap))) (i32.const 26)))
    (i32.shl (global.get $lgap) (i32.const 1))))
;; Pair-row columns: one per line only in large text when the large labels would not fit side by
;; side (so they keep the large scale) and the taller stack still leaves the top quarter for the
;; sign; else two (labels shrink to fit).
(func $tcols (result i32)
  (i32.sub (i32.const 2) (i32.and (i32.and (global.get $flag_large) (i32.eq (call $pcols) (i32.const 1)))
    (i32.ge_s (call $stack_top (i32.const 1)) (i32.shr_s (global.get $fb_h) (i32.const 2))))))
;; The stack's top; also sets its column ($ux, $uw).
(func $title_top (result i32)
  (global.set $uw (call $imin (i32.sub (global.get $fb_w) (i32.shl (global.get $lgap) (i32.const 3))) (call $S (i32.const 400))))
  (global.set $ux (i32.shr_s (i32.sub (global.get $fb_w) (global.get $uw)) (i32.const 1)))
  (call $stack_top (call $tcols)))

(func $title
  (local $w i32) (local $g i32) (local $k i32) (local $x i32) (local $y i32) (local $d i32) (local $s i32) (local $bh i32) (local $p i32) (local $sw i32)
  (local.set $w (global.get $fb_w)) (local.set $g (global.get $lgap))
  (local.set $s (call $str (global.get $STR_SCR)))
  ;; lettering scale: 12 glyphs (72 px a scale) across min(width, 720 css), at most 1/9 of the height
  (local.set $k (call $clamp (call $imin (i32.div_s (call $imin (i32.sub (local.get $w) (i32.shl (local.get $g) (i32.const 3))) (call $S (i32.const 720))) (i32.const 72))
    (i32.div_s (global.get $fb_h) (i32.const 63))) (i32.const 1) (i32.const 8)))
  (global.set $tscale (local.get $k))
  (local.set $sw (call $tw (local.get $s)))
  (local.set $x (i32.shr_s (i32.sub (local.get $w) (local.get $sw)) (i32.const 1)))
  (local.set $p (i32.add (local.get $k) (i32.shl (local.get $g) (i32.const 1))))
  (local.set $y (i32.add (local.get $p) (i32.add (i32.shl (local.get $g) (i32.const 1)) (i32.div_s (global.get $fb_h) (i32.const 16)))))
  (local.set $d (i32.add (i32.shr_u (local.get $k) (i32.const 1)) (i32.const 1)))
  ;; a wooden farm sign behind the lettering and the tagline
  (local.set $x (i32.sub (local.get $x) (local.get $p)))
  (local.set $sw (i32.add (local.get $sw) (i32.shl (local.get $p) (i32.const 1))))
  (local.set $bh (i32.add (i32.add (i32.mul (local.get $k) (i32.const 7)) (local.get $d)) (i32.add (i32.mul (call $ui_ts) (i32.const 7)) (i32.add (i32.shl (local.get $p) (i32.const 1)) (i32.shl (local.get $g) (i32.const 1))))))
  (call $rrect (i32.add (local.get $x) (i32.const 2)) (i32.add (i32.sub (local.get $y) (local.get $p)) (i32.const 3)) (local.get $sw) (local.get $bh) (i32.const 3) (call $pal (i32.const 60)))
  (call $panel_c (local.get $x) (i32.sub (local.get $y) (local.get $p)) (local.get $sw) (local.get $bh) (i32.const 0x2A2928))
  (local.set $x (i32.add (local.get $x) (local.get $p)))
  ;; depth: layers stepping down-right (the sun is upper-left; the deepest one ink), then the face
  (loop $l
    (drop (call $txt (i32.add (local.get $x) (local.get $d)) (i32.add (local.get $y) (local.get $d)) (local.get $s)
      (call $pal (select (i32.const 60) (i32.const 36) (i32.eq (local.get $d) (i32.add (i32.shr_u (local.get $k) (i32.const 1)) (i32.const 1)))))))
    (br_if $l (local.tee $d (i32.sub (local.get $d) (i32.const 1)))))
  (drop (call $txt (local.get $x) (local.get $y) (local.get $s) (call $pal (i32.const 59))))
  ;; "HARVEST" in wheat gold over the cream "CHAIN"
  (call $sb (global.get $SB2)) (call $ss (local.get $s)) (i32.store8 offset=7 (global.get $SB2) (i32.const 0))
  (drop (call $txt (local.get $x) (local.get $y) (global.get $SB2) (call $pal (i32.const 19))))
  (global.set $tscale (call $ui_ts))
  (call $center (call $str (global.get $STR_TAGLINE)) (i32.add (local.get $y) (i32.add (i32.mul (local.get $k) (i32.const 8)) (i32.add (local.get $g) (i32.shl (local.get $g) (i32.const 1))))) (i32.const 59))
  ;; buttons, stacked up from the footer
  (local.set $bh (call $btnh))
  (global.set $ucol (i32.const 0))
  (global.set $uy (call $title_top))
  ;; a shared run from the link / a paste waits (24_replay.wat)
  (if (global.get $rp_pend) (then
    (call $sb (global.get $SB2)) (call $si (global.get $STR_WATCH)) (call $si (global.get $STR_SHARED))
    (call $put (i32.const 0x3D8) (global.get $SB2) (global.get $I_CLOCK) (i32.const 2) (i32.const 1) (i32.const 1) (local.get $bh))))
  (if (global.get $has_save)
    (then
      (call $put (i32.const 0x3C0) (call $str (global.get $STR_CONTINUE)) (global.get $I_ARROW_R) (i32.const 1) (i32.const 1) (i32.const 1) (local.get $bh))
      (call $put_two (i32.const 0x3C1) (call $str (global.get $STR_NEW_GAME)) (call $str (global.get $STR_REPLACES)) (global.get $I_PLUS) (i32.const 1) (local.get $bh)))
    (else (call $put (i32.const 0x3C1) (call $str (global.get $STR_NEW_GAME)) (global.get $I_PLUS) (i32.const 1) (i32.const 1) (i32.const 1) (local.get $bh))))
  (call $sb (global.get $SB2)) (call $si (global.get $STR_DAILY)) (call $sn0 (call $lget (global.get $L_DSEED)))
  (call $put_two (i32.const 0x3C2) (global.get $SB2) (call $str (global.get $STR_REPLACES)) (global.get $I_SUN) (i32.const 1) (local.get $bh))
  ;; the pair rows: one per line in large text on a narrow screen; side by side otherwise, then
  ;; at one shared scale (1 when the large labels would not fit side by side: never mixed)
  (local.set $p (call $tcols))
  (local.set $d (global.get $flag_large))
  (if (i32.and (i32.eq (local.get $p) (i32.const 2)) (i32.eq (call $pcols) (i32.const 1))) (then (global.set $flag_large (i32.const 0))))
  (call $put (i32.const 0x3C3) (call $str (i32.add (global.get $STR_SCR) (i32.const 5))) (global.get $I_SPROUT) (i32.const 0) (i32.const 1) (local.get $p) (local.get $bh))
  (call $put (i32.const 0x3C6) (call $str (i32.add (global.get $STR_SCR) (i32.const 2))) (global.get $I_BOOK) (i32.const 0) (i32.const 1) (local.get $p) (local.get $bh))
  (call $toggle (i32.const 0x3C4) (global.get $STR_LARGE) (local.get $d) (local.get $p) (local.get $bh))
  (call $toggle (i32.const 0x3C5) (global.get $STR_AUTO_GAZ) (i32.eqz (global.get $flag_gazoff)) (local.get $p) (local.get $bh))
  (global.set $flag_large (local.get $d))
  ;; footer: zero asset files, load time and transfer size
  (global.set $tscale (i32.const 1))
  (local.set $y (i32.sub (global.get $fb_h) (i32.add (local.get $g) (i32.const 20))))
  (call $center (call $str (global.get $STR_FILES)) (local.get $y) (i32.const 58))
  (call $s_load)
  (call $center (global.get $SB1) (i32.add (local.get $y) (i32.const 11)) (i32.const 58))
  (global.set $tscale (call $ui_ts)))

;; Text centred across the framebuffer at the current scale (falls back to scale 1 when too wide),
;; with an ink drop shadow.
(func $center (param $s i32) (param $y i32) (param $c i32)
  (local $x i32)
  (if (i32.gt_s (call $tw (local.get $s)) (i32.sub (global.get $fb_w) (i32.shl (global.get $lgap) (i32.const 1)))) (then (global.set $tscale (i32.const 1))))
  (local.set $x (i32.shr_s (i32.sub (global.get $fb_w) (call $tw (local.get $s))) (i32.const 1)))
  (drop (call $txt (i32.add (local.get $x) (global.get $tscale)) (i32.add (local.get $y) (global.get $tscale)) (local.get $s) (call $pal (i32.const 60))))
  (drop (call $txt (local.get $x) (local.get $y) (local.get $s) (call $pal (local.get $c)))))

;; Announcement for a screen just drawn (see the header): built in ANNBUF, at most 480 chars.
(func $ovl_say
  (local $p i32) (local $i i32) (local $n i32) (local $c i32)
  (global.set $sblim (i32.const 480))
  (call $sb (global.get $ANNBUF))
  (call $say_s (select (global.get $oh_title) (call $str (global.get $STR_SCR)) (i32.ne (global.get $scr) (i32.const 1))))
  (local.set $n (call $strlen (global.get $ANNBUF)))
  ;; the Journal's summary first: "2 OF 7 DONE"
  (if (i32.eq (global.get $scr) (i32.const 3)) (then
    (call $sep) (call $sn0 (i32.popcnt (i32.and (i32.load8_u (global.get $S_MILESTONES)) (i32.const 0x7F))))
    (call $si (global.get $STR_OF)) (call $sc (i32.const 55)) (call $sp) (call $si (global.get $STR_ERR))))
  (local.set $p (i32.const 0xA100))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $p) (global.get $lab_p)))
    (call $sep) (call $say_s (local.get $p))
    (local.set $p (i32.add (i32.add (local.get $p) (call $strlen (local.get $p))) (i32.const 1)))
    (br $l)))
  ;; the screen's own buttons (list rows were logged with their lines above)
  (block $e (loop $b
    (br_if $e (i32.ge_u (local.get $i) (global.get $btn_n)))
    (local.set $p (i32.add (global.get $BTNS) (i32.shl (local.get $i) (i32.const 6))))
    (local.set $c (i32.load (local.get $p)))
    (if (i32.and (i32.ge_u (local.get $c) (i32.const 0x3C0)) (i32.ne (i32.load8_u offset=8 (local.get $p)) (i32.const 0))) (then
      (call $sep) (call $say_s (i32.add (local.get $p) (i32.const 8)))
      (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x3C4)) (i32.const 2)) (then (call $s_tog (local.get $c))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $b)))
  (global.set $sblim (i32.const 55))
  (i32.store8 (i32.add (global.get $ANNBUF) (local.get $n)) (i32.const 46))
  (call $announce (global.get $ANNBUF)))
;; Text into the builder as words: the star / up / down glyphs (1..3) spelled out, " ^ " -> ", ".
(func $say_s (param $p i32)
  (local $c i32)
  (block $d (loop $l
    (local.set $c (i32.load8_u (local.get $p)))
    (br_if $d (i32.eqz (local.get $c)))
    (if (i32.lt_u (local.get $c) (i32.const 4))
      (then (call $si (i32.add (global.get $STR_GLYPH) (i32.sub (local.get $c) (i32.const 1)))))
      (else (if (i32.eq (local.get $c) (i32.const 94))
        (then
          (if (i32.eq (i32.load8_u (i32.sub (global.get $sbp) (i32.const 1))) (i32.const 32))
            (then (global.set $sbp (i32.sub (global.get $sbp) (i32.const 1)))))
          (call $sc (i32.const 44)))
        (else (call $sc (local.get $c))))))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (br $l))))
