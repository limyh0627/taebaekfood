/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { clearRawPressAttempt, readRawPressAttempt, saveRawPressAttempt, rawPressText, rawPressYieldKg, validateRawPressRequest, rawPressAttemptKey, type RawPressRequest } from './rawPressAttempt';
const request = (): RawPressRequest => ({ version: 1, companyId: 'taebaek', actorUid: 'uid',
  entry: { id:'press', material:'참깨', date:'2026-10-12', received:0, used:10, note:'메모', createdAt:'2026-10-12T01:00:00Z', effectiveAt:'2026-10-12T01:00:00Z', targetLotId:'lot',type:'manual' },
  yieldRule:{product:'통깨참기름',rate:0.48}, sourceCommand:{kind:'consume-lot',companyId:'taebaek',rawItemId:'source',operationId:'press',materialSnapshot:'참깨',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kg:10,lotId:'lot'},
  derivedCommand:{kind:'receive',companyId:'taebaek',rawItemId:'derived',operationId:'yield:press',materialSnapshot:'통깨참기름',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kg:4.8,lot:{supplierName:'참깨 압착',qtyIn:0}},sourceLegacy:{note:'메모'},derivedLegacy:{type:'auto'} });
beforeEach(()=>localStorage.clear());
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
