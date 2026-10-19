// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompanyInfo } from '../../../shared/types';
import { useCompanyInfoEditor } from './useCompanyInfoEditor';
import { TAEBAEK_BANK_ACCOUNT } from '../../../shared/companyInfo';
const auth=vi.hoisted(()=>({currentUser:{uid:'A'}}));
vi.mock('../../../shared/firebase',()=>({auth}));
const initial:CompanyInfo={name:'회사',ceoName:'대표',bizNo:'139-04-37157',bizType:'제조',bizItem:'식품',address:'원주소',adminPassword:'비밀'};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
beforeEach(()=>{auth.currentUser.uid='A';});
it('초기 은행 fallback은 dirty가 아니고 숨김·미수정 필드는 보내지 않는다',async()=>{
 const save=vi.fn(async()=>{}),close=vi.fn();const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:save,onClose:close}));
 expect(result.current.form.bankAccount).toBe(TAEBAEK_BANK_ACCOUNT);expect(result.current.dirty).toBe(false);expect(result.current.canSave).toBe(false);
 act(()=>result.current.changeField('address','새주소'));await act(()=>result.current.save());expect(save).toHaveBeenCalledExactlyOnceWith({address:'새주소'});expect(close).toHaveBeenCalledOnce();
});
it('은행 지우기는 명시 빈값이고 외부 구독은 수정 초안을 덮지 않는다',async()=>{
 const save=vi.fn(async()=>{});const {result,rerender}=renderHook(({value})=>useCompanyInfoEditor({initial:value,companyId:'taebaek',actorUid:'A',onSave:save}),{initialProps:{value:initial}});
 act(()=>result.current.changeField('bankAccount',''));rerender({value:{...initial,address:'외부주소',bankAccount:'외부은행'}});expect(result.current.form.address).toBe('원주소');expect(result.current.form.bankAccount).toBe('');await act(()=>result.current.save());expect(save).toHaveBeenCalledExactlyOnceWith({bankAccount:''});
});
it('ACK 전 중복 송신과 입력 변경을 막고 ACK 뒤에만 닫는다',async()=>{
 const gate=deferred<void>(),save=vi.fn(()=>gate.promise),close=vi.fn();const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:save,onClose:close}));
 act(()=>result.current.changeField('phone','123'));let run!:Promise<boolean>;act(()=>{run=result.current.save();});await act(()=>result.current.save());act(()=>result.current.changeField('phone','456'));expect(save).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();expect(result.current.form.phone).toBe('123');await act(async()=>{gate.resolve();await run;});expect(close).toHaveBeenCalledOnce();
});
it('실패는 입력과 원인을 보존하고 명시 동일 patch 재저장만 한다',async()=>{
 const save=vi.fn().mockRejectedValueOnce(Error('응답 유실')).mockResolvedValue(undefined),close=vi.fn();const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:save,onClose:close}));
 act(()=>result.current.changeField('name','새회사'));await act(()=>result.current.save());expect(close).not.toHaveBeenCalled();expect(result.current.error).toContain('응답 유실');expect(result.current.error).toContain('다시 저장하면');expect(result.current.form.name).toBe('새회사');expect(save).toHaveBeenCalledOnce();await act(()=>result.current.save());expect(save.mock.calls.map(call=>call[0])).toEqual([{name:'새회사'},{name:'새회사'}]);
});
it('미확정 뒤 원래 표시값으로 되돌린 필드도 명시 patch로 보낸다',async()=>{
 const save=vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue(undefined);const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:save}));
 act(()=>result.current.changeField('name','첫값'));await act(()=>result.current.save());act(()=>{result.current.changeField('name','회사');result.current.changeField('address','다음값');});expect(result.current.error).toBe('');expect(result.current.dirtyFields).toEqual(['name','address']);await act(()=>result.current.save());expect(save).toHaveBeenLastCalledWith({name:'회사',address:'다음값'});
});
it('onSave 없는 창은 저장으로 닫히지 않는다',async()=>{
 const close=vi.fn();const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onClose:close}));act(()=>result.current.changeField('name','새값'));expect(result.current.canSave).toBe(false);expect(result.current.blockedReason).toContain('저장 기능');await act(()=>result.current.save());expect(close).not.toHaveBeenCalled();
});
it('scope 변경 뒤 이전 ACK와 finally는 새 busy와 창에 영향을 주지 않는다',async()=>{
 const old=deferred<void>(),fresh=deferred<void>(),save=vi.fn().mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>fresh.promise),close=vi.fn();
 const {result,rerender}=renderHook(({uid})=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:uid,onSave:save,onClose:close}),{initialProps:{uid:'A'}});act(()=>result.current.changeField('name','A초안'));let a!:Promise<boolean>,b!:Promise<boolean>;act(()=>{a=result.current.save();});auth.currentUser.uid='B';rerender({uid:'B'});expect(result.current.form.name).toBe('회사');act(()=>result.current.changeField('name','B초안'));act(()=>{b=result.current.save();});await act(async()=>{old.resolve();await a;});expect(close).not.toHaveBeenCalled();expect(result.current.busy).toBe(true);await act(async()=>{fresh.resolve();await b;});expect(close).toHaveBeenCalledOnce();
});
it('저장 중 명시 닫기는 허용하되 늦은 오류가 새 창에 나타나지 않는다',async()=>{
 const gate=deferred<void>(),close=vi.fn();const {result,rerender}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:()=>gate.promise,onClose:close}));act(()=>result.current.changeField('name','옛초안'));let run!:Promise<boolean>;act(()=>{run=result.current.save();});act(()=>{expect(result.current.close()).toBe(true);});rerender();act(()=>result.current.changeField('name','새초안'));await act(async()=>{gate.reject(Error('old'));await run;});expect(result.current.error).toBe('');expect(result.current.form.name).toBe('새초안');expect(close).toHaveBeenCalledOnce();
});

it('실제 UID 불일치 저장 차단은 이유를 제공한다',async()=>{
 const save=vi.fn(),{result,rerender}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:save}));act(()=>result.current.changeField('name','초안'));auth.currentUser.uid='B';rerender();expect(result.current.canSave).toBe(false);expect(result.current.blockedReason).toContain('로그인 계정');await act(()=>result.current.save());expect(save).not.toHaveBeenCalled();
});

it('송신 전 원래 표시값으로 돌아온 필드는 patch에서 제외한다',()=>{
 const {result}=renderHook(()=>useCompanyInfoEditor({initial,companyId:'taebaek',actorUid:'A',onSave:vi.fn()}));act(()=>{result.current.changeField('name','다른값');result.current.changeField('name','회사');});expect(result.current.dirty).toBe(false);
});
