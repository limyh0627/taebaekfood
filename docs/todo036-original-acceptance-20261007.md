# TODO036 원본 인수 대조

읽기 기준: 현재 HEAD 74692119, hook 후속 배포 3e2f4ca4. 제품·노션·MEMORY 수정 및 새 시험 실행 없음.

## 판정

원본은 **경고를 실제 오류와 오탐으로 나누는 것**을 요구한다. lint 경고 0, 모든 화면 E2E, Android 실OS 검수는 요구하지 않는다. 원본에 직접 열거된 네 범위와 TaxStatement 후속 설계는 현재 코드·기존 검증 근거로 충족한다. 85개 스냅샷을 30파일로 분류한 표도 존재한다. 다만 이를 모든 앱 비동기 경로의 오류 0 증명으로 확대하지 않는다.

새로 확인한 운영 사용자 오류는 없다. 아래 잠재 경계는 재현되지 않았으므로 새 결함 또는 추가 완료 게이트로 단정하지 않는다. 총괄은 원본 열거 위험 보완 및 경고 분류 완료라는 제한된 의미로 완료 여부를 판단할 수 있다. 과거 문서의 '전체 미완료'는 당시 일부 범위 배포 판정이며 현재 작업을 영구 보류시키는 요구가 아니다.

## 원본 직접 조회

Notion URL: https://app.notion.com/3e82cda7782b81bb9fe2e7e54836d0e6

이번 fetch가 반환한 최종편집 시각은 2026-10-02T05:49:26.846Z, 제목은 'React hook 의존성 경고를 실제 오류와 오탐으로 나눠 고친다.'이다. 본문은 지난달 snapshot 회사/늦은 로딩/중복, HACCP 회사 구독, ItemList 연결·분류 memo를 우선하고 AddOrderModal을 '현 오류보다 유지보수 위험으로 분류'한다. TaxStatement 동일 ID 편집 계약은 후속 설계에 명시돼 있다. 승인과 후속 출력 차단 정책은 MEMORY 해당 관리키의 설계와 대조했다.

| 인수 조건 | 현재 구현 및 기존 근거 | 판정 |
|---|---|---|
| snapshot 늦은 입력/이전 회사/중복 자동 저장 방지 | AdminApp의 브라우저 자동 snapshot effect 제거. AdminApp.mountInventoryWrites.test.ts가 effect 자동 쓰기 부재와 수동 callback 보존·검출기 변이를 검사. 서버 index.ts의 월말 생성은 기존 문서 존재 시 skip, tx.create이며 회사별 valueInventory 사용. | 원본 위험 제거. 수동 저장·서버 스케줄과 구분. 운영 동시쓰기 전수 검증 주장 없음. |
| HACCP 기록·템플릿 회사 격리 | HaccpChecklist 회사 where, 회사별 template 문서 ID 및 companyId effect 의존성, 회사 key remount. companySubscriptions 시험의 7탭 회사 query/해제와 관리자·직원 늦은 callback/초안 경계가 존재. | 충족. 기존 구독을 다시 구현할 필요 없음. |
| ItemList 거래처 연결·분류 memo | filteredItems deps에 partnerItems/psMap/taxo 포함. linkRefresh 실제 UI는 동일 품목 배열에서 매출·매입 연결 추가/삭제 및 지연 분류 정렬 갱신을 검사. PartnerPortal도 partnerItems deps 포함. | 충족. 전수 deps 자동 추가 불필요. |
| AddOrder 유지보수 위험 분류 | groupOrderable의 가변 입력, products/submaterials 파생, splitNameVolume 입력 함수 및 상수 identity를 30파일 분류표에 설명. 별도로 발견한 동일 ID Partner는 ID 파생과 유효 배송지/초안 보존 회귀로 보완됨. | 원본 분류 충족. 모든 경고 제거를 요구하지 않음. |
| TaxStatement 동일 ID 원본/편집 세션 | sourceFingerprint와 회사/월/거래처/선택 ID session key. 편집 전 갱신·편집 중 보존·명시 초기화·빈 배열 유지. sourceChanged 중 세 버튼 disabled 및 핸들러 차단. 원본 복귀 시 초안 보존·차단 해제. 기존 React 10시험과 기준 원복 변이 기록 존재. | 원본 후속 계약 충족. 조회 탭 재출력과 발행 초안 출력 경계를 구분. |
| 나머지 경고 분류 및 실제 결함 보완 | work/todo036/hooks-followup-audit.md의 후속 30파일 합계85 분류표. Pallet 회사 query/cache, Paste 동일 ID 원본, useVoucherLedger 회사 상태/조회/취소 등 실제 실패 재현 후 3e2f 배포. | 읽기 분류 완료. 최신 lint 건수 또는 모든 경로 정상 판정은 아님. |

## 분류표의 시점과 한계

85는 HEAD 4b574cdd에서 수집한 스냅샷(exhaustive-deps60/refs1/static-components5/purity3/set-state-in-effect9/globals1/preserve-manual-memoization6)의 합이다. 후속 후보의 줄번호와 경고 개수는 달라질 수 있다. 초기 행별 '추가 읽기 필요' 표는 뒤의 30파일 분류 및 후속 실제 재현 기록으로 보완됐으며 초기 미판정을 현재 결함으로 읽지 않는다.

43개 집중 회귀, SDK2 및 다른 배포 회귀는 기존 결과를 참조할 뿐 이번 조사에서 재실행하거나 신규 인수 건수로 합산하지 않았다. docs/todo15-batch3-validation-20261007.md와 MEMORY의 3e2f4ca4 타입·Hosting·SHA 확인을 배포 근거로 사용한다.

## 별도 읽기 경계

- 이전 표의 loadHistoricalOrders 경계: 현재 useAppData.ts는 enabled/company 세대와 상태 scope, 회사 조건, 늦은 응답 guard를 갖는다. 이전 회사의 결과가 새 회사에 표시된다는 결함 근거는 현재 코드에서 없다.
- AdminApp의 두 loadHistoricalOrders 호출 effect는 companyId/loader를 deps에 포함하지 않는다. 동일 인스턴스에서 회사 prop만 바뀌고 문서 탭·월/currentView가 유지되면 새 회사의 과거 조회를 다시 시작하지 않을 가능성이 있다. 이는 잘못된 타회사 결과 표시가 아닌 오래된 자기회사 자료의 누락 후보이다. 실제 앱은 로그아웃 시 AuthPage로 분기해 AdminApp를 unmount하므로 합성 prop 전환 가능성과 일반 사용자 경로를 구분해야 한다. 이번 읽기만으로 실제 사용자 결함 확정 또는 원본 완료 차단으로 삼지 않는다.
- OfficeTalk 방 구독은 currentCompanyId/currentUserId/activeRoomId 의존성과 해제를 갖는다. 함수 identity 경고를 이유로 chatRooms 전체를 deps에 넣으면 읽음 writer 빈도가 바뀐다. 구독 외 모든 업무 async 경로 검증 완료로 확대하지 않는다.
- ProfitAnalysis의 열린 화면 자정/연도 경계는 별도 clock 갱신 정책이다. 회사/원본 입력 오류로 재현된 근거가 없어 금액 계산 변경을 제안하지 않는다.
- 과거 Firebase 내부 assertion b815/ca9 기록은 당시 환경 사건이고 원인 미확정이다. 현재 원본 hook 인수에 새 OS/E2E 게이트를 추가하는 근거로 사용하지 않는다.

이 문서는 원본 인수 대조이며 노션 상태 변경·운영 수정·제품 추가 패치를 수행하지 않았다.
