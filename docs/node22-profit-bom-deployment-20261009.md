# Node22 전환·손익 투영·BOM 입력 배포 — 2026-10-09

소스 `474bc229`, 정확 15파일 로컬 커밋. GitHub 푸시 0. 원본 TODO042는 전체 인수를 확정했고, TODO024는 손익 투영 분리와 ItemList의 BOM 표시 입력 전달 두 단위만 완료했다. 전역 인덱스 setter 제거와 모듈 전체 분리는 아직 남아 있다.

원본: [TODO042](https://app.notion.com/p/3e82cda7782b812a99f4e353bdfbffc5), [TODO024](https://app.notion.com/p/3e82cda7782b8184a59fccb4dbb3bef7). 노션은 읽기만 했으며 상태를 수정하지 않았다.

## 변경과 영향

`functions/package.json` 및 lock의 Node engine만 20→22로 바꿨다. firebase-functions 5.x와 firebase-admin 12.x 선언·해결 버전은 보존했다. 원본의 함수 6개가 현재 32개인 것을 실제 배포 metadata와 index export로 대조했다. 기존 함수명·지역·진입점·callable/schedule/event/HTTP trigger metadata를 보존했다.

기존 32개 운영 ZIP은 10종 패키지였다. 현재 소스를 전체 배포하면 7개 consumer가 참조하는 업무 모듈 17개도 최신 배포 소스로 통일된다. 이를 engine 설정만의 변화라고 주장하지 않는다. 기존 6개 index 함수 자체 본문은 동일했고, OEM 가공비의 unpackTo-only 박스 판정에는 실제 동작 차이가 있어 정확 회귀를 추가했다. 각 consumer와 시험 경계는 비공개 `work/todo042-business-delta-review-20261009.md` 및 비교 JSON에 기록했다.

첫 번호 발행의 두 컬렉션 조회를 같은 transaction 안에서 순서대로 수행한다. 회사·날짜·번호 범위와 정책은 그대로다. 동시 발행 SDK에서 잠금 timeout 뒤 `Transaction invalid or closed`가 재현됐고, 수정 후 같은 실제 Node22 묶음 37개가 통과했다. 이를 Node22 자체의 결함으로 확정하지 않으며 임의 재시도·producer 직렬화는 추가하지 않았다.

ProfitAnalysis의 계정·그룹별 손익 투영을 기존 callback 본문과 동일한 순수 함수로 분리했다. 회사에서 전달받은 전표·계정·기간을 그대로 사용한다. ItemList 포장 표시에는 회사별 명시 BOM 입력을 전달한다. 기존 입력을 생략한 호출의 fallback은 유지한다. 다른 화면의 전역 인덱스 제거는 별도 후속이다.

## 검증

- 실제 Node22 v22.23.3으로 Functions 전체 단위 29파일 244개, 실제 Firestore/Auth SDK 14파일 86개(37+34+15)가 통과했다. SDK의 callable handler mock과 실제 Auth 경계는 각 suite에 따라 구분하며 운영 HTTP 발행 E2E로 확대하지 않는다.
- 손익·ItemList·BOM 관련 순수/UI 7파일 34개 통과. 두 회사의 충돌 입력에서 기존 표시가 실패하는 회귀를 확인했고 수정 후 통과했다. 손익 기존 본문 동치 검증도 보존했다.
- 전체 앱 타입, Node22 Functions 빌드, 최종 compiled index 32개 load, 관리자·직원 앱 빌드 모두 성공했다. 암호는 합성 fixture로 Node24→Node22 검증 및 잘못된 암호 거절을 확인했다. 실제 사용자 암호를 사용하지 않았다.
- 오래된 manual/loan 시험은 현재 확정 거절 감사 계약에 맞게 수정했다. 금융·원금·번호가 변하지 않는 단언을 강화했고 제품 가드는 바꾸지 않았다. 동시 producer의 시험 종료도 모두 settle한 뒤 정리하도록 보완했다.

## 배포와 원격 대조

- Functions 배포 1662 및 Hosting 51613 exit 0. 실제 32개 모두 ACTIVE/nodejs22이며 기존 트리거 metadata와 일치했다.
- 함수별 실제 ZIP에서 runtime 소스 68개와 compiled JS 68개가 최종 로컬 소스와 SHA-256 일치했다. 비공개 근거 `work/todo042-functions-source-verification-20261009.json`.
- 양 앱 HTML 진입과 주요 JS 27개가 최종 빌드와 SHA-256 일치했다. 근거 `outputs/todo042-024-hosting-verification-20261009.json`.
- 운영 금융·재고 수동 쓰기, 신규 gate 활성화, 가짜 운영 전표, Rules 재배포, GitHub 푸시 모두 0.

되돌리기에는 전환 전 함수 metadata/ZIP과 engine 두 필드의 이전 값이 보존돼 있다. 업무 소스를 유지한 검증 패키지로 runtime만 되돌리는 별도 배포를 준비할 수 있다. Node20의 지원 종료 이후 재배포 가능성을 전제로 하지 않는다. 지원 표는 [Google 공식 문서](https://docs.cloud.google.com/functions/docs/runtime-support), 설정 방법은 [Firebase 공식 문서](https://firebase.google.com/docs/functions/manage-functions)를 기준으로 확인했다.

총괄 집계: 원본 43개 중 12개 전체 인수·31개 잔여. 우선 15개는 11개 인수·4개 잔여(039, ERD-DICTIONARY, 026, 011)를 유지한다. 다음 AddOrderModal의 회사별 BOM 표시 입력 후속을 계속한다.
