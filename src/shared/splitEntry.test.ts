import { describe, it, expect } from 'vitest';
import { splitCashEntry, payrollEntries } from './splitEntry';

const 때 = 1_780_000_000_000;
const base = { date: '2026-09-05', cashAccountId: 'bank1' };

describe('splitCashEntry — 한 번 나간 돈을 성격대로 가른다', () => {
  it('대출 상환: 원금은 차입금, 이자만 비용 — 합계는 통장에서 나간 금액', () => {
    const e = splitCashEntry({
      lines: [
        { accountCode: '260', amount: 1_000_000, note: '원금' },
        { accountCode: '931', amount: 50_000, note: '이자' },
      ],
      fallbackNote: '대출 상환', base, now: 때,
    })!;
    expect(e.amount).toBe(1_050_000);
    expect(e.dir).toBe('출금');
    expect(e.lines).toHaveLength(2);
    expect(e.accountCode).toBeUndefined();   // 여러 줄이면 머리에 계정을 안 단다
    expect(e.note).toBe('대출 상환');
  });

  it('**줄이 하나면 계정 하나로 끊고 적요에 무엇인지 붙인다**', () => {
    const e = splitCashEntry({
      lines: [{ accountCode: '931', amount: 50_000, note: '이자' }],
      fallbackNote: '대출 상환', base, now: 때,
    })!;
    expect(e.lines).toBeUndefined();
    expect(e.accountCode).toBe('931');
    expect(e.note).toBe('대출 상환 (이자)');
  });

  it('금액이 0인 줄은 빠진다 — 원금만 갚은 달', () => {
    const e = splitCashEntry({
      lines: [
        { accountCode: '260', amount: 1_000_000, note: '원금' },
        { accountCode: '931', amount: 0, note: '이자' },
      ],
      fallbackNote: '대출 상환', base, now: 때,
    })!;
    expect(e.amount).toBe(1_000_000);
    expect(e.accountCode).toBe('260');
    expect(e.note).toBe('대출 상환 (원금)');
  });

  it('가를 줄이 없으면 안 만든다', () => {
    expect(splitCashEntry({ lines: [], fallbackNote: '대출 상환', base })).toBeNull();
    expect(splitCashEntry({
      lines: [{ accountCode: '260', amount: 0, note: '원금' }],
      fallbackNote: '대출 상환', base,
    })).toBeNull();
  });

  it('적요를 적으면 그걸 쓴다', () => {
    const e = splitCashEntry({
      lines: [{ accountCode: '260', amount: 100, note: '원금' }, { accountCode: '931', amount: 10, note: '이자' }],
      note: '농협 8월분', fallbackNote: '대출 상환', base,
    })!;
    expect(e.note).toBe('농협 8월분');
  });

  it('공백만 적으면 기본말을 쓴다', () => {
    const e = splitCashEntry({
      lines: [{ accountCode: '260', amount: 100, note: '원금' }, { accountCode: '931', amount: 10, note: '이자' }],
      note: '   ', fallbackNote: '대출 상환', base,
    })!;
    expect(e.note).toBe('대출 상환');
  });

  it('4대보험: 회사부담은 비용, 근로자부담은 예수금을 턴다', () => {
    const e = splitCashEntry({
      lines: [
        { accountCode: '530', amount: 600_000, note: '회사부담' },
        { accountCode: '254', amount: 400_000, note: '근로자부담(예수금)' },
      ],
      fallbackNote: '4대보험', base, now: 때,
    })!;
    expect(e.amount).toBe(1_000_000);
    expect(e.lines?.map(l => l.accountCode)).toEqual(['530', '254']);
  });

  it('세금: 부가세도 소득세도 비용이 아니다 — 부채와 인출금으로 간다', () => {
    const e = splitCashEntry({
      lines: [
        { accountCode: '255', amount: 3_000_000, note: '부가세' },
        { accountCode: '338', amount: 1_000_000, note: '소득세' },
      ],
      fallbackNote: '세금 납부', base, now: 때,
    })!;
    expect(e.amount).toBe(4_000_000);
    expect(e.lines?.map(l => l.accountCode)).toEqual(['255', '338']);
  });

  it('화면이 준 공통 칸을 그대로 싣는다', () => {
    const e = splitCashEntry({
      lines: [{ accountCode: '260', amount: 100, note: '원금' }],
      fallbackNote: '대출 상환',
      base: { date: '2026-08-31', partnerId: 'p1', partnerName: '농협', companyId: 'punghoe' } as any,
    })!;
    expect(e).toMatchObject({ date: '2026-08-31', partnerName: '농협', companyId: 'punghoe' });
  });
});

describe('payrollEntries — 급여는 두 건이다', () => {
  it('총급여 출금 + 원천공제 입금', () => {
    const es = payrollEntries({
      gross: 3_000_000, deduction: 300_000,
      salaryCode: '801', withholdCode: '254', base, now: 때,
    });
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ dir: '출금', amount: 3_000_000, accountCode: '801' });
    expect(es[1]).toMatchObject({ dir: '입금', amount: 300_000, accountCode: '254' });
  });

  it('**실지급액 한 건으로 끊지 않는다** — 급여 비용이 그만큼 적게 잡힌다', () => {
    const es = payrollEntries({
      gross: 3_000_000, deduction: 300_000,
      salaryCode: '801', withholdCode: '254', base, now: 때,
    });
    expect(es[0].amount).toBe(3_000_000);   // 2,700,000 이 아니다
  });

  it('공제가 없으면 한 건', () => {
    const es = payrollEntries({
      gross: 3_000_000, deduction: 0,
      salaryCode: '801', withholdCode: '254', base, now: 때,
    });
    expect(es).toHaveLength(1);
  });

  it('총급여가 없으면 안 만든다', () => {
    expect(payrollEntries({
      gross: 0, deduction: 100, salaryCode: '801', withholdCode: '254', base,
    })).toEqual([]);
  });

  it('두 건의 id 가 겹치지 않는다 — 겹치면 하나가 다른 하나를 덮어쓴다', () => {
    const es = payrollEntries({
      gross: 100, deduction: 10, salaryCode: '801', withholdCode: '254', base, now: 때,
    });
    expect(es[0].id).not.toBe(es[1].id);
  });
});
