# 새 ERP DB 규칙 시험

`supabase/sql`(시험 이전 SQL + erp-core 복사본)을 메모리 Postgres(pglite)에 처음부터 다 돌리고,
업무 흐름(주문→생산→출고→전표→반품, 발주·입고, 임가공, 착유, 장부, 휴가, 채팅, 업무, 세금계산서…)을
차례로 실행해 결과를 `expected.txt`와 견준다. 막혀야 할 일(권한·음수 재고·중복 발행 등)은 `ERR …`로 남는다.

```
cd scripts/supabase/sql-test
npm install
node run.mjs            # 견주기
node run.mjs --update   # 일부러 바꾼 결과면 expected.txt를 다시 적고 같이 커밋
```

- 새 규칙을 만들면 `cases.mjs` 끝(030 검사 앞)에 그 흐름을 넣고 `--update`.
- 시계는 2026-11-05 12:00(한국)에 고정해서 돌린다(cases.mjs 맨 위). 그래도 uuid·시각은 지우고 견준다.
- SQL 파일은 실제 이전처럼 두 번 돈다. erp 스키마는 다시 만들지만 public 함수는 남으므로, 매개변수 이름을 바꾼 함수는 앞 파일에서 `drop function if exists` 해야 한다.
- `supabase-trial`에 올리면 GitHub Actions(`Supabase SQL test`)가 저절로 돈다.
