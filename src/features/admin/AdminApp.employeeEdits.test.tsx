import fs from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SaveOutcome } from '../../shared/saveOutcome';
const source = fs.readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
function expression(name: string) {
    const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let value: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
            value = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(file);
    if (!value)
        throw Error(name + ' 실제 콜백 없음');
    return ts.transpileModule('return (' + value.getText(file) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
it('실제 부모 직원 저장은 열림 입력을 재구성하지 않고 고정 회사·UID와 전달한다', async () => {
    const scope = { companyId: 'taebaek', actorUid: 'actor' }, submit = vi.fn(async () => ({ status: 'rejected', message: '충돌', requiresReopen: true }));
    const run = new Function('currentEmployeeEditScope', expression('runEmployeeEdit'))(() => scope);
    const handle = new Function('runEmployeeEdit', 'submitEmployeeEdit', expression('handleEmployeeEdit'))(run, submit);
    const input = { targetId: 'employee', kind: 'balance', opening: { id: 'employee' }, balance: { bonusLeave: 1, carryOverLeave: 2 } };
    const result = await handle(input);
    expect(submit).toHaveBeenCalledExactlyOnceWith(scope, input);
    expect(result.requiresReopen).toBe(true);
});
it('부모 회사·UID 세대가 만료되면 employee RPC를 호출하지 않는다', async () => {
    const work = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'saved' }));
    const run = new Function('currentEmployeeEditScope', expression('runEmployeeEdit'))(() => null);
    expect((await run(work)).status).toBe('rejected');
    expect(work).not.toHaveBeenCalled();
});
it('실제 부모 scope는 렌더 UID와 회사 token을 모두 확인한다', () => {
    const token = {}, context = { current: { companyId: 'taebaek', token } }, auth = { currentUser: { uid: 'actor' } };
    const scope = new Function('employeeEditRenderUid', 'employeeEditRenderToken', 'orderAskScope', 'companyId', 'auth', expression('currentEmployeeEditScope'))('actor', token, context, 'taebaek', auth);
    expect(scope()).toEqual({ companyId: 'taebaek', actorUid: 'actor' });
    auth.currentUser.uid = 'other';
    expect(scope()).toBeNull();
    auth.currentUser.uid = 'actor';
    context.current.token = {};
    expect(scope()).toBeNull();
});
it('직원 모달과 고아 요청 복구 배선이 직접 CRUD를 우회하지 않는다', () => {
    expect(source).toContain('onSaveEmployeeEdit={handleEmployeeEdit}');
    expect(source).toContain('onInspectEmployeeEdit={handleInspectEmployeeEdit}');
    expect(source).toContain('onCancelEmployeeEdit={handleCancelEmployeeEdit}');
    expect(source).toContain('onReadPendingEmployeeEdits={readPendingEmployeeEdits}');
    expect(source).toContain('onReadEmployeeEditReferences={readEmployeeEditReferences}');
    expect(source).not.toContain("onUpdateEmployee={(emp) => updateItem('employees'");
    expect(source).not.toContain("onAddEmployee={(emp) => addItem('employees'");
});
