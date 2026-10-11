# 구형 경로·회사 컬렉션·대출 후속 — 검증 대기

2026-10-10 다음 묶음 준비 기록이다. 제품 검증 중이며 소스 커밋·배포·원본 전체 완료는 미확정이다. 전체21완료22잔여 집계는 유지한다.

- **039 코드 정리:** 회사 fallback·계정 공통상수·원장 setters 명칭 정리와 loanOpening 얇은 re-export 제거를 포함한다. 기존 회사 선택·계정 값·계산·호출 동작과 financialOpening 직접 경로의 기존 시험4개를 보존한다. 운영 legacy 데이터 삭제·이관이나 새 금융 정책으로 확대하지 않는다.
- **ERD 컬렉션 등록:** 현재 실제 사용하는11개 컬렉션을 COL에 등록해74→85로 정리하고 미등록 실제 경로 감지 guard를 검증한다. 정적 등록과 감지 결과를 운영 데이터 전체 해석이나 모든 동적 경로 해결로 확대하지 않는다. 최종 사전57496 exit0: collections85·fields717·source429·refs614·unresolved2037·knownWrapperCollections520이다. 마지막520은 caller-SDK 해석 결과 수이며 컬렉션 수가 아니다.
- **015 대출 안내:** 기존 loanAutoReady 판정을 사용해 현재 승인·배포된 정기 상환 정책에 맞는 Manager 안내를 표시한다. 관련15검사와 기존 정상 대출 동작을 확인하며 정기 상환 정책·금액·운영 설정은 변경하지 않는다.

현재 확인된 집중 검증은 총괄 정리6파일32PASS62676(187초), 독립 검수7파일76PASS(69+3+4), implementation의 canonical 상속 config·Node22 정확9파일87PASS/0FAIL f92d4a=80261 exit0(121.93초)다. 마지막 범위는 계정상수·기초·선급·감사·반품·원장을 포함하며 앞선 두 집중 범위와 중복하지 않는 것으로 대조했다. 전용 Node6PASS는 별도 근거다. 초기 private config setup 오류 및 시작 중간 exit1은 성공 결과에 합산하지 않는다. collections 원본 private7+cost1은 canonical 전체 실행 대조가 대기이며 전체 PASS는 미확정이다. 추가 독립 검수 P1/P2는 없다.

타입 검사 최초 Node24 실행은 exit1로 중단됐고 명시적 Node22 최종 타입93073→57efa0 exit0과 diff0226a1 exit0을 확인했다. AdminApp recompute의 기존 buildCostFn 입력을 src:Item[]=allItems로 보완한1hunk는 계산 본체를 바꾸지 않는다. 사전 첫 실행은 자원 경합으로 exit1 중단되어 사전57496은 exit0으로 완료했다. 전체 소스51233 단일 worker 실행은 진행 중이다. 양앱 빌드·독립 최종 검수·정확 소스 manifest·Hosting 배포/원격 검증은 최종 결과 대기다. autoJournal은 기존 runtime pure 본체이며 타입 import는 type-only로 실행 코드에서 제거된다. 이번 Functions runtime 변경은0이며 Functions 빌드·배포를 필수 대기 항목으로 두지 않는다. 과거 다섯째 전체 시험 exit1과 집중30PASS를 이번 묶음 성공 근거로 대신하지 않는다.

운영DB·새 gate·Notion/Figma 쓰기·GitHub push는0이다. 사전 미해석 경로와 실물/외부답변 대기는 별도 보류이며 부분 후속을 원본 전체 완료로 합산하지 않는다.
