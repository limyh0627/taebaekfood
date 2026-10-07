import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { kstDateOf } from '../../../src/shared/day';

// 실제 handler 본문의 날짜 선언만 실행하고 DB/AI는 호출하지 않는다.
const index = ts.createSourceFile('index.ts', readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let monthlyBody = '';
let dailyBody = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(index) === 'dailyAutoVoucher') {
    const callback = (node.initializer as ts.CallExpression).arguments[1] as ts.ArrowFunction;
    dailyBody = (callback.body as ts.Block).statements.filter(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(d => ['kst', 'y', 'm', 'd', 'ym', 'today'].includes(d.name.getText(index))))
      .map(statement => statement.getText(index)).join('\n') + '\nreturn today;';
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(index) === 'monthlyInventorySnapshot') {
    const callback = (node.initializer as ts.CallExpression).arguments[1] as ts.ArrowFunction;
    monthlyBody = (callback.body as ts.Block).statements.filter(statement => {
      if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(d =>
        ['now', 'kst', 'date', 'nextDay', 'isLastDay', 'year', 'month', 'yearMonth'].includes(d.name.getText(index)));
      if (ts.isExpressionStatement(statement)) return /^nextDay\./.test(statement.getText(index));
      return ts.isIfStatement(statement) && /isLastDay|nextDay/.test(statement.expression.getText(index));
    }).map(statement => statement.getText(index)).join('\n') + '\nreturn yearMonth;';
  }
  ts.forEachChild(node, visit);
}
visit(index);
const extract = readFileSync('functions/src/extractOrder.ts', 'utf8').match(/const 오늘 = (.+);/)![1];
const sharedPath = 'functions/src/shared/calculation.ts';
const shared = existsSync(sharedPath) ? ts.transpileModule(readFileSync(sharedPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText : '';

it.each(['UTC', 'Asia/Seoul'])('실제 월말/추출 날짜 본문은 %s에서도 한국 달력을 사용한다', zone => {
  const script = `
    const exports = {}; ${shared}
    const RealDate = Date;
    const cases = ['2026-09-30T14:00:00Z', '2026-12-31T14:00:00Z', '2026-12-31T15:00:00Z', '2028-02-29T14:00:00Z'];
    const result = cases.map(instant => {
      const Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } };
      const month = (() => { ${monthlyBody} })();
      const fallback = (() => { const today = undefined; return ${extract}; })();
      const explicit = (() => { const today = '2026-07-15'; return ${extract}; })();
      if ((() => { ${dailyBody} })() !== fallback) throw new Error('자동전표의 한국 날짜 불일치');
      return { month: month ?? null, fallback, explicit };
    });
    console.log(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual([
    { month: '2026-09', fallback: '2026-09-30', explicit: '2026-07-15' },
    { month: '2026-12', fallback: '2026-12-31', explicit: '2026-07-15' },
    { month: null, fallback: '2027-01-01', explicit: '2026-07-15' },
    { month: '2028-02', fallback: '2028-02-29', explicit: '2026-07-15' },
  ]);
});

it.each([
  ['2026-09-29T14:59:59.999Z', '2026-09-29'],
  ['2026-09-29T15:00:00Z', '2026-09-30'],
  ['2026-12-31T15:00:00Z', '2027-01-01'],
  ['2028-02-28T15:00:00Z', '2028-02-29'],
  ['2028-02-29T15:00:00Z', '2028-03-01'],
])('앱에서 공유한 %s의 한국 날짜는 %s이며 원입력은 보존한다', (iso, expected) => {
  const input = new Date(iso); const before = input.getTime();
  expect(kstDateOf(input)).toBe(expected);
  expect(input.getTime()).toBe(before);
});
it('기존 순수 helper의 유효하지 않은 Date 거절을 유지한다', () => {
  expect(() => kstDateOf(new Date(NaN))).toThrow(RangeError);
});
