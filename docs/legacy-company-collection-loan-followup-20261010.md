# 구형 경로·회사 컬렉션·대출 후속 — 배포·소스 푸시 완료

2026-10-11 현재 검증 기록이다(파일명 날짜는 기존 식별자 유지). source93376edb 정확36파일 로컬 커밋은 확정이며 Hosting·소스 푸시는 완료했고 원본 전체 추가 완료는 없다. 전체21완료22잔여 집계는 유지한다.

- **039 코드 정리:** 회사 fallback·계정 공통상수·원장 setters 명칭 정리와 loanOpening 얇은 re-export 제거를 포함한다. 기존 회사 선택·계정 값·계산·호출 동작과 financialOpening 직접 경로의 기존 시험4개를 보존한다. 운영 legacy 데이터 삭제·이관이나 새 금융 정책으로 확대하지 않는다.
- **ERD 컬렉션 등록:** 현재 실제 사용하는11개 컬렉션을 COL에 등록해74→85로 정리하고 미등록 실제 경로 감지 guard를 검증한다. 정적 등록과 감지 결과를 운영 데이터 전체 해석이나 모든 동적 경로 해결로 확대하지 않는다. 최종 사전57496 exit0: collections85·fields717·source429·refs614·unresolved2037·knownWrapperCollections520이다. 마지막520은 caller-SDK 해석 결과 수이며 컬렉션 수가 아니다.
- **015 대출 안내:** 기존 loanAutoReady 판정을 사용해 현재 승인·배포된 정기 상환 정책에 맞는 Manager 안내를 표시한다. 관련15검사와 기존 정상 대출 동작을 확인하며 정기 상환 정책·금액·운영 설정은 변경하지 않는다.

현재 확인된 집중 검증은 총괄 정리6파일32PASS62676(187초), 독립 검수7파일76PASS(69+3+4), implementation의 canonical 상속 config·Node22 정확9파일87PASS/0FAIL f92d4a=80261 exit0(121.93초)다. 마지막 범위는 계정상수·기초·선급·감사·반품·원장을 포함하며 앞선 두 집중 범위와 중복하지 않는 것으로 대조했다. 전용 Node6PASS는 별도 근거다. 초기 private config setup 오류 및 시작 중간 exit1은 성공 결과에 합산하지 않는다. collections 원본 private7+cost1은 canonical 전체 실행 대조가 대기이며 전체 PASS는 미확정이다. 추가 독립 검수 P1/P2는 없다.

타입 검사 최초 Node24 실행은 exit1로 중단됐고 명시적 Node22 최종 타입93073→57efa0 exit0과 diff0226a1 exit0을 확인했다. AdminApp recompute의 기존 buildCostFn 입력을 src:Item[]=allItems로 보완한1hunk는 계산 본체를 바꾸지 않는다. 사전 첫 실행은 자원 경합으로 exit1 중단되어 사전57496은 exit0으로 완료했다. 전체 소스51233은 중단 exit1(0ac6c2)이며 최종 총계는 없다. scripts/todo011-daily-ledger.test.ts 8시험 중 CLI spawn30초 timeout1FAIL과 VoucherTemplateManager.statementType/HRManager.commands2파일 thread termination 반복을 확인했다. 실패3파일만 base 상속·forks1 복구82016으로 재검증하여 정확3파일23PASS exit0을 확인했다. 앞선195와 중복 없는 고유218시험이며 전용Node6은 별도 근거다. 제품 소스·기대값·30초 제한 변경0이며 통과 개수나 전체 PASS를 추정하지 않는다. 통합 후 최종 양앱56303·Hosting74768 exit0이며 원격119 SHA 대조와 실제 소스 푸시 완료를 확인했다. source93376edb의 고정36파일 manifest(제품30경로와 문서/시험 등6)는 별도 보존하며 집중 검증 합계를 최종 전체 실행 수로 대신하지 않는다. autoJournal은 기존 runtime pure 본체이며 타입 import는 type-only로 실행 코드에서 제거된다. 이번 Functions runtime 변경은0이며 Functions 빌드·배포를 필수 대기 항목으로 두지 않는다. 과거 다섯째 전체 시험 exit1과 집중30PASS를 이번 묶음 성공 근거로 대신하지 않는다.

사용자는 현재 수정 마무리·브랜치 통합·배포·GitHub 푸시를 명시 승인했다. 실제 소스 푸시13220 exit0·원격HEAD 일치를 확인했으며 운영DB·새 gate·Notion/Figma 쓰기는0이다. 사전 미해석 경로와 실물/외부답변 대기는 별도 보류이며 부분 후속을 원본 전체 완료로 합산하지 않는다.

### 2026-10-11 이관·브랜치 검토 후속(최종 배포·소스 푸시 완료)
이전용 세션·MEMORY·기록·설정은 별도 폴더 이관6파일 범위다. 브랜치 검토에서 필요한 코드가 이미 반영돼 새 merge0이며 관련6파일93PASS는 기존 시험과 겹쳐 합산하지 않는다. 배합(formula) 운영 변경은 별도 보류다. 최종 타입67257 exit0·통합 소스e6e5e49a 정확6파일67추가/10삭제 로컬 커밋, 최종 양앱56303·Hosting74768 exit0, 원격56475·실제push13220 exit0이다. 승인과 별도로 실제 빌드·Hosting·원격·푸시 성공 근거를 확인했다.

### 통합 후 빌드·Hosting 확정
양앱56303 exit0: 관리자3284/직원3286 module과 PWA 둘 다 완료했다. Hosting74768 exit0으로 양 사이트 release complete(admin71/staff72파일)를 확인했다. 원격56475 exit0에서 HTML2+JS115+CSS2 총119 SHA가 일치했다. 실제 소스 push13220 exit0, github/main은 d2876860→e6e5e49ad0dfdc0ffe24c8f4b002b6a058b551be이며 ls-remote와 HEAD가 일치했다. 결과 문서3개 커밋·푸시는 총괄 후속이다. 업로드 파일 수를 원격 SHA 대조 파일 수로 대신하지 않는다.
