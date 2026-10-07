import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';

const source = ts.createSourceFile('AdminApp.tsx', readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let body = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
    const callback = node.arguments[0];
    if (callback && ts.isArrowFunction(callback) && /loadHistoricalOrders\(start, end\)/.test(callback.body.getText(source)))
      body = callback.body.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
const day = ts.transpileModule(readFileSync('src/shared/day.ts', 'utf8').replace(/^export \{ kstDateOf \}.*\n/m, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
it.each(['UTC', 'Asia/Seoul'])('과거 생성일 조회 실제 effect는 %s에서도 전월 첫날부터 월말까지 포함한다', zone => {
  const script = `const exports = {}; ${day}
    const cases = ['2026-09', '2027-01', '2028-02', '2026-02', '', '잘못된월', '2026-00', '2026-9'];
    const result = cases.map(month => {
      let range = null;
      const record = (...value) => { range = value; };
      const run = new Function('docTab', 'productionWorkMonth', 'docYearMonth', 'loadHistoricalOrders', 'addMonths', 'endOfMonth', ${JSON.stringify(body)});
      run('생산작업기록부', month, '', record, exports.addMonths, exports.endOfMonth);
      const production = range;
      range = null; run('원료수불부', '', month, record, exports.addMonths, exports.endOfMonth);
      if (JSON.stringify(production) !== JSON.stringify(range)) throw new Error('문서 경로 조회 기간 불일치');
      return range;
    }); console.log(JSON.stringify(result));`;
  const child = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual([
    ['2026-08-01', '2026-09-30'], ['2026-12-01', '2027-01-31'],
    ['2028-01-01', '2028-02-29'], ['2026-01-01', '2026-02-28'],
    null, null, null, ['2026-08-01', '2026-09-30'],
  ]);
});
