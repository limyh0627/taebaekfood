import {it,expect} from 'vitest';
import {quotationSnapshot,quotationOpening,normalizeQuotationOpening,normalizeQuotationOpenResult,normalizeQuotationRequest,normalizeQuotationResult,serializeQuotationRequest,decodeQuotationSnapshot,decodeQuotationOpenSnapshot} from './quotationCommand';
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'한글견적'.repeat(30)};
const data={id:reference.targetId,companyId:'taebaek',quoteNo:'과거 번호',date:'옛 날짜',partnerId:'',partnerName:'문의처',lines:[{name:'품목',spec:'',qty:-1,price:-10,isTaxExempt:false,opaque:{legacy:0}}],totalSupply:10,totalTax:1,totalAmount:11,createdAt:'옛 시각',unknownTop:'별도'};
it('견적 현필드만 투영하며 음수·옛날짜·줄 미지필드를 재계산하지 않는다',()=>{
 const snapshot=quotationSnapshot(data),raw=decodeQuotationSnapshot(snapshot);
 expect(raw).not.toHaveProperty('unknownTop');expect(raw.lines).toEqual(data.lines);
 const request={version:1 as const,reference,action:'create' as const,expectedVersion:null,snapshot};
 expect(JSON.parse(serializeQuotationRequest(request))).toEqual(request);
 expect(normalizeQuotationRequest({...request,action:'update',expectedVersion:'123:000000001'}).expectedVersion).toBe('123:000000001');
});
it('대상·회사·기본형식과 create/update/delete 원문 경계만 검사한다',()=>{
 const base={version:1,reference,action:'create',expectedVersion:null,snapshot:quotationSnapshot(data)};
 for(const patch of [{reference:{...reference,targetId:'other'}},{snapshot:quotationSnapshot({...data,totalTax:Infinity})},{expectedVersion:'1:000000001'},{action:'delete'},{action:'update',expectedVersion:null}])expect(()=>normalizeQuotationRequest({...base,...patch})).toThrow();
 expect(normalizeQuotationRequest({version:1,reference,action:'delete',expectedVersion:'1:000000001'})).not.toHaveProperty('snapshot');
});
it('상태·reference·UID·해시를 대조하며 nullhash 성공·거절을 허용하지 않는다',()=>{
 const result={version:1,reference,actorUid:'uid',status:'applied',requestHash:'a'.repeat(64),message:'완료'};
 expect(normalizeQuotationResult(result,reference,'uid','a'.repeat(64)).status).toBe('applied');
 expect(()=>normalizeQuotationResult(result,{...reference,targetId:'other'},'uid')).toThrow();
 expect(()=>normalizeQuotationResult(result,reference,'other')).toThrow();
 expect(()=>normalizeQuotationResult(result,reference,'uid','b'.repeat(64))).toThrow();
 for(const status of ['applied','rejected'])expect(()=>normalizeQuotationResult({...result,status,requestHash:null},reference,'uid')).toThrow();
 expect(normalizeQuotationResult({...result,status:'cancelled',requestHash:null},reference,'uid').status).toBe('cancelled');
});
it('열림 비교는 identity를 제외하고 원문 응답은 고정 identity·UID·버전에 묶는다',()=>{
 const opening=quotationOpening(data);
 expect(opening).toEqual(quotationOpening({...data,id:'합성ID',companyId:'punghoe',unknownTop:'변경'}));
 expect(normalizeQuotationOpening(opening)).toEqual(opening);
 expect(()=>normalizeQuotationOpening(quotationSnapshot(data))).toThrow();
 const result={reference,actorUid:'uid',snapshot:quotationSnapshot(data),expectedVersion:'123:000000001'};
 expect(normalizeQuotationOpenResult(result,reference,'uid')).toEqual(result);
 expect(()=>normalizeQuotationOpenResult(result,reference,'other')).toThrow();
 expect(()=>normalizeQuotationOpenResult({...result,expectedVersion:'123:1'},reference,'uid')).toThrow();
});
it('과거 필드가 빠진 견적은 열림·삭제를 허용하되 같은 원문의 새 저장 검증은 유지한다',()=>{
 for(const missing of ['createdAt','line.spec']){
  const legacy:Record<string,unknown>={...data,lines:data.lines.map(line=>({...line}))};
  if(missing==='createdAt')delete legacy.createdAt;else delete (legacy.lines as Record<string,unknown>[])[0].spec;
  const snapshot=quotationSnapshot(legacy),opened={reference,actorUid:'uid',snapshot,expectedVersion:'123:000000001'};
  expect(normalizeQuotationOpenResult(opened,reference,'uid').snapshot).toEqual(snapshot);
  expect(decodeQuotationOpenSnapshot(snapshot)).not.toHaveProperty('unknownTop');
  expect(()=>normalizeQuotationRequest({version:1,reference,action:'update',expectedVersion:opened.expectedVersion,snapshot})).toThrow();
  expect(normalizeQuotationRequest({version:1,reference,action:'delete',expectedVersion:opened.expectedVersion}).action).toBe('delete');
 }
});
