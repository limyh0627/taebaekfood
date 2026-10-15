import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,deleteDoc} from 'firebase/firestore';
const gateway=vi.hoisted(()=>({db:undefined as any,setCalls:0,loseResponse:false}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},authReady:Promise.resolve(),functions:undefined,auth:{currentUser:{uid:'partner-registration-sdk',getIdTokenResult:async()=>({claims:{companyId:'taebaek',employeeId:'partner-registration-sdk',isAdmin:true}})}}}));
vi.mock('firebase/firestore',async original=>{const actual=await original<typeof import('firebase/firestore')>();return {...actual,runTransaction:async(database:any,callback:any,options:any)=>{const result=await actual.runTransaction(database,tx=>callback(new Proxy(tx,{get(target,key){if(key==='set')return (...args:any[])=>{gateway.setCalls++;return (target.set as any)(...args);};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}})),options);if(gateway.loseResponse){gateway.loseResponse=false;throw Error('실제 commit 뒤 합성 응답 유실');}return result;}};});
import {addItem} from './firebaseService';
const option={partnerRegistration:true} as const;
// 실제 Firestore SDK와 Rules 인증 문맥이며 Auth 서버 로그인 시험은 아니다.
describe.skipIf(process.env.PARTNER_REGISTRATION_EMULATOR_TEST!=='true')('거래처 안정 등록 실제 SDK',()=>{
 let env:RulesTestEnvironment;const paths=new Set<string>(),projectId='demo-partner-registration-'+randomUUID().slice(0,12);
 beforeAll(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('등록된 로컬 주소만 사용합니다.');env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});gateway.db=env.authenticatedContext('partner-registration-sdk',{companyId:'taebaek',employeeId:'partner-registration-sdk',isAdmin:true}).firestore();},30000);
 beforeEach(()=>{gateway.setCalls=0;gateway.loseResponse=false;});
 afterAll(async()=>{if(!env)return;try{await env.withSecurityRulesDisabled(async ctx=>{for(const path of paths)await deleteDoc(doc(ctx.firestore(),path));});}finally{await env.cleanup();}},30000);
 function input(){const id='c-registration-'+randomUUID();paths.add('partners/'+id);return {id,name:'합성 거래처',type:'일반',partnerType:'매출처',defaultShipMethod:'수령',shipTos:[{id:'s',name:'합성 창고',defaultShipMethod:'화물'}]};}
 async function raw(id:string){let result:any;await env.withSecurityRulesDisabled(async ctx=>{result=(await getDoc(doc(ctx.firestore(),'partners',id))).data();});return result;}
 async function patch(id:string,data:any){await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'partners',id),data,{merge:true}));}
 it('첫 등록 이후 같은 요청은 실제 tx.set 없이 같은 ID로 끝난다',async()=>{const data=input();expect(await addItem('partners',data,option)).toBe(data.id);expect(gateway.setCalls).toBe(1);gateway.setCalls=0;expect(await addItem('partners',data,option)).toBe(data.id);expect(gateway.setCalls).toBe(0);expect(await raw(data.id)).toMatchObject({companyId:'taebaek',defaultShipMethod:'수령'});});
 it('실제 commit 뒤 합성 응답 유실에도 재시도는 쓰지 않는다',async()=>{const data=input();gateway.loseResponse=true;await expect(addItem('partners',data,option)).rejects.toThrow('응답 유실');gateway.setCalls=0;expect(await addItem('partners',data,option)).toBe(data.id);expect(gateway.setCalls).toBe(0);});
 it('다른 담당자가 추가한 최상위 필드를 보존한다',async()=>{const data=input();await addItem('partners',data,option);await patch(data.id,{staffMemo:'추가 메모'});gateway.setCalls=0;await addItem('partners',data,option);expect(gateway.setCalls).toBe(0);expect((await raw(data.id)).staffMemo).toBe('추가 메모');});
 it('다른 담당자의 변경과 중첩 변경을 현재 snapshot으로 알린다',async()=>{const data=input();await addItem('partners',data,option);await patch(data.id,{defaultShipMethod:'택배',id:'spoofed'});gateway.setCalls=0;await expect(addItem('partners',data,option)).rejects.toMatchObject({code:'partner-registration-conflict',partnerId:data.id,existingPartner:{id:data.id,defaultShipMethod:'택배'}});expect(gateway.setCalls).toBe(0);expect((await raw(data.id)).defaultShipMethod).toBe('택배');await patch(data.id,{defaultShipMethod:'수령',shipTos:[{...data.shipTos[0],name:'변경 창고'}]});await expect(addItem('partners',data,option)).rejects.toMatchObject({code:'partner-registration-conflict'});});
 it('동시에 같은 ID를 등록해도 양쪽 결과와 한 문서가 일치한다',async()=>{const data=input();expect(await Promise.all([addItem('partners',data,option),addItem('partners',data,option)])).toEqual([data.id,data.id]);expect(await raw(data.id)).toMatchObject({name:data.name,defaultShipMethod:'수령'});},15000);
 it('다른 회사 문서는 원문을 노출하거나 덮지 않는다',async()=>{const data=input();await patch(data.id,{companyId:'punghoe',name:'다른 회사 합성'});try{await addItem('partners',data,option);throw Error('미발생');}catch(error){expect(error).not.toHaveProperty('existingPartner');expect(String(error)).not.toContain('다른 회사 합성');}expect(await raw(data.id)).toMatchObject({companyId:'punghoe',name:'다른 회사 합성'});expect(gateway.setCalls).toBe(0);});
});
