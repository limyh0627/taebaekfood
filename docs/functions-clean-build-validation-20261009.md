# TODO038 생성 파일 분리 선행 검증

고정 commit376239dd의 Functions src/package/tsconfig만 private 복사하고 lib 없는 상태에서 실제 Node22 v22.23.3으로 TypeScript 빌드를 실행했다. build61821 exit0, non-test TS68개에서 JS68개와 sourceMap68개 생성, index 모듈 실제 로딩 exit0 및 기존32 export 확인이다. 운영 함수를 실행하지 않았으며 canonical lib의 물리 파일은 수정하거나 삭제하지 않았다. 원문 결과는 private work/todo038-clean-export-result-20261009.json에 보존한다.

firebase.json Functions predeploy에 중앙 build를 연결하고 .gitignore에 /functions/lib/를 추가한 두 파일은 준비됐다. 표준 근거는 [Firebase CLI의 predeploy와 RESOURCE_DIR 설명](https://firebase.google.com/docs/cli)이다. root 배포 스크립트·Functions package deploy·직접 Firebase CLI 모두 동일 중앙 설정을 사용한다. main lib/index.js는 유지된다.

tracked136개 index 해제는 아직 수행하지 않았다. employeeLogin.js/.map 및 passwordHash.js/.map 네 보존 원문은 work/batch7-preserved-generated-20261008의 기존 규칙대로 유지한다. clean compiler 검증을 보존 원문 교체로 해석하지 않는다. 배포·전체038 인수는 별도 최종 확인 사항이다. 운영 쓰기·푸시0이다.
