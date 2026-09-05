import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { AR, AP, OTHER_PAYABLE, VAT_PAYABLE, VAT_RECEIVABLE, BANK, INVENTORY } from './autoJournal';

/**
 * **계정코드는 [autoJournal](autoJournal.ts) 한 곳에서 온다.**
 *
 * 번호를 화면에 그냥 박아 두면, **계정번호를 표준으로 옮길 때 한쪽만 고쳐진다**
 * (그 계획이 [docs/표준계정과목-이전계획.md](../../docs/표준계정과목-이전계획.md) 에 있고 아직 안 했다).
 *
 * 2026-09-05 에 훑어보니 cashLedger·interCompany 가 값을 손으로 옮겨 적었고,
 * ProfitAnalysis·financials 는 숫자를 그대로 견주고 있었다.
 */
const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.endsWith('autoJournal.ts'));

/** 이 번호들은 이름이 있다 — 숫자로 쓰면 안 된다 */
const 이름있는코드: Record<string, string> = {
  [AR]: 'AR', [AP]: 'AP', [OTHER_PAYABLE]: 'OTHER_PAYABLE',
  [VAT_PAYABLE]: 'VAT_PAYABLE', [VAT_RECEIVABLE]: 'VAT_RECEIVABLE',
  [BANK]: 'BANK', [INVENTORY]: 'INVENTORY',
};

describe('계정코드를 화면에 박지 않는다', () => {
  it('이름 있는 계정번호를 글자로 쓴 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 파일들) {
      let 주석중 = false;
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('/*') || t.startsWith('{/*')) 주석중 = true;
        const 끝남 = 주석중 && (t.endsWith('*/') || t.endsWith('*/}'));
        const 건너뜀 = 주석중 || t.startsWith('//') || t.startsWith('*');
        if (끝남) 주석중 = false;
        if (건너뜀) return;

        for (const [code, name] of Object.entries(이름있는코드)) {
          //  `'108'` 처럼 따옴표에 싸인 것만 — 계정표에서 읽은 값(`?? '255'`)은 받침이라 봐준다
          if (!new RegExp(`(?<!\\?\\?\\s)'${code}'`).test(l)) continue;
          걸림.push(`  ${file}:${i + 1}  '${code}' → ${name}   ${t.slice(0, 70)}`);
        }
      });
    }
    expect(걸림, `계정번호를 글자로 박은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/autoJournal 에서 가져다 써라. 표준계정과목으로 옮길 때 여기가 안 걸리면 틀어진다.`)
      .toEqual([]);
  });
});
