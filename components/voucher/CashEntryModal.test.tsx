/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CashEntryModal, { type CashModalMode } from './CashEntryModal';
import type { IssuedStatement, CashEntry, AccountCode } from '../../src/shared/types';

/**
 * **이 창은 돈이 나가는 자리다.** 그래서 눈으로 보고 넘기면 안 된다.
 *
 * 여기 잠근 것들은 전부 **실제로 한 번씩 틀렸던 것**이다 —
 * 총액이 기본값이라 이미 절반 낸 전표에서 또 나갔고(카드대금 899,925),
 * 날짜가 오늘로 박혀 소급 전표마다 손으로 고쳤고,
 * 쪼갠 줄을 창이 안 들고 있어 열었다 닫기만 해도 사라졌다.
 */

const 매출전표 = (over: Partial<IssuedStatement> = {}): IssuedStatement => ({
  id: 'st1', type: '매출', tradeDate: '2026-08-28', issuedAt: '2026-08-28',
  partnerId: 'p1', partnerName: '청양식품', orderId: '', docNo: '260828-01',
  totalSupply: 1_000_000, totalTax: 0, totalAmount: 1_000_000,
  items: [{ name: '참기름', spec: '', qty: 1, price: 1_000_000, supply: 1_000_000, tax: 0, total: 1_000_000, isTaxExempt: true, accountCode: '800' }],
  ...over,
} as IssuedStatement);

const 자금 = (over: Partial<CashEntry> = {}): CashEntry => ({
  id: 'c1', date: '2026-08-20', dir: '출금', amount: 500_000,
  accountCode: '811', note: '기름값', partnerId: 'p1', partnerName: '청양식품',
  ...over,
} as CashEntry);

const 계정: AccountCode[] = [
  { id: 'a1', code: '811', name: '차량유지비' },
  { id: 'a2', code: '801', name: '급여' },
  { id: 'a3', code: '254', name: '예수금' },
] as AccountCode[];

const 잔액 = new Map([['p1', { receivable: 1_500_000, payable: 300_000 }]]);

function 띄우기(mode: CashModalMode, over: Partial<Parameters<typeof CashEntryModal>[0]> = {}) {
  const onSettle = vi.fn(), onSaveEdit = vi.fn(), onClose = vi.fn(), onDeleteEntry = vi.fn(), onAccountId = vi.fn();
  //  남은 금액 = 총액 − 이미 낸 것. 테스트가 따로 주지 않으면 총액이 곧 남은 금액이다.
  const getBalance = over.getBalance ?? ((s: IssuedStatement) => s.totalAmount);
  render(<CashEntryModal
    mode={mode}
    accountCodes={계정}
    cashAccounts={[{ id: 'bank1', name: '농협 주계좌' }, { id: 'bank2', name: '수협' }]}
    accountId="bank1"
    onAccountId={onAccountId}
    partnerBalances={잔액}
    getBalance={getBalance}
    latestStatement={id => (mode.kind === '수금지불' && mode.stmt.id === id ? mode.stmt : undefined)}
    onClose={onClose}
    onSettle={onSettle}
    onSaveEdit={onSaveEdit}
    onDeleteEntry={onDeleteEntry}
    {...over}
  />);
  return { onSettle, onSaveEdit, onClose, onDeleteEntry, onAccountId };
}

/**
 * 라벨이 `<label htmlFor>`로 안 묶여 있어 **자리로** 집는다.
 * 라벨 옆에 단추가 끼는 자리가 있어(계정과목 옆 '+ 줄 추가') 한 칸 더 올라가며 찾는다.
 * 화면 구조를 바꾸면 여기가 먼저 깨진다 — 그게 이 헬퍼의 값이기도 하다.
 */
const 입력칸 = (label: string) => {
  let box: HTMLElement | null = screen.getByText(label, { selector: 'label' }).parentElement;
  for (let up = 0; box && up < 3; up++, box = box.parentElement) {
    const el = box.querySelector('input, select');
    if (el) return el as HTMLInputElement | HTMLSelectElement;
  }
  throw new Error(`'${label}' 입력칸을 못 찾았다`);
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('수금·지불 — 전표에서 연다', () => {
  it('금액 기본값은 총액이 아니라 **남은 금액**이다', async () => {
    //  100만원 전표에 60만원을 이미 받았다 → 40만원이 떠야 한다.
    //  총액이 뜨면 이미 받은 60만원이 또 나간다(카드대금 899,925이 두 번 나간 게 그 꼴이었다).
    띄우기({ kind: '수금지불', stmt: 매출전표() }, { getBalance: () => 400_000 });
    expect((입력칸('금액') as HTMLInputElement).value).toBe('400000');
  });

  it('일자 기본값은 오늘이 아니라 **그 전표 날짜**다', () => {
    띄우기({ kind: '수금지불', stmt: 매출전표({ tradeDate: '2026-08-28' }) });
    expect((입력칸('일자') as HTMLInputElement).value).toBe('2026-08-28');
  });

  it('이미 낸 게 있으면 먼저 밝힌다', () => {
    띄우기({ kind: '수금지불', stmt: 매출전표() }, { getBalance: () => 400_000 });
    expect(screen.getByText(/이 전표에 이미/)).toHaveTextContent('600,000원 수금했습니다');
  });

  it('매입이면 지불, 매출이면 수금으로 뜬다', () => {
    띄우기({ kind: '수금지불', stmt: 매출전표({ type: '매입' }) });
    expect(screen.getByRole('heading')).toHaveTextContent('지불 처리');
  });

  it("'거래처 잔액'을 누르면 금액이 바뀌고 **날짜는 안 바뀐다**", async () => {
    const u = userEvent.setup();
    띄우기({ kind: '수금지불', stmt: 매출전표() });
    expect((입력칸('일자') as HTMLInputElement).value).toBe('2026-08-28');
    await u.click(screen.getByText('거래처 잔액'));
    expect((입력칸('금액') as HTMLInputElement).value).toBe('1500000');   // 그 거래처 미수 전액
    //  전표에서 연 수금이라 날짜는 언제나 그 전표 날짜다 — 상자를 바꿔도 안 건드린다
    expect((입력칸('일자') as HTMLInputElement).value).toBe('2026-08-28');
  });

  it('잔액을 넘기면 바로 안 나가고 **선수금 경고**부터 뜬다', async () => {
    const u = userEvent.setup();
    const { onSettle } = 띄우기({ kind: '수금지불', stmt: 매출전표() });
    const amt = 입력칸('금액') as HTMLInputElement;
    await u.clear(amt); await u.type(amt, '2000000');          // 미수 1,500,000 보다 많다
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(onSettle).not.toHaveBeenCalled();
    expect(screen.getByText(/초과합니다/)).toHaveTextContent('선수금으로 전환됩니다');
  });

  it('매입은 초과분이 **선급금**이라고 나온다', async () => {
    const u = userEvent.setup();
    띄우기({ kind: '수금지불', stmt: 매출전표({ type: '매입' }) });
    const amt = 입력칸('금액') as HTMLInputElement;
    await u.clear(amt); await u.type(amt, '900000');            // 미지급 300,000 보다 많다
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(screen.getByText(/초과합니다/)).toHaveTextContent('선급금으로 전환됩니다');
  });

  it("경고에서 '계속 진행'을 눌러야 나간다", async () => {
    const u = userEvent.setup();
    const { onSettle } = 띄우기({ kind: '수금지불', stmt: 매출전표() });
    const amt = 입력칸('금액') as HTMLInputElement;
    await u.clear(amt); await u.type(amt, '2000000');
    await u.click(screen.getByRole('button', { name: /저장/ }));
    await u.click(screen.getByRole('button', { name: '계속 진행' }));
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][1]).toMatchObject({ amount: 2_000_000, scope: 'stmt' });
  });

  it('잔액 안쪽이면 경고 없이 그대로 나간다', async () => {
    const u = userEvent.setup();
    const { onSettle } = 띄우기({ kind: '수금지불', stmt: 매출전표() });
    const note = 입력칸('비고') as HTMLInputElement;
    await u.type(note, '1차 분할');
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][1]).toMatchObject({
      amount: 1_000_000, date: '2026-08-28', method: '계좌이체', note: '1차 분할', scope: 'stmt',
    });
  });

  it("'거래처 잔액'을 골랐으면 그 뜻이 그대로 실려 나간다 — 전표에 안 붙는다", async () => {
    const u = userEvent.setup();
    const { onSettle } = 띄우기({ kind: '수금지불', stmt: 매출전표() });
    await u.click(screen.getByText('거래처 잔액'));
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(onSettle.mock.calls[0][1].scope).toBe('partner');
  });

  it('금액이 0이면 저장 단추가 안 눌린다', async () => {
    const u = userEvent.setup();
    띄우기({ kind: '수금지불', stmt: 매출전표() });
    await u.clear(입력칸('금액'));
    expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled();
  });

  it('통장을 바꾸면 밖으로 알린다 — 창을 닫아도 기억해야 하는 값이다', async () => {
    const u = userEvent.setup();
    const { onAccountId } = 띄우기({ kind: '수금지불', stmt: 매출전표() });
    await u.selectOptions(입력칸('입금 계좌'), 'bank2');
    expect(onAccountId).toHaveBeenCalledWith('bank2');
  });
});

describe('자금 전표 수정 — 이미 난 것을 고친다', () => {
  it('열면 그 전표 값이 그대로 들어와 있다', () => {
    띄우기({ kind: '수정', entry: 자금() });
    expect((입력칸('금액') as HTMLInputElement).value).toBe('500000');
    expect((입력칸('일자') as HTMLInputElement).value).toBe('2026-08-20');
    expect((입력칸('계정과목') as HTMLSelectElement).value).toBe('811');
    expect((입력칸('비고') as HTMLInputElement).value).toBe('기름값');
  });

  it('거래처와 잔액을 같이 띄운다 — 어느 거래처 돈인지 모르고 고치던 자리다', () => {
    띄우기({ kind: '수정', entry: 자금() });
    expect(screen.getByText('청양식품').parentElement).toHaveTextContent('미수 1,500,000');
    expect(screen.getByText('청양식품').parentElement).toHaveTextContent('미지급 300,000');
  });

  it('**쪼갠 줄이 그대로 실려 나간다** — 열었다 저장만 해도 사라지던 자리다', async () => {
    const u = userEvent.setup();
    const { onSaveEdit } = 띄우기({ kind: '수정', entry: 자금({
      amount: 2_700_000,
      lines: [
        { accountCode: '801', amount: 3_000_000, note: '총급여' },
        { accountCode: '254', amount: -300_000, note: '원천공제' },
      ],
    }) });
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit.mock.calls[0][2]).toEqual([
      { accountCode: '801', amount: '3000000', note: '총급여' },
      { accountCode: '254', amount: '-300000', note: '원천공제' },
    ]);
  });

  it('쪼갠 전표의 금액은 **줄 합계**고 손으로 못 고친다', () => {
    띄우기({ kind: '수정', entry: 자금({
      amount: 2_700_000,
      lines: [
        { accountCode: '801', amount: 3_000_000, note: '총급여' },
        { accountCode: '254', amount: -300_000, note: '원천공제' },
      ],
    }) });
    const amt = 입력칸('금액') as HTMLInputElement;
    expect(amt.value).toBe('2700000');     // 3,000,000 − 300,000
    expect(amt).toHaveAttribute('readOnly');
  });

  it("'+ 줄 추가'를 처음 누르면 지금 계정·금액을 물려받는다", async () => {
    const u = userEvent.setup();
    const { onSaveEdit } = 띄우기({ kind: '수정', entry: 자금() });
    await u.click(screen.getByRole('button', { name: '+ 줄 추가' }));
    await u.click(screen.getByRole('button', { name: /저장/ }));
    expect(onSaveEdit.mock.calls[0][2]).toEqual([{ accountCode: '811', amount: '500000', note: '' }]);
  });

  it('상계(대체)는 방향을 못 바꾸고 그렇다고 말해 준다', () => {
    띄우기({ kind: '수정', entry: 자금({
      dir: '대체', amount: 0,
      lines: [{ accountCode: '108', amount: 500_000, note: '' }, { accountCode: '251', amount: -500_000, note: '' }],
    }) });
    expect(screen.getByRole('button', { name: '입금' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '출금' })).toBeDisabled();
    expect(screen.getByText(/상계\(대체\) 전표/)).toBeVisible();
  });

  it('상계는 줄 합이 0이라 금액칸을 안 잠근다 — 잠그면 0원으로 저장된다', () => {
    띄우기({ kind: '수정', entry: 자금({
      dir: '대체', amount: 500_000,
      lines: [{ accountCode: '108', amount: 500_000, note: '' }, { accountCode: '251', amount: -500_000, note: '' }],
    }) });
    expect(입력칸('금액')).not.toHaveAttribute('readOnly');
  });

  it('삭제는 되묻고 나서 지운다', async () => {
    const u = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onDeleteEntry, onClose } = 띄우기({ kind: '수정', entry: 자금() });
    await u.click(screen.getByRole('button', { name: /삭제/ }));
    expect(onDeleteEntry).not.toHaveBeenCalled();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await u.click(screen.getByRole('button', { name: /삭제/ }));
    expect(onDeleteEntry).toHaveBeenCalledWith('c1');
    expect(onClose).toHaveBeenCalled();
  });

  it('금액이 0이면 저장 단추가 안 눌린다', async () => {
    const u = userEvent.setup();
    띄우기({ kind: '수정', entry: 자금() });
    await u.clear(입력칸('금액'));
    expect(screen.getByRole('button', { name: /저장/ })).toBeDisabled();
  });
});
