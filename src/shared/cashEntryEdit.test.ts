import { describe, it, expect } from 'vitest';
import { buildCashEditPatch, cashEditAmount } from './cashEntryEdit';
import { journalizeCashEntry } from './autoJournal';
import type { CashEntry } from './types';

/**
 * 자금 전표 수정 모달 — 쪼개진 전표를 열어 저장하면 lines가 날아가던 자리.
 *
 * 모달이 accountCode 한 줄만 보내서, 대출상환(원금+이자)을 열었다 닫기만 해도
 * 화면의 쪼갠 줄이 사라졌다. DB에는 옛 줄이 남아 원장 금액과 분개가 따로 놀았다.
 */

const 대출상환: CashEntry = {
  id: 'cash-1', date: '2026-08-01', cashAccountId: 'bank-1', dir: '출금',
  amount: 600_000,
  lines: [
    { accountCode: '260', amount: 500_000, note: '원금' },
    { accountCode: '931', amount: 100_000, note: '이자' },
  ],
  createdAt: '',
};

const form = (over: Partial<Parameters<typeof buildCashEditPatch>[1]> = {}) => ({
  amount: '600000', date: '2026-08-01', dir: '출금' as const, accountCode: '', note: '대출 상환', ...over,
});

const draftOf = (e: CashEntry) => (e.lines ?? []).map(l => ({ accountCode: l.accountCode, amount: String(l.amount), note: l.note ?? '' }));

describe('쪼개진 전표를 열어 저장', () => {
  it('아무것도 안 고치고 저장하면 줄이 그대로 남는다', () => {
    const patch = buildCashEditPatch(대출상환, form(), draftOf(대출상환));
    expect(patch.lines).toEqual(대출상환.lines);
    expect(patch.amount).toBe(600_000);
  });

  it('줄을 고치면 금액은 줄 합으로 따라간다 — 원장과 분개가 안 갈린다', () => {
    const drafts = draftOf(대출상환);
    drafts[1].amount = '150000';          // 이자 10만 → 15만
    const patch = buildCashEditPatch(대출상환, form(), drafts);
    expect(patch.amount).toBe(650_000);
    const je = journalizeCashEntry({ ...대출상환, ...patch } as CashEntry, { 'bank-1': '103' });
    const 통장 = je!.lines.find(l => l.accountCode === '103');
    expect(통장!.credit).toBe(650_000);   // 통장에서 나간 금액 = 줄 합
  });

  it('accountCode는 안 쓴다 — 줄이 임자다', () => {
    const patch = buildCashEditPatch(대출상환, form({ accountCode: '811' }), draftOf(대출상환));
    expect(patch.accountCode).toBe('');
  });

  it('줄을 다 지우면 한 줄짜리로 되돌아간다 — 옛 줄이 안 남는다', () => {
    const patch = buildCashEditPatch(대출상환, form({ accountCode: '811' }), []);
    expect(patch.lines).toEqual([]);
    expect(patch.accountCode).toBe('811');
    const je = journalizeCashEntry({ ...대출상환, ...patch } as CashEntry, { 'bank-1': '103' });
    expect(je!.lines.map(l => l.accountCode).sort()).toEqual(['103', '811']);
  });

  it('계정이나 금액이 빈 줄은 안 센다 — 반쪽 줄은 시산표를 망가뜨린다', () => {
    const patch = buildCashEditPatch(대출상환, form(), [
      { accountCode: '260', amount: '500000', note: '원금' },
      { accountCode: '', amount: '100000', note: '' },
      { accountCode: '931', amount: '', note: '이자' },
    ]);
    expect(patch.lines).toEqual([{ accountCode: '260', amount: 500_000, note: '원금' }]);
    expect(patch.amount).toBe(500_000);
  });
});

describe('상계(대체) 전표', () => {
  const 상계: CashEntry = {
    id: 'cash-2', date: '2026-08-02', cashAccountId: '', dir: '대체', amount: 300_000,
    lines: [{ accountCode: '251', amount: 300_000 }, { accountCode: '108', amount: -300_000 }],
    createdAt: '',
  };

  it('열었다 저장해도 대체로 남는다 — 출금으로 바뀌면 없던 통장 줄이 선다', () => {
    const patch = buildCashEditPatch(상계, form({ dir: '출금', amount: '300000' }), draftOf(상계));
    expect(patch.dir).toBeUndefined();          // dir을 아예 안 건드린다
    const je = journalizeCashEntry({ ...상계, ...patch } as CashEntry, { 'bank-1': '103' });
    expect(je!.lines.some(l => l.accountCode === '103')).toBe(false);
  });

  it('줄 합이 0이라도 금액은 상계액 그대로다', () => {
    expect(cashEditAmount(form({ amount: '300000' }), draftOf(상계), true)).toBe(300_000);
  });

  it('부호 있는 줄을 살려 차·대가 맞는다', () => {
    const patch = buildCashEditPatch(상계, form({ amount: '300000' }), draftOf(상계));
    const je = journalizeCashEntry({ ...상계, ...patch } as CashEntry, {});
    expect(je!.lines).toEqual([
      { accountCode: '251', debit: 300_000, credit: 0 },
      { accountCode: '108', debit: 0, credit: 300_000 },
    ]);
  });
});
