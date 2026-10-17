import {expect,it,vi} from 'vitest';
import * as projection from '../../../../functions/src/shared/cashLineProjection';
import {journalizeCashEntry,journalizeTransfer} from './cashJournal';
import type {CashEntry,IssuedStatement,IssuedStatementItem} from '../../../shared/types';
const cash=(over:Partial<CashEntry>={}):CashEntry=>({id:'cash',date:'2026-10-17',cashAccountId:'bank',dir:'출금',amount:0,createdAt:'',...over});
const item=(accountCode:string,total:number,side?:'차변'|'대변'):IssuedStatementItem=>({accountCode,total,side,name:accountCode,spec:'',qty:1,price:total,supply:total,tax:0,isTaxExempt:true});
const statement=(items:IssuedStatementItem[]):IssuedStatement=>({id:'s',type:'비용',partnerId:'p',partnerName:'거래처',tradeDate:'2026-10-17',issuedAt:'',orderId:'',docNo:'전표1',totalSupply:0,totalTax:0,totalAmount:0,items});
it('명시 차대·음수 공제와 통장매핑·메모·소수 반올림을 원순서로 보존한다',()=>{
 const e=cash({amount:99,partnerId:'p',note:'지급',lines:[{accountCode:'500',amount:10.254,side:'차변',note:'본액'},{accountCode:'253',amount:2.504,side:'대변',note:'공제'}]});const before=JSON.stringify(e);
 const out=journalizeCashEntry(e,{bank:'104'})!;
 expect(out.lines).toEqual([{accountCode:'500',partnerId:'p',debit:10.25,credit:0,note:'본액'},{accountCode:'253',partnerId:'p',debit:0,credit:2.5,note:'공제'},{accountCode:'104',debit:0,credit:7.75,note:'지급'}]);
 expect(out).toMatchObject({sourceId:'cash',sourceType:'자금',createdAt:'2026-10-17T00:00:00.000Z'});expect(JSON.stringify(e)).toBe(before);
});
it('입금 통장폴백과 원본 시각을 유지하고 계정 없는·순액0 일반자금은 만들지 않는다',()=>{
 const out=journalizeCashEntry(cash({dir:'입금',amount:1.25,accountCode:'108',createdAt:'2026-10-17T01:00:00Z'}))!;
 expect(out.lines).toEqual([{accountCode:'103',debit:1.25,credit:0},{accountCode:'108',debit:0,credit:1.25}]);
 expect(out.createdAt).toBe('2026-10-17T01:00:00Z');expect(journalizeCashEntry(cash({amount:1}))).toBeNull();
 expect(journalizeCashEntry(cash({lines:[{accountCode:'108',amount:2},{accountCode:'251',amount:-2}]}))).toBeNull();
});
it('대체 자금은 균형 잡힌 양변만 만들고 통장줄·빈거래처 키를 추가하지 않는다',()=>{
 const out=journalizeCashEntry(cash({dir:'대체',lines:[{accountCode:'251',amount:2.5},{accountCode:'108',amount:-2.5}]}))!;
 expect(out.lines).toEqual([{accountCode:'251',debit:2.5,credit:0},{accountCode:'108',debit:0,credit:2.5}]);
 expect(journalizeCashEntry(cash({dir:'대체',lines:[{accountCode:'251',amount:2.5},{accountCode:'108',amount:-2}]}))).toBeNull();
});
it('대체전표는 정상방향 추정 없이 명시 차대를 읽고 채권채무에만 거래처를 붙인다',()=>{
 const s=statement([item('375',3.25,'차변'),item('253',3.25,'대변')]);const before=JSON.stringify(s);
 const out=journalizeTransfer(s,()=> 'credit')!;
 expect(out.lines).toEqual([{accountCode:'375',debit:3.25,credit:0},{accountCode:'253',partnerId:'p',debit:0,credit:3.25}]);
 expect(out.createdAt).toBe('2026-10-17T00:00:00.000Z');expect(JSON.stringify(s)).toBe(before);
 expect(journalizeTransfer(statement([item('375',3.25),item('253',3.25,'대변')]))).toBeNull();
 expect(journalizeTransfer(statement([item('375',3,'차변'),item('253',2,'대변')]))).toBeNull();
 expect(journalizeTransfer({...s,type:'매입'})).toBeNull();
});

it('공용 projection 검증 오류는 null 성공으로 삼키지 않고 그대로 전달한다',()=>{
 const error=new projection.CashLineProjectionError('원문 검증 실패');const spy=vi.spyOn(projection,'projectCashLines').mockImplementationOnce(()=>{throw error;});
 try{expect(()=>journalizeCashEntry(cash({amount:3,accountCode:'108'}))).toThrow(error);}finally{spy.mockRestore();}
 const out=journalizeTransfer(statement([item('108',-2.5,'차변'),item('251',-2.5,'대변')]))!;
 expect(out.lines).toEqual([{accountCode:'108',partnerId:'p',debit:-2.5,credit:0},{accountCode:'251',partnerId:'p',debit:0,credit:-2.5}]);
});
