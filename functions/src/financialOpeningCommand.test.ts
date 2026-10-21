import {beforeEach,it,expect,vi} from 'vitest';
import type * as admin from 'firebase-admin';
import {executeFinancialOpening,executeFinancialOpeningForActor,type FinancialOpeningInput} from './financialOpeningCommand';
const state={rows:new Map<string,Record<string,any>>(),writes:[] as string[]};
function collection(name:string){return {name,filters:[] as {field:string;value:unknown}[],doc:(id:string)=>({path:`${name}/${id}`,id}),where(field:string,_op:string,value:unknown){return {...this,filters:[...this.filters,{field,value}]};}};}
const snapshot=(ref:{path:string;id:string})=>({ref,id:ref.id,exists:state.rows.has(ref.path),data:()=>state.rows.get(ref.path)});
const store={collection,runTransaction:async(run:(tx:unknown)=>Promise<unknown>)=>{const writes:{ref:{path:string;id:string};row:Record<string,unknown>;update:boolean}[]=[];
 const tx={get:async(ref:any)=>{if(writes.length)throw new Error('read after write');return ref.path?snapshot(ref):{docs:[...state.rows].filter(([path,row])=>path.startsWith(ref.name+'/')&&ref.filters.every((f:any)=>row[f.field]===f.value)).map(([path])=>snapshot({path,id:path.split('/')[1]}))};},set:(ref:any,row:Record<string,unknown>)=>{writes.push({ref,row,update:false});return tx;},create:(ref:any,row:Record<string,unknown>)=>{if(state.rows.has(ref.path))throw Error('exists');writes.push({ref,row,update:false});return tx;},update:(ref:any,row:Record<string,unknown>)=>{writes.push({ref,row,update:true});return tx;},delete:vi.fn(),getAll:vi.fn()};
 const result=await run(tx);for(const w of writes){state.rows.set(w.ref.path,w.update?{...state.rows.get(w.ref.path),...w.row}:w.row);state.writes.push(w.ref.path);}return result;}} as unknown as admin.firestore.Firestore;
const loan={id:'loan',companyId:'punghoe' as const,name:'대출',lenderName:'은행',accountCode:'260' as const,openingDate:'2026-07-31',openingPrincipal:1000,createdAt:'2026-07-31'};
const account={id:'bank',companyId:'punghoe' as const,name:'은행',type:'통장' as const,openingDate:'2026-07-31',openingBalance:1000,active:true,createdAt:'2026-07-31'};
const command=(body:Omit<Extract<FinancialOpeningInput,{kind:'loan-create'}>,'operationId'|'companyId'|'releaseId'>):FinancialOpeningInput=>({...body,companyId:'punghoe',operationId:'loan-create',releaseId:'release'});
beforeEach(()=>{state.rows.clear();state.writes=[];state.rows.set('appMeta/releaseCutover',{status:'active',releaseId:'release'});state.rows.set('openingBalances/main-punghoe',{companyId:'punghoe',date:'2026-07-31',amounts:{}});});
it('대출·기초전표·성공감사를 함께 생성하고 같은 원문 재시도는 쓰기0',async()=>{const input=command({kind:'loan-create',loan});expect(await executeFinancialOpening(store,'punghoe','uid',input)).toBe('created');expect(state.rows.get('issuedStatements/opening-loan-punghoe-loan')?.totalAmount).toBe(1000);state.writes=[];expect(await executeFinancialOpening(store,'punghoe','uid',input)).toBe('created');expect(state.writes).toEqual([]);await expect(executeFinancialOpening(store,'punghoe','uid',{...input,loan:{...loan,openingPrincipal:1001}} as FinancialOpeningInput)).rejects.toThrow('다릅니다');});
it('거래처 기초는 합계 중복을 거절하고 회사 원문·번호를 보존한다',async()=>{state.rows.set('partners/p',{companyId:'punghoe',name:'거래처'});const input:FinancialOpeningInput={companyId:'punghoe',operationId:'partner',releaseId:'release',kind:'partner-create',date:'2026-07-31',partnerId:'p',code:'251',amount:300};expect(await executeFinancialOpening(store,'punghoe','uid',input)).toBe('created');expect(state.rows.get('issuedStatements/opening-partner-punghoe-2026-07-31-p-251')?.docNo).toBe('기초-20260731-p-251');});
it('계좌 생성과 원금 정정은 기존 연결 전표를 같은 거래로 동기한다',async()=>{await executeFinancialOpening(store,'punghoe','uid',{companyId:'punghoe',operationId:'account',releaseId:'release',kind:'account-create',account});expect(state.rows.get('issuedStatements/opening-cash-punghoe-bank')?.totalAmount).toBe(1000);await executeFinancialOpening(store,'punghoe','uid',command({kind:'loan-create',loan}));state.rows.set('cashEntries/repay',{id:'repay',companyId:'punghoe',loanId:'loan',cashAccountId:'bank',date:'2026-08-01',createdAt:'',dir:'출금',amount:200,accountCode:'260'});await executeFinancialOpening(store,'punghoe','uid',{companyId:'punghoe',operationId:'loan-update',releaseId:'release',kind:'loan-update',original:loan,newDate:'2026-07-31',targetBalance:1200});expect(state.rows.get('loanContracts/loan')?.openingPrincipal).toBe(1400);expect(state.rows.get('issuedStatements/opening-loan-punghoe-loan')?.totalAmount).toBe(1400);});
it('늦게 추가된 확정 계좌 기준점은 최신 TX 원문으로 역산을 거절하고 전체쓰기0',async()=>{state.rows.set('cashAccounts/bank',{...account,confirmedBalances:[{date:'2026-09-30',balance:10,recordedAt:'2026-10-09',reason:'확정'}]});await expect(executeFinancialOpening(store,'punghoe','uid',{companyId:'punghoe',operationId:'account-update',releaseId:'release',kind:'account-update',original:account,name:'은행',newDate:'2026-07-31',targetBalance:30,asOf:'2026-10-09'})).rejects.toThrow('확정 잔액');expect(state.writes).toEqual([]);});
it('타회사 원문과 잘못된 과거 기초일은 금융문서·감사·counter 쓰기0',async()=>{await expect(executeFinancialOpening(store,'taebaek','uid',command({kind:'loan-create',loan}))).rejects.toThrow();await expect(executeFinancialOpening(store,'punghoe','uid',command({kind:'loan-create',loan:{...loan,openingDate:'2026-08-01'}}))).rejects.toThrow('기초잔액');expect(state.writes).toEqual([]);expect([...state.rows.keys()].filter(path=>path.includes('voucherSeq'))).toEqual([]);});

const actor = { uid: 'uid', token: { companyId: 'punghoe', isAdmin: true } };
const reference = { companyId: 'punghoe' as const, operationId: 'loan-create', kind: 'loan-create' as const };
it('본문 없는 조회는 부재를 미확정으로 반환하고 어떤 문서도 쓰지 않는다', async () => {
  await expect(executeFinancialOpeningForActor(store, actor, { mode: 'inspect', reference } as unknown as FinancialOpeningInput)).resolves.toMatchObject({ status: 'unknown', requestHash: null, reference, actorUid: 'uid' });
  expect(state.writes).toEqual([]);
});
it('적용된 과거 요청은 gate가 닫히고 대상이 삭제돼도 결과만 반환한다', async () => {
  const input = command({ kind: 'loan-create', loan });
  await executeFinancialOpening(store, 'punghoe', 'uid', input);
  state.rows.set('appMeta/releaseCutover', { status: 'closed', releaseId: 'new-release' });
  state.rows.delete('loanContracts/loan'); state.rows.delete('issuedStatements/opening-loan-punghoe-loan'); state.writes = [];
  await expect(executeFinancialOpening(store, 'punghoe', 'uid', input)).resolves.toBe('created');
  expect(state.writes).toEqual([]);
});
it('중단은 같은 영수증 위치만 확정하고 늦은 적용을 typed 결과로 막는다', async () => {
  const result = await executeFinancialOpeningForActor(store, actor, { mode: 'cancel', reference });
  expect(result).toMatchObject({ status: 'cancelled', requestHash: null, reference });
  expect(state.writes).toEqual(['financialOpeningOperations/loan-create']); state.writes = [];
  await expect(executeFinancialOpening(store, 'punghoe', 'uid', command({ kind: 'loan-create', loan }))).rejects.toMatchObject({ details: {
    operationStatus: 'cancelled', financialWrites: false, financialOpeningRecovery: { status: 'cancelled', actorUid: 'uid', reference },
  } });
  expect(state.writes).toEqual([]); expect(state.rows.has('loanContracts/loan')).toBe(false);
});
it('완료된 요청 중단은 업무를 원복하지 않고 과거 결과를 반환한다', async () => {
  await executeFinancialOpening(store, 'punghoe', 'uid', command({ kind: 'loan-create', loan })); state.writes = [];
  const before = structuredClone([...state.rows]);
  await expect(executeFinancialOpeningForActor(store, actor, { mode: 'cancel', reference })).resolves.toMatchObject({ status: 'applied', result: 'created', requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect([...state.rows]).toEqual(before); expect(state.writes).toEqual([]);
});
it('다른 회사·사용자·업무와 손상된 기록은 상태를 노출하거나 새 fence로 덮지 않는다', async () => {
  await executeFinancialOpening(store, 'punghoe', 'uid', command({ kind: 'loan-create', loan })); state.writes = [];
  for (const [who, ref] of [
    [{ ...actor, uid: 'other' }, reference],
    [actor, { ...reference, companyId: 'taebaek' }],
    [actor, { ...reference, kind: 'account-create' }],
  ] as const) await expect(executeFinancialOpeningForActor(store, who, { mode: 'inspect', reference: ref } as unknown as FinancialOpeningInput)).rejects.toThrow();
  state.rows.set('financialOpeningOperations/loan-create', { ...state.rows.get('financialOpeningOperations/loan-create'), requestHash: null });
  await expect(executeFinancialOpeningForActor(store, actor, { mode: 'cancel', reference })).rejects.toThrow('손상');
  expect(state.writes).toEqual([]);
});
it('새 적용은 gate가 닫히면 여전히 거절하며 관리자 권한은 모든 mode에 같다', async () => {
  state.rows.set('appMeta/releaseCutover', { status: 'closed', releaseId: 'release' });
  await expect(executeFinancialOpening(store, 'punghoe', 'uid', command({ kind: 'loan-create', loan }))).rejects.toThrow();
  for (const who of [undefined, { ...actor, uid: '' }, { ...actor, token: { companyId: 'punghoe', isAdmin: false } }]) {
    await expect(executeFinancialOpeningForActor(store, who, { mode: 'inspect', reference })).rejects.toThrow();
  }
  expect(state.writes).toEqual([]);
});
it('다섯째 계좌 수정도 기존 계산·전표 동기와 과거 영수증 결과를 보존한다', async () => {
  await executeFinancialOpening(store, 'punghoe', 'uid', { companyId: 'punghoe', operationId: 'account-create', releaseId: 'release', kind: 'account-create', account });
  const input: FinancialOpeningInput = { companyId: 'punghoe', operationId: 'account-update', releaseId: 'release', kind: 'account-update', original: account, name: '변경 은행', newDate: '2026-07-31', targetBalance: 1200, asOf: '2026-07-31' };
  expect(await executeFinancialOpening(store, 'punghoe', 'uid', input)).toBe('updated');
  expect(state.rows.get('cashAccounts/bank')).toMatchObject({ name: '변경 은행', openingBalance: 1200 });
  expect(state.rows.get('issuedStatements/opening-cash-punghoe-bank')?.totalAmount).toBe(1200);
  state.writes = [];
  expect(await executeFinancialOpening(store, 'punghoe', 'uid', input)).toBe('updated'); expect(state.writes).toEqual([]);
});
