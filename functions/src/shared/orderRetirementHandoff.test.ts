import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';
import {retirementText,retirementHash,retirementIdentity,retirementInventoryManifest,validateRetirementManifest} from './orderRetirementHandoff';
const oldSource=execFileSync('git',['show','80ee6b7:functions/src/orderRequestRetirement.ts'],{encoding:'utf8'});
const oldJS=ts.transpileModule(oldSource,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const old:any={};const requireOld=(name:string):any=>name==='crypto'?{createHash}:name==='firebase-functions/v2/https'?{HttpsError:class extends Error {constructor(_code:string,message:string){super(message);}},onCall:()=>null}:{};new Function('exports','require',oldJS)(old,requireOld);
const capture=(fn:()=>unknown)=>{try{return {value:fn()};}catch(e){return {error:(e as Error).message};}};
describe('퇴역 공통 이동 원본문 대조',()=>{
 it('canonical 한글·배열·undefined·키 순서와 해시·세대 ID를 HEAD와 비교한다',()=>{
  for(const value of [{z:'한글',a:[{z:2,a:1},null,true],omit:undefined},{b:1,a:2},{a:2,b:1},[1,'한글',null]]){expect(retirementText(value)).toBe(old.retirementText(value));expect(retirementHash(retirementText(value))).toBe(old.retirementHash(old.retirementText(value)));}
  expect(retirementHash(retirementText({a:2,b:1}))).toBe('d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772');
  const g={companyId:'taebaek',orderId:'주문',operationId:'old',startedAt:'2026-10-12T00:00:00Z',actorUid:'직원'};expect(retirementIdentity(g)).toBe(old.retirementIdentity(g));
 });
 it('대상 명세와 오류 순서는 HEAD 본문을 그대로 따른다',()=>{
  const request={generation:{companyId:'taebaek',orderId:'o'},commands:[{command:{companyId:'taebaek',rawItemId:'raw',kind:'consume',kg:1,source:{id:'o'}}}],plan:{productionDeltas:[{itemId:'b'}],reservationDeltas:[['a',2]],lines:[{rowDeltas:[{itemId:'c'}]}],finalPlan:{reservation:{allocationQuantities:[['d',1]]}}}};
  for(const value of [request,{...request,commands:null},{...request,plan:{productionDeltas:[{itemId:'bad/id'}]}},{...request,commands:[{command:{...request.commands[0].command,companyId:'punghoe'}}]}])expect(capture(()=>retirementInventoryManifest(value))).toEqual(capture(()=>old.retirementInventoryManifest(value)));
 });
 it('기존 계보 검사는 행 순서와 품목 후 삭제표 읽기를 유지한다',async()=>{
  const reads:string[]=[],db={collection:(c:string)=>({doc:(id:string)=>({path:c+'/'+id})})},rows=new Map([['items/a',{companyId:'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:2}],['rawInventories/taebaek__r',{companyId:'taebaek',rawItemId:'r',inventoryWriterProtocolVersion:1,inventoryWriteRevision:2}]]);
  const tx={get:async(ref:{path:string})=>{reads.push(ref.path);return {exists:rows.has(ref.path),data:()=>rows.get(ref.path)};}};
  await validateRetirementManifest(tx as never,db as never,'taebaek',[{collection:'items',id:'a',existed:true,revision:1,deletionRevision:0,deletionFloor:0},{collection:'rawInventories',id:'taebaek__r',rawItemId:'r',existed:true,revision:1}]);
  expect(reads).toEqual(['items/a','inventoryWriterDeletions/taebaek__a','rawInventories/taebaek__r']);
 });
});
