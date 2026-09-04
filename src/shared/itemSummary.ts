//  **품목 여럿을 한 줄로 줄이는 셈.**
//  전표 목록 카드가 좁아 이름을 다 못 싣는다. 전에는 앞 두 개를 쉼표로 잇고 잘라서
//  `참기름/병/분/전통/350ml, 참기름/병/특/알찬...` 처럼 **두 번째가 말없이 잘렸다**
//  (2026-09-03 사장님). 잘린 글자보다 "외 몇 개"가 낫다.
//  같은 요약을 세 군데서 따로 짜고 있었다 — 여기 하나로 모은다.

export interface NamedItem { name?: string }

/**
 * `참기름/병/분/전통/350ml 외 1개`
 * @param head 앞에 그대로 보여줄 개수. 기본 1개 — 좁은 카드용이다.
 */
export function itemSummary(items: readonly NamedItem[] | undefined, head = 1): string {
  const 이름 = (items ?? []).map(i => String(i?.name ?? '').trim()).filter(Boolean);
  if (이름.length === 0) return '';
  const 앞 = 이름.slice(0, head).join(', ');
  const 나머지 = 이름.length - head;
  return 나머지 > 0 ? `${앞} 외 ${나머지}개` : 앞;
}
