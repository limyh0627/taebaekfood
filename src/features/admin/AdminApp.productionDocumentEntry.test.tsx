/** @vitest-environment jsdom */
import React, { useState, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import ProductionWorkDocumentHost from '../production-documents/ui/ProductionWorkDocumentHost';
import { newProductionWorkDocument } from '../production-documents/domain/productionWorkDocument';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), load: vi.fn(), save: vi.fn(), uid: 'uid-1' }));
vi.mock('../production-documents/infrastructure/productionWorkDocumentRepository', () => ({ loadProductionWorkDocument: mocks.load, loadProductionWorkEvidence: async () => [], saveProductionWorkDocument: mocks.save }));
vi.mock('../../shared/components/appDialog', () => ({ appConfirm: mocks.confirm, appNotice: vi.fn() }));
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
const entryView = compile(entry, ['docTab', 'productionDocumentDate', 'productionDocumentScope', 'changeProductionDocumentDate', 'productionDocumentKey', 'reportProductionDocumentState', 'companyId', 'currentUser', 'ProductionWorkDocumentHost']);
// 상태·세대·날짜 callback도 제품 AST 원문을 호출한다. 시험 전용 상태모델을 복제하지 않는다.
const start = source.indexOf('  const [productionDocumentDate,');
const end = source.indexOf('  const [showNotifPanel', start);
const stateJs = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const actualState = new Function('useState', 'useRef', 'today', 'companyId', 'currentUser', 'auth', 'appConfirm', stateJs + ';return {productionDocumentDate,productionDocumentScope,changeProductionDocumentDate,productionDocumentKey,reportProductionDocumentState};');
const hostProps = vi.fn();
function EvidenceHost(props: React.ComponentProps<typeof ProductionWorkDocumentHost>) { hostProps(props); return <div data-testid="production-host"><ProductionWorkDocumentHost {...props}/></div>; }
function StaffEntry({ companyId = 'taebaek', actorId = 'employee-1' }: { companyId?: string; actorId?: string }) {
  const [tab, setTab] = useState('생산판매기록부');
  const state = actualState(useState, useRef, () => '2026-10-11', companyId, { id: actorId }, { get currentUser() { return { uid: mocks.uid }; } }, mocks.confirm);
  return <>{tabView(React, false, tab, setTab)}{entryView(React, tab, state.productionDocumentDate, state.productionDocumentScope, state.changeProductionDocumentDate, state.productionDocumentKey, state.reportProductionDocumentState, companyId, { id: actorId }, EvidenceHost)}</>;
}
afterEach(() => { cleanup(); hostProps.mockClear(); mocks.confirm.mockReset(); mocks.uid = 'uid-1'; });
mocks.load.mockImplementation(async (company: any, date: string, actor: string) => ({ document: newProductionWorkDocument(company, date, actor, 'now'), lines: [] }));
it('실제 직원 메뉴는 기존 저장 Host 하나로 진입하고 날짜와 회사를 전달한다', async () => {
  const view = render(<StaffEntry />);
  expect(screen.queryByRole('button', { name: '생산작업기록부' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '생산작업일지' }));
  expect(screen.getAllByTestId('production-host')).toHaveLength(1);
  expect(hostProps).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'taebaek', date: '2026-10-11', actorId: 'employee-1' }));
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'), { target: { value: '2026-09-30' } });
  view.rerender(<StaffEntry companyId="punghoe" />);
  expect(hostProps).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'punghoe', date: '2026-09-30', actorId: 'employee-1' }));
});
it('날짜 전환 취소는 실제 Editor의 메모·행·결재 이름을 그대로 보존한다', async () => {
  mocks.confirm.mockResolvedValue(false);
  render(<StaffEntry/>);fireEvent.click(screen.getByRole('button',{name:'생산작업일지'}));await screen.findByLabelText('특이사항');
  fireEvent.change(screen.getByLabelText('특이사항'),{target:{value:'보존 메모'}});
  fireEvent.change(screen.getByLabelText('작성 이름'),{target:{value:'작성자'}});
  fireEvent.click(screen.getByRole('button',{name:'행 추가'}));
  fireEvent.change(screen.getByLabelText('1행 품목명'),{target:{value:'수동 품목'}});
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'),{target:{value:'2026-09-30'}});
  await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('생산작업일지 작성일')).toHaveValue('2026-10-11');
  expect(screen.getByLabelText('특이사항')).toHaveValue('보존 메모');
  expect(screen.getByLabelText('작성 이름')).toHaveValue('작성자');
  expect(screen.getByLabelText('1행 품목명')).toHaveValue('수동 품목');
});
it.each(['company','uid','selection'])('확인 대기 후 %s 변경은 옛 승인이 날짜를 바꾸지 않는다', async kind => {
  let resolve!: (value:boolean)=>void;
  mocks.confirm.mockReturnValueOnce(new Promise<boolean>(r=>{resolve=r;})).mockResolvedValueOnce(false);
  const view=render(<StaffEntry/>);fireEvent.click(screen.getByRole('button',{name:'생산작업일지'}));await screen.findByLabelText('특이사항');
  fireEvent.change(screen.getByLabelText('특이사항'),{target:{value:'초안'}});
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'),{target:{value:'2026-09-30'}});
  if(kind==='company')view.rerender(<StaffEntry companyId="punghoe"/>);
  if(kind==='uid'){mocks.uid='uid-2';view.rerender(<StaffEntry/>);}
  if(kind==='selection')fireEvent.change(screen.getByLabelText('생산작업일지 작성일'),{target:{value:'2026-09-29'}});
  await act(async()=>{resolve(true);});
  expect(screen.getByLabelText('생산작업일지 작성일')).toHaveValue('2026-10-11');
});
it('저장 중 날짜 선택은 잠시 멈추고 성공 후 확인 없이 새 날짜를 연다', async () => {
  let resolve!: (value:any)=>void;
  mocks.save.mockImplementationOnce((document:any,lines:any)=>new Promise(r=>{resolve=()=>r({document:{...document,revision:1},lines});}));
  render(<StaffEntry/>);fireEvent.click(screen.getByRole('button',{name:'생산작업일지'}));await screen.findByLabelText('특이사항');
  fireEvent.change(screen.getByLabelText('특이사항'),{target:{value:'저장할 메모'}});
  fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.getByLabelText('생산작업일지 작성일')).toBeDisabled());
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'),{target:{value:'2026-09-30'}});
  expect(screen.getByLabelText('생산작업일지 작성일')).toHaveValue('2026-10-11');
  await act(async()=>{resolve(undefined);});
  await waitFor(()=>expect(screen.getByLabelText('생산작업일지 작성일')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('생산작업일지 작성일'),{target:{value:'2026-09-30'}});
  expect(screen.getByLabelText('생산작업일지 작성일')).toHaveValue('2026-09-30');
  expect(mocks.confirm).not.toHaveBeenCalled();
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
