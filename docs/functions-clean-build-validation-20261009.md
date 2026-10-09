# TODO038 생성 파일 분리 선행 검증

고정 commit376239dd의 Functions src/package/tsconfig만 private 복사하고 lib 없는 상태에서 실제 Node22 v22.23.3으로 TypeScript 빌드를 실행했다. build61821 exit0, non-test TS68개에서 JS68개와 sourceMap68개 생성, index 모듈 실제 로딩 exit0 및 기존32 export 확인이다. 운영 함수를 실행하지 않았으며 canonical lib의 물리 파일은 수정하거나 삭제하지 않았다. 원문 결과는 private work/todo038-clean-export-result-20261009.json에 보존한다.

firebase.json Functions predeploy에 중앙 build를 연결하고 .gitignore에 /functions/lib/를 추가한 두 파일은 준비됐다. 표준 근거는 [Firebase CLI의 predeploy와 RESOURCE_DIR 설명](https://firebase.google.com/docs/cli)이다. root 배포 스크립트·Functions package deploy·직접 Firebase CLI 모두 동일 중앙 설정을 사용한다. main lib/index.js는 유지된다.

tracked136개 index 해제는 아직 수행하지 않았다. employeeLogin.js/.map 및 passwordHash.js/.map 네 보존 원문은 work/batch7-preserved-generated-20261008의 기존 규칙대로 유지한다. clean compiler 검증을 보존 원문 교체로 해석하지 않는다. 배포·전체038 인수는 별도 최종 확인 사항이다. 운영 쓰기·푸시0이다.

후속으로 총괄이 1ba322e5 정확138파일(설정2+cached136)로 Git 추적을 해제했고 물리136개의 해시는 불변임을 확인했다(47398d). private 고정 소스의 실제 Functions emulator13189는 Node22·demo-todo038-clean·별도5181에서 정의32개를 로드하고 HTTP28개를 초기화한 뒤 exit0로 정상 종료했다. Pub/Sub 및 Firestore emulator를 기동하지 않아 해당 trigger4개는 정의 로드만 확인했다. 실제 함수 호출은0이다. private 로그는 work/todo038-emulator-load-final-20261009.log이며, 앞선 경로·권한 실패 시도는 로드 검증 근거로 세지 않는다.

기존 AI 미사용 정리51a7cd6c의 타입·양앱빌드·Hosting·실파일 검증 근거는 MEMORY에 있다. 실제 AI상담 smoke를 직접 확인한 별도 증거는 이번 읽기에서 확보하지 못했으므로 전체038 완료 수는 아직 추가하지 않는다.

최종 인수: 총괄이 운영 Edge의 별도 탭에서 dashboard→AI인사이트에 진입하여 heading과 기존 ‘준비중입니다’ placeholder를 접근성 트리 및 screenshot으로 확인했다. warn/error 로그는 비어 있었고 UI 데이터 쓰기·AI 질문 전송0, 검증 탭은 종료했다. AI 상담 답변 기능을 검증한 것은 아니다. 기존51a7cd6c AI 패키지·청크 정리와 양앱 배포 증거, 이번1ba322e5 중앙빌드·생성파일 추적 해제·clean compiler·모듈·에뮬레이터 로드 증거를 합쳐 총괄이 원본038 전체 수용을 확정했다. 원본43개 중14완료·29잔여, 우선15는11완료·4보류를 유지한다. Notion 쓰기·운영 DB 쓰기·푸시0이다.
