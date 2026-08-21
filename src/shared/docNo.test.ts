import { describe, it, expect } from 'vitest';
import { nextDocNo, issuedMs, rowStamp, timeOfLocal, stampFor } from './voucherStamp';

/**
 * 문서번호와 전표 시각 — **하루 안에서 누가 어디 서는가**를 정하는 두 규칙.
 * 실제로 이것 때문에 상계가 그날 매입보다 먼저 잡힌 것처럼 보였다.
 */

describe('문서번호 — 전표일 + 그날 순번', () => {
  it('그날 첫 전표는 01', () => {
    expect(nextDocNo('2026-08-21', [])).toBe('260821-01');
  });

  it('그날 쓰인 번호 다음으로 이어진다', () => {
    const had = [{ docNo: '260821-01' }, { docNo: '260821-02' }];
    expect(nextDocNo('2026-08-21', had)).toBe('260821-03');
  });

  it('다른 날 번호는 안 센다 — 날짜가 접두사라 겹칠 수가 없다', () => {
    const had = [{ docNo: '260820-07' }, { docNo: '260819-11' }];
    expect(nextDocNo('2026-08-21', had)).toBe('260821-01');
  });

  it('지운 번호를 다시 쓰지 않는다 — 개수를 세면 겹친다(고친 이유)', () => {
    // 01,02,03을 쓰고 02를 지운 상태
    const had = [{ docNo: '260821-01' }, { docNo: '260821-03' }];
    expect(nextDocNo('2026-08-21', had)).toBe('260821-04');
    // 옛 방식(개수 + 1)이었다면 03이 나와 이미 있는 번호와 겹쳤다
    expect(`260821-${String(had.length + 1).padStart(2, '0')}`).toBe('260821-03');
  });

  it('갈래 접두사는 따로 센다 — 대체·반품·가공', () => {
    const had = [{ docNo: '260821-01' }, { docNo: '대체260821-01' }];
    expect(nextDocNo('2026-08-21', had)).toBe('260821-02');
    expect(nextDocNo('2026-08-21', had, '대체')).toBe('대체260821-02');
    expect(nextDocNo('2026-08-21', had, '반품')).toBe('반품260821-01');
  });

  it('옛 번호(2026-08-0185)는 세지 않는다 — 형식이 달라 섞이지 않는다', () => {
    expect(nextDocNo('2026-08-21', [{ docNo: '2026-08-0185' }])).toBe('260821-01');
  });

  it('두 자리를 넘으면 그대로 늘어난다', () => {
    expect(nextDocNo('2026-08-21', [{ docNo: '260821-99' }])).toBe('260821-100');
  });
});

describe('같은 시각이면 끊은 순서', () => {
  it('id에 박힌 ms를 읽는다', () => {
    expect(issuedMs('stmt-1787126648824')).toBe(1787126648824);
    expect(issuedMs('cash-1787287653405-offset')).toBe(1787287653405);
  });

  it('나중에 끊은 것이 큰 수 — 소급 전표는 시각이 전부 23:59:59라 이걸로 갈린다', () => {
    const a = 'stmt-1787126648824', b = 'stmt-1787287653405';
    expect(issuedMs(a) - issuedMs(b)).toBeLessThan(0);
  });

  it('ms가 없는 옛 id는 0 — 뒤 비교로 넘어간다', () => {
    expect(issuedMs('stmt-open-C1-매출')).toBe(0);
    expect(issuedMs(undefined)).toBe(0);
  });
});

describe('원장 한 줄의 자리', () => {
  it('전표일 + 그날 시각으로 만든다', () => {
    const iso = new Date('2026-08-19T17:04:08').toISOString();
    expect(rowStamp('2026-08-19', iso)).toBe('2026-08-19T17:04:08');
  });

  it('소급 도장은 그날 맨 뒤에 선다', () => {
    const back = stampFor('2026-08-19', new Date('2026-08-21T10:00:00'));
    const live = new Date('2026-08-19T17:04:08').toISOString();
    expect(rowStamp('2026-08-19', back) > rowStamp('2026-08-19', live)).toBe(true);
  });

  it('예약 도장은 그날 맨 앞에 선다', () => {
    const fwd = stampFor('2026-08-25', new Date('2026-08-21T10:00:00'));
    const live = new Date('2026-08-25T09:00:00').toISOString();
    expect(rowStamp('2026-08-25', fwd) < rowStamp('2026-08-25', live)).toBe(true);
  });

  it('도장이 없으면 그날 맨 앞', () => {
    expect(timeOfLocal(undefined)).toBe('00:00:00');
    expect(rowStamp('2026-08-19')).toBe('2026-08-19T00:00:00');
  });
});
