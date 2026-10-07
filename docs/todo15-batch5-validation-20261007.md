# 다섯 번째 후속 묶음 검증 — 2026-10-07

코드 커밋 5307f949의 정확 16파일 묶음은 관리자·직원 Hosting과 선택 Functions 네 개 배포 및 원격 파일 검증을 완료했다. 검증 문서 추가 커밋과 GitHub push는 결과 대기다.

## PARTNER 결제 실패 처리

확정된 사전 정책·명시적 도메인 검증 거절은 기존 partnerPaymentOperations에 rejected 감사 1건만 기록한다. 같은 operation의 동시 요청은 transaction으로 최종 결과를 공유한다. 기존 금융 전표·정산·번호·revision은 변경하지 않는다. 기존 applied duplicate와 응답 유실 재시도는 유지한다.

클라이언트는 전체 입력·release·revision·operation을 저장한다. 정확한 서버 terminal detail만 pending을 해제한다. 구형 pending은 같은 ID/입력/revision과 현재 release로 서버를 확인하며 원래 release를 복원했다고 주장하지 않는다. 기존 applied 해시 충돌이나 불확실 오류는 pending을 보존한다. malformed 저장 자료도 자동 삭제하지 않는다.

의도된 계산 검증만 PartnerPaymentValidationError로 표시한다. 조건·문구는 유지한다. native Error/TypeError, 읽기 오류, commit 오류는 안전 거절로 추정 변환하지 않는다.

- 순수 최종 3파일 37시험 PASS: 46996 exit0.
- 실제 SDK 최종 2파일 16시험 PASS: 44633 exit0. 신규 실패 계약 9건과 기존 결제 계약 7건을 구분한다.
- 실제 Auth 로그인은 기존 계약 파일에서 확인했다. 신규 응답 유실은 실제 SDK commit 뒤 결과를 버리고 같은 요청을 재조회한 경계 검증이며 외부 네트워크 장애 실험은 아니다.
- SDK UUID 자료 정리와 에뮬레이터 종료, 8082/9099/4000/9150/4400 LISTEN0 확인.
- 앱 noEmit, Functions noEmit 및 Functions build: 1724 exit0. 통합 앱 타입은 총괄 27202 exit0.
- 기존 wrapper baseline 3 FAIL, financialWrites 안전 guard 제거 변이 1 FAIL 후 원복. 최종 diffcheck exit0.
- 기존 SDK 첫 6 PASS/1 FAIL은 정책별 같은 ID 재사용 fixture였고, 다음 구문 오타 수정 후 7 PASS(13287), domain tag 통합 후 위 최종 16 PASS이다. 실패 실행을 전체 통과로 계상하지 않는다.

정확 8개 소스/시험 파일: issueTradeStatementCommand.ts의 recordPartnerPayment 범위, partnerPaymentCommand.ts, partnerPaymentPlan.ts, partnerPaymentCommand.test.ts, partnerPaymentCommand.emulator.test.ts, partnerPaymentFailure.test.ts, partnerPaymentFailure.emulator.test.ts, recordPartnerPayment.test.ts.

운영 테스트 거래·gate 활성화·금융 자료 변경은 0이다. 선급/선수 새 writer와 이 원본 TODO 전체 완료를 의미하지 않는다.

## 함께 배포할 다른 범위

023 날짜 처리: 기존 서버 31시험·UI 25시험의 독립 통과 근거를 유지한다. 날짜 처리 부분 범위이며 원본 TODO 전체 완료로 판정하지 않는다. 예정된 선택 Functions는 monthlyInventorySnapshot, dailyAutoVoucher, extractOrder와 위 recordPartnerPaymentCommand의 정확 네 개다. 실제 변경 함수가 정확 네 개임을 배포 뒤 확인했다.

036: [원본 인수 대조](todo036-original-acceptance-20261007.md)의 네 열거 위험과 후속 TaxStatement 계약, 30파일 85경고 분류 근거를 기준으로 원본 한정 전체 인수 충족 판정이다. 모든 앱 비동기 경로 결함 0, lint 경고 0 또는 전체 화면 E2E 완료를 주장하지 않는다. 이번 문서는 기존 근거 검토이며 새 시험 수에 합산하지 않는다.

총괄 통합 5파일 47시험 PASS(47733), 통합 앱 타입(27202) exit0이다. 날짜의 기존 서버31/UI25, PARTNER 순수37 및 SDK16은 중복 가능성이 있어 모두 더한 총수로 보고하지 않는다. 앱 build21689 및 최종 canonical Functions build52377은 exit0이다. 배포 결과는 아래와 같으며 GitHub push는 결과 대기다.

현재 원본 인수 완료 판정은 15개 중 7개(041, 016, 생산, 퇴직금 구조설계, 입고, 040, 036)다. 이는 배포 묶음 수나 부분 작업 수의 합산이 아니다. 퇴직금은 구조설계 완료이며 운영 충당·법정 예상액 입력 완료가 아니다. 023와 PARTNER는 부분 범위다. Notion 상태 쓰기는 0이며 Figma 나머지 보드 정리·삭제는 사용자의 ‘일단 냅둬’에 따라 보류한다.

## 실제 배포 검증

- 코드 commit 5307f949, 정확 16파일. 관리자·직원 앱 build21689, canonical Functions build52377 exit0.
- 첫 Functions 배포53864는 초기 소스 탐색의 10초 제한 초과로 실패했고 배포 0이다. FUNCTIONS_DISCOVERY_TIMEOUT=120을 지정한 재시도43722는 선택 네 함수 모두 exit0이다. 실패를 전체 통과로 계상하지 않는다.
- Hosting80114 exit0. 원격 SHA 검증47659에서 관리자·직원 총15파일이 모두 로컬과 일치했다.
- work/todo15-batch5-function-source-verification.json: 네 실제 배포 ZIP 각각 src61/61 byte 일치. lib/index, extractOrder, partnerPaymentCommand, partnerPaymentPlan, shared/calculation의 다섯 모듈도 일치했다. changedFunctions 정확4, verified=true.
- Rules 변경0, 금융 운영 쓰기0. 검증 문서 추가 commit/push는 총괄 결과 대기다.
