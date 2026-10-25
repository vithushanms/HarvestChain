;; presentation code must not draw from the sim RNG
(func $sparkle (result i32) (call $rng_next))
