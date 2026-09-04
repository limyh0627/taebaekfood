//  **바깥에서 넘어온 글을 받는 문**(2026-09-03 사장님).
//  안드로이드 공유 시트에서 카톡·문자 내용을 이 앱으로 넘기면, 매니페스트의
//  share_target 규칙대로 `/?title=..&text=..&url=..` 로 앱이 열린다.
//  주소의 모양을 아는 곳은 여기 하나다 — 매니페스트를 고칠 때 같이 고칠 자리다.
//  (아이폰은 사파리가 이 기능을 안 받아서 안 뜬다. 붙여넣기가 유일한 길이다.)

/** 넘어온 글을 잠깐 두는 자리. 대화방을 고를 때까지 들고 있어야 한다. */
export const SHARE_KEY = 'tb_shared_text';

/**
 * 제목·본문·주소가 따로 온다. 한 덩어리로 붙인다.
 * 카톡은 본문 안에 주소를 이미 넣어 보내기도 해서, **같은 글이 두 번 붙는 걸 막는다.**
 */
export function joinSharedText(p: { title?: string | null; text?: string | null; url?: string | null }): string {
  const parts = [p.title, p.text, p.url].map(v => (v ?? '').trim()).filter(Boolean);
  const out: string[] = [];
  for (const v of parts) if (!out.some(o => o.includes(v))) out.push(v);
  return out.join('\n');
}

export function sharedTextFromSearch(search: string): string {
  const q = new URLSearchParams(search);
  return joinSharedText({ title: q.get('title'), text: q.get('text'), url: q.get('url') });
}

/** 한 페이지에서 주소를 읽는 건 한 번뿐이다 — 읽고 나면 주소가 비므로 두 번째는 답이 달라진다. */
let 읽은값: string | null = null;

/**
 * 주소창에서 공유 글을 꺼내 세션에 옮기고 **주소를 지운다**.
 * 안 지우면 새로고침할 때마다 같은 글이 또 뜬다.
 *
 * 여러 번 불러도 같은 답을 준다 — React StrictMode 는 useState 초기화 함수를 두 번 부르는데,
 * 두 번째에 빈 값이 나오면 공유로 들어왔는데도 엉뚱한 화면이 열린다.
 * @returns 받은 글 (없으면 빈 문자열)
 */
export function takeShareFromUrl(loc: Location = window.location, hist: History = window.history): string {
  if (읽은값 !== null) return 읽은값;
  const text = sharedTextFromSearch(loc.search);
  읽은값 = text;
  if (!text) return '';
  try { sessionStorage.setItem(SHARE_KEY, text); } catch { /* 사생활 모드면 못 쓴다 — 그냥 넘긴다 */ }
  try { hist.replaceState(null, '', loc.pathname); } catch { /* 무시 */ }
  return text;
}

/** 테스트에서만 쓴다 — 한 판이 끝나면 다음 판이 새로 읽게 한다. */
export function resetShareRead(): void { 읽은값 = null; }

/** 한 번만 꺼낸다 — 꺼내면 자리를 비운다. */
export function consumeSharedText(): string {
  try {
    const v = sessionStorage.getItem(SHARE_KEY) ?? '';
    if (v) sessionStorage.removeItem(SHARE_KEY);
    return v;
  } catch { return ''; }
}
