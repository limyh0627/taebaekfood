import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CashAccount } from '../types';
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, writes: [] as Record<string, unknown>[], company: 'taebaek', admin: true }));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: {currentUser: {getIdTokenResult: async () => ({claims: {companyId: state.company, isAdmin: state.admin}})}} }));
vi.mock('firebase/firestore', () => ({doc: (_db: unknown, collection: string, id: string) => ({path: `${collection}/${id}`}), runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<void>) => { await run({get: async () => ({exists: () => !!state.row, data: () => state.row}), update: (_ref: unknown, patch: Record<string, unknown>) => {state.writes.push(patch); state.row = {...state.row, ...patch};}}); }}));
import {saveConfirmedCashBalance, saveConfirmedCashBalanceWithDb} from './confirmedCashBalance';
const account: CashAccount = {id:'bank', companyId:'taebaek', name:'은행', type:'통장', active:true, openingDate:'2026-07-31', openingBalance:100, createdAt:''};
const store = {} as Firestore;
beforeEach(() => {state.row={...account};state.writes=[];state.company='taebaek';state.admin=true;});
it('문서 data.id가 없는 계좌에도 0원 기준값만 저장한다', async () => {
 delete state.row!.id;
 await saveConfirmedCashBalance('taebaek', account, '2026-08-31', 0, ' 은행 확인 ');
 expect(state.writes).toHaveLength(1); expect(Object.keys(state.writes[0])).toEqual(['confirmedBalances']);
 expect(state.row).toMatchObject({openingBalance:100, confirmedBalances:[{date:'2026-08-31',balance:0,reason:'은행 확인'}]});
});
it('최신 계좌에 다른 날짜 이력이 추가되어도 보존하고 같은 날짜만 교체한다', async () => {
 state.row!.confirmedBalances=[{date:'2026-08-31',balance:50,reason:'기존',recordedAt:'2026-09-01T00:00:00Z'}, {date:'2026-09-30',balance:70,reason:'다른 날짜',recordedAt:'2026-10-01T00:00:00Z'}];
 await saveConfirmedCashBalanceWithDb(store,'taebaek',account,'2026-08-31',-10,'수정');
 expect(state.row!.confirmedBalances).toEqual([expect.objectContaining({date:'2026-08-31',balance:-10}),expect.objectContaining({date:'2026-09-30',balance:70})]);
});
it.each(['foreign','missing','inactive','opening'])('%s 최신 계좌 변경은 저장하지 않는다', async kind => {
 if(kind==='foreign')state.row!.companyId='punghoe';if(kind==='missing')state.row=null;if(kind==='inactive')state.row!.active=false;if(kind==='opening')state.row!.openingDate='2026-08-01';
 await expect(saveConfirmedCashBalance('taebaek',account,'2026-08-31',0,'확인')).rejects.toThrow();expect(state.writes).toHaveLength(0);
});
it.each(['company','admin'])('%s 권한 오류를 거절한다', async kind => {
 if(kind==='company')state.company='punghoe';else state.admin=false;
 await expect(saveConfirmedCashBalance('taebaek',account,'2026-08-31',0,'확인')).rejects.toThrow();expect(state.writes).toHaveLength(0);
});
it.each([['2026-07-30',0,'확인'],['2026-02-30',0,'확인'],['2099-01-01',0,'확인'],['2026-08-31',0.5,'확인'],['2026-08-31',0,' ']] as const)('잘못된 입력을 거절한다 %s', async (date,balance,reason) => {
 await expect(saveConfirmedCashBalance('taebaek',account,date,balance,reason)).rejects.toThrow();expect(state.writes).toHaveLength(0);
});
it('손상된 기존 이력을 덮어쓰지 않는다', async () => {state.row!.confirmedBalances=[null];await expect(saveConfirmedCashBalance('taebaek',account,'2026-08-31',0,'확인')).rejects.toThrow();expect(state.writes).toHaveLength(0);});
