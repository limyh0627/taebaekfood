# 금융 쓰기 경로 지도 · 2026-10-08

기준: `d1cbf77bc65748367f67cabb0c7292a74126c02d`와 현재 미배포 후보가 섞인 checkout을 읽었다. 아래 줄 번호는 조사 시점이다. 최초 조사는 읽기 전용이었다. 이후 아래 후속 후보를 구현·검증했으며 운영 DB/gate 쓰기와 노션 쓰기는0이다. 현재 변경은 미배포 후보이고 이 문서는 전체 기능 완료 판정이 아니다.

사용자 최신 지시는 반품 외에도 낡은 쓰기·호출 경로를 새 경로 완성 후 제거하는 코드 정리다. 기존 자료 삭제와 별개다. 현금 전체 수정·삭제는 구현 담당이 작업 중이고, 원료 반품 서버 통합은 리드가 작업 중이다. 읽기 조사에 보인 후보를 실배포 기능으로 표시하지 않는다.

## 원본 직접 대조

- [022](https://app.notion.com/3e82cda7782b81f9a7d2f9da762f5a3d): 회사·날짜·접두사의 자금/발행 전표 공용 서버 카운터, 실패 미소비·동일 작업 번호 재사용, 각 화면 신규 `claimDocNo` 쓰기 치환, 구 writer 차단. 기존 번호·운영자료 정정은 별도다. 10/3 본문에는 수정·삭제·수동 상계 원자 명령과 회사 이체의 양쪽 계좌/권한 준비 조건이 있다.
- [023](https://app.notion.com/3e82cda7782b8143abc8c73e9c36b563): 날짜·번호·재고평가·BOM·자동전표의 공용 순수 함수. 동일 결과 시험만으로 본체 공유 완료는 아니다. 현재 정기 투영·번호 formatter 후보와 DB writer의 완성 여부를 구분한다.
- [PARTNER](https://app.notion.com/3ec2cda7782b81888066f4cbfdc08fab): 모든 거래처 분개와 계정별 잔액, 선급133/선수254 분리, 확인한 대상·금액의 원자 상계와 적용 이력. 같은 거래처라는 이유의 자동 소진 및 보류된 수입 거래처 건은 허용하지 않는다. 수동 분개 저장소 UI 연결·선급선수 writer는 읽기 원장 통합과 별개다.
- [RETURN](https://app.notion.com/3ed2cda7782b818d8a05cfae4638bcc7): 역분개, 지정 source 우선/같은 방향 FIFO 비현금 배분, 251/253 원장 일치, 현금 중복0, 성공 전체 확정/실패 전체 롤백, 직접 writer 차단과 UI 결선. 기존 본문의 미지원 원물·로트와 과거 gate 상태는 역사 기록이다. 이번 후보의 원료 지원을 운영 완료로 확대하지 않는다.

## 최초 조사 시점의 경로와 전환 필요 조건

아래 표는 최초 조사 원문을 보존한다. 이후 교체된 현재 후보 상태는 말미의 최신 조회에서 구분한다.

| 업무 | UI 소비와 현재 쓰기 근거 | 실제 대체 및 판단 |
|---|---|---|
| 일반 현금 생성·템플릿 | `AdminApp.tsx:2077` addCashEntry → issueNumberedCashEntry. TradeStatement/VoucherComposer·LoanManager callbacks 소비 | `index.ts:26` issueNumberedVoucher export. 이미 중앙 서버 발행; 신규 직접 cash 생성으로 중복 집계하지 않는다. |
| 대출 현금 생성 | 같은 중앙 callback의 loanId 분기 → recordLoanCashEntry; LoanManager175, VoucherComposer421 | `index.ts:31` recordLoanMovementCommand. 일반 번호 명령에 우회할 새 경로를 만들지 않는다. |
| 정기 수동 발행 | recurringVoucherIssue.ts30/35 → issueNumberedCashEntry/Statement | 서버 번호 연결 완료 범위. 정기 pure 계산 후보는 별도 미배포다. |
| 급여 | HRManager.tsx179 → issuePayrollVoucher | `index.ts:35` savePayrollDraftCommand/issuePayrollVoucherCommand. 입력한 급여와 실제 첫월 gate는 별도이며 옛 writer로 집계하지 않는다. |
| 거래 발행 | TradeStatement.tsx1381 claimDocNo를 초안에 넣지만 onApplyStatement는 서버 명령 | `index.ts:27` issueTradeStatementCommand. 남은 claimDocNo는 실제 서버 번호 authority가 아니다. UI 예약/미리보기 호환 잔여로 분류한다. |
| 일반 대체·발생 템플릿 | VoucherComposer.tsx537 claimDocNo 초안 →555 onAddIssuedStatement → AdminApp4494 issueNumberedStatement | 서버 발행 연결. 초안 번호 제거는 가능하나 카운터 직접 writer가 남았다고 세지 않는다. |
| 현금 전체 수정 | AdminApp.tsx361 updateCash → updateItem cashEntries. TradeStatement441~462는 linked settlement를 먼저 수정하고 현금 실패 시 되돌림 | **남은 실제 direct writer**. 기존 mutateVoucherCommand는 edit-note/delete만이며 전체 날짜/금액/방향/분개/거래처 수정의 대체가 아니다. 전체 원자 수정 후보 작업 중; note-only 제한으로 기능 축소하지 않는다. |
| 현금 삭제 | AdminApp444~448 settlement 순차 삭제 후 cash 삭제. TradeStatement660은 settlement 삭제를 별도로 시작 | **남은 실제 direct writer**. 같은 현금과 모든 관련 정산·원금·급여 등 특수 계약을 함께 처리할 전체 삭제 명령이 필요하다. 첫 삭제가 된 상태를 사용자 확인 없이 정상 성공으로 간주하지 않는다. |
| 수동 정산 생성/수정/삭제 | AdminApp4472 updateItem settlements,4704 addItem/4705 deleteItem. CashLedger245 MatchModal. TradeStatement669~693 확인 후 FIFO loop 추가, 현금 편집 시 기존 정산 수정 | **남은 실제 앱 writer**. index33 mutateManualSettlementCommand는 실제 export지만 앱 callable 소비 검색0. addItem settlements는 회사/원문/잔액조정 제외와 revision 증가 tx가 있으나 명령 소유 정산·상한·멱등·수정/삭제를 모두 대체하지 못한다. |
| 발행전표 수정 | AdminApp350 → editIssuedStatementCommand | index25 callable 연결. 자체 수정은 전환돼 있다. |
| 수정 요청 승인 | AdminApp3115 updateItem issuedStatements →3116 요청 승인 | **남은 실제 직접 수정**. editIssuedStatementCommand를 소비하는 중앙 updateStatement와 다른 경로. 최신 원본 revision과 수정+승인 성공 순서를 대조해 전환 필요. |
| 발행전표 삭제 | AdminApp4548 → deleteIssuedStatement 공유 Web SDK 서비스 | 클라이언트 tx로 주문/PO link·정산·revision을 함께 지움. 단순 direct delete는 제거됐지만 **서버 명령 전환 완료는 아니다**. mutateVoucherCommand의 연결 전표 거절 범위와 동일하지 않다. |
| 회사 이체 | VoucherComposer594/595 양사 onAddForCompany 두 번, close 즉시. AdminApp4489~4492는 cash 서버 발행/statement 직접 add | **남은 두 저장 호출과 직접 statement writer**. interCompanyTransferCommand.ts208 recordInterCompanyTransferCommand는 정의돼 있으나 현재 index export 및 앱 소비0. 실제 양쪽 계좌/grant·서버 원자 명령 준비 전 구현됐다고 쓰지 않는다. |
| 반품 체크리스트·관리 | 현재 AdminChecklist147/456 → onProcessReturn, AdminApp1256 handleProcessReturn → returnCommands | index34 processGeneralStockReturnCommand. 기존 반품 전표/processed 3단계 호출은 이번 checkout 후보에서 제거됨. 원료·단위 지원 및 최종 배포 검증은 리드 작업 중이다. |
| 거래처 지급/수금 | recordPartnerPayment wrapper → callable recordPartnerPaymentCommand | index30 서버 명령. 실패의 durable rejected/응답 유실 pending 보존은 배포5307 범위. 새 상계 writer와 혼동하지 않는다. |
| 선급·선수 상계 | PARTNER 원장은 표시하지만 현재 index에 전용 advance export/앱 소비 없음 | 별도 격리 설계 후보. 수동 settlement는 현금↔전표 연결이고 선급/선수 대체분개 명령을 대신하지 않는다. 모델을 새로 추정해 생성하지 않는다. |
| 수동 분개 UI 연결 | PARTNER 원본 요구, 현재 원장은 issuedStatements/cashEntries 기반 | 별도 저장소의 실제 UI reader/writer 연결이 확인되지 않았다. 순수 helper 지원 시험을 UI 완성 근거로 세지 않는다. |

## 별도 계약: 제거 대상과 혼동하지 않음

### 신규 지급 입력의 지원 경계

현재 `voucherIssue.ts`는 일반 cash의 108/251/253·대출 보호계정 신규 입력을 거절한다. `AdminApp.addCashEntry`의 loan 외 분기, TradeStatement `onIssueCashEntry`, CashLedger `onAddCashEntry`가 generic issuer를 호출하므로 화면에 이 계정을 고른 신규 입력이 서버 지급 경로로 자동 연결됐다고 볼 수 없다. 기존 일반 서버 발행 cash의 수동 연결 호환은 이 신규 생성 문제와 별도다.

`recordPartnerPayment`는 날짜·거래처·방향·총액·은행·pin·지정 allocations를 받으며 원문 source/FIFO에 따라 계정을 선택한다. 입금108도 초과액은 선수254로, 출금251/253은 두 채무가 섞인 FIFO에서 원 입력과 다른 계정으로 나뉠 수 있다. 기존 cash의 accountCode/분할 lines를 총액 하나로 바꾸어 단순 라우팅하면 동치가 아니다. 단일 계정의 source·배분·초과 처리와 mixed lines 지원 계약을 먼저 완성해야 하며 기존 issuer 보호를 임의 해제하지 않는다. 상세 읽기 근거는 `work/manual-settlement-integration-contract-20261008.md`에 있다.

계좌 확정 잔액 이력은 confirmedCashBalance 서비스의 metadata transaction이며 현금 수익·비용 전표가 아니다. 계좌/대출/재고 기초 등록 및 정정은 firebaseService의 opening 전표와 보조원장을 함께 처리하는 별도 사용자 승인 기능이다. 일반 자금 수정·삭제 서버 교체를 이유로 이 기능을 임의 잠그지 않는다. 원료·제품 재고 writer는 이번 금융 지도에서 제외하고 원자 반품 adapter 지원 여부로만 대조한다.

역사 `scripts/`·비공개 `work/` 정정 후보·운영 백업·undo는 앱에 연결된 소비가 없는 한 런타임 writer 수에 넣지 않는다. 읽기 fallback, claimDocNo 초안 예약, 과거 번호 parsing, 삭제된 전표의 timeline ID 호환도 금융 DB writer가 아니다. 기존 서버 source 정의 또는 export만으로 실제 운영 배포·UI 결선을 주장하지 않는다.

## 재현 가능한 정적 조사

repo 루트에서 아래 검색을 읽기 전용으로 실행했다. literal 금융 컬렉션 호출과 UI callback을 함께 대조했다. raw SDK 직접 호출만 검색하면 addItem/updateItem 간접 쓰기가 빠진다.

```powershell
rg -n "(addItem|updateItem|deleteItem|setDocument)\('(cashEntries|issuedStatements|settlements)|claimDocNo\(" components src/features src/shared --glob '*.ts' --glob '*.tsx' --glob '!*.test.*'
rg -n 'on(Add|Update|Delete)Settlement|onAddForCompany|onAddCashEntry|onAddIssuedStatement|onProcessReturn' components src/features/admin/AdminApp.tsx --glob '*.tsx'
rg -n 'mutateManualSettlementCommand|mutateVoucherCommand|recordInterCompanyTransferCommand' components src functions/src/index.ts --glob '!*.test.*'
rg -n 'export.*Command|issueNumberedVoucher' functions/src/index.ts
```

최소 다음 순서: 전체 현금 수정·삭제 계약을 완성해 기존 UI 기능을 보존한 뒤 direct callback을 교체한다. 수동 정산은 기존 실제 명령에 연결하면서 소유·revision·재시도 계약을 검증한다. 수정 요청 승인을 중앙 전표 수정으로 연결한다. 발행전표 삭제와 회사 이체는 실제 연결·양사 권한 계약을 충족하는 대체 서버 명령으로 완성한 뒤 옛 호출을 없앤다. 이 목록은 새 인수조건을 만드는 것이 아니라 확인된 실행 경로 차이를 기록한 것이다.


## 수동 정산·현금 줄 투영 후속 후보 — 2026-10-08

위 표의 직접 callback은 조사 시점 원문이다. 현재 미배포 후보에서 AdminApp의 단건 추가·수정·삭제 callback을 mutateManualSettlement로 연결하고 MatchModal의 await/busy/실패 보존을 구현했다. 자동 FIFO의 순차 여러 추가는 원자 batch 계약이 아직 완성되지 않아 이 연결만으로 제거 완료라고 판정하지 않는다.

functions/src/shared/cashLineProjection.ts가 앱 autoJournal과 서버 cashFromEntry의 실제 줄 계산 원본이다. 앱은 기존 반올림/fallback을 보존하고 서버 strict 경로는 안전정수·현금 순액 또는 상계 차대 균형을 검증한다. 실제 차대에서 108 대변·251/253 차변은 감소, 반대는 증가로 읽고 같은 계정을 합산한다. 기존 대체 abs 계산과는 의미가 달라 앱 실제 분개 회귀로 구분했다. 옛 서버 본문 복구 시3FAIL을 검출했고 원복 후 관련7파일61PASS. 서버 타입36175 exit0, 앱 타입 및 관련 SDK 최종 확인은 대기다. 후보 미배포·운영 금융/gate 쓰기0.


## 최신 런타임 조회 — 2026-10-08, 미배포 후보

components와 AdminApp에서 실제 cashEntries/issuedStatements/settlements addItem·updateItem·deleteItem 호출 및 onAddForCompany를 다시 검색했다. 시험 파일을 제외한 실행 경로는0이며 AdminApp350의 과거 설명 주석1개만 남았다. 시험 fixture의 옛 prop 이름을 실행 writer로 세지 않는다.

- 현금 전체 수정/삭제는 중앙 mutateCash와 원자 서버 명령 후보로 연결했다. TradeStatement의 정산 선행 순차 수정/삭제를 별도 직접 writer로 유지하지 않는다. 기존 급여/이체 소유 현금의 전용 편집 계약은 서버·UI 담당 검증 범위다.
- 수동 단건 정산은 mutateManualSettlement로, 자동 FIFO 배분은 matchCashAllocations와 원자 replaceManualSettlementBatchCommand 후보로 연결했다. MatchModal의 await/busy/오류 및 동일 계정 signed 순액·25160/25340 분할/전체 현금 한도는 검증했다.
- 수정 요청 승인은 원문/revision 검증과 전표 수정·승인 원자 서버 경로 후보로 연결했고, 발행전표 삭제는 deleteIssuedStatementCommand를 실제 소비한다. 삭제 거절 감사·응답 유실 재시도는 독립 검수 보완 후 확인했다.
- 회사 이체의 양사 onAddForCompany 두 번 저장 호출과 전달 chain은 제거됐다. VoucherComposer에서 prepareTransferOptions/saveInterCompanyTransfer/resumeInterCompanyTransfer 서버 서비스 연결을 준비·검증 중이다. 이 사실을 회사 이체 운영 활성화나 배포 완료로 표시하지 않는다.
- 반품의 옛 전표/processed 순차 직접 경로는 원자 반품 명령 후보로 교체했다. 원료/제품 단위/FIFO 및 durable 재시도는 별도 검증 근거를 참조한다. 원전표 없는 독립 처리 등 원본 잔여는 별도이며 전체 RETURN 완료 아님.

계좌·대출·재고 기초 등록/정정과 confirmedBalances metadata는 별도 승인 기능이다. 이들의 서비스 경로를 위 세 금융 컬렉션 runtime 직접 writer 제거 집계에 섞거나 임의 차단하지 않는다. generic 보호계정 신규 생성의 의미 있는 전용 지불 입력 연결, 선급·선수 상계/수동 분개 저장소 연결 등 원본 기능 조건과 코드 정리 완료는 구분한다. 이번 조회의0은 확인한 직접 런타임 호출 수이지 모든 금융 기능·운영 gate·Functions 배포 완료를 뜻하지 않는다.
