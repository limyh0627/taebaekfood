import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * **칸 넓이를 고정한 표가 폰에서 안 잘리는지 글자로 확인한다.**
 *
 * `grid-cols-[1fr_100px_100px_120px]` 처럼 고정 칸이 여럿이면, 폰(안쪽 폭 약 330px)에서
 * **`1fr` 이 0으로 눌린다.** 머리글이 '품/목' 으로 접히고 뒷칸이 화면 밖으로 나간다
 * (2026-09-05 사장님이 견적서에서 발견, 훑어보니 네 곳이 더 있었다).
 *
 * 규칙 — 고정 칸 합이 260px 을 넘으면
 *   ① 늘어나는 칸에 **최소 폭**을 준다 (`minmax(140px,1fr)`)
 *   ② 표에 `min-w-[...]` 를 주고 담은 칸을 `overflow-x-auto` 로 민다
 *
 * 어차피 옆으로 미는 표다. **미는 김에 안 잘리는 게 맞다**(사장님).
 */

const 파일들 = globSync('{components,src/features}/**/*.tsx');

/** `grid-cols-[...]` 안의 고정 px 합 */
const 고정폭 = (spec: string) =>
  [...spec.matchAll(/(?<![\d(,])(\d+)px/g)].reduce((a, m) => a + Number(m[1]), 0);

const 늘어나는칸 = (spec: string) => /(?:^|_)(?:minmax\([^)]*\)|1fr|auto)(?:_|$)/.test(spec);

interface 걸린것 { file: string; line: number; spec: string; fixed: number }

const 훑기 = (): 걸린것[] => {
  const out: 걸린것[] = [];
  for (const file of 파일들) {
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/grid-cols-\[([^\]]+)\]/g)) {
        const spec = m[1];
        if (!늘어나는칸(spec)) continue;          // 전부 고정이면 이 규칙 밖이다
        const fixed = 고정폭(spec);
        if (fixed <= 260) continue;               // 폰에도 들어간다
        //  최소 폭과 min-w 가 둘 다 있어야 안 잘린다
        const 최소폭있나 = /minmax\(\s*\d+px/.test(spec);
        const 밀수있나 = /min-w-\[\d+px\]/.test(l);
        if (최소폭있나 && 밀수있나) continue;
        out.push({ file, line: i + 1, spec, fixed });
      }
    });
  }
  return out;
};

describe('칸 고정 표는 폰에서 잘리면 안 된다', () => {
  it('고정 폭이 260px 을 넘으면 최소 폭과 min-w 를 함께 준다', () => {
    const 걸림 = 훑기();
    const 글 = 걸림.map(x => `  ${x.file}:${x.line}  고정 ${x.fixed}px  grid-cols-[${x.spec}]`).join('\n');
    expect(걸림, `폰에서 잘릴 표:\n${글}\n\n` +
      `고치는 법 — 늘어나는 칸에 minmax(140px,1fr) 을 주고, 표에 min-w-[...] 를 주고\n` +
      `담은 칸을 overflow-x-auto 로 민다.`).toEqual([]);
  });
});
