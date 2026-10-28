import { describe, expect, it, vi } from 'vitest';
import { buildOrderRawCommands, lotMixSettingOf, selectOrderRawUsageNames } from './orderRawCommandPlan';

describe('주문 원료 순수 명령', () => {
 const holder = {id:'raw1',name:'참깨',subtype:'벌크',mixEnabled:true,mixTopPercent:0};
 const usage = {'참깨':1.23456, '무시':0};
 const ledger = {'참깨':2};
 const args = {orderId:'order',physicalUsage:usage,ledgerOnlyUsage:ledger,attempt:2,lineId:'line',allItems:[holder],companyId:'taebaek' as const,businessDate:'2026-10-28',customerName:'고객',actorName:'담당',names:selectOrderRawUsageNames(usage,ledger)};
 it('원 명령 순서, 값, 홀더 참조와 혼합 0을 보존한다', () => {
  const before=JSON.stringify(args); const result=buildOrderRawCommands(args);
  expect(result.commands).toEqual([
   {command:{operationId:'production:order:line:a2:raw1',companyId:'taebaek',rawItemId:'raw1',materialSnapshot:'참깨',effectiveAt:'2026-10-28T12:00:00+09:00',actorName:'담당',source:{type:'production',id:'order'},kind:'consume',kg:1.235,mix:{topPercent:0}},options:{newLotId:'lot-production:order:line:a2:raw1',carryOverLotId:'carry-production:order:line:a2:raw1',legacy:{note:'자동: 고객',type:'auto',orderId:'order',addedBy:'담당'}}},
   {command:{operationId:'production-ledger:order:line:a2:raw1',companyId:'taebaek',rawItemId:'raw1',materialSnapshot:'참깨',effectiveAt:'2026-10-28T12:00:00+09:00',actorName:'담당',source:{type:'oem',id:'order'},kind:'ledger-consume',kg:2},options:{legacy:{note:'자동(임가공): 고객',type:'auto',orderId:'order',addedBy:'담당'}}},
  ]); expect([...result.holderByMaterial]).toEqual([['참깨',holder]]); expect(result.holderByMaterial.get('참깨')).toBe(holder); expect(JSON.stringify(args)).toBe(before);
 });
 it('혼합 필드 부재와 명시된 빈 비율을 구분한다',()=>{expect(lotMixSettingOf({mixEnabled:true})).toEqual({topPercent:50}); expect(lotMixSettingOf({mixEnabled:true,mixLotRatios:[]})).toBeUndefined(); expect(lotMixSettingOf({mixEnabled:false})).toBeUndefined();});
 it('없는 홀더를 원 오류로 거절한다',()=>{expect(()=>buildOrderRawCommands({...args,allItems:[]})).toThrow("원료 차감 중단: taebaek 회사의 '참깨' 원료 품목을 찾을 수 없다 (주문 order)");});
});
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { buildOrderRawCommands as appBuild } from '../../../src/features/admin/orderRawInventory';
import { dateOfLocal, today } from '../../../src/shared/day';
import { companyOf } from '../../../src/shared/types';
import { rawHolderByName, rawLedgerKeys } from './rawHolder';
import { stock3 } from './orderProductionDomain';
import type { JobCommandInput } from '../../../src/shared/services/rawInventoryJob';

// 실제 HEAD 본문을 추출해 현재 구현과 같은 입력으로 실행한다.
const head = (path:string) => execFileSync('git',['show',`818edf1:${path}`],{encoding:'utf8'});
const rawHead=head('src/features/admin/orderRawInventory.ts');
const lotHead=head('src/shared/lotUtils.ts');
const rawFn=rawHead.slice(rawHead.indexOf('export function buildOrderRawCommands'),rawHead.indexOf('\nexport function createOrderRawInventoryOperations'));
const lotFn=lotHead.slice(lotHead.indexOf('export function lotMixSettingOf'),lotHead.indexOf("import { today as todayStr }"));
function instantiate(source:string, names:string[], values:unknown[], exported:string) {
 const js=ts.transpileModule(source.replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 return Function(...names,`${js}\nreturn ${exported};`)(...values);
}
const oldMix=instantiate(lotFn,[],[],'lotMixSettingOf');
const oldBuild=instantiate(rawFn,['kg3','dateOfLocal','today','companyOf','rawHolderByName','rawLedgerKeys','lotMixSettingOf'],[stock3,dateOfLocal,today,companyOf,rawHolderByName,rawLedgerKeys,oldMix],'buildOrderRawCommands');

describe('HEAD 실제 본문 oracle',()=>{
 function fixture(events:string[], empty=false, missing=false) {
  const order={get id(){events.push('order.id');return 'order';},get deliveredAt(){events.push('date');return '2026-10-28';},get partnerId(){events.push('partnerId');return 'p';},get partnerName(){events.push('partnerName');return 'fallback';},get companyId(){events.push('company');return 'taebaek';}};
  const usage=new Proxy(empty?{}:{'참깨':1.23456},{get(t,p,r){events.push(`physical.${String(p)}`);return Reflect.get(t,p,r);},ownKeys(t){events.push('physical.keys');return Reflect.ownKeys(t);}});
  const ledger=new Proxy(empty?{}:{'참깨':2},{get(t,p,r){events.push(`ledger.${String(p)}`);return Reflect.get(t,p,r);},ownKeys(t){events.push('ledger.keys');return Reflect.ownKeys(t);}});
  const holder={id:'raw',name:'참깨',subtype:'벌크',get mixEnabled(){events.push('mixEnabled');return true;},get mixTopPercent(){events.push('mixTopPercent');return 0;}};
  const partners=[{get id(){events.push('partner.id');return 'p';},get name(){events.push('partner.name');return '고객';}}];
  return {order,physicalUsage:usage,ledgerOnlyUsage:ledger,attempt:2,lineId:'line',allItems:missing?[]:[holder],partners,actorName:'담당'};
 }
 for(const [label,empty,missing] of [['명령과 혼합',false,false],['빈 명령',true,false],['홀더 없음',false,true]] as const) it(label,()=>{
  const first:string[]=[],second:string[]=[];const a=fixture(first,empty,missing),b=fixture(second,empty,missing);
  const capture=(fn:(v:any)=>any,arg:any)=>{try {const result=fn(arg);return {commands:result.commands,entries:[...result.holderByMaterial],companyId:result.companyId,customerName:result.customerName};} catch(e){return {error:(e as Error).message};}};
  const actual=capture(appBuild as any,b), expected=capture(oldBuild,a); expect(second).toEqual(first); expect(actual).toEqual(expected);
 });
 it('날짜 기본값과 거래처 fallback도 HEAD와 같다',()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T03:00:00Z'));
  try {
   const a=fixture([]), b=fixture([]);
   for(const row of [a,b]) {Object.defineProperty(row.order,'deliveredAt',{get:()=>''}); row.partners.length=0;}
   const old=oldBuild(a), current=appBuild(b as never);
   expect(current.commands).toEqual(old.commands); expect(current.commands[0].command.effectiveAt).toBe(today()+'T12:00:00+09:00');
   expect(current.customerName).toBe('fallback');
  } finally {vi.useRealTimers();}
 });
 it('앱 명령 입력 구조에 할당된다',()=>{
  const row=fixture([]); const result=appBuild(row as never); const commands:JobCommandInput[]=result.commands; expect(commands).toHaveLength(2);
 });
});

import {rawLedgerDocIds,orderRawTracesFromMovement} from './orderRawCommandPlan';
import {operationDocId} from './rawInventoryCore';
const oldLedger=instantiate(rawHead.slice(rawHead.indexOf('export function rawLedgerDocIds'),rawHead.indexOf('/** 순차·새 일괄')),['operationDocId'],[operationDocId],'rawLedgerDocIds');
const oldTraces=instantiate(rawHead.slice(rawHead.indexOf('export function orderRawTracesFromMovement'),rawHead.indexOf('/** 여러 줄의 첫 계획')),['kg3'],[stock3],'orderRawTracesFromMovement');
it('trace/ledger ID 단일이동은 HEAD 물리·원장전용·빈·falsy 순서와 입력을 보존한다',()=>{
 for(const kind of ['consume','ledger-consume']){const c={kind,materialSnapshot:'원료',rawItemId:'raw',operationId:'op'},m={id:'실제옛ID',reportedDeltaKg:-1.23456,lotChanges:[{deltaKg:-1.23456,supplierName:'공급',lotId:'lot',lotNo:'no',receivedDate:'2026-10-28'},{deltaKg:0},{deltaKg:1},{deltaKg:-2,lotId:'',lotNo:'',receivedDate:''}]},before=JSON.stringify([c,m]);expect(orderRawTracesFromMovement(c as any,m as any)).toEqual(oldTraces(c,m));expect(JSON.stringify([c,m])).toBe(before);}
 for(const traces of [[],[{material:'x',supplierName:'',kg:0}],[{ledgerId:'first',operationId:'op'},{ledgerId:'',operationId:'op'},{ledgerId:'first'},{operationId:''}]])expect(rawLedgerDocIds(traces as any)).toEqual(oldLedger(traces));
 expect(()=>orderRawTracesFromMovement({kind:'consume'} as any,{lotChanges:null} as any)).toThrow();expect(()=>oldTraces({kind:'consume'},{lotChanges:null})).toThrow();
});
