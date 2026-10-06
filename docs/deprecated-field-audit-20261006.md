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
