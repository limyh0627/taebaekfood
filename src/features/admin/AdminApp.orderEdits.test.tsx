/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { saveOrderEdit } from '../orders/application/orderEditService';
import { OrderStatus, type Order } from '../../shared/types';
import type { SaveOutcome } from '../../shared/saveOutcome';
const text = readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ast = ts.createSourceFile('AdminApp.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['orderEditRenderUid', 'orderEditRenderToken', 'currentOrderEditScope', 'orderEditScopeRejected', 'runOrderEdit', 'handleSaveOrderEdit', 'readPendingOrderEdits', 'readOrderEditReferences', 'handleInspectOrderEdit', 'handleCancelOrderEdit', 'handleDiscardOrderEditCopy', 'orderEditBindings'];
function harness() {
    const declarations: string[] = [];
    function walk(n: ts.Node) {
        if (ts.isVariableDeclaration(n) && names.includes(n.name.getText(ast)))
            declarations.push('const ' + n.getText(ast) + ';');
        ts.forEachChild(n, walk);
    }
    walk(ast);
    expect(declarations).toHaveLength(names.length);
    const auth = { currentUser: { uid: 'actor' } }, orderAskScope = { current: { companyId: 'taebaek', token: {} } };
    const submit = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'saved' })), inspect = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'saved' })), cancel = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'cancelled', message: '중단 확인' }));
    const pending = vi.fn(() => []), refs = vi.fn(() => []), discard=vi.fn(async():Promise<SaveOutcome>=>({status:'saved'}));
    const deps = { auth, orderAskScope, companyId: 'taebaek', currentUser: { name: '관리자' }, saveOrderEdit, appConfirm: vi.fn(async () => true), submitOrderEdit: submit, pendingOrderEdits: pending, orderEditReferences: refs, inspectOrderEdit: inspect, cancelOrderEdit: cancel,discardOrderEditCopy:discard };
    const body = ts.transpileModule(declarations.join(' ') + ' return {' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return { ...deps, submit, inspect, cancel, discard, pending, refs, callbacks: new Function(...Object.keys(deps), body)(...Object.values(deps)) };
}
const row: Order = { id: 'opening', companyId: 'taebaek', partnerName: '실표시 거래처', items: [{ itemId: 'oil', name: '참기름', quantity: 1, price: 100 }], totalAmount: 100, status: OrderStatus.PENDING, createdAt: '2025-02-01', deliveryDate: '2025-02-03', email: '', source: '일반' };
it('부모와 실제 service는 opening 원문을 그대로 단일 서버 submit에 전달한다', async () => {
    const h = harness(), edit = { kind: 'items' as const, items: [{ ...row.items[0], quantity: 2 }] };
    expect(await h.callbacks.handleSaveOrderEdit(row, edit)).toEqual({ status: 'saved' });
    expect(h.submit).toHaveBeenCalledExactlyOnceWith({ companyId: 'taebaek', actorUid: 'actor' }, row, edit, false);
});
it('다른 회사 원문과 UID교체는 새 요청 전송 전에 거절한다', async () => {
    const h = harness();
    expect((await h.callbacks.handleSaveOrderEdit({ ...row, companyId: 'punghoe' }, { kind: 'items', items: row.items })).status).toBe('rejected');
    h.auth.currentUser = { uid: 'other' };
    expect((await h.callbacks.handleSaveOrderEdit(row, { kind: 'items', items: row.items })).status).toBe('rejected');
    expect(h.submit).not.toHaveBeenCalled();
});
it('정확한 plan과target만inspect/cancel하고 회사세대전환뒤복구도전송하지않는다', async () => {
    const h = harness();
    await h.callbacks.handleInspectOrderEdit('plan', 'opening');
    await h.callbacks.handleCancelOrderEdit('plan', 'opening');
    expect(h.inspect).toHaveBeenCalledExactlyOnceWith({ companyId: 'taebaek', actorUid: 'actor' }, 'plan', 'opening');
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith({ companyId: 'taebaek', actorUid: 'actor' }, 'plan', 'opening');
    h.orderAskScope.current.token = {};
    expect((await h.callbacks.handleInspectOrderEdit('old', 'opening')).status).toBe('rejected');
    expect(h.inspect).toHaveBeenCalledOnce();
    expect(h.callbacks.readPendingOrderEdits()).toEqual([]);
});
it('실제 주문·배송 부모 bindings는같은원자콜백·복구정본이며직접품목writer가없다', () => {
    const h = harness(), binding = h.callbacks.orderEditBindings;
    expect(binding.onSaveOrderEdit).toBe(h.callbacks.handleSaveOrderEdit);
    expect(binding.onCancelOrderEditReference).toBe(h.callbacks.handleCancelOrderEdit);
    expect(text).not.toContain('const handleUpdateItems =');
    expect(text).not.toContain("appendItemHistory: history => addItem('orderItemEdits'");
});

it('주문 사본 정리는 정확 참조·관측 원문만 전달하고 UID가 바뀌면 호출하지 않는다',async()=>{
 const h=harness();await h.callbacks.handleDiscardOrderEditCopy('fixed-plan','opening','observed-text');expect(h.discard).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'actor'},'fixed-plan','opening','observed-text');expect(h.callbacks.orderEditBindings.onDiscardOrderEditCopy).toBe(h.callbacks.handleDiscardOrderEditCopy);h.auth.currentUser={uid:'other'};expect((await h.callbacks.handleDiscardOrderEditCopy('fixed-plan','opening','observed-text')).status).toBe('rejected');expect(h.discard).toHaveBeenCalledOnce();expect(h.submit).not.toHaveBeenCalled();
});
it('주문 목록과 배송 화면은 사본 정리 포트를 실제 controller에 전달한다',()=>{
 for(const path of ['components/OrdersList.tsx','components/DeliveryManager.tsx']){const source=readFileSync(path,'utf8'),file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let wired=false;const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useOrderEditApplication'){const options=node.arguments[0];if(ts.isObjectLiteralExpression(options))wired=options.properties.some(prop=>ts.isShorthandPropertyAssignment(prop)&&prop.name.text==='onDiscardOrderEditCopy');}ts.forEachChild(node,visit);};visit(file);expect(wired,path).toBe(true);}
});
