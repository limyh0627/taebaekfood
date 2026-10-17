import {expect,it} from 'vitest';
import {partnerAccountHistory,partnerAccountBalances,PARTNER_BALANCE_CODES} from './partnerAccountHistory';
import type {CashEntry,IssuedStatement,JournalEntry} from '../../../shared/types';
const statement=(id:string,over:Partial<IssuedStatement>={}):IssuedStatement=>({id,type:'비용',partnerId:'p',partnerName:'거래처',tradeDate:'2026-08-01',issuedAt:'',orderId:'',docNo:id,totalSupply:0,totalTax:0,totalAmount:0,items:[],...over});
const journal=(id:string,sourceType:JournalEntry['sourceType'],sourceId:string,lines:JournalEntry['lines'],date='2026-08-01'):JournalEntry=>({id,sourceType,sourceId,date,createdAt:'',lines});
it('같은 ID의 원문 종류를 분리하고 중복 분개는 한 번만 읽으며 입력은 보존한다',()=>{
 const s=statement('same');const c:CashEntry={id:'same',partnerId:'p',date:'2026-08-01',cashAccountId:'a',dir:'입금',amount:2.5,createdAt:''};
 const js=journal('js','대체','same',[{accountCode:'133',debit:1.25,credit:0}]);
 const jc=journal('jc','자금','same',[{accountCode:'108',partnerId:'p',debit:0,credit:2.5}]);
 const jm=journal('same','수동','same',[{accountCode:'253',partnerId:'p',debit:0,credit:3.75}]);
 const before=JSON.stringify([s,c,js,jc,jm]);
 const out=partnerAccountHistory('p',[s],[c],[jm,jc,js,jc]);
 expect(out.history.map(r=>r.key)).toEqual(['taebaek:cash:same','taebaek:manual:same','taebaek:statement:same']);
 expect(out.rows).toHaveLength(3);expect(out.rows.map(r=>r.accountCode)).toEqual(['108','253','133']);
 expect(JSON.stringify([s,c,js,jc,jm])).toBe(before);
});
it('회사 외 원본은 제외하고 고아·분개 실패는 경고만 남긴다',()=>{
 const local=statement('local'),foreign=statement('foreign',{companyId:'punghoe'});
 const line=[{accountCode:'108',partnerId:'p',debit:5,credit:0}];
 const out=partnerAccountHistory('p',[local,foreign],[],[journal('l','대체','local',line),journal('f','대체','foreign',line),journal('o','매출','missing',line)],[{sourceType:'대체',id:'local',reason:'불균형'}],'taebaek');
 expect(out.history.map(r=>[r.sourceId,r.warning])).toEqual([['local','분개 확인 필요: 불균형'],['missing','원본 확인 필요']]);
 expect(out.rows).toEqual([]);
});
it('명시 회사 없는 수동분개는 태백으로만 읽고 대체 보완은 선급·선수에만 적용한다',()=>{
 const s=statement('s');const lines=[{accountCode:'133',debit:8,credit:0},{accountCode:'254',debit:0,credit:4},{accountCode:'103',debit:9,credit:0}];
 const manual=journal('m','수동','unused',[{accountCode:'108',partnerId:'p',debit:2,credit:0}]);
 expect(partnerAccountHistory('p',[s],[],[journal('j','대체','s',lines),manual],[],'taebaek').rows.map(r=>r.accountCode)).toEqual(['108','133','254']);
 expect(partnerAccountHistory('p',[s],[],[manual],[],'punghoe').rows).toEqual([]);
});
it('기간 이전·기초와 당기 소수 부호를 정상방향별로 나누고 미래 기초는 제외한다',()=>{
 const rows=[
 {key:'o',eventKey:'o',date:'2026-08-02',accountCode:'251',debit:0,credit:10.25,opening:true},
 {key:'p',eventKey:'p',date:'2026-07-31',accountCode:'251',debit:0,credit:2.5,opening:false},
 {key:'m',eventKey:'m',date:'2026-08-03',accountCode:'251',debit:3.25,credit:1.5,opening:false},
 {key:'f',eventKey:'f',date:'2026-09-01',accountCode:'251',debit:0,credit:999,opening:true},
 {key:'a',eventKey:'a',date:'2026-08-03',accountCode:'108',debit:0,credit:0.25,opening:false}];
 const out=partnerAccountBalances(rows,[],'2026-08-01','2026-08-31');
 expect(out.find(r=>r.code==='251')).toMatchObject({opening:12.75,debit:3.25,credit:1.5,closing:11});
 expect(out.find(r=>r.code==='108')?.closing).toBe(-0.25);
 expect(PARTNER_BALANCE_CODES).toEqual(['108','251','253','133','254']);
 expect(partnerAccountBalances([],[]).every(r=>r.closing===0)).toBe(true);
});
