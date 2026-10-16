/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import { recordPartnerPayment } from '../src/features/statements/infrastructure/issueTradeStatementCommand';
import type { AccountCode, CashEntry, IssuedStatement } from '../src/shared/types';
import { lineAmount } from '../src/shared/lineAmount';

vi.mock('../src/features/statements/infrastructure/issueTradeStatementCommand', () => ({ recordPartnerPayment: vi.fn() }));
const accounts = [{ id: 'bank-1', companyId: 'taebaek' as const, name: '보통예금', active: true,
  type: '통장' as const, openingBalance: 0, openingDate: '2026-08-01', createdAt: '2026-08-01T00:00:00.000Z' }];

const 전표: IssuedStatement = {
  id: 'stmt-1', type: '매출', tradeDate: '2026-08-10', issuedAt: '2026-08-10T03:00:00.000Z',
  partnerId: 'partner-1', partnerName: '살림터', orderId: '', docNo: '260810-01',
  totalSupply: 1_428_000, totalTax: 0, totalAmount: 1_428_000,
  items: [{
    name: '참기름', spec: '', qty: 1, price: 1_428_000,
    supply: 1_428_000, tax: 0, total: 1_428_000, isTaxExempt: true, accountCode: '800',
  }],
};

const 계정 = [
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit' },
  { id: '800', code: '800', name: '제품매출', type: '수익', normalBalance: 'credit' },
] as AccountCode[];

it.each([
  [0.0001, '0.0001'], [1.2345, '1.2345'], [2.5, '2.5'], [20, '20'],
  [9007199254740991, '9,007,199,254,740,991'], [undefined, '0'], [NaN, '0'],
  [Infinity, '반품 연결 확인 중'],
] as const)('원장 전표 상세 수량 %s는 소수와 기존 결측·비유한 표시를 보존한다', (qty, shown) => {
  vi.mocked(recordPartnerPayment).mockClear();
  const amount = lineAmount(Number.isFinite(qty) ? Number(qty) : 1, 10000, true);
  const source = { ...전표, items: [{ ...전표.items[0], name: '원장 수량 검증', spec: 'kg', qty,
    price: 10000, supply: amount.supply, tax: amount.tax, total: amount.gross }],
    totalSupply: amount.supply, totalTax: amount.tax, totalAmount: amount.gross } as IssuedStatement;
  const original = structuredClone(source);
  render(<PartnerLedger companyId="taebaek" issuedStatements={[source]} cashEntries={[]} cashAccounts={accounts} accountCodes={계정} />);
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
  fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));
  fireEvent.click(within(screen.getByRole('table', { name: '거래처 전체 전표' })).getByRole('button', { name: source.docNo }));
  const dialog = screen.getByRole('dialog', { name: `전표 ${source.docNo}` });
  const cells = within(within(dialog).getByText('원장 수량 검증', { selector: 'td' }).closest('tr')!).getAllByRole('cell');
  expect(cells[1].textContent).toBe('kg'); expect(cells[2].textContent).toBe(shown);
  expect(cells[3].textContent).toBe('10,000');
  expect(cells[4].textContent).toBe(amount.supply.toLocaleString('ko-KR'));
  expect(cells[5].textContent).toBe('0'); expect(cells[6].textContent).toBe(amount.gross.toLocaleString('ko-KR'));
  expect(source).toEqual(original); expect(recordPartnerPayment).not.toHaveBeenCalled();
});

describe('거래처 원장 수금 입력', () => {
  it('전표의 남은 금액은 쉼표로 보이고 날짜는 그 전표일로 열린다', async () => {
    vi.mocked(recordPartnerPayment).mockResolvedValue(undefined);
    render(<PartnerLedger
      companyId="taebaek" issuedStatements={[전표]} cashEntries={[]} cashAccounts={accounts} accountCodes={계정}
    />);

    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.click(screen.getByRole('button', { name: '1,428,000 수금' }));

    const amount = screen.getByRole('textbox', { name: '수금 금액' });
    expect(amount).toHaveValue('1,428,000');
    expect(screen.getByLabelText('수금 날짜')).toHaveValue('2026-08-10');

    fireEvent.change(amount, { target: { value: '1000000' } });
    expect(amount).toHaveValue('1,000,000');
    fireEvent.change(screen.getByRole('combobox', { name: '입출금 계좌' }), { target: { value: 'bank-1' } });
    fireEvent.click(screen.getByRole('button', { name: '수금 기록' }));

    await waitFor(() => expect(recordPartnerPayment).toHaveBeenCalledWith('taebaek', expect.objectContaining({
      partnerId: 'partner-1', amount: 1_000_000, tradeDate: '2026-08-10', direction: '입금', cashAccountId: 'bank-1',
    })));
  });

  it('저장 실패 시 입력창을 유지하고 오류를 알린다', async () => {
    vi.mocked(recordPartnerPayment).mockRejectedValue(new Error('permission-denied'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<PartnerLedger companyId="taebaek" issuedStatements={[전표]} cashEntries={[]} cashAccounts={accounts} accountCodes={계정} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.click(screen.getByRole('button', { name: '1,428,000 수금' }));
    fireEvent.change(screen.getByRole('combobox', { name: '입출금 계좌' }), { target: { value: 'bank-1' } });
    fireEvent.click(screen.getByRole('button', { name: '수금 기록' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('permission-denied')));
    expect(screen.getByRole('textbox', { name: '수금 금액' })).toHaveValue('1,428,000');
    alert.mockRestore();
  });
});

describe('거래처 전체 전표와 계정별 잔액', () => {
  const cash: CashEntry = { id: 'stmt-1', date: '2026-08-11', createdAt: '2026-08-11T00:00:00Z', cashAccountId: 'bank-1',
    dir: '출금', amount: 200, partnerId: 'partner-1', partnerName: '살림터', accountCode: '133', docNo: 'CASH-SAME', note: '자금 선급' };
  const advance: IssuedStatement = { ...전표, id: 'advance', docNo: 'ADVANCE', type: '비용', tradeDate: '2026-08-12',
    totalSupply: 100, totalTax: 0, totalAmount: 100,
    items: [{ ...전표.items[0], name: '전표 선급', accountCode: '133', side: '차변', supply: 100, total: 100 },
      { ...전표.items[0], name: '기초 상대', accountCode: '375', side: '대변', supply: 100, total: 100 }] };
  it('종류와 계정에 관계없이 원문서를 한 번 보여주고 회사·ID 연결을 지킨다', () => {
    render(<PartnerLedger companyId="taebaek" issuedStatements={[전표, advance,
      { ...전표, companyId: 'punghoe', docNo: 'FOREIGN-SAME-ID', totalSupply: 99, totalAmount: 99,
        items: [{ ...전표.items[0], supply: 99, total: 99 }] },
      { ...전표, id: 'no-id', partnerId: '', docNo: 'NO-PARTNER-ID' }]}
      cashEntries={[cash]} cashAccounts={accounts} accountCodes={계정} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));
    const history = screen.getByRole('table', { name: '거래처 전체 전표' });
    expect(within(history).getAllByRole('button', { name: '260810-01' })).toHaveLength(1);
    expect(within(history).getAllByRole('button', { name: 'CASH-SAME' })).toHaveLength(1);
    expect(within(history).getAllByRole('button', { name: 'ADVANCE' })).toHaveLength(1);
    expect(within(history).queryByText('FOREIGN-SAME-ID')).not.toBeInTheDocument();
    expect(within(history).queryByText('NO-PARTNER-ID')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('거래처가 연결되지 않은 전표 1건');
    const balances = screen.getByRole('table', { name: '거래처 계정별 잔액' });
    const advanceRow = within(balances).getByRole('rowheader', { name: /133 선급금/ }).closest('tr')!;
    expect(within(advanceRow).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '300', '0', '300']);
    expect(within(balances).queryByRole('rowheader', { name: /375/ })).not.toBeInTheDocument();
    const receivable = within(balances).getByRole('rowheader', { name: /108 외상매출금/ }).closest('tr')!;
    expect(within(receivable).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '1,428,000', '0', '1,428,000']);
    fireEvent.change(screen.getByRole('combobox', { name: '계정 필터' }), { target: { value: '133' } });
    expect(within(history).queryByText('260810-01')).not.toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'ADVANCE' })).toBeInTheDocument();
  });
  it('동일 ID 자금의 상세가 발생전표와 섞이지 않고 회사 전환 때 숨겨진다', () => {
    const props = { issuedStatements: [전표, { ...전표, companyId: 'punghoe' as const, docNo: 'FOREIGN-SAME-ID' }],
      cashEntries: [cash], cashAccounts: accounts, accountCodes: 계정 };
    const { rerender } = render(<PartnerLedger companyId="taebaek" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));
    fireEvent.click(within(screen.getByRole('table', { name: '거래처 전체 전표' })).getByRole('button', { name: 'CASH-SAME' }));
    const dialog = screen.getByRole('dialog', { name: '전표 CASH-SAME' });
    expect(within(dialog).getAllByText('자금 선급').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('참기름')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /전표 화면에서 열기/ })).not.toBeInTheDocument();
    rerender(<PartnerLedger companyId="punghoe" {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('거래처·회사 전환 뒤 사용할 수 없는 계정 필터는 모든 계정으로 표시·조회한다', () => {
    const props = { cashEntries: [], cashAccounts: accounts, accountCodes: 계정,
      issuedStatements: [{ ...전표, items: [{ ...전표.items[0], accountCode: '900' }] },
        { ...전표, id: 'second', partnerId: 'partner-2', partnerName: '새거래처', docNo: 'SECOND' },
        { ...전표, companyId: 'punghoe' as const, docNo: 'FOREIGN' }] };
    const { rerender } = render(<PartnerLedger companyId="taebaek" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    fireEvent.change(screen.getByRole('combobox', { name: '계정 필터' }), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: '새거래처' }));
    expect(screen.getByRole('combobox', { name: '계정 필터' })).toHaveValue('');
    expect(within(screen.getByRole('table', { name: '거래처 전체 전표' })).getByRole('button', { name: 'SECOND' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '거래처 계정별 잔액' })).getAllByText('1,428,000')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '살림터' }));
    expect(screen.getByRole('combobox', { name: '계정 필터' })).toHaveValue('900');
    rerender(<PartnerLedger companyId="punghoe" {...props} />);
    expect(screen.getByRole('combobox', { name: '계정 필터' })).toHaveValue('');
    expect(within(screen.getByRole('table', { name: '거래처 전체 전표' })).getByRole('button', { name: 'FOREIGN' })).toBeInTheDocument();
  });
  it('분개가 불가능한 거래도 경고 이력에 남기고 계정잔액에서는 제외한다', () => {
    render(<PartnerLedger companyId="taebaek" issuedStatements={[{ ...전표, items: [{ ...전표.items[0], accountCode: undefined }] }]}
      cashEntries={[]} cashAccounts={accounts} accountCodes={계정} />);
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    fireEvent.click(screen.getByRole('button', { name: '매출 (미수)' }));
    fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));
    const history = screen.getByRole('table', { name: '거래처 전체 전표' });
    expect(within(history).getByRole('button', { name: '260810-01' })).toBeInTheDocument();
    expect(within(history).getByText(/분개 확인 필요:.*잔액 제외/)).toBeInTheDocument();
    const balances = screen.getByRole('table', { name: '거래처 계정별 잔액' });
    expect([...balances.querySelectorAll('tbody td')].every(cell => cell.textContent === '0')).toBe(true);
  });
});

describe('거래처 원장 월별 오늘 범위',()=>{
 beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T12:00:00+09:00'));vi.mocked(recordPartnerPayment).mockClear();});
 afterEach(()=>{vi.useRealTimers();});
 const make=(id:string,date:string,amount:number):IssuedStatement=>({...전표,id,companyId:'taebaek',tradeDate:date,issuedAt:date+'T03:00:00Z',docNo:id,totalSupply:amount,totalAmount:amount,items:[{...전표.items[0],qty:1,price:amount,supply:amount,total:amount}]});
 const baseProps={companyId:'taebaek' as const,cashEntries:[],cashAccounts:accounts,accountCodes:계정};
 function openSales(){fireEvent.click(screen.getByRole('button',{name:'매출 (미수)'}));fireEvent.click(screen.getByRole('button',{name:'살림터'}));fireEvent.click(screen.getByText('계정별 잔액·전체 전표 상세'));}
 const history=()=>screen.getByRole('table',{name:'거래처 전체 전표'});
 const receivable=()=>within(screen.getByRole('table',{name:'거래처 계정별 잔액'})).getByRole('rowheader',{name:/108 외상매출금/}).closest('tr')!;
 it('다음날 새 전표가 들어오면 선택월의 이력과 기간 금액에 포함한다',()=>{const first=make('FIRST','2026-10-15',100),next=make('NEXT','2026-10-16',200);const view=render(<PartnerLedger {...baseProps} issuedStatements={[first]}/>);fireEvent.click(screen.getByRole('button',{name:'월별'}));openSales();expect(within(history()).getByRole('button',{name:'FIRST'})).toBeInTheDocument();expect(within(receivable()).getAllByRole('cell').map(c=>c.textContent)).toEqual(['0','100','0','100']);vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00'));view.rerender(<PartnerLedger {...baseProps} issuedStatements={[first,next]}/>);expect(within(history()).getByRole('button',{name:'NEXT'})).toBeInTheDocument();expect(within(receivable()).getAllByRole('cell').map(c=>c.textContent)).toEqual(['0','300','0','300']);expect(recordPartnerPayment).not.toHaveBeenCalled();});
 it('새달에도 선택한 이전 달을 유지하고 새달 전표를 섞지 않는다',()=>{vi.setSystemTime(new Date('2026-10-31T12:00:00+09:00'));const first=make('OCTOBER','2026-10-31',100),next=make('NOVEMBER','2026-11-01',200);const view=render(<PartnerLedger {...baseProps} issuedStatements={[first]}/>);fireEvent.click(screen.getByRole('button',{name:'월별'}));openSales();vi.setSystemTime(new Date('2026-11-01T12:00:00+09:00'));view.rerender(<PartnerLedger {...baseProps} issuedStatements={[first,next]}/>);expect(view.container.querySelector('input[type="month"]')).toHaveValue('2026-10');expect(within(history()).getByRole('button',{name:'OCTOBER'})).toBeInTheDocument();expect(within(history()).queryByRole('button',{name:'NOVEMBER'})).not.toBeInTheDocument();expect(within(receivable()).getAllByRole('cell').map(c=>c.textContent)).toEqual(['0','100','0','100']);expect(recordPartnerPayment).not.toHaveBeenCalled();});
 it.each(['기간','전체'])('%s 모드는 다음날에도 기존 필터 정책을 유지한다',mode=>{const first=make('FIRST','2026-10-15',100),next=make('NEXT','2026-10-16',200);const view=render(<PartnerLedger {...baseProps} issuedStatements={[first]}/>);fireEvent.click(screen.getByRole('button',{name:mode}));openSales();vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00'));view.rerender(<PartnerLedger {...baseProps} issuedStatements={[first,next]}/>);expect(within(history()).getByRole('button',{name:'FIRST'})).toBeInTheDocument();expect(!!within(history()).queryByRole('button',{name:'NEXT'})).toBe(mode==='전체');if(mode==='기간')expect(view.container.querySelectorAll('input[type="date"]')[1]).toHaveValue('2026-10-15');expect(recordPartnerPayment).not.toHaveBeenCalled();});
});
