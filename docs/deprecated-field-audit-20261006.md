# TODO039 구형 필드 조사

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

제거 버전: 미정. 잔존값이 있거나 외부 구 writer를 확인하지 못한 필드의 선언·호환 읽기를 일괄 삭제하지 않는다. 후속 단계는 연결/잔량 동치 조사와 필요한 백업·dry-run이다.

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

거래처 포장9필드 선언과 세 실제 reader를 한 후보로 정리한다. 원본 관계 단가·taxType·계정·shipToIds·Direction은 유지한다. 구형 필드를 기록할 수 있는 과거 스크립트의 비교 목록은 감사/복구용이므로 변경하지 않는다. 새 제품 포장 writer가 없고 세 reader의 정상 BOM 동치 및 구형 runtime 원복 변이 검출을 검증한 뒤 제거 버전을 실제 배포 commit으로 확정한다. 후보 생성은 DB 필드 삭제 또는 전체 TODO039 완료가 아니다.

### 실제 미결·유지 경계

- Item.partnerIds: 채널 SMARTSTORE 호환과 과거 판매 연결의 의미가 달라 이관 근거 없이 삭제하지 않는다.
- Item.lotsAreTotal: 최신 태백1/풍회0. 잔존값 백업·동치/운영 정정 계약 없이 선언을 유지한다.
- PalletStock.inUse: 태백8문서 모두 존재. 거래기록 잔량 대조·백업/필드 삭제 결정은 미결이다.
- FixedCostTemplate.postMode: 최신 태백62/풍회39 모두0이지만 앱/동결 Functions 읽기 계약 및 구 writer 차단 확인이 필요해 유지한다.
- AccountCode.noncash: 최신 양사 각2문서 존재. 선언 외 제품 계산은 사용하지 않으나 운영 잔존 조건이 없어 유지한다.
- PartnerItem 외 Item.weightInKg/품목·동명 필드 및 구형 InventoryCategory는 별도 실사용/이관 계약에 속하며 이번 범위에서 제거하지 않는다.
