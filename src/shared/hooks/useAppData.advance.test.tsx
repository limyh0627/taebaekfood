// @vitest-environment jsdom
import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({listeners:[] as {name:string;company:string;callback:(rows:any[])=>void}[],verify:vi.fn(),auth:{currentUser:{uid:'uid'}}}));
vi.mock('../firebase',()=>({authReady:Promise.resolve(),auth:mocks.auth,db:{}}));
vi.mock('firebase/firestore',()=>({where:(field:string,op:string,value:string)=>({field,op,value}),doc:vi.fn(),getDoc:vi.fn()}));
vi.mock('../partnerAdvanceAudit',()=>({verifyAdvanceStatements:mocks.verify}));
vi.mock('../services/firebaseService',()=>({subscribeToCollection:(name:string,callback:(rows:any[])=>void,clauses:{field:string;value:string}[])=>{mocks.listeners.push({name,callback,company:clauses.find(row=>row.field==='companyId')?.value??''});return()=>{};},subscribeToRecentCollection:()=>()=>{},subscribeToDocument:()=>()=>{},fetchCollection:async()=>[],fetchDateRange:async()=>[]}));
vi.mock('./useCompanyInfoRead',()=>({useCompanyInfoRead:()=>({value:null,status:'idle',error:'',retry:()=>{},observationToken:{},isCurrent:()=>false})}));
import {useAppData} from './useAppData';
const emit=(name:string,company:string,rows:any[])=>mocks.listeners.filter(row=>row.name===name&&row.company===company).at(-1)!.callback(rows);
const statement=(id:string,companyId:string)=>({id,companyId,partnerId:'p',items:[],tradeDate:'2026-10-01',noncashApplication:{kind:'advance-application'}});
beforeEach(()=>{mocks.listeners=[];mocks.verify.mockReset();mocks.auth.currentUser={uid:'uid'};});
it('회사 전환 후 늦게 끝난 이전 감사 검증은 새 회사 투영을 덮지 않는다',async()=>{
 let resolveA!:(rows:any[])=>void;
 mocks.verify.mockImplementation((company:string,rows:any[])=>company==='taebaek'?new Promise(resolve=>{resolveA=resolve;}):Promise.resolve(rows));
 const {result,rerender}=renderHook(({company})=>useAppData(true,company,true),{initialProps:{company:'taebaek' as 'taebaek'|'punghoe'}});
 await waitFor(()=>expect(mocks.listeners.some(row=>row.name==='partnerAdvanceOperations'&&row.company==='taebaek')).toBe(true));
 act(()=>{emit('issuedStatements','taebaek',[statement('a','taebaek')]);emit('partnerAdvanceOperations','taebaek',[]);});
 await waitFor(()=>expect(resolveA).toBeDefined());
 rerender({company:'punghoe'});expect(result.current.advanceStatements).toBeUndefined();
 await waitFor(()=>expect(mocks.listeners.some(row=>row.name==='partnerAdvanceOperations'&&row.company==='punghoe')).toBe(true));
 act(()=>{emit('issuedStatements','punghoe',[statement('b','punghoe')]);emit('partnerAdvanceOperations','punghoe',[]);});
 await waitFor(()=>expect(result.current.advanceStatements?.map(row=>row.id)).toEqual(['b']));
 await act(async()=>resolveA([statement('a','taebaek')]));
 expect(result.current.advanceStatements?.map(row=>row.id)).toEqual(['b']);
});
it('확인되지 않은 한 거래처 감사만 제외하고 정상 거래처 검증은 유지한다',async()=>{
 mocks.verify.mockImplementation((_company:string,rows:any[])=>rows[0].partnerId==='bad'?Promise.reject(new Error('감사 누락')):Promise.resolve(rows));
 const {result}=renderHook(()=>useAppData(true,'taebaek',true));
 await waitFor(()=>expect(mocks.listeners.some(row=>row.name==='partnerAdvanceOperations')).toBe(true));
 act(()=>{emit('issuedStatements','taebaek',[{...statement('bad','taebaek'),partnerId:'bad'},{...statement('good','taebaek'),partnerId:'good'}]);emit('partnerAdvanceOperations','taebaek',[]);});
 await waitFor(()=>expect(result.current.advanceStatements?.map(row=>row.id)).toEqual(['good']));
});
