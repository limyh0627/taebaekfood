/**
 * 부자재 칩 색 — **품목 이름에 붙은 색을 그대로 쓴다.**
 * 주문카드·주문생성 화면이 같은 색을 쓴다.
 *
 *   물엿캡-빨강      → 빨강
 *   이중캡-골드      → 골드
 *   테이프-투명      → 투명
 *   1800ML-페트병-노랑D → 노랑
 *   스마트스토어(골드)/1.8L → 골드
 *
 * 색은 `-빨강` `(골드)`처럼 **구분자 뒤에 올 때만** 인정한다.
 * 그냥 이름에 든 글자를 찾으면 `모란 검정참깨`·`1KG-볶음검정깨`가 검정으로 칠해진다.
 *
 * 박스는 색이 여러 개여도 다 같은 골판지라 **회색으로 통일**한다(사장님 지정).
 */
export const CHIP_NEUTRAL = 'bg-slate-50 text-slate-500 border-slate-200';

/** 이름 끝쪽 색 이름 → 칩 클래스 */
const COLOR: Record<string, string> = {
  빨강: 'bg-red-100 text-red-700 border-red-300',
  주황: 'bg-orange-100 text-orange-700 border-orange-300',
  노랑: 'bg-yellow-100 text-yellow-800 border-yellow-400',
  연두: 'bg-lime-100 text-lime-700 border-lime-400',
  초록: 'bg-green-100 text-green-700 border-green-300',
  파랑: 'bg-blue-100 text-blue-700 border-blue-300',
  검정: 'bg-slate-700 text-white border-slate-800',
  하양: 'bg-white text-slate-600 border-slate-300',
  투명: 'bg-white/60 text-slate-400 border-dashed border-slate-300',
  골드: 'bg-amber-100 text-amber-800 border-amber-400',
  갈색: 'bg-stone-200 text-stone-700 border-stone-400',
};

const COLOR_RE = new RegExp(`[-(]\\s*(${Object.keys(COLOR).join('|')})`);

/** 이름에서 색을 뽑는다. 없으면 null */
export function colorOfName(name?: string): string | null {
  const m = COLOR_RE.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/** 박스인가 — 카테고리(subtype)가 원천, 옛 데이터는 category='box'도 본다 */
const isBoxSub = (sub?: { subtype?: string; category?: string }): boolean =>
  sub?.subtype === '박스' || sub?.category === 'box';

/** 칩 배경·글자·테두리 (Tailwind) */
export function subChipClass(sub: { subtype?: string; category?: string; name?: string } | undefined): string {
  if (isBoxSub(sub)) return CHIP_NEUTRAL;          // 박스는 회색 통일
  const c = colorOfName(sub?.name);
  return c ? COLOR[c] : CHIP_NEUTRAL;
}
