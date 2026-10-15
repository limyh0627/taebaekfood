import {describe,it,expect,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractCalculation,classify,safeData,parseResponse,readAll,selfCheck,paths,localDay,run,diagnosticFailure,orderConsumption} from './diag-pallet-inuse-equivalence-readonly-20261015.mts';
const source=readFileSync('components/PalletManager.tsx','utf8');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').toUpperCase();
const input={pallets:[{id:'p',name:'KPP',companyId:'taebaek',inUse:9}],partners:[{id:'c',name:'합성',companyId:'taebaek'}],orders:[{id:'o',companyId:'taebaek',status:'SHIPPED',partnerId:'c',pallets:[{type:'p',quantity:3}]}],palletTransactions:[{id:'t',companyId:'taebaek',partnerId:'c',palletId:'p',date:'2026-10-15',type:'in',quantity:1}]};
describe('팔레트 원문 계산 읽기 진단',()=>{
 it('실제 주문 조건의 단락 순서를 따르고 미사용 필드 오류를 보정하지 않고 제외 집계한다',()=>{
  const orders=[{id:'a'},{id:'b',pallets:null},{id:'c',pallets:[]},{id:'d',pallets:[null]},{id:'e',pallets:[null],status:9},{id:'f',pallets:[null],status:'PENDING'},{id:'g',pallets:{},status:'SHIPPED'},...input.orders];
  const calculate=extractCalculation(),data={...input,orders};expect(orderConsumption(orders,calculate.includesOrder)).toEqual({noPallets:3,missingStatus:1,wrongTypeStatus:1,otherStatus:1,malformedPalletContainer:1,consumed:1});expect(calculate(data)).toEqual(calculate(input));expect(()=>classify(data,calculate)).not.toThrow();expect(orders[3].pallets).toEqual([null]);
 });
 it('소비행의 잘못된 컨테이너·원소·비유한 수량은 거절하고 원문의 기본값은 유지한다',()=>{
  for(const pallets of ['잘못된배열',[null],[{type:'p',quantity:'2'}],[{type:'p',quantity:Infinity}]])expect(()=>classify({...input,orders:[{...input.orders[0],pallets}]})).toThrow();
  const calculate=extractCalculation(),data={...input,orders:[{...input.orders[0],pallets:[{}, {type:null,quantity:null}]}],palletTransactions:[]};expect(calculate(data).outstanding).toEqual([]);expect(()=>classify(data,calculate)).not.toThrow();
 });
 it('비출고 제외행의 미사용 수량과 형식은 실제 계산을 바꾸지 않는다',()=>{
  const calculate=extractCalculation(),data={...input,orders:[{id:'excluded',status:'PENDING',pallets:[{type:123,quantity:Infinity}]}]};expect(calculate(data)).toEqual(calculate({...data,orders:[]}));expect(()=>classify(data,calculate)).not.toThrow();
 });
 it('주문 포함 여부는 별도 구현이 아니라 실제 추출한 필터 조건을 따른다',()=>{
  const changed=source.replace('o.status === OrderStatus.SHIPPED','o.status === OrderStatus.PENDING');expect(changed).not.toBe(source);const calculate=extractCalculation(changed,hash(changed));expect(calculate.includesOrder(input.orders[0])).toBe(false);expect(calculate.includesOrder({...input.orders[0],status:'PENDING'})).toBe(true);expect(calculate(input).outstanding).toEqual([]);
 });
 it('외부 오류의 원문과 임의 코드는 출력하지 않는다',()=>{expect(diagnosticFailure({code:'비밀표식',message:'비밀표식',stack:'비밀표식'})).toEqual({stage:'source',code:'failed'});});
 it.each(['source','paths','auth','query','input','calculation','output'])('실패 단계를 보존하고 %s 뒤의 업무를 실행하지 않는다',async(stage)=>{
  const secret=()=>{throw Object.assign(new Error('비밀표식'),{code:'비밀표식'});};
  const result=Object.fromEntries(['pallets','partners','orders','palletTransactions'].map(name=>[name,{rows:(input as any)[name],originals:[],readTimes:['2026-10-15T00:00:00Z']}])) as any;
  if(stage==='input')result.orders.rows=[{id:'합성',status:'SHIPPED',pallets:[null]}];
  const calculate=vi.fn(()=>stage==='calculation'?secret:()=>({stats:[],outstanding:[]}));if(stage==='source')calculate.mockImplementation(secret);
  const path=vi.fn(()=>({output:'nonexistent-pallet-diagnostic-directory/result.json',originals:'nonexistent-pallet-diagnostic-directory/original.json'}));if(stage==='paths')path.mockImplementation(secret);
  expect(existsSync('nonexistent-pallet-diagnostic-directory')).toBe(false);
  const token=vi.fn(async()=>{if(stage==='auth')secret();return '합성';}),read=vi.fn(async()=>{if(stage==='query')secret();return result;});
  let failure:unknown;try{await run(['--auth=firebase-cli'],{calculate:calculate as any,paths:path,token,read});}catch(error){failure=error;}
  expect(diagnosticFailure(failure).stage).toBe(stage);expect(JSON.stringify(diagnosticFailure(failure))).not.toContain('비밀표식');if(['source','paths'].includes(stage))expect(token).not.toHaveBeenCalled();if(['source','paths','auth'].includes(stage))expect(read).not.toHaveBeenCalled();
  expect(existsSync('nonexistent-pallet-diagnostic-directory')).toBe(false);
 });
 it.each(['transport','http','json','shape'])('조회 실패 %s를 컬렉션과 고정 코드로 구분한다',async(mode)=>{
  const transport=vi.fn(async()=>{if(mode==='transport')throw Error('비밀표식');return {ok:mode!=='http',json:async()=>{if(mode==='json')throw Error('비밀표식');return [{error:{message:'비밀표식'}}];}};});let failure:unknown;try{await readAll('비밀표식',transport as any);}catch(error){failure=error;}
  expect(diagnosticFailure(failure)).toEqual({stage:['json','shape'].includes(mode)?'restshape':'query',code:mode==='transport'?'failed':mode==='shape'?'validation':mode,collection:'pallets'});expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(diagnosticFailure(failure))).not.toContain('비밀표식');
 });
 it('날짜 원문 해시·형태·외부 의존성 실패는 인증과 조회 전에 거절한다',async()=>{
  const dateSource=readFileSync('src/shared/day.ts','utf8');
  for(const [changed,expected] of [[dateSource+' ',undefined],[dateSource.replace('function dateOfLocal(','function renamedDate('),'rehash'],[dateSource.replace('const v = String','const leak = process; const v = String'),'rehash']]){
   const token=vi.fn(),read=vi.fn();await expect(run(['--auth=firebase-cli'],{calculate:()=>{localDay(new Date(0),changed,expected==='rehash'?hash(changed!):undefined);return extractCalculation();},paths,token,read})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
  }
 });
 it('실제 세 선언으로 회수 대기를 계산하고 저장 inUse와 별도로 비교한다',()=>{
  const calculate=extractCalculation();expect(calculate(input).outstanding).toEqual([['KPP',2]]);expect(classify(input,calculate,new Date('2026-10-15T01:00:00Z')).companies.taebaek).toMatchObject({palletDocuments:1,inUsePresent:1,fullHistoryEquivalent:true,transactionWindowEquivalent:true,storedValueDifferentFromFull:1});expect(input.pallets[0].inUse).toBe(9);
 });
 it('원문 해시 변경과 중복·외부 참조·실행 함수 주입을 거절한다',()=>{
  expect(()=>extractCalculation(source+' ')).toThrow();
  for(const changed of [source.replace('const m = new Map','const leak = process; const m = new Map'),source.replace('const m = new Map','fetch("https://example.invalid"); const m = new Map'),source+'\nconst palletNameOf=()=>null;',source.replace('const m = new Map','const leak = externalData; const m = new Map')])expect(()=>extractCalculation(changed,hash(changed))).toThrow();
  for(const name of ['Map','Object']){const changed=source.replace('const ITEMS_PER_PAGE = 5;',`const ${name}=externalData; const ITEMS_PER_PAGE = 5;`);expect(()=>extractCalculation(changed,hash(changed))).toThrow();}
 });
 it('위험 키·숫자 형식·자료 형식 실패를 동치 성공으로 바꾸지 않는다',()=>{
  expect(()=>safeData(JSON.parse('{"safe":{"constructor":1}}'))).toThrow();expect(()=>classify({...input,palletTransactions:[{...input.palletTransactions[0],quantity:'1'}]})).toThrow();expect(()=>classify({...input,pallets:[{...input.pallets[0],inUse:null}]})).toThrow();
 });
 it('동적 집계 키가 되는 이름과 ID의 prototype 위험 문자열도 실행 전에 거절한다',()=>{
  for(const value of ['__proto__','constructor','prototype'])expect(()=>classify({...input,partners:[{...input.partners[0],id:value}]})).toThrow();
 });
 it('교환·이동 거래와 회사 범위는 실제 계산을 따르고 개인정보·수량을 결과에 싣지 않는다',()=>{
  const result=classify({...input,orders:[{...input.orders[0],pallets:[{type:'p',quantity:999,isExchange:true}]}],palletTransactions:[{...input.palletTransactions[0],isTransfer:true}]});
  expect(result.companies.taebaek).toMatchObject({storedValueDifferentFromFull:1});expect(JSON.stringify(result)).not.toContain('합성');expect(JSON.stringify(result)).not.toContain('KPP');expect(result.companies.punghoe).toMatchObject({palletDocuments:0});
 });
 it('오래된 완료 주문과 거래는 새 기본 범위와 전체 이력을 구분한다',()=>{
  const data={...input,orders:[{...input.orders[0],status:'DELIVERED',deliveredAt:'2020-01-01'}],palletTransactions:[]};const result=classify(data,extractCalculation(),new Date('2026-10-15T00:00:00Z'));expect(result.companies.taebaek).toMatchObject({fullHistoryEquivalent:true,transactionWindowEquivalent:true});
 });
 it('유한한 음수 수량은 업무 오류로 임의 거절하지 않는다',()=>{expect(()=>classify({...input,palletTransactions:[{...input.palletTransactions[0],quantity:-1}]})).not.toThrow();});
 it('팔레트 원문은 typed REST와 나노초 버전을 보존하고 잘린 응답은 거절한다',()=>{
  const document={name:'projects/taebaek-3abe4/databases/(default)/documents/pallets/p',fields:{name:{stringValue:'합성'},inUse:{integerValue:'2'}},updateTime:'2026-10-15T00:00:00.123456789Z'};const parsed=parseResponse([{document,readTime:'2026-10-15T00:00:01Z'}],'pallets');expect(parsed.originals).toEqual([document]);expect(parsed.rows[0].inUse).toBe(2);expect(()=>parseResponse([{document}],'pallets')).toThrow();expect(()=>parseResponse([{readTime:'2026-10-15T00:00:00Z',skippedResults:1}],'pallets')).toThrow();expect(()=>parseResponse([{document:{...document,fields:{name:{stringValue:'x',integerValue:'1'}}},readTime:'2026-10-15T00:00:00Z'}],'pallets')).toThrow();
 });
 it('정상 빈 응답은 허용하되 무응답·다른 경로·부분 실패는 거절한다',()=>{
  expect(parseResponse([{readTime:'2026-10-15T00:00:00Z'}],'pallets').rows).toEqual([]);expect(()=>parseResponse([],'pallets')).toThrow();expect(()=>parseResponse([{error:{message:'원문'}}],'pallets')).toThrow();expect(()=>parseResponse([{document:{name:'projects/other/databases/(default)/documents/pallets/p',updateTime:'2026-10-15T00:00:00Z'},readTime:'2026-10-15T00:00:00Z'}],'pallets')).toThrow();
 });
 it('고정 프로젝트 네 컬렉션의 읽기 요청만 보내고 실패 시 반환하지 않는다',async()=>{
  const calls:string[]=[];const transport=async(url:any,init:any)=>{calls.push(String(url));expect(init.method).toBe('POST');expect(init.redirect).toBe('error');const query=JSON.parse(init.body).structuredQuery;expect(['pallets','partners','orders','palletTransactions']).toContain(query.from[0].collectionId);return {ok:true,json:async()=>[{readTime:'2026-10-15T00:00:00Z'}]};};expect(Object.keys(await readAll('합성',transport as any))).toHaveLength(4);expect(calls.every(url=>url==='https://firestore.googleapis.com/v1/projects/taebaek-3abe4/databases/(default)/documents:runQuery')).toBe(true);await expect(readAll('합성',(async()=>({ok:false}))as any)).rejects.toThrow();
 });
 it('자체검증은 인증·운영출력 없이 실행하고 다른 인수는 거절한다',()=>{expect(selfCheck()).toEqual({selfCheck:'passed',productionRead:false,productionOutputWritten:false});expect(()=>paths(['--apply'])).toThrow();});
});
