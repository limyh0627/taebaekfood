# 매입 지급 원자 저장 — 원본 전체 인수

원본 https://app.notion.com/p/3ec2cda7782b816c97bdf7a767641850

PAYMENT-ATOMIC는 baseline43의 기존18완료 관리키와 다른 원본이다. 다른022/PARTNER의 실제 구현·시험·배포 증거를 재사용하지만 같은 관리키를 두 번 집계하지 않는다. 과거 지급과 푸미 운영 분개를 자동 변경하지 않는다.

| 원본 조건 | 실제 근거 |
|---|---|
| 원분개500→251·819→253·직접251/253, 회사/거래처/차대 검증 | claimFromStatement가 저장된 원전표의 원분개 필드를 판독한다. autoJournal 직접 호출은 아니며 신규 실제SDK에서 앱journalizeStatement의251/253과 서버결과 동치를 대조했다. 불명확 원문을 표시fallback으로 지급하지 않는다. |
| 혼합·부분·초과133 | 서버 plan이 원전표별 배분 계정을 보존한다. 신규 실제SDK가혼합부분·초과133와결정적settlement를검증한다. 실제CashEntryModal→recordPayment→serverplan의초과회귀도누적증거다. |
| cash·정산·번호·revision 단일TX 및실패 불변 | partnerPaymentCommand가 첫쓰기전원자료를읽고함께저장한다. 실제SDK의성공/중복/같은ID경합·stale/계좌·회사/권한거절 및원문불변근거를보존한다. |
| 이중클릭·응답유실 | 실제server duplicate receipt와클라이언트pending전체요청동일ID재개,unknown보존·durableterminal거절후수정재시도시험을대조한다. |
| 계정별 잔액·검색·Rules | 서버claim별계정과앱원장/조회기존consumer공용투영을대조하고actualAuth회사거절·serveronly Rules와실파일배포근거를재사용한다. |

최종 focused92826→9378fc는5파일41통과 중PAYMENT3파일37이며 실제Auth/Firestore9(기존7·신규2)837af4→1c5350 통과와합쳐이원본의고유4파일46시험이다. 두원본의합계는6파일50이며이41/9와중복합산하지않는다. 처음actualSDK8통과·Auth cold5초 timeout1실패를보존하고privateconfig25초조정후전체9통과했다. 재시도나노초불변은캡처한cash/state/partner/links/originals에한정하고counter는last불변이다. 감사/counter updateTime까지불변이라고하지않는다. callable권한본문/SDK검증을운영HTTP전체E2E로확대하지않는다.

서버누적운영근거는5307f949의선택recordPartnerPayment runtime/compiled ZIP일치, d2d8dc60 선택16 runtime53/compiled13일치 및후속c268ccf8 13함수runtime60/compiled60일치다. 태백기존활성과명시승인11910 풍회정산활성·독립b83cdd/금융버전0을구분한다. 기존032Node22 배포와이번f1a39ec7 타입·양빌드·Hosting33파일/양HTML일치근거를보존한다. 이번은시험2파일만추가하며제품수정·재배포·운영가짜지급0이다.

추가fixture 전체타입95574→ba2cec exit0. 시험 로컬커밋e10b6cbc 정확2파일91추가이며제품/runtime변경0이다. 총괄이 PAYMENT 및 ORDER의독립원본전체인수를확정했다. 현재20완료23잔여,우선15는11완료4보류다. 기존18/25는초안시점역사이며운영원금·과거지급정정·새gate·Notion쓰기·GitHub푸시0이다.
