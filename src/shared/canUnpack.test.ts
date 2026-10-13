import { describe, it, expect, beforeEach } from 'vitest';
import { isUnpackable, unpackPlan, unpackSummary } from './canUnpack';
import { buildBomIndex, setBomIndex, resetBomIndex } from './bomIndex';
import type { Item } from './types';
import { itemInventoryRequestHash, itemInventoryRequestText, type CanUnpackRequest } from './itemInventoryAttempt';

const it_ = (o: Partial<Item> & { id: string }) =>
  ({ name: o.id, type: 'submaterial', unit: '개', stock: 0, minStock: 0, price: 0, ...o }) as Item;

// 품목 표시 단위가 L이어도 BOM과 개봉 수불의 수량은 kg다.
const 캔 = it_({ id: '캔', name: '시골향참기름1-캔/16.5kg', type: 'wip', unit: '캔', stock: 5, unpackable: true });
const 벌크 = it_({ id: '벌크', name: '통깨참기름', type: 'wip', unit: 'L', subtype: '벌크' });
const 공캔 = it_({ id: '공캔', name: '16.5kg 캔', type: 'submaterial' });

//  **소매 병도 구성이 똑같다** — 이걸 BOM 으로 가를 수 없어서 표시를 두었다.
const 병 = it_({ id: '병', name: '참기름/병/350ml', type: 'product', unit: '병', stock: 99 });
const 병뚜껑 = it_({ id: '병뚜껑', name: '병캡-주황', type: 'submaterial' });

const 섞은것 = it_({ id: '섞은것', name: '참들세트-캔', type: 'wip', unit: '캔', stock: 3, unpackable: true });
const 들기름 = it_({ id: '들기름', name: '생들기름', type: 'wip', unit: 'L', subtype: '벌크' });

const 구성없음 = it_({ id: '구성없음', name: '표시만켠것', type: 'wip', unit: '캔', stock: 1, unpackable: true });
const 영 = it_({ id: '영', name: '수량0캔', type: 'wip', unit: '캔', stock: 1, unpackable: true });

const ITEMS = [캔, 벌크, 공캔, 병, 병뚜껑, 섞은것, 들기름, 구성없음, 영];
const bom = (parent: string, child: string, quantity: number) => ({ parent_id: parent, child_id: child, quantity });

beforeEach(() => {
  setBomIndex(buildBomIndex(ITEMS, [
    bom('캔', '벌크', 16.5),
    bom('캔', '공캔', 1),
    bom('병', '벌크', 0.321),
    bom('병', '병뚜껑', 1),
    bom('섞은것', '벌크', 8),
    bom('섞은것', '들기름', 8),
    bom('영', '벌크', 0),
  ]));
});

describe('무엇을 깔 수 있나', () => {
  it('명시 회사 구성은 상대 전역과 무관하게 벌크와 폐기량을 계산한다', () => {
    const a = buildBomIndex(ITEMS, [bom('캔', '벌크', 16.5), bom('캔', '공캔', 1)]);
    const b = buildBomIndex(ITEMS, [bom('캔', '들기름', 10), bom('캔', '병뚜껑', 2)]);
    setBomIndex(b);
    expect(unpackPlan(캔, 2, 5, a)).toMatchObject({ok:true,plan:{bulkItemId:'벌크',bulkQty:33,discarded:[{itemId:'공캔',qty:2}]}});
    setBomIndex(a);
    expect(unpackPlan(캔, 2, 5, b)).toMatchObject({ok:true,plan:{bulkItemId:'들기름',bulkQty:20,discarded:[{itemId:'병뚜껑',qty:4}]}});
    expect(unpackPlan(캔, 2, 5)).toMatchObject({ok:true,plan:{bulkQty:33}});
  });
  it('명시 빈 구성은 전역으로 대체하지 않고 개봉 가능 판정도 같은 입력을 쓴다', () => {
    const empty = buildBomIndex([], []);
    expect(unpackPlan(캔, 1, undefined, empty)).toEqual({ok:false,reason:'NO_BULK'});
    expect(isUnpackable(캔, empty)).toBe(false);
    expect(isUnpackable(캔)).toBe(true);
  });
  it('표시를 켜고 구성에 벌크가 있으면 깐다', () => {
    expect(isUnpackable(캔)).toBe(true);
  });

  it('**소매 병은 구성이 같아도 안 깐다** — 표시를 안 켰다', () => {
    //  BOM 으로 판정하려다 운영 데이터에서 158개가 걸린 자리다.
    //  구성만 보면 병도 `벌크 + 용기 + 뚜껑` 이라 캔과 구별이 안 된다.
    expect(isUnpackable(병)).toBe(false);
    expect(unpackPlan(병, 1)).toEqual({ ok: false, reason: 'NOT_MARKED' });
  });

  it('표시만 켜고 구성이 없으면 안 깐다 — 까면 재고가 그냥 사라진다', () => {
    expect(unpackPlan(구성없음, 1)).toEqual({ ok: false, reason: 'NO_BULK' });
    expect(isUnpackable(구성없음)).toBe(false);
  });

  it('벌크가 여럿이면 안 깐다 — 섞인 것은 되돌릴 수 없다', () => {
    expect(unpackPlan(섞은것, 1)).toEqual({ ok: false, reason: 'MANY_BULKS' });
  });

  it('1개당 나오는 양이 0 이면 안 깐다', () => {
    expect(unpackPlan(영, 1)).toEqual({ ok: false, reason: 'ZERO_PER_CAN' });
  });

  it('품목이 없어도 안 죽는다', () => {
    expect(isUnpackable(undefined)).toBe(false);
  });
});

describe('개봉 한 번을 셈한다', () => {
  it('캔 1개 → 벌크 16.5kg — 품목의 L 표시 단위와 구분한다', () => {
    const r = unpackPlan(캔, 1);
    expect(r.ok && r.plan.bulkName).toBe('통깨참기름');
    expect(r.ok && r.plan.bulkQty).toBe(16.5);
    expect(r.ok && r.plan.bulkUnit).toBe('kg');
    expect(r.ok && unpackSummary(r.plan)).toBe('시골향참기름1-캔/16.5kg −1개 → 통깨참기름 +16.5kg');
  });

  it('캔 2개 → 벌크 33kg — 밀도로 중량을 다시 환산하지 않는다', () => {
    const index = buildBomIndex([캔, { ...벌크, density: 0.916 }, 공캔], [bom('캔', '벌크', 16.5), bom('캔', '공캔', 1)]);
    const r = unpackPlan(캔, 2, 5, index);
    expect(r).toMatchObject({ ok: true, plan: { perCan: 16.5, bulkQty: 33, bulkUnit: 'kg' } });
    expect(r.ok && unpackSummary(r.plan)).toBe('시골향참기름1-캔/16.5kg −2개 → 통깨참기름 +33kg');
  });

  it('옛 L 계획도 kg로 표시하지만 최초 원문·중량·해시는 바꾸지 않는다', async () => {
    const r = unpackPlan(캔, 2);
    if (!r.ok) throw Error('시험용 캔 계획이 필요합니다.');
    const request: CanUnpackRequest = { version: 1, kind: 'can-unpack', operationId: 'old-unpack', companyId: 'taebaek', uid: 'test-user', capturedAt: '2026-10-13T00:00:00.000Z', date: '2026-10-13', plan: { ...r.plan, bulkUnit: 'L' } };
    const textBefore = itemInventoryRequestText(request);
    const hashBefore = await itemInventoryRequestHash(request);
    expect(unpackSummary(request.plan)).toBe('시골향참기름1-캔/16.5kg −2개 → 통깨참기름 +33kg');
    expect(request.plan).toMatchObject({ bulkUnit: 'L', perCan: 16.5, bulkQty: 33 });
    expect(itemInventoryRequestText(request)).toBe(textBefore);
    expect(await itemInventoryRequestHash(request)).toBe(hashBefore);
  });

  it('여러 개도 한 번에 깐다', () => {
    const r = unpackPlan(캔, 3);
    expect(r.ok && r.plan.bulkQty).toBe(49.5);
  });

  it('**공캔은 안 돌아온다** — 깐 캔은 버린다', () => {
    //  되돌리면 다음 생산 때 있지도 않은 공캔을 집어 쓴다. 보여만 주고 재고는 안 건드린다.
    const r = unpackPlan(캔, 2);
    expect(r.ok && r.plan.discarded).toEqual([{ itemId: '공캔', name: '16.5kg 캔', qty: 2 }]);
  });

  it('소수 셋째 자리에서 끊는다 — 로트가 그 자리에서 반올림하며 돈다', () => {
    setBomIndex(buildBomIndex(ITEMS, [bom('캔', '벌크', 0.3333), bom('캔', '공캔', 1)]));
    const r = unpackPlan(캔, 7);
    expect(r.ok && r.plan.bulkQty).toBe(2.333);
  });

  it('깔 개수가 1 보다 작으면 안 깐다', () => {
    expect(unpackPlan(캔, 0)).toEqual({ ok: false, reason: 'BAD_COUNT' });
    expect(unpackPlan(캔, -2)).toEqual({ ok: false, reason: 'BAD_COUNT' });
    expect(unpackPlan(캔, Number.NaN)).toEqual({ ok: false, reason: 'BAD_COUNT' });
  });

  it('재고를 주면 모자란지 본다 — 안 주면 안 본다', () => {
    expect(unpackPlan(캔, 9, 5)).toEqual({ ok: false, reason: 'NOT_ENOUGH' });
    expect(unpackPlan(캔, 5, 5).ok).toBe(true);
    expect(unpackPlan(캔, 9).ok).toBe(true);   // 재고를 안 보면 통과 — 단추는 보이고 누를 때 막는다
  });

  it('확인 알림과 기록이 같은 글을 쓴다', () => {
    const r = unpackPlan(캔, 3);
    expect(r.ok && unpackSummary(r.plan)).toBe('시골향참기름1-캔/16.5kg −3개 → 통깨참기름 +49.5kg');
  });
});

describe('구성이 지워진 줄', () => {
  it('없는 품목을 가리키는 줄은 무시한다', () => {
    resetBomIndex();
    setBomIndex(buildBomIndex(ITEMS, [bom('캔', '지워진품목', 16.5)]));
    expect(unpackPlan(캔, 1)).toEqual({ ok: false, reason: 'NO_BULK' });
  });
});
