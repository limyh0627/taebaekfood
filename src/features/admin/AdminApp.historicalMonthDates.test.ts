/** @vitest-environment jsdom */
import { useEffect } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { addMonths, endOfMonth } from '../../shared/day';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';

const source = ts.createSourceFile('AdminApp.tsx', readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let body = '';
let monthDependencies = '';
let statementBody = '';
let statementDependencies = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
    const callback = node.arguments[0];
    if (callback && ts.isArrowFunction(callback) && /loadHistoricalOrders\(start, end\)/.test(callback.body.getText(source))) {
      body = callback.body.getText(source);
      monthDependencies = node.arguments[1].getText(source);
    }
    if (callback && ts.isArrowFunction(callback) && /loadHistoricalOrders\('2020-01-01', today\(\)\)/.test(callback.body.getText(source))) {
      statementBody = callback.body.getText(source);
      statementDependencies = node.arguments[1].getText(source);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
afterEach(cleanup);

// 실제 부모의 본문과 의존성을 함께 실행해 콜백 세대가 바뀐 같은 화면을 검증한다.
const runMonthEffect = new Function('useEffect', 'docTab', 'docYearMonth', 'loadHistoricalOrders', 'addMonths', 'endOfMonth',
  `useEffect(() => ${body}, ${monthDependencies});`);
const runStatementEffect = new Function('useEffect', 'currentView', 'loadHistoricalOrders', 'today',
  `useEffect(() => ${statementBody}, ${statementDependencies});`);

it('원료수불부는 같은 월에서 새 로더 세대만 다시 조회한다', () => {
  const previous = vi.fn(), current = vi.fn();
  const view = renderHook(({ loader }) => runMonthEffect(useEffect, '원료수불부', '2027-01', loader, addMonths, endOfMonth), {
    initialProps: { loader: previous },
  });
  expect(previous).toHaveBeenCalledExactlyOnceWith('2026-12-01', '2027-01-31');
  view.rerender({ loader: previous });
  expect(previous).toHaveBeenCalledTimes(1);
  view.rerender({ loader: current });
  expect(current).toHaveBeenCalledExactlyOnceWith('2026-12-01', '2027-01-31');
  view.rerender({ loader: current });
  expect(current).toHaveBeenCalledTimes(1);
});

it('전표는 같은 메뉴에서 새 로더 세대의 전체 이력을 다시 조회한다', () => {
  const previous = vi.fn(), current = vi.fn();
  const view = renderHook(({ loader, menu }) => runStatementEffect(useEffect, menu, loader, () => '2026-10-15'), {
    initialProps: { loader: previous, menu: 'trade-statement' },
  });
  expect(previous).toHaveBeenCalledExactlyOnceWith('2020-01-01', '2026-10-15');
  view.rerender({ loader: previous, menu: 'trade-statement' });
  expect(previous).toHaveBeenCalledTimes(1);
  view.rerender({ loader: current, menu: 'trade-statement' });
  expect(current).toHaveBeenCalledExactlyOnceWith('2020-01-01', '2026-10-15');
  view.rerender({ loader: current, menu: 'orders' });
  expect(current).toHaveBeenCalledTimes(1);
});
const day = ts.transpileModule(readFileSync('src/shared/day.ts', 'utf8').replace(/^export \{ kstDateOf \}[^\r\n]*\r?\n/m, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
it.each(['UTC', 'Asia/Seoul'])('과거 생성일 조회 실제 effect는 %s에서도 전월 첫날부터 월말까지 포함한다', zone => {
  const script = `const exports = {}; ${day}
    const cases = ['2026-09', '2027-01', '2028-02', '2026-02', '', '잘못된월', '2026-00', '2026-9'];
    const result = cases.map(month => {
      let range = null;
      const record = (...value) => { range = value; };
      const run = new Function('docTab', 'docYearMonth', 'loadHistoricalOrders', 'addMonths', 'endOfMonth', ${JSON.stringify(body)});
      run('생산작업일지', month, record, exports.addMonths, exports.endOfMonth);
      if (range !== null) throw new Error('새 일지가 옛 월별 주문 조회를 실행함');
      run('원료수불부', month, record, exports.addMonths, exports.endOfMonth);
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
