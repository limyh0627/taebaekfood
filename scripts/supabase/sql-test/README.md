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
- 날짜·시각·uuid·오늘 번호는 지우고 견준다. 오늘 날짜에 따라 바뀌는 결과(배송일 지남 등)가 다르게 나오면 확인 후 `--update`.
- `supabase-trial`에 올리면 GitHub Actions(`Supabase SQL test`)가 저절로 돈다.
