import {allocationInputs} from '../../src/features/admin/partnerAnchor';
import {describe,it,expect} from 'vitest';
import {createHash} from 'crypto';
import {projectClaimsAfterReturns} from './returnClaimReader';
import {planPartnerPayment} from './partnerPaymentPlan';
import {journalizeStatement,journalizeTransfer} from '../../src/shared/autoJournal';
import {allocatePartnerCash,partnerOpenBalance,partnerBalanceFromJournals} from '../../src/features/admin/cashLedger';
const hash=(x:any):string=>createHash('sha256').update(JSON.stringify(sort(x))).digest('hex');
function sort(x:any):any{return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):x}
function fixture(code='108',allocations=[['gone',40],['live',60]] as [string,number][]){
 const companyId='taebaek',partnerId='p',operationId='op';
 const journal:any={companyId,partnerId,type:'비용',tradeDate:'2026-10-03',issuedAt:'2026-10-03T00:00:00Z',returnOperationId:operationId,totalAmount:100,totalSupply:100,totalTax:0,items:[{accountCode:code,side:code==='108'?'대변':'차변',total:100,supply:100,tax:0},{accountCode:code==='108'?'404':'500',side:code==='108'?'차변':'대변',total:100,supply:100,tax:0}]};
 const apps=allocations.map(([statementId,amount],i)=>({id:`app${i}`,companyId,partnerId,statementId,amount,operationId,returnRequestId:'request',createdAt:'now'}));
 const operation={id:operationId,companyId,returnRequestId:'request',journalId:'journal',journalHash:hash(journal),amount:100,applications:apps.map(({id,...app})=>({id,statementId:app.statementId,amount:app.amount,applicationHash:hash(app)}))};
 const claims:any[]=[{id:'live',companyId,partnerId,accountCode:code,tradeDate:'2026-10-03',amount:200}];
 return {claims,apps,journals:[{...journal,id:'journal'}],operations:[operation]};
}
const project=(f:ReturnType<typeof fixture>)=>projectClaimsAfterReturns(f.claims,f.apps,f.journals,f.operations);
describe('삭제된 원전표의 반품 credit 읽기',()=>{
 it('부분배분은 살아있는60만차감하고 삭제분40만credit으로보존하며 앱분개총잔액과동일하다',()=>{const f=fixture();const claims=project(f);expect(claims.map(r=>r.amount)).toEqual([140,-40]);expect(claims.reduce((n,r)=>n+r.amount,0)).toBe(100);const ordinary:any={id:'live',companyId:'taebaek',partnerId:'p',type:'매출',tradeDate:'2026-10-03',totalSupply:200,totalTax:0,totalAmount:200,items:[{accountCode:'404',supply:200,tax:0,total:200}]};expect(partnerBalanceFromJournals('p','매출',[journalizeStatement(ordinary)!,journalizeTransfer(f.journals[0] as any)!])).toBe(100)});
 it('여러 삭제 원전표는 하나의역분개credit100만남긴다',()=>{const f=fixture('108',[['goneA',30],['goneB',70]]);expect(project(f).map(r=>r.amount)).toEqual([200,-100])});
 it('살아있는 원전표에는 독립credit을 다시더하지않는다',()=>{const f=fixture('108',[['live',100]]);expect(project(f).map(r=>r.amount)).toEqual([100])});
 it('동일배분중복은금액증거가맞아도거절한다',()=>{const f=fixture();f.apps.push({...f.apps[0]});expect(()=>project(f)).toThrow()});
 it.each(['251','253'])('매입%s credit은출금미결만줄이고입금으로전환되지않는다',(code)=>{const f=fixture(code),claims=project(f);const base={companyId:'taebaek',partnerId:'p',claims,cashEntries:[],settlements:[],amount:100,pin:false,allocations:[]};expect(planPartnerPayment({...base,direction:'출금'}).lines).toEqual([{accountCode:code,amount:100}]);expect(planPartnerPayment({...base,direction:'입금'}).lines).toEqual([{accountCode:'254',amount:100}])});
 it('매출credit 이후 수금100은새매출의정확미결100만적용된다',()=>{const f=fixture('108',[['gone',100]]),claims=project(f);expect(planPartnerPayment({companyId:'taebaek',partnerId:'p',claims,cashEntries:[],settlements:[],direction:'입금',amount:100,pin:false,allocations:[]}).applications).toEqual([{statementId:'live',amount:100,accountCode:'108'}])});
 it.each(['journal','application','company','sum','date','status'])('%s 증거변조는credit추정없이거절한다',(what)=>{const f=fixture();if(what==='journal')f.journals[0].items[0].total=101;if(what==='application')f.apps[0].amount=41;if(what==='company')f.operations[0].companyId='punghoe';if(what==='sum')f.operations[0].amount=101;if(what==='date')f.journals[0].tradeDate='2026-02-30';if(what==='status')(f.operations[0] as any).status='rejected';expect(()=>project(f)).toThrow()});
 it('실존하지만미지원인원전표를삭제된것처럼읽지않는다',()=>{const f=fixture();f.journals.push({id:'gone',type:'비용'} as any);expect(()=>project(f)).toThrow()});
});

describe('actual app FIFO 배분 계약',()=>{
 const stmt=(id:string,amount=100):any=>({id,companyId:'taebaek',partnerId:'p',type:'매출',tradeDate:id==='a'?'2026-10-01':'2026-10-02',totalAmount:amount,totalSupply:amount,totalTax:0,items:[{accountCode:'404',supply:amount,tax:0,total:amount}]});
 it('나중전표에연결된반품은앞전표를차감하지않는다',()=>{const f=fixture('108',[['b',100]]);f.journals[0].totalAmount=20;f.journals[0].items.forEach((line:any)=>line.total=20);const operations:any=[{id:'op',companyId:'taebaek',journalId:'journal',amount:20,applications:[{id:'app',statementId:'b',amount:20}]}];const statements=[stmt('a'),stmt('b'),f.journals[0]];expect([...allocatePartnerCash('p','매출',statements,[],[],undefined,operations)]).toEqual([['a',100],['b',80],['journal',0]]);expect(partnerOpenBalance('p','매출',statements,[])).toBe(180)});
 it('복수배분의살아있는60은target차감 삭제40만FIFOcredit이다',()=>{const f=fixture(),operations:any=[{...f.operations[0],sourcePresence:{gone:false}}];expect([...allocatePartnerCash('p','매출',[stmt('live',200),f.journals[0]],[],[],undefined,operations)]).toEqual([['live',100],['journal',0]])});
 it('원전표와operation 입력·JSON·spread 원문은수정하지않는다',()=>{const f=fixture(),before=JSON.stringify(f);allocatePartnerCash('p','매출',[stmt('live',200),f.journals[0]],[],[],undefined,f.operations as any);expect(JSON.stringify(f)).toBe(before);expect(Object.keys(f.journals[0])).not.toContain('__returnAllocations')});
 it('operation 구독전에는반품배분을추측하지않는다',()=>{const f=fixture();expect(Number.isNaN(allocatePartnerCash('p','매출',[stmt('live',200),f.journals[0]],[]).get('live'))).toBe(true)});
});

it('실제anchor필터는이미반영된옛반품을제외하고뒤의새반품만차감한다',()=>{
 const f=fixture('108',[['live',100]]);const source:any={id:'live',companyId:'taebaek',partnerId:'p',type:'매출',tradeDate:'2026-07-01',totalAmount:100,items:[{accountCode:'404',supply:100,tax:0,total:100}]};
 const old:any={...f.journals[0],id:'old',tradeDate:'2026-08-01'},fresh:any={...f.journals[0],id:'new',returnOperationId:'newop',tradeDate:'2026-10-01',totalAmount:20,items:f.journals[0].items.map((line:any)=>({...line,total:20}))};
 const anchor:any={asOf:'2026-09-30',rows:[{partnerId:'p',receivable:80,payable:0,openStmts:[{id:'live',type:'매출',date:'2026-07-01',remaining:80}]}]};
 const operations:any=[{id:'newop',companyId:'taebaek',journalId:'new',amount:20,applications:[{id:'newapp',statementId:'live',amount:20}],sourcePresence:{live:true}}];
 const before=allocationInputs(anchor,[source,old],[]);expect([...allocatePartnerCash('p','매출',before.statements,[],[],before.opening,operations)]).toEqual([['live',80]]);
 const after=allocationInputs(anchor,[source,old,fresh],[]);expect([...allocatePartnerCash('p','매출',after.statements,[],[],after.opening,operations)]).toEqual([['live',60],['new',0]]);
});
