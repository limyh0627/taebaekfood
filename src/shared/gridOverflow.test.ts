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

/**
 * **같은 사고가 `flex` 로도 난다** — grid 만 보면 절반을 놓친다.
 *
 * 2026-09-07 사장님: 재고관리 입출고 기록에서 "누가했는지랑 어디 쓰였는지 하나도 안 나오내".
 * 지운 게 아니었다. 2026-08-10(068fe86)에 **잔량·정정·전일재고 칸을 더하면서**
 * 못 박은 폭이 90px → 332px 이 됐고, 이름·비고가 들어가는 `flex-1` 칸이 폰에서 **0px 으로 눌렸다.**
 * 데이터는 멀쩡히 있는데 화면에 자리가 없었던 것이다. 데스크톱에서는 그대로 보여서 못 봤다.
 *
 * 규칙은 grid 와 같다 — **못 박은 칸이 260px 을 넘으면 옆으로 밀 수 있게 한다**
 * (`overflow-x-auto` + `min-w-[...]`). 칸을 감추지 않는다.
 */
const 훑기_flex = (): 걸린것[] => {
  const W = /\bw-(\d+)\b/;
  const out: 걸린것[] = [];
  for (const file of 파일들) {
    const L = readFileSync(file, 'utf8').split('\n');
    //  `shrink-0` 이 붙은 못 박은 칸 — 줄어들지 않으니 이것들의 합이 줄의 바닥폭이다
    const 못박은칸 = L.map((l, i) => ({ i, m: W.exec(l) }))
      .filter(x => x.m && L[x.i].includes('shrink-0') && !L[x.i].includes('min-w'))
      .map(x => ({ i: x.i, px: Number(x.m![1]) * 4 }));      // Tailwind w-N = N × 4px

    //  15줄 안에 모여 있으면 한 줄(row)로 본다
    const 묶음: { i: number; px: number }[][] = [];
    for (const c of 못박은칸) {
      const 끝 = 묶음[묶음.length - 1];
      if (끝 && c.i - 끝[끝.length - 1].i <= 15) 끝.push(c);
      else 묶음.push([c]);
    }

    for (const g of 묶음) {
      const fixed = g.reduce((a, c) => a + c.px, 0);
      if (g.length < 3 || fixed <= 260) continue;
      //  위로 100줄 안에서 담은 칸을 찾는다 — 밀 수 있으면 안 잘린다
      const 창 = L.slice(Math.max(0, g[0].i - 100), g[g.length - 1].i + 3).join('\n');
      if (창.includes('overflow-x-auto') || 창.includes('min-w-[')) continue;
      if (!창.includes('flex-1')) continue;                  // 눌릴 칸이 없으면 이 규칙 밖이다
      out.push({ file, line: g[0].i + 1, spec: `${g.length}칸`, fixed });
    }
  }
  return out;
};

/**
 * **봐주는 것** — 여기 적을 땐 이유를 같이 적는다. 비워 두면 그냥 잊힌다.
 *
 * `VoucherComposer` 의 둘은 **표가 아니라 입력 줄**이다(자금전표 쪼개기·대체전표 줄).
 * 옆으로 밀면 타이핑하다 칸이 화면 밖으로 나가서 지금보다 나빠진다 —
 * 접는 쪽(`flex-wrap`)으로 따로 고쳐야 한다. 할일.md 에 적어 뒀다.
 */
const 봐주는것 = new Set(['components/voucher/VoucherComposer.tsx']);

describe('칸 고정 줄(flex)도 폰에서 잘리면 안 된다', () => {
  it('못 박은 폭이 260px 을 넘으면 옆으로 밀 수 있어야 한다', () => {
    const 걸림 = 훑기_flex().filter(x => !봐주는것.has(x.file.replace(/\\/g, '/')));
    const 글 = 걸림.map(x => `  ${x.file}:${x.line}  못 박은 폭 ${x.fixed}px (${x.spec})`).join('\n');
    expect(걸림, `폰에서 잘릴 줄:\n${글}\n\n` +
      `고치는 법 — 담은 칸에 overflow-x-auto, 그 안에 min-w-[...] 를 준 상자를 두고\n` +
      `머리와 줄을 **같은 상자 안**에 넣는다(따로 두면 머리만 밀린다).`).toEqual([]);
  });

  it('봐주는 파일이 실제로 걸려 있다 — 고쳤으면 목록에서 빼라', () => {
    const 걸린파일 = new Set(훑기_flex().map(x => x.file.replace(/\\/g, '/')));
    const 헛것 = [...봐주는것].filter(f => !걸린파일.has(f));
    expect(헛것, `이미 고쳐졌는데 봐주는 목록에 남아 있다:\n${헛것.join('\n')}`).toEqual([]);
  });
});
