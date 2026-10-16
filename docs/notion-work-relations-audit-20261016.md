# 노션 대표 업무·후속 관계 감사 · 2026-10-16

사용자가 지정한 네 TODO 중 ERD·노션 정리의 남은 산출물이다. 새 코드 오류 발견 여부와 무관하게 기존 업무의 관계를 정리한다. 원본 TODO 전체 완료 수는26·잔여17을 유지한다.

## 범위와 대조 방법

현재 작업 DB `collection://494aa41c-df41-4d81-b9e1-912704afcfad`의 `구분=할일 또는 본부장판단`을 제한500의 읽기 SQL로 조회해85행·has_more=false를 확인했고, 해당85페이지를 개별 조회했다. 현재작업 행과 다른 Notion DB·일반 페이지·Figma는 이번 전수 범위 밖이다. 도구가 안내한 rows 모드는 커넥터 형식 검증에서 거절돼 동일 읽기 SQL로 대조했다. SQL 결과는 링크·서식 손상의 증거로 사용하지 않고 원본 페이지 속성·본문을 별도로 읽었다.

72할일행 중 이름·관리키·본문이 모두 빈1행을 분리하면 이름 있는 할일71·판단13, 총84개다. 관리키 중복0, 분류 배정 누락0·중복0이다. 과거 원본43개는 관리키와 페이지를 모두 대조해26완료·17잔여가 일치했다. 현재DB85행, 이름 있는84개, 원본43개는 서로 다른 모집단이다.

비공개 근거 `work/notion-work-relations-source-20261016.json`은36311바이트·SHA256 `825c1505870e0379ab08d014387f24dcad8f08b48726d39947a24fe29849f1f0`다. 메타데이터·URL·분류·네 대표 본문 발췌만 보존한 자료이며 전체 원문 백업은 아니다. 큰 실행문 제한 때문에 전체 본문을 파일로 저장한 것으로 주장하지 않는다. 빈행은 조회 당시 속성·본문으로 확인했지만 삭제·아카이브하지 않았다.

## 병합 대신 연결할 관계

제목이나 분야가 비슷하다는 이유로 완료 조건·근거를 합치지 않는다. 아래10관계는 대표 열람 지점을 제시하는 탐색 관계이며, 소유권 변경·엄격한 부모/자식 모델·새 작업 생성이 아니다. 기존 입고·반품5페이지의 연결은 앞선 정리 결과로 보존하고 이번에 다시 쓰지 않는다. 과거 본문의 ‘미배포·미완료’와 최신 속성·후속 근거가 다를 수 있으므로 이번에는 상태를 덮어쓰지 않는다.

| 주제 | 대표 열람 지점 | 관련 범위 | 합치면 안 되는 인수조건 |
|---|---|---|---|
| 외주 통합 | [031 통합](https://app.notion.com/3e82cda7782b81fe8483e249098362c1) | [028](https://app.notion.com/3e82cda7782b8137b6ebe6878d1e1ce4) · [032](https://app.notion.com/3e82cda7782b811f9bc1f5a9df34c7ef) · [033](https://app.notion.com/3e82cda7782b8196acb5ea462208f320) · [035](https://app.notion.com/3e82cda7782b81d098fdfdf8a84cf934) | 원가 계약·로트번호·가공비 번호·확인요청 경합은 통합의 다른 조건이다. 부분 기능 완료를 미입고 월말 평가 연결 완료로 보지 않는다. |
| 필드 정리 | [039 호환 제거](https://app.notion.com/3e82cda7782b8142b375fcdd3dcda820) | [029](https://app.notion.com/3e82cda7782b8104b505c255b84b67e0) · [030](https://app.notion.com/3e82cda7782b81479754ff177642120f) · [037](https://app.notion.com/3e82cda7782b81bfb1a0f8deea95c7a4) · [038](https://app.notion.com/3e82cda7782b812aa135f4b3b1e9c20f) · [040](https://app.notion.com/3e82cda7782b815693cedf9f4cc58ae2) | 박스·price·백업·생성물·직접 writer 제거는 범위와 복구 조건이 다르다. 현재 남은 채널 표식·분류 호환을 삭제 완료로 묶지 않는다. |
| 거래처 지급 | [지급 원자 처리](https://app.notion.com/3ec2cda7782b816c97bdf7a767641850) | [푸미 표시](https://app.notion.com/3e82cda7782b81debe25fc428ca62c72) · [전체 계정 원장](https://app.notion.com/3ec2cda7782b81888066f4cbfdc08fab) | 잔액을 보여주는 수정, 채무계정에 맞춘 지급 저장, 모든 계정의 원장 조회는 서로 다른 인수조건이다. 과거 푸미 지급 귀속 판단도 별개다. |
| 대출 상환 | [015 자동발행](https://app.notion.com/3e82cda7782b81c1b0c3c08bec658ec5) | [계좌 선택 완화](https://app.notion.com/3ed2cda7782b810d87b3cd96dc01e04b) · [계좌 귀속](https://app.notion.com/3ed2cda7782b8189b5d8e9eb44be0d78) · [004 과거 계약 귀속](https://app.notion.com/3e82cda7782b815ea141d4acd96feb28) | 계좌 입력 편의·장부 귀속·자동발행·옛 전표 계약 연결을 병합하지 않는다. 후속 관계만 표시한다. |
| 전표 양식 | [016 종류 명시](https://app.notion.com/3e82cda7782b81f8a3f3eab0ab92b468) | [양변 복제](https://app.notion.com/3e82cda7782b81d09e3fff81714d7a56) · [양식 상세](https://app.notion.com/3e82cda7782b81a98976e926205a66ec) · [선택창 경계](https://app.notion.com/3ed2cda7782b816eb02dd79d557201c9) | 종류 선택, 분개행 복제, 양식 관리, 선택창 배치는 다르다. 최신 여섯 갈래 배포를 기존 양식 운영자료 자동 이관으로 보지 않는다. |
| 주문 입력 | [019 판독 규칙](https://app.notion.com/3e82cda7782b8168a669d5cc37d44d7a) | [026 첨부 공유](https://app.notion.com/3e82cda7782b812f999cece33a9ebef6) · [거래처 검색](https://app.notion.com/3ee2cda7782b81ec99bef16a011bc15d) | 입력 원문을 받는 기능과 원문을 해석·확정하는 기능, 거래처 선택 UI는 서로 다른 단계다. |
| 생산·제출물 | [생산작업기록부](https://app.notion.com/3e82cda7782b81f2986bdd65f150cb67) | [009 과거 생산 출처](https://app.notion.com/3e82cda7782b8130b8b0fd3edb4611d3) · [착유 실측](https://app.notion.com/3eb2cda7782b81c7b297dde672958978) | 서류 편집·저장·출력 기능이 있어도 과거 실제 생산·투입·LOT와 원양식 일치까지 입증하지 않는다. 이번에 제외한 자료 조사를 재개하지 않는다. |
| 스마트스토어 | [025 API 연동](https://app.notion.com/3e82cda7782b8141b3aae2847e2bdd12) | [039 옛 표식 호환](https://app.notion.com/3e82cda7782b8142b375fcdd3dcda820) | 주문 API 연결과 기존 품목의 채널 표식은 다른 작업이다. 표식 정리를 API 재개로 해석하지 않는다. |
| 앵커 | [043 거래처 연말 앵커](https://app.notion.com/3e82cda7782b81c680fee58386475657) | [011 품목 실사 앵커](https://app.notion.com/3e82cda7782b8163ba07e8d4dd4e9a62) | 같은 앵커라는 말이어도 거래처 채권·채무와 품목 재고의 기준 자료가 다르다. 연말 준비 완료와 실물 실사 완료를 합치지 않는다. |
| 품질 기반 | [040 공용 명령](https://app.notion.com/3e82cda7782b815693cedf9f4cc58ae2) | [041 에뮬레이터 검증](https://app.notion.com/3e82cda7782b81b39f8df70d0cbf07e9) · [ERD·사전](https://app.notion.com/3e82cda7782b813d9113f6ea2a696875) | 저장 경로 구현, 경계 검증, 구조 문서화는 서로의 근거를 연결하지만 동일 완료 항목은 아니다. |

## 전수 목록의 탐색 묶음

아래16묶음은84개 이름 있는 행을 정확히 한 번씩 배정한 탐색 색인이다. 같은 묶음이라는 이유로 의미 중복 또는 완료로 판정하지 않는다. 숫자 관리키는 원문 그대로 유지한다.

### 주문 입력·운영 목록·공유 · 6개

- [주문 비고 단일화·모바일 주문 리스트를 배포 전 최종 검수한다.](https://app.notion.com/3e82cda7782b816e87eff0aa4829cc20) — `TODO-20260927-001`
- [주문 리스트의 비고 검색 결과와 상태별 건수 집계를 대조한다.](https://app.notion.com/3e82cda7782b811daa30d1386ca6177b) — `TODO-20260927-002`
- [복사주문 판독 규칙이 사용자 확정 결과를 바탕으로 개선되게 만든다.](https://app.notion.com/3e82cda7782b8168a669d5cc37d44d7a) — `TODO-20260927-019`
- [안드로이드 Web Share Target과 오피스톡 첨부 업로드를 통합한다.](https://app.notion.com/3e82cda7782b812f999cece33a9ebef6) — `TODO-20260927-026`
- [월이 바뀌어도 진행 중 주문을 주문관리 운영 목록에 이월 표시한다](https://app.notion.com/3ee2cda7782b81319823c822baff9e2b) — `TODO-ORDER-ACTIVE-CARRYOVER-20261004`
- [주문 등록 모달 거래처 검색 결과가 스크롤 아래에 가려지는 문제 수정](https://app.notion.com/3ee2cda7782b81ec99bef16a011bc15d) — `TODO-ORDER-PARTNER-SEARCH-20261003`

### 생산·원료 사용·과거 근거 · 6개

- [압착 파생입고 부분 실패를 성공으로 표시하지 않도록 결과 타입과 UX를 재설계한다.](https://app.notion.com/3e82cda7782b8164a562e5ee699010bb) — `TODO-20260927-005`
- [9/9 엘생명 54박스 등 과거 원료 누락 의심 주문의 생산 출처를 확인한다. 자체 생산 완제품의 원료 사용량이 0kg이면 작업완료를 막는 재발 방지 코드는 9/25 로컬에 구현·…](https://app.notion.com/3e82cda7782b8130b8b0fd3edb4611d3) — `TODO-20260927-009`
- [배송·선물세트 kit 차감을 실제 BOM 구조에 맞게 통합한다.](https://app.notion.com/3e82cda7782b81ae9e89e001778c9b56) — `TODO-20260927-034`
- [2026-09-18 생산 시점 부족 이월 7건의 실제 이력을 대조한다.](https://app.notion.com/3eb2cda7782b81798af0f97a5be7e36c) — `TODO-BACKFILL-SHORTAGE-20260918`
- [PET 음수 재고의 과거 이력과 현재 원장 일치를 확인한다.](https://app.notion.com/3eb2cda7782b81d4ba94ca4bbe2ef55f) — `TODO-PET-NEGATIVE-AUDIT-20260927`
- [2026년 8월 26·31일 참깨 착유의 실측량을 확인한다.](https://app.notion.com/3eb2cda7782b81c7b297dde672958978) — `TODO-SESAME-PRESS-202608`

### 입고·반품·직원 명령 · 9개

- [로트 목록·상세·다중 혼합 사용을 에뮬레이터에서 검수한 뒤 배포한다.](https://app.notion.com/3e82cda7782b814da781d50a18c53d18) — `TODO-20260927-006`
- [매입전표에서 `입고대기에 추가할까요?`의 대상 선정 방식을 개선한다.](https://app.notion.com/3e82cda7782b81729fcbc1ca214b0b08) — `TODO-20260927-018`
- [직원 주문·발주·반품·입고를 한 정규화 명령으로 통과시키고 관리자 구독·번들을 분리한다.](https://app.notion.com/3e82cda7782b81c199e4cf3b5e086d45) — `TODO-20260927-020`
- [비원료 입고도 작업번호, before/after 재고, 입고 기록을 한 transaction에 저장한다.](https://app.notion.com/3e82cda7782b81a9a6faec31aa492d4f) — `TODO-20260927-021`
- [입고·반품 상세·이력·안전 삭제와 모바일 모달 후속을 완성한다.](https://app.notion.com/3ec2cda7782b81c5bc83fc8c9cb7022d) — `TODO-INBOUND-RETURN-FOLLOWUP-20261001`
- [입고 화면에 입고확정 전용 버튼을 별도로 만들고 상세창 잔여 범위를 처리한다](https://app.notion.com/3ee2cda7782b819e92ddcfd5efbd85dd) — `TODO-INBOUND-SEPARATE-BUTTON-20261003`
- [반품 전표를 역분개로 발행하고 같은 방향 미결잔액에 자동 배분하며 거래처 누적잔액을 원장과 일치시킨다.](https://app.notion.com/3ed2cda7782b818d8a05cfae4638bcc7) — `TODO-RETURN-OFFSET-20261002`
- [반품은 원거래 역분개로 채권·채무를 줄이고 같은 거래처·같은 거래방향의 미결 전표에 자동 배분한다.](https://app.notion.com/3e82cda7782b81cbb1b8da635ab03d00) — `DECISION-20260927-011`
- [직원 업무 범위: 주문·발주·반품·입고·재고실사 중 직원이 직접 처리할 범위 결정.](https://app.notion.com/3e82cda7782b81ac8578e64249ddcffd) — `DECISION-20260927-012`

### 재고·로트·실사 · 6개

- [제품별 원장의 독립 검증 기준을 전 품목에 세운다.](https://app.notion.com/3e82cda7782b8163ba07e8d4dd4e9a62) — `TODO-20260927-011`
- [재고 상세창의 실사반영·캔 개봉을 창 안에서 펼쳐 처리](https://app.notion.com/3eb2cda7782b81ec9da1cf4d7f354b09) — `TODO-INVENTORY-DETAIL-INLINE-20260930`
- [재고 수량 숫자 정렬·카테고리/서브타입 상단 필터 복구](https://app.notion.com/3e82cda7782b81ecbc5fce01b3e7ddb9) — `TODO-STOCK-ALIGN-FILTER-20260927`
- [재고·로트 불일치 후속 확인: 6호박스와 로트 없는 완제품/캔](https://app.notion.com/3ec2cda7782b8180a116d559d5311cea) — `TODO-STOCK-LOT-GAPS-20261001`
- [박스 재고: 제조한 박스를 그대로 출고하는지, 출고 때 낱개로 풀어 다시 포장하는지 결정.](https://app.notion.com/3e82cda7782b81abb990cbb3aa2ea97e) — `DECISION-20260927-006`
- [정정 스크립트 원칙: 모든 재고 정정에 공용 원자 명령을 의무화하고 구조 이관만 예외로 둘지 결정.](https://app.notion.com/3e82cda7782b8165b022f77be6641b97) — `DECISION-20260927-013`

### 품목 연결·정보 · 3개

- [품목이 삭제됐는데 남은 `partner_item` 16건을 원래 품목 확인 후 정리한다.](https://app.notion.com/3e82cda7782b81798674c4eeda305eec) — `TODO-20260927-014`
- [품목 연결 모달에서 서브타입·카테고리·규격으로 품목을 좁혀 찾는다](https://app.notion.com/3ec2cda7782b813bb24bfb0ac9b94d50) — `TODO-ITEM-LINK-FILTERS-20261001`
- [품목 정보에 사진을 업로드하고 상세에서 표시한다](https://app.notion.com/3ee2cda7782b81b7afabed5938ed085f) — `TODO-ITEM-PHOTO-20261003`

### 전표 종류·번호·공용 계산·양식 · 12개

- [금액 입력칸 천 단위 쉼표 표시를 배포 전 최종 검수한다.](https://app.notion.com/3e82cda7782b81508564dfb9d44e50eb) — `TODO-20260927-003`
- [전표 템플릿에서 매입 종류를 명시적으로 선택하게 한다.](https://app.notion.com/3e82cda7782b81f8a3f3eab0ab92b468) — `TODO-20260927-016`
- [옛 미발행 정리용 더미 전표를 주문별 `전표 발행 제외` 기록으로 이관한다.](https://app.notion.com/3e82cda7782b81c9a7ced8b13fb7b04c) — `TODO-20260927-017`
- [전표번호를 회사·날짜별 서버 transaction으로 발급하고 앱과 Functions가 같은 카운터를 쓴다.](https://app.notion.com/3e82cda7782b81f9a7d2f9da762f5a3d) — `TODO-20260927-022`
- [날짜·전표번호·재고평가·BOM 원가·자동전표 계산을 앱과 Functions의 공용 순수 함수로 합친다.](https://app.notion.com/3e82cda7782b8143abc8c73e9c36b563) — `TODO-20260927-023`
- [회계·전표 모듈 분리를 `로컬전용/docs/전표-원가-원장-재무-통합설계.md` 9\~12장대로 계속한다.](https://app.notion.com/3e82cda7782b8184a59fccb4dbb3bef7) — `TODO-20260927-024`
- [줄별 분개 템플릿 복제 때 transferLines를 보존한다.](https://app.notion.com/3e82cda7782b81d09e3fff81714d7a56) — `TODO-TEMPLATE-CLONE-LINES-20260927`
- [템플릿 클릭 상세보기와 상세 안 설정·수정·삭제·복제·숨김](https://app.notion.com/3e82cda7782b81a98976e926205a66ec) — `TODO-TEMPLATE-DETAIL-20260927`
- [템플릿 선택 모달의 그룹·카드 경계를 명확히 한다.](https://app.notion.com/3ed2cda7782b816eb02dd79d557201c9) — `TODO-TEMPLATE-MODAL-BOUNDARY-20261001`
- [모바일 전표 목록의 작업 버튼이 페이지 가로 넘침으로 잘리지 않게 한다](https://app.notion.com/3ec2cda7782b81db9954e2b33e46c299) — `TODO-VOUCHER-MOBILE-OVERFLOW-20261001`
- [표준 계정과목: 원재료비·부재료비 500/505를 어느 표준 계정으로 옮길지 결정.](https://app.notion.com/3e82cda7782b81d793dff5f33f5cf57f) — `DECISION-20260927-003`
- [과세·면세 11건: 같은 거래처·물건의 박스와 낱개 중 어느 과세구분이 맞는지 결정.](https://app.notion.com/3e82cda7782b81a9afd9f054279befaa) — `DECISION-20260927-008`

### 대출 상환·계좌 귀속 · 4개

- [기존 차입·상환 전표의 대출별 귀속은 나중에 본부장 확인 후 진행한다.](https://app.notion.com/3e82cda7782b815ea141d4acd96feb28) — `TODO-20260927-004`
- [대출 연결 상환 템플릿의 서버 자동발행을 안전하게 지원한다.](https://app.notion.com/3e82cda7782b81c1b0c3c08bec658ec5) — `TODO-20260927-015`
- [계좌 미지정 상환 전표의 분개·계좌별 잔액 귀속을 검증한다.](https://app.notion.com/3ed2cda7782b8189b5d8e9eb44be0d78) — `TODO-LOAN-REPAYMENT-ACCOUNT-LEDGER-20261002`
- [대출 상환 전표의 출금 계좌 선택을 선택 사항으로 푼다.](https://app.notion.com/3ed2cda7782b810d87b3cd96dc01e04b) — `TODO-LOAN-REPAYMENT-ACCOUNT-OPTIONAL-20261001`

### 거래처원장·지급·기초·운영 판단 · 11개

- [푸미푸드 매입 누적잔액 누락을 실제 전표·분개와 대조한다.](https://app.notion.com/3e82cda7782b81debe25fc428ca62c72) — `TODO-FUMIFOOD-BALANCE-20260927`
- [매입 지급의 원분개 채무계정·계정별 배분과 자금전표/결제 연결을 원자 저장한다.](https://app.notion.com/3ec2cda7782b816c97bdf7a767641850) — `TODO-PAYMENT-ATOMIC-20261001`
- [거래처원장에 모든 거래처 전표·분개를 계정별로 보여주고 잔액을 분리한다](https://app.notion.com/3ec2cda7782b81888066f4cbfdc08fab) — `TODO-PARTNER-LEDGER-ALL-ACCOUNTS-20261001`
- [거래처통계 월 선택형 거래처별 정산 PDF 양식을 만든다.](https://app.notion.com/3eb2cda7782b81ba94effc0e82b82bbe) — `TODO-PARTNER-MONTHLY-SETTLEMENT-PDF-20260930`
- [첫 사용 시 회사별 기초자료 등록과 장부 연결을 정상화한다](https://app.notion.com/3ee2cda7782b81a1aed7d7209ff6b964) — `TODO-INITIAL-DATA-SETUP-20261004`
- [수입 거래처 선급금 23,174,870원 상계의 대상 매입과 적용액을 확인한다.](https://app.notion.com/3eb2cda7782b810c9fabe9f21323cadd) — `TODO-IMPORT-ADVANCE-OFFSET-20260924`
- [풍회 계정과목 최신화 후 남는 템플릿 경고 확인](https://app.notion.com/3e82cda7782b81fe9db5fb4bde5e37ea) — `TODO-PUNGHOE-ACCOUNTS-20260927`
- [회계 기초잔액 배포 후 확인: 운영 DB의 `openingBalances/main`에는 2026-07-31 기준](https://app.notion.com/3e82cda7782b8197b86bff67f19b84e6) — `DECISION-20260927-004`
- [650 카드대금 13,042,321원 재분류: 카드대금은 비용 계정이 아니라 결제수단/카드미지급 정산이다.](https://app.notion.com/3e82cda7782b81e0bac2f13421d074bb) — `DECISION-20260927-005`
- [낱개 판매단가 7건: 박스 단가의 1/입수로 들어간 낮은 값을 바로잡을지 결정.](https://app.notion.com/3e82cda7782b815ea049e51903eb3756) — `DECISION-20260927-007`
- [전표·주문 불일치 5건: 실제 납품 품목을 확인해 연결을 결정.](https://app.notion.com/3e82cda7782b812a9e91d379fd3710ea) — `DECISION-20260927-010`

### 외주 원가·번호·통합 · 6개

- [매입단가에 단위와 성격(원물·임가공)을 추가하고 `purchase` 원가 산식을 확정한다.](https://app.notion.com/3e82cda7782b8137b6ebe6878d1e1ce4) — `TODO-20260927-028`
- [완사입·임가공을 외주창고·Backflushing·가공비 계정까지 포함한 한 모델로 통합한다.](https://app.notion.com/3e82cda7782b81fe8483e249098362c1) — `TODO-20260927-031`
- [OEM 입고 로트번호를 화면 목록이 아닌 DB 거래 안에서 충돌 없이 발급한다.](https://app.notion.com/3e82cda7782b811f9bc1f5a9df34c7ef) — `TODO-20260927-032`
- [가공비 전표번호 `claimDocNo`를 서버에서 원자적으로 발급해 동시 발행의 번호 중복을 막는다.](https://app.notion.com/3e82cda7782b8196acb5ea462208f320) — `TODO-20260927-033`
- [OEM 가공비 확인요청의 동시 생성·덮어쓰기 가능성을 없앤다.](https://app.notion.com/3e82cda7782b81d098fdfdf8a84cf934) — `TODO-20260927-035`
- [임가공 수불부 153kg: 과거 표시용 사용기록을 보충할지 결정.](https://app.notion.com/3e82cda7782b81dbb7d0c2758ae7f4d5) — `DECISION-20260927-009`

### 매입 단위·품목 원가·옛 필드 · 3개

- [품목별·매입처별 복수 매입단위를 지원한다.](https://app.notion.com/3e82cda7782b81c6bc85f81f006a2551) — `TODO-20260927-027`
- [박스 개입수·규격 파생값과 옛 호환 필드를 단계적으로 제거한다.](https://app.notion.com/3e82cda7782b8104b505c255b84b67e0) — `TODO-20260927-029`
- [`Product.price`를 `cost`로 통합한다.](https://app.notion.com/3e82cda7782b81479754ff177642120f) — `TODO-20260927-030`

### 호환 정리·품질·기반 · 12개

- [App Check를 모니터링한 뒤 강제 모드로 전환한다.](https://app.notion.com/3e82cda7782b81568e76d775ac3b43b6) — `TODO-20260927-008`
- [React hook 의존성 경고를 실제 오류와 오탐으로 나눠 고친다.](https://app.notion.com/3e82cda7782b81bb9fe2e7e54836d0e6) — `TODO-20260927-036`
- [import graph에서 미사용으로 확인한 백업 사본·호환 파일을 기록 가치와 외부 참조까지 확인한 뒤 정리한다.](https://app.notion.com/3e82cda7782b81bfb1a0f8deea95c7a4) — `TODO-20260927-037`
- [`functions/lib` 생성물을 Git에서 빼고 미사용 패키지·AI 청크를 정리한다.](https://app.notion.com/3e82cda7782b812aa135f4b3b1e9c20f) — `TODO-20260927-038`
- [deprecated 필드의 쓰기·읽기·DB 잔존량·대체 필드·삭제 버전을 표로 만들고 제거한다.](https://app.notion.com/3e82cda7782b8142b375fcdd3dcda820) — `TODO-20260927-039`
- [직접 Firestore 호출과 정정 스크립트를 공용 명령·서비스로 옮긴다.](https://app.notion.com/3e82cda7782b815693cedf9f4cc58ae2) — `TODO-20260927-040`
- [Firebase Emulator 기반 E2E를 붙인다.](https://app.notion.com/3e82cda7782b81b39f8df70d0cbf07e9) — `TODO-20260927-041`
- [2026-10-30 전: Cloud Functions Node.js 20 → 22. 함수 6개 확인 후](https://app.notion.com/3e82cda7782b812a99f4e353bdfbffc5) — `TODO-20260927-042`
- [로그아웃·삭제 확인 알림의 중복 표시를 재현하고 막는다.](https://app.notion.com/3e82cda7782b815296a9ffdd1600a603) — `TODO-DIALOG-DEDUPE-20260927`
- [로컬 테스트 안내 띠가 관리자 화면 상단 제목을 가리지 않게 한다](https://app.notion.com/3ec2cda7782b812a8fcaeb2fc2de1099) — `TODO-LOCALTEST-BANNER-OVERLAP-20261001`
- [노션 프로젝트 정리·현재/지향 ERD와 전체 필드 사용처 사전을 완성한다.](https://app.notion.com/3e82cda7782b813d9113f6ea2a696875) — `TODO-ERD-DICTIONARY-20260927`
- [옛 Storage 원본 73개: 회사 경로 복사·MD5·참조 전환 완료. 최종 대조 후 삭제할지 결정.](https://app.notion.com/3e82cda7782b81de83afcbf0ec300e62) — `DECISION-20260927-001`

### 생산 서류 · 1개

- [docs 생산일지 양식 기반 생산작업기록부 업그레이드·내용 입력](https://app.notion.com/3e82cda7782b81f2986bdd65f150cb67) — `TODO-PRODUCTION-DOC-FORM-20260927`

### 인사·권한·퇴직급여 · 2개

- [급여대장 퇴직급여충당·중간정산 구조 검토 후 확인](https://app.notion.com/3e82cda7782b8131a0a4fdf2d94d50a1) — `TODO-RETIREMENT-DESIGN-20260927`
- [직원별 메뉴 권한: 회사 내부에서 직원마다 메뉴를 제한할지 결정.](https://app.notion.com/3e82cda7782b8100a64df257cfd436fc) — `DECISION-20260927-002`

### 연말 앵커 · 1개

- [2026-12-31 결산: 거래처 원장 앵커 생성 스크립트를 dry-run 후 적용한다.](https://app.notion.com/3e82cda7782b81c680fee58386475657) — `TODO-20260927-043`

### 스마트스토어 API 연동 · 1개

- [스마트스토어 변경 주문 조회 → 거래처·품목 ID 확인 → 사람 확인 → 저장 연동을 구현한다.](https://app.notion.com/3e82cda7782b8141b3aae2847e2bdd12) — `TODO-20260927-025`

### 주문 잠금·복구 · 1개

- [주문 삭제 실패 후 관리자 잠금 해제·복구 경로 제공](https://app.notion.com/3ea2cda7782b81149082ff57cdb55ae7) — `TODO-ORDER-UNLOCK-20260930`

## 이번 정리의 적용 경계

이번에 동일한 인수조건을 가진 병합·삭제 대상은 확정하지 않았다. 대표 업무와 독립된 후속을 연결하는 정리안이며, 기존 상태·관리키·제목·배포 이력을 보존한다. 빈행1개와 오래된 본문은 발견 사실로 남기고 임의 삭제하거나 전체 상태를 재판정하지 않는다.

독립 검수 뒤 원본 네 페이지(ERD·039·031·생산서류)에 이번 산출물과 관련 업무를 한 묶음으로 연결한다. 원본 페이지를 지우거나 완료 처리하지 않으며, Figma와 사용자 제외·보류 업무를 재개하지 않는다. 제품 소스·운영자료·서버·Rules·설정 변경이 없어 앱 재빌드·Hosting 재배포나 사전 재생성은 하지 않는다. 최종 검수와 Notion 적용 결과는 확인 후 추가한다.

설계 담당과 별도 독립 담당이 문서6파일의 계약·코드 근거·검증 경계를 대조해 수정 요청과 미해결 P1/P2가 없음을 확인했다. 독립 담당은 비공개 자료에서85/84/16 수치, 관리키와 배정의 중복·누락0, 문서의84링크 일치를 직접 재계산했다. 생산 문서의 기존 집중29개 통과와 OEM 현재 순수 함수 대표7개 확인을 새 기능·운영 시험 또는 미래 시나리오12개 통과로 합산하지 않았다.

## 원본 반영 결과

문서6파일 e00be64를 main에 반영한 뒤 ERD·039·031·생산서류의 기존 Notion 원본4페이지에 이번 결과·구체 관계·근거 링크를 한 묶음으로 추가했다. 네 페이지를 다시 읽어 추가 절 존재와 관리키·제목·진행 상태 보존을 확인했다. 기존 페이지 삭제·병합·상태 변경은 하지 않았다. 비공개 근거는 Git에 넣지 않았고 제품 변경이 없어 양 앱은 기존9882bc0 검증 배포본을 유지한다.
