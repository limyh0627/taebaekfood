import { expect, it } from 'vitest';
import { encodeCatalogValue, decodeCatalogValue, needsCatalogOrderReferenceProof, normalizeCatalogOrderReferenceProofRequest, type CatalogValueAdapter } from './catalogOrderReferenceProof';
const adapter: CatalogValueAdapter = { special: value => value instanceof Stamp ? ['timestamp', value.seconds, value.nanoseconds] : undefined, timestamp:(s,n)=>new Stamp(s,n), reference:path=>({reference:path}), geo:(a,b)=>({geo:[a,b]}), bytes:value=>value };
class Stamp { constructor(public seconds:number,public nanoseconds:number){} }
it('일반 seconds/nanoseconds 지도와 실제 Timestamp를 혼동하지 않는다',()=>{
 const map={seconds:1,nanoseconds:2},stamp=new Stamp(1,2);
 expect(encodeCatalogValue(map,adapter)[0]).toBe('map');expect(encodeCatalogValue(stamp,adapter)[0]).toBe('timestamp');
 expect(decodeCatalogValue(encodeCatalogValue(stamp,adapter),adapter)).toEqual(stamp);
 expect(decodeCatalogValue(encodeCatalogValue(map,adapter),adapter)).toEqual(map);
});
it('모든 값은 태그와 정렬된 지도 키로 왕복하며 미정의 지도만 생략한다',()=>{
 const value={a:null,b:[true,2,'값'],c:undefined,d:new Date('2026-10-18T00:00:00Z'),e:{nested:'x'}};
 expect(decodeCatalogValue(encodeCatalogValue(value,adapter),adapter)).toEqual({...value,c:undefined});
 expect(()=>encodeCatalogValue([undefined],adapter)).toThrow();
 expect(()=>decodeCatalogValue(['map',[['a',['null']],['a',['null']]]],adapter)).toThrow();
 expect(encodeCatalogValue({b:1,a:2})).toEqual(encodeCatalogValue({a:2,b:1}));
});
it('신규 진행·품목 변경·완료에서 재개만 proof를 요구한다',()=>{
 const before={status:'PENDING',items:[{itemId:'x'}]};
 expect(needsCatalogOrderReferenceProof(undefined,before)).toBe(true);
 expect(needsCatalogOrderReferenceProof(before,{...before,memo:'새 메모'})).toBe(false);
 expect(needsCatalogOrderReferenceProof(before,{...before,items:[{itemId:'y'}]})).toBe(true);
 expect(needsCatalogOrderReferenceProof({...before,status:'DELIVERED'},before)).toBe(true);
 expect(needsCatalogOrderReferenceProof(before,{...before,status:'DELIVERED'})).toBe(false);
});
it('요청은 정확 필드·회사·주문·revision만 허용한다',()=>{
 const request={version:1,companyId:'taebaek',orderId:'order',orderExists:false,beforeRevision:0,catalogRevision:1,status:'PENDING',items:encodeCatalogValue([{itemId:'x'}])};
 expect(normalizeCatalogOrderReferenceProofRequest(request)).toEqual(request);
 for(const patch of [{extra:true},{orderId:'a/b'},{beforeRevision:-1},{status:'DELIVERED'}])expect(()=>normalizeCatalogOrderReferenceProofRequest({...request,...patch})).toThrow();
});
