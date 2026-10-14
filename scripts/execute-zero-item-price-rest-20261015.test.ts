import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {Timestamp} from 'firebase-admin/firestore';
import {execute,options,selfCheck,type Dependencies} from './execute-zero-item-price-rest-20261015.mts';
import {encode,decode,hash} from './shared/zeroItemPriceBackup.ts';
import {prepareZeroItemPrice,type Document} from './shared/zeroItemPriceMigration.ts';
import {ZeroPriceRestError} from './shared/zeroItemPriceRest.ts';

function fixture(){
 const initial:Document={id:'SYNTHETIC_ID',data:{companyId:'taebaek',price:0,cost:12,nested:{note:'SYNTHETIC_NAME'}},version:{seconds:100,nanoseconds:7}};
 const plan=prepareZeroItemPrice('taebaek',[initial]),planHash=hash(plan),backup=resolve('work/zero-item-price-taebaek-20261015.json'),text=JSON.stringify(encode({plan,planHash}));
 const entries=new Map([[backup,text]]);let current=decode(encode(initial)) as Document,commits=0,reads=0,behavior='success',failWrite='',partial=false;
 const io={exists:(path:string)=>entries.has(path),read:(path:string)=>{if(!entries.has(path))throw Error('SYNTHETIC_MISSING');return entries.get(path)!;},write:(path:string,value:string)=>{if(entries.has(path))throw Error('SYNTHETIC_EXISTS');if(path.endsWith(failWrite)&&failWrite){if(partial)entries.set(path,'{');throw Error('SYNTHETIC_WRITE_FAILURE');}entries.set(path,value);},remove:(path:string)=>{entries.delete(path);},list:()=>[...entries.keys()]};
 const token=vi.fn().mockResolvedValue('SYNTHETIC_TOKEN');
 const read=vi.fn(async()=>{reads++;if(behavior==='post-read-failure'&&reads===2)throw Error('SYNTHETIC_READ_FAILURE');return {documents:[decode(encode(current)) as Document],readTimes:['2026-10-15T00:00:00Z']};});
 const adapter:Dependencies['adapter']=(({mode,plan:activePlan}:any)=>({collection:()=>({doc:(id:string)=>({id})}),batch:()=>{const updates:any[]=[];return {update:(...values:any[])=>{updates.push(values);},commit:async()=>{
  expect([...entries].some(([path,text])=>path.endsWith('.rest.lock')&&JSON.parse(text).planHash===hash(activePlan))).toBe(true);expect([...entries].some(([path,text])=>path.endsWith(`.rest-${mode}.intent.json`)&&JSON.parse(text).planHash===hash(activePlan))).toBe(true);
  commits++;if(behavior==='rejected')throw new ZeroPriceRestError('rejected','PERMISSION_DENIED');
  if(behavior==='unknown-before')throw new ZeroPriceRestError('unknown','TRANSPORT_ERROR');
  for(const [_ref,_patch,options]of updates)if(options.lastUpdateTime.seconds!==current.version.seconds||options.lastUpdateTime.nanoseconds!==current.version.nanoseconds)throw new ZeroPriceRestError('rejected','FAILED_PRECONDITION');
  current={id:initial.id,data:decode(encode(mode==='apply'?activePlan.documents[0].after:activePlan.documents[0].before)),version:{seconds:100+commits,nanoseconds:37}};
  if(behavior==='unknown-after')throw new ZeroPriceRestError('unknown','TRANSPORT_ERROR');
  return updates.map(()=>({writeTime:new Timestamp(current.version.seconds,current.version.nanoseconds)}));
 }};}})) as unknown as Dependencies['adapter'];
 const dependencies:Dependencies={io,token,read,adapter,uuid:()=> 'SYNTHETIC_OPERATION'};
 const args=(mode?:'apply'|'undo')=>['--auth=firebase-cli','--company=taebaek','--backup='+backup,...(mode?['--'+mode,'--approved-hash='+planHash]:[])];
 return {dependencies,entries,backup,text,plan,planHash,args,state:()=>current,commits:()=>commits,setBehavior:(value:string)=>{behavior=value;},setFailure:(suffix:string,afterPartial=false)=>{failWrite=suffix;partial=afterPartial;},changeVersion:()=>{current.version.nanoseconds++;}};
}

it('기본 inspect는 읽기만 하고 명시 승인 apply는 lock→intent→commit→receipt 순서로 원가를 보존한다',async()=>{
 const f=fixture();expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'ready',writes:0});expect(f.entries.size).toBe(1);
 const result=await execute(f.args('apply'),f.dependencies);expect(result).toMatchObject({status:'applied',writes:1});expect(f.commits()).toBe(1);expect(f.state().data).toEqual(f.plan.documents[0].after);expect(f.state().data.cost).toBe(12);
 expect(f.entries.has(f.backup+'.rest-apply.intent.json')).toBe(true);expect(f.entries.has(f.backup+'.applied.json')).toBe(true);expect(f.entries.has(f.backup+'.rest.lock')).toBe(false);expect(f.entries.get(f.backup)).toBe(f.text);
 expect(JSON.stringify(result)).not.toContain('SYNTHETIC');expect(JSON.stringify(result)).not.toContain('cost');
});

it('유효한 영수증은 중복 요청에서 검증만 하며 undo도 조건부로 한번만 실행한다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'applied',writes:0});
 expect(await execute(f.args('undo'),f.dependencies)).toMatchObject({status:'undone',writes:1});expect(f.state().data).toEqual(f.plan.documents[0].before);
 expect(await execute(f.args('undo'),f.dependencies)).toMatchObject({status:'undone',writes:0});expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'undone',writes:0});expect(f.commits()).toBe(2);expect(f.entries.get(f.backup)).toBe(f.text);
});

it('동시 실행은 기존 배타 잠금으로 막으며 송신 전 CAS 변경은 자기 잠금만 해제한다',async()=>{
 const f=fixture();const first=execute(f.args('apply'),f.dependencies);const second=execute(f.args('apply'),f.dependencies).catch(()=> 'blocked');expect(await second).toBe('blocked');await first;expect(f.commits()).toBe(1);
 const changed=fixture();changed.changeVersion();await expect(execute(changed.args('apply'),changed.dependencies)).rejects.toThrow('전송 전');expect(changed.commits()).toBe(0);expect(changed.entries.size).toBe(1);
});

it('확정 서버 거절은 고정 사유·새 dry 안내와 거절/의도 기록을 남기고 재송신하지 않는다',async()=>{
 const f=fixture();f.setBehavior('rejected');expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'rejected',writes:0,code:'PERMISSION_DENIED'});
 expect(f.entries.has(f.backup+'.rest.lock')).toBe(false);expect(f.entries.has(f.backup+'.rest-apply.rejected.json')).toBe(true);
 expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'rejected',code:'PERMISSION_DENIED',message:expect.stringContaining('새 dry·승인')});
 await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow();expect(f.commits()).toBe(1);
});

it.each(['unknown-before','unknown-after'])('전송 결과 불명은 의도와 잠금을 보존하고 새 apply를 막는다: %s',async behavior=>{
 const f=fixture();f.setBehavior(behavior);expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'unknown',writes:null});
 expect(f.entries.has(f.backup+'.rest.lock')).toBe(true);expect(f.entries.has(f.backup+'.rest-apply.intent.json')).toBe(true);expect(f.entries.has(f.backup+'.applied.json')).toBe(false);
 await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow();expect(f.commits()).toBe(1);
});

it('commit 뒤 영수증 저장 실패는 실제 반영을 추측하지 않고 의도와 잠금을 보존한다',async()=>{
 const f=fixture();f.setFailure('.applied.json');expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'unknown',message:expect.stringContaining('영수증 저장')});
 expect(f.state().data).not.toHaveProperty('price');expect(f.entries.has(f.backup+'.rest.lock')).toBe(true);await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow();expect(f.commits()).toBe(1);
});

it('의도 파일 부분 저장 실패는 송신하지 않고 기존 의도와 잠금을 남긴다',async()=>{
 const f=fixture();f.setFailure('.rest-apply.intent.json',true);expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'unknown'});expect(f.commits()).toBe(0);expect(f.entries.has(f.backup+'.rest.lock')).toBe(true);
 await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow();expect(f.commits()).toBe(0);
});

it('사후 읽기 실패는 실적용 영수증을 보존하며 다음 inspect는 다시 쓰지 않는다',async()=>{
 const f=fixture();f.setBehavior('post-read-failure');expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'verification-failed',message:expect.stringContaining('영수증은 보관')});expect(f.entries.has(f.backup+'.applied.json')).toBe(true);
 f.setBehavior('success');expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'applied',writes:0});expect(f.commits()).toBe(1);
});

it('승인 hash·회사·계획 변조·영수증 없는 undo는 인증/송신 전에 차단한다',async()=>{
 const f=fixture();await expect(execute(f.args('apply').map(value=>value.startsWith('--approved-hash=')?'--approved-hash='+'0'.repeat(64):value),f.dependencies)).rejects.toThrow();expect(f.dependencies.token).not.toHaveBeenCalled();
 await expect(execute(f.args('undo'),f.dependencies)).rejects.toThrow('영수증');expect(f.commits()).toBe(0);expect(f.entries.size).toBe(1);
 const bad=decode(JSON.parse(f.text));bad.plan.documents[0].after.cost=0;f.entries.set(f.backup,JSON.stringify(encode(bad)));await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow();expect(f.dependencies.token).not.toHaveBeenCalled();
});

it('복원 전 원문 버전이 바뀌면 기존 영수증을 보존하고 undo를 보내지 않는다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);const applied=f.entries.get(f.backup+'.applied.json');f.changeVersion();await expect(execute(f.args('undo'),f.dependencies)).rejects.toThrow('전송 전');expect(f.commits()).toBe(1);expect(f.entries.get(f.backup+'.applied.json')).toBe(applied);
});

it('다른 실행 잠금·손상된 영수증을 삭제하거나 재전송하지 않는다',async()=>{
 const locked=fixture();locked.entries.set(locked.backup+'.rest.lock','SYNTHETIC_OTHER_LOCK');await expect(execute(locked.args('apply'),locked.dependencies)).rejects.toThrow();expect(locked.entries.get(locked.backup+'.rest.lock')).toBe('SYNTHETIC_OTHER_LOCK');expect(locked.dependencies.token).not.toHaveBeenCalled();
 const broken=fixture();broken.entries.set(broken.backup+'.applied.json','{');await expect(execute(broken.args('apply'),broken.dependencies)).rejects.toThrow();expect(broken.commits()).toBe(0);expect(broken.entries.get(broken.backup+'.applied.json')).toBe('{');
});

it('검증된 전송 전 adapter 거절은 요청 0건으로 분리하고 알 수 없는 코드는 출력하지 않는다',async()=>{
 const f=fixture();f.dependencies.adapter=()=>{throw new ZeroPriceRestError('not-started','INVALID_ADAPTER_INPUT');};expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'rejected',writes:0,code:'INVALID_ADAPTER_INPUT'});expect(f.commits()).toBe(0);expect(f.entries.has(f.backup+'.rest.lock')).toBe(false);
 f.entries.set(f.backup+'.rest-apply.rejected.json',JSON.stringify({version:1,planHash:f.planHash,mode:'apply',outcome:'not-started',code:'SYNTHETIC_SECRET_TOKEN'}));const result=await execute(f.args(),f.dependencies);expect(result).toMatchObject({status:'unknown'});expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
});

it('self-check와 잘못된 옵션은 인증·파일 작업 없이 검사된다',()=>{
 expect(selfCheck()).toEqual({selfCheck:'passed',productionRead:false,productionWrite:false,productionOutputWritten:false});expect(()=>options(['--apply','--undo'])).toThrow();
});

function revision(f:ReturnType<typeof fixture>){
 const backup=f.backup.replace(/\.json$/,'-v2.json'),plan=prepareZeroItemPrice('taebaek',[decode(encode(f.state()))]),planHash=hash(plan);f.entries.set(backup,JSON.stringify(encode({plan,planHash})));
 return {backup,planHash,args:['--auth=firebase-cli','--company=taebaek','--backup='+backup,'--apply','--approved-hash='+planHash]};
}

it('확정 거절 뒤 원본을 보존하고 명시 v2 새 계획·새 hash 승인으로 복구한다',async()=>{
 const f=fixture();f.setBehavior('rejected');await execute(f.args('apply'),f.dependencies);f.changeVersion();const next=revision(f);expect(next.planHash).not.toBe(f.planHash);
 await expect(execute(next.args.map(arg=>arg.startsWith('--approved-hash=')?'--approved-hash='+f.planHash:arg),f.dependencies)).rejects.toThrow();f.setBehavior('success');
 expect(await execute(next.args,f.dependencies)).toMatchObject({status:'applied',writes:1});expect(f.entries.get(f.backup)).toBe(f.text);expect(f.entries.has(f.backup+'.rest-apply.rejected.json')).toBe(true);expect(f.commits()).toBe(2);
});

it.each(['unknown-before','unknown-after'])('미확인 이전 revision은 새 revision의 쓰기로 우회하지 못한다: %s',async behavior=>{
 const f=fixture();f.setBehavior(behavior);await execute(f.args('apply'),f.dependencies);const next=revision(f);await expect(execute(next.args,f.dependencies)).rejects.toThrow('이전 revision');expect(f.commits()).toBe(1);expect(f.entries.has(next.backup+'.rest.lock')).toBe(false);
});

it('이전 apply 영수증이 있어도 별도 unknown undo 의도는 새 revision으로 우회하지 못한다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);const metadata=JSON.stringify({version:1,mode:'undo',operationId:'SYNTHETIC_UNDO',planHash:f.planHash});f.entries.set(f.backup+'.rest-undo.intent.json',metadata);f.entries.set(f.backup+'.rest.lock',metadata);
 const next=revision(f);await expect(execute(next.args,f.dependencies)).rejects.toThrow('이전 revision');expect(f.commits()).toBe(1);
 expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'unknown',message:expect.stringContaining('연결되지 않은')});
});

it('이전 revision의 완전한 실영수증·의도 연결 뒤 빈 v2 계획은 원격 commit 없이 완료한다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);const next=revision(f);expect(await execute(next.args,f.dependencies)).toMatchObject({status:'applied',writes:0});expect(f.commits()).toBe(1);expect(f.entries.has(next.backup+'.applied.json')).toBe(true);
});

it('이전 처리가 끝난 뒤 정당한 원문 변경은 새 승인 v2의 CAS만 검사하고 허용한다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);f.state().data.cost=17;f.state().data.price=0;f.changeVersion();const next=revision(f);
 expect(await execute(next.args,f.dependencies)).toMatchObject({status:'applied',writes:1});expect(f.state().data.cost).toBe(17);expect(f.commits()).toBe(2);expect(f.entries.get(f.backup)).toBe(f.text);
});

it('기존 실영수증 이후 원문이 바뀌면 미확인 전송과 구분하여 검증 미완을 알리고 쓰지 않는다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);f.changeVersion();expect(await execute(f.args('apply'),f.dependencies)).toMatchObject({status:'verification-failed',writes:0,message:expect.stringContaining('영수증은 보관')});expect(f.commits()).toBe(1);
});

it('기본 inspect는 완료 잠금을 유지하고 명시 검증 잠금해제 뒤 새 v2 복구가 가능하다',async()=>{
 const f=fixture();f.setBehavior('post-read-failure');await execute(f.args('apply'),f.dependencies);f.setBehavior('success');
 expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'applied',writes:0});expect(f.entries.has(f.backup+'.rest.lock')).toBe(true);
 const originalLock=f.entries.get(f.backup+'.rest.lock');expect(originalLock).toBeTruthy();expect(await execute([...f.args(),'--release-verified-lock'],f.dependencies)).toMatchObject({status:'applied',lockReleased:true,writes:0});
 expect(f.entries.has(f.backup+'.rest.lock')).toBe(false);expect(f.entries.has(f.backup+'.rest-apply.intent.json')).toBe(true);expect(f.entries.has(f.backup+'.applied.json')).toBe(true);
 const next=revision(f);expect(await execute(next.args,f.dependencies)).toMatchObject({status:'applied',writes:0});expect(f.commits()).toBe(1);
});

it('비동일 잠금 또는 확인 중 바뀐 잠금은 명시 해제에서도 보존한다',async()=>{
 const f=fixture();f.setBehavior('post-read-failure');await execute(f.args('apply'),f.dependencies);f.setBehavior('success');const path=f.backup+'.rest.lock',original=f.entries.get(path)!;
 const different=JSON.parse(original);different.operationId='SYNTHETIC_OTHER_OPERATION';f.entries.set(path,JSON.stringify(different));expect(await execute([...f.args(),'--release-verified-lock'],f.dependencies)).toMatchObject({status:'unknown'});expect(f.entries.get(path)).toBe(JSON.stringify(different));
 f.entries.set(path,original);const previous=f.dependencies.read;f.dependencies.read=async()=>{const result=await previous('SYNTHETIC_TOKEN');f.entries.set(path,'SYNTHETIC_REPLACED_LOCK');return result;};
 expect(await execute([...f.args(),'--release-verified-lock'],f.dependencies)).toMatchObject({status:'verification-failed'});expect(f.entries.get(path)).toBe('SYNTHETIC_REPLACED_LOCK');expect(f.commits()).toBe(1);
});

it('거절 marker는 정확한 의도 연결이 필요하며 다른 mode unknown보다 먼저 미반영을 주장하지 않는다',async()=>{
 const f=fixture();f.setBehavior('rejected');await execute(f.args('apply'),f.dependencies);const markerPath=f.backup+'.rest-apply.rejected.json',original=f.entries.get(markerPath)!,marker=JSON.parse(original);marker.operationId='SYNTHETIC_FORGED_OPERATION';f.entries.set(markerPath,JSON.stringify(marker));expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'unknown'});
 f.entries.set(markerPath,original);f.entries.set(f.backup+'.rest-undo.intent.json',JSON.stringify({version:1,mode:'undo',companyId:'taebaek',operationId:'SYNTHETIC_UNDO',planHash:f.planHash}));expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'unknown'});expect(f.commits()).toBe(1);
});

it('정확한 not-started undo 거절도 intent 연결로 종료 판정하고 적용 영수증은 보존한다',async()=>{
 const f=fixture();await execute(f.args('apply'),f.dependencies);f.dependencies.adapter=(()=>({batch:()=>{throw new ZeroPriceRestError('not-started','ADAPTER_ALREADY_USED');}})) as unknown as Dependencies['adapter'];
 expect(await execute(f.args('undo'),f.dependencies)).toMatchObject({status:'rejected',writes:0,code:'ADAPTER_ALREADY_USED'});
 expect(await execute(f.args(),f.dependencies)).toMatchObject({status:'applied',writes:0,code:'ADAPTER_ALREADY_USED'});expect(f.entries.has(f.backup+'.applied.json')).toBe(true);expect(f.commits()).toBe(1);
});

it('검증 잠금해제는 inspect와만 함께 허용된다',()=>{const f=fixture();expect(()=>options([...f.args('apply'),'--release-verified-lock'])).toThrow();expect(()=>options([...f.args('undo'),'--release-verified-lock'])).toThrow();});

it('같은 backup에 undo unknown 의도만 남고 영수증·잠금이 없어도 apply를 보내지 않는다',async()=>{
 const f=fixture();f.entries.set(f.backup+'.rest-undo.intent.json',JSON.stringify({version:1,mode:'undo',companyId:'taebaek',operationId:'SYNTHETIC_UNDO',planHash:f.planHash}));
 await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow('같은 백업');expect(f.dependencies.token).not.toHaveBeenCalled();expect(f.commits()).toBe(0);expect(f.entries.get(f.backup)).toBe(f.text);
 expect(f.entries.has(f.backup+'.rest-apply.intent.json')).toBe(false);expect(f.entries.has(f.backup+'.rest-undo.intent.json')).toBe(true);
});

it('쓰기 preflight 읽는 동안 생긴 다른 mode unknown도 송신 전에 막고 자기 잠금만 해제한다',async()=>{
 const f=fixture(),previous=f.dependencies.read;f.dependencies.read=async()=>{const result=await previous('SYNTHETIC_TOKEN');f.entries.set(f.backup+'.rest-undo.intent.json',JSON.stringify({version:1,mode:'undo',companyId:'taebaek',operationId:'SYNTHETIC_UNDO',planHash:f.planHash}));return result;};
 await expect(execute(f.args('apply'),f.dependencies)).rejects.toThrow('전송 전');expect(f.commits()).toBe(0);expect(f.entries.has(f.backup+'.rest.lock')).toBe(false);expect(f.entries.has(f.backup+'.rest-undo.intent.json')).toBe(true);
});
