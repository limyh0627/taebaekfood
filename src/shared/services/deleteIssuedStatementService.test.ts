import {beforeEach,it,expect,vi} from 'vitest';
import {webcrypto,createHash} from 'node:crypto';
import {deleteIssuedStatement} from './deleteIssuedStatementService';
const state=vi.hoisted(()=>({docs:new Map<string,any>(),saved:new Map<string,string>(),calls:[] as any[],mode:'success',claim:'taebaek',uid:'uid',gate:undefined as Promise<void>|undefined,onRead:undefined as ((path:string)=>void)|undefined}));
vi.mock('../firebase',()=>({db:{},functions:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:state.uid,getIdTokenResult:async()=>({claims:{companyId:state.claim,isAdmin:true}})};}}}));
vi.mock('firebase/firestore',()=>({doc:(_:unknown,col:string,id:string)=>`${col}/${id}`,getDoc:async(path:string)=>{state.onRead?.(path);return {exists:()=>state.docs.has(path),data:()=>state.docs.get(path)};}}));
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
vi.mock('firebase/functions',()=>({httpsCallable:()=>async(input:any)=>{
 state.calls.push(structuredClone(input));await state.gate;
 if(state.mode==='unknown')throw new Error('응답 유실');
 const before=state.docs.get('issuedStatements/s1');
 const receipt={companyId:'taebaek',createdBy:'uid',kind:'issuedStatements',action:'delete',status:'applied',voucherId:'s1',command:input,requestHash:hash({companyId:'taebaek',actorId:'uid',...input}),beforeSnapshot:before,beforeHash:before?hash(before):null,afterHash:null};
 if(state.mode==='rejected'){state.docs.set(`voucherMutationOperations/${input.operationId}`,{...receipt,status:'rejected',failureCode:'failed-precondition',failureMessage:'전표 변경'});throw new Error('전표 변경');}
 if(before){state.docs.set(`voucherMutationOperations/${input.operationId}`,receipt);state.docs.delete('issuedStatements/s1');}
 if(state.mode==='tampered')state.docs.get(`voucherMutationOperations/${input.operationId}`).createdBy='foreign';
 if(state.mode==='tamperedCommand')state.docs.get(`voucherMutationOperations/${input.operationId}`).command={...input,expectedRevision:99};
 if(state.mode==='lateActor')state.uid='other';
 if(state.mode==='changedSaved')state.saved.set('statement-delete:taebaek:uid:s1','다른 요청');
 if(state.mode==='lostSuccess')throw new Error('응답 유실');return {data:{status:'applied'}};
}}));
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('localStorage',{getItem:(key:string)=>state.saved.get(key)??null,setItem:(key:string,value:string)=>state.saved.set(key,value),removeItem:(key:string)=>state.saved.delete(key)});state.docs.clear();state.saved.clear();state.calls=[];state.claim='taebaek';state.uid='uid';state.mode='success';state.gate=undefined;state.onRead=undefined;state.docs.set('issuedStatements/s1',{companyId:'taebaek',partnerId:'p',docNo:'261008-001',amount:100});state.docs.set('appMeta/releaseCutover',{status:'active',releaseId:'release'});});
it('서버 명령 성공 감사를 확인한 뒤에만 보관 요청을 지운다',async()=>{await deleteIssuedStatement('taebaek','s1');expect(state.calls).toHaveLength(1);expect(state.saved.size).toBe(0);expect(state.docs.has('issuedStatements/s1')).toBe(false);});
it('알 수 없는 실패는 원문 요청을 보존하고 동일 작업으로 재시도한다',async()=>{state.mode='unknown';await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('유실');const original=JSON.stringify(state.calls[0]);expect(state.saved.size).toBe(1);state.mode='success';await deleteIssuedStatement('taebaek','s1');expect(JSON.stringify(state.calls[1])).toBe(original);expect(state.saved.size).toBe(0);});
it('성공 응답 유실은 같은 소유 감사가 있을 때만 완료로 확인한다',async()=>{state.mode='lostSuccess';await deleteIssuedStatement('taebaek','s1');expect(state.saved.size).toBe(0);state.docs.set('issuedStatements/s1',{companyId:'taebaek'});state.mode='tampered';await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('감사');expect(state.saved.size).toBe(1);});
it('다른 회사·손상 보관 요청은 서버에 보내지 않는다',async()=>{await expect(deleteIssuedStatement('punghoe','s1')).rejects.toThrow('권한');state.saved.set('statement-delete:taebaek:uid:s1','null');await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('손상');expect(state.calls).toEqual([]);});
it('확정 사전 거절은 원 요청 감사를 확인한 뒤 해제하고 새 원문·새 ID로 시도한다',async()=>{state.mode='rejected';await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('전표 변경');expect(state.saved.size).toBe(0);const first=state.calls[0];state.docs.get('issuedStatements/s1').amount=200;state.mode='success';await deleteIssuedStatement('taebaek','s1');expect(state.calls[1].operationId).not.toBe(first.operationId);expect(state.calls[1].expectedOriginalHash).not.toBe(first.expectedOriginalHash);});
it('전체 command가 다른 감사는 보관 요청을 해제하지 않는다',async()=>{state.mode='tamperedCommand';await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('감사');expect(state.saved.size).toBe(1);});
it('동시 fresh 요청은 원문 읽기·서버 호출을 한 번만 한다',async()=>{let release!:()=>void;state.gate=new Promise<void>(resolve=>{release=resolve;});const first=deleteIssuedStatement('taebaek','s1');await vi.waitFor(()=>expect(state.calls).toHaveLength(1));await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('삭제 중');release();await first;expect(state.calls).toHaveLength(1);});
it('늦은 다른 사용자 응답은 이전 보관 요청을 지우지 않는다',async()=>{state.mode='lateActor';await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('만료');expect(state.saved.size).toBe(1);});
it('원문 조회 뒤 회사가 바뀌면 요청을 보관하거나 호출하지 않는다',async()=>{state.onRead=path=>{if(path==='issuedStatements/s1')state.claim='punghoe';};await expect(deleteIssuedStatement('taebaek','s1')).rejects.toThrow('권한');expect(state.calls).toEqual([]);expect(state.saved.size).toBe(0);});
it('같은 키에 새 요청이 있으면 오래된 완료가 삭제하지 않는다',async()=>{state.mode='changedSaved';await deleteIssuedStatement('taebaek','s1');expect(state.saved.get('statement-delete:taebaek:uid:s1')).toBe('다른 요청');});
