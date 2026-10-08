# 여섯 번째 후속 묶음 검증 — 2026-10-07

이 문서는 배포 전 검증 초안이다. 아직 앱 배포·선택 Functions 배포·GitHub push 완료를 주장하지 않는다.

## 023 공통 정기 계산 부분

정확6파일: Functions shared/recurringVoucher.ts, 앱 autoVoucher.ts/templateStatementType.ts, 서버 autoVoucherDraft.ts, 기존 autoVoucherDraft.test.ts, 신규 autoVoucher.recurringContract.test.ts. 실제 어댑터가 날짜/갈래/ID/종류/금액/품목을 같은 소스에서 계산한다. 수동상환·stampFor·서버 strict guard·번호/DBwriter는 유지한다.

- 실제5파일49시험/앱noEmit/서버noEmit/Functions build85054 exit0, diffcheck0.
- 기준 두 어댑터 계산 본문 복구 시 공통소비자 검사1FAIL, finally byte원복.
- 기존 계약13시험10PASS/3FAIL은 없는 selector 및 skip 기대 불일치였으며 실제 소비자 기준으로 재기반. 없는 helper export를 만들지 않았다.
- 사용자 기본 MAIN 계약을 회사/active filter 뒤 서버에서도 우선 적용. main 없는 앱 입력순/서버ID순·계정명 순서 차이는 보존.
- 독립 읽기 검수 P1/P2없음. 원본 번호/BOM 범위는 남아 전체023 미완료.

## RETURN 후속 부분

기존 음수 청구의 0정산은 허용하되 음수 청구에 실제 정산이 있으면 거절한다. 양수 상한과 FIFO 공제는 유지한다. docs/return-negative-claim-validation-20261007.md의 실제SDK15PASS(기존13+신규2), 기존식 복구변이1FAIL 후 원복을 참조한다. UI 후속은 담당 동결·최종 결과 대기다. 운영금융/재고/gate 쓰기0, 전체 RETURN 활성화·완료 아님.

## Rules 및039

총괄 Rules선행64793 exit0, liveSHA27059 일치 확인(aba71fb4..., ruleset fa20ef0e...). 정확 규칙 변경·검증 근거는 결과 수신 후 보완한다. 039 미참조 INITIAL_PALLETS/import 제거 및 PalletManager 설명 정정은 두 파일의 코드 정리이며 운영 inUse8문서 삭제나 전체039 완료가 아니다.

최종 묶음 통합시험/타입/앱build/배포 및 원격 소스/SHA/push는 총괄 실제 결과 수신 후 기록한다. 금융DB 고아 정리 승인은 아직 없고 운영 정정0. Notion쓰기0, Figma 다른 보드 정리 보류 유지.

사용자 최신 직접 지시에 따라 새 원자 경로 완성 후 옛 writer/호출 경로(반품3단계 포함)를 제거한다. 이는 운영 자료 삭제 승인이 아니며 고아 정산 정정은 별도 답변 대기다.

## 023 번호 포맷 후속 — 2026-10-08 검증 중

정확4파일에서 서버의 formatVoucherNo를 Functions shared/voucherNumber.ts로 옮기고 기존 voucherIssue export를 유지했다. 앱 nextDocNo는 정상10자리 날짜 반환에만 같은 함수 소비, 짧은/빈날짜 fallback·예약/해제·목록최대값 보존. 서버 모든 기존 발행 호출은 같은 reexport 경로를 유지한다. 실제3파일49시험18757 PASS. 이전 정기49와 합산 총수는 통합 dedup 후 판단한다. 기준두소비자HEAD복구변이1FAIL 뒤finally복원. 앱 타입18757은 RETURN 다른소유 companyId/필수fixture3오류로 exit2, 서버타입/build45313 별도진행. 번호 카운터writer/콜러/운영쓰기0. 아직 독립검수·배포완료로 주장하지 않는다.

## RETURN 공통 엔진 및 재시도 후속 — 2026-10-08 최신 검증

총괄 실제 SDK 세션91515은 세 파일31시험(server20·terminal9·client ledger2) 통과 후 정상 종료했다. 제품 단위20kg BOM, 회사값 없는 태백 자식 품목, FIFO 두 로트, 원료 출입고 공통 엔진과 같은 원료 보유자에 연결된 두 SKU, 비재판매의 금융 처리만 수행하는 경우를 포함한다. 앞의 음수 청구15시험 근거는 이전 단계 검증으로 보존하며 최신31시험과 중복 합산하지 않는다.

총괄 wrapper 최종 세션68898은8시험 통과했다. 구형 고정 operation ID 호환, 감사 조회 도중 사용자 UID 변경, 다른 명령 보존을 확인했다. 후반 assertCompany·operationId·정확한 입력 키에 관한 검수 보완은 최종 확인 대상이다.

현재 공통 원료·제품 로트·단위 계산 본체의 물리적 공유 이동과 최종 타입 검증은 대기 중이다. 후보는 아직 미배포이며 gate 활성화0, 운영 금융·재고 쓰기0이다. 원전표 없는 독립 처리 범위가 남아 전체 RETURN 완료로 판정하지 않는다.

## 감사 컬렉션 Rules 후속 실제 배포 — 2026-10-08

기존 다섯 보호 대상에 voucherMutationOperations·companyTransferOperations·oemReceiptOperations를 더한 여덟 컬렉션의 실제 Auth 매트릭스85479은2시험 통과 후 정상 종료했다. 첫66954는 프로젝트 ID 불일치로 auth/user-not-found가 발생해 assertion 실행0이었다. Rules 배포33939 exit0 및 REST 검증 SHA db9c1b4ae322a2f79fa3c51e90665f0c2c28839ca68588537ebe5c62e3be9431/ruleset0c284f7c-9180-4602-b3e6-1600773313cf 일치를 총괄이 확인했다. 앞의 다섯 컬렉션 선행 SHA 기록은 이전 단계 근거로 보존한다.

이 Rules 완료는 RETURN·현금 변경·수동 정산 후보의 Functions/Hosting 배포나 gate 활성화 완료를 뜻하지 않는다. 운영 금융/gate 쓰기0이다.

## 수동 정산 및 공통 현금 줄 투영 후보 — 2026-10-08

일반 발행 자금전표의 issueOperationId만으로 수동 정산을 모두 막던 제한을 제거했으며, 명령 소유 정산/이체/대출/지불 자금의 제한은 유지한다. 새 단건 wrapper는 회사·UID·release·revision·전체 입력·operation ID를 보존하고 정확한 durable rejected 결과에만 새 시도를 허용한다. rejected 감사는 사용자·회사·operation ID·action·요청 hash·정산 원문 hash를 대조한다. MatchModal은 저장/해제를 await하고 중복 클릭·늦은 다른 회사 응답·실패 메시지를 처리한다. AdminApp의 세 단건 callback 후보를 연결했지만 FIFO 여러 건을 순차 새 명령으로 바꾼 것을 원자 완료로 주장하지 않는다.

공통 cashLineProjection을 앱 autoJournal과 서버 cashFromEntry가 소비한다. 기본 앱 경로는 기존 반올림과 fallback, 서버 strict는 안전정수와 순액·상계 차대 균형을 보존/검증한다. 실제 앱 분개에서 108 대변·251/253 차변을 감소로 읽고 반대는 증가, 같은 계정은 합산한다. 옛 cashFromEntry 본문 변이3FAIL 후 원복, 관련7파일61PASS59581. 서버 타입36175·Functions build44470·최종 앱 타입60861 exit0. 앱 최초12190의 callback 반환 타입1오류는 async/await로 수정했다.

최신 SDK52643은 다섯 파일48시험 중45PASS/3FAIL이었다. 수동 두 실패는 옛 총액 오류 기대와 이어지는 fixture 영향, 지불 한 실패는 Transaction invalid or closed이며 확정 원인을 추정하지 않는다. RETURN 두 파일29시험과 지불 실패 처리9시험은 통과한 근거로 보존한다. 수동/지불 두 파일 보완 재실행 및 이체 전용 SDK는 대기/진행 단계이며 최종 전체 통과 수로 합산하지 않는다. 미배포 후보·운영 금융/gate 쓰기0이다.

### 공통 현금 투영 소비자 SDK 최종 재검증

수동/지불 보완 재실행81653은 두 파일10시험(수동3·지불7) 모두 PASS/exit0, 기존 이체 전용 포트 재검증71793은 한 파일6시험 PASS/exit0였다. 앞선52643에서 통과한 RETURN 두 파일29시험·지불 실패 처리9시험과 합쳐 여섯 실제 파일54개 계약의 통과 근거를 확보했다. 이는 기존 소비자 재실행을 포함하며 신규 기능 시험54개로 세지 않는다. 앞선45PASS/3FAIL 실행 이력은 삭제하지 않는다. 동시 지불의 앞선 transaction invalid or closed 원인은 재현 없이 확정하지 않고 별도 재실행 통과로만 기록한다.

에뮬레이터는 각 정상 종료했고8082/9099/4000/4400/9150/8182/9198 LISTEN 출력0 확인 후 슬롯을 반납했다. 수동 SDK는 실제 Admin SDK transaction 및 callable 인증 분기 검사이며 실제 브라우저 Auth 시험으로 과장하지 않는다. 지불/이체의 기존 실제 Auth 계약과 구분한다. 후보 소스는 동결이며 독립 최종 검수·묶음 배포 결과 대기다. 운영 금융/gate 쓰기0.

### 거래처 표시·FIFO 공통 투영 최종 보완

별도 cashLedger partnerCashParts가 abs/양수 필터를 남겨 실제 앱 분개와 달랐다. 실제 지원 사례 두 시험5048 모두 FAIL(혼합 순액120/100, 반대 차대 상계100/-100) 확인 후 해당 hunk만 공통 투영과 cashLineReduction 소비로 교체했다. 개별 줄 적요/API를 유지하고 실제 앱 분개·거래처 paid·전표 FIFO 잔액을 대조했다. 기존 원장 포함7파일141PASS25971, 최종 wrapper/MatchModal까지 통합9파일151PASS2501이며 이전61·141을 합산하지 않는다.

이 보완으로 소유 범위는 정확14파일이다. cashLedger.ts의 다른 공유 계좌 원장 본문 및 CashLedger 컴포넌트의 다른 담당 변경과 구분한다. 앞의 SDK54 근거 이후 서버의 감소 계산 두 줄을 같은 shared 함수 호출로 정리했으므로 마지막 전체 묶음 SDK의 실행 시점은 총괄 검증과 구분한다. 앱/서버 최종 타입 재검사 및 삭제 후보의 독립 검수 보완은 대기이며 아직 묶음 배포 완료가 아니다.

### 삭제 후보 독립 검수 및 분할 수동 연결 보완

삭제7파일 초기 P1(원문/revision 사전 거절 이후 요청 영구 고정), P2(실행 잠금/exact-saved clear 및 늦은 사용자 보호 부재)를 지적했다. reviewer가 durable rejected/full command proof와 실행 잠금·정확 저장값 확인·await 뒤 사용자/회사 확인을 보완했다. rejected는 statementIds가 없어 applied 삭제 재시도 조회와 섞이지 않는다. 최종7파일 읽기 검수에서 추가 P1/P2 없음, reviewer13순수/6SDK 통과 근거를 확인했다.

수동 연결은 과거 일반 출금100의25160/25340을 각각 같은 거래처 원전표에 연결하는 실제 사례가 두 번째에서 실패했다(1FAIL/11skip). 같은 회사/거래처 확인을 유지하면서 기존 배분을 계정별로 합산하고, 각 계정 signed 순액 및 전체 cash.amount·원전표 잔액 한도를 함께 검사하도록 최소 보완했다. 최종9파일152PASS43256이며151과 합산하지 않는다. 원전표/자금 원문과 owned 제한은 유지하고 신규 SDK1사례를 기존 수동 파일에 추가했다. 해당 최종 SDK와 전체 타입/배포는 아직 대기다.

### 단건 분할 최종 SDK 및 런타임 정리

수동 최종 한 파일4시험85211 PASS/exit0. 25160+25340의 두 원전표 매칭·같은 명령 재시도·초과 거절 감사1/금융0·cash 원문/revision 보존을 확인했다. 에뮬레이터 정상 종료·7포트 LISTEN 출력0 후 reviewer에게 슬롯을 반납했다. 앞선 수동3시험과 합산하지 않는다. 단건/공통 투영14파일 소스 동결, 최종9파일152PASS43256.

총괄이 AdminApp와 TradeStatement의 onAddForCompany 전달 chain을 제거했다. 실제 제품 파일에서 cashEntries/issuedStatements/settlements addItem·updateItem·deleteItem 및 onAddForCompany를 재조회한 결과 실행0/과거 설명 주석1이다. 테스트 fixture는 실행 writer로 세지 않았다. 현금/정산/승인/삭제/반품의 새 서버 경로 후보와 회사 이체 UI 준비 상태는 legacy 지도에 갱신했고 기초 등록·정정 서비스는 별도 기능으로 보존한다. 이 기록은 아직 묶음 Hosting/Functions 배포나 운영 gate 활성화 완료가 아니다.


## 2026-10-08 반품 후 원전표 삭제와 정산 읽기 계약

실제 서버 명령으로 반품 100원 처리 후 원전표를 삭제하고, 같은 거래처의 새 매출 200원에 수금 100원을 발행하는 흐름을 합성 로컬 Firestore에서 재현했다. 기존 구현은 남은 returnApplications의 원전표 부재로 거절되어 정상 발행 기대 시험 1개가 실패했다. 반품 역분개·배분 원문과 복귀 재고는 유지됐고, 거절 감사만 저장됐으며 새 금융문서는 없었다.

공용 읽기 투영은 살아있는 원전표 배분을 기존대로 차감하고, 삭제된 원전표에 배분된 부분만 독립 음수 credit으로 보존한다. 보호된 returnOperations의 journalHash/applicationHash, 회사·거래처·일자·차대와 전체 배분 합계를 검증한다. 원전표·반품 원문·재고를 변경하지 않는다. 지불, 현금 수정, 수동 일괄 정산, 후속 반품, 준비 감사, 회사이체 준비·실행의 실제 소비자를 같은 읽기로 연결했다.

앱은 별도 readonly allocation context로 같은 전표별 배분을 읽는다. 늦은 전표 B에 연결한 반품이 먼저 발행한 A를 차감하지 않는다. 원전표 실제 존재를 회사 인증 아래 단건 조회한 뒤, 부재가 확인된 배분만 credit으로 읽는다. 조회 미완료·오류·타회사 거절은 삭제로 추정하지 않고 확인 중으로 표시하며 수금 단추를 제공하지 않는다. 기존 원문 returnOperations/Loaded 구독과 재고 원장은 유지한다. 명시 삭제 성공 뒤 기존 staticRefreshKey로 존재 증거를 새로 읽고, 회사·UID·refresh 변경의 늦은 응답을 버린다. 이월 필터가 이미 반영한 옛 반품은 제외하고 이월 뒤의 새 반품만 차감한다. RETURN 역분개 자체는 잔액 0이며 미확정 금액으로 이월잔액을 저장하지 않는다. 전표 원문에 메타 필드를 붙이는 방식은 사용하지 않았다.

- 최종 순수: 4파일 44개 통과(37095 exit0). 신규 읽기·앱 배분 19개, 존재 조회 hook 5개와 기존 관련 회귀 20개다. 앞선 42/43개 실행과 합산하지 않는다.
- canonical 실제 SDK: returnDeletedSource.emulator.test.ts 2개 통과(92974 exit0). 반품→삭제→수금·앱 FIFO, 실제 Rules 단건 부재 허용과 타회사 실존 문서 permission-denied를 확인했다. UUID 문서 정리·부재 검증과 에뮬레이터 정상 종료를 확인했다. 직원 로그인 UI E2E 전체로 확대하지 않는다.
- 초기 SDK의 company+documentId list는 없는 문서에 대한 Rules resource-null 오류로 실패했다. 부재 추정을 하지 않고 단건 getOk 경계로 전환해 최종 통과했다.
- 순수 중간 2개 실패는 RETURN행 0 기대 보완 중 잘못 들어간 fixture 배분과 미갱신 기대목록이었다. 테스트만 정리 후 44개가 통과했고 제품 본문은 변경하지 않았다.
- 앱 타입 20941은 이 기록 시점에 실행 중이다. 앱 Hosting 배포·푸시는 아직 완료로 주장하지 않는다.

서버 선택 16개 배포는 root 결과 24882 exit0으로 완료했다. 실제 배포 ZIP 검증은 runtime 소스 53개와 선택 lib 13개 모듈의 각 16개 배포에서 차이 0, verifiedtrue다. canonical 신규 시험은 실행 모듈이 아니므로 그 ZIP 비교에서 제외했고 Git에 별도 보존한다. 이번 source ZIP SHA는 2ed9a2ceaed3517c7119f772faf31b80e0634962a98aa80bd318cc57db875b4c다. 이전 증거를 대체하거나 전체 TODO 완료로 확대하지 않는다.

사용자 최신 선택 응답은 정확 3건인 태백·풍회 반품 및 풍회 정산 활성화다. fresh 감사·최신 코드 검증 뒤 root가 조건부 적용할 범위이며 이 기록 시점의 운영 활성화 apply는 0이다. 보험료 고아 재연결 승인은 포함하지 않는다.

최종 앱 타입 20941 exit0을 추가 확인했다. 8082/9099/4000/4400/9150 LISTENING 출력 0을 별도 재조회했다. 제품 소스는 동결 상태이며 앱 배포·푸시 결과는 root 확정 전이다.


## 최종 배포 전 통합 상태

root가 독립 검수 P1/P2 없음과 source 반납을 확인했다. 최종 앱 타입 20941 exit0, 양앱 빌드 97009 exit0으로 현재 관리자·직원 bundle이 완성됐다. 서버 선택 16개 활성 배포 및 실제 runtime53개·compiled13개 비교는 완료했고, 호출 소비자가 없는 옛 mutate callable 1개 삭제도 완료했다. Git staged 파일은 root 통합 기준 239개다. 이 수는 TODO 완료 건수나 시험 건수가 아니다. 이 기록 시점에 Hosting 완료와 최종 Git 푸시는 아직 확정 전이고 금융 전환 gate apply는 0이다.

별도 이미 확정된 통합 증거는 회사이체 UI/wrapper 순수22 및 실제 Auth SDK3, 삭제 canonical SDK6, 현금·일괄 매칭 SDK11이다. 옛 mutate producer5파일 제거 뒤 남은 RETURN 순수13개 통과도 보존한다. 이전 음수 검증 문서의 status 미존재·adapter 미완 설명은 당시의 역사이며 현재 통합 상태와 구분한다. 이전 실행·변이 재실행을 신규 고유시험으로 합산하지 않는다.


## 2026-10-08 코드 릴리즈 완료, 운영 활성화 결과 대기

코드 커밋 d2d8dc601ae93c44efbc8705fa5cdbdeb208091b는 정확 239파일이며 GitHub 푸시가 완료되어 원격과 앞/뒤 0/0이다. 관리자·직원 Hosting 58829 exit0, 실제 배포 23파일 SHA 검증 32257에서 모두 일치했다. 서버 선택 16개 배포 24882 exit0, runtime53/53 및 compiled13개 모듈의 각 함수 ZIP 비교 모두 일치했다. ZIP SHA는 2ed9a2ceaed3517c7119f772faf31b80e0634962a98aa80bd318cc57db875b4c다. 실행 모듈이 아닌 canonical 시험 파일은 runtime ZIP 비교에서 제외하고 Git에 보존했다. 옛 mutate callable 삭제 88784 exit0, 선택16개 ACTIVE 및 옛 함수 부재를 확인했다.

운영 설정 최초 적용은 금융 원문 버전 변경을 발견해 쓰기 전에 거절됐다(운영 쓰기0). 승인된 정확3건만 fresh v3 dry로 재검증했다. 대상은 태백·풍회 반품 및 풍회 정산이고 기존 blocked 범위 태백2/풍회0을 유지했다. v3 적용 11910은 이 기록 시점에 진행 중이며 최종 성공·사후 검증을 아직 주장하지 않는다. 계획 해시는 aaa4a85e2523f7d2535667680f2cfbdff04a441a8dc7d4b9c1132f032e396efa다. 보험료 고아 재연결 승인은 별도로 보류 상태다.

원본15개 중 완료 집계는 기존7/15를 유지한다. 이번 239파일·부분 기능 배포를 추가 TODO 전체 완료 수로 확대하지 않는다. 노션 쓰기0, Figma 나머지 보드 정리 보류를 유지한다.


## 운영 활성화 최종 완료

승인된 정확3건(태백·풍회 반품, 풍회 정산)의 v3 적용 11910 exit0 결과는 changedGates:3, verified:true, financialWrites:0이다. root 독립 재조회 b83cdd exit0의 work/batch6-activation-independent-verification-20261008.json에서 정확3건의 설정 일치·enabled:true를 확인했다. fresh v3 대비 financialVersionChanges:0이고 감사 버전 해시 a08c8a8e9750ac23771a50c313ae49a63358d85061ebddd0240ef8e458c8abe4도 불변이다. 최초 적용의 사전 버전 거절과 fresh v3 재실행 이력은 보존한다.

보험료 고아 재연결은 별도 보류·apply0이다. 삭제된 거래처 참조의 태백 blocked2와 기타 회사이체 held 설정을 유지했다. 금융 전표·금액·재고를 생성하거나 정정하지 않았다. 원본 전체 완료 집계는 7/15에서 바꾸지 않는다.
