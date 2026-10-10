# 원료 kg·입고 모달·구형 0원 필드 후속 — 검증 준비

2026-10-10 넷째 묶음의 준비 기록이다. 소스·양앱 빌드·배포·원격 검증은 아래 근거로 확정이며 전체21완료22잔여를 유지한다. 셋째 묶음 결과 문서711bd3d9와 구분한다.

## 범위와 현재 근거

- **028 원료 원가 입력:** 신규 전표 발행에서 원료 kg가 미확인인 경우 원가 갱신과 후단 호출을 하지 않는다. 기존 정상 전표 작성 모달을 재사용하며 readOnly 행·합계·인쇄 원문을 보존하고 normal→noncash 전환 정리와 kg/ml 표시를 보완했다. 과거 원가 추정·운영자료 이관은 없다.
- **INBOUND 모달:** ModalShell 초점 회귀4PASS와 공통 회귀12PASS, 실제 화면의3개 viewport 확인 근거가 있다. 실기기 가상 키보드는 미검증이다. 화면 크기 검증을 실제 모바일 OS·키보드 검증으로 확대하지 않으며 원본 전체 인수로 집계하지 않는다.
- **030 구형 price=0 정리 도구:** 순수5개와 합성 Admin Firestore SDK2개를 합친7PASS(루트4634), strict 검증 exit0. 자기 소유 price 필드가 정확0인 문서만 회사별로 선택하며 양수·음수·NaN·undefined·누락 값 및 cost를 바꾸지 않는다. 최대450개 조건부 atomic batch는 원문·계획 지문·나노초 버전을 검사하고 commit의 WriteResult.writeTime을 영수증에 보존한다. 사후 조회는 독립 검증이며 영수증 버전을 교체하지 않는다. undo 역시 정확한 적용 영수증 버전을 조건으로 price=0만 복원한다. 동일 원문이라도 실제 변경 후 복원으로 버전이 달라지면 undo를 거절한다. 운영 dry/apply/undo 실행은0이다.

## 배포 검증과 한계

최종 고유 검증은8파일117PASS(최종 UI5파일91PASS56463 + stable SDK15 + migration7 + ModalShell4)다. 초기7suite113PASS97168와 최종 UI 재검증을 중복 합산하지 않는다. 전체 타입24388·공식 사전 self-check66987(COL74/필드717/소스430/참조614/미해석2038)·Functions 빌드72443·스크립트 strict4634는 PASS다. 보존 compiled4파일은 복원했으며 private work/fourth-compiled 스냅샷을 구분한다. 소스74c685fe 정확19파일 로컬커밋, 양앱 빌드57291·Hosting52618 exit0, 원격54148에서 HTML2+JS115 총117 SHA가 일치했다. 선택 Functions98560 exit0, after17743 및 실제 ZIP40706 확인에서34개 ACTIVE/nodejs22 중 issueTradeStatementCommand1개만 소스가 바뀌고 다른33개와 기존 트리거는 동일했다. generation1791621405707808의 runtime72TS·compiled72JS differences[]/verifiedtrue다. canonical work/fourth-*와 planning work/fourth-hosting-verification-*에 비공개 근거를 보존한다. 이는 해당 부분 배포 확정이며 원본 TODO 전체 완료를 뜻하지 않는다. 공지 작성 후속 정확2파일은 회귀12PASS63365·3viewport QA를 마쳤으나 이번 배포에 포함되지 않았다. 새 운영DB 변경·설정 활성화·Notion 쓰기·GitHub 푸시는0이며 이 문서는 커밋하지 않았다. 운영 원문·백업·영수증은 비공개 work에 보존하고 문서에 포함하지 않는다.
