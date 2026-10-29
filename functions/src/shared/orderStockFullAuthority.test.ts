import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {readFullEffectAuthority,markNewFullEffect,assertProductionRecordBusinessMatches,type FullEffectAuthorityV1} from './orderStockFullAuthority';
const context:FullEffectAuthorityV1={version:1,protocol:'full-v1',companyId:'taebaek',orderId:' 주문/😀 ',ownerUid:'사용자',attemptId:'시도/1'};
const text=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(value:unknown)=>createHash('sha256').update(text(value)).digest('hex');
it.each([1,Number.MAX_SAFE_INTEGER])('PBE-RECORD01 원transport부재→date RPC protocol1/revision%s 추가만현재형식으로비교',revision=>{const original={id:'record',finishedQty:3,date:'2026-10-27'},current={...original,date:'2026-10-28',inventoryWriterProtocolVersion:1,inventoryWriteRevision:revision},before=text(original);expect(()=>assertProductionRecordBusinessMatches(original,current,{text})).not.toThrow();expect(text(original)).toBe(before);});
it.each([{inventoryWriterProtocolVersion:1},{inventoryWriteRevision:1},{inventoryWriterProtocolVersion:null,inventoryWriteRevision:1},{inventoryWriterProtocolVersion:2,inventoryWriteRevision:1},{inventoryWriterProtocolVersion:1,inventoryWriteRevision:0},{inventoryWriterProtocolVersion:1,inventoryWriteRevision:NaN},{inventoryWriterProtocolVersion:1,inventoryWriteRevision:Number.MAX_SAFE_INTEGER+1}])('PBE-RECORD02 원transport부재→불명추가 %j거절',patch=>expect(()=>assertProductionRecordBusinessMatches({id:'record'},{id:'record',...patch},{text})).toThrow());
const compare=(a:Record<string,unknown>,b:Record<string,unknown>,options:Parameters<typeof assertProductionRecordBusinessMatches>[2]={text})=>assertProductionRecordBusinessMatches(a,b,options);
describe('원 효과 권위 표식 형식',()=>{
 it('없는 표식과 invalid 입력, 상속 표식을 구별한다',()=>{
  expect(readFullEffectAuthority({})).toEqual({kind:'absent'});for(const value of [null,undefined,[],1,'x',Object.create({fullEffectAuthority:context}),{fullEffectAuthority:null},{fullEffectAuthority:undefined}])expect(readFullEffectAuthority(value)).toEqual({kind:'invalid'});
 });
 it('정확한 여섯 primitive만 복사·동결하며 외부와 별도 객체다',()=>{
  const source={...context},r=readFullEffectAuthority({fullEffectAuthority:source});expect(r.kind).toBe('valid-v1');if(r.kind!=='valid-v1')throw Error('invalid');expect(r.value).toEqual(context);expect(r.value).not.toBe(source);expect(Object.isFrozen(r.value)).toBe(true);source.orderId='다른 값';expect(r.value.orderId).toBe(context.orderId);
 });
 it.each([{version:2},{protocol:'other'},{companyId:'other'},{orderId:''},{ownerUid:''},{attemptId:''},{extra:1}])('잘못된 형식 %s는 거절한다',patch=>{expect(readFullEffectAuthority({fullEffectAuthority:{...context,...patch}})).toEqual({kind:'invalid'});});
 it('누락·symbol·비열거·getter는 실행 없이 invalid다',()=>{
  const getter=vi.fn(()=>context),top=Object.defineProperty({},'fullEffectAuthority',{enumerable:true,get:getter});expect(readFullEffectAuthority(top)).toEqual({kind:'invalid'});const fieldGetter=vi.fn(()=>1),bad={...context};Object.defineProperty(bad,'version',{enumerable:true,get:fieldGetter});expect(readFullEffectAuthority({fullEffectAuthority:bad})).toEqual({kind:'invalid'});
  const symbol={...context,[Symbol('x')]:1},hidden={...context};Object.defineProperty(hidden,'extra',{value:1,enumerable:false});const {attemptId:_,...missing}=context;for(const value of [symbol,hidden,missing])expect(readFullEffectAuthority({fullEffectAuthority:value})).toEqual({kind:'invalid'});expect(getter).not.toHaveBeenCalled();expect(fieldGetter).not.toHaveBeenCalled();
 });
 it('신규 표식만 추가하고 원문·중첩 native 참조는 바꾸지 않는다',()=>{
  class Native {constructor(readonly value:number){}} const native=new Native(1),payload=Object.fromEntries([['__proto__',{safe:true}],['constructor','업무'],['native',native],['kg',3]]),before=hash(payload),oldContext=hash(context);const result=markNewFullEffect(payload,context);
  expect(hash(payload)).toBe(before);expect(hash(context)).toBe(oldContext);expect(hash(result)).not.toBe(before);expect(Object.getPrototypeOf(result)).toBe(Object.prototype);expect(Object.prototype.hasOwnProperty.call(result,'__proto__')).toBe(true);expect(result.__proto__).toEqual({safe:true});expect(result.native).toBe(native);expect(result.fullEffectAuthority).not.toBe(context);expect(Object.isFrozen(result.fullEffectAuthority)).toBe(true);
  for(const value of [null,context])expect(()=>markNewFullEffect({...payload,fullEffectAuthority:value},context)).toThrow();
 });
 it('payload getter·symbol·상속 표식과 context 추가키는 거절한다',()=>{
  const getter=vi.fn(()=>1),payload=Object.defineProperty({},'x',{enumerable:true,get:getter});expect(()=>markNewFullEffect(payload,context)).toThrow();expect(getter).not.toHaveBeenCalled();expect(()=>markNewFullEffect({[Symbol('x')]:1},context)).toThrow();expect(()=>markNewFullEffect(Object.create({fullEffectAuthority:context}),context)).toThrow();expect(()=>markNewFullEffect({}, {...context,extra:1} as FullEffectAuthorityV1)).toThrow();
 });
});
describe('생산 기록 업무 원문 대조',()=>{
 const original={id:'record',qty:3,date:'2026-01-01',inventoryWriteRevision:1,inventoryWriterProtocolVersion:1,generation:{id:'g'},fullEffectAuthority:context,unknown:{value:'원문'},supersededBy:null};
 it('날짜·revision만 달라져도 비교하고 동일 전이는 callback하지 않는다',()=>{const textSpy=vi.fn(text),verify=vi.fn();expect(()=>compare(original,{...original,date:'2026-10-29',inventoryWriteRevision:7},{text:textSpy,assertSupersession:verify})).not.toThrow();expect(textSpy).toHaveBeenCalled();expect(verify).not.toHaveBeenCalled();});
 it.each([{qty:4},{id:'other'},{generation:{id:'other'}},{inventoryWriterProtocolVersion:2},{unknown:{value:'변조'}},{fullEffectAuthority:{...context,ownerUid:'other'}}])('업무값 %s 변경은 거절한다',patch=>expect(()=>compare(original,{...original,...patch})).toThrow());
 it('후속 기록이 바뀌면 실제 검증 callback이 성공해야 한다',()=>{const next={...original,supersededBy:{id:'next'}};expect(()=>compare(original,next)).toThrow();expect(()=>compare(original,next,{text,assertSupersession:()=>{throw Error('실제 후속 근거 불일치');}})).toThrow('실제 후속 근거 불일치');const verify=vi.fn((before,after)=>{expect(before).toBeNull();expect(after).toEqual({id:'next'});});expect(()=>compare(original,next,{text,assertSupersession:verify})).not.toThrow();expect(verify).toHaveBeenCalledOnce();});
 it.each([true,false,null,{},'검증됨'])('후속 검증의 비 void 반환 %s는 성공으로 보지 않는다',value=>{const next={...original,supersededBy:{id:'next'}},before=text(original),after=text(next);expect(()=>compare(original,next,{text,assertSupersession:()=>value})).toThrow('동기 검증');expect(text(original)).toBe(before);expect(text(next)).toBe(after);});
 it('thenable getter는 실행하지 않고 비동기 성공·실패는 즉시 거절한다',async()=>{const next={...original,supersededBy:{id:'next'}},getter=vi.fn(()=>()=>{throw Error('실행 금지');}),thenable=Object.defineProperty({},'then',{get:getter});expect(()=>compare(original,next,{text,assertSupersession:()=>thenable})).toThrow('동기 검증');expect(getter).not.toHaveBeenCalled();expect(()=>compare(original,next,{text,assertSupersession:async()=>undefined})).toThrow('동기 검증');expect(()=>compare(original,next,{text,assertSupersession:async()=>{throw Error('비동기 거절');}})).toThrow('동기 검증');await new Promise(resolve=>setTimeout(resolve,0));});
 it('async 성공 verifier도 동기 성공으로 오인하지 않는다',()=>{const next={...original,supersededBy:{id:'next'}};expect(()=>compare(original,next,{text,assertSupersession:async()=>undefined})).toThrow('동기 검증');});
 it('__proto__와 constructor도 원문 비교에 포함한다',()=>{const a=Object.fromEntries([['__proto__',{qty:1}],['constructor','원'],['qty',3]]),b=Object.fromEntries([['__proto__',{qty:2}],['constructor','원'],['qty',3]]);expect(()=>compare(a,b)).toThrow();expect(()=>compare(a,Object.fromEntries([['__proto__',{qty:1}],['constructor','변경'],['qty',3]]))).toThrow();});
 it('최상위 getter·symbol·비행 객체는 호출하지 않고 거절한다',()=>{const get=vi.fn(()=>3),a=Object.defineProperty({},'qty',{enumerable:true,get});expect(()=>compare(a,original)).toThrow();expect(get).not.toHaveBeenCalled();expect(()=>compare({...original,[Symbol('x')]:1},original)).toThrow();expect(()=>compare(new Date() as never,original)).toThrow();});
});
