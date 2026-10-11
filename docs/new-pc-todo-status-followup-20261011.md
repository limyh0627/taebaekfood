# 2026-10-11 새 PC 경로·TODO 상태 후속

- TODO039: 일일 점검 CLI의 특정 사용자 C:/Users/TAEBAEK 고정 인증 경로 제거. GOOGLE_APPLICATION_CREDENTIALS 최우선, 현 사용자 홈/.secrets/taebaek-admin.json 존재 확인, 없으면 기존 applicationDefault 순서를 유지한다. 자격증명 내용 및 운영자료 접근0.
- 기존 --input 제품 보고서/--raw-input 원료 보고서와 새 경로 선택 회귀 3파일16시험 통과. 별도 CLI 타입검사 exit0, 고정 사용자 경로 오류 변이2FAIL 및 원복4PASS 확인.
- TODO037/038: 현재 코드와 최종 인수 문서·이전 원문 기록을 대조해 노션의 오래된 대기를 기존 완료로 정정하고 재조회 확인. 신규 완료0·전체21완료22잔여 유지. 운영 복구 backup86개를 보존하고 Functions runtime 생성/배포는 하지 않는다.
- 이번 실제 제품 변경은 CLI에 한정되며 관리자·직원 웹 번들 변경을 위한 추가 Hosting 배포가 필요하지 않다.