import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STANDARD_ACCOUNT, STANDARD_ACCOUNT_ADDITIONS } from './accountChart';

describe('표준 계정표', () => {
  it('비품은 자산, 소모품비는 비용으로 갈라져 있다', () => {
    expect(STANDARD_ACCOUNT.FIXTURES).toBe('122');
    expect(STANDARD_ACCOUNT.SUPPLIES_EXPENSE).toBe('830');
    expect(STANDARD_ACCOUNT_ADDITIONS).toContainEqual(expect.objectContaining({
      code: '830', name: '소모품비', type: '비용', normalBalance: 'debit',
    }));
  });

  it('이전 스크립트가 옛 전표·기초잔액·거래처 기본계정을 함께 옮긴다', () => {
    const src = readFileSync('scripts/fix-standard-chart.mts', 'utf8');
    expect(src).toContain("'partner_item'");
    expect(src).toContain("'openingBalances'");
    expect(src).toContain('Account_Code: conv');
    expect(src).toContain('amounts: next');
    expect(src).toContain('existsSync(BACKUP)');
    expect(src).toContain('STANDARD_ACCOUNT_ADDITIONS');
  });
});

