# 미사용 전표 계획 정리 및 App Check 읽기 조사

## 미사용 저장 계획

`statementWrites.ts`의 `planStatementWrites`는 제품에서 호출되지 않고 전용 시험에서만 호출됐다. 이 계획에는 주문 존재 확인 없이 `invoicePrinted`를 merge하는 옛 방식이 남아 있었다. 본체와 전용 시험만 제거하고 정적 사전을 다시 생성했다. 서버의 현재 전표 발행 및 앱의 송장 표시 갱신 본체는 변경하지 않았다.

현재 서버 발행은 주문 존재·회사·거래처를 확인한 뒤 전표 연결을 update한다. 송장 표시도 updateDoc을 사용하므로 누락된 주문을 새로 생성하는 현재 실행 경로는 확인되지 않았다. 실제 조사된 불완전 주문의 과거 생성 원인으로 이 미사용 코드를 단정하지 않는다. 운영 문서는 삭제하거나 보정하지 않았다. 실제 명령·재시도 관련 기존 회귀 19건과 공식 사전 자체 검증을 통과했다.

## App Check 원본 TODO008

제품 소스에서 App Check 초기화 및 Functions의 강제 옵션은 확인되지 않았다. 실제 운영 조회에서 프로젝트 확인은 성공했지만, App Check 설정 조회는 `403 SERVICE_DISABLED`, 함수 검증 로그 조회는 권한 부족으로 거절됐다. 설정 미조회 결과를 enforcement OFF로 해석하지 않는다.

Monitoring 지표 정의 3개는 읽었다. 최근 24시간 검증 시계열은 반환되지 않았으며, 이를 실제 요청 0건 또는 정상 검증 100%로 해석하지 않는다. 현재 확인된 증거로는 monitor에서 enforce로 전환할 준비가 됐다고 판정할 수 없다. 기존 Rules 시험도 App Check 요청 검증률을 입증하지 않는다.

다음 조건은 실제 앱 등록·provider·site key·허용 도메인 확인, SDK 초기화, 유효/누락/실패 토큰의 모니터 자료 확인이다. API 활성화·권한 변경·key 발급·강제 적용은 수행하지 않았다. 운영 API 응답과 조회 로그는 비공개 파일에만 보존한다.

공식 계약: [서비스 설정 조회](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.services/get), [함수 요청 검증 모니터링](https://firebase.google.com/docs/app-check/monitor-functions-metrics).

두 작업은 원본 TODO039·008의 부분 진전이다. 전체43개 중21개 완료·22개 잔여 집계는 유지한다. GitHub 푸시는 하지 않았다.
