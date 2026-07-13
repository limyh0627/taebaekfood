# DB 변경 기록 (Firestore: taebaek-3abe4)

> 운영 Firestore에 직접 가한 변경을 시간순으로 기록합니다. **DB를 건드린 사람/에이전트는 반드시 여기에 추가하세요.**
> 코드 변경은 git 히스토리로 추적되므로 여기엔 **데이터(문서) 변경만** 적습니다.

---

## 2026-06-17 — 누락 입고 백필 (인천)청정식품 깨분참기름 20캔

**작업자:** Claude 에이전트 (사용자 chdwp 요청)
**사유:** 06-17 선입고 시 Firebase 일일 한도(429)로 로트/수불부 기록 트랜잭션이 실패(전표는 생성됨, 원료는 누락). 한도 회복 후 수동 백필.
**스크립트:** `scripts/backfill-cheongjeong-260617.mts` (되돌리기: `--undo`, 백업 `scripts/backfill-cheongjeong-backup.json`)

| 문서 | 변경 |
|---|---|
| `raw-깨분참기름` | `lots` += (인천)청정식품 330kg(20캔×16.5, lotNo 260617-01), `stock` 2779 → 3140.165 L |
| `rawMaterialLedger/rm-backfill-cheongjeong-20260617` | +330kg 입고 기록 신규 |

**관련 코드 수정(미배포):** 입고 시 원료 로트/수불부 기록 실패가 조용히 삼켜지던 것 → 사용자에게 경고창 표시(ReceivingReturnsManager 스캔·선입고 경로). 재발 시 즉시 인지 가능하도록.

---

## 2026-06-15 — 원료 로트(lot) 시스템 도입

**작업자:** Claude 에이전트 (사용자 chdwp 요청)
**관련 코드:** `RawMaterialLot` 타입, `mutateRawMaterialLots`, 입고 핸들러 로트 연동, 원료재고 로트 UI (로컬 브랜치, 미배포)
**스크립트:** `scripts/lot-migration.mts` (되돌리기: `npx tsx scripts/lot-migration.mts --undo`)
**백업:** `scripts/lot-migration-backup.json` (변경 전 stock/lots 원본)

### 스키마 추가 (items 컬렉션, 코드 레벨 — 기존 문서엔 점진 적용)
- `lots?: RawMaterialLot[]` — 원료(raw) 품목의 입고 로트 배열. 배열 순서 = 선입선출 순서.
- `packageType?: string` / `packageKg?: number` — 매입 SKU 포장 단위(캔/포대/자루)·1개당 kg.
- `RawMaterialLot` 구조: `{ id, supplierId?, supplierName, packageType?, packageKg?, qtyIn?, kgIn, kgRemaining, receivedDate, lotNo?, status: 'active'|'depleted', poId?, createdAt }`. 잔여는 항상 **kg**(canonical), 기름은 화면에서 L로 환산 표시.

### 데이터 변경 (4건, 위 스크립트로 적용)
| 문서 ID | 품목 | 변경 | 비고 |
|---|---|---|---|
| `p-1779251176421` | 참깨 (raw) | `lots` += 이월 5170kg | stock 5170 유지 |
| `raw-깨분참기름` | 깨분참기름 (raw) | `lots` += 이월 1137.672kg | stock 1242 L 유지 (1242×0.916) |
| `raw-생들기름` | 생들기름 (raw) | `lots` += 이월 33.264kg | stock 36 L 유지 |
| `p-1779251603644` | 깨분참기름/16.5kg (wip, 캔 SKU) | `stock` 176 → **0** | 차감 안 되던 누적 카운터 정리 |

- "이월" 로트 = 마이그레이션 시점의 기존 재고를 로트로 보존(수불부 잔량 이월). **재고 수치는 안 바뀜**, 로트로 보이게만 함.
- 캔 SKU(p-1779251603644)는 발주/입고용 SKU로 유지하되, 의미 없는 누적 재고만 0으로 정리. 이후 입고분은 코드가 자동으로 원료(raw) 로트로 기록(매입 SKU stock은 더 이상 누적 안 함).

### 확인 완료
- **깨분참기름 풍회유통 6/15 입고 68캔**: 사용자 확인 결과 이월 1,242L에 **이미 포함**됨 → 별도 풍회 로트 추가 불필요. (이월 1건으로 충분)

### 이전 작업 (읽기 전용 — DB 미변경)
- `scripts/diagnose-punghoe*.mjs`, `scripts/check-raw-purchasing-skus.mjs`, `scripts/lot-migration.mts --dry`, `scripts/verify-lots.mjs` — 전부 **조회만** 함. 쓰기 없음.

## 2026-07-02 — 매입 SKU 원료 연결 (rawMaterialName 지정)

실행: `node scripts/set-raw-material-name.mjs` (사용자 요청). 이름 변경 대신 rawLotTarget이 우선 참조하는 필드 지정.

| 문서 ID | 품목 | 변경 | 비고 |
|---|---|---|---|
| `p-108` | 시골향 볶음검정참깨-벌크/20kg (product) | `rawMaterialName` = "볶음검정참깨" | 입고 시 개수×20kg → 원료 로트 |
| `p-1780646377919` | 볶음참깨-자루/20kg (product) | `rawMaterialName` = "볶음참깨" | 입고 시 개수×20kg → 원료 로트 |

- 6/29~7/1 로트 소실 사고 복구(restore-lots-260702.mjs)는 **사용자 보류 중** — 아직 미실행.

## 2026-07-09 — 들향기름골드 기본 박스 수량 12 → 10

**작업자:** Claude 에이전트 (사용자 chdwp 요청)
**사유:** 들향기름골드 1박스가 실제 10개인데, 품목에 박스 규격이 없어 향미유 코드 폴백(12)이 적용되고 있었음.
**스크립트:** `scripts/set-deulhyang-gold-box10.mjs` (되돌리기: `--undo` → 필드 삭제, 폴백 12 복귀)

| 문서 | 변경 |
|---|---|
| `items/f6` (들향기름골드, goods) | `defaultBoxConfig` 없음(null) → `{ boxType: "", unitsPerBox: 10 }` |

- 거래처별 오버라이드(shipping_rules·partner_item qtyPerBox) 0건 확인 → 전 거래처 일괄 10개 적용.
- 기존 주문 문서는 저장 당시 값(12) 유지 — 과거 이력 불변.
