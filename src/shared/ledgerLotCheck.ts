import { collection, getDocs, query, where, doc, getDoc, Firestore } from 'firebase/firestore';
import type { RawMaterialEntry, RawMaterialLot } from './types';
import { ledgerBalanceKg } from './rawLedgerBalance';

/**
 * **원장 잔량과 로트 잔량이 맞나 — 쓰고 나서 되읽어 확인한다.**
 *
 * 원장과 로트는 언제나 같은 값이어야 한다(`rawLedgerBalance.ts` 참조). 그런데 둘을 **따로**
 * 쓰기 때문에 한쪽만 성공하면 그대로 갈린다. 여태 그 실패를 `catch`로 삼키고 콘솔에만 찍었다 —
 * 아무도 안 보고, 다음 사람이 몇 주 뒤에 "왜 안 맞냐"로 만난다.
 *
 * 쓰는 순서를 바꾸는 걸로는 못 막는다. 로트 쓰기가 실패하면 어차피 일은 날아가고,
 * 다만 조용히 날아갈 뿐이다. **쓴 다음 되읽어 대조하는 것**만이 실패를 잡아낸다.
 *
 * 오차 한도는 1kg — 로트는 kg 소수 셋째 자리까지 반올림하며 돌아서 몇 g씩은 늘 흔들린다.
 */
export const GAP_TOLERANCE_KG = 1;

export interface LedgerLotGap {
  material: string;
  ledgerKg: number;
  lotKg: number;
  gapKg: number;      // 원장 − 로트. +면 로트가 덜 깎였고, −면 로트만 깎였다.
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const lotRemainingKg = (lots: RawMaterialLot[] | undefined): number =>
  r3((lots ?? []).reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0));

/** 순수 계산 — 원장 줄과 로트를 받아 벌어진 양을 낸다. 한도 안이면 null. */
export function ledgerLotGap(
  material: string,
  entries: RawMaterialEntry[],
  lots: RawMaterialLot[] | undefined,
  density = 1,
  tolerance = GAP_TOLERANCE_KG,
): LedgerLotGap | null {
  const ledgerKg = r3(ledgerBalanceKg(entries, density));
  const lotKg = lotRemainingKg(lots);
  const gapKg = r3(ledgerKg - lotKg);
  return Math.abs(gapKg) > tolerance ? { material, ledgerKg, lotKg, gapKg } : null;
}

/**
 * DB에서 되읽어 대조한다 — 쓰기 직후에 부른다.
 * 읽기 실패는 삼킨다(확인 자체가 본작업을 막으면 안 된다). 못 읽으면 null.
 */
export async function checkLedgerLot(
  db: Firestore, rawItemId: string, material: string, density = 1,
): Promise<LedgerLotGap | null> {
  try {
    /**
     * **열쇠(`rawItemId`)로 찾는다 — 이름이 아니라.**
     *
     * 예전엔 `where('material','==',…)` 로 **전 회사를 한데 긁어** 한 회사 로트와 견줬다.
     * 태백·풍회가 같이 쓰는 참깨·깻묵에서는 남의 회사 줄까지 더해 놓고 "안 맞는다"고 했다.
     * 반대로 이름이 어긋난 줄(검정참깨 홀더인데 원장엔 '검정깨')은 아예 빠져서
     * −80kg 이 조용히 갈려 있었다.
     *
     * 2026-09-09 에 원장 726줄 전부에 `rawItemId` 를 채웠다(`scripts/fix-raw-ledger-keys.mts`).
     * 그래도 **한 줄이라도 열쇠가 없으면** 옛 방식(이름)으로 한 번 더 본다 — 새로 만들어진
     * 줄이 열쇠를 빠뜨렸는데 조용히 "맞다"고 하면 안 되기 때문이다.
     */
    const [snap, byKey, byName] = await Promise.all([
      getDoc(doc(db, 'items', rawItemId)),
      getDocs(query(collection(db, 'rawMaterialLedger'), where('rawItemId', '==', rawItemId))),
      getDocs(query(collection(db, 'rawMaterialLedger'), where('material', '==', material))),
    ]);
    if (!snap.exists()) return null;
    const lots = (snap.data().lots ?? []) as RawMaterialLot[];
    const rows = new Map<string, RawMaterialEntry>();
    for (const d of byKey.docs) rows.set(d.id, { id: d.id, ...d.data() } as RawMaterialEntry);
    //  열쇠가 아직 안 박힌 옛 줄만 이름으로 주워 담는다. 열쇠가 **다른 품목**을 가리키면 남의 것이다.
    for (const d of byName.docs) {
      const e = { id: d.id, ...d.data() } as RawMaterialEntry;
      if (e.rawItemId == null) rows.set(d.id, e);
    }
    const entries = [...rows.values()];
    return ledgerLotGap(material, entries, lots, density);
  } catch (e) {
    console.error('[원장·로트 대조] 되읽기 실패:', material, e);
    return null;
  }
}

/** 사람이 읽을 한 줄 — 알림·토스트에 그대로 쓴다. */
export const gapMessage = (g: LedgerLotGap): string =>
  `${g.material}: 원장 ${g.ledgerKg}kg ≠ 로트 ${g.lotKg}kg (${g.gapKg > 0 ? '로트가 ' + g.gapKg + 'kg 덜 빠짐' : '로트만 ' + -g.gapKg + 'kg 더 빠짐'})`;
