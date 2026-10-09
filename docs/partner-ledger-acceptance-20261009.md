# 거래처 전체 계정 원장 인수 대조 — 2026-10-09

원본 TODO-PARTNER-LEDGER-ALL-ACCOUNTS-20261001의 직접 수용 조건과 누적 구현·검증·배포를 대조하여 총괄이 전체 인수를 확정했다. 원본: https://app.notion.com/p/3ec2cda7782b81888066f4cbfdc08fab . 노션 상태는 쓰기 제한으로 변경하지 않았다.

| 원본 수용 조건 | 실제 구현과 의미 있는 검증 | 배포·적용 근거 |
| --- | --- | --- |
| 종류와 관계없이 거래처 전표·분개를 한 화면에서 조회하고 계정별 잔액 분리 | PartnerLedger의 buildJournals → partnerAccountHistory/partnerAccountBalances. 108·251·253·133·254 및 기타 계정을 분리한다. PartnerLedger.test.tsx 6시험과 cashLedger.test.ts의 전체 계정 원장 시험은 회사·기간·기초·동일 ID의 서로 다른 원천·누락 거래처·잘못된 분개를 대조한다. useAppData는 금융 전표 전체 회사 이력을 구독한다. | 기존 전체 원장 배포 및 c268ccf8, e29d56eb 후속 배포 근거를 누적 사용한다. |
| 거래처 연결 현금·대출·급여 등 실제 분개를 원장에 반영하고 중복 계산 방지 | autoJournal의 실제 현금 라인 투영과 cashLedger의 원천 구분을 사용한다. 급여·이자를 수금으로 간주하지 않는 회귀를 유지한다. 이름만 같은 거래처나 회사가 다른 원문은 임의 귀속하지 않는다. | docs/partner-order-deployment-20261009.md의 실제 소비자·원격 검증. |
| 선급133→251/253, 선수254→108을 선택 금액만 한 번 적용 | partnerAdvance 공통 계산·reader·command 및 PartnerAdvanceModal의 원천/대상/금액 확인. 동일 회사·거래처·목적·미사용 금액과 원문 fingerprint 검증, 원자 분개·감사·번호·revision 저장. 공개 명령 SDK8, 대상 수정/삭제/반품 lifecycle SDK6, 현금 원천 변경 SDK5와 실제 UI 확인 시험. 254↔253 자동 상계는 하지 않는다. | c268ccf8에서 13 Functions의 runtime60/compiled60 및 양앱25 assets·HTML, Rules 일치. 양사 적용 설정은 별도 사용자 승인으로 활성화 완료. |
| 적용/취소와 기존 금융 원문 간 정합성, 실제 원장 반영 | cashLedger.advance 실제 소비자7시험, ProfitAnalysis.advance 실제 UI의 253 원청구100/적용60→미결40. 원문 변경·삭제·반품에서 전액 취소와 유효 잔여 재적용을 같은 transaction으로 합성하고 원 감사 보존. 조회 미확정은 잔액을 추측하지 않는다. | 같은 c268ccf8 원격 실행 소스 검증. 보류 수입 거래처 제한은 유지한다. |
| 거래처원장에서 수동 분개 작성과 저장 후 조회 | 기존 VoucherComposer에 현재 거래처 초기값을 주고 기존 issuedStatements 서버 저장으로 연결. PartnerLedger.manualVoucher 실제 UI4시험: 차대 저장→원장 반영, 불확실 저장 원문 재개, 회사 전환, 현금 콜백 라우팅. 현재 거래처 초기값이 복구 원문을 덮지 않는다. | e29d56eb/결과043a1d09. 통합10suite95PASS, 타입·양앱 빌드·Hosting/Rules 성공, HTML·27JS 및 Rules SHA 일치. docs/todo-voucher-ledger-deployment-20261009.md 참조. |

## 양사 적용 설정

사용자 ‘양사 모두 활성화’에 따라 appMeta/partnerAdvanceCutover_taebaek 및 punghoe 두 문서만 조건부 단일 transaction으로 적용했다. 2026-10-09 03:40:22 UTC 적용 후 독립 읽기로 정확 본문·나노초 버전을 확인했고 금융 문서·operation·다른 설정 버전은 불변이었다. docs/partner-advance-activation-20261009.md 참조. 과거 전표 금액 변경이나 재발행은 없었다.

## 원문 기준 판정과 한계

원본의 ‘별도 수동 분개 저장소 미포함’은 당시 배포 범위 기록이다. 별도 컬렉션 신설이나 한 분개에 여러 거래처를 입력하는 UI를 직접 필수 조건으로 명시한 것은 아니다. 기존 원자 서버 저장과 전체 계정 원장에 연결한 실제 작성 경로를 기준으로 인수하며, 존재하지 않는 저장소를 구현했다고 주장하지 않는다. 이전 부분 인수 기록은 역사 근거로 보존한다.

시험은 서로 겹치는 누적 실행을 합산하지 않는다. Admin Firestore SDK 근거를 HTTP 인증 E2E로 확대하지 않는다. 이번 인수 문서 작성의 운영 쓰기·노션 쓰기·GitHub 푸시는 모두 0이다. 전체 앱의 모든 화면 E2E 완료를 뜻하지 않는다.

총괄 확정 집계: 원본43개 중 전체 인수9개·잔여34개. 우선15개 중9개 인수·6개 잔여는 022, 039, ERD-DICTIONARY, 026, 011, RETURN-OFFSET이다. 새 022 기초 저장 전환은 SDK·배포 미확정이므로 집계에 포함하지 않는다.
