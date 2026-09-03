import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPaymentEntry } from './payment';

/**
 * **수금·지불은 한 곳에서만 짓는다.** (2026-09-03 사장님 지시)
 *
 * 세어 보니 같은 걸 짓는 자리가 셋이었다 — 거래처원장·반품처리·거래명세서.
 * 셋 다 "매출이면 108 입금, 매입이면 251 출금"을 손으로 적고 있었다.
 *
 * 그리고 **규칙을 적어 놓고도 내가 바로 어겼다** — 거래처원장에 기능을 옮기면서
 * 또 한 벌 적었다. 사장님이 짚어 줘서 알았다. 글로 적은 규칙은 안 지켜진다.
 * 그래서 **테스트가 지키게 한다.**
 */
describe('수금·지불 한 건', () => {
  const 기본 = { partnerId: 'p1', partnerName: '가득찬식품', amount: 1_000_000, date: '2026-09-03' };

  it('매출 거래처에서 받으면 입금 · 108', () => {
    const e = buildPaymentEntry({ ...기본, type: '매출' });
    expect(e.dir).toBe('입금');
    expect(e.accountCode).toBe('108');
    expect(e.note).toBe('가득찬식품 수금');
  });

  it('매입 거래처에 주면 출금 · 251', () => {
    const e = buildPaymentEntry({ ...기본, type: '매입' });
    expect(e.dir).toBe('출금');
    expect(e.accountCode).toBe('251');
    expect(e.note).toBe('가득찬식품 지불');
  });

  it('**되돌림은 방향을 뒤집는다** — 부호를 음수로 만들지 않는다', () => {
    //  매출 반품이면 받은 돈을 되돌리니 출금이다. 계정은 그대로 108.
    const e = buildPaymentEntry({ ...기본, type: '매출', reverse: true });
    expect(e.dir).toBe('출금');
    expect(e.accountCode).toBe('108');
    expect(e.amount).toBe(1_000_000);
  });

  it('시각 도장은 stampFor — 소급이면 그날 맨 뒤', () => {
    const e = buildPaymentEntry({ ...기본, type: '매출', date: '2020-01-01' });
    //  2020-01-01 23:59:59 KST = 같은 날 14:59:59Z (아홉 시간 빼도 날짜가 안 넘어간다)
    expect(e.createdAt).toBe('2020-01-01T14:59:59.000Z');
  });

  it('전표번호는 주면 담고, 안 주면 안 담는다 — 빈 글자를 넣지 않는다', () => {
    expect(buildPaymentEntry({ ...기본, type: '매출', docNo: '260903-001' }).docNo).toBe('260903-001');
    expect('docNo' in buildPaymentEntry({ ...기본, type: '매출' })).toBe(false);
  });

  it('금액은 반올림한다', () => {
    expect(buildPaymentEntry({ ...기본, type: '매출', amount: 1000.6 }).amount).toBe(1001);
  });
});

/**
 * **다시 손으로 짓지 못하게 막는다.**
 * 화면 안에서 `accountCode: 매출 ? '108' : '251'` 같은 걸 또 적으면 여기가 걸린다.
 */
describe('손으로 다시 짓는 자리가 없다', () => {
  const 읽기 = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  const 화면 = ['../../components/PartnerLedger.tsx', '../features/admin/AdminApp.tsx',
                '../../components/TradeStatement.tsx', '../../components/CashLedger.tsx'];

  it('**108/251 을 손으로 가르는 자리가 없다** — shared/payment 를 쓴다', () => {
    const 걸린것: string[] = [];
    for (const f of 화면) {
      const src = 읽기(f);
      //  `... ? '108' : '251'` 꼴 — 수금·지불을 손으로 짓는 자국
      if (/\?\s*'108'\s*:\s*'251'/.test(src) || /\?\s*'251'\s*:\s*'108'/.test(src)) 걸린것.push(f);
    }
    expect(걸린것, `여기서 손으로 짓고 있다: ${걸린것.join(', ')}`).toEqual([]);
  });
});
