/**
 * 한글 검색 유틸 — 초성 검색 지원. 부수효과 없음.
 *   "ㅊㄱㄹ" → "참기름" 매칭, "참기" → "참기름" 매칭(일반 부분일치도 그대로).
 */

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/**
 * 겹자음을 낱자로 편다 — `ㄳ` → `ㄱㅅ`, `ㅄ` → `ㅂㅅ`.
 *
 * 한글 자판에서 자음을 잇달아 치면 IME가 붙여 버린다(ㄱ·ㅅ → ㄳ). 초성은 19자뿐이라
 * 겹자음은 초성으로 절대 안 나오고, 그대로 견주면 '값·삯' 같은 걸 초성으로 못 찾는다.
 */
const COMPOUND: Record<string, string> = {
  'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ',
  'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ', 'ㄼ': 'ㄹㅂ', 'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ',
  'ㅄ': 'ㅂㅅ',
};
export function splitCompoundJamo(s: string): string {
  return [...(s ?? '')].map(c => COMPOUND[c] ?? c).join('');
}

/** 문자열의 초성만 뽑는다. 한글이 아니면 그대로 둔다(영문·숫자 검색 유지). */
export function toChosung(s: string): string {
  let out = '';
  for (const ch of s ?? '') {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_START && code <= HANGUL_END) {
      out += CHO[Math.floor((code - HANGUL_START) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 검색어가 전부 초성(ㄱ~ㅎ)인가 — 그럴 때만 초성 매칭을 쓴다 */
export function isChosungQuery(q: string): boolean {
  const t = splitCompoundJamo((q ?? '').replace(/\s/g, ''));
  return t.length > 0 && [...t].every(c => CHO.includes(c));
}

/**
 * 검색어가 대상에 걸리는가.
 *  · 검색어가 초성만이면 초성끼리 비교 ("ㅊㄱㄹ" → "참기름")
 *  · 아니면 일반 부분일치 (대소문자·공백 무시)
 */
export function matchesSearch(target: string, query: string): boolean {
  const raw = (query ?? '').replace(/\s/g, '');
  if (!raw) return true;
  const t = (target ?? '').replace(/\s/g, '');
  //  겹자음은 편 뒤에 견준다 — 자판이 ㄱㅅ을 ㄳ으로 붙여 보내기 때문.
  if (isChosungQuery(raw)) return toChosung(t).includes(splitCompoundJamo(raw));
  return t.toLowerCase().includes(raw.toLowerCase());
}
