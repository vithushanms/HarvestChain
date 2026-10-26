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
;; string table: 290 strings, 2946 B at 0x7200 (spec budget 2560 B)
(data (i32.const 0x7200)
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
  "UPKEEP \00" ;; 81
  "/DAY\00" ;; 82
  "STORAGE \00" ;; 83
  "EMPTY PLOT\00" ;; 84
  "OFF\00" ;; 85
  "MAX LEVEL\00" ;; 86
  "AGING \00" ;; 87
  "READY IN \00" ;; 88
  "ROTS IN \00" ;; 89
  "ROTTING\00" ;; 90
  "TODAY \00" ;; 91
  "FORECAST \00" ;; 92
  "PLANTED \00" ;; 93
  "HARVESTED \00" ;; 94
  "BUILT \00" ;; 95
  "CLEARED \00" ;; 96
  "UPGRADED \00" ;; 97
  "LAND BOUGHT: \00" ;; 98
  "TAP A PLOT TO PLANT OR BUILD\00" ;; 99
  "E END DAY  H HARVEST  ESC CLOSE\00" ;; 100
  "NEEDS \00" ;; 101
  "NEEDS \01\00" ;; 102
  "FROM DAY \00" ;; 103
  "BUY THE NEARER RING FIRST\00" ;; 104
  "FARM IS FULL SIZE\00" ;; 105
  "WILD LAND\00" ;; 106
  "CASH\00" ;; 107
  " PTS\00" ;; 108
  " LOST\00" ;; 109
  " SPOILED\00" ;; 110
  " RIPE\00" ;; 111
  "NOTHING RIPE\00" ;; 112
  "PLOT \00" ;; 113
  "YIELD \00" ;; 114
  " CAP \00" ;; 115
  "RECIPE\00" ;; 116
  "FARM \00" ;; 117
  "IN STORAGE\00" ;; 118
  "PICK A CROP\00" ;; 119
  " UNITS\00" ;; 120
  "ALL YEAR\00" ;; 121
  ", \00" ;; 122
  "X\00" ;; 123
  " PLOTS\00" ;; 124
  "\00" ;; 125
  "SURGE \02\00" ;; 126
  "GLUT \03\00" ;; 127
  "ROAD CLOSED\00" ;; 128
  "FESTIVAL\00" ;; 129
  "FUEL SPIKE\00" ;; 130
  "BUMPER CROP\00" ;; 131
  "STAND\00" ;; 132
  "TOWN\00" ;; 133
  "CITY\00" ;; 134
  "PRICES\00" ;; 135
  "SELL\00" ;; 136
  "CONTRACTS\00" ;; 137
  "WHERE TO?\00" ;; 138
  "CARGO\00" ;; 139
  "CONTRACT\00" ;; 140
  "CONFIRM\00" ;; 141
  "+20 CAP \00" ;; 142
  "FRIDGE \00" ;; 143
  "FAST \00" ;; 144
  "-\00" ;; 145
  "+\00" ;; 146
  "MAX\00" ;; 147
  "HOME\00" ;; 148
  "OUT TO \00" ;; 149
  "RETURNING\00" ;; 150
  " ROT TOMORROW\00" ;; 151
  "NEXT END DAY: \00" ;; 152
  "NO RECIPE SET\00" ;; 153
  "NEED \00" ;; 154
  " MORE\00" ;; 155
  " IN STOCK\00" ;; 156
  "ROOM \00" ;; 157
  "WINE IN \00" ;; 158
  "NOTHING \00" ;; 159
  "NO PROCESSORS YET\00" ;; 160
  " II\00" ;; 161
  " EA\00" ;; 162
  "FOR \00" ;; 163
  "NEXT UNITS DROP PRICE\00" ;; 164
  "SET A QUANTITY\00" ;; 165
  "OFFERS\00" ;; 166
  "ACCEPT \00" ;; 167
  "DECLINE\00" ;; 168
  "ACCEPTED\00" ;; 169
  "DECLINED\00" ;; 170
  " BY DAY \00" ;; 171
  "DUE IN \00" ;; 172
  "ON TRUCK \00" ;; 173
  "READY\00" ;; 174
  "TOO LATE\00" ;; 175
  "SEND TODAY\00" ;; 176
  "NONE YET\00" ;; 177
  "TRUCK \00" ;; 178
  "DISPATCH\00" ;; 179
  "BUY TRUCK \00" ;; 180
  "BOUGHT \00" ;; 181
  "SEND TRUCK\00" ;; 182
  " SENT TO \00" ;; 183
  "ARRIVES DAY \00" ;; 184
  "FILL BEST\00" ;; 185
  "NEXT\00" ;; 186
  "BACK\00" ;; 187
  "STEP \00" ;; 188
  "NO CONTRACT\00" ;; 189
  "WRONG MARKET\00" ;; 190
  "ON ANOTHER TRUCK\00" ;; 191
  "EST. SALES \00" ;; 192
  " PAYS \00" ;; 193
  " (INSTEAD OF MARKET)\00" ;; 194
  "FUEL \00" ;; 195
  " SPOIL ON THE WAY\00" ;; 196
  "LOAD \00" ;; 197
  "LOAD SOME GOODS\00" ;; 198
  "TAP AN EMPTY PLOT FOR \00" ;; 199
  "CANCEL\00" ;; 200
  "LAND\00" ;; 201
  "LOAN\00" ;; 202
  "OWED \00" ;; 203
  "TAKE \00" ;; 204
  "REPAY \00" ;; 205
  "ONE LOAN AT A TIME\00" ;; 206
  "NOTHING OWED\00" ;; 207
  "INTEREST IS PAID FIRST\00" ;; 208
  "BORROWED \00" ;; 209
  "REPAID \00" ;; 210
  " OWNED\00" ;; 211
  "UP TO \00" ;; 212
  " OF \00" ;; 213
  "TOO MANY KINDS\00" ;; 214
  "NEEDS ANOTHER GARAGE\00" ;; 215
  "-% = PRICE DROP FROM SELLING\00" ;; 216
  "HARVESTCHAIN\00" ;; 217
  "MORNING GAZETTE\00" ;; 218
  "JOURNAL\00" ;; 219
  "RUN COMPLETE!\00" ;; 220
  "BANKRUPT\00" ;; 221
  "HOW TO PLAY\00" ;; 222
  "REPLAY\00" ;; 223
  "PLAYING\00" ;; 224
  "ENDLESS\00" ;; 225
  "PLANT ON A PLOT. END DAY GROWS IT.\00" ;; 226
  "HARVEST WHEN RIPE.\00" ;; 227
  "A MILL TURNS WHEAT INTO FLOUR:\00" ;; 228
  "GOODS SELL FOR MORE.\00" ;; 229
  "SELL AT THE STAND, TRUCK TO TOWN\00" ;; 230
  "AND CITY. GROW YOUR NET WORTH!\00" ;; 231
  "FIRST PROCESSED SALE\00" ;; 232
  "GROWING CONCERN\00" ;; 233
  "TRUSTED SUPPLIER\00" ;; 234
  "A GOOD FIRST YEAR\00" ;; 235
  "LOCAL FAVOURITE\00" ;; 236
  "VINTNER\00" ;; 237
  "HARVEST TYCOON\00" ;; 238
  "SOLD \00" ;; 239
  "NET WORTH \00" ;; 240
  "CONTRACTS \00" ;; 241
  "REP \01\00" ;; 242
  "WINE \00" ;; 243
  "YEAR 3 COMPLETE\00" ;; 244
  "GROW. PROCESS. SELL. DELIVER.\00" ;; 245
  "CONTINUE\00" ;; 246
  "NEW GAME\00" ;; 247
  "TAP AGAIN: REPLACES SAVE\00" ;; 248
  "DAILY SEED #\00" ;; 249
  "LARGE TEXT\00" ;; 250
  "AUTO GAZETTE\00" ;; 251
  "0 IMAGE FILES ^ 0 FONT FILES ^ 1 WASM\00" ;; 252
  "LOADED IN \00" ;; 253
  " MS\00" ;; 254
  " KB\00" ;; 255
  " ^ \00" ;; 256
  "PAGE \00" ;; 257
  ", YEAR \00" ;; 258
  "% SURE\00" ;; 259
  " TOMORROW\00" ;; 260
  " STEADY\00" ;; 261
  "NEARLY FULL\00" ;; 262
  "START DAY\00" ;; 263
  "DON'T SHOW\00" ;; 264
  "SCORE \00" ;; 265
  " TO \00" ;; 266
  "REPUTATION \00" ;; 267
  "LOAN UNPAID, GRACE OVER\00" ;; 268
  "TRY AGAIN\00" ;; 269
  " IN \00" ;; 270
  "ON\00" ;; 271
  "STAR \00" ;; 272
  "UP\00" ;; 273
  "DOWN\00" ;; 274
  "RESTART\00" ;; 275
  "PLAY\00" ;; 276
  "PAUSE\00" ;; 277
  "SPEED \00" ;; 278
  "TAKE OVER\00" ;; 279
  "EXIT\00" ;; 280
  " INVALID AT DAY \00" ;; 281
  "WATCH \00" ;; 282
  "SHARED RUN\00" ;; 283
  "COPY CODE\00" ;; 284
  "COPIED!\00" ;; 285
  "SHARE CODE \00" ;; 286
  "...\00" ;; 287
  "RUN TOO LONG TO SHARE\00" ;; 288
  "SHARE ONLY FOR RUNS STARTED THIS SESSION\00" ;; 289
)
(global $STR_BASE i32 (i32.const 0x7200))
(global $STR_COUNT i32 (i32.const 290))
(global $STR_GOOD i32 (i32.const 0))
(global $STR_BLD i32 (i32.const 13))
(global $STR_WX i32 (i32.const 23))
(global $STR_SEA i32 (i32.const 29))
(global $STR_TAB i32 (i32.const 33))
(global $STR_ERR i32 (i32.const 38))
(global $STR_BINFO i32 (i32.const 58))
(global $STR_EV i32 (i32.const 125))
(global $STR_MKT i32 (i32.const 132))
(global $STR_MSUB i32 (i32.const 135))
(global $STR_STEPN i32 (i32.const 138))
(global $STR_UPG i32 (i32.const 142))
(global $STR_STP i32 (i32.const 145))
(global $STR_TST i32 (i32.const 148))
(global $STR_SCR i32 (i32.const 217))
(global $STR_ST i32 (i32.const 224))
(global $STR_HOW i32 (i32.const 226))
(global $STR_MNAME i32 (i32.const 232))
(global $STR_MP i32 (i32.const 239))
(global $STR_GLYPH i32 (i32.const 272))
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
(global $STR_UPKEEP i32 (i32.const 81))
(global $STR_PER_DAY i32 (i32.const 82))
(global $STR_STORAGE i32 (i32.const 83))
(global $STR_EMPTY i32 (i32.const 84))
(global $STR_OFF i32 (i32.const 85))
(global $STR_MAX_LEVEL i32 (i32.const 86))
(global $STR_AGING i32 (i32.const 87))
(global $STR_READY_IN i32 (i32.const 88))
(global $STR_ROTS_IN i32 (i32.const 89))
(global $STR_ROTTING i32 (i32.const 90))
(global $STR_TODAY i32 (i32.const 91))
(global $STR_FORECAST i32 (i32.const 92))
(global $STR_PLANTED i32 (i32.const 93))
(global $STR_HARVESTED i32 (i32.const 94))
(global $STR_BUILT i32 (i32.const 95))
(global $STR_CLEARED i32 (i32.const 96))
(global $STR_UPGRADED i32 (i32.const 97))
(global $STR_LAND_BOUGHT i32 (i32.const 98))
(global $STR_HINT i32 (i32.const 99))
(global $STR_KEYS i32 (i32.const 100))
(global $STR_NEEDS i32 (i32.const 101))
(global $STR_NEEDS_STAR i32 (i32.const 102))
(global $STR_FROM_DAY i32 (i32.const 103))
(global $STR_NEXT_RING i32 (i32.const 104))
(global $STR_FULL_FARM i32 (i32.const 105))
(global $STR_WILD i32 (i32.const 106))
(global $STR_CASH i32 (i32.const 107))
(global $STR_PTS i32 (i32.const 108))
(global $STR_LOST i32 (i32.const 109))
(global $STR_SPOILED i32 (i32.const 110))
(global $STR_NOW_RIPE i32 (i32.const 111))
(global $STR_NO_RIPE i32 (i32.const 112))
(global $STR_PLOT i32 (i32.const 113))
(global $STR_YIELD i32 (i32.const 114))
(global $STR_CAP i32 (i32.const 115))
(global $STR_RECIPE i32 (i32.const 116))
(global $STR_FARM_SIZE i32 (i32.const 117))
(global $STR_STOCK i32 (i32.const 118))
(global $STR_PICK i32 (i32.const 119))
(global $STR_UNITS i32 (i32.const 120))
(global $STR_SEASON_ANY i32 (i32.const 121))
(global $STR_SEP i32 (i32.const 122))
(global $STR_X i32 (i32.const 123))
(global $STR_PLOTS i32 (i32.const 124))
(global $STR_ROT i32 (i32.const 151))
(global $STR_PLAN i32 (i32.const 152))
(global $STR_NO_RECIPE i32 (i32.const 153))
(global $STR_NEED i32 (i32.const 154))
(global $STR_MORE i32 (i32.const 155))
(global $STR_IN_STOCK i32 (i32.const 156))
(global $STR_ROOM i32 (i32.const 157))
(global $STR_WINE_IN i32 (i32.const 158))
(global $STR_NOTHING i32 (i32.const 159))
(global $STR_NO_PROC i32 (i32.const 160))
(global $STR_II i32 (i32.const 161))
(global $STR_EA i32 (i32.const 162))
(global $STR_FOR i32 (i32.const 163))
(global $STR_DROP i32 (i32.const 164))
(global $STR_SET_QTY i32 (i32.const 165))
(global $STR_OFFERS i32 (i32.const 166))
(global $STR_ACCEPT i32 (i32.const 167))
(global $STR_DECLINE i32 (i32.const 168))
(global $STR_ACCEPTED i32 (i32.const 169))
(global $STR_DECLINED i32 (i32.const 170))
(global $STR_BY_DAY i32 (i32.const 171))
(global $STR_DUE i32 (i32.const 172))
(global $STR_ON_TRUCK i32 (i32.const 173))
(global $STR_READY i32 (i32.const 174))
(global $STR_TOO_LATE i32 (i32.const 175))
(global $STR_SEND_TODAY i32 (i32.const 176))
(global $STR_NONE i32 (i32.const 177))
(global $STR_TRUCK i32 (i32.const 178))
(global $STR_DISPATCH i32 (i32.const 179))
(global $STR_BUY_TRUCK i32 (i32.const 180))
(global $STR_BOUGHT i32 (i32.const 181))
(global $STR_SEND i32 (i32.const 182))
(global $STR_SENT i32 (i32.const 183))
(global $STR_ARRIVES i32 (i32.const 184))
(global $STR_FILL i32 (i32.const 185))
(global $STR_NEXT i32 (i32.const 186))
(global $STR_BACK i32 (i32.const 187))
(global $STR_STEP i32 (i32.const 188))
(global $STR_NO_CON i32 (i32.const 189))
(global $STR_WRONG_MKT i32 (i32.const 190))
(global $STR_TAKEN i32 (i32.const 191))
(global $STR_EST i32 (i32.const 192))
(global $STR_PAYS i32 (i32.const 193))
(global $STR_INSTEAD i32 (i32.const 194))
(global $STR_FUEL i32 (i32.const 195))
(global $STR_SPOIL i32 (i32.const 196))
(global $STR_LOAD i32 (i32.const 197))
(global $STR_EMPTY_T i32 (i32.const 198))
(global $STR_PLACE i32 (i32.const 199))
(global $STR_CANCEL i32 (i32.const 200))
(global $STR_LAND i32 (i32.const 201))
(global $STR_LOAN i32 (i32.const 202))
(global $STR_OWED i32 (i32.const 203))
(global $STR_TAKE i32 (i32.const 204))
(global $STR_REPAY i32 (i32.const 205))
(global $STR_ONE_LOAN i32 (i32.const 206))
(global $STR_NOTHING_OWED i32 (i32.const 207))
(global $STR_FIRST i32 (i32.const 208))
(global $STR_BORROWED i32 (i32.const 209))
(global $STR_REPAID i32 (i32.const 210))
(global $STR_OWNED i32 (i32.const 211))
(global $STR_UP_TO i32 (i32.const 212))
(global $STR_OF i32 (i32.const 213))
(global $STR_KINDS i32 (i32.const 214))
(global $STR_ANOTHER i32 (i32.const 215))
(global $STR_LEGEND i32 (i32.const 216))
(global $STR_YEAR3 i32 (i32.const 244))
(global $STR_TAGLINE i32 (i32.const 245))
(global $STR_CONTINUE i32 (i32.const 246))
(global $STR_NEW_GAME i32 (i32.const 247))
(global $STR_REPLACES i32 (i32.const 248))
(global $STR_DAILY i32 (i32.const 249))
(global $STR_LARGE i32 (i32.const 250))
(global $STR_AUTO_GAZ i32 (i32.const 251))
(global $STR_FILES i32 (i32.const 252))
(global $STR_LOADED i32 (i32.const 253))
(global $STR_MS i32 (i32.const 254))
(global $STR_KB i32 (i32.const 255))
(global $STR_DOTS i32 (i32.const 256))
(global $STR_PAGE i32 (i32.const 257))
(global $STR_YEAR i32 (i32.const 258))
(global $STR_SURE i32 (i32.const 259))
(global $STR_TOMORROW i32 (i32.const 260))
(global $STR_STEADY i32 (i32.const 261))
(global $STR_NEARLY i32 (i32.const 262))
(global $STR_START_DAY i32 (i32.const 263))
(global $STR_DONT_SHOW i32 (i32.const 264))
(global $STR_SCORE i32 (i32.const 265))
(global $STR_TO i32 (i32.const 266))
(global $STR_REPUTATION i32 (i32.const 267))
(global $STR_CAUSE i32 (i32.const 268))
(global $STR_TRY i32 (i32.const 269))
(global $STR_IN i32 (i32.const 270))
(global $STR_ON i32 (i32.const 271))
(global $STR_RESTART i32 (i32.const 275))
(global $STR_PLAY i32 (i32.const 276))
(global $STR_PAUSE i32 (i32.const 277))
(global $STR_SPEED i32 (i32.const 278))
(global $STR_TAKE_OVER i32 (i32.const 279))
(global $STR_EXIT i32 (i32.const 280))
(global $STR_INVALID i32 (i32.const 281))
(global $STR_WATCH i32 (i32.const 282))
(global $STR_SHARED i32 (i32.const 283))
(global $STR_COPY i32 (i32.const 284))
(global $STR_COPIED i32 (i32.const 285))
(global $STR_SHARE i32 (i32.const 286))
(global $STR_ELLIPSIS i32 (i32.const 287))
(global $STR_TOO_LONG i32 (i32.const 288))
(global $STR_NO_SHARE i32 (i32.const 289))
;; icons: 29 x 24 B at 0x640
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
  "\54\55\91\aa\46\fe\1b\a9\6a\e4\bf\91\aa\46\aa\1a\55\55\f0\ff\03\24\26\3b" ;; 28 BOOK
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
(global $I_BOOK i32 (i32.const 28))
;; <<< END GENERATED strings
