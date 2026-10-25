;; Weather, forecast and market events (spec §6, Decisions 1, 2, 15).
;; Weather enum: Sunny 0 Rain 1 Drought 2 Storm 3 Frost 4 Heatwave 5.
;; Event kinds: None 0 Surge 1 Glut 2 RoadClosure 3 Festival 4 FuelSpike 5 Bumper 6.
;; Event slot (4 B at $S_EVENTS + 4*i): kind, market, good, daysLeft.
;; $weather_advance and $events_tick run at End Day step 10 BEFORE the day counter
;; increments, so "the new day" is day+1.

(global $EV_SURGE   i32 (i32.const 1))
(global $EV_GLUT    i32 (i32.const 2))
(global $EV_FESTIVAL i32 (i32.const 4))
(global $EV_KINDS   i32 (i32.const 6))
(global $EV_SLOTS   i32 (i32.const 3))

(func $season_at (param $day i32) (result i32)
  (i32.rem_u
    (i32.div_u (i32.sub (local.get $day) (i32.const 1)) (call $k (global.get $K_DAYS_PER_SEASON)))
    (i32.const 4)))

;; Cumulative-weight pick over the season row (weights sum to 100).
(func $weather_roll (param $season i32) (result i32)
  (local $r i32) (local $w i32) (local $acc i32)
  (local.set $r (call $rng_range (i32.const 100)))
  (loop $next
    (local.set $acc (i32.add (local.get $acc)
      (call $bal (global.get $T_WEATHER) (local.get $season) (local.get $w))))
    (if (i32.lt_u (local.get $r) (local.get $acc)) (then (return (local.get $w))))
    (br_if $next (i32.lt_u (local.tee $w (i32.add (local.get $w) (i32.const 1))) (i32.const 5))))
  (i32.const 5))

;; forecast = tomorrow 80% of the time, else a fresh roll from the same table.
(func $forecast_roll (param $season i32)
  (if (i32.lt_u (call $rng_range (i32.const 100)) (call $k (global.get $K_FORECAST_PCT)))
    (then (i32.store8 offset=2 (global.get $S_WEATHER) (i32.load8_u offset=1 (global.get $S_WEATHER))))
    (else (i32.store8 offset=2 (global.get $S_WEATHER) (call $weather_roll (local.get $season))))))

;; Roll weatherTomorrow then forecast for a given day (init order: tomorrow, then forecast).
(func $weather_prime (param $day i32)
  (local $s i32)
  (local.set $s (call $season_at (local.get $day)))
  (i32.store8 offset=1 (global.get $S_WEATHER) (call $weather_roll (local.get $s)))
  (call $forecast_roll (local.get $s)))

(func $weather_advance
  (i32.store8 (global.get $S_WEATHER) (i32.load8_u offset=1 (global.get $S_WEATHER)))
  (call $weather_prime (i32.add (i32.load16_u (global.get $S_DAY)) (i32.const 1))))

(func $event_ptr (param $i i32) (result i32)
  (i32.add (global.get $S_EVENTS) (i32.shl (local.get $i) (i32.const 2))))

;; Age active events (free at 0), then roll a new one if due and a slot is free.
(func $events_tick
  (local $i i32) (local $p i32) (local $d i32) (local $kind i32) (local $free i32) (local $day1 i32)
  (loop $age
    (local.set $p (call $event_ptr (local.get $i)))
    (if (i32.load8_u (local.get $p))
      (then
        (local.set $d (i32.sub (i32.load8_u offset=3 (local.get $p)) (i32.const 1)))
        (if (local.get $d)
          (then (i32.store8 offset=3 (local.get $p) (local.get $d)))
          (else (i32.store (local.get $p) (i32.const 0))))))
    (br_if $age (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $EV_SLOTS))))
  (local.set $day1 (i32.add (i32.load16_u (global.get $S_DAY)) (i32.const 1)))
  (if (i32.lt_u (local.get $day1) (i32.load16_u (global.get $S_NEXT_EVENT))) (then (return)))
  (local.set $i (i32.const 0))
  (local.set $free (i32.const -1))
  (loop $find
    (if (i32.and (i32.lt_s (local.get $free) (i32.const 0))
                 (i32.eqz (i32.load8_u (call $event_ptr (local.get $i)))))
      (then (local.set $free (local.get $i))))
    (br_if $find (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $EV_SLOTS))))
  (if (i32.lt_s (local.get $free) (i32.const 0)) (then (return)))
  (local.set $p (call $event_ptr (local.get $free)))
  (local.set $kind (i32.add (i32.const 1) (call $rng_range (global.get $EV_KINDS))))
  (i32.store8 (local.get $p) (local.get $kind))
  (i32.store8 offset=1 (local.get $p) (call $rng_range (i32.const 3)))
  (i32.store8 offset=2 (local.get $p) (call $rng_range (i32.const 13)))
  (if (i32.eq (local.get $kind) (global.get $EV_FESTIVAL))
    (then (i32.store8 offset=3 (local.get $p) (call $k (global.get $K_FESTIVAL_DAYS))))
    (else (i32.store8 offset=3 (local.get $p)
      (i32.add (call $k (global.get $K_EVENT_DUR_BASE)) (call $rng_range (call $k (global.get $K_EVENT_DUR_SPREAD)))))))
  (i32.store16 (global.get $S_NEXT_EVENT)
    (i32.add (i32.add (local.get $day1) (call $k (global.get $K_EVENT_GAP_BASE)))
            (call $rng_range (call $k (global.get $K_EVENT_GAP_SPREAD))))))

;; Price modifier in bp for (market, good): product of active Surge/Glut matches.
(func $event_mod (param $market i32) (param $good i32) (result i32)
  (local $i i32) (local $p i32) (local $m i32) (local $kind i32)
  (local.set $m (global.get $BP_ONE))
  (loop $scan
    (local.set $p (call $event_ptr (local.get $i)))
    (local.set $kind (i32.load8_u (local.get $p)))
    (if (i32.and
          (i32.and (i32.eq (i32.load8_u offset=1 (local.get $p)) (local.get $market))
                   (i32.eq (i32.load8_u offset=2 (local.get $p)) (local.get $good)))
          (i32.or (i32.eq (local.get $kind) (global.get $EV_SURGE))
                  (i32.eq (local.get $kind) (global.get $EV_GLUT))))
      (then
        (local.set $m (i32.div_u
          (i32.mul (local.get $m)
            (call $k (select (global.get $K_SURGE_BP) (global.get $K_GLUT_BP)
                             (i32.eq (local.get $kind) (global.get $EV_SURGE)))))
          (global.get $BP_ONE)))))
    (br_if $scan (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $EV_SLOTS))))
  (local.get $m))

(func $event_active (param $kind i32) (result i32)
  (local $i i32)
  (loop $scan
    (if (i32.eq (i32.load8_u (call $event_ptr (local.get $i))) (local.get $kind))
      (then (return (i32.const 1))))
    (br_if $scan (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $EV_SLOTS))))
  (i32.const 0))

;; Test hooks.
(func $t_forecast_roll (param $season i32) (call $forecast_roll (local.get $season)))
(func $t_set_weather (param $w i32) (i32.store8 (global.get $S_WEATHER) (local.get $w)))
(func $t_put_event (param $slot i32) (param $kind i32) (param $market i32) (param $good i32) (param $days i32)
  (local $p i32)
  (local.set $p (call $event_ptr (local.get $slot)))
  (i32.store8 (local.get $p) (local.get $kind))
  (i32.store8 offset=1 (local.get $p) (local.get $market))
  (i32.store8 offset=2 (local.get $p) (local.get $good))
  (i32.store8 offset=3 (local.get $p) (local.get $days)))
