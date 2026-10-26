(memory $m 1)
(export "memory" (memory $m))
(func $a (result i32) (i32.const 1))
(export "keep" (func $a))
(export "t_one" (func $a))
(export
  "t_multi"
  (func $a))
;; (export "t_commented" (func $a))
(export   "t_spaced"   (func   $a  )  )
