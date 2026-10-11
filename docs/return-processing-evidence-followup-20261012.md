# 반품 처리 원문 근거 후속 · 2026-10-12

## 배포 기준과 발견한 차이

기준 main fa484cf는 제품 실사·발주확정 후속 배포가 끝난 상태다. 반품 접수는 returnRequests에 남으며 처리 명령은 processGeneralStockReturnCommand의 단일 거래가 기존 반품 계획으로 전표·배분·품목/로트·원료 원장과 상태를 확정한다. 이번 후속은 그 계산을 새로 만들지 않는다.

기준 코드에서 특정 반품의 처리 버튼은 신규 접수 모달만 연다. 클라이언트 returnCommands는 원전표를 필수로 요구하지만 서버는 매출/매입 standalone 반품을 처리할 수 있다. 승인 원문은 명령에 포함되지 않아 서버의 최신 문서와 최초 승인 내용을 비교하지 못한다. 처리 성공 뒤 사용자 권한 확인 없이 pending을 정리하는 경로도 있다.

## 구현 계약 · 배포 검증 전

공용 business 원문은 회사·원전표·거래처·반품유형·금액·품목 행 및 standalone의 미지급 계정이다. 객체 키 순서는 정규화하고 품목 행 순서는 유지한다. 앱과 서버는 같은 직렬화 원문으로 SHA256을 계산한다. 새 명령의 expectedBusinessHash는 최초 승인과 단일 거래의 현재 원문이 일치할 때만 기존 계획을 적용하도록 검증한다.

새 local pending v2는 최초 원문·작업번호·날짜·정산 revision·release를 보존한다. 이미 저장된 v1 명령은 새 필드를 강제로 붙이거나 번호를 바꾸지 않고 그대로 재시도한다. 기존 요청을 새 검증을 거친 것으로 표시하지 않는다. 완료 이력에서도 보존된 요청 결과를 확인할 진입점을 연결한다.

returnRequests → returnOperations → issuedStatements/returnApplications/itemReceipts/rawMaterialLedger의 연결은 같은 회사·요청·operation으로 확인한다. 성공·확정 거절 뒤 localStorage 정리는 같은 회사·UID 및 정확히 보존된 원문일 때만 허용한다. 응답 유실은 임의 초기화나 재고 재적용 근거가 아니다.

계약 소스는 구현되었다. 실제 서버 Admin Firestore 거래 28건, 서비스 15건·공용 2건이 통과했다. callable 인증을 실제 호출한 시험이라고 확대하지 않는다. 최초 pending 조회 뒤 비동기 준비 중 다른 원문이 생기면 저장을 거절하며 해당 실제 회귀와 보호 제거 변이도 확인했다. 최종 전체 회귀·앱 빌드·배포는 아직 검증 전이다. 운영 설정과 과거 자료를 변경하지 않는다.
## 039 옛 연결 이관 경로 폐쇄

scripts/fix-drop-legacy-partnerids.mts의 기본 실행 원격 접속과 apply/undo writer를 제거했다. 이 도구가 옛 배열의 연결을 현재 판매 관계로 임의 복원하는 것은 최신 감사 조건과 맞지 않는다. 실제 partnerIds·partner_item 및 SMARTSTORE 호환 읽기는 유지하며 운영 자료·역사 기록은 바꾸지 않았다. 실제 CLI 5건과 기존 가격 조회 17건 통과, 쓰기 거절 제거 변이 2건 실패 후 원복했다. 반품 소스 동시 편집 중의 앱 타입 실패는 최종 검증으로 인정하지 않는다.
## 현재 문서 관계

| 문서·저장소 | 연결·불변 근거 |
|---|---|
| local pending v2 | 회사·반품 ID·UID 키, 최초 business 원문과 명령의 expectedBusinessHash. 준비 중 생긴 다른 원문을 덮지 않는다. |
| local pending v1 | 기존 다섯 명령 필드·fingerprint를 보존한다. 새 해시를 끼워 넣지 않는다. |
| returnRequests | 처리 시 현재 회사와 반품 business 원문을 조회한다. 상태·시각은 business 해시에 포함하지 않는다. |
| returnOperations | operation·요청·작성자·requestHash·businessHash·명령과 적용/거절 증명을 남긴다. 같은 작업의 결과 확인은 새 분개를 만들지 않는다. |
| issuedStatements / returnApplications | operation의 실제 반품 전표·정산 배분. 원전표가 있는 경우 기존 배분·역분개 계획을 사용한다. |
| itemReceipts / rawMaterialLedger / items | 품목 종류에 맞는 기존 원자 재고 계획이 기록한다. UI가 재고·금액을 별도로 계산하지 않는다. |

배포는 앱만 앞서 내보내지 않고, 새 optional 해시를 검증하는 서버 함수를 먼저 반영한 뒤 양쪽 Hosting을 반영한다. 기존 인증 생성파일 4개는 보존된 원문 SHA가 빌드 전후 같음을 확인했고 인증 함수를 배포 대상으로 선택하지 않는다.
## 최종 검증 진행

화면의 최종 실제 UI 24건·관련 63건 통과, 회사·UID·역할·상세 보호 제거 변이 4건 실패를 확인하고 정상 소스를 유지했다. 서비스는 빈 문자열 손상 키도 보존하고 조회·재개·처리를 서버 호출 없이 거절한다. readPendingReturn의 부재는 null만 의미한다. 서버 SDK와 callable 인증 시험은 구분하며 이번 서버 28건은 실제 Admin Firestore와 도메인 함수 실행이다.

첫 전체 일반 회귀는 486파일·4,138통과·7건 제외로 끝났다. 빈 문자열 추가 보완 후 최종 일반 회귀·양앱 빌드를 재검증한다. 서버 빌드는 exit 0이고 인증 생성파일 4개 SHA를 보존했다. 새 운영 gate·과거 금액·재고 변경은 없다.

최종 검증: 일반486파일·4,139PASS/7skip, 서버 실제TX28PASS·service/pure17PASS·UI24PASS/관련63PASS, CLI/기존가격22PASS. 앱/서버타입·서버빌드·양앱빌드exit0, 사전86컬렉션·725필드·452소스·620참조·2289미해석·517wrapper. 변이검출/원복 및 독립검수 P1/P2 없음. 인증생성4SHA보존. 아직 새반품 배포 완료를 뜻하지 않는다.
