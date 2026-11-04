# 태백 ERP 정리 메모 (2026-11-04)

오늘 Claude와 정한 것과 확인한 사실. 결정은 "정함", 미룬 것은 "보류"로 적는다.

- 설계안 문서: https://claude.ai/artifact/8SgWX4ikVNeZxWQA3ebHEg
- 전체 ERD: https://claude.ai/artifact/KSXVUeJZwBiFQz5bzfv6nV
- 작업 브랜치: `perf/batch-reads` (main에 아직 안 합침)

---

## 1. 주문 처리 지연

### 원인 (코드 확인)
- 생산 완료·출고 서버 함수 `orderProductionBatchCommand`가 요청마다 회사 품목 전체(`items`·`item_bom`·`item_pack`·`item_formula`, 품목 1,606·BOM 1,029건)를 트랜잭션 안에서 읽고, 원문째 압축 보관했다가 다시 대조한다.
- 그 근거 문서들을 `for … await tx.get`으로 한 건씩 읽어 문서 수만큼 왕복이 생겼다.
- 같은 주문의 이전 생산 요청을 매번 전부 재검증한다(요청이 쌓인 주문일수록 느림, 모란식품 13초).
- open → prepare → inspect → apply 4번 왕복, 단계마다 위 검증 반복.
- 전체를 읽는 이유: 원료·배합이 **이름**으로 연결돼 있고(`rawHolderByName`, `parent_key`/`child_name`), 원료 이름 중복·박스 입수 충돌 같은 회사 전체 정합성 검사를 처리 때마다 한다.

### 0단계 수정 (정함, `perf/batch-reads`에 푸시)
- 한 건씩 읽던 곳을 `getAll` 묶음 읽기로(`functions/src/shared/batchReads.ts`), 범위 쿼리는 20개씩 병렬.
- 읽는 문서·검증 순서·오류는 그대로, 왕복 수만 줄임. 새 시험 8건 통과, 기존 실패 14건은 얕은 클론 탓(수정 전과 동일).
- `minInstances: 1`은 **뺐다**: 서울(Tier 2) 기준 월 3~4만 원 고정비, 효과는 첫 요청 기동 대기뿐.
- **아직 확인 안 함:** 실제 Firestore 에뮬레이터 시험(이 환경에서 내려받기 차단). 배포 결과도 아직 못 들음.

### 배포 방법 (정함)
- GitHub Actions 워크플로 `.github/workflows/deploy-function.yml` (main에 있음).
- 실행: Actions → "Deploy one function" → Run workflow → Use workflow from은 `main` 그대로, **배포할 브랜치** 칸에 브랜치 이름, 함수 이름 입력. 비용이 늘어나는 변경일 때만 체크칸 체크.
- Secret: `FIREBASE_FUNCTIONS_DEPLOY_SA` (서비스 계정 `functions-deployer`).
- 서비스 계정 역할: Cloud Functions 관리자, 서비스 계정 사용자, Service Usage 소비자, Artifact Registry 리더, Firebase 뷰어, 보안 비밀 관리자 뷰어.
- Claude 작업 공간에서는 GitHub Actions API와 Google Cloud 주소가 막혀 있어 Claude가 직접 실행·확인할 수 없다.

---

## 2. 데이터 구조 정리 (정함, 단계별로 진행)

### 원칙
- 안전 기준: 원문 대조가 아니라 **트랜잭션 + 되돌릴 수 있는 기록**.
- 연결은 이름이 아니라 **ID**로. 정합성 검사는 **저장할 때**.
- 재고는 **실제 원장 한 곳**. 취소는 지우지 않고 반대 줄(역분개).
- 같은 요청 두 번은 한 번: `commandId`.
- 이름: 문서 하나가 무엇인지 나타내는 **camelCase 복수형 명사**. 발행·대기 같은 상태/동작은 필드에. `V1` 같은 버전 꼬리 금지.
- 코드: 한 줄 압축 금지, 시험은 동작 기준(옛 코드와 모양 같은지 보는 시험 금지).

### 새로 / 합침
| 지금 | 바뀐 뒤 |
| --- | --- |
| `rawMaterialLedger`, `rawInventories`, 품목의 재고 필드 | `stockLedger`(실제 원장) · `stockBalances` · `lots` |
| `productionRecords` | `productionRuns` |
| 처리 기록 약 22개(`*Operations`, `*Receipts`), 생산 예약·색인 | `commands` (`kind`) |
| `issuedStatements`, `cashEntries`, `settlements`, `returnApplications` | `vouchers` (전표 하나, 반제 `applies`) |
| `fixedCostTemplates`, `expensePresets` | `voucherTemplates` |
| `openingBalances`, `partnerBalanceSnapshots` | `balanceSnapshots` (`kind`: opening 기초 · closing 결산) |
| `pallets`, `palletTransactions` | `items`(`type: PALLET`) + `stockLedger`(지급·회수에 `partnerId`) |
| `itemReceipts`, `itemUnpackMovements` | `stockLedger` |
| `orderStatusAudits`, `orderItemEdits`, `deliveryScheduleAudits` | `orderHistory` (`kind`) |
| `haccp_*` 7개 + 양식 | `haccpRecords` (`type`) + `haccpTemplates` |
| `fileCabinetCategories`, `fileCabinetSubCategories`, `fileCabinetDocs` | `fileCategories`(`parentId`) · `files` |
| `item_pack`, `item_purchase_unit` | `itemUnits` (`kind`) |
| 코드 상수 `RAW_DOC_MERGE` | `docMaterials` (원료수불부 탭 → 원료 품목 ID) |
| `retirementProfiles` | `employees.retirement` |
| `leaveRequests`, `retirementEvents` | 직원 하위 컬렉션 `employees/{직원}/…` |

### 삭제 (코드에서 쓰는 곳 없음, 지우기 전 문서 수 확인·백업)
- `stockClosings`, `sesameInputLedger`, `fixedCosts`

### 이름만 바꿈
- `taxIssueRecords` → `taxInvoices` (세금계산서·계산서 한 장 = 전표 여러 장 묶음, 따로 유지)
- `pendingStatementEdits` → `voucherEditRequests`
- `users` → `partnerAccounts` (**직원이 아니라 거래처 포털 계정**)
- `partner_item`·`item_bom`·`item_formula` → `partnerItems`·`itemBoms`·`itemFormulas`
- `workProjectsV1` → `workProjects`, `appMeta` → `counters` (+ `settings`)

### 그대로 / 필드만 변경
- `itemFormulas`(배합)는 **BOM과 합치지 않는다.** 등급·서류 품목 단위 비율이라 키(`parent_key`)는 그대로, 원료 쪽만 `childItemId`로. 차감은 비율×수율, 원가는 수율로 나눔.
- `rawDocEntries`(서류용 원장)는 별도 유지. `material`(원료 이름) → `docMaterialId`. 입고는 실제 원장에서, 사용량은 배송완료 판매에서 배합비로 되계산.
- `orders`: 겹친 재고 상태 필드 15개 안팎 삭제, 줄별 `producedQty`·`shippedQty`만. 파렛트는 `pallets[].itemId`. 포털 주문은 `portalAccountId`.
- `employees`: 급여 조건 `pay`(기본급·고정 수당·보험·원천세 기준) 추가. **급여대장(`payrolls`)은 별개 서류**로 매달 이 값을 기본으로 확정, 확정 시 전표 1장. 급여명세서는 대장 줄을 출력(따로 저장 안 함).
- `cashAccounts`(자금 계좌), 대출, 세금계산서 등은 그대로.

### 진행 단계
0. (완료) 묶음 읽기
1. 읽기 범위 축소 + ID 연결 필드 채우기 + 정합성 검사 저장 시점으로 + 안 쓰는 3개 삭제 + 코드·화면 이름 정리 + 직원 급여 조건
2. 미리보기 → 확정 새 처리 명령, `stockLedger`·`stockBalances`·`lots`·`productionRuns`·`commands` 기록 시작, 파렛트 이관, 기존과 나란히 운영
3. 옛 재고 필드·컬렉션 정리, 각종 합치기, 연차·퇴직금 직원 밑으로
4. 실제 컬렉션 이름 바꾸기 (Firestore는 이름 변경이 없어 복사 → 코드·규칙·인덱스 → 정리)
5. 전표 통합(`vouchers`). 몇 달 나란히 운영하며 시산표·거래처 잔액 대조 (`buildJournals.ts`가 그 대조용)

---

## 3. 코드에서 확인한 사실

- **원장 두 개**: 실제 원장(`rawMaterialLedger`, 실제 차감 시점, 등급 단위, 관청 제출 안 함)과 서류용 원장(`rawDocEntries`, 원료수불부용, 판매에서 되계산, 실제 원장에서는 입고만 읽음). 설명은 `src/shared/docOil.ts` 맨 위.
- **임가공 원료**: OEM 발주(원료 보낼 때) 실제 원장 `consume`으로 재고 차감(`oemIssueJob.ts`) → 가공입고로 완제품 입고 → 임가공 품목 생산 처리 때는 `ledger-consume`으로 기록만(재고 변화 0). 같은 원료를 한 번만 깎으므로 원장과 재고가 맞는다. 새 구조에서는 `stockEffect: false`. OEM 발주 없이 임가공 생산하면 재고가 안 줄어드는 위험 → 확정 때 경고.
- 완제품 재고는 지금 이력이 없다(`items.stock` 숫자만 덮어씀, 이력은 주문에만).
- 분개는 저장하지 않고 명세서·자금 전표·기초 잔액·월말 재고 평가에서 계산한다(`buildJournals.ts`).
- 기초 잔액은 **계정별**(현금·재고·자산·대출·자본 포함, 외상 계정만 `partnerId`)이라 거래처 테이블에 넣을 수 없다.
- `companyTransferGrants`는 "이관 승인"이 아니라 **회사이체(태백↔풍회) 권한**. uid별 문서.
- **거래처 포털**: 포털은 거래처 **코드 입력**으로 주문(`WEB-`)을 받고, 가입·승인한 `users`(+`linkedPartnerId`)는 읽지 않는다. 코드만 알면 누구든 그 거래처로 주문 가능, 넣은 사람도 안 남음.

---

## 4. 보류 (냅두기로 한 것)

- **[보안] 포털이 거래처 계정을 쓰지 않는 문제** — 데이터 정리와 별개로 먼저 고칠 것. 로그인한 포털 계정의 `partnerId`로 거래처를 정하고, 그 거래처 품목·주문만 보이게.
- `rawDocEntries` → `docLedger` 이름 변경
- 계정과목 + 계정 묶음 → `accounts`(`parentId` 계층) 통합. 하게 되면 PC의 "표준계정과목-이전계획"과 한 번에.
- 회사이체 권한을 직원 문서로 옮기기
- 급여 변경 이력(`payHistory`)을 둘지
- 서류용 배합비가 코드 상수 `PRODUCT_FORMULA`에 따로 있는 것 — 배합 표와 맞춰도 되는지 확인 필요
- 현금흐름 수기(`cashFlowManual`) — 실제로 쓰는지 확인 후 삭제 후보

## 5. 다음에 할 일

- [ ] 배포 워크플로로 `perf/batch-reads`의 `orderProductionBatchCommand` 배포 결과 확인 → 성공하면 DB-CHANGELOG 기록, `perf/batch-reads`를 main에 병합
- [ ] 배포 후 `orderProductionBatch timing` 로그로 처리 시간 비교
- [ ] 가능하면 PC에서 에뮬레이터 시험: `PARTIAL_BATCH_EMULATOR=true npx vitest run functions/src/orderProductionBatchCommand.emulator.test.ts` (포트 8283)
- [ ] 1단계 착수 여부 결정
