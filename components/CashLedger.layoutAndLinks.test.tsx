/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CashLedger from './CashLedger';
import { today } from '../src/shared/day';
import type { CashAccount, CashEntry, Settlement } from '../src/shared/types';

afterEach(cleanup);
const account: CashAccount = {id:'bank',companyId:'taebaek',name:'합성 통장',type:'통장',active:true,openingDate:'2026-01-01',openingBalance:1000,createdAt:''};
const entry: CashEntry = {id:'cash',companyId:'taebaek',cashAccountId:'bank',date:today(),dir:'입금',amount:100,note:'합성 입금',createdAt:''};
const callbacks = () => ({onAddCashAccount:vi.fn(),onUpdateCashAccount:vi.fn(),onAddCashEntry:vi.fn(),onDeleteCashEntry:vi.fn(),onAddSettlement:vi.fn(),onDeleteSettlement:vi.fn()});
const settlement=(id:string,cashEntryId:string,statementId:string):Settlement=>({id,cashEntryId,statementId,amount:1,createdAt:''});
const linked=[settlement('1','cash','a'),settlement('2','cash','a'),settlement('3','cash','b'),settlement('4','cash','orphan'),settlement('5','cash',''),settlement('6','cash','   '),settlement('7','other','unrelated')];

it('같은 전표의 중복 연결은 한 건으로 세고 기존 매칭 화면을 열고 닫아도 쓰지 않는다', () => {
 const cb=callbacks();
 render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[entry]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={linked} {...cb} />);
 fireEvent.click(screen.getByRole('button',{name:'연결 전표 3건'}));
 expect(screen.getByText('매칭된 전표')).toBeInTheDocument();
 expect(screen.getByText('합성 입금',{selector:'p'})).toBeInTheDocument();
 expect(screen.getByText(/orphan/)).toBeInTheDocument();
 const dialog=screen.getByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:/닫기/}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 Object.values(cb).forEach(fn=>expect(fn).not.toHaveBeenCalled());
});

it('잔액 조정에 잘못 연결된 전표는 읽기 표시만 하고 매칭을 열지 않는다', () => {
 const cb=callbacks(); const adjustment:CashEntry={...entry,id:'adjust',balanceAdjustment:{before:1000,target:1100,delta:100,reason:'확인'}};
 render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[adjustment]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[settlement('bad','adjust','a')]} {...cb} />);
 expect(screen.getByText('연결 전표 1건').tagName).toBe('SPAN');
 expect(screen.getByTitle('전표 매칭')).toBeDisabled();
 expect(screen.queryByRole('button',{name:'연결 전표 1건'})).not.toBeInTheDocument();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 Object.values(cb).forEach(fn=>expect(fn).not.toHaveBeenCalled());
});

it('계좌 확정 잔액의 비정상 연결도 읽기만 허용한다', () => {
 const cb=callbacks();
 const confirmed:CashAccount={...account,confirmedBalances:[{date:today(),balance:0,recordedAt:new Date().toISOString(),reason:'은행 확인'}]};
 render(<CashLedger companyId="taebaek" cashAccounts={[confirmed]} cashEntries={[]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[settlement('bad',`account-confirmed:bank:${today()}`,'a')]} {...cb} />);
 expect(screen.getByText('연결 전표 1건').tagName).toBe('SPAN');
 expect(screen.queryByRole('button',{name:'연결 전표 1건'})).not.toBeInTheDocument();
 expect(screen.queryByTitle('전표 매칭')).not.toBeInTheDocument();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 Object.values(cb).forEach(fn=>expect(fn).not.toHaveBeenCalled());
});
