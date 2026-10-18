import {it,expect} from 'vitest';
import {termsFromOpening,partnerItemTermsOpening,partnerItemTermsExpected,normalizePartnerItemTermsPreviewInput,normalizePartnerItemTermsPreview,normalizePartnerItemTermsRequest,serializePartnerItemTermsRequest,serializePartnerItemTermsNotice,normalizePartnerItemTermsResult,type PartnerItemTermsReference} from './partnerItemTermsCommand';
const reference:PartnerItemTermsReference={companyId:'taebaek',planId:'plan',targetId:'item_partner_out',itemId:'item',partnerId:'partner',direction:'out'};
const evidence={schemaVersion:1,queries:[{kind:'bom',itemId:'item',count:0,digest:'a'.repeat(64)}],documents:[{kind:'item',id:'item',digest:'b'.repeat(64)}]};
const request={version:1,...reference,expected:null,terms:{price:0,taxType:null},evidence};
it('원행 세 거래조건만 이어받고 명시 수정·0·null·undefined의 뜻을 보존한다',()=>{
 const opening={price:120,taxType:'과세',Account_Code:'401',id:'legacy',packing:{keep:true},cost:99};const before=JSON.stringify(opening);
 expect(termsFromOpening(opening,{price:240})).toEqual({price:240,taxType:'과세',Account_Code:'401'});
 expect(termsFromOpening(opening,{price:0,taxType:null})).toEqual({price:0,taxType:null,Account_Code:'401'});
 expect(termsFromOpening(opening,{price:undefined,taxType:undefined,Account_Code:undefined})).toEqual({});
 expect(termsFromOpening({price:undefined,taxType:null},{})).toEqual({taxType:null});
 expect(termsFromOpening(null,{price:0})).toEqual({price:0});expect(JSON.stringify(opening)).toBe(before);
 expect(()=>termsFromOpening(opening,{price:Infinity})).toThrow();
});
it('UI opening은 합성 id·포장을 제외하고 raw expected는 원문 회사·body id 존재성을 추가한다',()=>{
 const raw={itemId:'item',partnerId:'partner',price:0,packing:{keep:true}};
 expect(partnerItemTermsOpening(raw)).toEqual(partnerItemTermsOpening({...raw,id:'synthetic',packing:{keep:false}}));expect(partnerItemTermsExpected(raw)).not.toEqual(partnerItemTermsExpected({...raw,id:'item_partner_out'}));
 expect(partnerItemTermsExpected(raw)).not.toEqual(partnerItemTermsExpected({...raw,Direction:'out'}));expect(partnerItemTermsExpected(raw)).not.toEqual(partnerItemTermsExpected({...raw,taxType:null}));
});
it('단가 0·생략·tax null·계정 생략을 구분하고 임의 patch와 잘못된 방향을 거절한다',()=>{
 expect(normalizePartnerItemTermsRequest(request)).toMatchObject({terms:{price:0,taxType:null}});expect(normalizePartnerItemTermsRequest({...request,terms:{}}).terms).not.toHaveProperty('price');
 for(const terms of [{price:Infinity},{taxType:'unknown'},{Account_Code:1},{packing:{}},{cost:10}])expect(()=>normalizePartnerItemTermsRequest({...request,terms})).toThrow();
 expect(()=>normalizePartnerItemTermsRequest({...request,direction:'sale'})).toThrow();
 expect(serializePartnerItemTermsRequest({...request,terms:{price:-0}})).toBe(serializePartnerItemTermsRequest({...request,terms:{price:0}}));
});
it('조회 evidence는 정렬·중복·전체 건수를 검증하고 유효한 긴 한글 ID를 막지 않는다',()=>{
 expect(normalizePartnerItemTermsPreviewInput({version:1,...reference,targetId:'가'.repeat(400),opening:null,terms:{price:1}}).targetId).toHaveLength(400);
 expect(()=>normalizePartnerItemTermsRequest({...request,evidence:{...evidence,queries:[...evidence.queries,...evidence.queries]}})).toThrow();
 expect(()=>normalizePartnerItemTermsRequest({...request,evidence:{...evidence,queries:[{...evidence.queries[0],count:-1}]}})).toThrow();
 expect(()=>normalizePartnerItemTermsRequest({...request,evidence:{...evidence,documents:[{kind:'tomb',id:'item',digest:'a'.repeat(64)},...evidence.documents]}})).toThrow();
});
it('preview 대상·안내 순서·notice hash를 묶고 서버 raw expected를 그대로 보존한다',()=>{
 const expected=partnerItemTermsExpected({companyId:'taebaek',itemId:'item',partnerId:'partner',price:1});
 const preview={version:1,...reference,expected,evidence,notices:[{itemId:'item',itemName:'박스',childId:'loose',childName:'낱개',count:12}],noticeHash:'c'.repeat(64)};
 expect(normalizePartnerItemTermsPreview(preview,reference).expected).toEqual(expected);expect(()=>normalizePartnerItemTermsPreview({...preview,partnerId:'other'},reference)).toThrow();expect(()=>normalizePartnerItemTermsPreview({...preview,noticeHash:undefined},reference)).toThrow();expect(()=>normalizePartnerItemTermsPreview({...preview,notices:[]},reference)).toThrow();
 const text=serializePartnerItemTermsNotice(reference,expected,{price:120},evidence as never,preview.notices);expect(text).not.toBe(serializePartnerItemTermsNotice(reference,expected,{price:121},evidence as never,preview.notices));
});
it('최종 응답은 reference 6개·실 UID·hash와 nullhash 상태를 모두 검증한다',()=>{
 const response={...reference,actorUid:'actor',requestHash:'a'.repeat(64),status:'applied',message:'완료'};
 expect(normalizePartnerItemTermsResult(response,reference,'actor').status).toBe('applied');for(const patch of [{actorUid:'other'},{direction:'in'},{targetId:'other'},{itemId:'other'},{partnerId:'other'},{companyId:'punghoe'},{requestHash:null},{status:'unknown'}])expect(()=>normalizePartnerItemTermsResult({...response,...patch},reference,'actor')).toThrow();
 expect(()=>normalizePartnerItemTermsResult(response,reference,'actor','b'.repeat(64))).toThrow();expect(normalizePartnerItemTermsResult({...response,status:'cancelled',requestHash:null},reference,'actor').status).toBe('cancelled');
});
