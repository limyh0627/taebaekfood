import { describe, it, expect } from 'vitest';
import { ledgerLotGap, lotRemainingKg, gapMessage } from './ledgerLotCheck';
import type { RawMaterialEntry, RawMaterialLot } from './types';

/**
 * 로트 쓰기가 실패했는지는 **되읽어 대조해야** 안다.
 * 쓰는 순서를 바꾸는 것으론 못 잡는다 — 로트가 실패하면 일은 어차피 날아가고 조용할 뿐이다.
 */
const 줄 = (o: Partial<RawMaterialEntry>): RawMaterialEntry =>
  ({ id: 'e', material: '깨분참기름', date: '2026-08-01', received: 0, used: 0, ...o } as RawMaterialEntry);
const 로트 = (kg: number): RawMaterialLot =>
  ({ id: 'l', lotNo: '260801-01', supplierName: '청정', receivedDate: '2026-08-01', kgIn: kg, qtyIn: 0, kgRemaining: kg, status: 'active' } as RawMaterialLot);

describe('원장 잔량과 로트 잔량 대조', () => {
  it('둘이 맞으면 아무 말도 안 한다', () => {
    const entries = [줄({ id: '1', received: 100 }), 줄({ id: '2', date: '2026-08-02', used: 30 })];
    expect(ledgerLotGap('깨분참기름', entries, [로트(70)])).toBeNull();
  });

  it('원장만 써지고 로트가 실패하면 잡아낸다', () => {
    //  사용 30을 원장에만 적고 로트는 100 그대로 — 여태 콘솔에만 찍고 넘어가던 상황
    const entries = [줄({ id: '1', received: 100 }), 줄({ id: '2', date: '2026-08-02', used: 30 })];
    const g = ledgerLotGap('깨분참기름', entries, [로트(100)]);
    expect(g).not.toBeNull();
    expect(g!.gapKg).toBe(-30);            // 원장 70 − 로트 100
    expect(gapMessage(g!)).toContain('로트만 30kg 더 빠짐');
  });

  it('로트만 깎이고 원장은 앵커가 잡아준 경우도 잡아낸다', () => {
    //  8/20 실사로 원장이 1,650에 앵커된 뒤, 8/17자 사용을 뒤늦게 넣으면 로트만 깎인다
    const entries = [
      줄({ id: '1', date: '2026-08-20', targetKg: 1650, type: 'correction' }),
      줄({ id: '2', date: '2026-08-17', used: 1260 }),   // 앵커보다 앞선 날짜 — 원장 잔량은 안 움직인다
    ];
    const g = ledgerLotGap('참깨', entries, [로트(390)]);
    expect(g!.ledgerKg).toBe(1650);        // 앵커가 마지막이라 1,650으로 끝난다
    expect(g!.gapKg).toBe(1260);
    expect(gapMessage(g!)).toContain('로트가 1260kg 덜 빠짐');
  });

  it('몇 g 흔들리는 건 넘어간다 — 로트는 소수 셋째 자리로 반올림하며 돈다', () => {
    const entries = [줄({ id: '1', received: 100.002 })];
    expect(ledgerLotGap('깨분참기름', entries, [로트(99.5)])).toBeNull();   // 0.502kg — 한도 안
    expect(ledgerLotGap('깨분참기름', entries, [로트(98)])).not.toBeNull(); // 2.002kg — 넘는다
  });

  it('로트가 음수로 파여도 그대로 센다 — 이월 버킷이 받은 것', () => {
    const entries = [줄({ id: '1', date: '2026-08-13', targetKg: 262.822, type: 'correction' })];
    const g = ledgerLotGap('깨분참기름', entries, [로트(-508.183)]);
    expect(g!.gapKg).toBe(771.005);
  });

  it('로트가 없으면 0으로 본다', () => {
    expect(lotRemainingKg(undefined)).toBe(0);
    expect(lotRemainingKg([])).toBe(0);
  });
});
