import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { sellsTo, buysFrom, isFinancial } from './partnerRole';

const c = (t?: string) => ({ partnerType: t } as any);

describe('sellsTo — 파는 상대인가', () => {
  it('매출처와 매출+매입처', () => {
    expect(sellsTo(c('매출처'))).toBe(true);
    expect(sellsTo(c('매출+매입처'))).toBe(true);
  });
  it('**갈래가 안 적힌 옛 거래처는 매출처로 본다**', () => {
    expect(sellsTo(c(undefined))).toBe(true);
    expect(sellsTo({} as any)).toBe(true);
  });
  it('매입처·금융기관은 아니다', () => {
    expect(sellsTo(c('매입처'))).toBe(false);
    expect(sellsTo(c('금융기관'))).toBe(false);
  });
  it('없는 거래처는 아니다', () => {
    expect(sellsTo(undefined)).toBe(true);   // 빈 값도 안 적힌 것으로 본다
  });
});

describe('buysFrom — 사 오는 상대인가', () => {
  it('매입처와 매출+매입처', () => {
    expect(buysFrom(c('매입처'))).toBe(true);
    expect(buysFrom(c('매출+매입처'))).toBe(true);
  });
  it('**안 적힌 것은 매입처가 아니다** — 엉뚱한 데서 사 온 게 된다', () => {
    expect(buysFrom(c(undefined))).toBe(false);
    expect(buysFrom(undefined)).toBe(false);
  });
  it('매출처·금융기관은 아니다', () => {
    expect(buysFrom(c('매출처'))).toBe(false);
    expect(buysFrom(c('금융기관'))).toBe(false);
  });
});

describe('두 판정은 비대칭이다 — 그게 규칙이다', () => {
  it('안 적힌 거래처는 매출은 되고 매입은 안 된다', () => {
    expect(sellsTo(c(undefined))).toBe(true);
    expect(buysFrom(c(undefined))).toBe(false);
  });
  it('매출+매입처는 양쪽 다 된다', () => {
    expect(sellsTo(c('매출+매입처'))).toBe(true);
    expect(buysFrom(c('매출+매입처'))).toBe(true);
  });
});

describe('isFinancial', () => {
  it('금융기관만', () => {
    expect(isFinancial(c('금융기관'))).toBe(true);
    expect(isFinancial(c('매출처'))).toBe(false);
    expect(isFinancial(c(undefined))).toBe(false);
  });
});

/**
 * **거래처 갈래 판정을 손으로 적지 않는다.**
 *
 * 갈래가 넷이라 조건을 매번 두 개씩 쓰게 되고, 그러다 **받침(`!c.partnerType`)을
 * 빼먹으면 갈래가 안 적힌 옛 거래처가 목록에서 통째로 사라진다.**
 * 열두 곳에 손으로 적혀 있었다(2026-09-05).
 */
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.'))
  .filter(f => {
    const q = f.replace(/\\/g, '/');
    //  거래처를 만들고 고치는 화면은 갈래를 **고르는** 자리라 값을 직접 쓴다
    return !q.endsWith('src/shared/partnerRole.ts')
      && !q.endsWith('components/AddPartnerModal.tsx')
      && !q.endsWith('components/PartnerManager.tsx');
  });

describe('갈래 판정을 손으로 적지 않는다', () => {
  it("`partnerType === '매출처'` 같은 걸 직접 견주는 곳이 없다", () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/partnerType\s*===\s*'(매출처|매입처|매출\+매입처)'/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
        }
      });
    }
    expect(걸림, `갈래를 손으로 견주는 곳:\n${걸림.join('\n')}\n\n` +
      `shared/partnerRole 의 sellsTo · buysFrom · isFinancial 을 써라.`).toEqual([]);
  });
});
