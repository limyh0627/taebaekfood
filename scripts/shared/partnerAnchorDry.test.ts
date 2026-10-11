import {planAdvanceApplication,sourceKey} from '../../src/shared/partnerAdvance';
import {semanticHash,statementBusiness} from '../../functions/src/shared/partnerAdvanceReceipt';
const source={collection:'cashEntries' as const,id:'cash',lineKey:'133'};
const purpose=JSON.stringify([sourceKey(source),'target']);
import {it,expect} from 'vitest';
import {buildVerifiedAnchor} from './partnerAnchorDry';
import {cashOriginalHash} from '../../functions/src/cashMutationReceipt';
const target:any={id:'target',companyId:'taebaek',partnerId:'p',type:'매입',tradeDate:'2025-10-01',issuedAt:'',docNo:'p',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'합성',spec:'',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500'}]};
function fixture():Record<string,any[]>{const journal:any={...target,id:'r',type:'비용',returnOperationId:'op',totalSupply:20,totalAmount:20,items:[{...target.items[0],supply:20,total:20,accountCode:'251',side:'차변'},{...target.items[0],supply:20,total:20,accountCode:'500',side:'대변'}]};const app:any={id:'a',companyId:'taebaek',partnerId:'p',statementId:'target',operationId:'op',returnRequestId:'req',amount:20};const op:any={id:'op',companyId:'taebaek',partnerId:'p',status:'applied',journalId:'r',returnRequestId:'req',amount:20,journalHash:cashOriginalHash(journal),applications:[{id:'a',statementId:'target',amount:20,applicationHash:cashOriginalHash(app)}]};return {issuedStatements:[target,journal],cashEntries:[],settlements:[],accounts:[],partners:[],returnOperations:[op],returnApplications:[app],partnerAdvanceOperations:[]};}
it('실제 반품 원문 감사 검증 뒤 미결80을 만든다',async()=>{const rows=fixture();const before=JSON.stringify(rows);const anchor=await buildVerifiedAnchor('taebaek','2025',rows);expect(anchor.rows[0].openStmts[0].remaining).toBe(80);expect(JSON.stringify(rows)).toBe(before);});
it('변조된 반품 감사와 누락 조회 자료는 계산하지 않는다',async()=>{const rows=fixture();rows.returnApplications[0].amount=19;await expect(buildVerifiedAnchor('taebaek','2025',rows)).rejects.toThrow();await expect(buildVerifiedAnchor('taebaek','2025',{...fixture(),partnerAdvanceOperations:undefined} as any)).rejects.toThrow('누락');});
it('미검증 적용 전표는 원금으로 fallback하지 않는다',async()=>{const rows=fixture();rows.issuedStatements.push({...target,id:'apply',noncashApplication:{kind:'advance-application',operationId:'missing'}});await expect(buildVerifiedAnchor('taebaek','2025',rows)).rejects.toThrow('비현금');});
it('타회사 자료는 포함하지 않으며 분개 실패는 막는다',async()=>{expect((await buildVerifiedAnchor('punghoe','2025',fixture())).rows).toEqual([]);const rows=fixture();rows.issuedStatements.push({...target,id:'bad',items:[]});await expect(buildVerifiedAnchor('taebaek','2025',rows)).rejects.toThrow('분개');});




function advanceFixture(){const command={operationId:'apply',partnerId:'p',date:'2026-10-02',source,statementId:'target',accountCode:'251',amount:60,expectedSourceFingerprint:'s',expectedTargetFingerprint:'t'};const plan=planAdvanceApplication({companyId:'taebaek',partnerId:'p',complete:true,unattributedReduction:false,blockedSourceKeys:[],sources:[{key:source,companyId:'taebaek',partnerId:'p',code:'133',originalAmount:100,date:'2026-10-01',fingerprint:'s',purpose}],targets:[{statementId:'target',companyId:'taebaek',partnerId:'p',accountCode:'251',remaining:100,date:'2026-10-01',fingerprint:'t',purpose}],priorSourceUse:new Map()}, {operationId:'apply',date:command.date,purpose,allocations:[{source,statementId:'target',accountCode:'251',amount:60}]});const requestHash=semanticHash({companyId:'taebaek',actorId:'uid',action:'apply',command});const statement:any={id:'app',companyId:'taebaek',partnerId:'p',type:'비용',tradeDate:command.date,totalAmount:60,items:plan.items,noncashApplication:plan.metadata,docNo:'대체261002-001',issuePrefix:'대체',createdBy:'uid',issueOperationId:'apply',issuePayloadHash:requestHash};statement.issueStatementHash=semanticHash(statementBusiness(statement));const operation:any={id:'apply',companyId:'taebaek',partnerId:'p',status:'applied',action:'apply',createdBy:'uid',statementId:'app',docNo:statement.docNo,issuePrefix:'대체',command,commandHash:semanticHash(command),requestHash,statementHash:statement.issueStatementHash,source,targetStatementId:'target',amount:60};return {statement,operation};}
it('반품과 검증된 선급 적용을 함께 넘겨 미결20을 보존한다',async()=>{const rows=fixture();const {statement,operation}=advanceFixture();rows.issuedStatements.push(statement);rows.partnerAdvanceOperations.push(operation);const anchor=await buildVerifiedAnchor('taebaek','2026',rows);expect(anchor.rows[0].openStmts).toEqual([{id:'target',date:'2025-10-01',type:'매입',remaining:20}]);});


it('다른 회사에 존재하는 원전표와 중복 ID를 삭제로 오인하지 않는다',async()=>{const foreign=fixture();foreign.issuedStatements[0]={...target,companyId:'punghoe'};await expect(buildVerifiedAnchor('taebaek','2025',foreign)).rejects.toThrow('다른 회사');const duplicate=fixture();duplicate.issuedStatements.push({...target});await expect(buildVerifiedAnchor('taebaek','2025',duplicate)).rejects.toThrow('중복');});

it.each(['', '2025-02-30'])('전표·자금의 실제 분개 날짜 %s는 추정하지 않고 차단한다', async date => {
 const rows=fixture();rows.returnOperations=[];rows.returnApplications=[];rows.issuedStatements=[{...target,tradeDate:date}];
 await expect(buildVerifiedAnchor('taebaek','2025',rows)).rejects.toThrow('거래 날짜');
 rows.issuedStatements=[];rows.cashEntries=[{id:'cash-date',companyId:'taebaek',partnerId:'p',date,dir:'출금',accountCode:'251',amount:100}];
 await expect(buildVerifiedAnchor('taebaek','2025',rows)).rejects.toThrow('거래 날짜');
});
it('유효한 과거 날짜·타회사 격리·기존 빈 제외용 더미 계약은 보존한다',async()=>{
 const rows=fixture();rows.returnOperations=[];rows.returnApplications=[];rows.issuedStatements=[target,{...target,id:'foreign-date',companyId:'punghoe',tradeDate:''},{...target,id:'stmt-hide-exclusion',tradeDate:'',items:[],totalAmount:0,totalSupply:0}];
 const before=JSON.stringify(rows);const anchor=await buildVerifiedAnchor('taebaek','2025',rows);
 expect(anchor.rows[0].openStmts).toEqual([{id:'target',date:'2025-10-01',type:'매입',remaining:100}]);expect(JSON.stringify(rows)).toBe(before);
});
