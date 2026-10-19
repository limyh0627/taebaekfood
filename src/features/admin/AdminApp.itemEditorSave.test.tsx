import fs from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { ItemEditorProgress, ItemEditorSaveResult } from '../items/application/itemEditorSave';
import { createItemEditorProgress } from '../items/application/itemEditorSave';
const source = fs.readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
function callback() {
    const file = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'saveItemEditorPrimary')
            initializer = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(file);
    if (!initializer)
        throw Error('실제 품목 저장 콜백이 없습니다.');
    return ts.transpileModule('return (' + initializer.getText(file) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function harness() {
    let current = true;
    const refresh = vi.fn(), submit = vi.fn(async (_scope: unknown, _input: unknown, progress: ItemEditorProgress, _isCurrent: () => boolean): Promise<ItemEditorSaveResult> => ({ progress, outcome: { status: 'unknown', message: '응답 미확인', nextAction: '결과 확인' } }));
    const deps = { submitItemEditorSave: submit, itemEditorRequestScope: { companyId: 'taebaek', actorUid: 'actor' }, isCurrentItemEditor: () => current, refreshStaticData: refresh };
    const save = new Function(...Object.keys(deps), callback())(...Object.values(deps));
    return { save, submit, refresh, setCurrent: (value: boolean) => current = value };
}
it('부모는 열 때 고정한 typed 입력과 진행 객체를 그대로 영속 writer에 전달한다', async () => {
    const h = harness(), progress = createItemEditorProgress('unit'), input = { opening: { targetId: 'unit' }, draft: { metadata: { cost: 0 } } };
    const result = await h.save(input, progress, () => true);
    expect(h.submit).toHaveBeenCalledWith({ companyId: 'taebaek', actorUid: 'actor' }, input, progress, expect.any(Function));
    expect(result.outcome.status).toBe('unknown');
    expect(h.refresh).not.toHaveBeenCalled();
});
it('품목 단계 ACK는 갱신하되 부모가 후속 계산·개별쓰기를 다시 하지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress('unit');
    h.submit.mockImplementation(async (_scope, _input, p) => {
        p.confirmedStageIds = ['primary'];
        return { progress: p, outcome: { status: 'partial', reason: 'followup-unconfirmed', committedIds: ['unit'], unconfirmedIds: [], message: '일부 완료', nextAction: '결과 확인' } };
    });
    const result = await h.save({}, progress, () => true);
    expect(result.outcome.status).toBe('partial');
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(callback()).not.toMatch(/commitCompanyWrites|recomputeAllCosts|updateItem|append/);
});
it('회사·UID 또는 모달 세대가 바뀌면 late ACK 후 부모 갱신도 하지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress('unit');
    h.submit.mockImplementation(async (_scope, _input, p) => {
        p.confirmedStageIds = ['primary'];
        h.setCurrent(false);
        return { progress: p, outcome: { status: 'saved' } };
    });
    await h.save({}, progress, () => true);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.submit.mock.calls[0][3]()).toBe(false);
});
it('모달 저장과 복구 포트는 동일 회사·UID scope와 현재 세대를 묶는다', () => {
    expect(source).toContain('onCaptureItemEditorOpening={(targetId,current)=>captureItemEditorOpening(itemEditorRequestScope,targetId,()=>isCurrentItemEditor()&&current())}');
    for (const method of ['inspectItemEditorSave', 'continueItemEditorSave', 'cancelItemEditorSave'])
        expect(source).toContain(method + '(itemEditorRequestScope,reference,progress,()=>isCurrentItemEditor()&&current())');
    expect(source).toContain('<ItemEditorRecoveryList entries={itemEditorRecoveryEntries}');
    expect(source).not.toContain('itemEditorCommittedSnapshot');
});

it('품목 사본 관측 원문은 복구 entry부터 모달 정리 포트까지 그대로 연결한다',()=>{
 expect(source).toContain('observedLocalText:row.observedLocalText');expect(source).toContain('initialObservedLocalText={itemEditorRecovery?.observedLocalText}');expect(source).toContain('discardItemEditorCopy(itemEditorRequestScope,reference,observed,()=>isCurrentItemEditor()&&current())');
 const file=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let port:ts.Expression|undefined;const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&node.name.getText(file)==='onDiscardItemEditorCopy'&&node.initializer&&ts.isJsxExpression(node.initializer))port=node.initializer.expression;ts.forEachChild(node,visit);};visit(file);expect(port).toBeDefined();expect(port!.getText(file)).not.toMatch(/refreshStaticData|onSave|deleteObject|setIsProductModalOpen/);
});
