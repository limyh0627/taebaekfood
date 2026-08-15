import type { RawMaterialLot } from '../shared/types';

/** 품목명 → 원료 배합비율 */
export const PRODUCT_FORMULA: Record<string, { raw: string; ratio: number }[]> = {
  '시골향참기름1': [{ raw: '통깨참기름', ratio: 1.0 }],
  '시골향참기름2': [{ raw: '통깨참기름', ratio: 0.5 }, { raw: '깨분참기름', ratio: 0.5 }],
  '시골향참기름3': [{ raw: '깨분참기름', ratio: 1.0 }],
  '시골향참기름4': [{ raw: '통깨참기름', ratio: 0.1 }, { raw: '깨분참기름', ratio: 0.9 }],
  '시골향들기름1': [{ raw: '통들깨들기름', ratio: 1.0 }],
  // 수입산 100% (2026-08-12 확인). 예전엔 통들깨 10%로 잡아 서류의 통들깨 사용량이 부풀었다.
  //   재고 차감은 여기를 안 본다 — 품목 BOM이 반제품 '들기름'을 물고, 그 배합은
  //   item_formula(수입 0.8 / 통들깨 0.2)가 정한다. 이 표는 **서류 배합**과 원료부족 알림용이다.
  '시골향들기름2': [{ raw: '수입들기름', ratio: 1.0 }],
  '시골향볶음참깨': [{ raw: '볶음참깨', ratio: 1.0 }],
  '시골향들깨가루': [{ raw: '볶음들깨', ratio: 1.0 }],
  '시골향탈피들깨가루': [{ raw: '탈피들깨가루', ratio: 1.0 }],
  '시골향볶음검정참깨': [{ raw: '볶음검정참깨', ratio: 1.0 }],
  // OEM/타브랜드 (2026-07 추가) — item_formula와 동일
  '통들깨-낱개/1kg': [{ raw: '볶음들깨', ratio: 1.0 }],
  '시골집참기름(해내음)': [{ raw: '통깨참기름', ratio: 0.5 }, { raw: '깨분참기름', ratio: 0.5 }],
  '하남댁들기름': [{ raw: '통들깨들기름', ratio: 0.25 }, { raw: '수입들기름', ratio: 0.75 }],
  '해달참기름': [{ raw: '통깨참기름', ratio: 1.0 }],
  '새싹참기름': [{ raw: '통깨참기름', ratio: 1.0 }],
  '해달들기름': [{ raw: '통들깨들기름', ratio: 0.2 }, { raw: '수입들기름', ratio: 0.8 }],
  '하남댁참기름': [{ raw: '통깨참기름', ratio: 1.0 }],
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

/**
 * ━━━ 단위 규칙 (2026-08-14) ━━━
 * **저장은 언제나 kg이다.** items.stock · item_bom.quantity · 로트 · 원료수불부 전부 kg.
 * L은 **보여줄 때만** 쓴다 — 품목의 density(kg/L)로 나눠서 표시하고, 입력받으면 곱해서 저장한다.
 *
 * 예전엔 기름은 L로, 고체는 kg으로 저장해서 "이 숫자가 L이냐 kg이냐"를
 * 이름·단위·카테고리로 매번 추측했다. 그 추측이 어긋나 BOM 10줄이 틀어져 있었다.
 */

/** 저장값(kg) → 보여줄 값. 밀도가 있는 원료만 L로 나눈다. */
export function kgToUnit(kg: number, material: string): number {
  const d = DENSITY[baseRawName(material)];
  return d ? kg / d : kg;
}

/** 화면에서 L로 입력받은 값 → 저장할 kg. 밀도가 있는 원료만 곱한다. */
export function unitToKg(val: number, material: string): number {
  const d = DENSITY[baseRawName(material)];
  return d ? val * d : val;
}

/** 원료 목록을 화면에서 묶는 갈래 — 원료가 많아 종류별로 접어 본다. 표시 순서이기도 하다. */
export const RAW_GROUPS = ['참기름', '들기름', '참깨', '들깨', '기타'] as const;

/** 원료명 → 갈래. 이름으로 판단하므로 새 원료가 생겨도 어딘가에는 들어간다. */
export function rawGroupOf(material: string): string {
  const n = String(material ?? '');
  if (n.includes('참기름')) return '참기름';
  if (n.includes('들기름')) return '들기름';
  if (n.includes('들깨')) return '들깨';
  if (n.includes('깨')) return '참깨';       // 참깨·깨분·검정깨·볶음참깨…
  return '기타';
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** active 로트들의 잔여 kg 합계 */
export function lotKgRemaining(lots?: RawMaterialLot[]): number {
  return round3((lots ?? [])
    .filter(l => l.status === 'active')
    .reduce((s, l) => s + (l.kgRemaining ?? 0), 0));
}

/**
 * items.stock 동기화용 — 로트 잔여를 그대로 kg으로 돌려준다.
 * 재고는 2026-08-14부터 **언제나 kg**으로 저장한다(기름도 마찬가지). L은 표시할 때만 쓴다.
 * @deprecated 이름이 옛 뜻(운영단위 환산)을 담고 있다. 새 코드는 lotKgRemaining을 쓸 것.
 */
export function lotStockInUnit(lots: RawMaterialLot[] | undefined, _material: string): number {
  return lotKgRemaining(lots);
}

/** 제품 용량 문자열 + 원료명 + 수량 → kg 환산 */
/**
 * 규격 문자열의 **앞부분 숫자+단위**만 뽑는다. 뒤에 개입수가 붙어도('1750ml * 10') 안 흔들린다.
 * 규격은 "낱개 하나의 용량 [* 개입수]" 꼴이므로 앞이 곧 용량이다.
 */
export function parseSpecUnit(spec?: string): { value: number; unit: 'ml' | 'l' | 'g' | 'kg' } | null {
  const m = /^\s*([\d.]+)\s*(ml|l|g|kg)\b/i.exec(String(spec ?? ''));
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!isFinite(value) || value <= 0) return null;
  return { value, unit: m[2].toLowerCase() as 'ml' | 'l' | 'g' | 'kg' };
}

/** 규격에서 개입수를 읽는다 — '1750ml * 10' → 10. 없으면 1(낱개). */
export function parseSpecCount(spec?: string): number {
  const m = /[*x×]\s*([\d.]+)/i.exec(String(spec ?? ''));
  const n = m ? parseFloat(m[1]) : NaN;
  return isFinite(n) && n > 0 ? n : 1;
}

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
