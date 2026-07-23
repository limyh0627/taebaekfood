# DB 변경 기록 (Firestore: taebaek-3abe4)

> 운영 Firestore에 직접 가한 변경을 시간순으로 기록합니다. **DB를 건드린 사람/에이전트는 반드시 여기에 추가하세요.**
> 코드 변경은 git 히스토리로 추적되므로 여기엔 **데이터(문서) 변경만** 적습니다.

---

## 2026-07-23 — `manualAdjustment`(구 수동 휴가) → '휴가' 신청 기록 이관 후 필드 제거

**작업자:** Claude 에이전트 (사용자 요청)
**사유:** 단체 휴가를 직원 문서의 숫자 필드로 들고 있어 이력이 없고, 관리자·직원 앱이 서로 다른
이름('수동 차감' / '휴가')으로 불렀다. '휴가' 버튼이 실제 신청 기록을 만들게 되면서 필드가 중복이 됐다.
**스크립트:** `scripts/migrate-manual-to-vacation.mjs` (되돌리기 `--undo`, 백업 `migrate-manual-to-vacation-backup.json`)

| 직원 | 이관 |
|---|---|
| 아브라함 11.5 · 이지영 3 · 박은지 3 · 황준호 3 · 이총제 2 · 태백식품 1 · 남명숙 1 | → `leaveRequests/leave-legacy-vac-{empId}` (type `휴가`, `2026-01-01`, approved) |
| 이은경 · 윤찬호 (값 0) | 필드만 제거 |

- `employees.manualAdjustment` **전원 제거**(0명 남음). 코드에서도 타입·UI 전부 삭제.
- 언제 쓴 건지 기록이 없어 **올해 1월 1일자**로 남겼다(사유에 명시).
- **잔여 일수는 전원 변동 없음** — 이관 전후 검증 완료(박은지 14, 이지영 −6 등).

---

## 2026-07-17 — 외주가공비(540) 계정과목 신설

**작업자:** Claude 에이전트 (사용자 요청)
**사유:** OEM 가공입고 시 가공비 매입전표가 이 계정으로 끊긴다. 없으면 폴백으로 엉뚱한 곳에 집계됨.
**스크립트:** `scripts/add-oem-fee-account.mjs` (dry-run 기본, `--apply`, `--undo`)

| 문서 | 내용 |
|---|---|
| `accountCodes/ac-540` | `540 외주가공비` → `ag-cogs`(총매출원가). 임가공은 제조원가. 과세(세금계산서 수취) |

가공단가 기본값 **500원/kg** (푸미푸드 볶음) — 코드 상수 `OEM_DEFAULT_FEE_PER_KG`, 입고 시 변경 가능.

---

## 2026-07-17 — 볶음참깨 3품목 `완사입` → `임가공`(OEM) 전환

**작업자:** Claude 에이전트 (사용자 요청)
**사유:** 이 3품목은 남의 완제품을 사오는 게 아니라 **우리 참깨를 푸미푸드에 보내 볶아 오는** 것(임가공).
완사입으로 잡혀 있어 참깨가 외주로 나가는 게 기록되지 않고, 가공비와 완제품매입이 구분되지 않았다.
**스크립트:** `scripts/set-bokkeum-oem.mjs` (dry-run 기본, `--apply` 반영, `--undo` 되돌리기)

| 문서 | 변경 |
|---|---|
| `items/PLDhkjOgcPIhO1hhReHm` (볶음참깨-낱개/1kg) | `procureType` 완사입 → **임가공** |
| `items/p-1780625531675` (볶음참깨/10kg박스) | `procureType` 완사입 → **임가공** |
| `items/p-1780625559322` (볶음참깨/20kg박스) | `procureType` 완사입 → **임가공** |

- **판매 동작 변화 없음** — `isGoodsItem`이 완사입·임가공 둘 다 포함하므로 출고 시 자기재고 −N 그대로.
- 카테고리는 `product` 유지. 설계: `docs/OEM-임가공-설계.md`
- 외주공장 = **푸미푸드**. 발주·가공입고 핸들러/UI는 미구현(엔진만 있음).

**향후 방향(사용자 결정):** `category: 'goods'`(상품)를 없애고 `product` + `procureType: '완사입'`으로 통일.
지금은 `goods`와 `완사입`이 `isGoodsItem`에서 같은 동작이라 중복. 급하지 않아 나중에.

---

## 2026-07-14 — 회계 구조 정비 (자금원장 도입 · 계정과목 정리 · receivedAt 오용 수정)

**작업자:** Claude 에이전트 (사용자 요청)
**배경:** 전기세를 어느 전표로 끊느냐에서 출발해 회계 구조 전반을 정리. 상세는 `docs/복식부기-설계.md` 참고.

### 1) `issuedStatements` — 짠지네식품 매출전표 계정과목 채움
`stmt-1782894923495` (2026-07-01, 265만원) 5개 라인에 `accountCode: '800'`(일반매출) 설정.
7/1 이후 계정과목 누락 전표는 이제 0건.

### 2) `issuedStatements` — `receivedAt` → `taxIssuedAt` 이관 (8건)
`receivedAt`은 이름과 달리 **세금계산서 PDF 저장 시각**이 찍히고 있었다
(`TradeStatement.handleTaxPdf`가 `as any`로 잘못된 필드에 기록. 형제 핸들러는 `taxIssuedAt`을 쓰고 있었음).
매입전표 8건의 `receivedAt` → `taxIssuedAt`으로 복사 후 `receivedAt` 필드 삭제.
**진짜 입고 시각은 `PurchaseOrder.receivedAt`이 담당하며 건드리지 않았다.**

### 3) `accountCodes` — 정리
| 코드 | 변경 |
|---|---|
| `605 운임` | `groupId: 'ag-admin'`(판관비) 지정 — 그룹이 없어 폴백으로 엉뚱한 곳에 떨어지고 있었음 |
| `818 감가상각비` | `noncash: true` — 손익엔 잡히되 현금흐름표에서 순이익에 가산 |
| `535 퇴직급여충당금` | **신설** (`ag-cogs` 총매출원가, `noncash: true`). 급여(515)가 제조원가라 같은 그룹 |

**미해결:** `650 카드대금`의 `groupId`가 존재하지 않는 그룹을 가리킴(dangling).
계정과목이 아니라 결제수단이므로 자금원장의 '카드' 계좌로 대체하고 삭제하는 게 맞다.

### 5) `issuedStatements` — `partnerName` 백필 (29건)
4~5월 전표 29건에 `partnerName`이 비어 있었다(`partnerId`는 정상). 거래처원장에서 `(이름없음)`으로
뜨고 잔액이 쪼개져 보였다. `partnerId`로 `partners`를 조회해 이름을 채웠다.
**삭제 없음 — `partnerName` 필드만 채우는 비파괴 백필.** 29건 전부 성공, 건너뛴 것 없음.

가득찬식품 15건, 한국농수산물유통공사 5건, 형제프라콘 3건, 희성실업 2건, 기타 4건.
7월 이후 전표는 문제 없음(0건). 저장 로직은 그 사이 고쳐진 것으로 보인다.

> ⚠️ **주의:** `partners` 문서는 `addItem`이 `id` 필드를 떼고 저장하므로, 227건 중 125건만
> `id` 필드를 갖고 있다. **거래처 조회는 반드시 문서 ID(`doc.id`)로 해야 한다.**
> `p.id`로 조회하면 절반이 `undefined`가 되어 멀쩡한 거래처가 "유령"으로 보인다.

### 4) `cashAccounts` / `cashEntries` — 신규 컬렉션 + 임시 시딩
자금원장(현금출납장) 도입. **테스트용 임시 데이터이므로 앱에서 지우거나 실제 값으로 교체할 것.**

| 문서 | 내용 |
|---|---|
| `cashAccounts/cashacct-temp-main` | "임시 메인통장" (통장), 기초잔액 10,000,000원 / 기준일 2026-07-01 |
| `cashEntries/cash-seed-1` | 2026-07-05 입금 3,000,000 (짠지네식품, 계정 800) — 샘플 |
| `cashEntries/cash-seed-2` | 2026-07-09 출금 1,200,000 (한국전력공사, 계정 520) — 샘플 |

`settlements` 컬렉션도 신설(자금↔전표 매칭)되었으나 데이터는 아직 없음.

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

## 2026-07-13 — 안 쓰는 파레트 3종 숨김(hidden 플래그)

**작업자:** Claude 에이전트 (사용자 chdwp 요청 "전체 재고에서 삭제")
**사유:** 목재파렛트는 주문·거래 기록이 있어 문서 삭제 시 거래처 잔량 계산이 깨짐 → 삭제 대신 hidden 플래그로 화면·선택 목록에서만 제거(이력·잔량 계산 유지).
**스크립트:** `scripts/hide-unused-pallets.mjs` (되돌리기: `--undo`)

| 문서 | 변경 |
|---|---|
| `pallets/pal-wood` (목재파렛트) | `hidden: true` |
| `pallets/pal-plastic` (플라스틱파렛트) | `hidden: true` |
| `pallets/pal-black` (검정파렛트) | `hidden: true` |

## 2026-07-13 — 볶음참깨 재고 모델 재편 (박스 카운팅)

**작업자:** Claude 에이전트 (사용자 chdwp 확정안)
**사유:** 확인사항에 "1KG-볶음참깨(-770)"·"볶음참깨(0)" 이중 알림 — 완포장 사입품이 부자재(용기)로 잘못 모델링돼 유령 재고 누적. 박스 수 그대로 카운팅하는 모델로 재편.
**스크립트:** `scripts/migrate-bokkeum-model.mjs` (백업 `migrate-bokkeum-model-backup.json`, 되돌리기 `--undo`)

| 문서 | 변경 |
|---|---|
| `items/p-1780625531675` (볶음참깨/10kg) | stock 120→0(박스), `procureType:완사입`, `unpackTo:{낱개,10}`, spec 1kg→10kg, 옛 BOM 참조 제거 |
| `items/p-1780625559322` (볶음참깨/20kg) | stock 0(박스), 완사입, `unpackTo:{낱개,20}`, spec 1kg→20kg, 참조 제거 |
| `items/PLDhkjOgcPIhO1hhReHm` (낱개/1kg) | stock 20→0(팩), 완사입, 참조 제거 |
| `items/p-1779069467512` (스마트스토어/1kg) | 완사입 지정 |
| `items/p-1783918260605` (350g) | raw-볶음참깨 직접참조 제거(원료식으로 대체) |
| `items/p-1781770117874` (80g) | spec 140g→80g 오타 수정 |
| `items/p-1781739328648` | 이름 "볶음참깨"→"볶음참깨/500g" |
| `item_formula/formula-시골향볶음참깨-볶음참깨` | 신규 — 80/140/200/350/500g이 벌크(raw-볶음참깨)에서 spec 기준 kg 차감 |
| `items/PLYZ-S-1000` (1KG-볶음참깨) | archived, stock -770→0 (유령 재고 폐기) |
| `adjustmentRequests` 2건 | 유령 발주필요 알림 삭제 (1KG-볶음참깨 810개 / 볶음참깨 20개) |

- 재고 전부 0 시작 — 실사값은 사용자가 직접 입력 예정.

## 2026-07-13 — 볶음참깨 마무리 배선 (#2, 사용자 품목 정리 후)

**작업자:** Claude 에이전트 (사용자 요청)
**스크립트:** `scripts/wire-bokkeum-final.mjs` (백업 `wire-bokkeum-final-backup.json`, `--undo`)

| 문서 | 변경 |
|---|---|
| `items/PLDhkjOgcPIhO1hhReHm` (낱개/1kg) | `isSmartStore: true` — 삭제된 스마트스토어/1kg 품목 대체(낱개 재고로 통합) |
| `items/p-1779937553909` (볶음참깨(벌크)/20kg) | `rawMaterialName: 볶음참깨`, 자루 20kg — 자루 SKU 삭제로 끊긴 벌크 입고→로트 경로 복구 |
| `items/p-1780625531675`·`p-1780625559322` | spec 10kg/20kg 정정(표시용) |
