# TODO037 전체 인수 대조

원본 https://app.notion.com/p/3e82cda7782b81bfb1a0f8deea95c7a4 을 직접 재조회했다. 요구는 import graph에서 미사용으로 확인한 백업·호환 파일을 기록 가치와 외부 참조까지 확인한 뒤 정리하는 것이다. 모든 역사 백업 또는 실제 데이터 호환 코드를 무조건 삭제하라는 요구는 아니다.

정확 대상 App.tsx_backup, components/Dashboard.tsx_backup, index.html_backup 세 파일은 d9b1520b에서 삭제됐다. 현재 물리 파일 부재, tracked 동일 백업 확장자 잔존0, 제품·scripts·package의 대상 참조0이며 Vite 진입은 apps/admin 및 apps/staff이다. 당시 설정·배포 진입 검사 및 마지막 정상 commit c85dd33acfd7369504b18a35f3dc8b3846e9f749와 파일별 Git blob은 private work/todo037/ui-backup-cleanup-candidate.md에 보존되어 복구 가능하다. 저장소 밖 모든 개인 도구 사용이 없다고 주장하지 않는다.

scripts/*backup*.json은 현재86개 그대로 추적된다. delete-order.mts, fix-add-savings-accounts.mts 등의 명시 복구·정정 백업 경로가 실제 존재하며 import graph의 미사용만으로 기록 가치가 없어지지 않는다. 운영 원문·undo 자료를 삭제하지 않는다. 실제 소비하는 unpackTo 등 데이터 호환은039 조건과 별도이며 generated lib는038에서 별도로 처리됐다.

누적 MEMORY 근거는 d9b1520b 묶음39PASS·타입·양앱빌드·Hosting·원격파일 exit0이며 private work/todo-batch4-deploy-verification.log의 matched 결과가 보존돼 있다. 이번에는 제품 변경·파일 삭제·시험·배포를 추가하지 않았다.

총괄이 원본을 직접 재조회하고 정확3삭제·현재 참조0·backup86 정당 보존을 대조하여 전체037 수용을 확정했다. 새 삭제를 만들거나 ‘모든 미사용 코드가 존재하지 않는다’는 새 인수조건을 추가하지 않는다. 원본43개 중16완료27잔여이며 Notion 쓰기0·운영쓰기0·푸시0다. 별도034 kit 복원 결함은 아직 인수 미완료이며 이번 집계에 포함하지 않는다.
