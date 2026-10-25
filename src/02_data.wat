;; Static render data: palette, fonts, dither matrix, demo strings.
;; The palette and font segments between the GENERATED markers are written by
;; tools/gen-palette.mjs and tools/gen-font.mjs (run `npm run gen`); do not hand-edit them.
;; A test fails if they drift from the generators.
;;
;; Placement (0x0000-0x0FFF region): 0x000-0x0FF scratch (free), 0x100 palette (256 B),
;; 0x200 Bayer 4x4 (16 B), 0x210 body font 5x7 (67 glyphs x 5 B), 0x360 badge font 3x5
;; (67 glyphs x 2 B), 0x400 demo strings, 0x600 iso face table (36 B, in 21b_iso.wat).
;; 0x6800-0x7FFF stays free for icons / string tables.
;;
;; Palette: 64 entries x RGBA bytes (r,g,b,255) = little-endian 0xAABBGGRR pixel words.
;; Colour index = hue*4 + step (step 0 darkest .. 3 lightest). Hue indices ($H_*):
;;    0 SOIL   1 TILLED  2 GRASS  3 GRASS2  4 WHEAT  5 CORN   6 TOMATO 7 APPLE
;;    8 GRAPE  9 BARN   10 WOOD  11 STONE  12 SKY    13 WATER 14 PAPER 15 INK
;; (SOIL + TILLED are the two soil browns / dark tilled soil of the art direction.)
;;
;; Fonts: glyph slot = ASCII-32 for codes 32..95 (lowercase folds to uppercase), slot 64 =
;; star (code 1), 65 = up arrow (code 2), 66 = down arrow (code 3). 1 bit/pixel, row-major,
;; LSB first. Body 5x7 advance 6, badge 3x5 advance 4.

(global $PAL_ADDR   i32 (i32.const 0x100))
(global $BAYER_ADDR i32 (i32.const 0x200))
(global $FONT_BODY  i32 (i32.const 0x210))
(global $FONT_BADGE i32 (i32.const 0x360))
(global $DEMO_STR   i32 (i32.const 0x400))

;; >>> GENERATED palette: do not hand-edit (npm run gen)
(data (i32.const 0x100)
  "\51\31\29\ff\76\4d\37\ff\9c\70\49\ff\b5\98\6e\ff" ;; 0 SOIL
  "\24\15\14\ff\39\23\1d\ff\54\39\2b\ff\70\55\3e\ff" ;; 1 TILLED
  "\21\46\20\ff\38\6d\2c\ff\5b\9c\40\ff\8c\bb\68\ff" ;; 2 GRASS
  "\35\4f\21\ff\5b\7b\2d\ff\88\a8\3e\ff\b3\c2\6b\ff" ;; 3 GRASS2
  "\81\46\18\ff\c5\7e\1b\ff\e5\b4\43\ff\e8\d8\87\ff" ;; 4 WHEAT
  "\9a\64\14\ff\df\ab\11\ff\f1\d9\41\ff\f1\e9\92\ff" ;; 5 CORN
  "\78\17\2a\ff\b4\18\20\ff\e2\34\28\ff\e4\85\6d\ff" ;; 6 TOMATO
  "\5d\1d\3b\ff\8d\25\46\ff\bd\32\4e\ff\ce\64\6b\ff" ;; 7 APPLE
  "\30\22\44\ff\4f\2f\6a\ff\79\42\94\ff\a6\68\b5\ff" ;; 8 GRAPE
  "\46\16\1c\ff\6d\1e\1d\ff\91\35\27\ff\ba\5d\3b\ff" ;; 9 BARN
  "\4a\24\1c\ff\73\3e\26\ff\9d\62\34\ff\be\91\55\ff" ;; 10 WOOD
  "\39\3a\42\ff\59\5e\69\ff\80\88\93\ff\ad\b3\b8\ff" ;; 11 STONE
  "\28\4f\a4\ff\43\8a\db\ff\7e\bb\e7\ff\bd\e1\ef\ff" ;; 12 SKY
  "\1d\4a\67\ff\27\86\a5\ff\41\bf\d2\ff\88\dd\dd\ff" ;; 13 WATER
  "\cd\9e\7a\ff\e0\c7\a3\ff\ee\e4\cd\ff\f8\f6\ed\ff" ;; 14 PAPER
  "\0f\0f\1a\ff\1a\1c\2e\ff\28\30\48\ff\41\52\6d\ff" ;; 15 INK
)
(global $H_SOIL i32 (i32.const 0))
(global $H_TILLED i32 (i32.const 1))
(global $H_GRASS i32 (i32.const 2))
(global $H_GRASS2 i32 (i32.const 3))
(global $H_WHEAT i32 (i32.const 4))
(global $H_CORN i32 (i32.const 5))
(global $H_TOMATO i32 (i32.const 6))
(global $H_APPLE i32 (i32.const 7))
(global $H_GRAPE i32 (i32.const 8))
(global $H_BARN i32 (i32.const 9))
(global $H_WOOD i32 (i32.const 10))
(global $H_STONE i32 (i32.const 11))
(global $H_SKY i32 (i32.const 12))
(global $H_WATER i32 (i32.const 13))
(global $H_PAPER i32 (i32.const 14))
(global $H_INK i32 (i32.const 15))
;; <<< END GENERATED palette
;; >>> GENERATED fonts: do not hand-edit (npm run gen)
(data (i32.const 0x210)
  "\00\00\00\00\00" ;; 0  
  "\84\10\42\00\01" ;; 1 !
  "\4a\01\00\00\00" ;; 2 \\"
  "\4a\7d\f5\95\02" ;; 3 #
  "\c4\17\47\1f\01" ;; 4 $
  "\73\22\22\72\06" ;; 5 %
  "\00\00\00\00\00" ;; 6 &
  "\84\08\00\00\00" ;; 7 '
  "\88\08\21\08\02" ;; 8 (
  "\82\20\84\88\00" ;; 9 )
  "\80\54\57\09\00" ;; 10 *
  "\80\90\4f\08\00" ;; 11 +
  "\00\00\60\88\00" ;; 12 ,
  "\00\00\07\00\00" ;; 13 -
  "\00\00\00\8c\01" ;; 14 .
  "\10\22\22\42\00" ;; 15 /
  "\2e\e6\3a\a3\03" ;; 16 0
  "\c4\10\42\88\03" ;; 17 1
  "\2e\42\44\c4\07" ;; 18 2
  "\0f\42\07\e1\03" ;; 19 3
  "\88\a9\f4\11\02" ;; 20 4
  "\3f\3c\08\a3\03" ;; 21 5
  "\2e\84\17\a3\03" ;; 22 6
  "\1f\22\22\84\00" ;; 23 7
  "\2e\46\17\a3\03" ;; 24 8
  "\2e\46\0f\a1\03" ;; 25 9
  "\80\00\00\08\00" ;; 26 :
  "\80\00\40\88\00" ;; 27 ;
  "\88\88\20\08\02" ;; 28 <
  "\00\7c\f0\01\00" ;; 29 =
  "\82\20\88\88\00" ;; 30 >
  "\2e\42\44\00\01" ;; 31 ?
  "\00\00\00\00\00" ;; 32 @
  "\2e\c6\1f\63\04" ;; 33 A
  "\2f\c6\17\e3\03" ;; 34 B
  "\2e\86\10\a2\03" ;; 35 C
  "\2f\c6\18\e3\03" ;; 36 D
  "\3f\84\17\c2\07" ;; 37 E
  "\3f\84\17\42\00" ;; 38 F
  "\2e\86\1e\a3\03" ;; 39 G
  "\31\c6\1f\63\04" ;; 40 H
  "\8e\10\42\88\03" ;; 41 I
  "\1c\21\84\92\01" ;; 42 J
  "\31\95\51\52\04" ;; 43 K
  "\21\84\10\c2\07" ;; 44 L
  "\71\d7\1a\63\04" ;; 45 M
  "\71\d6\1c\63\04" ;; 46 N
  "\2e\c6\18\a3\03" ;; 47 O
  "\2f\c6\17\42\00" ;; 48 P
  "\2e\c6\58\93\05" ;; 49 Q
  "\2f\c6\57\52\04" ;; 50 R
  "\3e\04\07\e1\03" ;; 51 S
  "\9f\10\42\08\01" ;; 52 T
  "\31\c6\18\a3\03" ;; 53 U
  "\31\c6\18\15\01" ;; 54 V
  "\31\c6\5a\77\04" ;; 55 W
  "\31\2a\a2\62\04" ;; 56 X
  "\31\2a\42\08\01" ;; 57 Y
  "\1f\22\22\c2\07" ;; 58 Z
  "\00\00\00\00\00" ;; 59 [
  "\00\00\00\00\00" ;; 60 \\\\
  "\00\00\00\00\00" ;; 61 ]
  "\00\00\00\00\00" ;; 62 ^
  "\00\00\00\00\00" ;; 63 _
  "\84\7c\e7\54\04" ;; 64 star
  "\c4\55\42\08\01" ;; 65 up
  "\84\10\52\1d\01" ;; 66 down
) ;; font 5x7
(data (i32.const 0x360)
  "\00\00" ;; 0  
  "\92\20" ;; 1 !
  "\2d\00" ;; 2 \\"
  "\7d\5f" ;; 3 #
  "\9e\3c" ;; 4 $
  "\a5\52" ;; 5 %
  "\00\00" ;; 6 &
  "\12\00" ;; 7 '
  "\4a\22" ;; 8 (
  "\22\29" ;; 9 )
  "\d5\55" ;; 10 *
  "\d0\05" ;; 11 +
  "\00\14" ;; 12 ,
  "\c0\01" ;; 13 -
  "\00\20" ;; 14 .
  "\a4\12" ;; 15 /
  "\6f\7b" ;; 16 0
  "\9a\74" ;; 17 1
  "\a3\72" ;; 18 2
  "\a3\38" ;; 19 3
  "\ed\49" ;; 20 4
  "\cf\38" ;; 21 5
  "\ce\7b" ;; 22 6
  "\a7\24" ;; 23 7
  "\ef\7b" ;; 24 8
  "\ef\39" ;; 25 9
  "\10\04" ;; 26 :
  "\10\14" ;; 27 ;
  "\54\44" ;; 28 <
  "\38\0e" ;; 29 =
  "\11\15" ;; 30 >
  "\a3\20" ;; 31 ?
  "\00\00" ;; 32 @
  "\ea\5b" ;; 33 A
  "\eb\3a" ;; 34 B
  "\4e\62" ;; 35 C
  "\6b\3b" ;; 36 D
  "\cf\72" ;; 37 E
  "\cf\12" ;; 38 F
  "\4e\6b" ;; 39 G
  "\ed\5b" ;; 40 H
  "\97\74" ;; 41 I
  "\24\2b" ;; 42 J
  "\ed\5a" ;; 43 K
  "\49\72" ;; 44 L
  "\fd\5b" ;; 45 M
  "\6b\5b" ;; 46 N
  "\6a\2b" ;; 47 O
  "\eb\12" ;; 48 P
  "\6a\67" ;; 49 Q
  "\eb\5a" ;; 50 R
  "\8e\38" ;; 51 S
  "\97\24" ;; 52 T
  "\6d\7b" ;; 53 U
  "\6d\2b" ;; 54 V
  "\ed\5f" ;; 55 W
  "\ad\5a" ;; 56 X
  "\ad\24" ;; 57 Y
  "\a7\72" ;; 58 Z
  "\00\00" ;; 59 [
  "\00\00" ;; 60 \\\\
  "\00\00" ;; 61 ]
  "\00\00" ;; 62 ^
  "\00\00" ;; 63 _
  "\fa\55" ;; 64 star
  "\ba\24" ;; 65 up
  "\92\2e" ;; 66 down
) ;; font 3x5
;; <<< END GENERATED fonts

;; Ordered-dither threshold matrix (Bayer 4x4), index = (y&3)*4 + (x&3).
(data (i32.const 0x200) "\00\08\02\0a\0c\04\0e\06\03\0b\01\09\0f\07\0d\05")

;; Demo-scene strings (zero terminated), used by t_demo.
(data (i32.const 0x400)
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ\00"     ;; +0x00
  "0123456789 .,:;!?-+/%$'()*<>=\00"  ;; +0x1B
  "\01 \02 \03 STAR UP DOWN\00"       ;; +0x39
  "HARVEST\00"                        ;; +0x4C
  "END DAY\00"                        ;; +0x54
  "DAY 12 $1,450\00")                 ;; +0x5C
