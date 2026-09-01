# 태백푸드 프로젝트

## 먼저 읽을 것
- [할일.md](할일.md) — 지금 안 하지만 잊으면 안 되는 것 (**세션 시작할 때 훑고, 끝난 건 지운다**)
- [인수인계.md](인수인계.md) — 지켜야 할 규칙(화면·BOM·재고·원가·전표·데이터 수정)
- [DB-CHANGELOG.md](DB-CHANGELOG.md) — DB를 건드린 이력과 되돌리는 법
- [docs/표준계정과목-이전계획.md](docs/표준계정과목-이전계획.md) — 계정번호를 표준으로 옮기는 계획(**아직 안 함**)

## 기술 스택
- React + TypeScript + Vite
- Firebase (Firestore, Hosting, Auth)
- PWA (vite-plugin-pwa)

## 배포
- Firebase 프로젝트: `taebaek-3abe4`
- 직원(staff) 앱: `npm run deploy:staff` → https://taebaek-3abe4.web.app
- 관리자(admin) 앱: `npm run deploy:admin` → https://taebaek-staff.web.app
- 전체 배포: `npm run deploy:all`
- ~~taebaekappdb.web.app 사용 안 함~~
