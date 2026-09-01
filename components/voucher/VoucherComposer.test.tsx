/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import type { AccountCode, AccountGroup, CashAccount, Partner, IssuedStatement } from '../../src/shared/types';

/**
 * **한 번 나간 돈의 성격이 둘 이상일 때 갈라 적는가.**
 *
 * 이 창의 값어치는 거기 있다. 대출상환을 전액 이자비용으로 몰면 손익이 그만큼 줄고,
 * 4대보험을 전액 비용으로 몰면 예수금이 영영 안 줄고, 세금을 비용으로 몰면
 * 부가세예수금이 그대로 남는다. **통장에서는 한 번 나가지만 전표는 두 줄이다.**
 *
 * 그림(어느 칸이 어디 있나)은 안 잠근다. 잠그면 화면을 못 고친다.
 * 잠그는 건 **넘어가는 값**이다.
 */
const 계정: AccountCode[] = [
  { id: 'a1', code: '260', name: '단기차입금', normalBalance: 'credit' },
  { id: 'a2', code: '293', name: '장기차입금', normalBalance: 'credit' },
  { id: 'a3', code: '951', name: '이자비용', normalBalance: 'debit' },
  { id: 'a4', code: '801', name: '급여', normalBalance: 'debit' },
  { id: 'a5', code: '254', name: '예수금', normalBalance: 'credit' },
  { id: 'a6', code: '530', name: '사대보험', normalBalance: 'debit' },
  { id: 'a7', code: '255', name: '부가세예수금', normalBalance: 'credit' },
  { id: 'a8', code: '338', name: '인출금', normalBalance: 'debit' },
  { id: 'a9', code: '811', name: '차량유지비', normalBalance: 'debit' },
  { id: 'a10', code: '103', name: '보통예금', normalBalance: 'debit' },
] as AccountCode[];
const 분류: AccountGroup[] = [
  { id: 'g1', name: '비용', type: '비용' }, { id: 'g2', name: '부채', type: '부채' },
] as AccountGroup[];
const 통장: CashAccount[] = [{ id: 'bank1', name: '농협 주계좌', active: true }] as CashAccount[];
const 거래처: Partner[] = [{ id: 'p1', name: '청양식품' }] as Partner[];

/** 저장된 템플릿 — `kind: 'voucher'` 라야 이 창의 목록에 오른다 */
const 템플릿 = (over: Record<string, unknown>) => ({
  id: 't-' + (over.name as string), kind: 'voucher', name: '이름', amount: 0, ...over,
} as never);

function 띄우기(over: Partial<Parameters<typeof VoucherComposer>[0]> = {}) {
  const onAddCashEntry = vi.fn(), onAddForCompany = vi.fn(), onClose = vi.fn(), recordPayment = vi.fn();
  render(<VoucherComposer
    companyId="taebaek"
    initialDir="출금"
    initialDate="2026-08-10"
    partners={거래처}
    accountCodes={계정}
    accountGroups={분류}
    cashAccounts={통장}
    fixedCostTemplates={[]}
    cashEntries={[]}
    statements={[] as IssuedStatement[]}
    partnerBalances={new Map()}
    getBalance={s => s.totalAmount}
    cashAccountId="bank1"
    onCashAccountId={vi.fn()}
    onClose={onClose}
    onAddCashEntry={onAddCashEntry}
    onAddForCompany={onAddForCompany}
    recordPayment={recordPayment}
    renderJournal={() => null}
    {...over}
  />);
  return { onAddCashEntry, onAddForCompany, onClose, recordPayment };
}

/** 갈래 단추 — 제목 줄에 있다(출금·입금·대체·줄돈·받을돈·회사이체) */
const 갈래 = async (u: ReturnType<typeof userEvent.setup>, name: string) =>
  u.click(screen.getByRole('button', { name }));
/**
 * **갈래 안의 갈래(상환·급여·보험·세금)는 단추가 없다 — 템플릿을 골라야 들어간다.**
 * 그게 실제 경로다. 템플릿이 갈래·계정·금액을 다 들고 있어서, 사용자는 이름만 고른다.
 */
const 템플릿고르기 = async (u: ReturnType<typeof userEvent.setup>, label: string) => {
  await u.click(screen.getByRole('button', { name: /템플릿/ }));
  await u.click(await screen.findByRole('button', { name: new RegExp(label) }));
};
/** 라벨에 괄호 설명이 붙는 칸이 있다(회사부담 (비용) 처럼) — 앞부분으로 찾는다 */
const 채우기 = async (u: ReturnType<typeof userEvent.setup>, label: string, v: string) => {
  const el = screen.getByLabelText(new RegExp('^' + label)) as HTMLInputElement;
  await u.clear(el); await u.type(el, v);
};
const 저장 = async (u: ReturnType<typeof userEvent.setup>) =>
  u.click(screen.getByRole('button', { name: /발행|저장/ }));

describe('한 번 나간 돈을 성격대로 가른다', () => {
  it('대출상환 — 원금은 차입금, 이자는 이자비용. 통장은 합계만큼 나간다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '원금', '440000');
    await 채우기(u, '이자', '30280');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.dir).toBe('출금');
    expect(e.amount).toBe(470_280);                    // 통장에서 나간 건 한 번, 합계만큼
    expect(e.lines).toEqual([
      { accountCode: '260', amount: 440_000, note: '원금' },
      { accountCode: '951', amount: 30_280, note: '이자' },
    ]);
  });

  it('이자만 있으면 줄을 안 쪼갠다 — 줄이 하나면 옛 전표와 같은 모양이어야 한다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '이자', '30280');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.lines).toBeUndefined();
    expect(e.accountCode).toBe('951');
    expect(e.note).toContain('이자');
  });

  it('4대보험 — 회사부담은 비용, 근로자부담은 예수금을 턴다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '4대보험', mode: '보험', dir: '출금', accountCode: '530' })] });
    await 템플릿고르기(u, '4대보험');
    await 채우기(u, '회사부담', '500000');
    await 채우기(u, '근로자부담', '300000');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.amount).toBe(800_000);
    expect(e.lines).toEqual([
      { accountCode: '530', amount: 500_000, note: '회사부담' },
      { accountCode: '254', amount: 300_000, note: '근로자부담(예수금)' },
    ]);
  });

  it('세금 — 부가세는 예수금(부채), 소득세는 인출금(자본). **둘 다 비용이 아니다**', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '세금 납부', mode: '세금', dir: '출금', accountCode: '255' })] });
    await 템플릿고르기(u, '세금 납부');
    await 채우기(u, '부가세', '1200000');
    await 채우기(u, '소득세', '400000');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.amount).toBe(1_600_000);
    expect(e.lines).toEqual([
      { accountCode: '255', amount: 1_200_000, note: '부가세' },
      { accountCode: '338', amount: 400_000, note: '소득세' },
    ]);
    //  비용 계정이 한 줄도 없어야 한다 — 전액 비용으로 몰면 이익이 그만큼 줄어 보인다
    expect(e.lines.map((l: { accountCode: string }) => l.accountCode)).not.toContain('530');
  });
});

describe('돈이 안 움직이는 갈래', () => {
  it('대체는 차·대가 안 맞으면 못 낸다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기();
    await 갈래(u, '대체');
    expect(screen.getByRole('button', { name: /발행|저장/ })).toBeDisabled();
  });
});

describe('회사 간 이체 — 두 장부에 한 건씩', () => {
  it('보내는 회사와 받는 회사 양쪽에 선다', async () => {
    const u = userEvent.setup();
    const { onAddForCompany } = 띄우기();
    await 갈래(u, '회사이체');
    await 채우기(u, '금액', '5000000');
    await 저장(u);
    expect(onAddForCompany).toHaveBeenCalledTimes(2);
    const [보내는, 받는] = onAddForCompany.mock.calls;
    expect(보내는[0]).toBe('taebaek');
    expect(받는[0]).toBe('punghoe');
    expect(보내는[1].cashEntry.dir).toBe('출금');
    expect(받는[1].cashEntry.dir).toBe('입금');
    expect(보내는[1].cashEntry.amount).toBe(5_000_000);
    expect(받는[1].cashEntry.amount).toBe(5_000_000);
  });
});

describe('닫기', () => {
  it('내고 나면 창이 닫힌다', async () => {
    const u = userEvent.setup();
    const { onClose } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '이자', '1000');
    await 저장(u);
    expect(onClose).toHaveBeenCalled();
  });
});
