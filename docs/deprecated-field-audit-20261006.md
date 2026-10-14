# TODO039 구형 필드 조사

## 2026-10-15 최신 읽기 집계와 남은 처리 조건

기존 Firebase CLI 로그인으로 등록된 여섯 최상위 컬렉션의 지정 필드만 조회했다. 조회 시각은 2026-10-15 02:32 KST이며 각 조회의 readTime을 별도 보관한다. 한 원자 스냅샷은 아니다. 문서 이름·ID·금액·토큰을 출력하지 않고 회사별 개수만 저장했다. 읽기 결과와 자기검증·독립 검수는 운영 필드 삭제나 전체039 완료를 뜻하지 않는다.

| 조회 대상 | 문서 수 | 확인 결과 |
| --- | ---: | --- |
| items | 547 | itemType·partnerId 양사 모두 0건. partnerIds 190문서, lotsAreTotal 1문서 잔존 |
| fixedCostTemplates | 101 | postMode 양사 모두 0건 |
| pallets | 8 | inUse 존재 8건. 거래기록 잔량과의 동치는 이번 조회 범위 밖 |
| accountCodes | 112 | noncash 양사 각 2건 잔존 |
| partner_item | 1,309 | Direction 판매 1,081·매입 228, 누락·null·무효 0 |
| partners | 349 | 옛 연결의 회사·보관 상태 대조에만 사용 |

태백의 옛 거래처 연결 388개 중 새 판매 연결이 없는 것은 8개다. 매입 연결만 있는 1개, 활성 미연결 2개, 보관 거래처 5개로 구분된다. 원래 판매 연결이라고 추측해 생성하지 않는다. SMARTSTORE 표식 1개는 `isSmartStore !== true`에 해당하지만 필드 누락·false·null 중 어느 것인지 이 집계로 단정하지 않는다.

가격·원가의 필드 존재도 대조했다. price만 있는 품목은 태백 140·풍회 1개이며 price를 cost로 채우는 것은 이관 근거가 아니다. 기존 원가·로트·팔레트 자료를 추가로 읽거나 변경하지 않았다. 최신 비공개 집계는 저장소 밖 `records/deprecated-field-counts-readonly-20261014.json`, SHA256 `C6C329E5C3B3225C5181C84D16B1DA9C4CBC8EF8873E8E6B1BF400A4A4CEFF9B`다.

이번 제품 후속은 원본 품목의 SMARTSTORE 호환 표식이 AdminApp의 판매 거래처 투영 과정에서 없어지는 문제다. 공용 `isSmartStoreItem`의 기존 판독을 유지하며 실제 거래처 연결은 계속 `partner_item(out)`만 사용한다. 운영 자료 이관과 구분해 설계·직접 회귀·수정을 마쳤다.

확정한 수정은 원본 품목을 공용 함수로 먼저 판독해 UI 복사본의 `isSmartStore`에 보존하는 것과 품목 편집창의 초기 표시도 같은 함수를 사용하는 것이다. `partnerIds`에 옛 거래처나 SMARTSTORE 문자열을 복원하지 않는다. 기존 `true OR legacy marker` 계약을 유지하므로 명시 false와 marker가 함께 있으면 기존대로 true다. marker 해제 정책이나 저장 자료 일괄 변경은 이 수정에 포함하지 않는다.

상위 회귀는 실제 AdminApp의 `productClientMap`·`allItems` 초기화 식을 추출해 실행하고, 세 하위 소비자의 실제 초기화 식과 props 연결을 확인한다. 전체 AdminApp 컴포넌트를 렌더링한 시험으로 표기하지 않는다. 실제 품목 편집창의 초기 표시·저장은 별도 컴포넌트 시험과 화면 검수로 확인한다. 운영 자료를 사용하는 검수는 하지 않는다.

집중 시험은 상위 투영 5개·품목 편집 17개·기존 거래처 연결 6개로 고유 3파일 28개가 통과했다. 부모의 판독 결과 보존을 제거하거나 편집 초기값을 이전 방식으로 돌리면 각각 직접 회귀가 실패했고 원본 바이트로 복원했다. 최종 타입·양 앱 빌드·실제 화면 검수와 배포는 완료 결과를 별도로 기록한다.

최종 앱 타입·관리자·직원 빌드와 독립 검수를 통과했다. 운영 연결을 차단한 실제 모달·분석 컴포넌트 화면에서 옛 표식 및 false+표식 편집의 true 저장, 일반·신규 품목의 false 저장을 확인했다. 직접 주문에는 옛 표식 두 품목만 표시되고, 복사 주문은 옛 표식 품목 1개를 성공 해석했으며, 분석 단가 관리에도 두 품목이 표시됐다. 상위 투영은 실 AdminApp 초기화 식 추출 실행으로 검증했고 전체 앱 렌더라고 확대하지 않는다. 모든 저장은 합성 콜백이며 운영 저장은 없다. 실화면 증거는 저장소 밖 `records/smartstore-projection-synthetic-20261015.png`다.

정확 5파일을 `3c6db28e8cab3fa8c7426063f92c8954abcc506d`로 main에 푸시하고 검증한 기존 산출물로 관리자·직원 앱을 배포했다. 공개 148/148파일의 SHA가 최종 manifest와 일치했다. FCM 원문과 다른 미커밋 자료는 보존했고 gate·운영 업무 자료는 변경하지 않았다. 이 한 원인의 호환 복구를 세 화면의 세 작업이나 원본039 전체 완료로 세지 않는다.

## 제품 실사·캔 개봉의 최초 요청 없는 저장 분기 — 배포 완료

제품 `373aa5b0d7ba751f037299c57dfb1e4d2ee213f6` 정확8을 main/GitHub에 반영하고 양Hosting50875 exit0으로 배포했다. 총괄이 원격137/137 SHA 일치를 확인했다. 기존 최종 dist를 재사용했고 Functions·Rules·설정·운영 자료를 변경하지 않았다. 마감 기록은 이 두 코드 분기의 종료에 한정하며 원본039 전체 완료로 세지 않는다.

기준 `9101d53`의 `stocktakeByQty`는 `request`가 없으면 회사·UID·원료 홀더 검사를 생략하고 실행 시각과 새 앵커 ID를 만들었다. 실제 제품 화면의 두 호출은 이미 `durableProductStocktake`로 최초 요청을 전달하고 이 무요청 분기는 옛 시험만 사용했다. 이번 후속은 요청과 `apply/inspect` 방식을 필수로 하고 모든 호출에서 같은 회사·실제 UID·제품 종류·최초 입력을 확인한다. 최초 요청은 await 전에 복사하고 시각·작업번호·실사 날짜는 그 원문을 사용한다.

기존 `anchorLotsByQty/canStockAfter/pruneDepletedLots`와 최소 재고·수량 정책은 유지한다. 같은 요청은 저장 앵커의 원문을 대조해 재고를 다시 쓰지 않고, 제출된 요청의 결과 확인은 앵커가 없다고 다시 적용하지 않는다. 옛 앵커를 새 요청으로 보강하거나 과거 실사를 재실행하지 않는다. 운영 자료·Rules·Functions는 변경하지 않는다. 타입·회귀·실직원 Auth/Firestore SDK와 자기 자료 정리, 무요청 호출 쓰기0·다른 회사·UID·원문 거절은 최종 결과 확인 후 기록한다. 원본039 전체 완료로 세지 않는다.

같은 묶음에서 `unpack(plan, context)`의 무context 직접 저장 분기도 종료한다. 실제 제품은 `durableCanUnpack`의 최초 요청을 전달하는 한 호출뿐이며 무context 호출은 옛 시험에만 남아 있다. 기존 `CanUnpackRequest`와 apply/inspect, 원영수증·FIFO·행별 소수 반올림을 재사용하고, 제품이 삭제된 뒤에도 원영수증을 먼저 대조하는 기존 재개 계약을 유지한다. 제출 후 영수증이 없다는 이유로 개봉을 다시 적용하지 않는다.

`adjustStockByQty`는 확인사항의 `quantity_change` 승인에서 아직 사용한다. 동일 요청을 한 화면은 목표 수량, 다른 화면은 추가량으로 해석하므로 실제 의도 확인 없이 삭제하거나 새 재고 추가 명령으로 자동 이관하지 않는다. 이번 종료 범위와 구분한다.

집중 검증 최신95387은 5파일35시험 통과·앱 타입/diff exit0이다. 일반 직원 `isAdmin:false`를 토큰으로 확인한 실제 Auth/Firestore SDK는 품목 수량6·캔 개봉5로 총11이며, 기존 제품 실사 관리자 SDK4와 구분한다. integration17·최초 요청 모델3을 포함한 총35로, SDK를 중복 합산하지 않는다. 등록 합성35경로와 계정4개를 삭제 후 부재 확인했다. 무요청 실사 자동 생성 변이2실패·캔 무context 자동 생성 변이2실패를 검출한 뒤 원본35시험 통과를 확인했다. 변이는 private 사본에서만 실행했다.

UTC15:30 첫 시각의 한국 날짜는 다음 날00:30으로 고정됨을 확인했다. 앞55d3c3 타입 실패는 이관 중 호출부10개와 날짜 helper 인수1개가 수정되기 전 결과이며 성공으로 계산하지 않는다. 캔 추가 전29시험 성공 및 추가 중35시험 성공/정리 검사 실패를 최신 최종35와 구분한다. 거절되어 생성되지 않은 등록 영수증 경로를 소유검사에서 오판한 cleanup 조건을 수정했고 실제 생성한 자기 자료도 삭제 후 부재를 확인했다. 최종 일반61908은 `--mode localtest`로527파일4781시험 통과·7제외·실패0, exit0(298.95초)이며 앱/서버 타입·양빌드64077 exit0이다. 최종 사전59605 생성/check-only exit0:87컬렉션737필드468소스634참조2528미해석517wrapper. 독립 검수 추가P1/P2 없음. 기존 실제 화면의 durable 실사/개봉 소비자와 계산 경로는 유지하며 이번 변경은 새 UI를 만들지 않는다.

## 재고 추가·개봉의 구 저장 경로 후속 — 2026-10-12 배포 완료

제품 `04809e9c8a01a313324c5ddb24786c66bb9befae` main/GitHub 일치·양Hosting1129 exit0·원격137/137 SHA 대조 완료. Functions·Rules·운영 자료 변경은 없다. 과거 요청과 잔존 필드의 별도 판단 조건은 유지하며 원본039 전체 완료로 집계하지 않는다.

재고 추가의 선택 품목별 `adjustStockByQty` 반복과 매 실행 새 ID를 만드는 캔·박스 개봉 호출은 실제 UI 경로였다. 이 세 경로를 최초 요청 보존·전체 원자 저장·동일 영수증 결과 확인으로 대체했고 일반527파일4775PASS7제외·양타입/양빌드0·실직원SDK11·실화면3크기 검증을 완료했다. `adjustStockByQty`의 다른 소비자를 일괄 삭제하거나 과거 요청을 새 계약으로 승격하지 않는다. 수량·로트·BOM·원가 계산은 기존 공용 함수를 사용한다. [후속 계약과 검증 기록](item-inventory-attempt-followup-20261012.md)을 실제 배포 결과와 함께 대조한다.

`quantity_change` 신규 생성 코드는 ItemList의 도달할 수 없는 모달 안에 남아 있다. 본문은 입고 예정 수량 변경을 설명하지만, AdminApp 두 승인 소비자는 절대 재고 또는 증감 재고로 다르게 처리한다. 과거 pending의 의미·기반 문서·이미 적용한 효과를 확인할 수 없어 자동 변환·재적용·운영 삭제하지 않는다. 이 경로가 신규 사용자 진입으로 살아 있다고 판정하지 않는다. 원본039 전체 잔여 필드의 운영 삭제 조건은 계속 유지한다.

현재 기준은 마지막의 **2026-10-09 최신 원본 대조** 표다. 앞의 배포 전/미배포 표현과 건수는 각 제목 날짜의 조사 이력이며 현재 상태로 사용하지 않는다.

기준: 배포 코드 99e87ed6. 운영 읽기 전용 집계 `scripts/audit-deprecated-fields.mts`, 2026-10-06 13:33 UTC. 필드 값이 null이어도 존재하면 집계한다. 개별 값과 개인정보는 보고서에 포함하지 않는다.

| 필드 | 태백 / 풍회 잔존 문서 | 현재 경로 | 대체 및 제거 조건 |
| --- | --- | --- | --- |
| Item.itemType | 0 / 0 | ProductionManager 읽기 | type 분류 동치 검증 후 호환 분기 제거 |
| Item.partnerId | 0 / 0 | 거래처 연결 호환 | partner_item 연결과 스마트스토어 표식 분리 확인 |
| Item.partnerIds | 188 / 2 | 화면 거래처 연결·채널 표식 | 기존 연결 및 SMARTSTORE 분류 보존 이관 필요 |
| Item.defaultBoxConfig | 0 / 0 | 운영 writer/read 검색 결과 없음 | item_pack 사용. 현재 감사 범위에서 DB 정정 필요 없음 |
| Item.partnerBoxConfigs | 0 / 0 | 타입 선언 | 현재 감사 범위에서 DB 정정 필요 없음 |
| Item.unpackTo | 0 / 0 | 운영 writer/read 검색 결과 없음 | BOM 및 item_pack 사용 |
| Item.lotsAreTotal | 1 / 0 | never 타입, 설명 주석만 | 해당 문서 백업 후 필드 삭제 및 전체 합계 동치 확인 |
| FixedCostTemplate.postMode | 0 / 0 | 앱 3곳·Functions 1곳 호환 읽기 | dir 사용. 구 writer 차단 및 양쪽 결과 동치 확인 후 제거 |
| PalletStock.inUse | 8 / 0 | 타입, 저장값 대신 거래기록 계산 | 거래기록 잔량 대조 및 백업 후 필드 삭제 |

품목 546개, 템플릿 100개, 팔레트 8개를 읽었다. `CostManager`의 어디에서도 사용하지 않는 editTpl/editForm state와 postMode 초기값을 제거했다. UI 경로와 운영 데이터는 변경하지 않았다.

초기 조사 당시 제거 버전은 미정이었다. 아래 최신 배포 기록과 분리해 읽는다. 잔존값이 있거나 외부 구 writer를 확인하지 못한 필드의 선언·호환 읽기를 일괄 삭제하지 않는다. 후속 단계는 연결/잔량 동치 조사와 필요한 백업·dry-run이다.

## 거래처 연결 동치 조사

2026-10-06 13:38 UTC 재집계: 태백의 구형 partnerIds에 중복을 제외한 거래처 연결 388개가 있다. 같은 회사·품목·거래처의 판매 partner_item(Direction !== in)과 대조하면 6개가 없다. SMARTSTORE 표식 1개는 isSmartStore=true가 없어 호환 읽기에 의존한다. 잘못된 배열 형식은 0개다. 풍회는 빈 배열만 존재해 구형 거래처 연결 0개다.

현재 앱은 판매 연결을 partner_item에서만 구성하므로 불일치 6개를 자동 이관하면 과거에 해제된 연결을 되살릴 수 있다. 다음 조사는 참조 품목·거래처의 존재/보관 여부와 연결 방향을 확인해 삭제 가능한 잔재인지 구분하는 것이다. SMARTSTORE 표식은 이관 없이 제거할 수 없다. 이번 감사는 운영 쓰기 0회다.

2026-10-06 14:27 UTC 참조 상태 조사: 불일치 6개 중 5개는 보관된 거래처이며 1개는 현재 매입 연결만 있다. 활성 판매 연결 누락으로 분류되는 건은 0개다. 따라서 판매 연결을 새로 생성하지 않는다. 이 결과는 기존 관계의 의미가 구형 배열과 다름을 보여주며, 스마트스토어 표식 이관 및 호환 읽기 정리와 분리해 다룬다.

## 2026-10-07 최신 코드·필드 존재 대조와 거래처 포장 제거 후보

기준 main `4b574cdd`. 2026-10-07 09:33 UTC 읽기 집계 `work/todo039-current-field-counts-20261007.json`: items 태백541/풍회6, partner_item 태백1290/풍회5. null 값도 존재로 집계했고 문서 ID·이름·값 출력 및 운영 쓰기는 없다.

앞 표의 Item.itemType/partnerId/defaultBoxConfig/partnerBoxConfigs/unpackTo는 현재 선언·제품 reader/writer가 이미 제거돼 있다. Item.용량도 이전 `150d9ddf`에서 제거됐다. 최신 DB 존재 모두0을 다시 확인했다. 이 제거를 이번 신규 작업으로 재계수하지 않는다.

| 후속 필드 | 태백 / 풍회 존재 | 현재 reader/writer | 대체·후보 삭제 범위 |
| --- | --- | --- | --- |
| PartnerItem.boxTypeId | 0 / 0 | AddOrderModal 부족분·PasteOrderModal 포장 표시·ItemManager 중복 대조; 제품 writer0 | 부자재는 BOM. 거래처별 별도 박스 추가/표시 분기를 제거 |
| PartnerItem.qtyPerBox | 0 / 0 | AddOrderModal 구형 박스 소요·ItemManager 중복 대조; 제품 writer0 | 주문 박스 환산은 BOM/item_pack. 구형 박스 소요 분기·표시 제거 |
| PartnerItem.tapeTypeId | 0 / 0 | PasteOrderModal 포장 표시·ItemManager 중복 대조; 제품 writer0 | BOM 표시 유지, 구형 거래처 표시 제거 |
| PartnerItem.qty_per_box/containerTypeId/labelId/weightInKg/displaySize/packageType | 모두 0 / 0 | 타입 선언 외 제품 reader/writer0 | 선언 제거. 같은 이름의 Item·OrderItem·로트 필드는 현재 사용하므로 유지 |

거래처 포장9필드 선언과 세 실제 reader는 commit `9dcdab82`에서 제거하고 관리자·직원 Hosting/SHA 및 GitHub 원격 일치 검증을 완료했다. 원본 관계 단가·taxType·계정·shipToIds·Direction은 유지한다. 구형 필드를 기록할 수 있는 과거 스크립트의 비교 목록은 감사/복구용이므로 변경하지 않는다. 새 제품 포장 writer가 없고 세 reader의 정상 BOM 동치 및 구형 runtime 원복 변이 검출을 검증했다. 이 코드 제거는 DB 필드 삭제 또는 전체 TODO039 완료가 아니다.

### 실제 미결·유지 경계

- Item.partnerIds: 채널 SMARTSTORE 호환과 과거 판매 연결의 의미가 달라 이관 근거 없이 삭제하지 않는다.
- Item.lotsAreTotal: 최신 태백1/풍회0. 잔존값 백업·동치/운영 정정 계약 없이 선언을 유지한다.
- PalletStock.inUse: 태백8문서 모두 존재. 거래기록 잔량 대조·백업/필드 삭제 결정은 미결이다.
- FixedCostTemplate.postMode: 최신 태백62/풍회39 모두0이지만 앱/동결 Functions 읽기 계약 및 구 writer 차단 확인이 필요해 유지한다.
- AccountCode.noncash: 최신 양사 각2문서 존재. 선언 외 제품 계산은 사용하지 않으나 운영 잔존 조건이 없어 유지한다.
- PartnerItem 외 Item.weightInKg/품목·동명 필드 및 구형 InventoryCategory는 별도 실사용/이관 계약에 속하며 이번 범위에서 제거하지 않는다.

## 2026-10-07 후속 미사용 Item 필드 정리

기준 배포 main `71d768f6`. 원본039의 미사용 필드 조사·제거 조건으로 추가 네 필드를 대조했다. 읽기 감사 `work/todo039-unused-item-fields-fresh-20261007.json`의 2026-10-07 12:21:23 UTC 시점 품목 태백541/풍회6, 다른회사0. null 여부와 관계없이 존재를 집계했고 아래 네 필드 모두 present/nonNull/nonEmpty 0이다. 문서 이름·ID·값을 출력하지 않았으며 운영 쓰기는 없다.

| 필드 | 태백 / 풍회 존재 | 읽기·쓰기 및 대체 | 코드 제거 범위·버전 |
| --- | --- | --- | --- |
| Item.weightInKg | 0 / 0 | 제품·앱/배포 Functions reader/writer 0. demo350ml 품목 fixture만 생성. 현재 kg 계산은 spec·BOM·로트 unitKg를 사용한다. | Item 선언과 demo fixture 키 제거. 실제 배포 commit `3e2f4ca4` |
| Item.netContent | 0 / 0 | 제품·앱/배포 Functions reader/writer 0. demo fixture만 생성. 실제 내용량·규격 입력은 spec을 사용한다. | 선언과 demo fixture 키 제거 (`3e2f4ca4`) |
| Item.isRawMaterial | 0 / 0 | 제품·앱/배포 Functions reader/writer 0. demo raw fixture와 감사 test의 false 초기값만 존재. 원료 판정은 type/rawMaterialName의 기존 계약을 유지한다. | 선언·demo fixture·감사 fixture 키 제거 (`3e2f4ca4`) |
| Item.variantStocks | 0 / 0 | 선언 외 제품·Functions·fixture reader/writer 0. 현재 품목·로트 stock 계산 불변. | 선언 제거 (`3e2f4ca4`) |

운영 데이터 삭제·이관이나 새 계산 분기 추가 없이 정확 네 선언과 demo/test 키만 제거한다. `FixedCostTemplate.statementType`과 기존 `stock`·`spec`·`rawMaterialName`·BOM·로트 필드는 유지한다. 타입 선언만 복구하는 것은 runtime 계산을 바꾸지 않으므로 이번 변경을 runtime 변이로 검출했다고 주장하지 않는다. 기존 포장9필드의 runtime 원복 변이 검출은 앞선 배포 근거이며 이번 작업으로 재계수하지 않는다. 이번 경계는 최신 정적 사용처 0, fresh DB 존재 0, 전체 타입과 기존 환산·감사 회귀로 검증한다.

### 원본039 전체 잔여

이번 네 필드와 앞선 포장9필드 제거는 안전한 코드 정리 범위이며 전체039 완료가 아니다. 다음 원본 대상은 각 조건 충족 전 유지한다.

- `Item.partnerIds`: 판매 관계 표시용 파생 prop과 DB의 SMARTSTORE 호환 표식이 같은 이름을 사용한다. 현재 실제 SMARTSTORE legacy reader가 있어 채널 표식의 확인된 이관 없이 제거할 수 없다. 과거 판매 배열과 현재 partner_item 관계 불일치를 자동 복원하지 않는다.
- `Item.lotsAreTotal`: 제품 계산은 이미 무시하지만 태백 문서1개 잔존. 현재는 재도입 방지 never 선언이다. 문서 필드 삭제·백업·동치의 운영 결정 없이 전체 제거 완료로 기록하지 않는다.
- `PalletStock.inUse`: DB8문서 잔존, 화면 잔량은 거래기록으로 계산한다. 편집 snapshot 전달은 유지한다. 미참조 INITIAL_PALLETS의 구형값 제거는 아래 미배포 후속 후보와 구분한다. 거래기록 잔량 대조·운영 필드 삭제 결정·백업이 별도 필요하다.
- `FixedCostTemplate.postMode`: DB존재0이나 앱/예약 Functions의 legacy 분리→줄돈 호환과 시험이 남아 있다. TODO016 명시종류 배포 완료가 이 호환 또는 모든 구형 writer의 종료를 자동 증명하지 않는다.
- `AccountCode.noncash`: 양사 각각2문서 잔존. 현재 보고서 계산은 journal 기반이나 운영 값 삭제 결정은 없다.
- deprecated `InventoryCategory` 분류는 실제 레거시 분류 소비자가 남아 있다. 단순 타입 일괄 축소는 하지 않는다.

신규 운영 field 삭제나 데이터 이관은 승인되지 않았고 쓰기0이다. 운영 잔존 대상의 전환 없이 전체039를 완료로 바꾸지 않는다.

## 2026-10-07 미참조 초기 팔레트 후속 정리 — 아직 미배포

총괄 소유 `src/config/company.ts`에서 제품 참조가 없는 INITIAL_PALLETS와 해당 PalletStock import를 제거하고, `components/PalletManager.tsx`의 거래 삭제 설명을 실제 남은 거래기록 기반 잔량 계산에 맞게 고쳤다. 동작·운영 팔레트8문서·inUse 필드·편집 snapshot 전달은 변경하지 않았다. 이 문서 갱신 시점에 후속 두 파일은 미배포 후보이며 기존 포장9필드 또는 Item4필드 배포 완료와 합산하지 않는다.

## 2026-10-08 postMode 후속 코드 제거 후보 검증 — 배포 전

원본039의 dir 이관·앱/Functions 동치 조건을 읽기 전용으로 대조했다. 최신 감사에서 정기 템플릿 태백62·풍회39 모두 dir가 있고 postMode는 0이다. 신규 제품 writer는 명시 dir를 저장하며 postMode 쓰기는 없다. 총괄이 제품 7파일에서 postMode 선언·호환 읽기를 제거하는 범위를 소유한다. 운영 DB 변경은 필요하지 않으며 이번 기록 시점에는 코드 시험·배포 결과를 아직 확정하지 않는다.

실제 101개 템플릿의 원문을 메모리에서만 사용하여 기존 방향 t.dir ?? (postMode 분리이면 줄돈, 아니면 출금)과 새 t.dir ?? 출금을 비교했다. 2026년 12개월 총1212개 표본에서 실제 앱 자금/전표 투영·자동 발행 조건 및 서버 autoVoucherDraft의 변경 전후 해시 차이 모두0, 방향 차이0이다. ID·이름·금액·분개 원문은 저장하지 않았다. 근거는 private work/todo039-postmode-equivalence-20261008.cts/json, 2026-10-08 02:08:38 UTC, exit0이다. 최초 ESM 로더 오류는 조회 전 종료로 구분하고 CTS 실행 완료만 근거로 사용한다.

partnerIds는 SMARTSTORE 호환 reader가 있고 태백188/풍회2 문서에 존재한다. lotsAreTotal 태백1, inUse 태백8, noncash 양사 각2는 잔존하여 유지한다. 구형 InventoryCategory도 실제 소비자가 남아 있다. batch6의 INITIAL_PALLETS 제거는 이미 배포된 과거 범위이며 재작업하지 않는다. 이 후속은 원본039 전체 완료가 아니고 원본15개 완료 집계7/15를 변경하지 않는다.


## 2026-10-09 최신 원본 대조 — 코드 제거와 운영 보존

Notion 원본 https://app.notion.com/p/3e82cda7782b8142b375fcdd3dcda820의 writer·reader·DB 잔존·대체·삭제 버전 표 요구를 재조회했다. 현재 HEAD d666929b, CostFn alias 제거 cf083aa9와 제품 배포 c268ccf8 이후 기준이다. 운영 집계는 2026-10-09 03:34:47 UTC, private work/todo039-deprecated-field-counts-20261009.json이다. 존재 여부만 집계하며 null도 존재로 센다. 문서 ID·이름·값 및 백업은 이 문서에 포함하지 않는다. 운영 쓰기0이다.

| 항목 | DB 존재 태백 / 풍회 | 실제 reader / writer | 대체·현재 결정·삭제 버전 |
| --- | --- | --- | --- |
| Item.itemType·partnerId·defaultBoxConfig·partnerBoxConfigs·unpackTo | 각각 0 / 0 | 현재 제품 선언·reader/writer 제거 | type·partner_item·item_bom/item_pack. 이전 제거 기록 유지, 재작업 없음 |
| Item.용량 | 0 / 0 | Item 선언/품목 fallback 제거, 생산일지 동명 필드는 유지 | spec/displaySize, 150d9ddf 및 후속039 동기화 기록 |
| Item.wipStock·finishedStock | 각각 0 / 0 | 제품 선언 제거 | stock/로트, 1e48437a |
| PartnerItem 구형 포장9필드 | 이번 재집계 제외, 앞선0/0 감사 유지 | 제품 선언과 세 reader 제거 | BOM/item_pack, 9dcdab82. 새0증거로 재계수하지 않음 |
| FixedCostTemplate.postMode | 0 / 0, dir 62 / 39 | 현재 앱/Functions 선언·호환 reader와 제품 writer 제거 | 명시 dir, d21eb7d0. 101×12=1212 실제 투영 차이0 근거 유지 |
| CostFn.effective | DB 필드가 아님 | 본체/소비 alias 제거, buildCostFn 함수를 직접 사용 | cf083aa9, 계산정책 변경0 |
| INITIAL_PALLETS | DB 필드가 아님 | 미참조 seed와 import 제거 | d2d8dc60. 운영 pallets 삭제 아님 |
| Item.partnerIds | 188 / 2 | partnerPrice.ts isSmartStoreProduct의 SMARTSTORE 호환 reader, AddItemModal 원문 초기값 보존. 화면 파생 판매 연결 prop과 구별 | partner_item + isSmartStore. 표식 이관·구형 배열 의미 대조 없이 제거하지 않음 |
| Item.lotsAreTotal | 1 / 0 | 제품 계산 reader/writer0, 재도입 방지 never 선언. 과거 repair script의 별도 writer 존재 | stock=로트 kg 합 공용 계약. 운영 필드 삭제 결정·백업/undo·동치 없이 유지 |
| PalletStock.inUse | 8 / 0 | required 타입, 제품 잔량 reader0. seed-local-emulator.mts는 합성 local 0을 기록 | PalletManager 거래기록별 잔량과 outstandingByPallet. 거래처 음수 잔량 합/회수대기 실제 동치와 원문 보존 검수 후 필드 삭제 결정 필요 |
| AccountCode.noncash | 2 / 2 (각 계정56문서) | 제품 계산 reader/writer0, optional 선언 및 역사 주석 | journal 상대계정 기반. 존재값 삭제 결정이 없어 유지 |
| deprecated InventoryCategory 값 | 이번 필드 존재 감사 대상 아님 | ItemPriceManager 실제 한글 CATEGORIES와 분류 UI 소비 | taxonomy/type 계약 및 과거 분류 호환 확인 전 유니언 축소 금지 |

scripts/fix-sesame-lots.mts에는 lotsAreTotal false 정정 및 원문 undo writer가 있고, fix-lot-to-ledger/fix-kkaebun-lot-to-ledger 등은 옛 축별 분기다. 이는 현재 앱 신규 writer가 아니라 보존된 개별 운영 복구 스크립트다. 이 감사는 스크립트를 실행하거나 옛 모델을 다시 활성화하지 않는다. 새 운영 실행은 해당 현재 계약·명시 승인·백업/조건부 복구를 별도 검토해야 한다.

현재 안전한 추가 제품 필드 제거를 확정하지 않았으며 임의 삭제하지 않는다. 문서 인수 요구의 최신화는 완료했지만 미결 호환·운영 잔존의 정당 유지가 남아 전체 TODO039 완료와 다르다. 원본 전체 잔량35·우선8/15 판정은 변경하지 않는다. Notion쓰기0·Figma 보류·GitHub푸시 보류를 유지한다.

## 2026-10-11 OEM 서버 잔존 읽기 제거

앞선 제품 reader 제거 기록 뒤에도 oemReceiptCommand와 oemFeeVoucher의 상자 판정에 unpackTo.count 호환 읽기 두 곳이 남아 있었다. 두 곳을 제거하고 현재 완제품 자식 BOM·박스 단위·packageKg 기준은 유지했다. 실제 Firestore 에뮬레이터 시험에서 옛 unpackTo.count=12만 있는 일반 품목은 2kg로, 현재 박스 BOM이 12인 품목은 24kg로 처리되는 입고·로트·가공비 결과를 확인했다. 운영 필드 수는 10월 9일 과거 감사 근거이며 이번 운영 DB 재조회·수정은 없다. partnerIds/lotsAreTotal/inUse/noncash 후속은 남아 있어 039 전체 완료로 세지 않는다.

## 2026-10-11 구 품목 가격 화면 후속 후보

메뉴에는 item-management만 있지만 AdminApp에 item-price-management의 lazy import와 렌더 분기가 남아 있으며 notif URL·서비스워커 메시지·시작 화면 저장값으로 실행된다. 구 ItemPriceManager의 한글 고정 CATEGORIES는 현재 product/goods/submaterial과 직접 비교해 분류 결과를 누락하고, 별도 updateItem(cost) 경로를 사용한다. 다음 구현은 저장/알림/상위 prop의 옛 view를 공용 함수로 현재 item-management에 연결하고 구 lazy/render writer를 종료한다. 현재 ItemManager의 회사·BOM·매출단가·편집 계약을 유지한다. 운영 자료의 deprecated 분류 값 또는 InventoryCategory union을 이 변경만으로 삭제하지 않는다.

현대 화면 기준 회귀: 시작화면·분류·거래처 연결필터·회사별 명시 BOM4파일12PASS. 후보 records/todo039-old-item-view를 검토 중이며 이 절은 아직 배포 결과가 아니다.


최종 합류4파일17PASS·타입0. 저장값·notif URL·SW·상위prop alias는 공용 정규화, 현대 ItemManager 수정콜백 확인. 시험은 실제effect/분기를 사용하는 Host 검증이며 전체 AdminApp mount는 아니다. redirect 제거 변이는 실패를 검출하고 복구 후17PASS. 전체참조 검색에서 구 컴포넌트 소비는 본체/전용시험뿐이므로 components/ItemPriceManager.tsx와 전용bomInputs시험도 제거했다. 현대 ItemManager의 회사별/BOM시험은 유지한다.

## 2026-10-12 전체 인수 잔여 대조

현재 코드 기준93b56c7 및 이번030/039 후보를 읽기 전용으로 대조했다. 아래 존재 수는 2026-10-09 감사값이며 최신 운영 조회값이 아니다. 현재 PC의 Process/User/Machine 서비스 계정 설정이 모두 없어 운영 감사는 실행하지 않았다. 최신 전체 기준은21완료22잔여다. 위 절의 과거 배포 대기·푸시 보류·잔량은 당시 기록이며 현재 지시를 대신하지 않는다.

| 유지 항목 | 과거 DB 태백 / 풍회 | 현재 소비·대체 | 전체 인수까지 남은 일 |
|---|---|---|---|
| Item.partnerIds | 188 / 2 | partnerPrice의 SMARTSTORE 호환 reader를 AddOrder/PasteOrder가 사용. AdminApp의 파생 거래처 prop과 DB 원문은 구분. 대체는 partner_item 및 isSmartStore | 최신 원문 의미·누락 연결과 채널 표식 대조, 이관 계획·원문 백업·조건부 적용/undo 및 삭제 결정 |
| Item.lotsAreTotal | 1 / 0 | 제품 계산 reader/writer0, never 선언으로 재도입 방지. 현재 stock/로트 계약 유지 | 잔존 품목 stock와 로트 kg합 동치·최신 백업·삭제 결정. 과거 개별 복구 도구와 구분 |
| PalletStock.inUse | 8 / 0 | required 타입과 원문 편집 snapshot 보존. 잔량은 PalletManager 거래기록 및 outstandingByPallet | 실제8문서의 거래기록·회수대기 동치와 원문 검수 후 삭제 결정 |
| AccountCode.noncash | 2 / 2 | optional 선언, 현재 계산은 journal 상대계정. noncashApplication은 다른 현행 필드 | 최신 존재·의미 확인과 필드 보존/삭제 결정 |
| InventoryCategory 옛 분류 | 필드 존재 감사 대상 아님 | AddItemModal·현대 ItemManager·ItemList의 taxonomy 계약 사용. 구 ItemPriceManager는66f31fb3에서 실행 경로 통합 및 제거 완료 | 현재 운영 분류 동치 확인 전 union 일괄 축소 금지 |

postMode는d21eb7d0에서 앱/Functions 호환을 제거했고 실제101개 템플릿×12개월 투영 차이0 근거가 있다. 재작업 대상이 아니다. 초기 팔레트·CostFn·구 포장 필드 및 OEM 서버 unpackTo 후속도 기존 완료 범위를 다시 계수하지 않는다.

옛 CLI writer는 boxSize 복원6d61ca8, pack 이관93b56c7에 이어 이번 fix-spec-loose-bulk를 안내로 종료한다. 이는 현재 데이터를 오래된 snapshot으로 덮는 실행 경로 제거이며 운영 잔존 필드 이관을 대신하지 않는다. 현재 규격 UI·BOM·item_pack 및 과거 백업·DB 이력은 보존한다. 이 추가표는 코드·과거 감사·미실행 최신 조회를 구분하며039 전체 완료를 선언하지 않는다.

## 2026-10-15 완료 정정 명령의 재실행 종료 후속

DB-CHANGELOG의 9월 14일 완료 기록이 있는 fix-lots-to-item-stock과 9월 11일 완료 기록이 있는 fix-raw-state-to-lots를 대조했다. 전자는 옛 lotsAreTotal 분기로 현재 재고에 맞춰 로트를 직접 수정하고, 후자는 과거 고정 수량을 입고하는 경로가 소스에 남아 있었다. 현재 운영 권한에서 실제 쓰기가 가능한지 시험한 것은 아니며 운영 실행·조회·수량 판단은 하지 않았다.

기존에 종료한 fix-sesame-lots·fix-spec-loose-bulk처럼 두 명령을 안내 전용으로 종료한다. 기본·dry·help는 종료 사유와 과거 실행 기록을 안내하고, apply·undo·알 수 없는 인수는 실패 코드로 거절한다. 인증·네트워크·현재 자료 조회·파일 쓰기·과거 백업 읽기/삭제를 실행하지 않는다. 새 정정은 당시 명령을 재사용하지 않고 현재 계약과 근거를 확인해 별도의 검토 가능한 계획으로 준비한다. 완료 근거가 불명확한 다른 정정 명령은 이번 범위에 넣지 않는다.

직접 child process·합성 백업 불변·허용된 구문만 남기는 AST 검사·보호 제거 변이·독립 검수 결과는 완료 후 추가한다. 실제 운영 필드 삭제나 과거 재고 보정은 아니며 039 전체 완료 수를 올리지 않는다.

두 CLI의 신규 직접 실행 시험 18개와 기존 종료 CLI 회귀를 합한 고유 4파일 34개가 통과했다. 공식 Node22 child process의 인증 환경을 제거하고 별도 합성 작업폴더에서 기본·dry·help·apply·undo·혼합 쓰기·미지원 인수를 확인했다. 합성 백업과 기존 파일 바이트는 불변이다. AST 허용 구문 검사로 import·인증·네트워크·파일 접근 재도입을 막고, import 및 쓰기 거절 제거 변이는 12개 실패를 검출한 뒤 원본 바이트로 복원해 34개를 재통과했다. 좁은 타입 검사와 독립 읽기 검수 CLEAR를 확인했다. 운영 실행은 없다.
