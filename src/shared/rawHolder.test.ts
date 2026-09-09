import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { rawHolderById, rawHolderByName, resolveRawHolder, rawLedgerKeys, isRawHolder } from './rawHolder';
import type { Item } from './types';

/**
 * **연결은 이름이 아니라 열쇠(id)로 건다** — 인수인계.md.
 *
 * 이름은 바뀌고 겹친다. 참깨·깻묵은 태백·풍회가 **각자** 들고 있어서, 이름으로 찾아
 * 첫 항목을 집으면 남의 회사 재고를 깎는다. 풍회 깨분이 원장 2,000kg 에 로트 0kg 으로
 * 갈려 있던 것도 같은 뿌리다(2026-09-09).
 */

const 품목 = (o: Partial<Item>): Item => ({
  id: 'x', name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 0,
  ...o,
} as Item);

const 태백참깨 = 품목({ id: 'raw-참깨', name: '참깨' });
const 풍회참깨 = 품목({ id: 'raw-참깨-punghoe', name: '참깨', companyId: 'punghoe' });
const 태백들깨 = 품목({ id: 'raw-들깨', name: '들깨' });
const 모두 = [태백참깨, 풍회참깨, 태백들깨];

describe('홀더 판정', () => {
  it('근거는 subtype 하나다', () => {
    expect(isRawHolder(품목({ subtype: '벌크' }))).toBe(true);
    //  `type: 'raw'` 라도 subtype 이 비면 홀더가 아니다 — 태백 깻묵이 이래서 자리마다 다르게 보였다.
    expect(isRawHolder(품목({ subtype: '' }))).toBe(false);
    expect(isRawHolder(품목({ subtype: '벌크', phantom: true }))).toBe(false);
    expect(isRawHolder(품목({ subtype: '벌크', archived: true }))).toBe(false);
    expect(isRawHolder(undefined)).toBe(false);
  });
});

describe('열쇠로 고른다', () => {
  it('id 로 곧장 찾는다', () => {
    expect(rawHolderById(모두, 'raw-참깨-punghoe')?.id).toBe('raw-참깨-punghoe');
  });

  it('회사를 같이 주면 다른 회사 것은 안 준다', () => {
    expect(rawHolderById(모두, 'raw-참깨', 'punghoe')).toBeUndefined();
    expect(rawHolderById(모두, 'raw-참깨', 'taebaek')?.id).toBe('raw-참깨');
  });

  it('없는 id 는 undefined', () => {
    expect(rawHolderById(모두, '없는id')).toBeUndefined();
    expect(rawHolderById(모두, undefined)).toBeUndefined();
  });
});

describe('이름으로 고를 때 — 남의 회사 것을 대신 집지 않는다', () => {
  it('회사를 주면 그 회사 것만', () => {
    expect(rawHolderByName(모두, '참깨', 'punghoe')?.id).toBe('raw-참깨-punghoe');
    expect(rawHolderByName(모두, '참깨', 'taebaek')?.id).toBe('raw-참깨');
  });

  it('**그 회사에 없으면 아무것도 안 준다** — 예전 `?? holders[0]` 이 사고를 냈다', () => {
    //  들깨는 태백만 있다. 풍회로 물으면 태백 것을 대신 주면 안 된다.
    expect(rawHolderByName(모두, '들깨', 'punghoe')).toBeUndefined();
  });

  it('회사를 안 주면 태백을 먼저 본다 — 배열 순서에 기대지 않는다', () => {
    expect(rawHolderByName([풍회참깨, 태백참깨], '참깨')?.id).toBe('raw-참깨');
  });

  it('태백에도 없고 후보가 둘 이상이면 고르지 않는다', () => {
    const 풍회2 = 품목({ id: 'b', name: '참깨', companyId: 'other' as never });
    expect(rawHolderByName([풍회참깨, 풍회2], '참깨')).toBeUndefined();
  });

  it('후보가 하나뿐이면 회사가 달라도 준다 — 옛 기록을 읽어야 한다', () => {
    expect(rawHolderByName([풍회참깨], '참깨')?.id).toBe('raw-참깨-punghoe');
  });
});

describe('열쇠 먼저, 없으면 이름', () => {
  it('열쇠가 있으면 이름이 어긋나도 그걸 쓴다', () => {
    //  검정참깨가 이 경우였다 — 홀더 이름은 '검정참깨' 인데 원장엔 '검정깨' 로 적혀 있었다.
    const h = resolveRawHolder(모두, { rawItemId: 'raw-들깨', material: '엉뚱한이름' });
    expect(h?.id).toBe('raw-들깨');
  });

  it('열쇠가 없으면 이름으로 떨어진다', () => {
    expect(resolveRawHolder(모두, { material: '참깨', companyId: 'punghoe' })?.id).toBe('raw-참깨-punghoe');
  });
});

describe('원장에 박을 열쇠', () => {
  it('회사와 품목 id 를 같이 낸다', () => {
    expect(rawLedgerKeys(풍회참깨)).toEqual({ companyId: 'punghoe', rawItemId: 'raw-참깨-punghoe' });
    //  companyId 가 없는 옛 품목은 태백이다.
    expect(rawLedgerKeys(태백참깨)).toEqual({ companyId: 'taebaek', rawItemId: 'raw-참깨' });
  });
});

describe('원장을 쓰는 자리는 열쇠를 반드시 박는다', () => {
  it('rawMaterialLedger 쓰기 옆에 rawLedgerKeys 가 있다', () => {
    //  열쇠를 안 박으면 그 줄은 나중에 **이름으로 되짚어야** 한다. 그게 갈림의 뿌리였다.
    const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
      .map(f => f.replace(/\\/g, '/'))
      .filter(f => !f.includes('.test.'));
    const 빠진곳: string[] = [];
    for (const f of 파일들) {
      const src = readFileSync(f, 'utf8');
      //  원장에 **새 줄을 만드는** 자리만 본다(삭제·조회는 아니다).
      //  범위를 글자수로 어림잡았더니 **뒤따라오는 다른 코드의 `rawItemId` 를 주워** 놓치고
      //  지나갔다(일부러 빼 보고 알았다). 그래서 중괄호 짝을 세어 **그 객체 안만** 본다.
      for (const m of src.matchAll(/(?:addItem|setDoc)\s*\(/g)) {
        //  첫 인자가 원장인 것만 — 근처를 스쳐 지나가는 다른 호출을 물면 안 된다.
        if (!/['"]rawMaterialLedger['"]/.test(src.slice(m.index, m.index + 130))) continue;
        const 이름끝 = src.indexOf('rawMaterialLedger', m.index);
        const 시작 = src.indexOf('{', 이름끝);
        if (시작 < 0) continue;
        let 깊이 = 0, 끝 = -1;
        for (let i = 시작; i < src.length; i++) {
          if (src[i] === '{') 깊이++;
          else if (src[i] === '}' && --깊이 === 0) { 끝 = i; break; }
        }
        if (끝 < 0) continue;
        //  **주석은 걷어낸다.** "rawItemId 를 박는다"고 적어 둔 주석이 코드인 척해서,
        //  실제로 열쇠를 빼 봐도 감시가 안 잡혔다(2026-09-09, 일부러 빼 보고 알았다).
        const 본문 = src.slice(시작, 끝 + 1)
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/.*/g, ' ');
        //  `rawLedgerKeys(홀더)` 로 펴 넣든 `rawItemId` 를 직접 적든 — **열쇠가 들어가면 된다.**
        //  (adjustRawLots 처럼 Item 이 아니라 id 를 받아 오는 자리도 있다)
        if (/rawLedgerKeys|rawItemId/.test(본문)) continue;
        빠진곳.push(`${f} — ${본문.slice(0, 90).replace(/\s+/g, ' ')}…`);
      }
    }
    expect(빠진곳, `원장에 쓰면서 열쇠(rawLedgerKeys)를 안 박은 곳:\n${빠진곳.join('\n')}\n\n`
      + `companyId + rawItemId 를 같이 박아라 — 인수인계.md "연결은 이름이 아니라 열쇠(id)로 건다".`)
      .toEqual([]);
  });
});
