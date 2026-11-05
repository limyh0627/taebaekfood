// 실행: (scripts/supabase/sql-test에서) npm install && node run.mjs [--update]
// 날짜·시각·번호처럼 돌릴 때마다 바뀌는 값은 지워서 견준다.
import fs from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
const { lines } = await import('./cases.mjs');
const now = new Date(Date.now() + 9 * 3600e3);
const ymd = now.toISOString().slice(0, 10), ym = ymd.slice(0, 7), yymmdd = ymd.slice(2).replace(/-/g, '');
const norm = s => s
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, '<시각>')
  .split(ymd).join('<오늘>').split(ym).join('<이달>').split(yymmdd).join('<오늘6>');
const got = lines.map(norm).join('\n') + '\n';
const file = here + 'expected.txt';
if (process.argv.includes('--update') || !fs.existsSync(file)) {
  fs.writeFileSync(file, got);
  console.log(`expected.txt를 새로 적었습니다(${lines.length}줄).`);
  process.exit(0);
}
const want = fs.readFileSync(file, 'utf8');
const errs = got.split('\n').filter(l => /^(CHKERR)/.test(l));
if (got === want && !errs.length) { console.log(`통과: ${lines.length}개 결과가 기대와 같습니다.`); process.exit(0); }
const a = want.split('\n'), b = got.split('\n');
let shown = 0;
for (let i = 0; i < Math.max(a.length, b.length) && shown < 30; i++) {
  if (a[i] !== b[i]) { console.log(`- 기대 ${i + 1}: ${a[i] ?? '(없음)'}\n+ 실제 ${i + 1}: ${b[i] ?? '(없음)'}`); shown++; }
}
console.log('\n결과가 기대와 다릅니다. 일부러 바꾼 것이면 node run.mjs --update로 expected.txt를 다시 적고 같이 커밋하세요.');
process.exit(1);
