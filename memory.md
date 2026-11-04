# 태백 ERP 정리 메모 (2026-11-04)

오늘 Claude와 정한 것과 확인한 사실. 결정은 "정함", 미룬 것은 "보류"로 적는다.

> **방향 (2026-11-04 12:35 정함): 범용 ERP를 Supabase로 새로 만들고, 태백도 그리로 옮긴다.**
> - 원장은 **실제 원장 하나**. 서류용 원장(`rawDocEntries`)·서류 원료 묶음(`RAW_DOC_MERGE`)은 ERP에서 뺀다.
> - **서류 자동 작성**(원료수불부·생산판매기록부·생산작업기록부)은 **구독에서 고르는 기능**이고, 실제 원장·생산 실적·출고 기준으로 만든다.
> - **HACCP는 회사 설정으로 켜고 끈다.** 켜면 HACCP 점검 기록이 열리고 서류에 원료 로트를 표시한다(로트는 실제 원장에 있음).
> - **태백은 서류 자동 작성을 끄고**, ERP에서 기간별 출고·입고·생산을 **내보내서 외부에서 서류를 작성·보관**한다. 그래서 본체에 데이터 내보내기(엑셀·CSV) 기능이 필요하다.
> - 아래 2장의 구조 변경은 Firestore에서 단계별로 하지 않고 새 ERP에서 바로 만든다. 오늘 ERD(54개)가 출발점. 지금 Firestore에서는 성능 배포 등 당장 불편한 것만 한다. 보안 두 가지는 이전 후 새 구조에서 해결.
> - 저장소의 `판매용-ERP-분리-설계.md`(코드 한 벌 + 고객사별 Firebase)는 이 방향으로 대체된다.

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
| `accountCodes`, `accountGroups` | `accounts` (`parentId` 계층, 손익·현금흐름 구분은 상위에서 물려받음). 표준 계정과목 이전 계획과 함께 |
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
- `rawDocEntries`(서류용 원장)는 **새 ERP에 넣지 않는다**(맨 위 방향 참고). 태백은 외부에서 서류 작성.
- `orders`: 겹친 재고 상태 필드 15개 안팎 삭제, 줄별 `producedQty`·`shippedQty`만. 파렛트는 `pallets[].itemId`. 포털 주문은 `portalAccountId`.
- `employees`: 급여 조건 `pay`(기본급·고정 수당·보험·원천세 기준) 추가. **급여대장(`payrolls`)은 별개 서류**로 매달 이 값을 기본으로 확정, 확정 시 전표 1장. 급여명세서는 대장 줄을 출력(따로 저장 안 함).
- `cashAccounts`(자금 계좌), 대출, 세금계산서 등은 그대로.
- **발주(`purchaseOrders`)와 반품 요청(`returnRequests`)은 합치지 않는다.** 모양(거래처·품목 줄·상태)은 비슷하지만 흐름과 고유 칸이 다르다(발주: 일반·OEM, 입고·가공비 / 반품: 매출·매입, 원래 주문·반제). 주문(`orders`)을 따로 두는 것과 같은 이유. 대신:
  - 주문 출고·발주 입고·OEM 입고·반품 처리의 "품목 줄 → 실제 원장 + 전표" 처리를 함수 하나로 공통화
  - 주문·발주·반품의 품목 줄 모양 통일(`itemId`, 수량, 단위, 단가)
  - 발주 맨 위의 단일 품목 시절 칸(`itemId`, `itemName`, `quantity`, `unit`) 삭제, `items[]`만

### 관청 서류 세 가지 (태백 현재 방식 — 새 ERP에서는 위 방향으로 대체)
- **원료수불부·생산판매기록부·생산작업기록부는 같은 근거로 만든다.** 날짜는 생산판매기록부에서 고른 날짜, 생산은 그날 출고분을 양식대로 모은 값, 원료 사용은 그 수량 × 서류 배합비(서류 원료 탭 기준). 계산은 `docOil.ts` 한 곳.
- 지금 새 생산작업기록부(`productionWorkDocumentRepository.ts`)는 **실제 원장의 원료 차감 줄을 읽는다** → 원료수불부와 양·날짜가 어긋날 수 있다. 서류 기준으로 바꿔야 한다. (주문·원장 전체를 매번 읽어 느리기도 함)
- 생산판매기록부의 왼쪽 "생산"도 판매 수량을 양식(코드 상수 `topTemplate`, 20·25kg → 1kg 환산 규칙)에 맞춰 모은 값.
- **태백은 HACCP 인증 업체가 아니다.** 생산작업일지에서 **원료 로트 칸은 뺀다.** 원료 추적이 필요하면 실제 원장의 실물 로트 기록으로 한다. 제품은 제조일·소비기한을 그대로 적는다.
- 법령상 생산·작업 기록과 원료수불 서류는 작성 후 최종 기재일부터 3년 보관(영등포구 보건소 안내). 기재 항목·로트 의무는 확인 안 됨.
- 서류에서 로트별 수량을 따로 깎지 않는다(실제 원장과 반드시 틀어짐).

### ERD 배치 (흐름 중심)
- 위: 기준정보, 조직·인사 / 가운데: 주문·출고 → 생산(작업지시 → 생산 실적) → 재고(실제 원장) → 회계·자금(전표) / 아래: 반품, 구매·OEM, 서류·품질 / 맨 아래: 협업, 처리 기록·시스템
- 생산작업기록부·기록부 줄·생산판매기록은 생산이 아니라 **서류·품질** 묶음(원료수불부와 같은 숫자를 쓰는 관청 서류, `docOil.ts`)
- 줄 안의 연결(`lines[].partnerId`, `lines[].accountCode`)도 선으로 표시

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

- **[보안, 이전 후] 포털이 거래처 계정을 쓰지 않는 문제** — 거래처 코드만 알면 그 거래처로 주문 가능. 로그인한 포털 계정의 `partnerId`로 거래처를 정하고, 그 거래처 품목·주문만 보이게.
- **[보안, 이전 후] 직원 비밀번호 해시가 직원 문서에 있음** — 같은 회사 직원이면 누구나 직원 문서 전체(`passwordHash` 포함)를 읽을 수 있다(`firestore.rules`의 `readOk`). 새 DB에서는 계정(아이디·해시)을 앱이 못 읽는 별도 표로. 직원 로그인은 `functions/src/employeeLogin.ts`(아이디 → 해시 대조 → `authUid`로 Firebase 토큰).
- 회사이체 권한을 직원 문서로 옮기기
- 급여 변경 이력(`payHistory`)을 둘지
- 서류용 배합비가 코드 상수 `PRODUCT_FORMULA`에 따로 있는 것 — 배합 표와 맞춰도 되는지 확인 필요
- 현금흐름 수기(`cashFlowManual`) — 실제로 쓰는지 확인 후 삭제 후보

## 5. 다음에 할 일

- [ ] 배포 워크플로로 `perf/batch-reads`의 `orderProductionBatchCommand` 배포 결과 확인 → 성공하면 DB-CHANGELOG 기록, `perf/batch-reads`를 main에 병합
- [ ] 배포 후 `orderProductionBatch timing` 로그로 처리 시간 비교
- [ ] 가능하면 PC에서 에뮬레이터 시험: `PARTIAL_BATCH_EMULATOR=true npx vitest run functions/src/orderProductionBatchCommand.emulator.test.ts` (포트 8283)
- [x] DB 이전 대상 → **Supabase**(서울, 무료 플랜으로 시험). 시험 이전·새 앱 시작 (아래 6장)
- [ ] 이전이 몇 달 이상이면, Firestore에서 "주문 처리가 주문 품목·하위 BOM만 읽기"만 먼저 할지 결정

---

## 6. 새 ERP (erp-core) 진행 — 2026-11-04

- 저장소 `limyh0627/erp-core`(React + Supabase), 화면 https://erp-core-ten.vercel.app (Vercel, main 올리면 자동 배포)
- 시험 이전: 이 저장소 `supabase-trial` 브랜치의 `supabase/sql` + 워크플로 **Supabase trial import**
  (Firestore는 읽기만. "Firestore 복사는 건너뛰고"면 변환·대조만 다시). 태백+풍회 22MB → 무료 플랜 충분.
- erp-core의 `supabase/*.sql`(access·orders·stock·accounting)이 원본이고, 이 저장소 `026~029_*.sql`은 복사본.
- **정함/확인함**
  - 원료 원장 이관은 앱 잔량 규칙대로: 원자화 줄(balanceAfterKg)만 잔고, 옛 줄은 이력, 원료마다 '이관 기준' 한 줄 → 18개 원료 모두 현재 재고와 일치.
  - 원료 외 품목은 지금 수량을 '기초'로, 입고·박스 해체·파렛트 이력은 잔고에 안 넣는다.
  - 기름은 **DB는 kg, 화면은 L 병기**(밀도 0.916/0.924). 입력은 L로 받아 kg으로 바꾼다.
  - 쓰기는 DB 함수로만(한 함수 = 한 트랜잭션): 주문 저장·출고 확정(재고 차감+매출 전표)·출고 취소, 입고·사용·폐기·실사, 생산(BOM·phantom 배합 전개, 모자란 낱개 먼저 생산), 입금·출금.
  - 분개는 저장하지 않고 전표에서 뷰로 만든다(앱 autoJournal 규칙). **거래처 잔액이 태백 앱과 일치 확인**(사용자, 15:11).
  - 원료가 모자라도 생산은 막지 않고 경고 + 음수.
- **남은 것**: 수금을 명세서에 맞춰 정리(반제), 매입·발주 입고, 세금계산서, 급여, 서류 내보내기(태백), 원료 로트, 거래처 포털, 파일(Firebase Storage → Supabase Storage).
- 고아 데이터(원본에서 이미 끊김): 거래처-품목 40, 주문 3, 생산기록 1, 정산 1, 채팅 29, 배합 '깨분' 1.
