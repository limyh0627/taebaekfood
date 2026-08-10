import { PRODUCT_FORMULA } from '../constants/formula';
import { unpackComponent } from './orderUnits';
import type { Item } from './types';

/**
 * 서류(원료수불부·생산판매기록부·생산작업기록부·생산작업기록부2) 공용 계산.
 *
 * 네 서류가 **같은 숫자**를 써야 해서 여기 한 곳에만 둔다.
 * 예전엔 같은 계산이 다섯 군데에 흩어져 있었고 kg 규격 처리·품목 리매핑·배합비가 서로 달랐다.
 *
 * 재고(로트·원장)와는 별개다 — 재고는 BOM(반제품)이 정하고, 서류는 판매분을 이 규칙으로 되돌아 계산한다.
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
 * 서류 기준일 — **판매기록부를 찍은 날**.
 *
 * 판매기록부를 내보낼 때 그 날짜(documentDate)가 대상 주문에 박힌다.
 * 원료수불부·생산작업기록부 1·2도 같은 날짜를 봐야 네 서류의 물량이 같은 날에 잡힌다.
 * (예전엔 서류마다 documentDate·deliveryDate·deliveredAt이 뒤섞여, 8/10에 나간 물건이
 *  참기름은 8/13, 볶음참깨는 8/10에 잡히는 일이 있었다.)
 */
export const docDateOf = (o: {
  documentDate?: string; deliveredAt?: string; deliveryDate?: string;
}): string => String(o.documentDate || o.deliveredAt || o.deliveryDate || '').slice(0, 10);

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
