import {describe,it,expect} from 'vitest';
import {planStatementDeletion,statementSourceIds,statementOriginalHash,readStatementDeletion,deleteIssuedStatement,readDeletionAdvances} from './deleteIssuedStatementCommand';
const source={companyId:'taebaek',partnerId:'p',orderId:'a,b',purchaseOrderIds:['po'],confirmedProductIds:['po2'],sourcePoId:'po3',docNo:'261008-1',totalAmount:100};
describe('발행 전표 삭제의 기존 연결 계약',()=>{
 it('공통 전표 읽기가 끝나기 전에는 개별 감사 읽기를 요청하지 않는다',async()=>{
  const reads:string[]=[];let completed=false,resolveStatement!:(value:any)=>void,started!:()=>void;
  const statementStarted=new Promise<void>(resolve=>{started=resolve;}),statementRead=new Promise<any>(resolve=>{resolveStatement=resolve;});
  const empty={exists:false,data:()=>undefined},db:any={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id,get:async()=>empty})}),runTransaction:async(fn:any)=>fn({get:async(ref:any)=>{
   reads.push(ref.path);if(ref.path==='appMeta/releaseCutover')return {exists:true,data:()=>({status:'paused',releaseId:'release'})};
   if(ref.path==='issuedStatements/statement'){started();const snapshot=await statementRead;completed=true;return snapshot;}
   if(ref.path==='voucherMutationOperations/operation')expect(completed).toBe(true);return empty;
  },create:()=>{}})};
  const running=deleteIssuedStatement(db,'taebaek','actor',{operationId:'operation',statementId:'statement',releaseId:'release',expectedRevision:0,expectedOriginalHash:'a'.repeat(64)});
  const settled=running.catch(error=>error);await statementStarted;
  try{expect(reads).toEqual(['appMeta/releaseCutover','issuedStatements/statement']);}
  finally{resolveStatement(empty);await settled;}
  await expect(running).rejects.toThrow('활성화');expect(reads.at(-1)).toBe('voucherMutationOperations/operation');
 });
 it('같은 ID 연결·정산만 선택하고 모든 원문의 상태·수량·번호를 보존한다',()=>{const links=[{kind:'orders' as const,id:'a',data:{companyId:'taebaek',linkedStatementId:'s',linkedStatementAt:'old',status:'delivered',stock:9}},{kind:'purchaseOrders' as const,id:'po',data:{companyId:'taebaek',linkedStatementId:'other',status:'invoiced'}},{kind:'settlements' as const,id:'m',data:{companyId:'taebaek',statementId:'s',cashEntryId:'c',amount:100}}];const before=structuredClone({source,links});const plan=planStatementDeletion('taebaek','s',source,links,{companyId:'taebaek',partnerId:'p',revision:4,extra:'keep'});expect(plan.clear.map(row=>row.id)).toEqual(['a']);expect(plan.remove.map(row=>row.id)).toEqual(['m']);expect(plan.revisionAfter).toBe(5);expect({source,links}).toEqual(before);});
 it('옛 원본 연결 ID와 회사없는 태백을 보존하고 외국 회사·손상 revision을 거절한다',()=>{expect(statementSourceIds(source,'orders')).toEqual(['a','b']);expect(statementSourceIds(source,'purchaseOrders')).toEqual(['po','po2','po3']);expect(planStatementDeletion('taebaek','s',{docNo:'old'},[{kind:'orders',id:'a',data:{linkedStatementId:'s'}}],null).clear).toHaveLength(1);expect(()=>planStatementDeletion('taebaek','s',source,[{kind:'orders',id:'x',data:{companyId:'punghoe'}}],null)).toThrow('다른 회사');expect(()=>planStatementDeletion('taebaek','s',source,[],{companyId:'taebaek',partnerId:'p',revision:-1})).toThrow('손상');});
 it('삭제 감사의 원 발행 hash가 일치할 때만 번호 원문을 반환한다',async()=>{const before={...source,issueOperationId:'s',issuePayloadHash:'hash'};const receipt={companyId:'taebaek',kind:'issuedStatements',action:'delete',status:'applied',voucherId:'s',createdBy:'admin',beforeSnapshot:before,beforeHash:statementOriginalHash(before),afterHash:null};const db:any={collection:()=>({where:()=> 'history'})},tx:any={get:async()=>({size:1,docs:[{data:()=>receipt}]})};expect(await readStatementDeletion(db,tx,'taebaek','s',{exists:false} as any,row=>row.issuePayloadHash==='hash')).toEqual(before);await expect(readStatementDeletion(db,tx,'taebaek','s',{exists:false} as any,()=>false)).rejects.toThrow('감사');receipt.beforeHash='broken';await expect(readStatementDeletion(db,tx,'taebaek','s',{exists:false} as any,()=>true)).rejects.toThrow('감사');});
});

describe('삭제의 거래처 적용 조회 경계',()=>{
 const application=(target='target')=>({id:'application',partnerId:'p',type:'비용',tradeDate:'2026-10-08',totalAmount:5,
  items:[{accountCode:'251',side:'차변',total:5,tax:0},{accountCode:'133',side:'대변',total:5,tax:0}],
  noncashApplication:{kind:'advance-application',version:1,operationId:'apply',companyId:'taebaek',partnerId:'p',purpose:'적용',requestFingerprint:'fp',
   sourceFingerprints:{'["cashEntries","cash","133"]':'source'},targetFingerprints:{[target]:'target'},
   allocations:[{source:{collection:'cashEntries',id:'cash',lineKey:'133'},statementId:target,accountCode:'251',amount:5}]}});
 function fixture(rows:any[]){const reads:string[]=[],filters:any[]=[];
  const db:any={collection:(name:string)=>({path:name,doc:(id:string)=>({path:name+'/'+id,get:async()=>empty}),where:(...args:any[])=>{filters.push(args);return {path:name,scoped:true};}})};
  const tx:any={get:async(ref:any)=>{reads.push(ref.path);return ref.scoped?{docs:rows.map(row=>({id:row.id,data:()=>row}))}:{exists:false,docs:[],data:()=>undefined};}};
  return {db,tx,reads,filters};
 }
 it.each([{rows:[]},{rows:[application('other')]}])('취소 대상이 없으면 전체 원장과 다른 거래처 문서를 읽지 않는다',async ({rows})=>{
  const f=fixture(rows),result=await readDeletionAdvances(f.db,f.tx,'taebaek','p','target');
  expect(result).toEqual({snapshot:null,affected:[]});expect(f.reads).toEqual(['issuedStatements']);expect(f.filters).toEqual([['partnerId','==','p']]);
 });
 it('회사없는 태백 적용도 기존 전체 원장 취소 경로로 전달한다',async()=>{
  const f=fixture([application()]),result=await readDeletionAdvances(f.db,f.tx,'taebaek','p','target');
  expect(result.affected.map(row=>row.id)).toEqual(['application']);expect(result.snapshot).not.toBeNull();
  for(const name of ['cashEntries','issuedStatements','settlements','returnApplications','returnOperations','partnerPaymentOperations','partnerAdvanceOperations'])expect(f.reads).toContain(name);
  expect(f.reads[0]).toBe('issuedStatements');
 });
 it.each(['손상','고아취소','중복취소'])('대상 없는 %s 적용 사슬도 생략하지 않는다',async mode=>{
  const original=application('other');const cancel={...original,id:'cancel',items:original.items.map(row=>({...row,side:row.side==='차변'?'대변':'차변'})),
   noncashApplication:{kind:'advance-cancellation',version:1,operationId:'cancel',companyId:'taebaek',partnerId:'p',applicationStatementId:'application',applicationFingerprint:'fp',reason:'취소'}};
  const rows=mode==='손상'?[{...original,noncashApplication:null}]:mode==='고아취소'?[cancel]:[original,cancel,{...cancel,id:'cancel2',noncashApplication:{...cancel.noncashApplication,operationId:'cancel2'}}];
  const f=fixture(rows);await expect(readDeletionAdvances(f.db,f.tx,'taebaek','p','target')).rejects.toThrow();expect(f.reads).toEqual(['issuedStatements']);
 });
});
describe('삭제 조회 힌트는 승인 근거가 아니다',()=>{
 const snapshot=(row:any)=>({exists:row!==undefined,data:()=>row});
 const input={operationId:'operation',statementId:'statement',releaseId:'release',expectedRevision:0,expectedOriginalHash:'a'.repeat(64)};
 function fixture(hintRow:any,currentRow:any,hintReceipt:any=undefined,currentReceipt:any=undefined,beforeQuery?:()=>Promise<void>){
  const reads:string[]=[],writes:string[]=[];
  const db:any={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id,get:async()=>snapshot(name==='issuedStatements'?hintRow:hintReceipt)}),
   where:(field:string,_op:string,value:any)=>({path:name+'?'+field+'='+value,where:()=>({path:name+'?linked'})})}),runTransaction:async(fn:any)=>fn({
    get:async(ref:any)=>{reads.push(ref.path);if(ref.path==='issuedStatements?partnerId=p'&&beforeQuery)await beforeQuery();if(ref.path==='appMeta/releaseCutover')return snapshot({status:'active',releaseId:'release'});
     if(ref.path==='issuedStatements/statement')return snapshot(currentRow);if(ref.path==='voucherMutationOperations/operation')return snapshot(currentReceipt);
     return {exists:false,empty:true,docs:[],data:()=>undefined};},create:(ref:any)=>writes.push(ref.path),update:(ref:any)=>writes.push(ref.path),delete:(ref:any)=>writes.push(ref.path)})};
  return {db,reads,writes};
 }
 it.each([
  {hint:{companyId:'taebaek',partnerId:'old'},current:{companyId:'taebaek',partnerId:'new'}},
  {hint:undefined,current:{companyId:'taebaek',partnerId:'new'}},
  {hint:{companyId:'taebaek'},current:{companyId:'taebaek',partnerId:'new'}},
  {hint:{companyId:'taebaek',partnerId:'p'},current:{companyId:'punghoe',partnerId:'p'}},
 ])('거래처나 회사 힌트가 바뀌면 영구 거절 감사 없이 aborted로 끝난다',async ({hint,current})=>{
  const f=fixture(hint,current);await expect(deleteIssuedStatement(f.db,'taebaek','actor',input)).rejects.toMatchObject({code:'aborted'});expect(f.writes).toEqual([]);
 });
 it('거래처 후보 조회가 전표 및 개별 영수증 읽기보다 먼저 끝난다',async()=>{
  let started!:()=>void,finish!:()=>void;const queryStarted=new Promise<void>(resolve=>{started=resolve;}),queryPending=new Promise<void>(resolve=>{finish=resolve;});
  const row={companyId:'taebaek',partnerId:'p'},f=fixture(row,row,undefined,undefined,async()=>{started();await queryPending;});
  const running=deleteIssuedStatement(f.db,'taebaek','actor',input),settled=running.catch(error=>error);await queryStarted;
  try{expect(f.reads).toEqual(['appMeta/releaseCutover','issuedStatements?partnerId=p']);}finally{finish();await settled;}
  await expect(running).rejects.toThrow('전표가 변경');
  expect(f.reads.slice(0,4)).toEqual(['appMeta/releaseCutover','issuedStatements?partnerId=p','issuedStatements/statement','voucherMutationOperations/operation']);
 });
 it('위조한 영수증 힌트는 같은 경로여도 duplicate 승인으로 사용하지 않는다',async()=>{
  const receipt={beforeSnapshot:{companyId:'taebaek',partnerId:'p'},status:'applied',createdBy:'other'},f=fixture(undefined,undefined,receipt,receipt);
  await expect(deleteIssuedStatement(f.db,'taebaek','actor',input)).rejects.toThrow('기존 전표 삭제');expect(f.writes).toEqual([]);
 });
 it('외부 조회 오류를 문서 없음으로 바꾸거나 감사로 확정하지 않는다',async()=>{
  let writes=0;const failure=new Error('조회 연결 오류'),db:any={collection:()=>({doc:()=>({get:async()=>{throw failure;}})}),runTransaction:()=>{writes++;}};
  await expect(deleteIssuedStatement(db,'taebaek','actor',input)).rejects.toBe(failure);expect(writes).toBe(0);
 });
});