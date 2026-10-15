import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {selfCheck,parse,readTargets,safe,failureCode,classify,paths,run,verifySources,SOURCE_MANIFEST,type Target} from './diag-lots-total-equivalence-readonly-20261015.mts';
const base='projects/taebaek-3abe4/databases/(default)/documents';
const at='2026-10-15T00:00:00.123456789Z';
const item=(id='synthetic',fields:any={companyId:{stringValue:'taebaek'},lotsAreTotal:{booleanValue:true}})=>({name:base+'/items/'+id,fields,updateTime:at});
const response=(documents:any[]=[])=>[...documents.map(document=>({document,readTime:at})),{readTime:at,done:true}];
const target=():Target=>({item:{id:'synthetic',data:{companyId:'taebaek',stock:2,lotsAreTotal:true,lots:[{status:'active',qtyRemaining:2,kgRemaining:10,unitKg:5}]},original:item()},state:{id:'taebaek__synthetic',data:{companyId:'taebaek',rawItemId:'synthetic',stockKg:2,activeLots:[],recentDepletedLots:[],revision:1},original:{name:base+'/rawInventories/taebaek__synthetic',updateTime:at}},itemReadTimes:[at],stateReadTimes:[at]});
describe('lotsAreTotal 읽기 진단',()=>{
 it('포장수량과 kg를 섞지 않고 단위 미확정이면 수치 비교도 하지 않는다',()=>{const row=target(),result=classify([row]);expect(result.deletionReady).toBe(false);expect(result.companies.taebaek).toMatchObject({targets:1,helperInputEquivalent:1,helperResultEquivalent:1,unitAmbiguous:1,notEvaluated:1});expect(row.item.data.lotsAreTotal).toBe(true);expect(JSON.stringify(result)).not.toContain('synthetic');});
 it.each(['missingState','invalidItem','invalidState','companyMismatch','itemLinkMismatch'])('원문 문제 %s는 자동 보정하지 않고 별도 집계한다',category=>{const row=target();if(category==='missingState')row.state=null;if(category==='invalidItem')row.item.data.lots=null;if(category==='invalidState')row.state!.data.stockKg='2';if(category==='companyMismatch')row.state!.data.companyId='punghoe';if(category==='itemLinkMismatch')row.state!.data.rawItemId='different';expect(classify([row]).companies.taebaek[category]).toBe(1);expect(classify([row]).deletionReady).toBe(false);});
 it('빈 대상·다수 대상·false 표식도 과거 1건에 고정하지 않는다',()=>{expect(classify([]).companies.taebaek.targets).toBe(0);const first=target(),second=target();second.item.data.lotsAreTotal=false;expect(classify([first,second]).companies.taebaek).toMatchObject({targets:2,flagTrue:1,flagFalse:1});});
 it('잘못된 실행 옵션은 인증 전에 거절하고 임의 오류 내용을 출력하지 않는다',async()=>{const token=vi.fn(),read=vi.fn();await expect(run(['--apply'],{token,read,paths})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(failureCode({message:'비밀표식',stage:'비밀표식'})).toEqual({stage:'source',code:'validation-failed'});});
 it('기존 출력이 있으면 인증과 조회 전에 거절한다',async()=>{const token=vi.fn(),read=vi.fn();await expect(run(['--auth=firebase-cli'],{token,read,paths:args=>paths(args,()=>true)})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();});
 it('실제 공용 함수의 Node 모듈을 자체 검증하며 운영 접근을 하지 않는다',()=>{expect(selfCheck()).toMatchObject({selfCheck:'passed',productionRead:false,productionOutputWritten:false,sourceManifest:SOURCE_MANIFEST,nodeVersion:process.version});expect(Object.keys(verifySources())).toHaveLength(10);});
 it.each(Object.keys(SOURCE_MANIFEST))('소비 원문 %s 변경은 인증·조회 전에 거절한다',async path=>{
  const token=vi.fn(),read=vi.fn();const source=()=>{verifySources(file=>{const bytes=readFileSync(file);return file===resolve(path)?Buffer.concat([bytes,Buffer.from(' ')]):bytes;});return selfCheck();};
  await expect(run(['--auth=firebase-cli'],{token,read,paths:()=>({output:'unused-output',originals:'unused-originals'}),source})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it('typed REST 원문과 나노초 버전을 그대로 보존한다',()=>{const doc=item();const result=parse(response([doc]),'items');expect(result.documents[0].original).toEqual(doc);expect(result.documents[0].data.lotsAreTotal).toBe(true);expect(result.readTimes).toEqual([at]);});
 it.each([[],[{error:{message:'비밀표식'}}],[{readTime:at,skippedResults:1}],response([{...item(),name:base+'/rawInventories/wrong'}]),response([{...item(),fields:{x:{stringValue:'x',integerValue:'2'}}}])].map(body=>({body})))('불완전하거나 잘못된 REST 응답은 성공으로 바꾸지 않는다',({body})=>{expect(()=>parse(body,'items')).toThrow();});
 it('위험한 prototype 키와 비유한 숫자를 거절한다',()=>{expect(()=>safe(JSON.parse('{"__proto__":1}'))).toThrow();expect(()=>safe(Infinity)).toThrow();});
 it('flag 존재 대상을 현재 projection으로 찾고 대상 전체·대응 상태만 읽는다',async()=>{
  const requests:any[]=[];const transport=vi.fn(async(url:any,init:any)=>{requests.push({url,query:JSON.parse(init.body).structuredQuery});const count=requests.length;return {ok:true,json:async()=>count===1?response([item(),item('unflagged',{})]):count===2?response([item()]):response()};});const result=await readTargets('합성',transport as any);expect(result.targets).toHaveLength(1);expect(result.targets[0].state).toBeNull();expect(requests).toHaveLength(3);expect(requests[0].query.select.fields).toEqual([{fieldPath:'companyId'},{fieldPath:'lotsAreTotal'}]);expect(requests[1].query.select).toBeUndefined();expect(requests[2].query.where.fieldFilter.value.referenceValue).toBe(base+'/rawInventories/taebaek__synthetic');expect(requests.every(row=>row.url==='https://firestore.googleapis.com/v1/'+base+':runQuery')).toBe(true);
 });
 it('projection 뒤 원문이 바뀌거나 조회가 실패하면 부분 성공을 반환하지 않는다',async()=>{
  let count=0;const changed=async()=>({ok:true,json:async()=>++count===1?response([item()]):response([{...item(),updateTime:'2026-10-15T00:00:01Z'}])});await expect(readTargets('합성',changed as any)).rejects.toThrow();const failed=vi.fn(async()=>{throw Error('비밀표식');});let error;try{await readTargets('합성',failed as any);}catch(e){error=e;}expect(failureCode(error)).toEqual({stage:'projection',code:'validation-failed'});expect(failed).toHaveBeenCalledOnce();expect(JSON.stringify(failureCode(error))).not.toContain('비밀표식');
 });
});
