;; Public surface (spec §14.1).
(export "memory" (memory $mem))

;; Test hooks.
(export "t_rng_seed"  (func $rng_seed))
(export "t_rng_next"  (func $rng_next))
(export "t_rng_range" (func $rng_range))
