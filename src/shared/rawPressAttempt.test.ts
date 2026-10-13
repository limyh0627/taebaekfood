/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { clearRawPressAttempt, readRawPressAttempt, saveRawPressAttempt, rawPressText, rawPressYieldKg, validateRawPressRequest, rawPressAttemptKey, type RawPressRequest } from './rawPressAttempt';
import { makeRawPressCancellationRequest,readRawPressCancellationAttempt,saveRawPressCancellationAttempt,clearRawPressCancellationAttempt,rawPressCancellationAttemptKey } from './rawPressAttempt';
import {beginNewRawPressAttempt,listRawPressAttempts,deleteRawPressAttempt,submitRawPressAttempt,assertRawPressAttempt} from './rawPressAttempt';
const request = (): RawPressRequest => ({ version: 1, companyId: 'taebaek', actorUid: 'uid',
  entry: { id:'press', material:'참깨', date:'2026-10-12', received:0, used:10, note:'메모', createdAt:'2026-10-12T01:00:00Z', effectiveAt:'2026-10-12T01:00:00Z', targetLotId:'lot',type:'manual' },
  yieldRule:{product:'통깨참기름',rate:0.48}, sourceCommand:{kind:'consume-lot',companyId:'taebaek',rawItemId:'source',operationId:'press',materialSnapshot:'참깨',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kg:10,lotId:'lot'},
  derivedCommand:{kind:'receive',companyId:'taebaek',rawItemId:'derived',operationId:'yield:press',materialSnapshot:'통깨참기름',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kg:4.8,lot:{supplierName:'참깨 압착',qtyIn:0}},sourceLegacy:{note:'메모'},derivedLegacy:{type:'auto'} });
beforeEach(()=>localStorage.clear());
it('요청별 압착 삭제 뒤 실제 원료 교집합은 보호하고 무관 요청은 허용한다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_options:any,work:any)=>work()}});
 const first=await beginNewRawPressAttempt(request(),()=>true);await deleteRawPressAttempt(first,()=>true);expect(listRawPressAttempts('taebaek','uid')[0].deleted).toBe(true);
 const other=request();other.entry.id='other';other.sourceCommand.operationId='other';other.sourceCommand.source.id='other';other.derivedCommand.operationId='yield:other';other.derivedCommand.source.id='other';
 await expect(beginNewRawPressAttempt(other,()=>true)).rejects.toThrow('이전 압착');other.sourceCommand.rawItemId='new-source';other.derivedCommand.rawItemId='new-derived';
 const next=await beginNewRawPressAttempt(other,()=>true);expect((await submitRawPressAttempt(next,()=>true)).state).toBe('submitted');expect(listRawPressAttempts('taebaek','uid')).toHaveLength(2);
});
it('압착 first 저장 실패나 UID 변경은 요청 pin을 승인하지 않는다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_options:any,work:any)=>work()}});
 await expect(beginNewRawPressAttempt(request(),()=>false)).rejects.toThrow('계정');
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('저장 실패');});await expect(beginNewRawPressAttempt(request(),()=>true)).rejects.toThrow('저장 실패');spy.mockRestore();
});
it('submitted 선택 원문의 상태를 prepared로 바꿔 재적용하지 않는다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_options:any,work:any)=>work()}});
 const saved=await submitRawPressAttempt(await beginNewRawPressAttempt(request(),()=>true),()=>true);
 expect(()=>assertRawPressAttempt({...saved,state:'prepared'})).toThrow('제출 상태');
});
it('최초 원문은 회사 UID별 저장하고 재개 때 다시 쓰지 않는다',()=>{
  const r=request(), first=saveRawPressAttempt(r),set=vi.spyOn(Storage.prototype,'setItem');
  expect(saveRawPressAttempt({...r,entry:{...r.entry}})).toEqual(first);expect(set).not.toHaveBeenCalled();set.mockRestore();
  expect(readRawPressAttempt('punghoe','uid')).toBeNull();expect(readRawPressAttempt('taebaek','other')).toBeNull();
  expect(()=>saveRawPressAttempt({...r,yieldRule:{...r.yieldRule,rate:0.5}})).toThrow();expect(readRawPressAttempt('taebaek','uid')).toEqual(first);
});
it.each(['','{bad'])('손상 원문 %s은 없음으로 취급하거나 덮어쓰지 않는다',encoded=>{
  localStorage.setItem(rawPressAttemptKey('taebaek','uid'),encoded);expect(()=>readRawPressAttempt('taebaek','uid')).toThrow('손상');expect(()=>saveRawPressAttempt(request())).toThrow();expect(localStorage.getItem(rawPressAttemptKey('taebaek','uid'))).toBe(encoded);
});
it('정리는 exact encoded만 허용하고 실패 원문을 유지한다',()=>{
 const first=saveRawPressAttempt(request());expect(()=>clearRawPressAttempt('taebaek','uid','other')).toThrow();
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('저장소 실패');});expect(()=>clearRawPressAttempt('taebaek','uid',first.encoded)).toThrow();remove.mockRestore();expect(readRawPressAttempt('taebaek','uid')).toEqual(first);clearRawPressAttempt('taebaek','uid',first.encoded);expect(readRawPressAttempt('taebaek','uid')).toBeNull();
});
it('회사·동일 홀더·시각·원료 사용·파생 양·source 변조는 거절한다',()=>{
 for(const mutate of [(r:RawPressRequest)=>{r.derivedCommand.rawItemId='source';},(r:RawPressRequest)=>{r.sourceCommand.companyId='punghoe';},(r:RawPressRequest)=>{r.sourceCommand.source.id='different';},(r:RawPressRequest)=>{r.derivedCommand.kg=5;},(r:RawPressRequest)=>{r.derivedCommand.effectiveAt='2026-10-12T02:00:00Z';}]){const r=request();mutate(r);expect(()=>validateRawPressRequest(r)).toThrow();}
});
it('키순서는 무관하고 기존 kg 수율은 round3만 적용한다',()=>{
 const r=request();expect(rawPressText(Object.fromEntries(Object.entries(r).reverse()))).toBe(rawPressText(r));expect(rawPressYieldKg(10,0.48)).toBe(4.8);expect(rawPressYieldKg(0.001,0.48)).toBe(0);
});
it('취소 첫 원문은 ID·회사·현재 행동자·시각을 고정하고 재개에 다시 쓰지 않는다',()=>{const cancel=makeRawPressCancellationRequest(request(),'other-admin','cancel-first','2026-10-13T00:00:00Z');const first=saveRawPressCancellationAttempt(cancel);const set=vi.spyOn(Storage.prototype,'setItem');expect(saveRawPressCancellationAttempt(cancel)).toEqual(first);expect(set).not.toHaveBeenCalled();expect(readRawPressCancellationAttempt('taebaek','uid','press')).toBeNull();expect(()=>saveRawPressCancellationAttempt(makeRawPressCancellationRequest(request(),'other-admin','new-id','2026-10-13T01:00:00Z'))).toThrow();set.mockRestore();expect(()=>clearRawPressCancellationAttempt(cancel,'different')).toThrow();clearRawPressCancellationAttempt(cancel,first.encoded);expect(readRawPressCancellationAttempt('taebaek','other-admin','press')).toBeNull();});
it.each(['','{bad'])('손상 취소 저장값 %s은 보존하고 새 취소로 덮지 않는다',encoded=>{localStorage.setItem(rawPressCancellationAttemptKey('taebaek','uid','press'),encoded);expect(()=>readRawPressCancellationAttempt('taebaek','uid','press')).toThrow('손상');expect(()=>saveRawPressCancellationAttempt(makeRawPressCancellationRequest(request(),'uid','new','2026-10-13T00:00:00Z'))).toThrow();expect(localStorage.getItem(rawPressCancellationAttemptKey('taebaek','uid','press'))).toBe(encoded);});
