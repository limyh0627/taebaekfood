# 반품 역분개·자동 상계 인수 및 배포 — 2026-10-09

원본 TODO-RETURN-OFFSET-20261002의 조건을 누적 구현과 이번 배포로 대조하여 전체 인수를 확정했다. 원본: https://app.notion.com/p/3ed2cda7782b818d8a05cfae4638bcc7 . 노션 상태 쓰기는 하지 않았다.

원전표를 선택하면 기존 공급가·세액 비례 계산과 원전표 우선 상계를 유지한다. 원전표 없이 접수하면 수량과 공급가·세액·발생 계정을 직접 입력하고 같은 거래처·방향·계정의 미결 전표에 거래일·문서 ID 순으로 배분한다. 매입 채무는 251 또는 253을 명시하며 교차 상계하지 않는다. 미결을 초과한 금액은 거절한다. 비현금 적용을 현금 수금·지불액에 중복 포함하지 않는다.

반품 접수는 불변 accepted/rejected 감사와 같은 transaction으로 저장한다. 확정 거절 증명을 확인하면 입력을 고칠 수 있고, 응답이 불명확하면 같은 접수 원문과 ID를 재개한다. 수량 수정도 원접수 증명을 보존하며 별도 수정 원문·결과를 기록한다. 처리 후 동일 요청 재시도는 최신 상태를 덮지 않는다. 원전표 없는 수량 변경은 공급가·세액을 정확한 원 단위로 비례 계산하고 나눠지지 않는 입력은 거절한다.

## 인수 대조

| 원본 조건 | 구현·검증 |
| --- | --- |
| 매출·매입 반품 역분개, 전액·부분·복수 원전표 | 기존 returnReversalPlan/returnAllocationPlan과 processReturnCommand의 단일 transaction. 이번 standalone 시험은 110원을 미결 50원·60원에 분할 적용하고 중복 재시도를 확인한다. 기존 linked·terminal·삭제된 원전표 계약도 함께 통과했다. |
| 재고·역분개·application·번호·revision 원자성 | 실제 Admin Firestore SDK 6파일 42시험. 일반·로트·원료 adapter와 기존 실패·경합 계약을 유지한다. 폐기 매출 반품은 금융만 처리하고 재입고하지 않는다. 접수·수량 명령은 금융 분개를 발행하지 않는다. |
| 251·253 목록·원장 및 누적잔액 일치 | 기존 TradeStatement와 cashLedger 공용 거래처 투영 및 returnApplication 공제 경로를 유지한다. c268ccf8의 지급·반품·선급선수 lifecycle 및 docs/partner-ledger-acceptance-20261009.md의 전체 계정 인수 근거를 누적 사용한다. 이번 정합성 감사는 원전표 없는 반품의 역분개·배분 증명을 인식한다. |
| 기존 직접 writer 차단, 회사별 조회 보존 | 직원 생성의 옛 addItem 분기도 서버 접수로 연결했다. 반품 수량은 서버 명령으로 전환하고 일반 입고 수량의 기존 계약은 보존한다. returnRequests 직접 쓰기와 submission 감사 직접 쓰기를 차단했다. 실제 Auth Rules·입고 계약 2파일 107시험은 양사 직원/관리자 조회, 외사·무권한·직접 CRUD·다중 문서 쓰기 거절과 원문 보존을 확인한다. |
| 실제 화면과 불확실 응답 재개 | 최종 순수·UI 15파일 125시험. 실제 ReceivingReturnsManager/ReturnManager의 접수·재개, ItemList 수량 재개와 회사/UID 늦은 응답 보호를 포함한다. 배포 후 별도 Edge 탭에서 반품받기·반품하기, 거래처/품목 검색, 직접 금액 필드, 원전표 선택 시 기존 입력 방식, 251/253 선택을 확인했다. 접수·처리 버튼은 실행하지 않았고 오류 로그는 0이었다. |

## 배포·원격 검증

- 소스 ba96b113, 정확 48파일 로컬 커밋. GitHub 푸시 0.
- 전체 앱 타입 76662, 최종 순수·UI 43706, Functions 빌드 34562, 양 앱 빌드 29246 모두 exit 0. 최초 타입 실패는 모달 분기 좁힘·중복 기본값과 직원 회사 타입을 수정한 뒤 재검증했다.
- 선택 Functions 3개 배포 46448 exit 0. processGeneralStockReturnCommand 갱신, submitReturnRequestCommand와 updatePendingReturnQuantityCommand 생성. 전후 metadata의 변경 함수도 정확 이 3개다.
- 실제 원격 함수 3개 모두 ACTIVE이며 각 ZIP의 런타임 소스 68개·컴파일 JS 68개가 로컬과 SHA-256 일치했다. work/return-functions-source-verification-20261009.json.
- 관리자·직원 Hosting와 Rules 배포 4491 exit 0. 양 HTML 진입과 JS 27개가 최종 빌드와 일치했다. outputs/return-hosting-verification-20261009.json.
- 운영 Rules SHA-256 df7cd2bf857c439ea7a1e6f82bf30eec998343897e44d3f8a610791bb5811a72로 로컬과 일치했다. work/return-rules-verification-20261009.json.

SDK는 실제 Firestore transaction과 실제 Auth Rules 검증이다. callable HTTP 인증·실제 운영 반품 저장 E2E로 확대하지 않는다. 과거 반품·금융·재고 수동 정정, 신규 설정 활성화, 가짜 운영 전표 생성은 0이다. 이미 승인·활성화된 양사 반품 설정을 사용한다. 서로 겹치는 누적 시험을 합산하지 않는다.

총괄 집계: 원본 43개 중 11개 전체 인수·32개 잔여. 우선 15개 중 11개 인수·4개 잔여는 039, ERD-DICTIONARY, 026, 011이다. 다음 042 및 024의 독립 코드 작업을 계속한다.
