# 연속 TODO 묶음 · 구 화면·공용 가공비·실제 인증

2026-10-11 후속039/023/041을 묶어 검증한다. 원본 전체 완료와 작은 구현 후속은 구분하며 신규 완료 수를 더하지 않는다.

## 039 구 화면 경로

시작 화면 저장값, notif URL, 서비스워커 알림, 상위 currentView에 남은 item-price-management는 공용 normalizeViewAlias로 현재 item-management에 연결한다. 구 lazy/render·직접 cost 저장 분기와 미참조 ItemPriceManager 본체/전용시험을 제거했다. 현재 회사 품목·BOM·단가·수정 콜백은 유지한다. 실제 effect와 분기를 실행하는 Host 및 현대 ItemManager 회귀5파일17PASS, alias 제거 변이 실패 검출·복구17PASS, 앱 타입·양앱 빌드 exit0. 전체 AdminApp mount 시험은 아니다.

## 041 실제 로그인 회귀

기존 태백 회사 경계 SDK1PASS를 유지하면서 풍회 실제 로그인 뒤 자기회사 수정 성공·태백 수정 거절·회사 위조 거절, 로그아웃 뒤 양사 수정 거절을 추가했다. 두 문서 data 및 updateTime 불변을 비교한다. 실제 로컬 Auth9099/Firestore8082 demo 프로젝트에서 최종3PASS·skip0·exit0. 이번 생성한 UUID 계정2개/문서2개만 삭제하고 부재를 확인한다. 제품/Rules/공유 config/운영 자료 변경0. 이전1PASS를 신규 완료로 재계수하지 않는다.

## 023 공용 가공비 줄 계획

앱 oemEngine과 서버 oemFeeVoucher가 별도로 계산하던 완제품/벌크 가공비 줄, 옛 배치 한 줄 fallback, 마지막 줄 원단위 차이를 순수 공용 계획으로 합치는 후보를 구현 중이다. kg/BOM 해석, 회사 검증, 원자 저장·전표번호, 028 원가 근거는 기존 소비자의 책임으로 유지한다. 공용 본체 합류 후 집중9파일79PASS, 실제 서버SDK2파일21PASS·명시 벌크 입력 타입 보완 후 fee16PASS 재확인(중복합산0). 앱 타입0이며 최초 서버 타입은 Row[] 인터페이스 불일치를 검출해 명시 map으로 고쳤다. 최종 서버 타입·사전·양앱 빌드 exit0. VAT20% 변이21FAIL/원복57PASS를 확인했으며 독립 검토 P1/P2 없음. 기존 lineAmount의 Number||0·반품·VAT0.1 정책은 canonical Functions shared 본체에 그대로 옮기고 앱은 재export한다. 최종 전체 일반 회귀와 배포를 완료했다.

집계는 원본 생산일지 전체 수용 조건 재대조로 **21완료·22잔여**로 정정했다. 이번039/023/041 후속을 추가 완료로 세지 않는다.

최종 전체 일반 회귀474파일PASS/4skip, 4,021PASS/122skip·실패0·exit0. 반복 검증은 신규 합계에 추가하지 않는다.

## 실제 배포 확인

소스 66f31fb3c55ad8d51ec89686bb2eb1b6cc2cfd72를 GitHub main에 푸시했다. issueOemFeeVoucherCommand 단독 서버 배포 및 관리자·직원 Hosting 배포 모두 exit0이며, 서버 함수 ACTIVE/nodejs22를 확인했다. 원격 HTML2·JS113·CSS2 총117개 파일의 SHA가 빌드와 일치한다. 구 가격 화면 청크 제거로 이전119개에서117개가 됐다. Rules·운영 자료·활성화 설정은 변경하지 않았다. 상세 실행 증거는 private records/todo023-oem-fee-plan에 보존한다.

