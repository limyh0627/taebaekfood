import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { writePreparedRawCommand } from '../../../src/shared/services/rawInventoryService';
import { normalizeRawMovement, toLedgerDoc } from './rawInventoryDocument';
import { protectInventoryWriterPatch, protectItemInventoryPatch } from '../../../src/shared/inventoryWriterProtocol';

// 실제 HEAD에서 writer 본문을 추출해 동일 거래 캡처에서 실행한다.
const source = execFileSync('git', ['show', '3e164b6:src/shared/services/rawInventoryService.ts'], {encoding:'utf8'});
const start = source.indexOf('export function writePreparedRawCommand(');
const end = source.indexOf('\n}', start) + 2;
const js = ts.transpileModule(source.slice(start,end).replace('export function', 'function'), {compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText;
const original = new Function('normalizeRawMovement','toLedgerDoc','protectInventoryWriterPatch','protectItemInventoryPatch','stripUndefined', js + '; return writePreparedRawCommand;')(normalizeRawMovement,toLedgerDoc,protectInventoryWriterPatch,protectItemInventoryPatch,(v:unknown)=>JSON.parse(JSON.stringify(v)));
const snap = (data: any) => ({exists: () => data !== null, data: () => data});
function fixture(kind: string, originalKind?: string, item = true) {
  const read: any = {stateRef:'state',movementRef:'movement',guardRef:'guard',itemRef:'item',stateSnap:snap({revision:3}),movementSnap:snap(null),guardSnap:snap(null),itemSnap:snap(item ? {inventoryRevision:5} : null),originalSnap:originalKind ? snap({kind:originalKind}) : null,oldOriginalSnap:null};
  const result: any = {status:'applied',state:{activeLots:[{id:'a', optional:undefined}],recentDepletedLots:[{id:'b'}],stockKg:3},movement:{kind, effectiveAt:'2026-10-28',materialSnapshot:'원료',reportedDeltaKg:-2, extra:undefined},guard:{operationId:'x', unused:undefined}};
  return {read,result,command:{kind,source:{type:'reversal',id:'order'}}};
}
function capture(writer: any, f: any, options: any = {}) {
  const writes: any[] = []; const tx = {set:(...args:any[])=>writes.push(['set',...args]),update:(...args:any[])=>writes.push(['update',...args])};
  writer(tx,f.command,f.read,f.result,options); return writes;
}
describe('이전 실제 writer payload 대조', () => {
  it.each([
    ['consume', undefined, true, {}], ['ledger-consume', undefined, true, {}],
    ['reverse','consume',true,{}], ['reverse','ledger-consume',true,{}],
    ['consume',undefined,true,{mirrorToItem:false}], ['consume',undefined,false,{}],
    ['consume',undefined,true,{legacy:{note:'이전', canCount:0}}],
  ])('%s 원문과 보호 순서', (kind, prior, item, options) => {
    const f=fixture(kind,prior,item); expect(capture(writePreparedRawCommand,f,options)).toEqual(capture(original,f,options));
  });
  it('guard 없는 쓰기와 legacy 원본을 사용한다',()=>{
    const f=fixture('reverse'); f.read.oldOriginalSnap=snap({kind:'ledger-consume'}); delete f.result.guard;
    expect(capture(writePreparedRawCommand,f)).toEqual(capture(original,f));
  });
  it('동일 홀더에서 두 번 쓴 결과와 각 이력이 같다',()=>{
    const first=fixture('consume'); const second=fixture('consume'); second.result.state.stockKg=1; second.result.movement.effectiveAt='2026-10-29';
    const old=[...capture(original,first),...capture(original,second)]; const current=[...capture(writePreparedRawCommand,first),...capture(writePreparedRawCommand,second)];
    expect(current).toEqual(old); expect(current.filter(x=>x[1]==='movement')).toHaveLength(2); expect(current.filter(x=>x[1]==='state').at(-1)).toEqual(old.filter(x=>x[1]==='state').at(-1));
  });
});
describe('현재 원주문 보호 경계',()=>{
  const valid=()=>{const f=fixture('reverse','consume');f.command={...f.command,companyId:'taebaek',source:{type:'production',id:'order'}};f.read.originalSnap=snap({kind:'consume',companyId:'taebaek',source:{type:'production',id:'order'}});f.read.sourceOrderId='order';f.read.sourceOrderSnap=snap({companyId:'taebaek'});return f;};
  it('검증된 원주문은 기존 payload 전체와 순서를 유지한다',()=>{const f=valid();expect(capture(writePreparedRawCommand,f)).toEqual(capture(original,f));});
  it.each(['mismatch','missing','marker-null','marker-object','company'])('%s 근거는 쓰기 전 거절한다',mode=>{const f=valid();if(mode==='mismatch')f.command.source.id='other';if(mode==='missing')f.read.sourceOrderSnap=snap(null);if(mode==='marker-null')f.read.sourceOrderSnap=snap({companyId:'taebaek',orderProductionRefsV1:null});if(mode==='marker-object')f.read.sourceOrderSnap=snap({companyId:'taebaek',orderProductionRefsV1:{}});if(mode==='company')f.read.sourceOrderSnap=snap({companyId:'punghoe'});const writes:any[]=[];expect(()=>writePreparedRawCommand({set:(...v:any[])=>writes.push(v),update:(...v:any[])=>writes.push(v)} as any,f.command as any,f.read,f.result)).toThrow();expect(writes).toEqual([]);});
});
import { buildPreparedRawWritePlan } from './rawPreparedWritePlan';
import { prepareRawCommand } from './rawInventoryPrepare';
import { emptyRawInventory } from './rawInventoryCore';

function eventCapture(writer: any, failure = '') {
  const events: string[] = [];
  const watch = (value: any, prefix: string): any => new Proxy(value, { get(target, key, receiver) {
    const name = `${prefix}.${String(key)}`; events.push(name);
    if (name === failure) throw new Error(name);
    const member = Reflect.get(target, key, receiver);
    return typeof member === 'function' ? (...args: any[]) => { events.push(name + '()'); return member(...args); } : member;
  }});
  const f = fixture('consume');
  for (const key of ['stateSnap','movementSnap','guardSnap','itemSnap']) f.read[key] = watch(f.read[key],key);
  f.read = watch(f.read,'read'); f.result = watch(f.result,'result');
  const options = watch({legacy:{note:'기록'},mirrorToItem:true},'options');
  const tx = {set:(ref: string) => { events.push('set:'+ref); if (failure === 'set:'+ref) throw new Error(failure); },update:(ref:string)=>events.push('update:'+ref)};
  let error: string | undefined;
  try { writer(tx,f.command,f.read,f.result,options); } catch (e) { error=(e as Error).message; }
  return {events,error};
}
describe('실 HEAD 평가 순서와 예외 경계',()=>{
  it.each(['','options.legacy','result.state','result.guard','options.mirrorToItem','set:state'])('순서 %s',failure=>{
    const actual=eventCapture(writePreparedRawCommand,failure), before=eventCapture(original,failure);
    expect(actual).toEqual(before);
    if (failure==='options.legacy') expect(actual.events.filter(x=>x.startsWith('set:'))).toEqual(['set:state']);
    if (failure==='result.guard') expect(actual.events.filter(x=>x.startsWith('set:'))).toEqual(['set:state','set:movement']);
    if (failure==='set:state') expect(actual.events).not.toContain('result.movement');
  });
  it('guard가 없으면 guard snapshot/ref를 평가하지 않는다',()=>{
    const f=fixture('consume'); delete f.result.guard;
    Object.defineProperty(f.read,'guardRef',{get(){throw new Error('guardRef');}});
    Object.defineProperty(f.read,'guardSnap',{get(){throw new Error('guardSnap');}});
    expect(capture(writePreparedRawCommand,f)).toEqual(capture(original,f));
  });
  it('생성은 payload를 읽지 않고 각 단계는 호출마다 평가한다',()=>{
    const f=fixture('consume'); let reads=0; const state=f.result.state;
    Object.defineProperty(f.result,'state',{get(){reads++;return state;}});
    const plan=buildPreparedRawWritePlan(f.command as any,f.read,f.result);
    expect(reads).toBe(0); plan.state(); plan.state(); expect(reads).toBe(2);
  });
});

function virtualFixture() {
  const now='2026-10-28T00:00:00.000Z';
  const lot={id:'lot',material:'깨분',supplierName:'공급',kgIn:10,kgRemaining:10,receivedDate:'2026-10-01',status:'active',createdAt:now};
  const state={...emptyRawInventory('taebaek','raw','깨분',now),stockKg:10,activeLots:[lot],inventoryWriterProtocolVersion:1,inventoryWriteRevision:7};
  const item={companyId:'taebaek',name:'깨분',rawMaterialName:'깨분',stock:10,lots:[lot],inventoryWriterProtocolVersion:1,inventoryWriteRevision:7};
  const read:any={stateRef:'state',movementRef:'movement',itemRef:'item',guardRef:'guard',stateSnap:snap(state),itemSnap:snap(item),movementSnap:snap(null),oldMovementSnap:null,originalSnap:null,oldOriginalSnap:null,guardSnap:null};
  const command=(id:string,kg:number,kind='consume'):any=>({operationId:id,companyId:'taebaek',rawItemId:'raw',materialSnapshot:'깨분',effectiveAt:now,source:{type:'manual',id},kind,kg});
  return {read,state,item,command};
}
describe('실 prepare 동일 홀더 가상 누적과 원 snapshot protocol',()=>{
  it('consume 2→3은 10→8→5이며 두 writer와 최종 계획 revision은8이다',()=>{
    const f=virtualFixture(), before=JSON.stringify([f.state,f.item]);
    const first=prepareRawCommand(f.command('one',2),f.read); expect(first.status).toBe('applied'); if(first.status!=='applied')throw Error('first');
    const virtual={state:first.state,itemData:{...f.item,stock:first.state.stockKg}};
    const second=prepareRawCommand(f.command('two',3),f.read,{},virtual); expect(second.status).toBe('applied'); if(second.status!=='applied')throw Error('second');
    expect([first.state.stockKg,second.state.stockKg]).toEqual([8,5]);
    expect([first.movement.reportedDeltaKg,second.movement.reportedDeltaKg]).toEqual([-2,-3]);
    const writes=[...capture(writePreparedRawCommand,{...f,result:first,command:f.command('one',2)}),...capture(writePreparedRawCommand,{...f,result:second,command:f.command('two',3)})];
    expect(writes).toEqual([...capture(original,{...f,result:first,command:f.command('one',2)}),...capture(original,{...f,result:second,command:f.command('two',3)})]);
    expect(writes.filter(x=>x[1]==='state'||x[1]==='item').map(x=>x[2].inventoryWriteRevision)).toEqual([8,8,8,8]);
    const plan=buildPreparedRawWritePlan(f.command('two',3),f.read,second);
    const state=plan.state(),movement=plan.movement(); const guard=plan.hasGuard()?plan.guard():undefined; const item=plan.itemPatch();
    expect(protectInventoryWriterPatch(f.state,state).inventoryWriteRevision).toBe(8);
    expect(protectItemInventoryPatch(f.item,item!).inventoryWriteRevision).toBe(8);
    expect(protectInventoryWriterPatch(undefined,movement)).toEqual(writes.at(-2)![2]); // movement 보호는 새 문서 protocol만 추가한다.
    expect(guard).toBeUndefined(); expect(state.stockKg).toBe(5); expect(item!.stock).toBe(5);
    const firstPlan=buildPreparedRawWritePlan(f.command('one',2),f.read,first);
    expect([firstPlan.movement(),movement].map(x=>x.operationId)).toEqual(['one','two']);
    expect(JSON.stringify([f.state,f.item])).toBe(before);
  });
  it('원장 전용은 가상 item stock과 mirror를 바꾸지 않고 다음 실제 계산을 따른다',()=>{
    const f=virtualFixture(); const first=prepareRawCommand(f.command('one',2),f.read); if(first.status!=='applied')throw Error('first');
    const virtual={state:first.state,itemData:{...f.item,stock:8}};
    const ledger=prepareRawCommand(f.command('ledger',1,'ledger-consume'),f.read,{},virtual); expect(ledger.status).toBe('applied'); if(ledger.status!=='applied')throw Error('ledger');
    const plan=buildPreparedRawWritePlan(f.command('ledger',1,'ledger-consume'),f.read,ledger); expect(plan.itemPatch()).toBeUndefined();
    const next={state:ledger.state,itemData:virtual.itemData}; expect(next.itemData.stock).toBe(8);
    const physical=prepareRawCommand(f.command('physical',3),f.read,{},next);
    expect(physical).toEqual(prepareRawCommand(f.command('physical',3),f.read,{}, {state:ledger.state,itemData:{...f.item,stock:8}}));
    expect(physical.status).toBe('applied');
  });
  it('두 번째 초과 요구를 쓰기 계획 물질화 전에 거절한다',()=>{
    const f=virtualFixture(); const first=prepareRawCommand(f.command('one',2),f.read); if(first.status!=='applied')throw Error('first');
    const second=prepareRawCommand(f.command('two',30),f.read,{}, {state:first.state,itemData:{...f.item,stock:8}});
    expect(second.status).toBe('rejected');
  });
});

