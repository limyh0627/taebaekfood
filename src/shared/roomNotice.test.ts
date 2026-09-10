import { describe, it, expect } from 'vitest';
import { canPin, pinPatch, unpinPatch, noticeOf, noticeLine, isPinned, NOTICE_MAX } from './roomNotice';
import type { ChatRoom, RoomNotice } from './types';

const 나 = { id: 'u1', name: '임영훈' };
const 때 = new Date(2026, 8, 9, 11, 30);

describe('공지로 붙일 수 있나', () => {
  it('글이 있으면 붙일 수 있다', () => {
    expect(canPin({ text: '내일 8시 출근입니다' })).toBe(true);
  });

  it('사진만 보낸 말은 못 붙인다 — 띠에 그릴 게 없다', () => {
    expect(canPin({ text: '' })).toBe(false);
    expect(canPin({ text: '   ' })).toBe(false);
  });

  it('지운 말은 못 붙인다', () => {
    expect(canPin({ text: '내일 8시', deletedAt: '2026-09-09T00:00:00Z' })).toBe(false);
  });
});

describe('붙이기 · 내리기', () => {
  it('글을 통째로 담는다 — 그 말을 지워도 공지는 남아야 한다', () => {
    const p = pinPatch({ id: 'MSG-1', text: '내일 8시 출근입니다' }, 나, 때);
    expect(p.notice).toEqual({
      messageId: 'MSG-1', text: '내일 8시 출근입니다',
      by: 'u1', byName: '임영훈', at: 때.toISOString(),
    });
  });

  it('앞뒤 공백은 떼고 담는다', () => {
    expect(pinPatch({ id: 'M', text: '  마감 3시  ' }, 나, 때).notice!.text).toBe('마감 3시');
  });

  it(`글이 아주 길면 ${NOTICE_MAX}자에서 자른다 — 띠가 대화를 가리면 안 된다`, () => {
    const 긴글 = 'ㄱ'.repeat(NOTICE_MAX + 50);
    const t = pinPatch({ id: 'M', text: 긴글 }, 나, 때).notice!.text;
    expect(t).toHaveLength(NOTICE_MAX + 1);      // 자른 글 + '…'
    expect(t.endsWith('…')).toBe(true);
  });

  it('내리면 null 이다 — 칸을 지우지 않는다', () => {
    expect(unpinPatch()).toEqual({ notice: null });
    //  undefined 로 두면 Firestore 가 '안 바꿈'으로 읽어 공지가 안 내려간다
    expect('notice' in unpinPatch()).toBe(true);
    expect(unpinPatch().notice).not.toBeUndefined();
  });
});

describe('읽기', () => {
  const 공지: RoomNotice = { messageId: 'M1', text: '내일 8시', by: 'u1', byName: '임영훈', at: '' };
  const 방 = (n?: RoomNotice | null) => ({ notice: n } as Pick<ChatRoom, 'notice'>);

  it('옛 방은 칸이 없다 — null 로 돌려준다', () => {
    expect(noticeOf(방(undefined))).toBeNull();
    expect(noticeOf(undefined)).toBeNull();
    expect(noticeOf(방(null))).toBeNull();
  });

  it('붙은 공지를 그대로 돌려준다', () => {
    expect(noticeOf(방(공지))).toBe(공지);
  });

  it('이 말이 지금 공지인가', () => {
    expect(isPinned(방(공지), { id: 'M1' })).toBe(true);
    expect(isPinned(방(공지), { id: 'M2' })).toBe(false);
    expect(isPinned(방(null), { id: 'M1' })).toBe(false);
    expect(isPinned(undefined, { id: 'M1' })).toBe(false);
  });
});

describe('접었을 때 한 줄', () => {
  const 공지 = (text: string): RoomNotice => ({ messageId: 'M', text, by: '', byName: '', at: '' });

  it('줄바꿈을 눕힌다 — 띠가 세 겹이 되면 대화가 밀린다', () => {
    expect(noticeLine(공지('첫 줄\n둘째 줄\n\n셋째'))).toBe('첫 줄 둘째 줄 셋째');
  });

  it('길면 자른다', () => {
    expect(noticeLine(공지('가'.repeat(80)), 10)).toBe(`${'가'.repeat(10)}…`);
  });

  it('짧으면 그대로 — 괜히 말줄임표를 안 붙인다', () => {
    expect(noticeLine(공지('마감 3시'), 10)).toBe('마감 3시');
  });

  it('공지가 없으면 빈 글', () => {
    expect(noticeLine(null)).toBe('');
  });
});
