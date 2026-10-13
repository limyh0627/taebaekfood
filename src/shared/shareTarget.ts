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
let 보존값: string | null = null;
let 메모리전용 = false;

/**
 * 주소창의 공유 글을 세션에 보존한 뒤 공유 query만 정리한다.
 * 보존하지 못하면 주소를 남겨 새로고침 때 원문을 잃지 않는다.
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
  보존값 = text;
  메모리전용 = true;
  try {
    sessionStorage.setItem(SHARE_KEY, text);
    if (sessionStorage.getItem(SHARE_KEY) !== text) return text;
    메모리전용 = false;
    const query = new URLSearchParams(loc.search);
    for (const name of ['title', 'text', 'url']) query.delete(name);
    const search = query.toString();
    hist.replaceState(null, '', loc.pathname + (search ? '?' + search : '') + (loc.hash ?? ''));
  } catch { /* 보존 실패 때 주소를 남겨 새로고침으로 원문을 잃지 않는다. */ }
  return text;
}

/** 테스트에서만 쓴다 — 한 판이 끝나면 다음 판이 새로 읽게 한다. */
export function resetShareRead(): void { 읽은값 = null; 보존값 = null; 메모리전용 = false; }

/** 기존 호출부 호환 이름. 연결·ACK 전에 원문을 없애지 않는다. */
export function consumeSharedText(): string {
  return peekSharedText();
}

/** 로그인 전 유입은 아직 누구의 요청도 아니다. 읽는 것만으로 없애지 않는다. */
export function peekSharedText(): string {
  if (메모리전용) return 보존값 ?? '';
  try {
    return sessionStorage.getItem(SHARE_KEY) ?? 보존값 ?? '';
  } catch { return 보존값 ?? ''; }
}

/** 현재 로그인에 명시 연결해 원문을 보존한 뒤 그 원문만 비운다. */
export function clearSharedText(expected: string): void {
  if (peekSharedText() !== expected) throw Error('공유 글이 변경되어 지우지 않았습니다.');
  try { if (!메모리전용) sessionStorage.removeItem(SHARE_KEY); } catch {
    // 저장소에 접근할 수 없던 유입은 메모리에만 존재한다.
    if (보존값 !== expected) throw Error('공유 글 보존 상태를 확인하지 못했습니다.');
  }
  보존값 = null;
  메모리전용 = false;
  읽은값 = null;
}
