import {expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {Timestamp} from 'firebase-admin/firestore';
import {parseFullResponse,decodeRestValue,backupText,options,readFullItems,runDry,selfCheck} from './prepare-zero-item-price-dry-20261015.mts';
import {decode,hash} from './shared/zeroItemPriceBackup.ts';
import {checkPlan} from './shared/zeroItemPriceMigration.ts';

const root='projects/taebaek-3abe4/databases/(default)/documents/',stamp='2026-10-15T01:02:03.123456789Z';
const document=(id='SECRET_ID',fields:Record<string,unknown>={price:{integerValue:'0'},name:{stringValue:'SECRET_NAME'},cost:{doubleValue:-0},nested:{mapValue:{fields:{createdAt:{timestampValue:stamp},amount:{integerValue:'7'}}}}})=>({document:{name:root+'items/'+id,fields,updateTime:stamp,createTime:stamp},readTime:stamp});
const args=(company='taebaek')=>['--auth=firebase-cli','--company='+company,'--backup='+resolve(`work/zero-item-price-${company}-20261015.json`)];

it('전체 필드 REST 원문·Timestamp/ns·원가를 보존한 계획은 기존 codec과 checkPlan으로 읽힌다',()=>{
 const parsed=parseFullResponse([document(),{done:true}]);const original=structuredClone(parsed.documents[0].data);const prepared=backupText('taebaek',parsed.documents),restored=decode(JSON.parse(prepared.text));
 expect(()=>checkPlan(restored.plan)).not.toThrow();expect(hash(restored.plan)).toBe(prepared.planHash);expect(restored.planHash).toBe(prepared.planHash);
 expect(restored.plan.documents[0].before).toEqual(parsed.documents[0].data);expect(restored.plan.documents[0].after).toEqual(expect.objectContaining({name:'SECRET_NAME',nested:parsed.documents[0].data.nested}));expect(restored.plan.documents[0].after).not.toHaveProperty('price');
 expect(restored.plan.documents[0].version.nanoseconds).toBe(123456789);expect(restored.plan.documents[0].before.nested.createdAt).toBeInstanceOf(Timestamp);expect(Object.is(restored.plan.documents[0].before.cost,-0)).toBe(true);
 expect(structuredClone(parsed.documents[0].data)).toEqual(original);expect(prepared.documents).toBe(1);
});

it('unsupported 참조·좌표·bytes·unsafe정수·예약키를 손실형 JSON으로 바꾸지 않는다',()=>{
 for(const value of [{referenceValue:root+'items/SECRET'},{geoPointValue:{latitude:1,longitude:2}},{bytesValue:'YQ=='},{integerValue:'9007199254740993'},{mapValue:{fields:{__zeroMigrationType:{stringValue:'SECRET'}}}},{doubleValue:'0'},{nullValue:0},{unknownValue:'SECRET'}])expect(()=>decodeRestValue(value)).toThrow();
 for(const type of ['referenceValue','geoPointValue','bytesValue'])expect(()=>parseFullResponse([document('valid'),document('bad',{price:{integerValue:'1'},bad:{[type]:'SECRET'}})])).toThrow();
});

it('부분·오류·중복·타collection·version오류는 전체 백업 생성 전에 거절한다',()=>{
 for(const response of [[],[{error:{message:'SECRET_ERROR'}}],[{done:true}],[{readTime:stamp,skippedResults:1}],[document(),document()],
  [{...document(),document:{...document().document,name:root+'partners/a'}}],
  [{...document(),document:{...document().document,updateTime:'2026-02-30T00:00:00Z'}}],
  [{done:true},document()]])expect(()=>parseFullResponse(response)).toThrow();
 expect(parseFullResponse([{readTime:stamp},{done:true}]).documents).toEqual([]);
});

it('전체 원함수 회사 선정과 450 한도를 적용하고 -0·다른 회사는 계획에 넣지 않는다',()=>{
 const rows=parseFullResponse([document('a',{price:{doubleValue:0}}),document('b',{companyId:{stringValue:'punghoe'},price:{doubleValue:0}}),document('c',{price:{doubleValue:-0}})]).documents;
 expect(backupText('taebaek',rows).documents).toBe(1);expect(backupText('punghoe',rows).documents).toBe(1);
 expect(()=>backupText('taebaek',Array.from({length:451},(_,i)=>({...rows[0],id:String(i)})))).toThrow('한도');
});

it('고정 fullREST query에는 projection·쓰기·다른 project가 없다',async()=>{
 const transport=vi.fn().mockResolvedValue({ok:true,json:async()=>[document()]});await readFullItems('SECRET_TOKEN',transport);
 const [url,request]=transport.mock.calls[0];expect(url).toBe('https://firestore.googleapis.com/v1/'+root.slice(0,-1)+':runQuery');expect(JSON.parse(request.body)).toEqual({structuredQuery:{from:[{collectionId:'items',allDescendants:false}]}});expect(request.redirect).toBe('error');
 await expect(readFullItems('SECRET',async()=>({ok:false,json:async()=>[]}))).rejects.toThrow();
});

it('회사별 고정 출력·기존 파일·applyundo는 인증 전에 거절한다',async()=>{
 const token=vi.fn(),read=vi.fn(),write=vi.fn();
 for(const input of [['--apply'],[...args(),'--undo'],args('invalid'),['--auth=auto',...args().slice(1)],[...args().slice(0,2),args('punghoe')[2]]])await expect(runDry(input,{exists:()=>false,token,read,write})).rejects.toThrow();
 await expect(runDry(args(),{exists:()=>true,token,read,write})).rejects.toThrow();expect(token).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 expect(options(args('punghoe'),()=>false).company).toBe('punghoe');
});

it('완전 원문/계획 검증 뒤에만 단일 백업을 쓰고 요약에는 ID·이름·가격을 넣지 않는다',async()=>{
 const token=vi.fn().mockResolvedValue('SECRET_TOKEN'),read=vi.fn().mockResolvedValue(parseFullResponse([document()])),write=vi.fn();
 const summary=await runDry(args(),{exists:()=>false,token,read,write});expect(write).toHaveBeenCalledOnce();expect(summary.writes).toBe(0);expect(summary.documents).toBe(1);expect(JSON.stringify(summary)).not.toContain('SECRET');
 const saved=decode(JSON.parse(write.mock.calls[0][1]));expect(()=>checkPlan(saved.plan)).not.toThrow();expect(saved.plan.documents[0].before.name).toBe('SECRET_NAME');
 write.mockClear();read.mockRejectedValue(Error('SECRET_ERROR'));await expect(runDry(args(),{exists:()=>false,token,read,write})).rejects.toThrow();expect(write).not.toHaveBeenCalled();
 read.mockResolvedValue({documents:[{...parseFullResponse([document()]).documents[0],data:{price:0,__zeroMigrationType:'SECRET'}}],readTimes:[stamp]});await expect(runDry(args(),{exists:()=>false,token,read,write})).rejects.toThrow();expect(write).not.toHaveBeenCalled();
});

it('독립 self-check는 실제 인증·통신·출력을 수행하지 않는다',()=>{expect(selfCheck()).toEqual({selfCheck:'passed',productionRead:false,productionOutputWritten:false});});

it('명시 v2 dry는 원본 파일을 바꾸지 않고 새 경로만 쓰며 같은 revision 덮어쓰기는 인증 전에 막는다',async()=>{
 const original=args()[2].slice('--backup='.length),next=original.replace(/\.json$/,'-v2.json'),files=new Map([[original,'SYNTHETIC_ORIGINAL_BYTES']]);
 const token=vi.fn().mockResolvedValue('SYNTHETIC'),read=vi.fn().mockResolvedValue(parseFullResponse([document()])),write=vi.fn((path:string,text:string)=>{if(files.has(path))throw Error('exists');files.set(path,text);});
 const input=[...args().slice(0,2),'--backup='+next];await runDry(input,{exists:path=>files.has(String(path)),token,read,write});expect(files.get(original)).toBe('SYNTHETIC_ORIGINAL_BYTES');expect(files.has(next)).toBe(true);
 token.mockClear();await expect(runDry(input,{exists:path=>files.has(String(path)),token,read,write})).rejects.toThrow();expect(token).not.toHaveBeenCalled();
});
