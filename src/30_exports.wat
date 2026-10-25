;; Public surface (spec §14.1).
(export "memory"   (memory $mem))
(export "init"     (func $init))
(export "load"     (func $load))
(export "save_ptr" (func $save_ptr))
(export "save_len" (func $save_len))
(export "io_buf"   (func $io_buf))

;; Test hooks.
(export "t_rng_seed"  (func $rng_seed))
(export "t_rng_next"  (func $rng_next))
(export "t_rng_range" (func $rng_range))
(export "t_bal"       (func $bal))
