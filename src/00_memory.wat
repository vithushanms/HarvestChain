;; Memory and region map (spec §14.3). One linear memory, fixed layout, no allocator.
;;   0x00000  4 KB   scratch (0x000-0x0FF free), palette 0x100, Bayer 0x200, fonts 0x210/0x360,
;;                   demo strings 0x400 (see 02_data.wat), iso face table 0x600 (36 B, 21b_iso.wat),
;;                   UI icons 0x640 (28 x 24 B, generated, 02b_strings.wat), UI tables 0x900-0x936
;;                   (button styles, season icons, toast colours, tab icons, badge colours: 22_ui.wat / 22a_farm.wat),
;;                   0x937-0x939 truck upgrade cost columns, 0x948-0x954 good -> icon (22b_tabs.wat);
;;                   0x955-0xFFF free
;;            0x6800-0x70F7 scene model table (generated, 21c_scene.wat; size in its footer),
;;            0x7600-0x76C7 scene look / prop tables (21c_scene.wat), 0x7700.. UI string table
;;            (generated, 02b_strings.wat, <= 0x7FFF); the rest of 0x6800-0x7FFF free
;;   0x01000  16 KB  game state = save image
;;   0x05000  4 KB   replay / input log
;;   0x06000  8 KB   balance tables
;;   0x08000  64 KB  layout, hit regions, draw lists, announce buffer (rect table 0x8000, UI block 0x8100,
;;                   hit table 0x8200..0x8BFF: map in 20_layout.wat; text builders, toasts, announce
;;                   ring, button draw list (64), wrap buffer, tab amounts, label log 0x8C00..0xA8FF: map in
;;                   22_ui.wat; 0xA900.. free)
;;            (0x10000 upper 32 KB: IO staging for save / replay bytes from the loader)
;;   0x18000  ...    framebuffer w*h*4 bytes + canary word 0xCAFEF00D (memory.grow in $resize)

(memory $mem 2)

(global $R_SCRATCH  i32 (i32.const 0x00000))
(global $R_STATE    i32 (i32.const 0x01000))
(global $R_REPLAY   i32 (i32.const 0x05000))
(global $R_BAL      i32 (i32.const 0x06000))
(global $R_LAYOUT   i32 (i32.const 0x08000))
(global $R_IO       i32 (i32.const 0x10000))
(global $R_FB       i32 (i32.const 0x18000))
(global $STATE_SIZE i32 (i32.const 0x04000))
