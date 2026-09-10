import { describe, it, expect } from 'vitest';
import { isLatestForPartner, type StatementLike } from './latestStatement';

const 전표 = (o: Partial<StatementLike>): StatementLike =>
  ({ partnerId: 'C016', type: '매출', ...o });

const 장부: StatementLike[] = [
  전표({ id: 'S1', tradeDate: '2026-06-10' }),
  전표({ id: 'S2', tradeDate: '2026-09-04' }),
  전표({ id: 'S3', tradeDate: '2026-08-20' }),
  전표({ id: 'P1', tradeDate: '2026-09-30', type: '매입' }),      // 갈래가 다르다
  전표({ id: 'X1', tradeDate: '2026-12-31', partnerId: 'C001' }), // 거래처가 다르다
];

describe('되밀 자격 — 그 거래처의 최신 전표인가', () => {
  it('제일 최근 전표를 고치면 되민다', () => {
    expect(isLatestForPartner({ this: 전표({ id: 'S2', tradeDate: '2026-09-04' }), all: 장부 })).toBe(true);
  });

  it('옛 전표를 고치면 안 되민다 — 6월 오타가 오늘 단가를 덮으면 안 된다', () => {
    expect(isLatestForPartner({ this: 전표({ id: 'S1', tradeDate: '2026-06-10' }), all: 장부 })).toBe(false);
    expect(isLatestForPartner({ this: 전표({ id: 'S3', tradeDate: '2026-08-20' }), all: 장부 })).toBe(false);
  });

  it('오늘 새로 끊으면 되민다 — 아직 id 가 없다', () => {
    expect(isLatestForPartner({ this: 전표({ tradeDate: '2026-09-09' }), all: 장부 })).toBe(true);
  });

  it('소급해서 끊는 새 전표는 안 되민다 — 오늘 끊어도 6월 거래다', () => {
    expect(isLatestForPartner({ this: 전표({ tradeDate: '2026-06-01' }), all: 장부 })).toBe(false);
  });

  it('이미 저장된 전표를 고치는 중이어도 막히지 않는다 — 제 날짜는 제 판정을 못 뒤집는다', () => {
    //  S2 는 장부에 이미 들어 있다. `>=` 라서 자기를 빼지 않아도 답이 같다.
    const 나만있는장부 = [전표({ id: 'S2', tradeDate: '2026-09-04' })];
    expect(isLatestForPartner({ this: 전표({ id: 'S2', tradeDate: '2026-09-04' }), all: 나만있는장부 })).toBe(true);
  });

  it('같은 날짜면 되민다 — 하루에 두 장 끊는 일이 흔하다', () => {
    expect(isLatestForPartner({ this: 전표({ id: 'S9', tradeDate: '2026-09-04' }), all: 장부 })).toBe(true);
  });

  it('매출과 매입은 따로 본다 — 파는 값과 사는 값은 다른 장부다', () => {
    //  매입에 9/30 이 있어도 매출 9/4 는 매출 안에서 최신이다
    expect(isLatestForPartner({ this: 전표({ id: 'S2', tradeDate: '2026-09-04' }), all: 장부 })).toBe(true);
    //  매입 쪽은 9/30 이 최신
    expect(isLatestForPartner({ this: 전표({ tradeDate: '2026-09-10', type: '매입' }), all: 장부 })).toBe(false);
  });

  it('다른 거래처 전표는 안 본다', () => {
    //  C001 에 12/31 이 있어도 C016 판정에는 안 끼어든다
    expect(isLatestForPartner({ this: 전표({ tradeDate: '2026-09-09' }), all: 장부 })).toBe(true);
  });

  it('그 거래처 첫 전표면 되민다', () => {
    expect(isLatestForPartner({ this: 전표({ partnerId: '처음', tradeDate: '2026-01-01' }), all: 장부 })).toBe(true);
  });

  it('거래처나 날짜가 없으면 안 되민다 — 견줄 수가 없다', () => {
    expect(isLatestForPartner({ this: 전표({ partnerId: '', tradeDate: '2026-09-09' }), all: 장부 })).toBe(false);
    expect(isLatestForPartner({ this: 전표({ tradeDate: '' }), all: 장부 })).toBe(false);
  });
});
