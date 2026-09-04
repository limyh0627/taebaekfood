//  **멘션은 이 파일 하나만 안다** — `@이름`의 모양을 아는 곳이 여러 군데가 되면
//  띄어쓰기 규칙이 갈라져서, 보낸 쪽은 멘션인데 받는 쪽은 알림이 안 오는 일이 생긴다.
//  넣는 길이 둘(@ 타이핑해서 고르기 · 메시지를 꾹 눌러 부르기)이고, 읽는 길이 하나다.

/** 사람이 아니라 자리를 부르는 이름 — 누구든 관리자면 받는다. */
export const MENTION_ADMIN = '관리자';
/** 관리자 멘션이 실려 가는 id. */
export const MENTION_ADMIN_ID = 'admin';

/** 입력칸에 박히는 멘션 한 덩어리. 뒤 공백까지가 한 덩어리다 — 다음 글자와 붙으면 이름이 늘어난다. */
export const mentionToken = (name: string) => `@${name} `;

/**
 * `@` 를 치다 만 자리를 고른 이름으로 바꾼다.
 * @param text  지금 입력칸 내용
 * @param query `@` 뒤에 이미 친 글자 (없으면 빈 문자열)
 */
export function replaceMentionQuery(text: string, query: string, name: string): string {
  const at = text.lastIndexOf('@');
  if (at === -1) return appendMention(text, name);
  return text.slice(0, at) + mentionToken(name) + text.slice(at + 1 + query.length);
}

/** 입력칸 끝에 멘션을 붙인다. 앞말과 안 붙게 띄우고, 같은 멘션이 이미 있으면 그냥 둔다. */
export function appendMention(text: string, name: string): string {
  const token = mentionToken(name);
  if (text.includes(token)) return text;
  if (!text) return token;
  return /\s$/.test(text) ? text + token : text + ' ' + token;
}

/**
 * 보낸 글에서 불린 사람들의 id.
 * 이름이 겹칠 때(`이은` · `이은경`)는 **긴 이름이 이긴다** — `@이은경` 은 이은경 하나다.
 */
export function mentionedIds<T extends { id: string; name: string }>(text: string, people: T[]): string[] {
  const ids = new Set<string>();
  for (const token of text.match(/@[^\s@]+/g) ?? []) {
    const body = token.slice(1);
    if (body.startsWith(MENTION_ADMIN)) { ids.add(MENTION_ADMIN_ID); continue; }
    const hit = people
      .filter(p => p.name && body.startsWith(p.name))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}
