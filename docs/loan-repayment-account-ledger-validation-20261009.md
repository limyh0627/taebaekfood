# 계좌 미지정 상환 표시·계좌 지정 검증 — 배포 완료·원본 전체 인수

아래 초안 대기 문구는 초기 검증 시점의 이력이며, 최신 결과는 문서 말미 최종 확인을 기준으로 한다.

원본: [TODO-LOAN-REPAYMENT-ACCOUNT-LEDGER-20261002](https://app.notion.com/p/3ed2cda7782b8189b5d8e9eb44be0d78). 원문은 계좌 공란의 BANK 103 폴백과 계좌별 장부 차이, 미지정 상태 표시 및 이후 명시 지정/정정 경로의 설계·검증을 요구한다. 과거 운영 귀속 변경은 별도다.

소스 `c7f336cf`는 이번 입고·반품 후속과 함께 정확24파일을 로컬 commit했다. 선택4 Functions 배포와 서버 원격 소스 검증은 완료했고, 후속 앱 타입·빌드·Hosting 검증과 총괄의 원본 전체 수용 판정은 대기다. GitHub 푸시는 하지 않았다. 전체 집계20완료·23잔여는 유지한다.

| 원본 조건 | 실제 경로와 검증 |
| --- | --- |
| 공란 회계 분개와 계좌별 귀속의 차이 | `src/shared/autoJournal.ts`의 journalizeCashEntry는 cashAccountMap의 계좌가 없으면 BANK103을 사용한다. `cashAccountLedger.ts`는 cashAccountId가 해당 계좌인 거래만 포함한다. 미지정 표시가 특정 통장 귀속이나 현금 계정을 추정하지 않는다. |
| 미지정 상태의 가시성 | CashLedger는 실제 계좌가 존재해도 미지정 입출금을 별도 표시하며, 합성260/951 사례의 표시·분개 회귀를 검증했다. 실제 과거 전표의 loanId 누락 여부나 거래 은행을 합성 시험으로 확정하지 않는다. |
| 이후 사용자가 명시 지정 | CashEntryModal의 별도 지정 동작 → TradeStatement 전용 callback → 기존 mutateCash → cashMutationCommand. 기본 선택은 공란이고 같은 회사의 active 통장만 고른다. 일반 금액 저장·자동 매칭을 호출하지 않는다. |
| 금융 원문 보존 | exact `{cashAccountId}` 분기는 loanId를 필수로 하지 않으며 260/951 원문을 재분류하지 않는다. cashAccountId·mutationRevision과 기존 voucherMutationOperations 감사만 저장한다. 금액·날짜·분개·대출 원금·settlements·partner revision·계좌 confirmedBalances·번호는 쓰지 않는다. |
| 확정 거절과 응답 유실 | metadata 정책 거절은 full command·actor·company·hash를 바인딩한 durable rejected 감사로 확정한다. cashEntryIds를 넣지 않아 applied 변경 사슬에 섞이지 않는다. 클라이언트는 정확 terminal proof와 실제 UID 확인 후 저장 원문 CAS로 해제한다. gate/원문 충돌·불명확 read/commit은 그대로 보존한다. |
| 다른 창과 재시도 | 송신 전에 caller가 캡처한 원문을 확인하고, 초기 release 조회 후에도 최초 관찰값이 같을 때만 저장한다. 지연된 release/Auth 동안 다른 창 원문 교체 시 송신0·새 원문 보존을 검증했다. 완전한 다중 탭 최초 동시 직렬화를 주장하지 않는다. |
| 원 발행 재시도 | readCashCreationMutation이 최초 beforeSnapshot과 applied 감사 사슬의 afterHash를 확인한다. 실제 Admin SDK의 일반 발행 → 계좌 지정 → 원 발행 replay에서 원문·번호 재생성이 없고 counter updateTime도 유지된다. |
| 확정잔액 기준 | 지정된 거래는 해당 계좌 원장에 나타나지만 이후 confirmedBalance의 target을 변경하지 않는다. 기초일 이전 거래는 원장에 포함되지 않는 기존 계약과 안내를 유지한다. |

transferOperationId·payrollId·returnOperationId·balanceAdjustment 원문은 이 일반 지정 분기에서 제외한다. 활성 선급·선수 적용이 이 cash를 원천으로 참조하면 적용 원천 fingerprint에 계좌가 포함되므로 특정 원천만 보류한다. 일반 생성 receipt와 기존 applied 감사 사슬은 유지한다. 신규 상환은 기존 명시 계좌 필수 정책을 유지한다.

## 검증 근거

- 최종 통합 focused `26653 → 9abea4`: 8파일115 PASS.
- 실제 Admin Firestore TX SDK: 수량5·취소6·계좌 지정3, 정확3파일14 PASS. 이번 묶음 고유 합계11파일129 PASS이며 이전 단독 실행 결과를 다시 더하지 않는다.
- 계좌 지정 SDK `4257 → 32f400`: legacy260/951 원문·loan/settlement/account 나노초 버전 유지, confirmed anchor, 원 발행 replay, 거절된 동일 작업의 성공 전환 불가 및 새 작업 성공을 확인했다. actual Auth/callable 전송 검증으로 확대하지 않는다.
- 클라이언트 최종16 PASS에는 확정 거절 이후 다른 선택, unknown 재개, 잘못된 proof 보존 및 두 지연 CAS 경계가 포함된다. 독립 검수 P1/P2 없음.
- 전체 앱 타입·Functions69 JS compile 및 보존4파일 복원·관리자/직원 build `81511 → 2230fa` exit0.

운영 전표 귀속 정정·대출 잔액 변경·가짜 거래 생성·gate 활성화·Notion 쓰기는0이다. 원격 배포 확인 후 총괄의 원본 전체 수용 결과를 별도로 추가한다.

서버 배포 28860 → c93bf4 exit0, 메타 읽기 310e6 및 원격 비교 467d52 exit0: 선택4 함수의 원본69·compiled69 모두 byte 일치, 전체33 ACTIVE/Node22, 나머지29 source 및 eventTrigger 불변을 확인했다. 후속 서비스 신규1을 포함하는 이번 묶음 고유 결과는11파일130(순수116·Admin SDK14)이다. 최종 후속 앱 검증 43707은 진행 중이며 신규 Hosting은 아직 미완료다.

최종 후속 앱 타입·양앱 build43707 exit0, Hosting86780 exit0 및 원격72682(8473bf) exit0으로33JS와 양 HTML entry가 일치했다. 총괄은 LOAN 원본 전체를 수용하여 원본43개 중21완료·22잔여, 우선15개 중11완료·4잔여로 확정했다. INBOUND 후속은 실제360/390px 전체 화면 인수가 남아 전체 미완료다. 운영 DB·신규 gate·GitHub push·Notion·Figma 쓰기0이다.
