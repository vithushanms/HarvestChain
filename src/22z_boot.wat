;; Boot entry points for the loader (plan Task 6). Presentation only.
;;
;; ui_boot(has_save): the loader calls this once after set_env/set_flags/set_pref. has_save = 1 when
;; load() accepted the stored save (then the UI only resets), else a new game starts from the env
;; seed (set_env). Task 5c replaces the body with the Title screen; the name and signature stay.
;;
;; get_flags(): bit0 large_text, bit1 reduced_motion (OS preference), bit2 gazette_auto_off. The
;; loader persists changes to hc.prefs (UI toggles in later tasks flip the bits via $set_pref).
;; set_pref(bit, value): sets one bit of the flags; 0 = large, 1 = reduced, 2 = gazette auto-open off.
(global $flag_gazoff (mut i32) (i32.const 0))
(func $ui_boot (param $has_save i32)
  (if (local.get $has_save)
    (then (call $ui_loaded))
    (else (call $ui_new_game (call $lget (global.get $L_SEED))))))
(func $get_flags (result i32)
  (i32.or (i32.or (global.get $flag_large) (i32.shl (global.get $flag_reduced) (i32.const 1)))
          (i32.shl (global.get $flag_gazoff) (i32.const 2))))
(func $set_pref (param $bit i32) (param $v i32)
  (local $b i32)
  (local.set $b (i32.ne (local.get $v) (i32.const 0)))
  (if (i32.eq (local.get $bit) (i32.const 2)) (then (global.set $flag_gazoff (local.get $b)) (return)))
  (call $set_flags
    (select (local.get $b) (global.get $flag_reduced) (i32.eq (local.get $bit) (i32.const 1)))
    (select (local.get $b) (global.get $flag_large) (i32.eqz (local.get $bit)))))

;; Test hook (stripped from the shipping build): t_hit(code, k) = field k (0 x, 1 y, 2 w, 3 h; logical
;; framebuffer px) of the topmost hit region with that code, or -1. Lets the e2e specs derive tap
;; targets from the module instead of hard-coding coordinates.
(func $t_hit (param $code i32) (param $k i32) (result i32)
  (local $n i32) (local $p i32)
  (local.set $n (call $hit_n))
  (loop $l
    (if (local.get $n) (then
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (local.set $p (i32.add (i32.add (global.get $R_LAYOUT) (global.get $L_HIT)) (i32.mul (local.get $n) (i32.const 20))))
      (if (i32.eq (i32.load offset=16 (local.get $p)) (local.get $code))
        (then (return (i32.load (i32.add (local.get $p) (i32.shl (local.get $k) (i32.const 2)))))))
      (br $l))))
  (i32.const -1))
