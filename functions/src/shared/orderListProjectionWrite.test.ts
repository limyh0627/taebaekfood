import {expect,it} from 'vitest';
import {withOrderListProjection} from './orderListProjectionWrite';
const time='2026-10-15T00:00:00.000Z';const before={status:'DELIVERED',deliveredAt:time,deliveryDate:time,createdAt:time};
const sentinel={version:1,candidateDay:'9999-12-31'};const bounded={version:1,candidateDay:'2026-10-15'};
const deletion=Object.freeze({tag:'delete'}),transform=Object.freeze({tag:'transform'});const adapter={isDeleteValue:(v:unknown)=>v===deletion,isTransform:(v:unknown)=>v===deletion||v===transform};
it('create/replace는 최종 문서로 계산하고 생략된 dependency를 계승하지 않는다',()=>{
 expect(withOrderListProjection(undefined,before,'create')).toEqual({...before,orderListProjection:bounded});expect(withOrderListProjection(before,{memo:'교체'},'replace')).toEqual({memo:'교체',orderListProjection:sentinel});
});
it.each(['status','deliveredAt','deliveryDate','createdAt'])('patch의 %s 삭제 sentinel은 실제 부재로 해석하되 SDK 원문을 유지한다',key=>{
 const patch=Object.freeze({[key]:deletion});const result=withOrderListProjection(Object.freeze(before),patch,'patch',adapter);expect(result[key]).toBe(deletion);expect(result.orderListProjection).toEqual(sentinel);expect(patch[key]).toBe(deletion);
});
it('legacy 무관 patch는 projection을 새로 만들지 않고 독립 사본을 반환한다',()=>{const patch=Object.freeze({note:'원문'}),result=withOrderListProjection(before,patch,'patch');expect(result).toEqual(patch);expect(result).not.toBe(patch);});
it('정상 projection의 무관 patch를 보존하고 동일값 dependency도 파생값을 붙인다',()=>{
 expect(withOrderListProjection({...before,orderListProjection:bounded},{note:'비고'},'patch')).toEqual({note:'비고'});expect(withOrderListProjection(before,{status:'DELIVERED'},'patch').orderListProjection).toEqual(bounded);
});
it.each([{version:2,candidateDay:'2026-10-15'},{version:1,candidateDay:'1900-01-01'},{...bounded,extra:true},null,deletion])('잘못된 직접 projection %s를 조용히 보정하지 않는다',value=>expect(()=>withOrderListProjection(before,{orderListProjection:value},'patch',adapter)).toThrow());
it('기존 잘못된 projection과 dotted dependency는 명시 거절한다',()=>{
 expect(()=>withOrderListProjection({...before,orderListProjection:sentinel},{note:'무관'},'patch')).toThrow();for(const key of ['status.x','deliveryDate.x','createdAt.x','deliveredAt.x','orderListProjection.candidateDay'])expect(()=>withOrderListProjection(before,{[key]:'추정금지'},'patch')).toThrow();expect(()=>withOrderListProjection(before,{[Symbol('FieldPath')]:'x'},'patch')).toThrow();
});
it('공개 adapter가 알 수 없는 변환을 식별하면 송신 전 거절한다',()=>expect(()=>withOrderListProjection(before,{createdAt:transform},'patch',adapter)).toThrow());
it('Date/Timestamp 같은 비정형 값은 추측하지 않고 sentinel로 남긴다',()=>{const timestamp=Object.freeze({seconds:1,nanoseconds:0});for(const createdAt of [new Date(time),timestamp,{},null,undefined])expect(withOrderListProjection(before,{createdAt},'patch').orderListProjection).toEqual(sentinel);});
it('정상 직접 projection과 receipt/중첩 원문은 계산·변형하지 않는다',()=>{
 const receipt=Object.freeze({requestText:'원문'}),write=Object.freeze({...before,receipt,orderListProjection:Object.freeze(bounded)});const result=withOrderListProjection(undefined,write,'create');expect(result).not.toBe(write);expect(result.receipt).toBe(receipt);expect(result).toEqual(write);expect(Object.keys(write)).toHaveLength(6);
});
