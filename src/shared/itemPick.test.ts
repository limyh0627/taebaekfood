import { describe, it, expect } from 'vitest';
import { pickLines, linkWrites, type PickRow } from './itemPick';
import type { Item, PartnerItem } from './types';
import { manualLines } from './statementLines';
import { partnerPriceWrites } from './partnerPriceSync';

/**
 * 팝업에서 고른 것이 전표 줄로 어떻게 옮겨지는가.
 * 단가가 어디서 오는지와, 안 붙은 품목을 가려내는 게 전부다.
 *
 * **단가는 거래처 값 하나뿐이다**(2026-09-04). 전에는 품목 값(`items.price`)으로
 * 물러섰는데, 그 칸이 527개 전부 0이라 **물러서면 0원 전표가 끊겼다.** 칸을 지웠다.
 */
const 품목 = (id: string, name: string, over: Partial<Item> = {}): Item =>
  ({ id, name, spec: '500ml', ...over } as Item);
const 단가 = (over: Partial<PartnerItem> = {}): PartnerItem =>
  ({ id: 'pc1', itemId: 'i1', partnerId: 'p1', Direction: 'out', ...over } as PartnerItem);
const 줄 = (id: string, name: string, pc: Partial<PartnerItem> = {}, it: Partial<Item> = {}): PickRow =>
  ({ product: 품목(id, name, it), pc: 단가({ id: 'pc-' + id, itemId: id, ...pc }) });

describe('고른 것을 전표 줄로', () => {
  const rows = [줄('i1', '참기름', { price: 6000, taxType: '면세' }), 줄('i2', '들기름', { price: 7000 })];
  const linked = new Set(['i1', 'i2']);

  it('팝업 입력값과 ID가 전표·거래처 연결·발행까지 그대로 이어진다', () => {
    const edits = { 'pc-i1': '8,500원' };
    const picked = pickLines({ i1: '3' }, rows, new Set(), edits);
    const writes = linkWrites(picked.unlinked, 'p1', 'out', edits);
    const lines = manualLines(picked.toAdd, '매출');
    expect(lines[0]).toMatchObject({ itemId: 'i1', price: 8500, isTaxExempt: true });
    expect(writes[0]).toMatchObject({ itemId: 'i1', price: 8500, taxType: '면세' });
    const afterIssue = partnerPriceWrites({ type: '매출', partnerId: 'p1', lines,
      items: rows.map(r => r.product!), partnerItems: writes });
    expect(afterIssue.upserts.every(w => w.price === 8500)).toBe(true);
    expect(pickLines({ i1: '1' }, rows, linked, edits).toAdd[0].price).toBe('8500');
  });

  it('수량을 적은 것만 담는다', () => {
    const r = pickLines({ i1: '3', i2: '' }, rows, linked);
    expect(r.toAdd.map(x => x.name)).toEqual(['참기름']);
    expect(r.toAdd[0]).toMatchObject({ qty: '3', spec: '500ml' });
  });

  it('0이나 글자는 안 담는다 — 실수로 남은 값이 전표에 들어가면 안 된다', () => {
    expect(pickLines({ i1: '0' }, rows, linked).toAdd).toEqual([]);
    expect(pickLines({ i1: 'ㅁ' }, rows, linked).toAdd).toEqual([]);
    expect(pickLines({ i1: '' }, rows, linked).toAdd).toEqual([]);
  });

  it('단가는 **거래처 값**이다 — 품목에는 판매단가가 없다', () => {
    expect(pickLines({ i1: '1' }, rows, linked).toAdd[0].price).toBe('6000');
  });

  it('거래처 단가가 없으면 **빈 칸** — 물러설 곳이 없다', () => {
    const r = pickLines({ i9: '1' }, [줄('i9', '깨', {})], new Set(['i9']));
    expect(r.toAdd[0].price).toBe('');
  });

  it('둘 다 없으면 빈 칸 — 0을 넣으면 0원 전표가 끊긴다', () => {
    const r = pickLines({ i9: '1' }, [줄('i9', '깨', {})], new Set(['i9']));
    expect(r.toAdd[0].price).toBe('');
  });

  it('과세·면세도 거래처 값에서 온다', () => {
    const r = pickLines({ i1: '1', i2: '1' }, rows, linked);
    expect(r.toAdd.map(x => x.isTaxExempt)).toEqual([true, false]);
  });

  it('없는 품목 id 는 조용히 건너뛴다', () => {
    expect(pickLines({ 없음: '5' }, rows, linked).toAdd).toEqual([]);
  });
});

describe('거래처에 안 붙은 품목을 가려낸다', () => {
  const rows = [줄('i1', '참기름'), 줄('i2', '들기름')];

  it('안 붙은 것만 골라 준다 — 물어볼 대상이다', () => {
    const r = pickLines({ i1: '1', i2: '1' }, rows, new Set(['i1']));
    expect(r.unlinked.map(x => x.product!.name)).toEqual(['들기름']);
  });

  it('수량 안 적은 것은 안 물어본다 — 담지도 않을 것을 붙일 이유가 없다', () => {
    const r = pickLines({ i2: '' }, rows, new Set(['i1']));
    expect(r.unlinked).toEqual([]);
  });

  it('다 붙어 있으면 안 물어본다', () => {
    expect(pickLines({ i1: '1' }, rows, new Set(['i1', 'i2'])).unlinked).toEqual([]);
  });
});

describe('"예"라고 답했을 때 붙일 것', () => {
  const rows = [줄('i2', '들기름', { price: 7000, taxType: '면세' })];

  it('방향까지 붙은 id 로 만든다 — 매입·매출이 겹치면 안 된다', () => {
    expect(linkWrites(rows, 'p1', 'out')[0].id).toBe('i2_p1_out');
    expect(linkWrites(rows, 'p1', 'in')[0].id).toBe('i2_p1_in');
  });

  it('거래처 단가와 과세를 그대로 옮긴다', () => {
    expect(linkWrites(rows, 'p1', 'out')[0]).toMatchObject({ price: 7000, taxType: '면세', partnerId: 'p1' });
  });

  it('팝업에서 고쳐 놓은 값이 이긴다 — 저장 단추를 안 눌러도 붙일 때 같이 들어간다', () => {
    expect(linkWrites(rows, 'p1', 'out', { 'pc-i2': '8,500원' })[0].price).toBe(8500);
  });

  it('단가가 아무데도 없으면 0으로 붙인다 — 붙이는 게 목적이고 값은 나중에 채운다', () => {
    const 빈 = [줄('i3', '깨', {})];
    expect(linkWrites(빈, 'p1', 'out')[0].price).toBe(0);
    expect(linkWrites(빈, 'p1', 'out')[0].taxType).toBe('과세');
  });
});
