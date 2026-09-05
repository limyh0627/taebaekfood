import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **꺼둔 채 남겨 둔 코드를 잡는다.**
 *
 * `{false && (...)}` 로 화면 한 덩어리를 꺼두고 지우지 않으면, **살아 있는 줄 알고
 * 고치게 된다.** 실제로 그랬다 — 세금계산서 발행 화면이 [TaxStatement](../../components/TaxStatement.tsx)
 * 로 옮겨진 뒤에도 [TradeStatement](../../components/TradeStatement.tsx) 에 364줄이
 * `{false && ...}` 로 남아 있었고, 2026-09-05 에 그걸 살아 있는 코드로 보고 손을 댔다.
 *
 * 지우기 아까우면 git 에 있다. **화면 코드에 시체를 두지 않는다.**
 */
const 파일들 = globSync('{components,src/features}/**/*.tsx');

/** 늘 거짓이라 절대 안 그려지는 자리 */
const 죽은패턴 = [
  /\{\s*false\s*&&/,
  /&&\s*false\s*\}/,
  /\{\s*0\s*&&/,
];

describe('꺼둔 화면 코드를 남기지 않는다', () => {
  it('{false && ...} 로 꺼둔 덩어리가 없다', () => {
    const 걸림: string[] = [];
    for (const file of 파일들) {
      //  주석은 건너뛴다 — 규칙을 설명하는 글에도 그 패턴이 들어간다
      let 주석중 = false;
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('/*') || t.startsWith('{/*')) 주석중 = true;
        const 끝남 = 주석중 && (t.endsWith('*/') || t.endsWith('*/}'));
        const 건너뜀 = 주석중 || t.startsWith('//') || t.startsWith('*');
        if (끝남) 주석중 = false;
        if (건너뜀) return;
        if (죽은패턴.some(re => re.test(l))) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
      });
    }
    expect(걸림, `꺼둔 채 남은 코드:\n${걸림.join('\n')}\n\n` +
      `지워라. 되살릴 일이 있으면 git 에 있다.`).toEqual([]);
  });
});
