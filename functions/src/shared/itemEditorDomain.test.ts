import {describe,it,expect} from 'vitest';
import {buildItemEditorPlan,buildPurchaseNotices,itemEditorPurchaseNoticeText,assertItemEditorTombstone} from './itemEditorDomain';
import {itemEditorTargetExpected,type ItemEditorGraphDocuments,type ItemEditorRequest} from './itemEditorCommand';
const item=(id:string,data:Record<string,unknown>)=>({id,data:{companyId:'taebaek',...data}});
function fixture():ItemEditorGraphDocuments{return {items:[item('unit',{name:'반제품',type:'wip',cost:80,costSource:'rollup',stock:9,image:'old'}),item('parent',{name:'상위품목',type:'product',cost:80}),item('raw',{name:'원료',type:'raw',cost:50})],boms:[item('old-bom',{parent_id:'parent',child_id:'unit',quantity:2})],formulas:[],links:[]};}
function request(graph:ItemEditorGraphDocuments,manual:boolean):ItemEditorRequest{return {version:1,companyId:'taebaek',targetId:'unit',planId:'plan',targetExpected:itemEditorTargetExpected(graph.items[0].data),graph:{schemaVersion:1,...Object.fromEntries(['items','boms','formulas','links'].map(part=>[part,{count:0,digest:'a'.repeat(64)}]))} as ItemEditorRequest['graph'],draft:{isNew:false,photoChanged:false,metadata:{name:'반제품',type:'wip',cost:manual?0:999999,costSource:manual?'manual':'rollup'},bomDraft:[{childId:'raw',qty:3}],formulaRows:[],inPartnerIds:[]}};}
describe('실제 품목 편집 전체 단계 계획',()=>{
 it('수동 0원은 새 BOM 이후 구성품 원가·배합 원가 양 단계에서 옛 자동 원가로 덮이지 않는다',()=>{
  const graph=fixture(),plan=buildItemEditorPlan(graph,request(graph,true));
  expect(plan.committedItems.find(row=>row.id==='unit')?.cost).toBe(0);
  for(const stage of ['bom-cost','formula-cost'] as const){expect(plan.stages[stage].some(op=>op.id==='unit')).toBe(false);expect(plan.after[stage].items.find(row=>row.id==='unit')?.data.cost).toBe(0);}
  expect(plan.after['purchase-links'].items.find(row=>row.id==='unit')?.data).toMatchObject({stock:9,image:'old'});
 });
 it('자동 원가 제출값은 신뢰하지 않고 새 BOM의 150원과 상위 300원을 두 원가 단계에서 산출한다',()=>{
  const graph=fixture(),plan=buildItemEditorPlan(graph,request(graph,false));
  expect(plan.committedItems.find(row=>row.id==='unit')?.cost).toBe(150);
  for(const stage of ['bom-cost','formula-cost'] as const){expect(plan.after[stage].items.find(row=>row.id==='unit')?.data.cost).toBe(150);expect(plan.stages[stage]).toContainEqual(expect.objectContaining({id:'parent',data:{cost:300}}));expect(plan.after[stage].items.find(row=>row.id==='parent')?.data.cost).toBe(300);}
 });
 it('기존 자동 품목도 BOM·배합을 안 고쳐도 입력한 조작 원가 대신 정본 값을 저장한다',()=>{
  const graph=fixture();graph.boms.push(item('unit-bom',{parent_id:'unit',child_id:'raw',quantity:3}));const req=request(graph,false);delete req.draft.bomDraft;delete req.draft.formulaRows;
  expect(buildItemEditorPlan(graph,req).after.primary.items.find(row=>row.id==='unit')?.data.cost).toBe(150);
 });
 it('신규 박스와 변경한 구성품을 안내·서버 계획이 똑같이 반영하며 단가 0과 세금 null을 보존한다',()=>{
  const graph:ItemEditorGraphDocuments={items:[item('loose',{type:'product',name:'낱개',cost:10})],boms:[],formulas:[],links:[]};
  const draft={isNew:true,photoChanged:false,metadata:{name:'새 박스',type:'product',costSource:'rollup'},bomDraft:[{childId:'loose',qty:12}],inPartnerIds:['partner']};
  expect(buildPurchaseNotices(graph,draft,'box')).toEqual([{boxItemId:'box',looseItemId:'loose',partnerId:'partner',direction:'in',count:12,boxName:'새 박스',looseName:'낱개'}]);
  expect(itemEditorPurchaseNoticeText('taebaek','box',graph,draft)).toContain('새 박스');
  graph.items.push(item('box',{name:'옛 박스',type:'product'}));graph.boms.push(item('old',{parent_id:'box',child_id:'loose',quantity:2}));graph.links.push(item('link',{itemId:'box',partnerId:'partner',Direction:'in',price:0,taxType:null,packing:{label:'보존'}}));
  expect(buildPurchaseNotices(graph,{...draft,isNew:false},'box')[0]).toMatchObject({count:12,taxType:null});expect(buildPurchaseNotices(graph,draft,'box')[0]).not.toHaveProperty('loosePrice');
 });
 it('사진 미변경·SMARTSTORE 정리·다른 거래처·포장 필드는 보존한다',()=>{
  const graph=fixture();graph.items[0].data={...graph.items[0].data,type:'product',partnerIds:['SMARTSTORE','kept']};graph.links.push(item('own-link',{itemId:'unit',partnerId:'partner',Direction:'in',price:0,taxType:null,packing:{size:'L'}}));
  const req=request(graph,true);req.draft.metadata={...req.draft.metadata,type:'product',image:'stale',isSmartStore:false};req.draft.inPartnerIds=['partner'];delete req.draft.formulaRows;
  const plan=buildItemEditorPlan(graph,req),target=plan.after['purchase-links'].items.find(row=>row.id==='unit')!.data;
  expect(target).toMatchObject({partnerIds:['kept'],image:'old',stock:9});expect(plan.after['purchase-links'].links[0].data).toMatchObject({price:0,packing:{size:'L'}});expect(plan.after['purchase-links'].links[0].data).not.toHaveProperty('taxType');
 });
 it('다른 행의 옛 body id는 유지하고 실제 쓰기 대상으로 선택한 충돌만 거절한다',()=>{
  const graph=fixture();graph.items.push(item('unrelated',{id:'different',type:'goods',name:'옛 자료',cost:0}));expect(()=>buildItemEditorPlan(graph,request(graph,true))).not.toThrow();
  graph.items[2].data.id='wrong';expect(()=>buildItemEditorPlan(graph,request(graph,true))).toThrow();
 });
 it('어느 후속 단계라도 499개를 넘으면 첫 계획 생성부터 거절한다',()=>{
  const graph=fixture();graph.items.push(item('material',{type:'submaterial',name:'부자재',cost:50}));for(let index=0;index<500;index++)graph.items.push(item('p'+index,{type:'product',name:'원가갱신'+index,cost:1}));for(let index=0;index<500;index++)graph.boms.push(item('b'+index,{parent_id:'p'+index,child_id:'material',quantity:2}));
  expect(()=>buildItemEditorPlan(graph,request(graph,true))).toThrow('499');
 });
 it('통합 tomb와 손상된 삭제 revision을 기존 gateway와 같은 정본으로 막는다',()=>{
  expect(()=>assertItemEditorTombstone({mergedIntoItemId:'kept'},'taebaek','unit')).toThrow('통합');expect(()=>assertItemEditorTombstone({companyId:'taebaek'},'taebaek','unit')).toThrow('버전');expect(()=>assertItemEditorTombstone(undefined,'taebaek','unit')).not.toThrow();
 });
});
