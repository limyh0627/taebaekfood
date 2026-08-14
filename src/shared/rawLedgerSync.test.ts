import { describe, it, expect } from 'vitest';
import { withCarryOverLot, buildReceiveLot, deductFromLots, settleCarryOver } from './lotUtils';
import { lotKgRemaining } from '../constants/formula';
import { ledgerBalanceKg, sortLedger } from './rawLedgerBalance';
import type { RawMaterialEntry, RawMaterialLot } from './types';

/**
 * 실제 원장 잔량 ↔ 로트합 ↔ items.stock 이 어긋나지 않는지.
 *
 * 셋의 관계:
 *   로트합   = lotKgRemaining(lots)          — active 로트의 잔여 합
 *   stock    = 로트합                         — mutateRawMaterialLots의 computeStock이 이 값을 쓴다(파생)
 *   원장 잔량 = ledgerBalanceKg(entries)       — 첫 줄부터 누적, 실사(targetKg)에서 리셋
 *
 * **실제 원장의 줄과 로트 변화는 1:1이어야 한다.** 한쪽만 움직이면 그만큼 영구히 벌어진다.
 * 아래 시나리오는 실제 코드 경로를 그대로 흉내내고, 매 단계마다 셋이 같은지 본다.
 */

// ── 창고 하나를 흉내낸다. 실제 앱의 로트 함수를 그대로 쓴다 ────────────────────
class Warehouse {
  lots: RawMaterialLot[] = [];
  ledger: RawMaterialEntry[] = [];
  private seq = 0;

  constructor(readonly material = '참깨', public stock = 0) {}

  /** items.stock — 로트합에서 계산되는 파생값(mutateRawMaterialLots의 computeStock) */
  private syncStock() { this.stock = lotKgRemaining(this.lots); }

  private row(e: Partial<RawMaterialEntry>): RawMaterialEntry {
    return {
      id: `e${++this.seq}`, material: this.material, date: '2026-08-01',
      received: 0, used: 0, note: '', createdAt: `2026-08-01T00:00:${String(this.seq).padStart(2, '0')}Z`,
      unit: 'kg', ...e,
    } as RawMaterialEntry;
  }

  /** 로트를 건드리기 전에 이월이 생기는지 보고, 생기면 원장에 기초이월을 남긴다.
   *  = firebaseService.mutateRawMaterialLots가 하는 일 */
  private carryOver() {
    if (this.lots.length > 0 || this.stock <= 0) return;
    this.ledger.push(this.row({ received: this.stock, note: '기초이월 (로트 도입 전 재고)', type: 'manual' }));
  }

  /** 입고 — 로트 생성 + 원장 입고 */
  receive(kg: number, supplier = '풍회유통') {
    this.carryOver();
    const carried = withCarryOverLot(this.lots, this.stock, this.material);
    const lot = buildReceiveLot({ material: this.material, supplierName: supplier, qtyIn: 0, kgIn: kg, receivedDate: '2026-08-01' });
    this.lots = settleCarryOver([...carried, lot]);
    this.syncStock();
    this.ledger.push(this.row({ received: kg, note: `${supplier} 입고`, type: 'manual' }));
  }

  /** 사용 — FIFO 차감 + 원장 사용 */
  use(kg: number, note = '사용') {
    this.carryOver();
    const carried = withCarryOverLot(this.lots, this.stock, this.material);
    this.lots = deductFromLots(carried, kg).lots;
    this.syncStock();
    this.ledger.push(this.row({ used: kg, note, type: 'manual' }));
  }

  /** 실사 — 로트를 목표값에 맞추고 원장에 targetKg 앵커를 남긴다.
   *  로트가 안 움직여도(delta 0) 앵커는 **반드시** 쓴다 — 원장만 틀어진 경우를 잡으려면 그래야 한다. */
  stocktake(targetKg: number) {
    this.carryOver();
    const carried = withCarryOverLot(this.lots, this.stock, this.material);
    const delta = Math.round((targetKg - lotKgRemaining(carried)) * 1000) / 1000;
    if (delta > 0.001) {
      const lot = buildReceiveLot({ material: this.material, supplierName: '실사조정', qtyIn: 0, kgIn: delta, receivedDate: '2026-08-01' });
      this.lots = settleCarryOver([...carried, lot]);
    } else if (delta < -0.001) {
      this.lots = deductFromLots(carried, -delta).lots;
    } else {
      this.lots = carried;
    }
    this.syncStock();
    this.ledger.push(this.row({
      received: delta > 0 ? delta : 0, used: delta < 0 ? -delta : 0,
      targetKg, note: '재고실사', type: 'correction',
    }));
  }

  /** 원장 줄 삭제 — 로트도 같이 되돌린다.
   *  실사 줄도 예외가 아니다: targetKg는 잔량 앵커지만 received/used는 로트를 실제로 움직인 양이다.
   *  단, 그 줄 뒤에 실사가 있으면 로트를 건드리지 않는다 — 실사가 이미 로트를 덮어썼기 때문. */
  deleteEntry(id: string) {
    const e = this.ledger.find(x => x.id === id);
    if (!e) return;
    const ordered = sortLedger(this.ledger);
    const at = ordered.findIndex(x => x.id === id);
    const anchoredLater = at >= 0 && ordered.slice(at + 1).some(x => x.targetKg != null);
    const back = anchoredLater ? 0 : (e.used ?? 0) - (e.received ?? 0);
    if (Math.abs(back) > 0.0001) {
      const carried = withCarryOverLot(this.lots, this.stock, this.material);
      this.lots = back >= 0
        ? settleCarryOver([...carried, buildReceiveLot({ material: this.material, supplierName: '삭제 되돌림', qtyIn: 0, kgIn: back, receivedDate: '2026-08-01' })])
        : deductFromLots(carried, -back).lots;
      this.syncStock();
    }
    this.ledger = this.ledger.filter(x => x.id !== id);
  }

  get lotSum() { return lotKgRemaining(this.lots); }
  get balance() { return ledgerBalanceKg(this.ledger); }
}

/** 세 값이 같아야 한다 */
const expectAligned = (w: Warehouse, label: string) => {
  expect(`${label} 로트합=${w.lotSum} stock=${w.stock} 잔량=${w.balance}`)
    .toBe(`${label} 로트합=${w.lotSum} stock=${w.lotSum} 잔량=${w.lotSum}`);
};

describe('원장 잔량 = 로트합 = stock', () => {
  it('입고 → 사용 → 입고', () => {
    const w = new Warehouse();
    w.receive(500);   expectAligned(w, '입고500');
    w.use(120);       expectAligned(w, '사용120');
    w.receive(80);    expectAligned(w, '입고80');
    expect(w.lotSum).toBe(460);
  });

  it('로트보다 많이 쓰면 음수 이월로 흡수 — 그래도 셋은 같이 간다', () => {
    const w = new Warehouse();
    w.receive(50);
    w.use(200);       expectAligned(w, '초과사용');
    expect(w.lotSum).toBe(-150);
    w.receive(300);   expectAligned(w, '입고로 상쇄');
    expect(w.lotSum).toBe(150);
  });

  it('실사는 셋을 목표값 하나로 모은다', () => {
    const w = new Warehouse();
    w.receive(500);
    w.use(120);
    w.stocktake(300);
    expect(w.lotSum).toBe(300);
    expect(w.stock).toBe(300);
    expect(w.balance).toBe(300);
  });
});

describe('전에 틀어지던 경로 — 회귀', () => {
  it('로트 없이 stock만 있던 원료를 처음 차감 (이월 로트)', () => {
    // 로트 도입 전 재고 800kg. 예전엔 이월 로트만 생기고 원장엔 아무 줄도 안 남아
    // 로트합 800 / 잔량 0 으로 딱 800 벌어졌다.
    const w = new Warehouse('참깨', 800);
    w.use(200);
    expectAligned(w, '이월 후 사용');
    expect(w.lotSum).toBe(600);
    expect(w.balance).toBe(600);
    // 기초이월 줄이 실제로 남았는지
    expect(w.ledger.some(e => e.note?.includes('기초이월') && e.received === 800)).toBe(true);
  });

  it('로트는 맞는데 원장만 틀어진 상태에서 실사 (앵커)', () => {
    const w = new Warehouse();
    w.receive(500);
    w.use(100);
    // 원장에만 유령 사용 줄이 끼어든 상황을 만든다 (로트는 안 건드림).
    // 실사보다 **앞선** 시각이어야 한다 — 앵커는 그 지점까지의 누적만 끊는다.
    w.ledger.push({
      id: 'ghost', material: '참깨', date: '2026-08-01', received: 0, used: 70,
      note: '유령', createdAt: '2026-08-01T00:00:02.5Z', unit: 'kg', type: 'manual',
    } as RawMaterialEntry);
    expect(w.balance).toBe(330);
    expect(w.lotSum).toBe(400);          // 벌어진 상태

    // 실사로 400을 넣으면 — 로트는 이미 400이라 delta 0.
    // 예전엔 delta 0이면 원장 줄을 건너뛰어 잔량이 330 그대로였다.
    w.stocktake(400);
    expectAligned(w, '실사로 앵커');
    expect(w.balance).toBe(400);
  });

  it('원장 줄을 지우면 로트도 되돌아온다', () => {
    const w = new Warehouse();
    w.receive(500);
    w.use(775, '들깨 사용');
    expectAligned(w, '사용 직후');
    const usedRow = w.ledger.find(e => e.used === 775)!;

    // 예전엔 원장 줄만 지워서 로트가 −775인 채 남았다
    w.deleteEntry(usedRow.id);
    expectAligned(w, '사용 기록 삭제');
    expect(w.lotSum).toBe(500);
  });

  it('입고 줄을 지워도 마찬가지', () => {
    const w = new Warehouse();
    w.receive(500);
    w.receive(300, '대한농산');
    const row = w.ledger.find(e => e.received === 300)!;
    w.deleteEntry(row.id);
    expectAligned(w, '입고 기록 삭제');
    expect(w.lotSum).toBe(500);
  });

  it('실사 줄을 지우면 로트도 실사 전으로 되돌아간다', () => {
    // 실사 줄은 앵커이자 실제 로트 이동이다. 앵커라고 로트를 안 되돌리면
    // 로트 300 / 잔량 500 으로 벌어진다 — 이 테스트가 그걸 잡아냈다.
    const w = new Warehouse();
    w.receive(500);
    w.stocktake(300);
    expectAligned(w, '실사 직후');

    const anchor = w.ledger.find(e => e.targetKg != null)!;
    w.deleteEntry(anchor.id);
    expectAligned(w, '실사 기록 삭제');
    expect(w.lotSum).toBe(500);   // 실사로 깎은 200이 되돌아온다
  });
});

describe('길게 섞어 돌려도 안 벌어진다', () => {
  it('입고·사용·실사·삭제를 20번 섞는다', () => {
    const w = new Warehouse('참깨', 120);   // 로트 도입 전 재고부터 시작
    const ops = [
      () => w.receive(300), () => w.use(50), () => w.use(500), () => w.receive(1000),
      () => w.stocktake(700), () => w.use(120), () => w.receive(40), () => w.stocktake(700),
      () => w.use(33.5), () => w.receive(12.25),
    ];
    for (let i = 0; i < ops.length; i++) {
      ops[i]();
      expectAligned(w, `${i + 1}번째`);
    }
    // 손입력 줄을 뒤에서부터 지워도 계속 맞아야 한다
    const removable = w.ledger.filter(e => e.targetKg == null && !e.note?.includes('기초이월')).reverse();
    for (const e of removable) {
      w.deleteEntry(e.id!);
      expectAligned(w, `삭제 ${e.id}`);
    }
  });
});
