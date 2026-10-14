import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {classify,decodeValue,parseResponse,readItems,cliToken,run,selfCheck} from './diag-zero-item-price-20261015.mts';
import {prepareZeroItemPrice,type Document} from './shared/zeroItemPriceMigration.ts';

const stamp='2026-10-15T01:02:03.123456789Z';
const root='projects/taebaek-3abe4/databases/(default)/documents/';
const doc=(id:string,fields:Record<string,unknown>={})=>({document:{name:root+'items/'+id,fields,updateTime:stamp},readTime:stamp});
const row=(id:string,data:Record<string,unknown>):Document=>({id,data,version:{seconds:1,nanoseconds:3}});
const args=['--auth=firebase-cli','--output='+resolve('../zero-item-price-classification-20261015.json')];

it('REST 판독은 숫자 +0/-0·null·누락·비유한·문자열·boolean·기타 타입을 보존한다',()=>{
 const parsed=parseResponse([doc('SECRET_ITEM',{price:{doubleValue:-0},cost:{nullValue:null}}),doc('missing'),{done:true}]);
 expect(Object.is(parsed.documents[0].data.price,-0)).toBe(true);expect(parsed.documents[0].data.cost).toBeNull();expect(Object.hasOwn(parsed.documents[1].data,'price')).toBe(false);
 expect(parsed.documents[0].version.nanoseconds).toBe(123456789);
 expect(decodeValue({integerValue:'0'})).toBe(0);expect(decodeValue({stringValue:'0'})).toBe('0');expect(decodeValue({booleanValue:false})).toBe(false);
 expect(decodeValue({doubleValue:'NaN'})).toBeNaN();expect(decodeValue({doubleValue:'Infinity'})).toBe(Infinity);
 expect(decodeValue({timestampValue:stamp})).toEqual({timestampValue:stamp});expect(decodeValue({referenceValue:root+'items/SECRET_REFERENCE'})).toEqual({referenceValue:root+'items/SECRET_REFERENCE'});
 expect(decodeValue({arrayValue:{values:[{integerValue:'1'}]}})).toEqual([1]);expect(decodeValue({mapValue:{fields:{x:{booleanValue:true}}}})).toEqual({x:true});
});

it('REST 오류·불완전응답·다른 경로·중복·다른 projection·잘못된 버전은 실패한다',()=>{
 for(const bad of [[],{error:'SECRET_ERROR'},[{error:{message:'SECRET_ERROR'}}],[{done:true}],[{readTime:stamp,skippedResults:2}],
  [doc('a'),doc('a')],[{...doc('a'),extra:true}],[{done:true},doc('a')],
  [{...doc('a'),document:{...doc('a').document,name:root+'partners/a'}}],
  [doc('a',{name:{stringValue:'SECRET_NAME'}})],[{...doc('a'),document:{...doc('a').document,updateTime:'2026-02-30T01:02:03Z'}}]])expect(()=>parseResponse(bad)).toThrow('검증 실패');
 for(const bad of [{stringValue:0},{doubleValue:'0'},{nullValue:0},{stringValue:'0',integerValue:'0'},{unknownValue:'SECRET'}])expect(()=>decodeValue(bad)).toThrow('검증 실패');
 expect(parseResponse([{readTime:stamp},{done:true}]).documents).toEqual([]);expect(parseResponse([{...doc('a'),done:true}]).documents).toHaveLength(1);
});

it('가격×원가 교차 집계와 회사 분류는 원함수의 정확한 +0 선정과 일치하며 원문을 바꾸지 않는다',()=>{
 const data=[row('SECRET_MISSING',{price:0}),row('null-company',{companyId:null,price:-0,cost:0}),row('known',{companyId:'taebaek',price:0,cost:5}),row('foreign',{companyId:'punghoe',price:0,cost:null}),row('string',{price:'0',cost:-2}),row('null',{price:null,cost:NaN}),row('missing',{cost:false}),row('boolean',{price:true,cost:{marker:'SECRET_VALUE'}}),row('nonzero',{price:123456789,cost:'0'}),row('invalid',{companyId:false,price:0,cost:0}),row('negative',{price:-3,cost:-0}),row('infinite',{price:Infinity,cost:Infinity})];
 const before=structuredClone(data),result=classify(data);
 expect(data).toEqual(before);expect(result.documents).toBe(12);expect(result.companyFields).toEqual({missing:8,null:1,valid:2,invalid:1});
 for(const company of ['taebaek','punghoe'] as const)expect(result.companies[company].migrationSelected).toBe(prepareZeroItemPrice(company,data).documents.length);
 expect(result.companies.taebaek.cross.positiveZero.missing).toBe(1);expect(result.companies.taebaek.cross.positiveZero.positive).toBe(1);
 expect(result.companies.taebaek.price.negativeZero).toBe(1);expect(result.companies.taebaek.migrationSelected).toBe(2);expect(result.companies.invalid.migrationSelected).toBe(0);
 expect(result.companies.taebaek.price.string).toBe(1);expect(result.companies.taebaek.price.null).toBe(1);expect(result.companies.taebaek.price.missing).toBe(1);
 const output=JSON.stringify(result);for(const marker of ['SECRET_','123456789','nanoseconds','before','after'])expect(output).not.toContain(marker);
});

it('회사별 대상이 450을 넘으면 집계하되 기존 이관 일괄 한도 초과를 명시한다',()=>{
 const docs=Array.from({length:451},(_,i)=>row(String(i),{price:0}));const result=classify(docs);
 expect(result.companies.taebaek.migrationSelected).toBe(451);expect(result.companies.taebaek.exceedsSingleBatchLimit).toBe(true);
 expect(()=>prepareZeroItemPrice('taebaek',docs)).toThrow('한도');expect(result.companies.punghoe.exceedsSingleBatchLimit).toBe(false);
});

it('고정 프로젝트·items 세 필드만 읽고 토큰·ID·버전을 결과에 남기지 않는다',async()=>{
 const transport=vi.fn().mockResolvedValue({ok:true,json:async()=>[doc('SECRET_ID',{price:{integerValue:'0'}})]});
 const result=await readItems('SECRET_ACCESS',transport);expect(transport).toHaveBeenCalledOnce();
 const [url,request]=transport.mock.calls[0];expect(url).toBe('https://firestore.googleapis.com/v1/'+root.slice(0,-1)+':runQuery');
 expect(JSON.parse(request.body)).toEqual({structuredQuery:{select:{fields:['companyId','price','cost'].map(fieldPath=>({fieldPath}))},from:[{collectionId:'items',allDescendants:false}]}});
 expect(request.method).toBe('POST');expect(request.redirect).toBe('error');expect(request.signal).toBeInstanceOf(AbortSignal);
 expect(result.documents).toHaveLength(1);await expect(readItems('SECRET_ACCESS',async()=>({ok:false,json:async()=>{throw Error('SECRET_ERROR');}}))).rejects.toThrow('검증 실패');
});

it('출력 존재·잘못된 인수는 인증과 통신 전에 거절하며 응답 실패시 결과를 쓰지 않는다',async()=>{
 const token=vi.fn().mockResolvedValue('SECRET_TOKEN'),read=vi.fn(),write=vi.fn();
 await expect(run(args,{exists:()=>true,token,read,write})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 await expect(run(['--auth=auto',args[1]],{exists:()=>false,token,read,write})).rejects.toThrow();expect(token).not.toHaveBeenCalled();
 read.mockRejectedValue(new Error('SECRET_ERROR'));await expect(run(args,{exists:()=>false,token,read,write})).rejects.toThrow();expect(write).not.toHaveBeenCalled();
 read.mockResolvedValue(parseResponse([doc('SECRET_ID',{price:{doubleValue:0},cost:{stringValue:'SECRET_COST'}})]));
 const result=await run(args,{exists:()=>false,token,read,write});expect(write).toHaveBeenCalledOnce();expect(result.migrationPlan).toBe(false);expect(result.classificationOnly).toBe(true);expect(write.mock.calls[0][1]).not.toContain('SECRET_');
});

it('공식 CLI 기존 계정만 쓰고 refresh token fallback을 인증으로 보내지 않는다',async()=>{
 const getAccessToken=vi.fn().mockResolvedValue({access_token:'SECRET_ACCESS'}),getProjectDefaultAccount=vi.fn().mockReturnValue({tokens:{refresh_token:'SECRET_REFRESH'}});
 expect(await cliToken(()=>({getAccessToken,getProjectDefaultAccount}))).toBe('SECRET_ACCESS');expect(getAccessToken).toHaveBeenCalledWith('SECRET_REFRESH',['https://www.googleapis.com/auth/cloud-platform']);
 await expect(cliToken(()=>({getProjectDefaultAccount:()=>undefined}))).rejects.toThrow();getAccessToken.mockResolvedValue({access_token:'SECRET_REFRESH'});await expect(cliToken(()=>({getAccessToken,getProjectDefaultAccount}))).rejects.toThrow();
});

it('self-check는 인증·통신·운영 출력 없이 합성 값과 원함수만 검증한다',()=>{
 expect(selfCheck()).toEqual({selfCheck:'passed',productionRead:false,productionOutputWritten:false});
});
