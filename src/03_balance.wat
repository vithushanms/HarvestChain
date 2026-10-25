;; Balance tables (spec §5–§12). Every tunable number lives here, never in logic.
;; All fields are u16 little-endian. Tests (tests/balance.test.mjs) check every value
;; against the spec; tools/balance.json names the tables, columns and enums.
;;
;; Enums
;;   goods      0 Wheat 1 Corn 2 Tomato 3 Apple 4 Grape 5 Flour 6 Cornmeal 7 Sauce
;;              8 AppleJuice 9 GrapeJuice 10 Bread 11 Cornbread 12 Wine  (crop id = good id, 0-4)
;;   buildings  0 Mill 1 Cannery 2 Press 3 Bakery 4 Cellar 5 Warehouse 6 ColdStore
;;              7 Greenhouse 8 Well 9 Garage
;;   markets    0 Stand 1 Town 2 City
;;   seasons    0 Spring 1 Summer 2 Autumn 3 Winter  (seasonMask bit = 1 << season)
;;   unlock     0 None 1 OwnsBuilding(arg = building) 2 RepRank(arg = rank) 3 DayReached(arg = day)
;;
;; Region 0x6000-0x7FFF. Bytes used: 0x212.

(global $T_CROP   i32 (i32.const 0))
(global $T_GOOD   i32 (i32.const 1))
(global $T_BLD    i32 (i32.const 2))
(global $T_RECIPE i32 (i32.const 3))
(global $T_MKT    i32 (i32.const 4))
(global $T_LAND   i32 (i32.const 5))
(global $T_REP    i32 (i32.const 6))
(global $T_MILE   i32 (i32.const 7))
(global $T_K      i32 (i32.const 8))

;; Column indices into $T_K.
(global $K_START_CASH    i32 (i32.const 0))
(global $K_START_STORAGE i32 (i32.const 1))
(global $K_TRUCK_CAP     i32 (i32.const 2))
(global $K_START_GRID    i32 (i32.const 26))

;; Value at (row, col) of table $tbl.
(func $bal (param $tbl i32) (param $row i32) (param $col i32) (result i32)
  (local $desc i32)
  (local.set $desc (i32.add (global.get $R_BAL) (i32.shl (local.get $tbl) (i32.const 2))))
  (i32.load16_u
    (i32.add
      (i32.add (global.get $R_BAL) (i32.load16_u (local.get $desc)))
      (i32.shl
        (i32.add
          (i32.mul (local.get $row) (i32.load16_u offset=2 (local.get $desc)))
          (local.get $col))
        (i32.const 1)))))

(func $k (param $col i32) (result i32)
  (call $bal (global.get $T_K) (i32.const 0) (local.get $col)))

;; Descriptor table @ 0x6000: per table id, u16 offset from 0x6000, u16 column count.
(data (i32.const 0x6000)
  "\40\00\07\00" ;; 0 CROP: +0x40, 7 cols
  "\86\00\03\00" ;; 1 GOOD: +0x86, 3 cols
  "\d4\00\06\00" ;; 2 BLD: +0xd4, 6 cols
  "\4c\01\05\00" ;; 3 RECIPE: +0x14c, 5 cols
  "\9c\01\05\00" ;; 4 MKT: +0x19c, 5 cols
  "\ba\01\01\00" ;; 5 LAND: +0x1ba, 1 cols
  "\c2\01\01\00" ;; 6 REP: +0x1c2, 1 cols
  "\cc\01\01\00" ;; 7 MILE: +0x1cc, 1 cols
  "\da\01\1c\00" ;; 8 K: +0x1da, 28 cols
)

;; T_CROP (id 0) @ +0x40: seed growDays yield regrowDays spoilDays seasonMask good
(data (i32.const 0x6040)
  "\0a\00\03\00\04\00\00\00\00\00\07\00\00\00" ;; Wheat: 10 3 4 0 0 7 0
  "\0c\00\04\00\05\00\00\00\00\00\06\00\01\00" ;; Corn: 12 4 5 0 0 6 1
  "\0f\00\03\00\06\00\00\00\02\00\03\00\02\00" ;; Tomato: 15 3 6 0 2 3 2
  "\28\00\08\00\08\00\03\00\00\00\07\00\03\00" ;; Apple: 40 8 8 3 0 7 3
  "\1e\00\06\00\05\00\00\00\03\00\06\00\04\00" ;; Grape: 30 6 5 0 3 6 4
)

;; T_GOOD (id 1) @ +0x86: basePrice perishDays tier
(data (i32.const 0x6086)
  "\08\00\00\00\00\00" ;; Wheat: 8 0 0
  "\07\00\00\00\00\00" ;; Corn: 7 0 0
  "\0a\00\02\00\00\00" ;; Tomato: 10 2 0
  "\0c\00\00\00\00\00" ;; Apple: 12 0 0
  "\0f\00\03\00\00\00" ;; Grape: 15 3 0
  "\16\00\00\00\01\00" ;; Flour: 22 0 1
  "\12\00\00\00\01\00" ;; Cornmeal: 18 0 1
  "\28\00\00\00\01\00" ;; Sauce: 40 0 1
  "\1e\00\06\00\01\00" ;; AppleJuice: 30 6 1
  "\26\00\04\00\01\00" ;; GrapeJuice: 38 4 1
  "\23\00\03\00\02\00" ;; Bread: 35 3 2
  "\1c\00\03\00\02\00" ;; Cornbread: 28 3 2
  "\78\00\00\00\02\00" ;; Wine: 120 0 2
)

;; T_BLD (id 2) @ +0xd4: cost upkeep inputCap storageBonus unlockKind unlockArg
(data (i32.const 0x60d4)
  "\fa\00\03\00\08\00\00\00\00\00\00\00" ;; Mill: 250 3 8 0 0 0
  "\90\01\04\00\09\00\00\00\00\00\00\00" ;; Cannery: 400 4 9 0 0 0
  "\5e\01\04\00\08\00\00\00\00\00\00\00" ;; Press: 350 4 8 0 0 0
  "\58\02\05\00\06\00\00\00\01\00\00\00" ;; Bakery (owns Mill): 600 5 6 0 1 0
  "\84\03\06\00\00\00\00\00\02\00\03\00" ;; Cellar (rep rank 3): 900 6 0 0 2 3
  "\2c\01\02\00\00\00\28\00\00\00\00\00" ;; Warehouse: 300 2 0 40 0 0
  "\f4\01\05\00\00\00\14\00\02\00\02\00" ;; ColdStore (rep rank 2): 500 5 0 20 2 2
  "\c2\01\04\00\00\00\00\00\03\00\29\00" ;; Greenhouse (day 41 = Y1 Autumn): 450 4 0 0 3 41
  "\c8\00\01\00\00\00\00\00\00\00\00\00" ;; Well: 200 1 0 0 0 0
  "\f4\01\03\00\00\00\00\00\00\00\00\00" ;; Garage: 500 3 0 0 0 0
)

;; T_RECIPE (id 3) @ +0x14c: building inGood inQty outGood ageDays
(data (i32.const 0x614c)
  "\00\00\00\00\02\00\05\00\00\00" ;; Mill: 2 Wheat -> Flour: 0 0 2 5 0
  "\00\00\01\00\02\00\06\00\00\00" ;; Mill: 2 Corn -> Cornmeal: 0 1 2 6 0
  "\01\00\02\00\03\00\07\00\00\00" ;; Cannery: 3 Tomato -> Sauce: 1 2 3 7 0
  "\02\00\03\00\02\00\08\00\00\00" ;; Press: 2 Apple -> Apple Juice: 2 3 2 8 0
  "\02\00\04\00\02\00\09\00\00\00" ;; Press: 2 Grape -> Grape Juice: 2 4 2 9 0
  "\03\00\05\00\01\00\0a\00\00\00" ;; Bakery: Flour -> Bread: 3 5 1 10 0
  "\03\00\06\00\01\00\0b\00\00\00" ;; Bakery: Cornmeal -> Cornbread: 3 6 1 11 0
  "\04\00\09\00\01\00\0c\00\05\00" ;; Cellar: Grape Juice -> Wine, 5 days: 4 9 1 12 5
)

;; T_MKT (id 4) @ +0x19c: multRawBp multProcBp travelDays satPerUnitBp recoverBp
(data (i32.const 0x619c)
  "\40\1f\40\1f\00\00\c8\00\10\27" ;; Stand: 8000 8000 0 200 10000
  "\10\27\10\27\01\00\96\00\88\13" ;; Town: 10000 10000 1 150 5000
  "\70\17\b0\36\02\00\64\00\48\0d" ;; City: 6000 14000 2 100 3400
)

;; T_LAND (id 5) @ +0x1ba: ringCost
(data (i32.const 0x61ba)
  "\58\02" ;; 5x5: 600
  "\78\05" ;; 6x6: 1400
  "\b8\0b" ;; 7x7: 3000
  "\70\17" ;; 8x8: 6000
)

;; T_REP (id 6) @ +0x1c2: pointsForRank
(data (i32.const 0x61c2)
  "\00\00" ;; rank 1: 0
  "\03\00" ;; rank 2: 3
  "\08\00" ;; rank 3: 8
  "\0f\00" ;; rank 4: 15
  "\19\00" ;; rank 5: 25
)

;; T_MILE (id 7) @ +0x1cc: payout
(data (i32.const 0x61cc)
  "\64\00" ;; first processed good: 100
  "\c8\00" ;; $2,000 net worth: 200
  "\c8\00" ;; 3 contracts: 200
  "\f4\01" ;; survive Y1 >= $3,000: 500
  "\2c\01" ;; reputation rank 3: 300
  "\e8\03" ;; sell 10 Wine: 1000
  "\00\00" ;; $50,000 net worth (run complete): 0
)

;; T_K (id 8) @ +0x1da: 1 row x 28 scalars
(data (i32.const 0x61da)
  "\f4\01" ;; startCash = 500
  "\1e\00" ;; startStorage = 30
  "\14\00" ;; truckCap = 20
  "\c2\01" ;; truckPrice = 450
  "\03\00" ;; maxTrucks = 3
  "\2c\01" ;; truckCapUpgCost = 300
  "\14\00" ;; truckCapUpgAmt = 20
  "\02\00" ;; truckCapUpgMax = 2
  "\90\01" ;; fridgeCost = 400
  "\f4\01" ;; fastCost = 500
  "\dc\05" ;; loanMax = 1500
  "\64\00" ;; loanRateBp = 100
  "\03\00" ;; graceDays = 3
  "\14\00" ;; daysPerSeason = 20
  "\f0\00" ;; runDays = 240
  "\40\1f" ;; bldUpgPctBp = 8000
  "\f4\01" ;; driftStepBp = 500
  "\58\1b" ;; driftMinBp = 7000
  "\c8\32" ;; driftMaxBp = 13000
  "\88\13" ;; satFloorBp = 5000
  "\98\3a" ;; contractMultBp = 15000
  "\e8\03" ;; latePenaltyBp = 1000
  "\50\c3" ;; netWorthTarget = 50000
  "\88\13" ;; netWorthBldBp = 5000
  "\88\13" ;; netWorthLandBp = 5000
  "\0a\00" ;; cellarHold = 10
  "\04\00" ;; startGrid = 4
  "\08\00" ;; maxGrid = 8
)

