;; UI string table and glyph icons (ruling C9). Everything between the GENERATED markers is
;; written by tools/gen-strings.mjs (`npm run gen`); do not hand-edit it. A test fails on drift.
;;
;; Strings: zero-terminated UPPERCASE text at 0x7700 in id order ($str(id) walks the table).
;; $STR_<GROUP> is the first id of a contiguous group indexed by number: GOOD (13 goods),
;; BLD (10 buildings), WX (6 weathers), SEA (4 seasons), TAB (5 tabs), ERR (error code 0..19),
;; BINFO (10 building roles). Codes 1/2/3 draw the star / up / down arrow glyphs.
;; Icons: 9x9 at 2 bits per pixel + 3 palette indices, 24 B each at 0x0640 ($I_<NAME> ids);
;; drawn by $ui_icon (22_ui.wat), which also draws ids >= 64 as tiny 3D models of the farm
;; (64 + crop = ripe crop, 80 + building).

;; >>> GENERATED strings: do not hand-edit (npm run gen)
;; string table: 128 strings, 1164 B at 0x7700 (budget 2560 B)
(data (i32.const 0x7700)
  "WHEAT\00" ;; 0
  "CORN\00" ;; 1
  "TOMATO\00" ;; 2
  "APPLE\00" ;; 3
  "GRAPE\00" ;; 4
  "FLOUR\00" ;; 5
  "CORNMEAL\00" ;; 6
  "SAUCE\00" ;; 7
  "APPLE JUICE\00" ;; 8
  "GRAPE JUICE\00" ;; 9
  "BREAD\00" ;; 10
  "CORNBREAD\00" ;; 11
  "WINE\00" ;; 12
  "MILL\00" ;; 13
  "CANNERY\00" ;; 14
  "PRESS\00" ;; 15
  "BAKERY\00" ;; 16
  "CELLAR\00" ;; 17
  "WAREHOUSE\00" ;; 18
  "COLD STORE\00" ;; 19
  "GREENHOUSE\00" ;; 20
  "WELL\00" ;; 21
  "GARAGE\00" ;; 22
  "SUNNY\00" ;; 23
  "RAIN\00" ;; 24
  "DROUGHT\00" ;; 25
  "STORM\00" ;; 26
  "FROST\00" ;; 27
  "HEATWAVE\00" ;; 28
  "SPRING\00" ;; 29
  "SUMMER\00" ;; 30
  "AUTUMN\00" ;; 31
  "WINTER\00" ;; 32
  "FARM\00" ;; 33
  "PROCESS\00" ;; 34
  "MARKET\00" ;; 35
  "TRUCKS\00" ;; 36
  "BUILD\00" ;; 37
  "DONE\00" ;; 38
  "CAN'T DO THAT\00" ;; 39
  "RUN IS OVER\00" ;; 40
  "NOT YOUR LAND\00" ;; 41
  "PLOT IN USE\00" ;; 42
  "OUT OF SEASON\00" ;; 43
  "NOT ENOUGH CASH\00" ;; 44
  "LOCKED\00" ;; 45
  "NOT RIPE YET\00" ;; 46
  "STORAGE FULL\00" ;; 47
  "NOT IN STOCK\00" ;; 48
  "TRUCK IS AWAY\00" ;; 49
  "TRUCK IS FULL\00" ;; 50
  "NO FREE SLOT\00" ;; 51
  "LIMIT REACHED\00" ;; 52
  "NEEDS A GARAGE\00" ;; 53
  "NO SUCH CONTRACT\00" ;; 54
  "PAST DEADLINE\00" ;; 55
  "LOAN NOT ALLOWED\00" ;; 56
  "NOT A BUILDING\00" ;; 57
  "\00" ;; 58
  "\00" ;; 59
  "\00" ;; 60
  "\00" ;; 61
  "\00" ;; 62
  "MORE STORAGE\00" ;; 63
  "NO SPOILAGE\00" ;; 64
  "ANY SEASON\00" ;; 65
  "STOPS DROUGHT\00" ;; 66
  "+1 TRUCK SLOT\00" ;; 67
  "DAY \00" ;; 68
  "END DAY\00" ;; 69
  "HARVEST\00" ;; 70
  "PLANT\00" ;; 71
  "UPGRADE\00" ;; 72
  "DEMOLISH\00" ;; 73
  "CLEAR PLOT\00" ;; 74
  "TAP AGAIN\00" ;; 75
  "BUY LAND\00" ;; 76
  "IN SEASON\00" ;; 77
  " DAYS\00" ;; 78
  " DAY\00" ;; 79
  "RIPE\00" ;; 80
  "GROWING\00" ;; 81
  "UPKEEP \00" ;; 82
  "/DAY\00" ;; 83
  "STORAGE \00" ;; 84
  "EMPTY PLOT\00" ;; 85
  "OFF\00" ;; 86
  "MAX LEVEL\00" ;; 87
  "AGING \00" ;; 88
  "READY IN \00" ;; 89
  "ROTS IN \00" ;; 90
  "ROTTING\00" ;; 91
  "TODAY \00" ;; 92
  "FORECAST \00" ;; 93
  "PLANTED \00" ;; 94
  "HARVESTED \00" ;; 95
  "BUILT \00" ;; 96
  "CLEARED \00" ;; 97
  "UPGRADED \00" ;; 98
  "LAND BOUGHT: \00" ;; 99
  "TAP A PLOT TO PLANT OR BUILD\00" ;; 100
  "E END DAY  H HARVEST  ESC CLOSE\00" ;; 101
  "NEEDS \00" ;; 102
  "NEEDS \01\00" ;; 103
  "FROM DAY \00" ;; 104
  "BUY THE NEARER RING FIRST\00" ;; 105
  "FARM IS FULL SIZE\00" ;; 106
  "WILD LAND\00" ;; 107
  "CASH\00" ;; 108
  " PTS\00" ;; 109
  " LOST\00" ;; 110
  " SPOILED\00" ;; 111
  " RIPE\00" ;; 112
  "NOTHING RIPE\00" ;; 113
  "PLOT \00" ;; 114
  "YIELD \00" ;; 115
  " CAP \00" ;; 116
  "RECIPE\00" ;; 117
  "FARM \00" ;; 118
  "IN STORAGE\00" ;; 119
  "PICK A CROP\00" ;; 120
  " UNITS\00" ;; 121
  "SELECTED \00" ;; 122
  "RUN IS OVER\00" ;; 123
  "ALL YEAR\00" ;; 124
  ", \00" ;; 125
  "X\00" ;; 126
  " PLOTS\00" ;; 127
)
(global $STR_GOOD i32 (i32.const 0))
(global $STR_BLD i32 (i32.const 13))
(global $STR_WX i32 (i32.const 23))
(global $STR_SEA i32 (i32.const 29))
(global $STR_TAB i32 (i32.const 33))
(global $STR_ERR i32 (i32.const 38))
(global $STR_BINFO i32 (i32.const 58))
(global $STR_DAY i32 (i32.const 68))
(global $STR_END_DAY i32 (i32.const 69))
(global $STR_HARVEST i32 (i32.const 70))
(global $STR_PLANT i32 (i32.const 71))
(global $STR_UPGRADE i32 (i32.const 72))
(global $STR_DEMOLISH i32 (i32.const 73))
(global $STR_CLEAR i32 (i32.const 74))
(global $STR_TAP_AGAIN i32 (i32.const 75))
(global $STR_BUY_LAND i32 (i32.const 76))
(global $STR_IN_SEASON i32 (i32.const 77))
(global $STR_DAYS i32 (i32.const 78))
(global $STR_DAY1 i32 (i32.const 79))
(global $STR_RIPE i32 (i32.const 80))
(global $STR_GROWING i32 (i32.const 81))
(global $STR_UPKEEP i32 (i32.const 82))
(global $STR_PER_DAY i32 (i32.const 83))
(global $STR_STORAGE i32 (i32.const 84))
(global $STR_EMPTY i32 (i32.const 85))
(global $STR_OFF i32 (i32.const 86))
(global $STR_MAX_LEVEL i32 (i32.const 87))
(global $STR_AGING i32 (i32.const 88))
(global $STR_READY_IN i32 (i32.const 89))
(global $STR_ROTS_IN i32 (i32.const 90))
(global $STR_ROTTING i32 (i32.const 91))
(global $STR_TODAY i32 (i32.const 92))
(global $STR_FORECAST i32 (i32.const 93))
(global $STR_PLANTED i32 (i32.const 94))
(global $STR_HARVESTED i32 (i32.const 95))
(global $STR_BUILT i32 (i32.const 96))
(global $STR_CLEARED i32 (i32.const 97))
(global $STR_UPGRADED i32 (i32.const 98))
(global $STR_LAND_BOUGHT i32 (i32.const 99))
(global $STR_HINT i32 (i32.const 100))
(global $STR_KEYS i32 (i32.const 101))
(global $STR_NEEDS i32 (i32.const 102))
(global $STR_NEEDS_STAR i32 (i32.const 103))
(global $STR_FROM_DAY i32 (i32.const 104))
(global $STR_NEXT_RING i32 (i32.const 105))
(global $STR_FULL_FARM i32 (i32.const 106))
(global $STR_WILD i32 (i32.const 107))
(global $STR_CASH i32 (i32.const 108))
(global $STR_PTS i32 (i32.const 109))
(global $STR_LOST i32 (i32.const 110))
(global $STR_SPOILED i32 (i32.const 111))
(global $STR_NOW_RIPE i32 (i32.const 112))
(global $STR_NO_RIPE i32 (i32.const 113))
(global $STR_PLOT i32 (i32.const 114))
(global $STR_YIELD i32 (i32.const 115))
(global $STR_CAP i32 (i32.const 116))
(global $STR_RECIPE i32 (i32.const 117))
(global $STR_FARM_SIZE i32 (i32.const 118))
(global $STR_STOCK i32 (i32.const 119))
(global $STR_PICK i32 (i32.const 120))
(global $STR_UNITS i32 (i32.const 121))
(global $STR_SELECTED i32 (i32.const 122))
(global $STR_RUN_OVER i32 (i32.const 123))
(global $STR_SEASON_ANY i32 (i32.const 124))
(global $STR_SEP i32 (i32.const 125))
(global $STR_X i32 (i32.const 126))
(global $STR_PLOTS i32 (i32.const 127))
;; icons: 28 x 24 B at 0x640
(data (i32.const 0x640)
  "\50\15\90\be\91\66\5e\da\6b\a9\a9\a5\9f\96\9a\1a\a9\1a\50\15\00\10\16\17" ;; 0 COIN
  "\00\01\00\1d\00\64\40\e5\56\a4\6a\40\6a\40\9a\06\19\19\14\50\00\10\16\17" ;; 1 STAR
  "\00\01\10\00\01\a8\00\f8\0a\e1\2a\81\aa\00\a8\00\01\10\00\01\00\11\16\17" ;; 2 SUN
  "\c0\0f\f0\bf\f2\bf\2a\aa\2a\00\00\10\04\11\04\01\04\41\04\41\00\31\2e\3b" ;; 3 RAIN
  "\80\0a\80\aa\80\aa\0a\00\00\ff\ff\7f\7f\fc\37\ff\fc\fd\ff\ff\03\00\16\02" ;; 4 DROUGHT
  "\40\05\50\95\52\95\2a\ea\2a\00\0f\00\0f\00\ff\00\c0\03\00\03\00\2c\2d\16" ;; 5 STORM
  "\00\02\20\08\02\22\02\e0\02\ea\af\02\2e\00\22\02\82\20\00\02\00\35\37\3b" ;; 6 FROST
  "\40\05\00\1d\02\74\00\90\21\40\06\40\6a\00\a9\01\a4\06\40\05\00\3d\1a\3b" ;; 7 HEAT
  "\00\00\f0\80\f2\8b\1a\af\1a\90\06\00\08\00\20\00\90\01\50\15\00\08\0a\0b" ;; 8 SPROUT
  "\00\54\01\e5\07\e9\1f\e9\6f\a4\6f\90\6f\40\6e\00\59\00\01\00\00\25\11\12" ;; 9 LEAF
  "\00\00\a8\0a\a0\2a\8a\aa\b8\aa\aa\aa\aa\5a\55\15\05\14\00\00\00\3c\26\37" ;; 10 TRUCK
  "\00\00\00\04\00\50\40\55\05\55\55\54\55\00\50\00\40\00\00\00\00\3d\3e\3f" ;; 11 ARROW_R
  "\00\00\00\04\00\14\00\54\55\54\55\41\55\05\14\00\40\00\00\00\00\3d\3e\3f" ;; 12 ARROW_L
  "\00\00\00\00\05\00\19\01\19\19\19\90\19\00\19\00\10\00\00\00\00\08\0a\0b" ;; 13 CHECK
  "\40\05\40\40\00\01\01\55\15\a4\6a\90\ae\41\ba\06\a9\1a\54\55\00\3d\2e\12" ;; 14 LOCK
  "\00\01\00\19\00\64\00\64\06\90\19\90\a6\41\aa\46\6a\6a\55\55\01\3c\16\15" ;; 15 WARN
  "\00\00\50\40\41\45\05\54\05\40\05\40\55\40\45\05\05\14\00\00\00\3d\3e\3f" ;; 16 CLOSE
  "\30\33\30\3f\03\ff\43\55\55\69\a6\91\99\41\9a\06\99\19\50\15\00\28\2a\12" ;; 17 BASKET
  "\80\0a\80\2e\80\2e\00\2e\30\b8\00\a0\0b\03\ba\02\a0\0a\00\00\00\3e\16\17" ;; 18 MOON
  "\00\01\00\19\00\a9\01\a9\1a\55\55\d1\ff\41\57\07\5d\1d\54\55\00\24\26\3b" ;; 19 HOUSE
  "\00\01\10\19\01\b9\01\79\1b\79\b4\91\b7\01\a9\01\91\11\00\01\00\2c\2e\2f" ;; 20 GEAR
  "\55\55\b9\bb\eb\ee\2e\01\10\04\40\10\00\51\55\15\01\10\04\40\00\25\26\3b" ;; 21 STALL
  "\54\05\a4\6a\90\aa\01\f5\01\40\07\00\1d\00\74\00\d0\01\40\05\00\2c\2e\2a" ;; 22 HAMMER
  "\50\15\90\aa\91\ba\5a\ea\6a\a9\af\a5\aa\96\aa\1a\a9\1a\50\15\00\3d\3b\3e" ;; 23 CLOCK
  "\00\00\54\55\d5\ff\5f\66\66\55\55\a5\99\96\99\59\55\55\00\00\00\28\2a\2b" ;; 24 CRATE
  "\00\01\00\1d\00\fd\01\a9\1a\95\5a\41\6a\00\a9\01\a4\06\50\15\00\08\0a\0b" ;; 25 UP
  "\40\05\54\55\05\00\00\fd\1f\b4\7b\d0\ee\41\bb\07\a9\1a\50\15\00\3d\2e\2f" ;; 26 TRASH
  "\40\05\00\1d\00\64\40\d5\55\bd\aa\55\59\05\64\00\90\01\40\05\00\08\0a\0b" ;; 27 PLUS
)
(global $I_COIN i32 (i32.const 0))
(global $I_STAR i32 (i32.const 1))
(global $I_SUN i32 (i32.const 2))
(global $I_RAIN i32 (i32.const 3))
(global $I_DROUGHT i32 (i32.const 4))
(global $I_STORM i32 (i32.const 5))
(global $I_FROST i32 (i32.const 6))
(global $I_HEAT i32 (i32.const 7))
(global $I_SPROUT i32 (i32.const 8))
(global $I_LEAF i32 (i32.const 9))
(global $I_TRUCK i32 (i32.const 10))
(global $I_ARROW_R i32 (i32.const 11))
(global $I_ARROW_L i32 (i32.const 12))
(global $I_CHECK i32 (i32.const 13))
(global $I_LOCK i32 (i32.const 14))
(global $I_WARN i32 (i32.const 15))
(global $I_CLOSE i32 (i32.const 16))
(global $I_BASKET i32 (i32.const 17))
(global $I_MOON i32 (i32.const 18))
(global $I_HOUSE i32 (i32.const 19))
(global $I_GEAR i32 (i32.const 20))
(global $I_STALL i32 (i32.const 21))
(global $I_HAMMER i32 (i32.const 22))
(global $I_CLOCK i32 (i32.const 23))
(global $I_CRATE i32 (i32.const 24))
(global $I_UP i32 (i32.const 25))
(global $I_TRASH i32 (i32.const 26))
(global $I_PLUS i32 (i32.const 27))
;; <<< END GENERATED strings
