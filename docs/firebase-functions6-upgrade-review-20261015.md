# Firebase Functions 6.x 별도 호환성 검토

## 현재 범위

할일 원문은 6.x 업그레이드 검토이며 실제 서버 전환 완료를 뜻하지 않는다. 현재 서버 lock은 Functions 5.1.1, Admin 12.7.0, TypeScript 5.9.3이고 Node.js 22다. 후보는 Functions 6.6.0 한 패키지다. Admin·TypeScript·Node major와 업무 코드를 함께 바꾸지 않는다.

6.0.0은 패키지의 기본 진입점을 v1에서 v2로 바꿨다. 이 저장소는 기존 제품 코드에서 v2 경로를 명시적으로 import한다. 이 사실만으로 실행 호환이 검증된 것으로 판단하지 않고 실제 SDK 비교를 수행한다. [공식 6.0.0 변경 기록](https://github.com/firebase/firebase-functions/releases/tag/v6.0.0), [6.6.0 공식 패키지 선언](https://github.com/firebase/firebase-functions/blob/v6.6.0/package.json).

## 원본을 보존하는 검토 방법

작업폴더와 functions의 node_modules는 기본 작업폴더를 가리키는 junction이다. 그 경로에서 패키지를 설치하지 않는다. 기존 package·lock·tsconfig·src 일반 파일만 두 별도 비공개 디렉터리에 복사하고 baseline과 candidate의 실제 의존성을 각각 설치한다. 인증·환경 파일·junction·기존 lib는 복사하지 않는다. 각 SDK 해석 경로가 해당 격리 디렉터리 안인지와 원본 공유 런타임의 버전·SHA 보존을 확인한다.

같은 제품 소스를 두 버전에서 빌드해 내보낸 함수 이름과 세대·트리거·지역·스케줄·시간대·secret·메모리·timeout 선언을 비교한다. 모듈 로드 때 Admin 앱과 Firestore 객체가 만들어지므로 비운영 프로젝트 환경만 사용하고 제품 핸들러를 실행하지 않는다. HTTP 계약은 실제 SDK의 합성 callable 핸들러로 비교하며 운영 DB·인증 토큰·외부 AI를 호출하지 않는다.

## 검토 결과

동일한 선택 파일 183개의 SHA를 고정해 두 환경을 준비했다. 양 환경에서 실제 TypeScript 컴파일이 성공했고 제품 함수 42개의 전체 `__endpoint`와 `__requiredAPIs` 선언이 일치했다. 후보는 Functions 6.6.0이며 Admin 12.7.0과 TypeScript 5.9.3은 유지됐다. 후보 lock의 나머지 실제 패키지 차이는 express 관련 타입 3개 변경과 mime·send 타입 2개 추가다.

실제 SDK의 합성 callable을 Express JSON 파서 뒤에 연결하고 127.0.0.1 임시 포트로 HTTP를 왕복했다. 정상 데이터·JSON null·잘못된 envelope·GET·명시 오류 details·합성 무인증 거절·OPTIONS·다른 origin의 8사례가 두 버전에서 일치했다. JSON 문법 자체가 깨진 요청을 시험했다고 주장하지 않는다. 제품 함수는 선언만 로드했고 업무 핸들러를 실행하지 않았다. 운영 인증 토큰·App Check·실 DB 동작의 검증은 아니다.

처음의 합성 req/res 객체 직접 호출 결과는 실제 네트워크 HTTP 근거와 구분했다. 실제 loopback 보완 후 명시 Node22 시험 3개가 skip 없이 통과했다. 후보 격리 사본의 선언과 응답을 각각 변조하면 비교 시험이 실패하는 것을 확인하고 바이트를 복원했다. 기본 sandbox의 포트 listen 실패는 환경 제약으로 분리하고 loopback 검증을 승인된 환경에서 실행했다.

제품 모듈을 로드할 때는 네트워크 연결을 전면 차단한다. 합성 HTTP를 실행할 때만 해당 127.0.0.1 포트에 연결하며 외부 호출 시도는 0이었다. 서버는 finally에서 닫는다. 원본 package·lock·제품 소스와 공유 설치는 변경하지 않았다. 검토 스크립트는 `scripts/firebase-functions6-compat.node.mjs`이며 일반 Vitest 검색에 들어가지 않는다. 이번에 보존한 격리 사본이 있을 때 Node22로 `node --test scripts/firebase-functions6-compat.node.mjs`를 실행한다. 사본이 없거나 현재 소스와 달라지면 검증을 거절하므로 새 기준으로 준비해야 한다.

## 전환 판단

위 격리 범위에서 6.6.0의 컴파일·함수 선언·합성 HTTP 호환성을 확인했다. 이 결과만으로 운영 업무 시나리오 전체가 검증됐다고 판단하지 않는다. 이번 TODO의 검토 결과는 남기되 원본 의존성 반영과 42개 함수의 실제 재배포는 수행하지 않는다. 실제 전환이 필요하면 예정된 서버 배포 범위와 되돌릴 버전을 먼저 정하고 그 범위의 승인 근거를 확인한다. 이번에는 운영 서버를 변경하지 않았으며 공유 로컬 SDK는 5.1.1을 유지한다.
