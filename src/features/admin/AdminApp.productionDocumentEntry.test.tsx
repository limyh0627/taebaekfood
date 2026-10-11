/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(process.env.PRODUCTION_ENTRY_SOURCE || 'src/features/admin/AdminApp.tsx', 'utf8');
const ast = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tabs = ''; let entry = '';
function visit(node: ts.Node) {
  if (ts.isJsxExpression(node) && node.expression) {
    const text = node.expression.getText(ast);
    if (text.startsWith('!isAdmin &&') && text.includes("setDocTab('생산작업일지')")) tabs = text;
    if (text.startsWith("docTab === '생산작업일지' &&")) entry = text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(text: string, args: string[]) {
  if (!text) throw Error('실제 생산일지 진입 JSX가 없습니다.');
  const js = ts.transpileModule('const result = (' + text + ');', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('React', ...args, js + ';return result;');
}
const tabView = compile(tabs, ['isAdmin', 'docTab', 'setDocTab']);
const entryView = compile(entry, ['docTab', 'productionDocumentDate', 'setProductionDocumentDate', 'companyId', 'currentUser', 'ProductionWorkDocumentHost']);
const hostProps = vi.fn();
function EvidenceHost(props: { companyId: string; date: string; actorId: string }) { hostProps(props); return <div data-testid="production-host">{props.companyId}/{props.date}/{props.actorId}</div>; }
function StaffEntry({ companyId = 'taebaek' }: { companyId?: string }) {
  const [tab, setTab] = useState('생산판매기록부'); const [date, setDate] = useState('2026-10-11');
  return <>{tabView(React, false, tab, setTab)}{entryView(React, tab, date, setDate, companyId, { id: 'employee-1' }, EvidenceHost)}</>;
}
afterEach(() => { cleanup(); hostProps.mockClear(); });
it('실제 직원 메뉴는 기존 저장 Host 하나로 진입하고 날짜와 회사를 전달한다', () => {
  const view = render(<StaffEntry />);
  expect(screen.queryByRole('button', { name: '생산작업기록부' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '생산작업일지' }));
  expect(screen.getAllByTestId('production-host')).toHaveLength(1);
  expect(hostProps).toHaveBeenLastCalledWith({ companyId: 'taebaek', date: '2026-10-11', actorId: 'employee-1' });
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'), { target: { value: '2026-09-30' } });
  view.rerender(<StaffEntry companyId="punghoe" />);
  expect(hostProps).toHaveBeenLastCalledWith({ companyId: 'punghoe', date: '2026-09-30', actorId: 'employee-1' });
});
it('폐기한 월별 화면·엑셀·제목 writer는 없고 타서류 공용 계산은 유지한다', () => {
  expect(source).not.toContain("docTab === '생산작업기록부'");
  expect(source).not.toContain("setDocTab('생산작업기록부')");
  expect(source).not.toContain('생산작업기록부_${productionWorkMonth}.xlsx');
  expect(source).not.toContain("setDocument('docSheetTitles'");
  expect(source).toContain("from '../../shared/docOil'");
  expect(source).toContain("docTab === '원료수불부'");
  expect(source).toContain('docOilKg(');
});
