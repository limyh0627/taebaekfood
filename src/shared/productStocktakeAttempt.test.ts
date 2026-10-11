/** @vitest-environment jsdom */
import {beforeEach,expect,it,vi} from 'vitest';
import {beginProductStocktakeAttempt,readProductStocktakeAttempt,submitProductStocktakeAttempt,clearProductStocktakeAttempt,productStocktakeRequest,sameProductStocktakeRequest,discardProductStocktakeAttempt,productStocktakeAttemptText} from './productStocktakeAttempt';
const input={companyId:'taebaek' as const,uid:'u',itemId:'p',itemName:'제품',targetQty:3,minStock:0,unitKg:1};
beforeEach(()=>localStorage.clear());
it('최초원문을 보존하고 입력 변경·재마운트에도 같은 요청을 재발견한다',()=>{
 const first=beginProductStocktakeAttempt(input);expect(readProductStocktakeAttempt('taebaek','u','p')).toEqual(first);
 const pending=submitProductStocktakeAttempt(first);expect(beginProductStocktakeAttempt({...input,targetQty:8})).toEqual(pending);
 expect(sameProductStocktakeRequest(Object.fromEntries(Object.entries(productStocktakeRequest(pending)).reverse()),productStocktakeRequest(pending))).toBe(true);
 expect(readProductStocktakeAttempt('punghoe','u','p')).toBeNull();expect(readProductStocktakeAttempt('taebaek','other','p')).toBeNull();
});
it('원문변경·정리실패에는 보존하고 명시폐기후새실사는새ID를만든다',()=>{
 const first=submitProductStocktakeAttempt(beginProductStocktakeAttempt(input));
 expect(()=>clearProductStocktakeAttempt({...first,targetQty:9})).toThrow();
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('cleanup');});
 expect(()=>clearProductStocktakeAttempt(first)).toThrow();remove.mockRestore();expect(readProductStocktakeAttempt('taebaek','u','p')).toEqual(first);
 discardProductStocktakeAttempt('taebaek','u','p',productStocktakeAttemptText('taebaek','u','p'));
 expect(beginProductStocktakeAttempt({...input,targetQty:4}).operationId).not.toBe(first.operationId);
});
it('영속저장이 실패하면 submitted를반환하지않고원문이없으면추정하지않는다',()=>{
 const first=beginProductStocktakeAttempt(input);const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage');});
 expect(()=>submitProductStocktakeAttempt(first)).toThrow();set.mockRestore();expect(readProductStocktakeAttempt('taebaek','u','p')?.state).toBe('prepared');
 localStorage.clear();expect(()=>submitProductStocktakeAttempt(first)).toThrow();
});
