import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { COL, isKnownCollection } from './collections';

/**
 * **적어 둔 컬렉션 목록이 실제로 쓰는 것과 같은지 확인한다.**
 *
 * 이름을 글자로 쓰면 오타가 **조용히 지나간다** — 없는 컬렉션이 새로 생기고,
 * 쓴 쪽은 성공했다고 여기고 읽는 쪽은 영영 빈 목록을 본다. 화면에 아무 표시도 안 난다.
 *
 * 목록에 없는 이름이 코드에 나타나면 **둘 중 하나다** —
 *   ① 오타다 (고쳐라)
 *   ② 새 컬렉션이다 (collections.ts 에 적어라)
 */
const 파일들 = globSync('{components,src,scripts,functions/src}/**/*.{ts,tsx,mts}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/collections.ts'));

/**
 * DB 를 부르는 자리에서 첫 인자로 쓴 글자.
 *
 * **부르는 모양이 여럿이다** — 처음엔 `addItem` 계열만 봤다가
 * `fetchWhere`·`setDocument`, 그리고 상수에 담아 쓰는 것(`const COL = 'dashboardLinks'`)을
 * 놓쳤다(2026-09-06). 타입을 좁히고 나서야 컴파일러가 잡아 줬다.
 */
const 부르는곳 =
  /(?:addItem|updateItem|deleteItem|adjustItemStock|setDocument|fetchCollection|fetchDateRange|fetchWhere|subscribeToCollection|subscribeToRecentCollection)\s*(?:<[^>]*>)?\s*\(\s*'([a-zA-Z_]\w*)'|collection\(\s*db\s*,\s*'([a-zA-Z_]\w*)'|const\s+COL\s*=\s*'([a-zA-Z_]\w*)'/gm;

const 쓰는이름 = (): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const file of 파일들) {
    const src = readFileSync(file, 'utf8');
    for (const hit of src.matchAll(부르는곳)) {
      const name = hit[1] ?? hit[2] ?? hit[3];
      if (!name) continue;
      m.set(name, [...(m.get(name) ?? []), file]);
    }
  }
  return m;
};

describe('컬렉션 이름', () => {
  it('코드에 쓰인 이름이 모두 collections.ts 에 있다', () => {
    const 모름 = [...쓰는이름().entries()].filter(([n]) => !isKnownCollection(n));
    const 글 = 모름.map(([n, fs]) => `  '${n}'  ←  ${[...new Set(fs)].join(', ')}`).join('\n');
    expect(모름, `collections.ts 에 없는 컬렉션 이름:\n${글}\n\n` +
      `오타면 고치고, 새 컬렉션이면 collections.ts 에 적어라.`).toEqual([]);
  });

  it('적어 두고 안 쓰는 이름이 없다 — 목록이 실제와 어긋나면 그물이 헐거워진다', () => {
    const 쓰임 = 쓰는이름();
    const 안쓰는것 = Object.entries(COL).filter(([, v]) => !쓰임.has(v)).map(([k, v]) => `  ${k}: '${v}'`);
    expect(안쓰는것, `collections.ts 에 있는데 코드에 안 쓰는 이름:\n${안쓰는것.join('\n')}\n\n` +
      `안 쓰면 지워라.`).toEqual([]);
  });

  it('키와 값이 어긋나지 않는다 — 카멜케이스 이름은 값과 같아야 한다', () => {
    //  `haccp_temp` 처럼 밑줄이 든 것만 키와 값이 다르다(키는 카멜, 값은 DB 이름).
    const 어긋남 = Object.entries(COL)
      .filter(([k, v]) => !v.includes('_') && k !== v)
      .map(([k, v]) => `  ${k} → '${v}'`);
    expect(어긋남, `키와 값이 다른 것:\n${어긋남.join('\n')}`).toEqual([]);
  });
});

/**
 * **회사 가르기는 `companyOf` 만 안다.**
 *
 * 회사가 안 적힌 옛 기록은 **태백으로 본다**(`companyOf` 가 그렇게 정한다).
 * 손으로 `(x.companyId ?? 'taebaek')` 을 적으면 그 규칙이 갈리고,
 * 받침을 빼먹으면 **옛 기록이 통째로 빠진다** — 화면에 표시가 안 난다.
 */
describe('회사 가르기', () => {
  it("`?? 'taebaek'` 을 손으로 적지 않는다 — companyOf 를 쓴다", () => {
    const 걸림: string[] = [];
    //  **앱 코드만 본다.** 스크립트(scripts/)와 스케줄러(functions/)는 앱 모듈을
    //  못 가져다 쓴다 — 일회용이고 따로 도는 코드다(할일에 그 건이 있다).
    const 앱코드 = 파일들.filter(f => {
      const q = f.replace(/\\/g, '/');
      return !q.startsWith('scripts/') && !q.startsWith('functions/')
        && !q.endsWith('src/shared/types.ts');   // companyOf 가 사는 곳
    });
    for (const file of 앱코드) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/companyId\s*\?\?\s*'taebaek'/.test(l)) 걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
      });
    }
    expect(걸림, `회사 받침을 손으로 적은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/types 의 companyOf 를 써라.`).toEqual([]);
  });
});
