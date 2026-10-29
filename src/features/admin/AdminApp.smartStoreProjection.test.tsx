import {confirmItemEditorPurchaseNotices} from '../items/services/saveItemEditorRelations';
/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {createItemEditorProgress} from '../items/application/itemEditorSave';
import {ITEM_EDITOR_METADATA_FIELDS,ITEM_EDITOR_GRAPH_PARTS,serializeItemEditorGraphPart,itemEditorTargetExpected,normalizeItemEditorRequest,type ItemEditorRequest,type ItemEditorGraphDocuments} from '../../shared/itemEditorCommand';
import {buildItemEditorPlan} from '../../../functions/src/shared/itemEditorDomain';
import { describe, expect, it, vi } from 'vitest';
import { isSmartStoreItem } from '../../shared/partnerPrice';

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const admin = source('src/features/admin/AdminApp.tsx');
function initializer(ast: ts.SourceFile, name: string) {
  let expression = '';const matches:ts.Expression[]=[];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {expression = node.initializer.getText(ast);matches.push(node.initializer);}
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(matches, `${ast.fileName} 실제 단일 ${name}`).toHaveLength(1);
  return expression;
}
function execute(ast: ts.SourceFile, name: string, dependencies: Record<string, unknown>): any {
  const javascript = ts.transpileModule(`const result = ${initializer(ast, name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript + ';return result;')(...Object.values(dependencies));
}
const useMemo = (calculate: () => unknown) => calculate();
function projection() {
  const products = [
    { id: 'legacy', name: '옛 채널 품목', type: 'product', partnerIds: ['SMARTSTORE', 'old-unlinked'], isSmartStore: false },
    { id: 'modern', name: '새 채널 품목', type: 'product', partnerIds: [], isSmartStore: true },
    { id: 'ordinary', name: '일반 품목', type: 'product', partnerIds: ['old-unlinked'], isSmartStore: false },
  ];
  const submaterials = [{ id: 'sub', name: '부자재', type: 'submaterial', partnerIds: [] }];
  for (const item of [...products, ...submaterials]) { Object.freeze(item.partnerIds); Object.freeze(item); }
  const original = JSON.stringify({ products, submaterials });
  const productClientMap = execute(admin, 'productClientMap', { useMemo, partnerOut: [{ itemId: 'modern', partnerId: 'current-out', Direction: 'out' }] });
  const allItems = execute(admin, 'allItems', { useMemo, products, submaterials, productClientMap, isSmartStoreItem });
  return { products, submaterials, original, allItems };
}

describe('실제 관리자 품목 투영의 스마트스토어 채널 보존', () => {
  it('옛 표식은 공용 OR 판독으로 보존하고 판매 연결은 현재 관계만 남기며 원본을 변경하지 않는다', () => {
    const f = projection();
    expect(f.allItems.map((item: any) => [item.id, item.isSmartStore, item.partnerIds])).toEqual([
      ['legacy', true, []], ['modern', true, ['current-out']], ['ordinary', false, []], ['sub', false, []],
    ]);
    expect(JSON.stringify({ products: f.products, submaterials: f.submaterials })).toBe(f.original);
    expect(f.allItems[0]).not.toBe(f.products[0]);
  });

  it.each(['AddOrderModal', 'PasteOrderModal', 'SmartStoreAnalytics'])('실제 %s 전달 속성은 부모 투영 결과를 사용한다', component => {
    const bindings: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(admin) === component) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(admin) === 'items' && attr.initializer && ts.isJsxExpression(attr.initializer)) bindings.push(attr.initializer.expression?.getText(admin) ?? '');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(admin);
    expect(bindings).toEqual(['allItems']);
  });

  it('부모 투영을 받은 직접 주문·복사 주문·분석의 실제 판독 경로에서 옛 채널 품목이 유지된다', () => {
    const { allItems } = projection();
    const selected = { id: 'smart-partner', type: '스마트스토어' };
    const orderable = execute(source('components/AddOrderModal.tsx'), 'orderableForPartner', { selectedPartner: selected, partnerOutIds: new Set(), isSmartStoreItem });
    expect(allItems.filter(orderable).map((item: any) => item.id)).toEqual(['legacy', 'modern']);
    const copied = execute(source('components/PasteOrderModal.tsx'), 'productPool', { useMemo, items: allItems, partnerOutIds: new Set(), selectedClient: selected, shipToId: null, isSmartStoreItem });
    expect(copied.map((item: any) => item.id)).toEqual(['legacy', 'modern']);
    const analytics = execute(source('components/SmartStoreAnalytics.tsx'), 'ssProducts', { useMemo, items: allItems, isSmartStoreItem });
    expect(new Set(analytics.map((item: any) => item.id))).toEqual(new Set(['legacy', 'modern']));
    const ordinary = execute(source('components/AddOrderModal.tsx'), 'orderableForPartner', { selectedPartner: { id: 'old-unlinked', type: '일반' }, partnerOutIds: new Set(), isSmartStoreItem });
    expect(allItems.filter(ordinary)).toEqual([]);
  });
});


function strictExpression(ast:ts.SourceFile,predicate:(node:ts.Node)=>boolean):ts.Node {
 const found:ts.Node[]=[];const visit=(node:ts.Node)=>{if(predicate(node))found.push(node);ts.forEachChild(node,visit);};visit(ast);expect(found,'실제 단일 callback').toHaveLength(1);return found[0];
}
function compileExpression(expression:ts.Expression,ast:ts.SourceFile,deps:Record<string,unknown>):any {
 const js=ts.transpileModule('const actual='+expression.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(deps),js+';return actual;')(...Object.values(deps));
}
async function save(p:any,existing=true){
 const scope={companyId:'taebaek' as const,actorUid:'actor'},targetId='item';
 const raw={companyId:'taebaek',name:'기존 품목',type:p.type??'product',stock:9,partnerIds:['SMARTSTORE','kept'],image:'old',imagePath:'old-path'};
 const graph:ItemEditorGraphDocuments={items:existing?[{id:targetId,data:raw}]:[],boms:[],formulas:[],links:[]};
 const evidence={schemaVersion:1,...Object.fromEntries(ITEM_EDITOR_GRAPH_PARTS.map(part=>[part,{count:graph[part].length,digest:createHash('sha256').update(serializeItemEditorGraphPart(part,graph[part])).digest('hex')}]))} as ItemEditorRequest['graph'];
 const opening={...scope,targetId,documents:graph,target:existing?raw:null,targetExpected:existing?itemEditorTargetExpected(raw):null,graph:evidence};
 const progress=createItemEditorProgress(targetId),stages:string[]=[],refresh=vi.fn();let input:any,plan:ReturnType<typeof buildItemEditorPlan>|undefined,error:unknown,result:any;
 const submit=vi.fn(async(actualScope:any,actualInput:any,actualProgress:any,current:()=>boolean)=>{stages.push('submit');expect(actualScope).toEqual(scope);expect(actualProgress).toBe(progress);expect(current()).toBe(true);input=actualInput;stages.push('normalize');const request=normalizeItemEditorRequest({version:1,companyId:scope.companyId,targetId,planId:'fixture-plan',targetExpected:opening.targetExpected,graph:evidence,draft:actualInput.draft});stages.push('plan');plan=buildItemEditorPlan(graph,request);return{progress,outcome:{status:'saved'}};});
 const prop=strictExpression(admin,node=>ts.isJsxAttribute(node)&&node.name.getText(admin)==='onSave'&&ts.isJsxAttributes(node.parent)&&ts.isJsxSelfClosingElement(node.parent.parent)&&node.parent.parent.tagName.getText(admin)==='ProductModal') as ts.JsxAttribute;
 const reference=(prop.initializer as ts.JsxExpression).expression!;expect(ts.isIdentifier(reference)).toBe(true);expect(reference.getText(admin)).toBe('saveItemEditorPrimary');
 const declaration=strictExpression(admin,node=>ts.isVariableDeclaration(node)&&node.name.getText(admin)==='saveItemEditorPrimary') as ts.VariableDeclaration;
 const actorToken={},actorScope={current:{token:actorToken}},modalToken={},modalScope={current:modalToken};
 const currentDeclaration=strictExpression(admin,node=>ts.isVariableDeclaration(node)&&node.name.getText(admin)==='isCurrentItemEditor') as ts.VariableDeclaration;
 const actualCurrent=compileExpression(currentDeclaration.initializer!,admin,{itemEditorActor:scope.actorUid,auth:{currentUser:{uid:scope.actorUid}},itemEditorScope:actorScope,itemEditorToken:actorToken});
 const savePrimary=compileExpression(declaration.initializer!,admin,{submitItemEditorSave:submit,itemEditorRequestScope:scope,isCurrentItemEditor:actualCurrent,refreshStaticData:refresh});
 const modal=source('components/AddItemModal.tsx'),call=strictExpression(modal,node=>ts.isCallExpression(node)&&node.expression.getText(modal)==='useItemPhotoSave') as ts.CallExpression;
 const options=call.arguments[0] as ts.ObjectLiteralExpression,onSave=options.properties.filter(node=>ts.isPropertyAssignment(node)&&node.name.getText(modal)==='onSave');expect(onSave).toHaveLength(1);
 const session={draft:{isNew:!existing,metadata:{},inPartnerIds:[],photoChanged:false},save:savePrimary};
 const photo=compileExpression((onSave[0] as ts.PropertyAssignment).initializer,modal,{sessionRef:{current:session},ITEM_EDITOR_METADATA_FIELDS,confirmItemEditorPurchaseNotices,opening,appNotice:vi.fn(()=>{throw Error('fixture에서 예상하지 않은 구매 안내');})});
 const product=Object.assign(Object.create(Object.getPrototypeOf(p)),{name:'입력 품목'},p);
 try{stages.push('photo');result=await photo(product,progress,()=>modalScope.current===modalToken);}catch(e){error=e;}
 return{input,plan,error,result,stages,submit,refresh,raw,ops:plan?.stages.primary??[],after:plan?.after.primary.items.find(row=>row.id===targetId)?.data};
}
describe('실제 관리자 품목 저장의 표식 정리 요청 경계',()=>{
 it.each([true,false])('기존 제품의 own boolean %s는 SMARTSTORE만 제거하고 재고·사진을 보존한다',async isSmartStore=>{
  const f=await save({id:'item',type:'product',isSmartStore,partnerIds:['derived-sale'],stock:99,image:'stale',imagePath:'stale-path'});
  expect(f.error).toBeUndefined();expect(f.stages).toEqual(['photo','submit','normalize','plan']);expect(f.input.opening.target).toBe(f.raw);
  expect(f.ops[0]).toMatchObject({kind:'update',collection:'items',id:'item',data:{name:'입력 품목',type:'product',isSmartStore,companyId:'taebaek'},removeSmartStoreMarker:true});
  expect(f.ops[0].data).not.toHaveProperty('stock');expect(f.input.draft.metadata).not.toHaveProperty('partnerIds');expect(f.after).toMatchObject({stock:9,partnerIds:['kept'],image:'old',imagePath:'old-path'});
 });
 it.each([{type:'raw',isSmartStore:false},{type:'product'},{type:'product',isSmartStore:null},{type:'product',isSmartStore:'false'}])('메타데이터 %j는 정본 normalizer와 계획 경계를 따른다',async p=>{
  const f=await save({id:'item',...p});
  if(p.isSmartStore===null||typeof p.isSmartStore==='string'){expect(f.error).toBeInstanceOf(Error);expect((f.error as Error).message).toContain('선택 값');expect(f.stages).toEqual(['photo','submit','normalize']);expect(f.ops).toEqual([]);expect(f.plan).toBeUndefined();}
  else{expect(f.error).toBeUndefined();expect(f.ops[0]).not.toHaveProperty('removeSmartStoreMarker');expect(f.after?.partnerIds).toEqual(['SMARTSTORE','kept']);expect(f.after?.stock).toBe(9);}
 });
 it('상속된 boolean은 실제 own metadata 투영에서 제외한다',async()=>{const p=Object.assign(Object.create({isSmartStore:false}),{id:'item',type:'product'}),f=await save(p);expect(f.error).toBeUndefined();expect(f.input.draft.metadata).not.toHaveProperty('isSmartStore');expect(f.ops[0]).not.toHaveProperty('removeSmartStoreMarker');expect(f.after?.partnerIds).toEqual(['SMARTSTORE','kept']);});
 it('새 품목은 stock0으로 만들고 변경 사진은 기존 재고와 분리한다',async()=>{
  const created=await save({id:'item',type:'product',isSmartStore:false,stock:99},false);expect(created.error).toBeUndefined();expect(created.ops[0]).toMatchObject({kind:'create',data:{stock:0}});expect(created.ops[0]).not.toHaveProperty('removeSmartStoreMarker');
  const photo=await save({id:'item',type:'product',isSmartStore:false,photoChanged:true,image:'new',imagePath:'new-path',stock:4});expect(photo.error).toBeUndefined();expect(photo.input.draft.photoChanged).toBe(true);expect(photo.ops[0].data).toMatchObject({image:'new',imagePath:'new-path'});expect(photo.ops[0].data).not.toHaveProperty('stock');expect(photo.after?.stock).toBe(9);
 });
});
