import {buildCostFn} from '../../shared/bomCost';
import {buildFormula as buildFormulaBom,formulaRowsOf} from './bom';
/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { executeItemEditorSteps, createItemEditorProgress } from '../items/application/itemEditorSave';
import { boxSpecUpdates } from '../../shared/boxSpec';
import { crossCompanyBoms } from '../../shared/itemCompany';
import { unpackComponent } from '../../shared/orderUnits';
import { buildBomIndex } from '../../shared/bomIndex';
import { buildPackIndex } from '../../shared/packIndex';
import { COL } from '../../shared/collections';
import type { Item, PartnerItem } from '../../shared/types';
const source = readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ast = ts.createSourceFile('AdminApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
    let found = '';
    function visit(n: ts.Node) {
        if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name)
            found = n.initializer!.getText(ast);
        ts.forEachChild(n, visit);
    }
    visit(ast);
    expect(found).not.toBe('');
    return ts.transpileModule('const callback=' + found + ';return callback;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const unit: Item = { id: 'unit', companyId: 'taebaek', name: '참기름', type: 'product', spec: '350ml', stock: 7, minStock: 0, unit: '병', image: 'old-url', imagePath: 'old-path' };
const box: Item = { ...unit, id: 'box', name: '참기름 박스', spec: '350ml * 20' };
const cap: Item = { ...unit, id: 'cap', name: '마개', type: 'submaterial' };
function harness() {
    let current = true;
    const allItems = [unit, box, cap], itemBoms = [{ id: 'box-line', parent_id: 'box', child_id: 'unit', quantity: 20 }, { id: 'bom-unit__cap', parent_id: 'unit', child_id: 'cap', quantity: 1 }];
    const appData = { orderUnitInputs: { bom: buildBomIndex(allItems, itemBoms), pack: buildPackIndex() } };
    const commit = vi.fn(async (_ops: Array<{
        kind: string;
        collection: string;
        id: string;
        data?: Record<string, unknown>;
    }>) => {
    }), cost = vi.fn(async () => {
    }), prepare = vi.fn((ops: unknown[]) => ops), refresh = vi.fn();
    const deps = {itemEditorCommittedSnapshot:{current:null},itemEditorToken:{}, isCurrentItemEditor: () => current, editingProduct: unit, allItems, itemBoms, itemFormulas: [], companyId: 'taebaek', appData, COL, crossCompanyBoms, boxSpecUpdates, commitCompanyWrites: commit, recomputeAllCosts: cost, executeItemEditorSteps, prepareCompanyWriteOperations: prepare, refreshStaticData: refresh };
    const save = new Function(...Object.keys(deps), expression('saveItemEditorPrimary'))(...Object.values(deps));
    return { save, commit, cost, prepare, refresh, appData, allItems, setCurrent: (v: boolean) => current = v };
}
it('품목·박스 규격·BOM을 단일 gateway에 보내고 오래된 재고·미변경 사진을 쓰지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress(unit.id);
    const result = await h.save({ ...unit, spec: '500ml', bomDraft: [{ childId: 'cap', qty: 2 }], photoChanged: false }, progress, () => true);
    expect(result.outcome.status).toBe('saved');
    expect(h.commit).toHaveBeenCalledOnce();
    const ops = h.commit.mock.calls[0][0] as Array<{
        kind: string;
        collection: string;
        id: string;
        data?: Record<string, unknown>;
    }>;
    expect(ops.find(op => op.id === 'unit')).toMatchObject({ kind: 'update', data: { spec: '500ml' } });
    expect(ops.find(op => op.id === 'unit')?.data).not.toHaveProperty('stock');
    expect(ops.find(op => op.id === 'unit')?.data).not.toHaveProperty('image');
    expect(ops.find(op => op.id === 'box')).toMatchObject({ kind: 'update', data: { spec: '500ml * 20' } });
    expect(ops.filter(op => op.id === 'bom-unit__cap')).toHaveLength(1);
    expect(progress.confirmedStageIds).toEqual(['primary', 'cost']);
});
it('원가 실패는 primary ACK를 보존한 부분 완료이며 재호출로 주업무를 다시 쓰지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress(unit.id);
    h.cost.mockRejectedValue(Error('원가 응답 유실'));
    const product = { ...unit, bomDraft: [{ childId: 'cap', qty: 2 }] };
    expect((await h.save(product, progress, () => true)).outcome.status).toBe('partial');
    expect(progress.unknownStageId).toBe('cost');
    await h.save(product, progress, () => true);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.cost).toHaveBeenCalledOnce();
});
it('순수 전송전 오류는 미확정 잠금 없이 거절하고 gateway를 호출하지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress(unit.id);
    h.prepare.mockImplementation(() => {
        throw Error('쓰기 한도 초과');
    });
    const result = await h.save({ ...unit, bomDraft: [] }, progress, () => true);
    expect(result.outcome.status).toBe('rejected');
    expect(progress.unknownStageId).toBeUndefined();
    expect(h.commit).not.toHaveBeenCalled();
});
it('주업무 ACK 뒤 회사가 바뀌면 원가 후속 쓰기를 시작하지 않는다', async () => {
    const h = harness(), progress = createItemEditorProgress(unit.id);
    h.commit.mockImplementation(async () => {
        h.setCurrent(false);
    });
    expect((await h.save({ ...unit, bomDraft: [] }, progress, () => true)).outcome.status).toBe('partial');
    expect(h.cost).not.toHaveBeenCalled();
});
it('낱개 자동연결 안내 대기 중 회사가 바뀌면 재귀 후속 쓰기를 하지 않는다', async () => {
    const h = harness();
    let current = true, finish!: () => void;
    const set = vi.fn(async () => {
    }), notice = vi.fn(() => new Promise<void>(resolve => finish = resolve));
    const deps = { setDocument: set, setPartnerItems: vi.fn(), allItems: h.allItems, appData: h.appData, partnerItems: [], unpackComponent, awaitNotice: notice, deleteField: vi.fn() };
    const body = 'const handleUpsertPartnerItem=' + expression('handleUpsertPartnerItem').replace(/^const callback = /, '').replace(/;\s*return callback;?\s*$/, '') + ';return handleUpsertPartnerItem;';
    const handler = new Function(...Object.keys(deps), body)(...Object.values(deps));
    const row: PartnerItem = { id: 'box_partner_in', itemId: 'box', partnerId: 'partner', Direction: 'in', price: 2000 };
    const task = handler(row, 'in', () => current);
    await Promise.resolve();
    await Promise.resolve();
    expect(notice).toHaveBeenCalledOnce();
    current = false;
    finish();
    await expect(task).rejects.toThrow('바뀌었습니다');
    expect(set).toHaveBeenCalledOnce();
});

function costHarness(type:'product'|'wip'='product'){
 const original:Item={...unit,type,phantom:true,cost:100,costSource:'rollup'},child:Item={...cap,cost:50},ancestor:Item={...unit,id:'ancestor',name:'합성 상위 품목',cost:10,costSource:'rollup'};
 const allItems=[original,child,ancestor,{...cap,id:'raw',name:'원료',type:'raw' as const,cost:50}],itemBoms=[{id:'bom-unit__cap',parent_id:'unit',child_id:'cap',quantity:2},{id:'ancestor-line',parent_id:'ancestor',child_id:'unit',quantity:2}],itemFormulas:unknown[]=[];
 const costWrite=vi.fn(async(_collection:string,_id:string,_data:Record<string,unknown>)=>{}),commit=vi.fn(async(_ops:unknown[])=>{}),token={},snapshot:{current:null|{token:object;itemId:string;items:Item[];boms:typeof itemBoms}}={current:null};
 const calcDeps={allItems,itemBoms,itemFormulas,buildCostFn,buildFormulaBom,formulaRowsOf,updateItem:costWrite,useCallback:(fn:unknown)=>fn};
 const cost=new Function(...Object.keys(calcDeps),expression('recomputeAllCosts'))(...Object.values(calcDeps));
 const deps={isCurrentItemEditor:()=>true,editingProduct:original,allItems,itemBoms,itemFormulas,companyId:'taebaek',appData:{orderUnitInputs:{bom:buildBomIndex(allItems,itemBoms),pack:buildPackIndex()}},COL,crossCompanyBoms,boxSpecUpdates,commitCompanyWrites:commit,recomputeAllCosts:cost,executeItemEditorSteps,prepareCompanyWriteOperations:(ops:unknown[])=>ops,refreshStaticData:vi.fn(),itemEditorCommittedSnapshot:snapshot,itemEditorToken:token};
 const save=new Function(...Object.keys(deps),expression('saveItemEditorPrimary'))(...Object.values(deps));
 let formulaText='';function visit(n:ts.Node){if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onSaveItemFormula'&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression)formulaText=n.initializer.expression.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 const formula=new Function(...Object.keys(deps),ts.transpileModule('const callback='+formulaText+';return callback;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(deps));
 return {save,formula,costWrite,original,snapshot};
}
it('실제 원가 정본은 primary에서 저장한 수동 0원을 이후 BOM·배합 갱신으로 덮지 않는다',async()=>{const h=costHarness('wip'),progress=createItemEditorProgress('unit');expect((await h.save({...h.original,cost:0,costSource:'manual',bomDraft:[{childId:'cap',qty:3}]},progress,()=>true)).outcome.status).toBe('saved');await h.formula(h.original.name,[{child_name:'원료',ratio:1,yield_rate:0.5}],undefined);expect(h.snapshot.current?.items.find(item=>item.id==='unit')).toMatchObject({cost:0,costSource:'manual',stock:7,image:'old-url'});expect(h.costWrite.mock.calls.filter(call=>call[1]==='unit')).toEqual([]);});
it('자동 롤업은 새 BOM을 실제 원가 정본에 넣어 해당 품목과 상위 품목을 갱신한다',async()=>{const h=costHarness(),progress=createItemEditorProgress('unit');await h.save({...h.original,bomDraft:[{childId:'cap',qty:3}]},progress,()=>true);expect(h.costWrite).toHaveBeenCalledWith('items','unit',{cost:150});expect(h.costWrite).toHaveBeenCalledWith('items','ancestor',{cost:300});});
