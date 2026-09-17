# 태백푸드 프로젝트

> **Codex 도 이 저장소에서 일한다** — 그쪽은 [AGENTS.md](AGENTS.md) 를 읽는다.
> 둘은 같은 것을 가리키는 얇은 안내판이다. **규칙 자체는 [인수인계.md](인수인계.md) 한 곳에 있으니,
> 규칙을 고칠 일이면 두 안내판이 아니라 거기를 고친다.**

## 먼저 읽을 것
- [할일.md](할일.md) — 지금 안 하지만 잊으면 안 되는 것 (**세션 시작할 때 훑고, 끝난 건 지운다**)
  - 아래 `@할일.md` 로 **세션마다 자동으로 올라온다.** 따로 열 필요 없다.
- [인수인계.md](인수인계.md) — 지켜야 할 규칙(화면·BOM·재고·원가·전표·데이터 수정)
  - **가장 먼저**: "같은 일에는 같은 함수를 쓴다" — 셈을 새로 짜기 전에 그 절의 목록부터 본다
  - 900줄이라 통째로 안 올린다. **셈·전표·재고·원가·BOM·데이터수정에 손대기 전에**
    `grep -n '^#' 인수인계.md` 로 목차를 먼저 보고 해당 절만 읽는다. 목차를 안 보고 새로 짜지 않는다.
- [DB-CHANGELOG.md](DB-CHANGELOG.md) — DB를 건드린 이력과 되돌리는 법
- [진행사항.md](진행사항.md) — Codex와 주고받는 **지금 진행 중인 한 작업** (있으면 그것부터 본다)
- [로컬전용/docs/표준계정과목-이전계획.md](로컬전용/docs/표준계정과목-이전계획.md) — 계정번호를 표준으로 옮기는 계획(**아직 안 함**)

## 절차서(스킬)
필요할 때만 불러 쓴다 — CLAUDE.md와 달리 **부를 때만 토큰을 쓴다.**
- `/db-fix` — 운영 Firestore 문서를 고칠 때. dry → 백업 → 승인 → `--apply` → 재조회 → DB-CHANGELOG 기록

@할일.md

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
