import type { RawMaterialLot } from '../shared/types';

/** 품목명 → 원료 배합비율 */
export const PRODUCT_FORMULA: Record<string, { raw: string; ratio: number }[]> = {
  '시골향참기름1': [{ raw: '통깨참기름', ratio: 1.0 }],
  '시골향참기름2': [{ raw: '통깨참기름', ratio: 0.5 }, { raw: '깨분참기름', ratio: 0.5 }],
  '시골향참기름3': [{ raw: '깨분참기름', ratio: 1.0 }],
  '시골향참기름4': [{ raw: '통깨참기름', ratio: 0.25 }, { raw: '깨분참기름', ratio: 0.75 }],
  '시골향들기름1': [{ raw: '통들깨들기름', ratio: 1.0 }],
  '시골향들기름2': [{ raw: '통들깨들기름', ratio: 0.1 }, { raw: '수입들기름', ratio: 0.9 }],
  '시골향볶음참깨': [{ raw: '볶음참깨', ratio: 1.0 }],
  '시골향들깨가루': [{ raw: '볶음들깨', ratio: 1.0 }],
  '시골향탈피들깨가루': [{ raw: '탈피들깨가루', ratio: 1.0 }],
  '시골향볶음검정참깨': [{ raw: '볶음검정참깨', ratio: 1.0 }],
  // OEM/타브랜드 (2026-07 추가) — item_formula와 동일
  '통들깨-낱개/1kg': [{ raw: '볶음들깨', ratio: 1.0 }],
  '시골집참기름(해내음)': [{ raw: '통깨참기름', ratio: 0.5 }, { raw: '깨분참기름', ratio: 0.5 }],
  '하남댁들기름': [{ raw: '통들깨들기름', ratio: 0.25 }, { raw: '수입들기름', ratio: 0.75 }],
  '해달참기름': [{ raw: '통깨참기름', ratio: 0.2 }, { raw: '깨분참기름', ratio: 0.8 }],
  '해달들기름': [{ raw: '통들깨들기름', ratio: 0.2 }, { raw: '수입들기름', ratio: 0.8 }],
  '하남댁참기름': [{ raw: '통깨참기름', ratio: 0.2 }, { raw: '깨분참기름', ratio: 0.8 }],
  '하남댁맑음들기름': [{ raw: '생들기름', ratio: 1.0 }],
  '가득찬순참기름': [{ raw: '통깨참기름', ratio: 0.2 }, { raw: '깨분참기름', ratio: 0.8 }],
};

/** 밀도 (kg/L) — 고체류는 용량 단위(g, kg)로 직접 계산 */
export const DENSITY: Record<string, number> = {
  '통깨참기름': 0.916,
  '깨분참기름': 0.916,
  '통들깨들기름': 0.924,
  '수입들기름': 0.924,
  '생들기름': 0.924,
};

/** 원료수불부 추적 대상 원료 목록 */
export const RM_LIST = [
  '참깨', '들깨', '검정깨', '탈피들깨가루', '깨분',
  '볶음참깨', '볶음들깨', '볶음검정참깨',
  '통깨참기름', '깨분참기름', '통들깨들기름', '수입들기름',
  '생들기름', // 누락돼 있던 원료 — 없으면 거래처 입고가 로트/수불부에 안 잡히고(rawLotTarget null) 차감만 됨
  '들깨가루(고운)', // 2026-07-02 실사 시 추가한 원료
];

/** 원료별 운영 단위 (입고/사용·원료수불부 표기 단위) */
export type RawUnit = 'kg' | 'L';
export const RM_UNITS: Record<string, RawUnit> = {
  '참깨': 'kg', '들깨': 'kg', '검정깨': 'kg', '탈피들깨가루': 'kg', '깨분': 'kg',
  '볶음참깨': 'kg', '볶음들깨': 'kg', '볶음검정참깨': 'kg',
  '통깨참기름': 'L', '깨분참기름': 'L', '통들깨들기름': 'L', '수입들기름': 'L',
  '생들기름': 'L',
  '들깨가루(고운)': 'kg',
};
export const unitOf = (material: string): RawUnit => RM_UNITS[material] ?? 'kg';

/**
 * 품목명에서 규격 접미사를 떼어낸 기본 원료명.
 * 예) "깨분참기름/16.5kg" → "깨분참기름", "볶음들깨/25kg" → "볶음들깨"
 * 품목명 일괄변경(규격 접미사 추가) 이후 RM_LIST 매칭이 깨지는 것을 보완.
 */
export function baseRawName(name: string): string {
  return (name ?? '').split('/')[0].trim();
}

/**
 * 규격 문자열에서 포장 1개당 kg을 파싱. "16.5kg" → 16.5, "20kg" → 20, "25kg" → 25.
 * (L 규격은 포장 단위로 쓰지 않으므로 kg만 인식)
 */
export function parsePackageKg(spec?: string): number | undefined {
  if (!spec) return undefined;
  const m = spec.match(/([\d.]+)\s*kg/i);
  return m ? parseFloat(m[1]) : undefined;
}

/** kg → 해당 원료의 운영 단위 값 (기름이면 L = kg / 밀도, 그 외 kg 그대로) */
export function kgToUnit(kg: number, material: string): number {
  if (unitOf(material) !== 'L') return kg;
  const d = DENSITY[material] ?? 1.0;
  return kg / d;
}

/** 운영 단위 값 → kg (기름이면 kg = L × 밀도, 그 외 그대로) */
export function unitToKg(val: number, material: string): number {
  if (unitOf(material) !== 'L') return val;
  const d = DENSITY[material] ?? 1.0;
  return val * d;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** active 로트들의 잔여 kg 합계 */
export function lotKgRemaining(lots?: RawMaterialLot[]): number {
  return round3((lots ?? [])
    .filter(l => l.status === 'active')
    .reduce((s, l) => s + (l.kgRemaining ?? 0), 0));
}

/** active 로트 잔여 합계를 원료 운영 단위(기름=L)로 환산 — items.stock 동기화용 */
export function lotStockInUnit(lots: RawMaterialLot[] | undefined, material: string): number {
  return round3(kgToUnit(lotKgRemaining(lots), material));
}

/** 제품 용량 문자열 + 원료명 + 수량 → kg 환산 */
export function toKg(용량: string, raw: string, qty: number): number {
  const m = 용량.match(/^([\d.]+)\s*(ml|l|g|kg)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const d = DENSITY[raw] ?? 1.0;
  if (unit === 'ml') return val / 1000 * d * qty;
  if (unit === 'l') return val * d * qty;
  if (unit === 'g') return val / 1000 * qty;
  if (unit === 'kg') return val * qty;
  return 0;
}
