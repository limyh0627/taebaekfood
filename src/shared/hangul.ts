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
  const t = (q ?? '').replace(/\s/g, '');
  return t.length > 0 && [...t].every(c => CHO.includes(c));
}

/**
 * 검색어가 대상에 걸리는가.
 *  · 검색어가 초성만이면 초성끼리 비교 ("ㅊㄱㄹ" → "참기름")
 *  · 아니면 일반 부분일치 (대소문자·공백 무시)
 */
export function matchesSearch(target: string, query: string): boolean {
  const q = (query ?? '').replace(/\s/g, '');
  if (!q) return true;
  const t = (target ?? '').replace(/\s/g, '');
  if (isChosungQuery(q)) return toChosung(t).includes(q);
  return t.toLowerCase().includes(q.toLowerCase());
}
