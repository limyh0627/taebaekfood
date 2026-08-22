import { describe, it, expect } from 'vitest';
import type { AccountCode, AccountGroup } from './types';

/**
 * 성격 필터 — **줄의 계정으로 거르고, 계층은 두 단이다.**
 *
 *   대분류  매출 · 비용 · 자산·부채
 *   중분류  비용 아래 — 재료비 · 노무비 · 제조경비 · 판관비 · 영업외비용
 *
 * 갈래(매출·매입·대체·입금·출금)만으로는 "이번 달 나간 비용 전부"를 못 본다.
 * 대출상환은 출금전표인데 안에 이자비용이 있고, 급여 발생은 대체전표인데 인건비다.
 * 한 전표가 여러 성격을 품으므로 전표 머리가 아니라 줄을 봐야 한다.
 *
 * **계정 번호대로 가르면 안 된다** — 우리 장부는 800번대에 매출과 비용이 같이 있다.
 */
const CODES: AccountCode[] = [
  { id: '800', code: '800', name: '일반매출', type: '수익', groupId: 'ag-revenue' },
  { id: '818', code: '818', name: '감가상각비', type: '비용', groupId: 'ag-admin' },
  { id: '819', code: '819', name: '리스료', type: '비용', groupId: 'ag-admin' },
  { id: '515', code: '515', name: '급여', type: '비용', groupId: 'ag-labor' },
  { id: '951', code: '951', name: '이자비용', type: '비용', groupId: 'ag-other-expense' },
  { id: '108', code: '108', name: '외상매출금', type: '자산', groupId: 'ag-asset' },
  { id: '251', code: '251', name: '외상매입금', type: '부채', groupId: 'ag-liability' },
  { id: '255', code: '255', name: '부가세예수금', type: '부채', groupId: 'ag-liability' },
  { id: '103', code: '103', name: '보통예금', type: '자산', groupId: 'ag-asset' },
  { id: '254', code: '254', name: '예수금', type: '부채', groupId: 'ag-liability' },
  { id: '293', code: '293', name: '장기차입금', type: '부채', groupId: 'ag-liability' },
] as AccountCode[];
const GROUPS: AccountGroup[] = [
  { id: 'ag-revenue', name: '총매출', type: '수익', plLine: 'revenue' },
  { id: 'ag-admin', name: '판관비', type: '비용', plLine: 'sgna' },
  { id: 'ag-labor', name: '노무비', type: '비용', plLine: 'cogs' },
  { id: 'ag-other-expense', name: '영업외비용', type: '비용', plLine: 'other-expense' },
  { id: 'ag-liability', name: '부채', type: '부채' },
  { id: 'ag-asset', name: '자산', type: '자산' },
] as AccountGroup[];

// 화면과 같은 식 — 판이 다른 셋을 각자의 근거로 가른다
const groupOf = (code: string) => GROUPS.find(x => x.id === CODES.find(c => c.code === code)?.groupId);
const typeOf  = (code: string) => CODES.find(c => c.code === code)?.type;
/** 손익 계정인가 — 그룹의 plLine이 먼저, 없으면 계정 5분류 폴백 */
const isPl = (code: string) => !!groupOf(code)?.plLine || typeOf(code) === '수익' || typeOf(code) === '비용';
/** 재무 계정인가 */
const bsType = (code: string) => {
  const t = typeOf(code);
  return t === '자산' || t === '부채' || t === '자본' ? t : null;
};
const anyPl    = (codes: string[]) => codes.some(isPl);
const anyBs    = (codes: string[]) => codes.some(c => !!bsType(c));
const inGroup  = (codes: string[], name: string) => codes.some(c => groupOf(c)?.name === name);
const inBsType = (codes: string[], t: string) => codes.some(c => bsType(c) === t);

describe('판이 다른 셋으로 가른다', () => {
  /**
   * 전에는 매출·비용·인건비·자산부채를 한 줄에 나란히 뒀다. 잘못이었다 —
   * 인건비는 비용의 **하위**(노무비 그룹)고, 자산·부채는 손익이 아니라 재무상태표다.
   */
  it('손익 계정과 재무 계정은 서로 안 겹친다', () => {
    expect(isPl('515')).toBe(true);   expect(bsType('515')).toBeNull();
    expect(isPl('254')).toBe(false);  expect(bsType('254')).toBe('부채');
  });

  it('인건비는 손익 › 노무비다 — 나란한 갈래가 아니다', () => {
    expect(isPl('515')).toBe(true);
    expect(groupOf('515')?.name).toBe('노무비');
    expect(inGroup(['951'], '노무비')).toBe(false);
  });
});

describe('번호대로 가르면 틀린다', () => {
  it('800번대에 매출과 비용이 같이 있다', () => {
    expect(groupOf('800')?.plLine).toBe('revenue');
    expect(groupOf('818')?.plLine).toBe('sgna');    // 같은 800번대인데 비용
    expect(groupOf('819')?.plLine).toBe('sgna');
  });
});

describe('복합 전표도 안 빠진다', () => {
  const 대출상환 = ['293', '951'];         // 출금전표 · 차입금(재무) + 이자비용(손익)
  const 급여발생 = ['515', '254', '263'];   // 대체전표 · 급여(손익) + 예수금·미지급급여(재무)

  it('대출상환은 손익에도 재무에도 잡힌다 — 줄이 둘 다 품는다', () => {
    expect(anyPl(대출상환)).toBe(true);
    expect(anyBs(대출상환)).toBe(true);
  });

  it('손익 › 영업외비용으로 좁히면 잡히고, 노무비로 좁히면 안 잡힌다', () => {
    expect(inGroup(대출상환, '영업외비용')).toBe(true);
    expect(inGroup(대출상환, '노무비')).toBe(false);
  });

  it('재무 › 부채로 좁히면 잡힌다', () => {
    expect(inBsType(대출상환, '부채')).toBe(true);
    expect(inBsType(대출상환, '자산')).toBe(false);
  });

  it('급여 발생이 손익 › 노무비에 잡힌다 — 대체전표인데도', () => {
    expect(anyPl(급여발생)).toBe(true);
    expect(inGroup(급여발생, '노무비')).toBe(true);
  });

  it('매출전표는 재무가 아니다', () => {
    expect(anyPl(['800'])).toBe(true);
    expect(anyBs(['800'])).toBe(false);
  });
});


describe('전표의 상대계정도 같이 센다', () => {
  /**
   * 거래명세서는 품목 줄에 **손익 계정만** 있다. 외상매출금·외상매입금·부가세는
   * 저장돼 있지 않고 분개할 때 생긴다. 그대로 두면 '재무'로 걸러도 매출·매입 전표가
   * 하나도 안 잡혀서 재무 필터가 자금전표만 고르는 꼴이 된다 — 자금흐름과 똑같아진다.
   */
  const AR = '108', AP = '251';
  /** 화면과 같은 식 — 채권·채무만. 부가세는 일부러 뺀다. */
  const codesOfStatement = (type: string, items: string[]) =>
    type === '비용' ? items : [...items, type === '매출' ? AR : AP];

  it('매출전표는 외상매출금을 품는다 — 재무로 걸러도 잡힌다', () => {
    expect(codesOfStatement('매출', ['800'])).toEqual(['800', AR]);
  });

  it('매출은 자산에만, 매입은 부채에만 — 부가세를 넣으면 뒤섞인다', () => {
    const 매출 = codesOfStatement('매출', ['800']);
    const 매입 = codesOfStatement('매입', ['500']);
    expect(매출.some(c => typeOf(c) === '자산')).toBe(true);
    expect(매출.some(c => typeOf(c) === '부채')).toBe(false);   // 255를 넣었으면 true가 됐다
    expect(매입.some(c => typeOf(c) === '부채')).toBe(true);
    expect(매입.some(c => typeOf(c) === '자산')).toBe(false);   // 135를 넣었으면 true가 됐다
  });

  it('대체전표는 차·대가 줄에 다 있어 그대로 둔다', () => {
    expect(codesOfStatement('비용', ['515', '254', '263'])).toEqual(['515', '254', '263']);
  });

  it('상대계정을 안 넣으면 매출전표가 재무에서 통째로 빠진다 — 고친 이유', () => {
    const 안넣었을때 = ['800'];
    expect(안넣었을때.some(c => ['자산','부채','자본'].includes(typeOf(c) ?? ''))).toBe(false);
  });
});


describe('세 축은 겹치지만 묻는 게 다르다', () => {
  /**
   * 재무를 걸면 입금·출금 전표가 거의 다 나온다 — 자금전표는 대개 108·251·254를 쓰니까.
   * 그래도 같은 축이 아니다:
   *   재무      **무슨 계정**을 건드렸나   (재무상태표)
   *   자금흐름   **통장이 어느 방향**으로 움직였나
   *
   * 대체는 자금흐름이 아니다 — 상계·감가상각·급여 발생은 돈이 안 흐른다.
   */
  const bs = (codes: string[]) => codes.some(c => !!bsType(c));
  const pl = (codes: string[]) => codes.some(isPl);

  it('이자 출금은 자금흐름이지만 재무가 아니다 — 951만 건드린다', () => {
    expect(pl(['951'])).toBe(true);
    expect(bs(['951'])).toBe(false);
  });

  it('상계(대체)는 재무지만 자금흐름이 아니다 — 통장이 안 움직인다', () => {
    const 상계 = ['251', '108'];
    expect(bs(상계)).toBe(true);
    expect(pl(상계)).toBe(false);
    // 갈래가 '대체'면 자금흐름에서 뺀다
    const 자금흐름 = (kind: string) => kind === '입금' || kind === '출금';
    expect(자금흐름('대체')).toBe(false);
  });

  it('매출전표는 재무지만 자금흐름이 아니다 — 외상이라 돈이 안 왔다', () => {
    const 매출전표 = ['800', '108'];   // 상대계정 포함
    expect(bs(매출전표)).toBe(true);
    expect(자금흐름갈래('매출')).toBe(false);
  });

  function 자금흐름갈래(kind: string) { return kind === '입금' || kind === '출금'; }
});

describe('계정으로 걸렀을 때 보이는 금액 — 분개에서 센다', () => {
  /**
   * 대출상환은 통장에서 3,064,357이 나가지만 **손익에 잡히는 건 이자 294,357뿐**이다.
   * 나머지 2,770,000은 차입금(재무)이다. 전액을 띄우면 손익과 안 맞아 보인다.
   *
   * 전표 품목만 더하면 부가세가 섞인다 — 매출전표 1,070,000 중 손익은 공급가 1,000,000이고
   * 70,000은 부가세예수금(부채)이다. 그래서 **분개**에서 센다. 손익 화면과 같은 근거다.
   */
  type JL = { accountCode: string; debit?: number; credit?: number };
  const 몫 = (lines: JL[], hit: (c: string) => boolean) =>
    lines.filter(l => hit(l.accountCode)).reduce((a, l) => a + Math.abs((l.debit ?? 0) - (l.credit ?? 0)), 0);
  const 손익 = (c: string) => isPl(c);
  const 재무 = (c: string) => !!bsType(c);

  // 대출상환 (차) 293 차입금 + 951 이자 / (대) 통장
  const 상환: JL[] = [
    { accountCode: '293', debit: 2_770_000 },
    { accountCode: '951', debit: 294_357 },
    { accountCode: '103', credit: 3_064_357 },
  ];

  it('손익으로만 걸러도 이자 몫만 — 전액이 아니다', () => {
    expect(몫(상환, 손익)).toBe(294_357);
  });

  it('재무로 걸면 차입금 + 통장', () => {
    expect(몫(상환, 재무)).toBe(2_770_000 + 3_064_357);
  });

  it('계정을 콕 집으면 그 줄만', () => {
    expect(몫(상환, c => c === '951')).toBe(294_357);
    expect(몫(상환, c => c === '293')).toBe(2_770_000);
  });

  // 매출전표 (차) 108 총액 / (대) 800 공급가 + 255 부가세
  const 매출: JL[] = [
    { accountCode: '108', debit: 1_070_000 },
    { accountCode: '800', credit: 1_000_000 },
    { accountCode: '255', credit: 70_000 },
  ];

  it('매출전표를 손익으로 걸면 **공급가**만 — 부가세는 손익이 아니다', () => {
    expect(몫(매출, 손익)).toBe(1_000_000);
  });

  it('품목 총액을 더했으면 부가세까지 섞였을 것이다 — 분개에서 세는 이유', () => {
    expect(1_070_000).not.toBe(몫(매출, 손익));
  });
});
