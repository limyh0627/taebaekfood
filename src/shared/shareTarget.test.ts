/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { joinSharedText, sharedTextFromSearch, takeShareFromUrl, consumeSharedText, peekSharedText, clearSharedText, resetShareRead, SHARE_KEY } from './shareTarget';
afterEach(() => vi.restoreAllMocks());

describe('joinSharedText', () => {
  it('본문만 오면 본문만', () => {
    expect(joinSharedText({ text: '내일 10시에 봅시다' })).toBe('내일 10시에 봅시다');
  });
  it('제목·본문·주소를 줄바꿈으로 잇는다', () => {
    expect(joinSharedText({ title: '공지', text: '내일 휴무', url: 'https://a.b' }))
      .toBe('공지\n내일 휴무\nhttps://a.b');
  });
  it('본문에 이미 주소가 들어 있으면 두 번 붙이지 않는다 — 카톡이 그렇게 보낸다', () => {
    expect(joinSharedText({ text: '여기 봐 https://a.b', url: 'https://a.b' }))
      .toBe('여기 봐 https://a.b');
  });
  it('빈 칸·공백만 있는 건 버린다', () => {
    expect(joinSharedText({ title: '  ', text: '내용', url: null })).toBe('내용');
    expect(joinSharedText({})).toBe('');
  });
});

describe('sharedTextFromSearch', () => {
  it('주소에서 꺼낸다', () => {
    expect(sharedTextFromSearch('?text=%EC%95%88%EB%85%95')).toBe('안녕');
  });
  it('공유가 아니면 빈 문자열 — 평소 접속에 반응하면 안 된다', () => {
    expect(sharedTextFromSearch('')).toBe('');
    expect(sharedTextFromSearch('?view=orders')).toBe('');
  });
});

describe('takeShareFromUrl · consumeSharedText', () => {
  beforeEach(() => { resetShareRead(); sessionStorage.clear(); });

  it('세션에 옮기고 주소를 지운다', () => {
    let replaced: string | null | undefined;
    const loc = { search: '?text=%ED%9A%8C%EC%9D%98', pathname: '/' } as Location;
    const hist = { replaceState: (_s: any, _t: string, u?: string | URL | null) => { replaced = u as string; } } as History;

    expect(takeShareFromUrl(loc, hist)).toBe('회의');
    expect(replaced).toBe('/');
    expect(sessionStorage.getItem(SHARE_KEY)).toBe('회의');
  });

  it('공유가 아니면 아무것도 안 건드린다', () => {
    let touched = false;
    const loc = { search: '', pathname: '/' } as Location;
    const hist = { replaceState: () => { touched = true; } } as unknown as History;

    expect(takeShareFromUrl(loc, hist)).toBe('');
    expect(touched).toBe(false);
    expect(sessionStorage.getItem(SHARE_KEY)).toBe(null);
  });

  it('두 번 불러도 같은 답 — StrictMode 가 초기화 함수를 두 번 부른다', () => {
    const loc = { search: '?text=%ED%9A%8C%EC%9D%98', pathname: '/' } as Location;
    const hist = { replaceState: () => {} } as unknown as History;
    expect(takeShareFromUrl(loc, hist)).toBe('회의');
    expect(takeShareFromUrl({ search: '', pathname: '/' } as Location, hist)).toBe('회의');
  });

  it('읽기만으로 비우지 않고 연결 후 정확 원문만 비운다', () => {
    sessionStorage.setItem(SHARE_KEY, '회의');
    expect(consumeSharedText()).toBe('회의');
    expect(consumeSharedText()).toBe('회의');
    expect(() => clearSharedText('다른 글')).toThrow('변경');
    clearSharedText('회의');
    expect(consumeSharedText()).toBe('');
  });
  it('저장소 쓰기 실패 때 주소는 보존하고 메모리로 원문을 전달한다', () => {
    const replaceState = vi.fn();
    sessionStorage.setItem(SHARE_KEY, '이전 유입');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('차단'); });
    expect(takeShareFromUrl({ search:'?text=원문',pathname:'/' } as Location,{ replaceState } as unknown as History)).toBe('원문');
    expect(replaceState).not.toHaveBeenCalled();
    expect(peekSharedText()).toBe('원문');
    clearSharedText('원문');expect(sessionStorage.getItem(SHARE_KEY)).toBe('이전 유입');
  });
  it('공유 query만 정리하고 기존 검색·해시는 유지한다', () => {
    const replaceState = vi.fn();
    takeShareFromUrl({ search:'?view=talk&text=원문',pathname:'/',hash:'#room' } as Location,{ replaceState } as unknown as History);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?view=talk#room');
  });
});
