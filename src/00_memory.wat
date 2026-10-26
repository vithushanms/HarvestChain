;; Memory and region map (spec §14.3). One linear memory, fixed layout, no allocator.
;;   0x00000  4 KB   scratch (0x000-0x0FF free), palette 0x100, Bayer 0x200, fonts 0x210/0x360,
;;                   demo strings 0x400 (see 02_data.wat), iso face table 0x600 (36 B, 21b_iso.wat),
;;                   0x640-0x8FF free (the icon table moved out in the Task 7a fixes), UI tables 0x900-0x936
;;                   (button styles, season icons, toast colours, tab icons, badge colours: 22_ui.wat / 22a_farm.wat),
;;                   0x937-0x939 truck upgrade cost columns, 0x93A-0x93C route stop models, 0x948-0x954 good -> icon (22b_tabs.wat);
;;                   0x955-0x972 screen header icons, Enter buttons, How-to models, confetti colours,
;;                   milestone progress map (22c_screens.wat); UI icons 0xA00.. (31 x 24 B, generated,
;;                   02b_strings.wat; room up to 0xF7F = 58 icons); 0xF80-0xF93 replay arg counts (24_replay.wat);
;;                   0x973-0x9FF, the end of the icon table-0xF7F, 0xF94-0xFFF free
;;            0x6800-0x70F7 scene model table (generated, 21c_scene.wat; size in its footer),
;;            0x7100-0x71C7 scene look / prop tables (21c_scene.wat), 0x7200.. UI string table
;;            (generated, 02b_strings.wat, <= 0x7FFF); the rest of 0x6800-0x7FFF free
;;   0x01000  16 KB  game state = save image
;;   0x05000  4 KB   replay / input log (format: 24_replay.wat)
;;   0x06000  8 KB   balance tables
;;   0x08000  32 KB  layout, hit regions, draw lists, announce buffer (rect table 0x8000, UI block 0x8100,
;;                   hit table 0x8200..0x8BFF: map in 20_layout.wat; text builders, toasts, announce
;;                   ring, button draw list (64), wrap buffer, tab amounts, label log 0x8C00..0xA8FF: map in
;;                   22_ui.wat; End Day summary + screen announce builder 0xAA00..0xAC3F (22c_screens.wat);
;;                   stats overlay frame ring + row builders 0xAC40..0xAF1F (23_overlay.wat);
;;                   replay: viewer log 0xB000..0xBFFF, pre-viewer state 0xC000..0xC5AF, share URL / code
;;                   0xC800..0xDFFF, base64 decode 0xE000..0xEFFF, pre-action state 0xF000..0xF5AF (24_replay.wat);
;;                   onboarding hint / step line / announce builders 0xA900..0xA9BF (22d_onboard.wat);
;;                   0xA9C0..0xA9FF, 0xAF20..0xAFFF, 0xC5B0..0xC7FF, 0xF5B0..0xFFFF free)
;;   0x10000  16 KB  IO staging 0x10000..0x13FFF ($R_IO, $IO_SIZE): save bytes, the hc.log share code,
;;                   a pasted / #hash code or link, the origin, from the loader (its toIo cap = IO_SIZE;
;;                   replay_load / replay_restore refuse longer text). Largest legal text: origin
;;                   (<= 512) + '#' + 5,462-char code (4 KB log) = 5,975 B; a save is 0x5B0 B.
;;   0x14000  11.4 KB QR encoder 0x14000..0x16DC0: version table (data), RS generator, codewords,
;;                   interleaved stream, 97x97 module matrix (map in 25_qr.wat); 0x16DC1..0x17FFF free.
;;                   (tests/memory-map.test.mjs asserts every region here is disjoint.)
;;   0x18000  ...    framebuffer w*h*4 bytes + canary word 0xCAFEF00D (memory.grow in $resize)

(memory $mem 2)

(global $R_SCRATCH  i32 (i32.const 0x00000))
(global $R_STATE    i32 (i32.const 0x01000))
(global $R_REPLAY   i32 (i32.const 0x05000))
(global $R_BAL      i32 (i32.const 0x06000))
(global $R_LAYOUT   i32 (i32.const 0x08000))
(global $R_IO       i32 (i32.const 0x10000))
(global $IO_SIZE    i32 (i32.const 0x04000))
(global $R_FB       i32 (i32.const 0x18000))
(global $STATE_SIZE i32 (i32.const 0x04000))
