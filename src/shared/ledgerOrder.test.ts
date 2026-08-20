import { describe, it, expect } from 'vitest';
import { sortLedger, ledgerBalanceKg } from './rawLedgerBalance';
import type { RawMaterialEntry } from './types';

/**
 * 같은 시각에 들어간 기록의 순서 — **번호로 고정한다.**
 *
 * 소급 전표를 그날 23:59:59로 맞추면서 동시각이 흔해졌다. 동률에서 정렬이 손을 놓으면
 * 읽어온 순서(Firestore 응답 순서)를 그대로 쓰게 되고, 그건 새로고침마다 달라질 수 있다.
 * 원료 원장은 실사(targetKg)가 잔량을 통째로 덮어쓰는 앵커라 순서 한 칸에 숫자가 바뀐다.
 */

const e = (id: string, date: string, createdAt: string, p: Partial<RawMaterialEntry> = {}): RawMaterialEntry =>
  ({ id, material: '참깨', date, createdAt, received: 0, used: 0, note: '', ...p } as RawMaterialEntry);

describe('같은 시각이면 번호순', () => {
  const 같은시각 = '2026-08-06T23:59:59.000Z';

  it('읽어온 순서가 어떻든 같은 결과가 나온다', () => {
    const a = e('rm-1', '2026-08-06', 같은시각, { received: 100 });
    const b = e('rm-2', '2026-08-06', 같은시각, { received: 200 });
    const c = e('rm-3', '2026-08-06', 같은시각, { used: 50 });
    const ids = (arr: RawMaterialEntry[]) => sortLedger(arr).map(x => x.id);
    expect(ids([a, b, c])).toEqual(['rm-1', 'rm-2', 'rm-3']);
    expect(ids([c, b, a])).toEqual(['rm-1', 'rm-2', 'rm-3']);
    expect(ids([b, a, c])).toEqual(['rm-1', 'rm-2', 'rm-3']);
  });

  it('번호는 숫자로 읽는다 — rm-10이 rm-9보다 뒤', () => {
    const arr = [e('rm-10', '2026-08-06', 같은시각), e('rm-9', '2026-08-06', 같은시각)];
    expect(sortLedger(arr).map(x => x.id)).toEqual(['rm-9', 'rm-10']);
  });

  it('날짜·시각이 먼저다 — 번호는 마지막 갈림길일 뿐', () => {
    const arr = [
      e('rm-9', '2026-08-06', '2026-08-06T23:59:59.000Z'),
      e('rm-1', '2026-08-06', '2026-08-06T07:00:00.000Z'),
      e('rm-5', '2026-08-05', '2026-08-07T00:00:00.000Z'),
    ];
    expect(sortLedger(arr).map(x => x.id)).toEqual(['rm-5', 'rm-1', 'rm-9']);
  });

  it('실사가 섞여도 잔량이 읽어온 순서에 안 흔들린다', () => {
    // 실사 510은 앵커 — 앞뒤가 바뀌면 잔량이 통째로 달라진다
    const 실사 = e('rm-1', '2026-08-10', 같은시각, { targetKg: 510, type: 'correction' });
    const 사용 = e('rm-2', '2026-08-10', 같은시각, { used: 500 });
    expect(ledgerBalanceKg([실사, 사용])).toBe(10);
    expect(ledgerBalanceKg([사용, 실사])).toBe(10);   // 순서를 뒤집어 넣어도 같다
  });
});
