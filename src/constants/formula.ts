
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
};

/** 밀도 (kg/L) — 고체류는 용량 단위(g, kg)로 직접 계산 */
export const DENSITY: Record<string, number> = {
  '통깨참기름': 0.916,
  '깨분참기름': 0.916,
  '통들깨들기름': 0.924,
  '수입들기름': 0.924,
};

/** 원료수불부 추적 대상 원료 목록 */
export const RM_LIST = [
  '참깨', '들깨', '검정깨', '탈피들깨가루', '깨분',
  '볶음참깨', '볶음들깨', '볶음검정참깨',
  '통깨참기름', '깨분참기름', '통들깨들기름', '수입들기름',
];

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
