# TODO015 연결 대출 정기 상환 — 배포 및 전체 인수

원본: https://app.notion.com/p/3e82cda7782b81c1b0c3c08bec658ec5

소스66a2715a 정확10파일(358추가·27삭제)을 로컬 커밋했다. 정기 상환은 같은 회사의 연결 대출 및 원금 계정260/293을 확인하고 원금·이자 입력을 전용 대출 명령에 연결한다. 일반 정기 발행 경로로 대출을 우회하지 않는다. 월별 원자 저장 및 재시도 receipt를 사용하고 기존 번호·대출 revision·한도 계약을 보존한다. 과거 상환을 임의로 연결하거나 운영 양식·gate를 활성화하는 작업은 포함하지 않는다.

검증은 실제 SDK25·Functions 순수254·앱47, 총39파일326개의 서로 다른 시험 근거이며 반복 실행은 합산하지 않는다. 실제 Node22 Functions 컴파일, 전체 앱 타입, 양앱 빌드가 통과했다. 설정 UI 신규4시험을 포함하며 독립 검수 P1/P2는 없다. 실제 HTTP 전송 및 운영 scheduler trigger 실행 전체 검증으로 확대하지 않는다.

원본의 서버 검증·배포 후 UI 확인 순서를 충족했다. 선택 dailyAutoVoucher 및 recordLoanMovementCommand 두 함수 배포7486 exit0, 두 함수 ACTIVE/nodejs22이며 ZIP runtime68·compiled68이 모두 일치했다. 나머지30함수의 source와 정규화한 trigger 속성은 불변이다. ZIP 초기9006e5 실패는 private compiled snapshot의 shared 폴더 누락으로, 이를 보완한32e846 exit0 결과를 최종 근거로 사용한다. Hosting58039 exit0, 원격75461→0d77f8에서31파일 및 양쪽 HTML 진입이 일치했다.

총괄이 원본015 전체 인수를 확정하여 원본43개 중15완료28잔여다. 운영 DB·정기 양식 설정·새gate 활성화·Notion 쓰기·GitHub 푸시0이다. 별도034 kit SDK는 이번 제품 범위에 포함하지 않는다.
