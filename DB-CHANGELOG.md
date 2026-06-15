# DB 변경 기록 (Firestore: taebaek-3abe4)

> 운영 Firestore에 직접 가한 변경을 시간순으로 기록합니다. **DB를 건드린 사람/에이전트는 반드시 여기에 추가하세요.**
> 코드 변경은 git 히스토리로 추적되므로 여기엔 **데이터(문서) 변경만** 적습니다.

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
