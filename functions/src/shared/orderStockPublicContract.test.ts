import {describe,expect,it,vi} from 'vitest';
import {normalizePublicOrderStockRecoveryRequest as request,normalizePublicOrderStockRecoveryResult as result} from './orderStockPublicContract';

const ref={version:1,companyId:'taebaek',orderId:'주문-1',requestId:'요청-1'} as const;
const expected={reference:ref,originalOwnerUid:'최초 직원'};
const req=()=>({version:1,mode:'inspect',...expected});
const res=()=>({version:1,...expected,state:'reserved',canCancel:true,reason:'none',duplicate:false});
describe('공개 주문 복구 wire 계약',()=>{
 it.each(['inspect','cancel'])('%s는 최초 소유자를 그대로 보존하고 복사한다',mode=>{const input={...req(),mode},before=structuredClone(input),parsed=request(input);expect(parsed).toEqual(before);expect(parsed).not.toBe(input);expect(parsed.reference).not.toBe(input.reference);expect(input).toEqual(before);expect(request(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);});
 it.each(['',' ','a b','a/b','.','..','a\u0000b','가'.repeat(501)])('잘못된 ID %s를 거절한다',id=>{expect(()=>request({...req(),reference:{...ref,orderId:id}})).toThrow();});
 it('한글 ID의 UTF-8 한도와 소유자 문자 한도를 확인한다',()=>{expect(request({...req(),reference:{...ref,orderId:'가'.repeat(500)},originalOwnerUid:'가'.repeat(512)}).reference.orderId).toHaveLength(500);expect(()=>request({...req(),originalOwnerUid:'x'.repeat(513)})).toThrow();});
 it.each(['',' x','x ','x\u0000y'])('잘못된 소유자 %s를 거절한다',uid=>{expect(()=>request({...req(),originalOwnerUid:uid})).toThrow();});
 it('다른 회사와 undefined, 추가 필드는 거절한다',()=>{expect(()=>request({...req(),reference:{...ref,companyId:'other'}})).toThrow();expect(()=>request({...req(),mode:undefined})).toThrow();expect(()=>request({...req(),extra:1})).toThrow();expect(()=>request({...req(),reference:{...ref,extra:1}})).toThrow();});
 it('getter와 symbol, 상속 및 비열거 키를 실행하거나 수용하지 않는다',()=>{const getter=vi.fn(()=>ref),input={...req()};Object.defineProperty(input,'reference',{get:getter,enumerable:true});expect(()=>request(input)).toThrow();expect(getter).not.toHaveBeenCalled();const symbol={...req(),[Symbol('extra')]:1};expect(()=>request(symbol)).toThrow();expect(()=>request(Object.assign(Object.create({hidden:1}),req()))).toThrow();const nonenumerable={...req()};Object.defineProperty(nonenumerable,'mode',{value:'inspect',enumerable:false});expect(()=>request(nonenumerable)).toThrow();});
 it('원소유자 및 참조를 기대 원문과 비교하며 요청자 UID로 바꾸지 않는다',()=>{expect(result(res(),expected).originalOwnerUid).toBe('최초 직원');expect(()=>result({...res(),originalOwnerUid:'다른 직원'},expected)).toThrow();for(const key of ['companyId','orderId','requestId'] as const)expect(()=>result({...res(),reference:{...ref,[key]:key==='companyId'?'punghoe':'다른값'}},expected)).toThrow();});
 const states=['reserved','applied','cancelled','needs-review','not-found-unconfirmed'] as const,reasons=['none','current-state-changed','source-unproven','permission-denied','request-unconfirmed'] as const;
 for(const state of states)for(const reason of reasons)for(const canCancel of [true,false])it(`${state}/${reason}/취소가능 ${canCancel}`,()=>{const input={...res(),state,reason,canCancel},allowed=(!canCancel||state==='reserved'&&reason==='none')&&(!(state==='applied'||state==='cancelled')||reason==='none'&&!canCancel);if(allowed){const before=structuredClone(input);expect(result(input,expected)).toEqual(before);expect(input).toEqual(before);}else expect(()=>result(input,expected)).toThrow();});
 it.each(['targetStatus','serverPlanHash','readSet','actorName'])('응답의 %s 누출 필드는 거절한다',key=>{expect(()=>result({...res(),[key]:'비공개'},expected)).toThrow();});
 it('cancelled는 cancelled로 유지되며 숫자 boolean과 잘못된 기대원문은 거절한다',()=>{expect(result({...res(),state:'cancelled',canCancel:false},expected).state).toBe('cancelled');expect(()=>result({...res(),duplicate:0},expected)).toThrow();expect(()=>result(res(),{...expected,extra:1} as typeof expected)).toThrow();});
});
