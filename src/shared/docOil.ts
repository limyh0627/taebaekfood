import { PRODUCT_FORMULA } from '../constants/formula';
import { unpackComponent } from './orderUnits';
import type { Item } from './types';

/**
 * 서류(원료수불부·생산판매기록부·생산작업기록부·생산작업기록부2) 공용 계산.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  ⚠ 원장은 **둘**이다. 이름으로 구분한다 — 「실제 원장」과 「서류용 원장」.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  ┌─ 실제 원장 (rawMaterialLedger 컬렉션) ────────────────────────────────────┐
 *  │  창고에서 실제로 일어난 일. 로트와 한 몸으로 움직인다.                        │
 *  │  · 언제 쓰나  : 작업완료 시 자동차감(rm-auto), 입고, 실사·정정                 │
 *  │  · 날짜 기준  : 그 일이 실제로 일어난 때                                     │
 *  │  · 단위       : 등급(통깨참기름·깨분참기름 …)                                │
 *  │  · 화면       : 재고관리 > 원료재고 > [입출고 기록], 로트 이력                 │
 *  │  · 성격       : 실물 추적용. 관청에 내지 않는다                              │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ 서류용 원장 (rawDocEntries 컬렉션) ──────────────────────────────────────┐
 *  │  관청 제출용 원료수불부를 만들기 위한 기록. **실제 원장과 별개 컬렉션이다.**     │
 *  │  · 담는 것    : 서류 전용 실사, 첫 달 전월이월                               │
 *  │  · 사용량     : 판매에서 되계산 (docSaleLine → docOilKg → addOilByRaw)      │
 *  │  · 입고       : 실제 원장 그대로 ← 실제 원장에서 오는 **유일한** 값           │
 *  │  · 전월이월   : 전달 서류의 기말재고 — 실제 원장 누적이 아니다                 │
 *  │  · 날짜 기준  : 배송완료일(docDateOf) — 판매기록부와 같은 날                  │
 *  │  · 화면       : 서류 관리 > [원료수불부] 탭                                  │
 *  │  · 만드는 곳  : buildRawDocSheetFor() ↓                                    │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  두 원장이 같은 날짜·같은 양일 필요는 없다.
 *  실제 원장은 **실제 차감 시점**, 서류용 원장은 **판매 시점**을 본다.
 *  서류에 실제 원장의 자동차감(rm-auto)·실사는 절대 넣지 않는다.
 *
 *  ※ 완제품·박스는 어느 원장에도 안 들어간다. 둘 다 원료 전용이다.
 *    완제품 재고는 items.stock 숫자만 덮어쓰며, 입출고 이력은 주문(orders)에만 남는다.
 *
 * 네 서류가 **같은 숫자**를 써야 해서 계산은 여기 한 곳에만 둔다.
 * 예전엔 같은 계산이 다섯 군데에 흩어져 있었고 kg 규격 처리·품목 리매핑·배합비가 서로 달랐다.
 */

/** 서류상 밀도 — 품목별로 나누지 않고 하나로 쓴다(서류 관행). */
export const DOC_DENSITY = 0.92;

/**
 * 생산작업기록부의 시트 구성 — 브랜드로 묶는다. 화면·엑셀이 같은 목록을 쓴다.
 * (예전엔 엑셀 8종 / 화면 10종으로 갈려 가득찬순참기름 등이 엑셀에서 빠졌다)
 */
export const DOC_SHEET_GROUPS: { brand: string; cats: string[] }[] = [
  { brand: '시골향', cats: ['시골향참기름1', '시골향참기름2', '시골향참기름3', '시골향참기름4', '시골향들기름1', '시골향들기름2'] },
  { brand: '하남댁', cats: ['하남댁참기름', '하남댁들기름', '하남댁맑음들기름'] },
  { brand: '해달', cats: ['해달참기름', '해달들기름'] },
  { brand: '가득찬', cats: ['가득찬순참기름'] },
  { brand: '해내음', cats: ['시골집참기름(해내음)'] },
];

/** 시트 목록(평탄) — 엑셀은 이 순서대로 만든다 */
export const DOC_SHEET_CATS = DOC_SHEET_GROUPS.flatMap(g => g.cats);

/** 시트 기본 제목. 사용자가 고치면 docSheetTitles 컬렉션 값이 우선한다. */
export const DEFAULT_SHEET_TITLE: Record<string, string> = {
  시골향참기름1: '시골향참기름①',
  시골향참기름2: '시골향참기름②',
  시골향참기름3: '시골향참기름③',
  시골향참기름4: '시골향참기름④',
  시골향들기름1: '시골향들기름①',
  시골향들기름2: '시골향들기름②',
  하남댁참기름: '하남댁참기름',
  하남댁들기름: '하남댁들기름',
  하남댁맑음들기름: '하남댁 맑은 들기름',
  해달참기름: '해달참기름',
  해달들기름: '해달들기름',
  가득찬순참기름: '가득찬 순참기름',
  '시골집참기름(해내음)': '시골집참기름 (해내음)',
};

/** 배합을 사람이 읽는 문자열로 — 시트 제목 옆에 붙여 실제 비율을 보여준다 */
export const mixLabel = (품목: string): string =>
  (PRODUCT_FORMULA[품목] ?? [])
    .map(f => `${f.raw.replace(/참기름$|들기름$/, '')} ${Math.round(f.ratio * 100)}%`)
    .join(' + ');

/** 서류에서 합쳐 보는 품목. 새싹은 하남댁 라인으로 묶어 집계한다. */
const DOC_PUMOK_MERGE: Record<string, string> = {
  새싹참기름: '하남댁참기름',
  새싹들기름: '하남댁들기름',
};

/**
 * 서류 기준일 — **생산판매일지에서 고른 날짜**. 그 값이 `deliveredAt`에 박힌다.
 *
 * 네 서류(판매기록부·원료수불부·생산작업기록부 1·2)가 같은 날짜를 봐야 물량이 같은 날에 잡힌다.
 * 기준은 판매기록부를 뽑을 때 사람이 고른 날짜 하나이고, 나머지 셋이 그걸 따라간다.
 * 일지를 뽑는 코드가 `deliveredAt = ${고른날짜}T00:00:00.000Z`로 박아 준다(AdminApp).
 *
 * ⚠ 그래서 `deliveredAt`의 **시각 부분은 의미가 없다** — 언제나 00:00:00.000Z다.
 *   시각이 그 외의 값이면 2026-08-13 이전 옛 코드가 '처리한 순간'을 찍은 것이고,
 *   새벽에 뽑으면 하루 밀려 서류가 갈렸다. 그런 주문은 별도로 날짜를 맞춰야 한다.
 *
 * 전표일자(documentDate)·배송예정일(deliveryDate)은 **일부러 안 쓴다** —
 * 전표일자는 서류를 뽑은 날이라 실제 출고일과 하루씩 어긋났고(2026-08 기준 32건),
 * 배송예정일은 예정일 뿐이라 실제와 다를 수 있다.
 */
export const docDateOf = (o: { deliveredAt?: string }): string =>
  String(o.deliveredAt || '').slice(0, 10);

/** 판매에서 사용량을 되계산하는 원료 — 배합표에 나오는 모든 원료.
 *  이 원료들은 원장의 자동차감 줄 대신 판매분으로 다시 구해 서류에 넣는다(= 판매기록부와 같은 근거). */
export const DOC_RECALC_RAWS = new Set(
  Object.values(PRODUCT_FORMULA).flatMap(rows => rows.map(r => r.raw)),
);

/** 품목명 → 서류 집계용 품목명 */
export const docPumok = (품목?: string | null): string =>
  (품목 && DOC_PUMOK_MERGE[품목]) || 품목 || '';

/**
 * 판매 1줄 → 서류상 기름 kg.
 *  · 규격이 kg(캔·벌크)이면 그 자체가 기름 무게다 → 그대로 쓴다.
 *  · ml/L이면 부피 × 밀도.
 *  (예전 생산작업기록부는 kg 규격에도 ×0.92를 곱해 16.5kg 캔이 15.18kg으로 잡혔다)
 */
export const docOilKg = (spec: string | undefined, qty: number): number => {
  const s = String(spec ?? '').trim().toLowerCase();
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return 0;
  if (s.endsWith('kg')) return n * qty;
  if (s.endsWith('ml')) return (n / 1000) * qty * DOC_DENSITY;
  if (s.endsWith('l')) return n * qty * DOC_DENSITY;
  return 0;
};

/**
 * 주문 1줄 → 서류 집계 단위 { 품목, 규격, 수량 }.
 *
 * **박스는 낱개로 푼다** — 박스 품목은 품목·규격이 비어 있어 그냥 두면 통째로 누락된다.
 * (판매일지만 풀고 수불부·생산작업기록부는 안 풀어서, 판매의 대부분이 서류에서 빠져 있었다)
 * 품목이 없으면 null — 서류에 잡을 근거가 없는 줄이다.
 */
export const docUnpack = (
  product: Item | undefined,
  quantity: number,
  findItem: (id: string) => Item | undefined,
): { item: Item; qty: number } | null => {
  if (!product) return null;
  const unpack = unpackComponent(product);
  if (unpack) {
    const loose = findItem(unpack.itemId);
    if (loose) return { item: loose, qty: quantity * unpack.count };
  }
  return { item: product, qty: quantity };
};

/** 위를 거친 뒤 기름 집계에 쓸 형태로. 품목이 없으면 null(서류에 잡을 근거가 없는 줄). */
export const docSaleLine = (
  product: Item | undefined,
  quantity: number,
  findItem: (id: string) => Item | undefined,
): { 품목: string; spec: string; qty: number } | null => {
  const u = docUnpack(product, quantity, findItem);
  if (!u) return null;
  const 품목 = docPumok(u.item.품목);
  if (!품목) return null;
  return { 품목, spec: u.item.spec ?? '', qty: u.qty };
};

/**
 * 품목별 기름 kg → 원료별 kg. 배합비는 PRODUCT_FORMULA 한 곳에서만 온다.
 * @param into 누적할 대상 (원료명 → kg)
 */
export const addOilByRaw = (
  into: Record<string, number>,
  품목: string,
  kg: number,
): Record<string, number> => {
  if (!kg) return into;
  for (const f of PRODUCT_FORMULA[docPumok(품목)] ?? []) {
    const share = Math.round(kg * f.ratio);
    if (share > 0) into[f.raw] = (into[f.raw] ?? 0) + share;
  }
  return into;
};

/**
 * 판매기록부 ↔ 원료수불부 대조.
 *
 * 판매기록부에 오른 기름(품목별 kg)은 배합비로 쪼개져 원료수불부 사용량이 된다.
 * 배합비 합이 1이므로 **두 문서의 날짜별 총 kg은 같아야 한다.**
 * 안 맞으면 그 품목의 배합비가 없거나(PRODUCT_FORMULA 미등록) 비율 합이 1이 아니라는 뜻이고,
 * 그대로 두면 원료수불부 사용량이 판매보다 적게 잡힌다.
 *
 * @param saleByDate 날짜 → 품목 → 기름 kg (판매기록부 기준)
 * @param tolerance  반올림 오차 허용치(kg). 배분할 때 원료별로 반올림하므로 몇 kg은 정상.
 */
export interface DocMismatch {
  date: string;
  saleKg: number;      // 판매기록부에 오른 기름
  rawKg: number;       // 원료수불부로 배분된 기름
  diffKg: number;      // 판매 − 원료 (양수면 원료수불부에 덜 잡힘)
  unmapped: string[];  // 배합비가 없어 통째로 빠진 품목
}

/**
 * 판매기록부에 오른 줄이 원료수불부에서 빠지는 것 잡기 — **전 품목**(기름·깨·가루).
 *
 * 지금 켜 둔 건 **배송완료일 없음** 하나뿐이다.
 * 판매기록부는 주문 줄을 그대로 싣지만 원료수불부는 품목→규격→배합비로 옮겨 담으므로,
 * 아래 세 가지로도 줄이 사라질 수 있다. 다만 오탐이 많을 수 있어 지금은 켜지 않는다.
 *
 *   ② 품목 미지정   — docSaleLine이 null (품목 필드가 비어 서류에 잡을 근거가 없음)
 *   ③ 규격 못 읽음   — docOilKg가 0 ("한 박스"처럼 ml/L/kg가 없는 규격)
 *   ④ 배합비 없음   — PRODUCT_FORMULA에 그 품목이 없어 원료로 안 내려감
 *
 * 켤 때는 아래 주석 블록을 살리고 DocDropReason에 그 값들을 더하면 된다.
 */
export type DocDropReason = '배송완료일 없음';
export interface DocDrop {
  date: string;
  partnerName: string;
  itemName: string;
  qty: number;
  reason: DocDropReason;
}

interface DropOrder {
  status?: string;
  deliveredAt?: string;
  partnerName?: string;
  items?: { itemId?: string; name?: string; quantity: number }[];
}

export const findDocDrops = (
  orders: DropOrder[],
  /**
   * 검사 대상 상태 — **배송완료(DELIVERED)만**.
   *
   * 출고(SHIPPED)는 아직 배송완료 처리를 안 한 것이라 배송완료일이 없는 게 정상이다.
   * 그것까지 잡으면 처리 대기 중인 주문이 전부 경고로 떠서 진짜 문제가 묻힌다.
   * 배송완료인데 날짜가 없는 것만 이상한 상황이다.
   */
  statuses: string[] = ['DELIVERED'],
): DocDrop[] => {
  const out: DocDrop[] = [];
  for (const o of orders) {
    if (!statuses.includes(String(o.status))) continue;
    const date = docDateOf(o);
    if (date) continue;   // 날짜가 있으면 통과 — 나머지 검사는 아직 안 켰다
    for (const it of o.items ?? []) {
      out.push({
        date: '', partnerName: o.partnerName ?? '',
        itemName: it.name ?? it.itemId ?? '', qty: it.quantity,
        reason: '배송완료일 없음',
      });
    }
    // ── 아직 안 켠 검사 (오탐 확인 후 활성화) ──────────────────────────────
    // for (const it of o.items ?? []) {
    //   const product = it.itemId ? findItem(it.itemId) : undefined;
    //   const line = docSaleLine(product, it.quantity, findItem);
    //   if (!line) { push('품목 미지정'); continue; }
    //   if (docOilKg(line.spec, line.qty) <= 0) { push('규격 못 읽음'); continue; }
    //   const formula = PRODUCT_FORMULA[docPumok(line.품목)];
    //   if (!formula || formula.length === 0) push('배합비 없음');
    // }
  }
  return out;
};

export const reconcileSaleVsRaw = (
  saleByDate: Record<string, Record<string, number>>,
  tolerance = 2,
): DocMismatch[] => {
  const out: DocMismatch[] = [];
  for (const [date, byPumok] of Object.entries(saleByDate)) {
    let saleKg = 0;
    const unmapped: string[] = [];
    const raws: Record<string, number> = {};
    for (const [품목, kg] of Object.entries(byPumok)) {
      if (!kg) continue;
      saleKg += kg;
      const formula = PRODUCT_FORMULA[docPumok(품목)];
      if (!formula || formula.length === 0) {
        if (!unmapped.includes(품목)) unmapped.push(품목);
        continue;
      }
      addOilByRaw(raws, 품목, kg);
    }
    const rawKg = Object.values(raws).reduce((a, v) => a + v, 0);
    const diffKg = Math.round((saleKg - rawKg) * 1000) / 1000;
    if (Math.abs(diffKg) > tolerance || unmapped.length > 0) {
      out.push({ date, saleKg: Math.round(saleKg), rawKg: Math.round(rawKg), diffKg: Math.round(diffKg), unmapped });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
};

// ── 원료수불부(서류) 한 장 만들기 ────────────────────────────────────────────
// ⚠ **서류용 원장**으로 만든다. **실제 원장**(rawMaterialLedger)과 다른 것이다.
//    실제 원장에서 가져오는 건 **입고뿐**이다.
//
//   사용량    판매에서 되계산 (oilOutflow) — 실제 원장의 자동차감(rm-auto)은 안 본다
//   입고      실제 원장 그대로
//   실사      서류용 원장(rawDocEntries)의 실사 — 실제 원장 실사는 안 본다
//   전월이월  전달 서류의 기말재고 — 실제 원장 누적이 아니다
//
// 전월이월이 재귀라 첫 달만 서류용 이월(type:'opening')을 넣어 주면 그 뒤는 저절로 이어진다.

/**
 * **서류용 원장** 한 줄 (rawDocEntries 컬렉션) — 관청 제출용 원료수불부를 만들기 위한 기록.
 *
 * 담는 건 서류 전용 실사와 첫 달 전월이월뿐이다. 창고에서 실제로 일어난 입출고는
 * **실제 원장**(RawMaterialEntry, rawMaterialLedger)에 있고, 여기 섞지 않는다.
 */
export interface RawDocEntry {
  id?: string;
  material: string;
  date: string;            // YYYY-MM-DD
  /** 실사 잔량(절대값) — 이 값으로 잔량을 맞춘다 */
  targetKg: number;
  /** 'opening' = 그 달 시작 이월, 'stocktake' = 기중 실사 */
  type: 'opening' | 'stocktake';
  note?: string;
  createdAt?: string;
}

export interface RawDocRow {
  date: string;
  received: number;
  used: number;
  adj: number;             // 실사로 움직인 양 (잔량 − 직전잔량)
  prevBalance: number;
  currentBalance: number;
  note: string;
  kind: '입고' | '사용' | '실사';
}

export interface RawDocSheet {
  rows: RawDocRow[];
  opening: number;         // 전월이월
  closing: number;         // 기말재고 → 다음 달 이월
  totalIn: number;
  totalOut: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** 한 달치 서류를 만든다. opening은 호출자가 넘긴다(전달 기말 또는 서류 이월). */
export const buildRawDocMonth = (input: {
  material: string;
  yearMonth: string;
  opening: number;
  /** 원장 입고 줄 — received > 0 인 것만 넘긴다 */
  ledgerReceipts: { date: string; received: number; note?: string; createdAt?: string }[];
  /** 서류 전용 실사 */
  docEntries: RawDocEntry[];
  /** 판매 되계산 사용량 — 날짜 → 원료 → kg */
  oilOutflow: Record<string, Record<string, number>>;
}): RawDocSheet => {
  const { material, yearMonth, opening, ledgerReceipts, docEntries, oilOutflow } = input;
  type Ev = { date: string; received: number; used: number; targetKg?: number; note: string; kind: RawDocRow['kind']; createdAt: string };
  const evs: Ev[] = [];
  for (const e of ledgerReceipts) {
    if (!e.date.startsWith(yearMonth) || !(e.received > 0)) continue;
    evs.push({ date: e.date, received: e.received, used: 0, note: e.note ?? '', kind: '입고', createdAt: e.createdAt ?? e.date });
  }
  for (const [d, byRaw] of Object.entries(oilOutflow)) {
    if (!d.startsWith(yearMonth)) continue;
    const used = byRaw[material] ?? 0;
    // 사용은 그날 '낮'에 일어난 것으로 본다 — 실사를 아침(00:00)에 찍으면 사용 앞,
    // 저녁(23:00)에 찍으면 사용 뒤로 정렬돼 잔량 순서를 사용자가 정할 수 있다.
    if (used > 0) evs.push({ date: d, received: 0, used, note: '생산(서류)', kind: '사용', createdAt: `${d}T12:00:00` });
  }
  for (const e of docEntries) {
    if (e.material !== material || e.type !== 'stocktake' || !e.date.startsWith(yearMonth)) continue;
    evs.push({ date: e.date, received: 0, used: 0, targetKg: e.targetKg, note: e.note ?? '실사', kind: '실사', createdAt: e.createdAt ?? e.date });
  }
  evs.sort((a, b) => a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date));

  let bal = opening;
  const rows: RawDocRow[] = [];
  for (const e of evs) {
    const prev = bal;
    bal = e.targetKg != null ? e.targetKg : r3(bal + e.received - e.used);
    rows.push({
      date: e.date, received: e.received, used: e.used,
      adj: e.targetKg != null ? r3(bal - prev) : 0,
      prevBalance: prev, currentBalance: bal, note: e.note, kind: e.kind,
    });
  }
  return {
    rows, opening: r3(opening), closing: r3(bal),
    totalIn: r3(rows.reduce((a, r) => a + r.received, 0)),
    totalOut: r3(rows.reduce((a, r) => a + r.used, 0)),
  };
};

/**
 * 전월이월을 전달 서류의 기말에서 이어받아 그 달 서류를 만든다.
 * 첫 달은 서류 전용 이월(type:'opening')에서 출발하고, 없으면 0.
 */
export const buildRawDocSheetFor = (input: {
  material: string;
  yearMonth: string;
  ledgerReceipts: { date: string; received: number; note?: string; createdAt?: string }[];
  docEntries: RawDocEntry[];
  oilOutflow: Record<string, Record<string, number>>;
}): RawDocSheet => {
  const { material, yearMonth, docEntries } = input;
  // 시작 달 = 서류 이월이 박힌 달 중 가장 이른 것, 없으면 기록이 처음 나오는 달
  const openings = docEntries.filter(e => e.material === material && e.type === 'opening');
  const candidates = [
    ...openings.map(e => e.date.slice(0, 7)),
    ...input.ledgerReceipts.filter(e => e.received > 0).map(e => e.date.slice(0, 7)),
    ...Object.entries(input.oilOutflow).filter(([, v]) => (v[material] ?? 0) > 0).map(([d]) => d.slice(0, 7)),
  ].filter(m => m <= yearMonth).sort();
  let ym = candidates[0] ?? yearMonth;
  let opening = openings.filter(e => e.date.slice(0, 7) === ym).sort((a, b) => a.date.localeCompare(b.date))[0]?.targetKg ?? 0;
  let sheet = buildRawDocMonth({ ...input, yearMonth: ym, opening });
  // 목표 달까지 기말 → 이월로 이어 붙인다 (그 달에 서류 이월이 새로 박혀 있으면 그걸 우선)
  while (ym < yearMonth) {
    ym = ym === prevYm(yearMonth) ? yearMonth : nextYm(ym);
    const forced = openings.filter(e => e.date.slice(0, 7) === ym).sort((a, b) => a.date.localeCompare(b.date))[0];
    opening = forced ? forced.targetKg : sheet.closing;
    sheet = buildRawDocMonth({ ...input, yearMonth: ym, opening });
  }
  return sheet;
};

const nextYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
