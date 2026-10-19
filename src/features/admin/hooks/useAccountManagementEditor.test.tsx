// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountGroup, AccountCode } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import type { AccountEditContext, AccountGroupEditPatch, AccountCodeEditPatch } from '../infrastructure/accountManagementWrites';
type Save = (id:string,patch:AccountGroupEditPatch|AccountCodeEditPatch,context:AccountEditContext)=>Promise<SaveOutcome>;
import { useAccountManagementEditor } from './useAccountManagementEditor';
const auth=vi.hoisted(()=>({currentUser:{uid:'A'}}));vi.mock('../../../shared/firebase',()=>({auth}));
const group:AccountGroup={id:'g',name:'원그룹',type:'비용',plLine:'sgna',cfSection:'operating',note:'숨김원문'};
const code:AccountCode={id:'c',code:'500',name:'원코드',groupId:'g',note:'숨김',noncash:true};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{auth.currentUser.uid='A';});
it('그룹 수정 필드만 전송하고 plLine 명시 clear만 null로 보낸다',async()=>{
 const save=vi.fn<Save>(async():Promise<SaveOutcome>=>({status:'saved'}));const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateGroup:save}));act(()=>{result.current.openGroup(group);result.current.changeGroup({plLine:''});});await act(()=>result.current.save());expect(save.mock.calls[0].slice(0,2)).toEqual(['g',{plLine:null}]);expect(result.current.groupSession).toBeNull();
});
it('미지정 plLine의 빈 표시는 dirty가 아니고 외부 원문이 초안을 덮지 않는다',async()=>{
 const save=vi.fn<Save>(async():Promise<SaveOutcome>=>({status:'saved'}));const {result,rerender}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateGroup:save}));act(()=>{result.current.openGroup({...group,plLine:undefined});result.current.changeGroup({name:'새이름'});});rerender();await act(()=>result.current.save());expect(save.mock.calls[0][1]).toEqual({name:'새이름'});
});
it('ACK 전 중복과 편집을 막고 ACK 후에만 해당 편집을 닫는다',async()=>{
 const gate=deferred<SaveOutcome>(),save=vi.fn<Save>(()=>gate.promise);const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));act(()=>{result.current.openCode(code);result.current.changeCode({name:'새코드'});});let run!:Promise<boolean>;act(()=>{run=result.current.save();});await act(()=>result.current.save());act(()=>result.current.changeCode({name:'송신중변경'}));expect(save).toHaveBeenCalledOnce();expect(result.current.codeSession?.draft.name).toBe('새코드');await act(async()=>{gate.resolve({status:'saved'});await run;});expect(result.current.codeSession).toBeNull();
});
it('unknown 뒤 원값 복귀도 송신 필드로 유지하고 명시 저장만 한다',async()=>{
 const save=vi.fn<Save>().mockResolvedValueOnce({status:'unknown',message:'응답 유실',nextAction:'현재 내용을 확인해 주세요.'}).mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateGroup:save}));act(()=>{result.current.openGroup(group);result.current.changeGroup({name:'새이름'});});await act(()=>result.current.save());expect(result.current.groupSession).not.toBeNull();expect(save).toHaveBeenCalledOnce();act(()=>result.current.changeGroup({name:'원그룹',plLine:''}));await act(()=>result.current.save());expect(save.mock.calls[1][1]).toEqual({name:'원그룹',plLine:null});
});
it('주업무 ACK 뒤 새로고침 partial은 종료하고 밖 안내만 유지해 재송신하지 않는다',async()=>{
 const save=vi.fn<Save>(async():Promise<SaveOutcome>=>({status:'partial',reason:'followup-unconfirmed',committedIds:['g'],unconfirmedIds:[],message:'그룹 저장 완료',nextAction:'화면을 다시 조회해 주세요.'}));const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateGroup:save}));act(()=>{result.current.openGroup(group);result.current.changeGroup({name:'새이름'});});await act(()=>result.current.save());expect(result.current.groupSession).toBeNull();expect(result.current.message).toContain('다시 조회');await act(()=>result.current.save());expect(save).toHaveBeenCalledOnce();
});
it('취소 뒤 새 편집에 이전 ACK를 적용하지 않는다',async()=>{
 const gate=deferred<SaveOutcome>();const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:()=>gate.promise}));act(()=>{result.current.openCode(code);result.current.changeCode({name:'옛초안'});});let run!:Promise<boolean>;act(()=>{run=result.current.save();});act(()=>{result.current.cancel();result.current.openCode({...code,id:'new'});result.current.changeCode({name:'새초안'});});await act(async()=>{gate.resolve({status:'saved'});await run;});expect(result.current.codeSession?.id).toBe('new');expect(result.current.codeSession?.draft.name).toBe('새초안');
});
it('scope 변경 뒤 old finally는 새 busy를 풀지 않는다',async()=>{
 const old=deferred<SaveOutcome>(),fresh=deferred<SaveOutcome>(),save=vi.fn<Save>().mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>fresh.promise);const {result,rerender}=renderHook(({uid})=>useAccountManagementEditor({companyId:'taebaek',actorUid:uid,onUpdateGroup:save}),{initialProps:{uid:'A'}});act(()=>{result.current.openGroup(group);result.current.changeGroup({name:'A'});});let a!:Promise<boolean>,b!:Promise<boolean>;act(()=>{a=result.current.save();});auth.currentUser.uid='B';rerender({uid:'B'});act(()=>{result.current.openGroup(group);result.current.changeGroup({name:'B'});});act(()=>{b=result.current.save();});await act(async()=>{old.resolve({status:'unknown',message:'old',nextAction:'확인'});await a;});expect(result.current.busy).toBe(true);expect(result.current.error).toBe('');await act(async()=>{fresh.resolve({status:'saved'});await b;});
});
it('그룹 이동은 동일 code patch/context 경로를 쓰며 숨김 필드는 제외한다',async()=>{
 const save=vi.fn<Save>(async():Promise<SaveOutcome>=>({status:'saved'}));const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));await act(()=>result.current.moveCodeGroup(code,'other'));expect(save.mock.calls[0].slice(0,2)).toEqual(['c',{groupId:'other'}]);expect(save.mock.calls[0][2]).toMatchObject({companyId:'taebaek',actorUid:'A'});
});
it('저장 callback이 없으면 성공으로 닫지 않고 이유를 제공한다',async()=>{
 const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A'}));act(()=>{result.current.openGroup(group);result.current.changeGroup({name:'수정'});});expect(result.current.blockedReason).toContain('연결되지');expect(result.current.canSave).toBe(false);await act(()=>result.current.save());expect(result.current.groupSession).not.toBeNull();
});

it('미확정 그룹 이동을 원래 그룹으로 되돌릴 때도 같은 필드를 명시 전송한다',async()=>{
 const save=vi.fn<Save>().mockResolvedValueOnce({status:'unknown',message:'lost',nextAction:'확인'}).mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));
 await act(()=>result.current.moveCodeGroup(code,'other'));await act(()=>result.current.moveCodeGroup(code,'g'));expect(save.mock.calls.map(call=>call[1])).toEqual([{groupId:'other'},{groupId:'g'}]);
});

it.each(['','   '])('이름이 %j인 기존 코드도 그룹만 이동할 수 있다',async name=>{
 const save=vi.fn<Save>().mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));
 await act(()=>result.current.moveCodeGroup({...code,name},'other'));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][1]).toEqual({groupId:'other'});expect(result.current.codeSession).toBeNull();
});
it('일반 코드 편집은 빈 이름 저장을 거절한다',async()=>{
 const save=vi.fn<Save>().mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));act(()=>{result.current.openCode(code);result.current.changeCode({name:'   '});});await act(()=>result.current.save());expect(save).not.toHaveBeenCalled();expect(result.current.error).toContain('이름');
});
it('미확정 그룹 이동의 편집폼 재저장도 그룹 의도만 유지한다',async()=>{
 const save=vi.fn<Save>().mockResolvedValueOnce({status:'unknown',message:'lost',nextAction:'확인'}).mockResolvedValue({status:'saved'});const {result}=renderHook(()=>useAccountManagementEditor({companyId:'taebaek',actorUid:'A',onUpdateCode:save}));
 await act(()=>result.current.moveCodeGroup({...code,name:''},'other'));expect(result.current.codeSession?.intent).toBe('groupMove');act(()=>result.current.changeCode({name:'입력하면 안 되는 이름',code:'999',groupId:'g'}));await act(()=>result.current.save());expect(save.mock.calls.map(call=>call[1])).toEqual([{groupId:'other'},{groupId:'g'}]);
});
