import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({calls:[] as Array<{name:string;clauses:Array<{field:string;op:string;value:unknown}>}>,responses:[] as Array<Array<{id:string;value:Record<string,unknown>}>>}));
vi.mock('../firebase',()=>({db:{},auth:{currentUser:null},authReady:Promise.resolve(),functions:undefined}));
vi.mock('firebase/firestore',async importOriginal=>({...await importOriginal<typeof import('firebase/firestore')>(),collection:(_db:unknown,name:string)=>name,where:(field:string,op:string,value:unknown)=>({field,op,value}),query:(name:string,...clauses:Array<{field:string;op:string;value:unknown}>)=>({name,clauses}),getDocs:async(query:typeof state.calls[number])=>{state.calls.push(query);return{docs:(state.responses.shift()??[]).map(row=>({id:row.id,data:()=>row.value}))};}}));
import {fetchWhereIn} from './firebaseService';
beforeEach(()=>{state.calls=[];state.responses=[];});
it('빈 값은 DB 조회를 하지 않는다',async()=>{expect(await fetchWhereIn('orders','status',[],'taebaek')).toEqual([]);expect(state.calls).toEqual([]);});
it('중복 입력을 제거하고 매 30개 질의에 회사 조건을 함께 넣는다',async()=>{
 const values=Array.from({length:31},(_,i)=>'state-'+i);state.responses=[[{id:'same',value:{version:1}},{id:'first',value:{version:1}}],[{id:'same',value:{version:2}},{id:'last',value:{version:2}}]];
 const rows=await fetchWhereIn<{id:string;version:number}>('orders','status',[...values,values[0]],'punghoe');
 expect(state.calls).toHaveLength(2);for(const call of state.calls){expect(call.name).toBe('orders');expect(call.clauses).toContainEqual({field:'companyId',op:'==',value:'punghoe'});}
 expect(state.calls.map(call=>call.clauses.find(c=>c.field==='status')?.value)).toEqual([values.slice(0,30),values.slice(30)]);
 expect(rows).toEqual([{id:'same',version:2},{id:'first',version:1},{id:'last',version:2}]);
});
