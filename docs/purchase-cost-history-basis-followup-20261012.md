# 원료 매입 원가 이력의 계산 근거 보존

기준: `5d80901` 이후 2026-10-12 후속 구현. 소스 `3aaf59653a8f7ffba2886b1711e903b693ec42c7` 정확6을 main/GitHub에 반영하고 단일 함수 배포를 완료했다. 원본028·ERD의 일부 후속이며 현재 전체 집계 22완료·21잔여를 바꾸지 않는다.

## 저장하는 근거

이미 검증된 신규 원료 매입 원가 변경 이력에 `purchaseCostBasis`를 함께 남긴다. 최초 전표 줄의 공급가액·확인 kg·거래 수량·단가·세액·합계·과세 여부, 원가 계산에 사용한 행 번호와 매입 단위 snapshot을 보존한다. 원가는 기존 `costFromPurchaseLine/Lines` 반환값을 사용한다. 원가가 같아 이력이 생기지 않던 경우는 그대로 유지한다.

| 값 | 실제 근거 | 바꾸지 않는 것 |
| --- | --- | --- |
| `kind:raw`, `baseUnit:kg` | 서버가 읽은 원료 홀더와 기존 원가 경계 | 원물 소유회사·임가공 여부를 추정하지 않는다. |
| `supplyAmount`, `confirmedKg`, `calculatedCost` | 사용한 최초 행의 공급가·확정 kg와 기존 계산 결과 | 가격·세금·반올림 정책을 새로 만들지 않는다. |
| `lines`, `sourceLineIndices` | 기존 단일/복수 매입 단위 coverage 검증을 통과한 최초 행 | 현재 등록표로 과거 전표를 다시 계산하지 않는다. |
| `kgBasis:manual-purchase-kg` | 직접 입력한 원가 계산용 `purchaseQuantityKg` | 거래 수량이나 실입고량을 이 kg로 바꾸지 않는다. |
| `kgBasis:registered-purchase-unit` | 최초 PU snapshot의 `inventoryQty`와 나머지 4필드 | 기존 발주·입고·로트 환산을 바꾸지 않는다. |

kg 근거가 없는 전표도 지금처럼 발행하고 원가 갱신만 생략한다. 기존 산식이 지원하지 않는 수동 kg·PU 복수 행 조합의 계산 범위를 확대하지 않는다. 과거 원가 이력은 추가하거나 고치지 않는다. 원물 소유권·임가공 원가의 실제 거래별 자료는 별도 원본028 잔여다.

`isTaxExempt`는 기존 세금 계산이 적용한 truthy 여부를 `Boolean`으로 저장한다. 옛 입력의 문자열 같은 원문은 원전표에 그대로 보존하며 새 boolean 입력 제한을 추가하지 않는다. 이 값은 외부 세금계산서의 실증 자료를 뜻하지 않는다.

## 재시도에서 관측 이력을 다시 만들지 않는다

기존 원가 이력은 수정·삭제될 수 있는 관측 자료다. 발행 완료 판단의 기준은 보호된 원전표와 생성·삭제 영수증의 회사·작업번호·원문 hash 및 기존 주문·발주 연결이다. 현재 costHistory의 존재나 before/after 값 때문에 같은 발행 요청의 완료 확인을 막던 조건은 제외한다.

같은 요청의 재시도는 수동으로 바꾼 현재 품목 원가·이력, 삭제된 이력, 새 근거가 없는 옛 이력을 다시 쓰지 않는다. 원전표 가격·kg·매입 단위 등 최초 payload가 달라지면 기존 hash 검사로 계속 거절한다. 원가기록 근거를 새 금융 발행 가드로 쓰지 않으며 새 전표·번호·재고 작업도 만들지 않는다.

## 범위와 검증

서버 본문 `functions/src/tradeStatementIssue.ts`와 기존 emulator 시험만 제품 변경한다. 새 UI·DTO·collection·Rules·gate는 없다. 관련 배포 대상은 기존 `issueTradeStatementCommand` 단일이다. 합성 서버 TX 검증과 실제 Callable 전송 증거를 혼동하지 않는다. 수동 원가 kg·단일 PU·기존 지원 복수 PU의 근거 보존, kg 없는 발행과 원가 동일 이력 없음, 재시도 무쓰기·수동 원가/이력 변경·삭제/옛 자료 보존, 다른 원문 거절과 자기 자료 정리를 검증한 뒤 결과를 기록한다. 운영 자료를 직접 수정하지 않는다.

최종 로컬 Admin Firestore TX 시험은 36개 통과(20767/93eab8)했다. 신규 10사례의 합성 51경로는 finally에서 삭제 후 부재를 확인했다. Callable wrapper는 mock이며 실제 로그인·RPC 검증으로 확대하지 않는다. 메타 누락 변이 7실패, 삭제된 이력 가드 재삽입 변이 2실패, 면세 엄격 비교 변이 1실패를 검출하고 원본 복원·통과를 확인했다. 면세 `'면세'` 원문·공급가 44,000·세액 0·원가 1,100·발주 수량 2 보존과 재고·로트·원료 상태·원장 불변을 확인했다.

기존 매입 원가·거래처 가격 동기화 시험 50개 통과, 앱/서버 타입 및 Functions 빌드 55669 exit0. 최종 일반 시험 68858은 `--mode localtest`로 527파일·4775시험 통과·7제외, 실패0·exit0(289.81초)이다. 필드 사전 생성·check-only 36395 exit0: 87컬렉션·737직접 필드·468소스·634참조 필드·2533미해석 접근·517wrapper. 별도 서버 모델의 새 근거 필드는 공용 interface 직접 필드 수에 포함되지 않는 기존 한계를 유지한다. 독립 검수 추가 P1/P2 없음.

## 실제 배포

`3aaf596` worktree·canonical main·GitHub main의 일치를 직접 확인했다. 단일 `functions:issueTradeStatementCommand` 배포 51798 exit0, 성공 업데이트와 Deploy complete를 확인했고 fresh Functions 조회는 `asia-northeast3 / nodejs22 / gcfv2 / ACTIVE`다. 배포에 포함된 기존 필수 predeploy 서버 컴파일만 수행했고 Hosting·Rules·다른 함수·설정·gate·운영 자료는 변경하지 않았다. 로컬 합성 TX 검증과 실제 운영 Callable 호출 검증을 구분한다. 과거 원가 이력·전표를 소급 보강하지 않는다.
