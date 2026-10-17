import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {initializeApp,deleteApp} from 'firebase/app';
import {Timestamp,GeoPoint,Bytes,doc,getFirestore} from 'firebase/firestore';
const state=vi.hoisted(()=>({calls:[] as any[],responses:[] as {id:string;data:Record<string,unknown>}[][],error:null as Error|null,success:null as any,failure:null as any,unsubscribe:vi.fn()}));
vi.mock('../firebase',()=>({db:{},auth:{currentUser:null},authReady:Promise.resolve(),functions:undefined}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),
  collection:(_:unknown,name:string)=>name,documentId:()=>'__name__',where:(field:string,op:string,value:unknown)=>({field,op,value}),
  query:(name:string,...clauses:unknown[])=>({name,clauses}),
  getDocs:async(q:unknown)=>{state.calls.push(q);if(state.error)throw state.error;return {docs:(state.responses.shift()??[]).map(row=>({id:row.id,data:()=>row.data}))};},
  onSnapshot:(q:unknown,success:unknown,failure:unknown)=>{state.calls.push(q);state.success=success;state.failure=failure;return state.unsubscribe;},
}));
import * as direct from './firestoreReads';
import * as legacy from './firebaseService';
beforeEach(()=>{state.calls=[];state.responses=[];state.error=null;state.success=null;state.failure=null;state.unsubscribe.mockReset();});

describe('Firestore 조회 원문 추출 계약',()=>{
 it('기존 공개 경로는 래퍼 없이 같은 함수 네 개를 내보낸다',()=>{
   for(const name of ['fetchWhere','fetchWhereIn','fetchByIds','subscribeWhere'] as const)expect(legacy[name]).toBe(direct[name]);
   const source=readFileSync('src/shared/services/firestoreReads.ts','utf8');
   expect(source).not.toContain("from './firebaseService'");
 });
 it('추출 전 HEAD80682f2 함수 initializer 원문과 정확히 같다',()=>{
   const text=readFileSync('src/shared/services/firestoreReads.ts','utf8'),source=ts.createSourceFile('firestoreReads.ts',text,ts.ScriptTarget.Latest,true);
   const expected:Record<string,string>={fetchWhere:'f6e817a7306aa72710265489fb0c26f84f714e47c03e566611997e688bd6dfd0',fetchWhereIn:'4b8eb6a3e09e41c134ddc33f059780ba96a09755d4d2260546f71a0caa140d12',fetchByIds:'2007abc398539354f3295129cb1d09fea65433164f66aadddf8af6138bb861d3',subscribeWhere:'0c4f0f1d54afd220abb90ab5362dab1464c6309c64156c0c3d3ebe61ca69cdeb'};
   const found:Record<string,string>={};
   for(const statement of source.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){const name=declaration.name.getText(source);if(expected[name])found[name]=createHash('sha256').update(declaration.initializer!.getText(source).replace(/\r\n/g,'\n')).digest('hex');}
   expect(found).toEqual(expected);
 });
 it('단일 조건은 회사 조건을 더하지 않고 스냅샷 순서와 payload id·SDK 원값을 보존한다',async()=>{
   const app=initializeApp({projectId:'demo-read-preservation'},'read-preservation');
   try {
     const timestamp=Timestamp.fromMillis(1234),geo=new GeoPoint(37,127),bytes=Bytes.fromUint8Array(new Uint8Array([1,2])),reference=doc(getFirestore(app),'items','one');
     state.responses=[[{id:'sdk-id',data:{id:'stored-id',timestamp,geo,bytes,reference,nested:{timestamp}}},{id:'second',data:{value:2}}]];
     const rows=await direct.fetchWhere<any>('orders','status','ready');
     expect(state.calls).toEqual([{name:'orders',clauses:[{field:'status',op:'==',value:'ready'}]}]);
     expect(rows.map(row=>row.id)).toEqual(['stored-id','second']);
     expect(rows[0].timestamp).toBe(timestamp);expect(rows[0].geo).toBe(geo);expect(rows[0].bytes).toBe(bytes);expect(rows[0].reference).toBe(reference);expect(rows[0].nested.timestamp).toBe(timestamp);
   } finally {await deleteApp(app);}
 });
 it('in은 입력 중복 제거·30분할·원래 회사인자와 문서ID Map 갱신 순서를 보존한다',async()=>{
   const values=Array.from({length:31},(_,i)=>`value-${i}`);
   state.responses=[[{id:'one',data:{id:'payload-one',v:1}},{id:'two',data:{v:1}}],[{id:'one',data:{id:'latest-id',v:2}}]];
   expect(await direct.fetchWhereIn('orders','status',[...values,values[0]],'punghoe')).toEqual([{id:'latest-id',v:2},{id:'two',v:1}]);
   expect(state.calls.map(q=>q.clauses)).toEqual([values.slice(0,30),values.slice(30)].map(value=>[{field:'companyId',op:'==',value:'punghoe'},{field:'status',op:'in',value}]));
 });
 it('ID 조회는 빈 ID를 제거하고 결과를 요청순으로 정렬하거나 중복제거하지 않는다',async()=>{
   const ids=Array.from({length:31},(_,i)=>`id-${i}`);
   state.responses=[[{id:'z',data:{}},{id:'a',data:{}}],[{id:'z',data:{v:2}}]];
   expect(await direct.fetchByIds('orders',['',...ids,ids[0]],'taebaek')).toEqual([{id:'z'},{id:'a'},{id:'z',v:2}]);
   expect(state.calls.map(q=>q.clauses)).toEqual([ids.slice(0,30),ids.slice(30)].map(value=>[{field:'__name__',op:'in',value},{field:'companyId',op:'==',value:'taebaek'}]));
   state.calls=[];await direct.fetchByIds('orders',['one']);expect(state.calls[0].clauses).toEqual([{field:'__name__',op:'in',value:['one']}]);
 });
 it('빈 in·ID 입력은 SDK 호출 없이 빈 배열로 끝난다',async()=>{
   expect(await direct.fetchWhereIn('orders','status',[],'taebaek')).toEqual([]);expect(await direct.fetchByIds('orders',['',''])).toEqual([]);expect(state.calls).toEqual([]);
 });
 it.each(['fetchWhere','fetchWhereIn','fetchByIds'] as const)('%s는 원래 오류를 숨기거나 빈 성공으로 바꾸지 않는다',async name=>{
   state.error=new Error('조회 실패');
   const pending=name==='fetchWhere'?direct.fetchWhere('orders','status','ready'):name==='fetchWhereIn'?direct.fetchWhereIn('orders','status',['ready'],'taebaek'):direct.fetchByIds('orders',['one']);
   await expect(pending).rejects.toBe(state.error);
 });
 it('구독은 원 SDK 해지함수·순서·payload id를 유지하며 오류는 []를 알린다',()=>{
   const callback=vi.fn();const unsubscribe=direct.subscribeWhere('orders','status','ready',callback);
   expect(unsubscribe).toBe(state.unsubscribe);expect(callback).not.toHaveBeenCalled();
   state.success({docs:[{id:'sdk',data:()=>({id:'stored',v:1})},{id:'next',data:()=>({v:2})}]});
   expect(callback).toHaveBeenLastCalledWith([{id:'stored',v:1},{id:'next',v:2}]);
   state.failure(Error('권한'));expect(callback).toHaveBeenLastCalledWith([]);unsubscribe();expect(state.unsubscribe).toHaveBeenCalledOnce();
 });
});
