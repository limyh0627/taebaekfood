# 세금 발행완료 기록 서버 전환 — 배포 검증 완료·022 재인수

초기 대기 문구는 검증 진행 당시 이력이며 최신 판정은 말미 완료 기록을 따른다.

원본 [TODO-20260927-022](https://app.notion.com/p/3e82cda7782b81f9a7d2f9da762f5a3d)의 번호 발급과 별도로, 10/3 확장 인수조건인 기존 전표 수정의 서버 이전에 해당한다. 옛 applyTaxIssueWrites Web transaction이 server-only issuedStatements Rules에 거절되어 완료 처리했던022를 재개했다. 현재 전체20완료·23잔여, 우선15 중10완료·5잔여를 유지한다.

## 실제 전환 계약

- TaxStatement → AdminApp callback → applyTaxIssueWrites → recordTaxIssueCommand로 발행 확인을 저장한다. 외부 세금 신고나 새로운 금융 전표 발행은 수행하지 않는다.
- taxIssueRecords·issuedStatements의 taxIssuedAt/exemptIssuedAt 및 수정 revision·voucherMutationOperations·taxIssueOperations를 같은 서버 transaction에 저장한다. 기존 원발행/수정 감사 사슬을 보존하며 금융 금액·분개·계좌·재고·번호 counter를 변경하지 않는다.
- 실제 관리자 UID·회사·선택 전표 전체 원문·scope·issuedAt·operationId·requestHash를 검증한다. 신규 입력은100건 이내이고, 원문이 바뀌면 저장 전 거절한다.
- pending은 회사/UID별 전체 입력을 보존한다. 닫기·재열기의 이전 저장 확인은 같은 operationId와 issuedAt으로 재개한다. exact terminal proof와 CAS만 보존 요청을 해제하며 불확실 응답·다른 창 원문은 유지한다.
- UI는 성공 뒤에만 표시·선택을 변경한다. 회사/UID 변경·unmount 이후 늦은 결과는 현재 화면에 반영하지 않는다.
- Rules는 taxIssueOperations와 taxIssueRecords의 같은 회사 관리자 get/list를 유지하고 직접 create/overwrite/update/delete·TX/batch를 거절한다. 옛 기록+원전표 metadata merge의 일부 저장도 없다. 새 서버/클라이언트 연결 완료가 배포 전제다.

## 확인된 시험과 남은 검증

| 근거 | 결과와 범위 |
| --- | --- |
| 순수/UI 최종21923 → d5fa28 | 정확9파일82 PASS. 이전 분리 시험을 중복 합산하지 않는다. |
| 실제 Admin Firestore SDK7226 → b7584e | 정확1파일8 PASS. 수정 전7개는 중복 합산하지 않는다. 실제 Auth/callable 전송 검증으로 확대하지 않는다. |
| 실제 Auth Rules49512 → a731f2 | 정확1파일104 PASS. 실제 UID가 employeeId와 다른 양사 관리자·직원·무claim의 조회/변경 거절과 원문 보존을 확인했다. |
| 최종 타입·Functions·양앱 빌드93347 | 진행 중. 완료 근거가 아니다. |
| 마지막 UI 효과 보완 | allMonths의 dependency를 원래[]로 복원했다. 최종 UI14 재검증은 빌드 이후 대기다. |
| 서버·Rules·Hosting·원격 실행 파일 | 아직 배포 완료로 기록하지 않는다. |

운영 금융·재고·gate 쓰기0, 운영 가짜 전표0, Notion·Figma 쓰기0, GitHub push0이다. 최종 배포 검증 뒤 총괄의022 재수용 판정을 별도로 기록한다.

## 최종 배포 검증·재인수

소스 a20b992f, 최종 타입·Functions 및 양앱 build41118 exit0, 마지막 UI94445의2파일21PASS를 포함하는 순수9파일82PASS·Admin SDK1파일8PASS·실제Auth Rules1파일104PASS로 고유11파일194를 확인했다. 새 UI21을82에 다시 더하지 않는다. 배포46847 exit0은 정확5 Functions·양Hosting·Rules다.

원격 함수 메타3971 및 ZIP read/비교560872 exit0: recordTaxIssueCommand·issueTradeStatementCommand·issueNumberedVoucher·deleteIssuedStatementCommand·dailyAutoVoucher 각각 runtime72/compiled72 byte 일치, 정확changed5·전체34ACTIVE/Node22·나머지29 source불변·triggerChanges[]다. 원격 Hosting59367/ec4850 exit0은27JS와 양HTML entry 일치다. Rules5f8db2 exit0: SHA a2b027748890f2a96ca93afc7a9fefb59cefe8a6a4ea8b0f8bebf75eb0ff93a4, ruleset55b1c55f-bd2c-4fb8-9090-7a8605268fdd가 로컬과 일치한다. 근거 outputs/tax-issue-hosting-verification-20261009.json 및 private work/tax-issue-source-verification-20261009.json·tax-issue-rules-verification-20261009.json.

원격 완료 입증 뒤 총괄 지시에 따라022를 재수용하여 전체21완료22잔여·우선15 중11완료4잔여로 복귀한다. INBOUND후속 전체는 미완료 유지한다. 운영 전표/재고/gate 변경·Notion/Figma 쓰기·GitHub push0이며 중복 입고 정정은 별도다.
