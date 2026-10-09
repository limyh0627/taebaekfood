# 입고·반품 후속 검증 — 배포 완료·실제 화면 전체 인수 미완료

아래 초안 대기 문구는 초기 검증 시점의 이력이며, 최신 결과는 문서 말미 최종 확인을 기준으로 한다.

원본: [TODO-INBOUND-RETURN-FOLLOWUP-20261001](https://app.notion.com/p/3ec2cda7782b81c5bc83fc8c9cb7022d). 기존 원자 입고·반품 접수/처리 계약에 목록·이력·상세 및 대기 반품 취소를 보완했다. 소스 `c7f336cf` 정확24파일 로컬 commit 기준이며 계좌 지정 후속과 검증 묶음을 공유한다.

선택4 Functions 배포와 서버 원격 소스 확인은 완료했으며, 최종 후속 앱 타입·빌드 및 Hosting 확인은 대기다. 이번 문서로 원본 전체 완료를 판정하지 않는다. 전체20완료·23잔여와 GitHub 푸시 보류를 유지한다.

추가 클라이언트 보완은 취소 expectedRequest에서 cancellationOperations만 제외하여 거절 감사가 다음 감사 안에 중첩되는 것을 막는다. 서버 CAS의 기존 제외 필드와 같으며, 후속 소스 `cbd74974`의 targeted12 PASS는 기존11과 신규1이며, 최종 앱 타입·빌드는 대기다. 아래 초기115 결과와 중복 합산하지 않는다.

## 실제 동작과 보존 경계

| 변경 | 계약과 검증 |
| --- | --- |
| 목록·이력·상세 | 실제 ItemList 경로의 입고·반품 상세 회귀와 부모 배선을 확인했다. 예전 대기 화면의 완료 기록 숨김과 이력 조회를 구분하며, 모달에서 제거한 이력을 탭의 과거 기록 삭제로 확대하지 않는다. |
| 처리 대기 반품 취소 | cancelPendingReturnCommand는 원접수 receipt와 returnSubmissionOperations accepted 원문을 확인한다. pending 원문을 CAS로 대조하고 tombstone·cancellationReceipt를 같은 문서에 저장한다. 접수·수량 이력은 보존하며 재고·분개·전표·번호·금융 문서를 취소하지 않는다. 처리 완료 반품 취소는 지원 범위가 아니다. |
| 취소 거절과 재개 | cancellationOperations에 같은 작업의 full command·actor·company·hash를 바인딩한 rejected 결과를 보존한다. 이 감사 map만 원문 CAS와 성공 replay beforeHash에서 제외하고 품목·금액·수량/접수 receipt는 비교한다. 불확실 응답은 같은 작업으로 재개하며 정확 terminal proof만 CAS로 해제한다. |
| 수량/처리와 경합 | 같은 returnRequests 문서를 읽고 쓰는 TX로 경쟁을 직렬화한다. 취소 뒤 새 수량 요청은 durable rejected 결과로 확정하고, 이미 성공한 수량 요청 replay는 원 결과를 유지한다. processReturnCommand는 첫 금융/재고 쓰기 전에 tombstone을 확인해 거절한다. |
| 취소 replay | 최초 성공과 같은 작업·actor·본문은 duplicate로 재확인한다. 성공 tombstone 이후 다른 새 작업은 성공 불가를 감사로 확정하며 기존 성공 receipt는 덮지 않는다. 같은 ID의 actor/본문 충돌과 unknown은 안전한 성공/거절 proof로 추정하지 않는다. |
| 기존 원자 입고 | 기존 purchase order 전체 입고 명령을 유지한다. 새 독립 임의 입고·재고 직접 쓰기·처리 완료 전표 삭제/재고 복원 우회는 만들지 않는다. |

## 확인된 검증과 아직 부족한 조건

- 최종 focused `26653 → 9abea4`: 이번 통합8파일115 PASS.
- actual Admin Firestore TX SDK `31983 → 3d9581`: 취소6·수량5 PASS. 계좌 지정3을 포함하는 묶음 전체는3파일14 SDK, focused와 합쳐 고유11파일129 PASS다. 이전 실행을 중복 합산하지 않는다.
- 취소 순수10·서비스11 및 기존 UI 근거는 위 최종 묶음과 구분한다. actual Admin TX를 actual Auth/callable 전송 시험이라고 기록하지 않는다.
- 전체 앱 타입·Functions69 JS compile·관리자/직원 build `81511 → 2230fa` exit0. 보존된 기존4 compiled 파일은 finally 복원했다. 독립 CAS 검수 P1/P2 없음.
- 공통 modal shell 합성 fixture12 및 정확 UI17은 통과 근거지만 원본의 실제 운영 앱360/390px 전체 입고·반품 시나리오를 대체하지 않는다. 해당 실제 화면 전체 인수가 아직 남으므로 whole 완료0이다.

운영 DB·재고·금융·gate 변경0, 운영 가짜 입고/반품 생성0, Notion 쓰기0, GitHub 푸시0이다. 배포 실파일 검증과 실제 화면 인수는 총괄의 후속 결과가 도착한 뒤 추가한다.

서버 배포 28860 → c93bf4 exit0, 메타 읽기 310e6 및 원격 비교 467d52 exit0: 선택4 함수의 원본69·compiled69 모두 byte 일치, 전체33 ACTIVE/Node22, 나머지29 source 및 eventTrigger 불변을 확인했다. 후속 서비스 신규1을 포함하는 이번 묶음 고유 결과는11파일130(순수116·Admin SDK14)이다. 최종 후속 앱 검증 43707은 진행 중이며 신규 Hosting은 아직 미완료다.

최종 후속 앱 타입·양앱 build43707 exit0, Hosting86780 exit0 및 원격72682(8473bf) exit0으로33JS와 양 HTML entry가 일치했다. 총괄은 LOAN 원본 전체를 수용하여 원본43개 중21완료·22잔여, 우선15개 중11완료·4잔여로 확정했다. INBOUND 후속은 실제360/390px 전체 화면 인수가 남아 전체 미완료다. 운영 DB·신규 gate·GitHub push·Notion·Figma 쓰기0이다.
