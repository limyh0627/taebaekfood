import {expect,it} from 'vitest';
import {buildPartnerLedger,partnerLedgerForPeriod} from './partnerLedger';
import type {CashEntry,IssuedStatement,JournalEntry} from '../../../shared/types';
const statement=(id:string,date:string,docNo='',over:Partial<IssuedStatement>={}):IssuedStatement=>({id,type:'비용',partnerId:'p',partnerName:'거래처',tradeDate:date,issuedAt:'2026-08-01T01:00:00Z',orderId:'',docNo,totalSupply:0,totalTax:0,totalAmount:0,items:[],...over});
const journal=(id:string,sourceId:string,credit:number,debit=0,accountCode='251',date='2026-08-01'):JournalEntry=>({id,sourceType:'대체',sourceId,date,createdAt:'',memo:'원분개',lines:[{accountCode,partnerId:'p',debit,credit}]});
it('미지급 두 계정을 부채 방향으로 읽고 적요·번호·원본을 분리하며 입력을 보존한다',()=>{
 const s=statement('s','2026-08-02','전표1',{items:[{name:'깨',spec:'',qty:1,price:10.25,supply:10.25,tax:0,total:10.25,isTaxExempt:true}]});
 const c:CashEntry={id:'c',date:'2026-08-03',createdAt:'2026-08-03T01:00:00Z',cashAccountId:'a',partnerId:'p',dir:'출금',amount:2.5,note:'계좌 지불',docNo:'자금1'};
 const entries=[journal('j1','s',10.25),journal('j2','c',0,2.5,'253')];const before=JSON.stringify([s,c,entries]);
 const out=buildPartnerLedger('p','매입',[s],[c],entries);
 expect(out).toMatchObject({opening:0,accrued:10.25,paid:2.5,balance:7.75});
 expect(out.rows[0]).toMatchObject({label:'깨',docNo:'전표1',sourceId:'s',date:'2026-08-02',balance:10.25});
 expect(out.rows[1]).toMatchObject({label:'계좌 지불',docNo:'자금1',source:'cash',amount:-2.5,balance:7.75});
 expect(JSON.stringify([s,c,entries])).toBe(before);
});
it('같은 시각에는 발생 먼저·발행 ms 다음·숫자 ID 순서로 정렬한다',()=>{
 const s=statement('s','2026-08-01');
 const out=buildPartnerLedger('p','매입',[s],[],[journal('je-1787126648825','s',2),journal('je-1787126648824','s',1),journal('payment','s',0,0.5)]);
 expect(out.rows.map(r=>r.id)).toEqual(['je-1787126648824__251','je-1787126648825__251','payment__251']);
 expect(out.rows.map(r=>r.balance)).toEqual([1,3,2.5]);
 const tied=buildPartnerLedger('p','매입',[s],[],[journal('j10','s',10),journal('j2','s',2)]);
 expect(tied.rows.map(r=>r.id)).toEqual(['j2__251','j10__251']);
});
it('매출은 차변 방향만 읽고 원본 없는 행은 선택 키를 만들지 않는다',()=>{
 const out=buildPartnerLedger('p','매출',[],[],[journal('sale','',0,4.5,'108'),journal('return','',1.25,0,'108'),journal('ap','',999)]);
 expect(out).toMatchObject({accrued:4.5,paid:1.25,balance:3.25});
 expect(out.rows[0]).not.toHaveProperty('sourceId');expect(out.rows[0]).not.toHaveProperty('docNo');expect(out.rows[0]).not.toHaveProperty('source');
});
it('범위 안 기초도 이월로 넣고 기간 전 음수 잔액과 미래 제외·생략 원본 반환을 유지한다',()=>{
 const s=[statement('old','2026-07-31'),statement('opening','2026-08-02','기초'),statement('current','2026-08-03'),statement('future','2026-09-01')];
 const all=buildPartnerLedger('p','매입',s,[],[journal('old','old',0,10.5),journal('opening','opening',2.25),journal('current','current',3.5),journal('future','future',999)]);
 const before=JSON.stringify(all);const out=partnerLedgerForPeriod(all,'2026-08-01','2026-08-31');
 expect(out).toMatchObject({opening:-8.25,accrued:3.5,paid:0,balance:-4.75});
 expect(out.rows.map(r=>r.balance)).toEqual([-8.25,-4.75]);expect(out.rows[0]).toMatchObject({kind:'결제',opening:true,label:'기간 전 잔액'});
 expect(partnerLedgerForPeriod(all,'','2026-08-31')).toBe(all);expect(partnerLedgerForPeriod(all,'2026-09-01','2026-08-01')).toBe(all);
 expect(JSON.stringify(all)).toBe(before);
});
