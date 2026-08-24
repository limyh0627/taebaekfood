import { describe, it, expect, beforeEach } from 'vitest';
import { buildBomIndex, setBomIndex, bomOf, bomParentsOf, resetBomIndex } from './bomIndex';
import type { Item } from './types';

/**
 * BOM 단일원천 — 구성은 item_bom에서만 읽는다.
 * 예전엔 로딩 때 품목마다 `submaterials`를 만들어 붙였고(bomSource, 폐기),
 * 그 칸의 `category`에 자식의 **type**이 들어가 화면 네 곳이 조용히 아무것도 못 걸렀다.
 */
const it_ = (o: Partial<Item> & { id: string }) =>
  ({ name: o.id, type: 'submaterial', unit: '개', stock: 0, minStock: 0, price: 0, ...o }) as Item;

const 벌크 = it_({ id: 'bulk', name: '볶음참깨', type: 'wip', subtype: '벌크', category: '참깨', unit: 'kg' });
const 낱개 = it_({ id: 'loose', name: '볶음참깨-낱개/1kg', type: 'product', category: '참깨' });
const 비닐 = it_({ id: 'vinyl', name: '1KG-볶음참깨', category: '비닐', cost: 110 });
const 박스10 = it_({ id: 'box10', name: '볶음참깨/1kg (10개입)', type: 'product', category: '참깨' });
const 박스20 = it_({ id: 'box20', name: '볶음참깨/1kg (20개입)', type: 'product', category: '참깨' });

const bom = (parent: string, child: string, quantity?: number) =>
  ({ parent_id: parent, child_id: child, quantity } as { parent_id: string; child_id: string; quantity?: number });

beforeEach(() => {
  setBomIndex(buildBomIndex([벌크, 낱개, 비닐, 박스10, 박스20], [
    bom('loose', 'bulk', 1),
    bom('loose', 'vinyl', 1),
    bom('box10', 'loose', 10),
    bom('box20', 'loose', 20),
  ]));
});

describe('bomOf — 이 품목의 구성', () => {
  it('자식 품목이 줄에 붙어 온다 — category가 제 값이다', () => {
    const lines = bomOf('loose');
    expect(lines.map(l => l.childId)).toEqual(['bulk', 'vinyl']);
    // 옛 파생 필드는 여기에 자식의 type('wip'·'submaterial')을 넣어서 '비닐'을 못 찾았다
    expect(lines.map(l => l.child?.category)).toEqual(['참깨', '비닐']);
  });

  it('수량은 qty — 옛 파생은 이걸 stock 칸에 담았다', () => {
    expect(bomOf('box20').map(l => l.qty)).toEqual([20]);
  });

  it('구성이 없으면 빈 배열', () => {
    expect(bomOf('bulk')).toEqual([]);
    expect(bomOf('없는품목')).toEqual([]);
    expect(bomOf(undefined)).toEqual([]);
  });

  it('quantity가 비면 1로 본다', () => {
    setBomIndex(buildBomIndex([낱개, 비닐], [bom('loose', 'vinyl')]));
    expect(bomOf('loose')[0].qty).toBe(1);
  });

  it('지워진 품목을 가리키면 child가 undefined — 원가·차감에서 조용히 빠지는 자리다', () => {
    setBomIndex(buildBomIndex([낱개], [bom('loose', '지워진품목', 1)]));
    const [line] = bomOf('loose');
    expect(line.childId).toBe('지워진품목');
    expect(line.child).toBeUndefined();
  });
});

describe('bomParentsOf — 이 품목을 문 부모', () => {
  it('낱개를 문 박스들을 되짚는다', () => {
    expect(bomParentsOf('loose').map(l => l.parentId).sort()).toEqual(['box10', 'box20']);
  });

  it('수량도 같이 온다', () => {
    const byId = Object.fromEntries(bomParentsOf('loose').map(l => [l.parentId, l.qty]));
    expect(byId).toEqual({ box10: 10, box20: 20 });
  });

  it('아무도 안 물면 빈 배열', () => {
    expect(bomParentsOf('box20')).toEqual([]);
  });
});

describe('레지스트리', () => {
  it('안 세우면 비어 있다 — 로딩 전이면 품목 목록이 빈 것과 같은 상태', () => {
    resetBomIndex();
    expect(bomOf('loose')).toEqual([]);
    expect(bomParentsOf('loose')).toEqual([]);
  });

  it('parent_id·child_id가 비어 있는 줄은 버린다', () => {
    setBomIndex(buildBomIndex([낱개], [
      { parent_id: '', child_id: 'vinyl', quantity: 1 },
      { parent_id: 'loose', child_id: '', quantity: 1 },
    ]));
    expect(bomOf('loose')).toEqual([]);
  });
});
