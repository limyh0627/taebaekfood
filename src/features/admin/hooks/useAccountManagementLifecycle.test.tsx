// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAccountManagementLifecycle, type AccountManagementLifecycleOptions } from './useAccountManagementLifecycle';
import { useAccountManagementEditor } from './useAccountManagementEditor';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import type { AccountCode } from '../../../shared/types';
import type { AccountOperationReferenceEntry, AccountManagementReference } from '../infrastructure/accountManagementWrites';
const auth=vi.hoisted(()=>({currentUser:{uid:'A'}}));vi.mock('../../../shared/firebase',()=>({auth}));
type AddCode=NonNullable<AccountManagementLifecycleOptions['onAddCode']>;
const code:AccountCode={id:'old',code:'500',name:'이름'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{auth.currentUser.uid='A';});
function fill(api:ReturnType<typeof useAccountManagementLifecycle>){api.newCode();api.changeCode({code:'501',name:'원문',groupId:'g'});}
it('새 작성에 고정 ID를 한 번 만들고 ACK 전 중복송신·초안정리를 하지 않는다',async()=>{
 const gate=deferred<SaveOutcome>(),save=vi.fn<AddCode>(()=>gate.promise);const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:save}));act(()=>fill(result.current));const id=result.current.codeSession!.id;expect(id).toMatch(/^ac-/);let run!:Promise<boolean>;act(()=>{run=result.current.save();});await act(()=>result.current.save());act(()=>result.current.changeCode({name:'변경'}));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toEqual({id,code:'501',name:'원문',groupId:'g'});expect(result.current.codeSession?.draft.name).toBe('원문');await act(async()=>{gate.resolve({status:'saved'});await run;});expect(result.current.codeSession).toBeNull();
});
it('등록필수값은 기존대로 검사하고 normalBalance를 새 필수로 요구하지 않는다',async()=>{
 const save=vi.fn<AddCode>().mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:save,onAddGroup:async()=>({status:'saved'})}));act(()=>{result.current.newCode();result.current.changeCode({name:'이름'});});await act(()=>result.current.save());expect(save).not.toHaveBeenCalled();act(()=>{result.current.changeCode({code:'501'});});await act(()=>result.current.save());expect(save).toHaveBeenCalledOnce();act(()=>{result.current.newGroup();result.current.changeGroup({name:'비용',type:'비용'});});await act(()=>result.current.save());expect(result.current.error).toContain('손익 줄');
});
it('unknown 제출은 닫기·새 작성 뒤에도 같은 원문으로 남고 재송신하지 않는다',async()=>{
 const save=vi.fn<AddCode>().mockResolvedValueOnce({status:'unknown',message:'lost',nextAction:'목록 확인'}).mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:save}));act(()=>fill(result.current));const id=result.current.codeSession!.id;await act(()=>result.current.save());expect(result.current.codeSession?.unknown).toBe(true);await act(()=>result.current.save());expect(save).toHaveBeenCalledOnce();act(()=>{result.current.closeDraft();fill(result.current);result.current.changeCode({name:'다른 작성'});});expect(result.current.codeSession!.id).not.toBe(id);expect(result.current.unknownOperations).toHaveLength(1);expect(result.current.unknownOperations[0]).toMatchObject({targetId:id,name:'원문',submitted:{id,code:'501',name:'원문',groupId:'g'}});expect(result.current.unknownOperations[0].message).toContain('두 건');await act(()=>result.current.save());expect(result.current.unknownOperations).toHaveLength(1);
});
it('partial 주업무 ACK는 입력종료·밖안내 유지·업무재송신0이다',async()=>{
 const save=vi.fn<AddCode>(async data=>({status:'partial',reason:'followup-unconfirmed',committedIds:[data.id],unconfirmedIds:[],message:'등록 완료',nextAction:'새로고침해 주세요.'}));const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:save}));act(()=>fill(result.current));await act(()=>result.current.save());expect(result.current.codeSession).toBeNull();expect(result.current.message).toContain('새로고침');expect(result.current.unknownOperations).toHaveLength(0);await act(()=>result.current.save());expect(save).toHaveBeenCalledOnce();
});
it('callback 없음은 이유를 보여 주며 입력을 초기화하지 않는다',async()=>{
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A'}));act(()=>fill(result.current));expect(result.current.blockedReason).toContain('연결되지');await act(()=>result.current.save());expect(result.current.codeSession?.draft.name).toBe('원문');
});
it('삭제 미확정은 자동 재삭제0·닫은 뒤에도 원대상 기록을 남긴다',async()=>{
 const remove=vi.fn(async():Promise<SaveOutcome>=>({status:'unknown',message:'lost',nextAction:'목록 확인'}));const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onDeleteCode:remove}));await act(()=>result.current.deleteCode(code));await act(()=>result.current.deleteCode(code));expect(remove).toHaveBeenCalledOnce();act(()=>result.current.closeDelete());expect(result.current.unknownOperations[0]).toMatchObject({kind:'delete-code',targetId:'old',name:'이름',submitted:null});
});
it('UID 변경은 안내를 숨기고 복귀 때 다시 보여 준다',async()=>{
 const {result,rerender}=renderHook(({uid})=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:uid,onAddCode:async()=>({status:'unknown',message:'lost',nextAction:'목록 확인'})}),{initialProps:{uid:'A'}});act(()=>fill(result.current));await act(()=>result.current.save());auth.currentUser.uid='B';rerender({uid:'B'});expect(result.current.unknownOperations).toHaveLength(0);expect(result.current.codeSession).toBeNull();auth.currentUser.uid='A';rerender({uid:'A'});expect(result.current.unknownOperations).toHaveLength(1);
});
it('명시 닫고 새 작성 뒤 old ACK는 새 초안을 지우지 않는다',async()=>{
 const gate=deferred<SaveOutcome>();const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:()=>gate.promise}));act(()=>fill(result.current));let run!:Promise<boolean>;act(()=>{run=result.current.save();});act(()=>{result.current.closeDraft();fill(result.current);result.current.changeCode({name:'새 초안'});});await act(async()=>{gate.resolve({status:'saved'});await run;});expect(result.current.codeSession?.draft.name).toBe('새 초안');
});
it.each(['edit-first','create-first'] as const)('16편집과 등록은 같은 tick 양방향 busy로 차단한다: %s',async direction=>{
 let lifecycleBusy=()=>false;const editGate=deferred<SaveOutcome>(),createGate=deferred<SaveOutcome>();const editWrite=vi.fn(async()=>editGate.promise),createWrite=vi.fn<AddCode>(()=>createGate.promise);
 const {result}=renderHook(()=>{const editor=useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:editWrite,isOtherBusy:()=>lifecycleBusy()});const lifecycle=useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:createWrite,isOtherBusy:editor.isBusy});lifecycleBusy=lifecycle.isBusy;return{editor,lifecycle};});
 act(()=>{result.current.editor.openCode(code);result.current.editor.changeCode({name:'편집'});fill(result.current.lifecycle);});let run!:Promise<boolean>;
 act(()=>{if(direction==='edit-first'){run=result.current.editor.save();void result.current.lifecycle.save();}else{run=result.current.lifecycle.save();void result.current.editor.save();}});
 expect(editWrite).toHaveBeenCalledTimes(direction==='edit-first'?1:0);expect(createWrite).toHaveBeenCalledTimes(direction==='create-first'?1:0);
 await act(async()=>{editGate.resolve({status:'saved'});createGate.resolve({status:'saved'});await run;});
});

it('옛 UID의 늦은 미확정과 finally는 새 UID 초안·busy를 건드리지 않는다',async()=>{
 const old=deferred<SaveOutcome>(),fresh=deferred<SaveOutcome>(),save=vi.fn<AddCode>().mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>fresh.promise);
 const {result,rerender}=renderHook(({uid})=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:uid,onAddCode:save}),{initialProps:{uid:'A'}});act(()=>fill(result.current));let a!:Promise<boolean>,b!:Promise<boolean>;act(()=>{a=result.current.save();});auth.currentUser.uid='B';rerender({uid:'B'});act(()=>{fill(result.current);result.current.changeCode({name:'B초안'});});act(()=>{b=result.current.save();});
 await act(async()=>{old.resolve({status:'unknown',message:'A결과미확인',nextAction:'확인'});await a;});expect(result.current.busy).toBe(true);expect(result.current.error).toBe('');expect(result.current.codeSession?.draft.name).toBe('B초안');expect(result.current.unknownOperations).toHaveLength(0);
 await act(async()=>{fresh.resolve({status:'saved'});await b;});auth.currentUser.uid='A';rerender({uid:'A'});expect(result.current.unknownOperations[0].name).toBe('원문');
});
const pendingRef: AccountManagementReference = { companyId: 'taebaek', planId: 'stored-plan', kind: 'code', targetId: 'stored-code' };
it('typed 송신 중 닫은 뒤 미확정은 영속 참조를 다시 읽고 새 초안을 보존한다',async()=>{
 const gate=deferred<SaveOutcome>();let entries:AccountOperationReferenceEntry[]=[];
 const read=vi.fn(async()=>entries);
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onReadAccountOperations:read,onAddCode:()=>gate.promise}));
 await act(async()=>{await Promise.resolve();});act(()=>fill(result.current));let run!:Promise<boolean>;act(()=>{run=result.current.save();});
 act(()=>{result.current.closeDraft();fill(result.current);result.current.changeCode({name:'다른 새 초안'});});
 entries=[{key:'stored-key',reference:pendingRef,status:'valid',description:'등록 · 원문'}];
 await act(async()=>{gate.resolve({status:'unknown',message:'처리 확인 중',nextAction:'결과 확인'});await run;});
 expect(result.current.operationReferences).toEqual(entries);expect(result.current.codeSession?.draft.name).toBe('다른 새 초안');expect(result.current.unknownOperations).toHaveLength(0);
});
it('영속 inspect 완료는 새 폼을 닫지 않고 명시 완료 안내를 남긴다',async()=>{
 const inspect=vi.fn<NonNullable<AccountManagementLifecycleOptions['onInspectAccountOperation']>>(async()=>({status:'saved'}));
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onReadAccountOperations:async()=>[],onInspectAccountOperation:inspect}));
 act(()=>fill(result.current));await act(()=>result.current.inspectOperation(pendingRef));expect(inspect.mock.calls[0][0]).toEqual(pendingRef);expect(result.current.message).toContain('처리 완료');expect(result.current.codeSession).not.toBeNull();
});
it('복구 목록 read 실패는 재조회로 회복하고 매 렌더 callback 변경이 반복 조회를 만들지 않는다',async()=>{
 let count=0;const {result,rerender}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onReadAccountOperations:async()=>{count++;if(count===1)throw Error('storage');return[];}}));
 await act(async()=>{await Promise.resolve();});expect(result.current.error).toContain('읽지 못했습니다');rerender();expect(count).toBe(1);await act(()=>result.current.refreshOperations());expect(count).toBe(2);expect(result.current.error).toBe('');
});
it('사본 정리 saved는 업무 ACK로 오판하지 않고 새 초안을 보존한다',async()=>{
 const discard=vi.fn<NonNullable<AccountManagementLifecycleOptions['onDiscardAccountOperationCopy']>>(async()=>({status:'saved'}));
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onDiscardAccountOperationCopy:discard,onReadAccountOperations:async()=>[]}));
 act(()=>fill(result.current));await act(()=>result.current.discardOperation(pendingRef,'관측 원문'));
 expect(discard.mock.calls[0].slice(0,2)).toEqual([pendingRef,'관측 원문']);expect(result.current.codeSession).not.toBeNull();expect(result.current.message).toContain('사본만 정리');expect(result.current.message).toContain('업무는 취소하거나 변경하지 않았습니다');
});
it('같은 plan의 등록 적용 완료 확인은 해당 미확정 초안과 안내만 종료한다',async()=>{
 const save=vi.fn<AddCode>().mockResolvedValue({status:'unknown',message:'확인중',nextAction:'결과 확인'});
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onAddCode:save,onReadAccountOperations:async()=>[],onInspectAccountOperation:async()=>({status:'saved'})}));
 act(()=>fill(result.current));await act(()=>result.current.save());const data=save.mock.calls[0][0],context=save.mock.calls[0][1];
 expect(result.current.codeSession?.unknown).toBe(true);await act(()=>result.current.inspectOperation({companyId:'taebaek',kind:'code',targetId:data.id,planId:context.planId}));
 expect(result.current.codeSession).toBeNull();expect(result.current.unknownNotice).toBe('');expect(result.current.message).toContain('처리 완료');
});
it('같은 삭제 plan의 중단 ACK는 대상 잠금만 끝내고 다른 신규 초안을 보존한다',async()=>{
 const remove=vi.fn<NonNullable<AccountManagementLifecycleOptions['onDeleteCode']>>().mockResolvedValue({status:'unknown',message:'확인중',nextAction:'결과 확인'});
 const {result}=renderHook(()=>useAccountManagementLifecycle({companyId:'taebaek',actorUid:'A',onDeleteCode:remove,onReadAccountOperations:async()=>[],onCancelAccountOperation:async()=>({status:'cancelled',message:'미처리 요청을 중단했습니다.'})}));
 await act(()=>result.current.deleteCode(code));const original=result.current.deleteSession!;act(()=>fill(result.current));
 await act(()=>result.current.cancelOperation({companyId:'taebaek',kind:'code',targetId:original.id,planId:original.planId}));
 expect(result.current.deleteSession).toBeNull();expect(result.current.codeSession?.draft.name).toBe('원문');
});
