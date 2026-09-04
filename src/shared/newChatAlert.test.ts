import { describe, it, expect } from 'vitest';
import { pickNewChats, chatMessage } from './newChatAlert';

const 나 = 'e1';
const room = (over: Partial<Parameters<typeof chatMessage>[0]> = {}) => ({
  id: 'r1', name: '이은경', participantIds: [나, 'e2'],
  lastMessage: '확인 부탁', lastUpdatedAt: '2026-09-03T10:00:00.000Z',
  ...over,
} as any);

describe('pickNewChats', () => {
  it('첫 목록은 안 울린다 — 켤 때 안 읽은 방이 우르르 울리면 안 된다', () => {
    const seen = new Map<string, string>();
    expect(pickNewChats([room()], seen, { userId: 나 })).toEqual([]);
    expect(seen.get('r1')).toBe('2026-09-03T10:00:00.000Z');
  });

  it('시각이 앞으로 가면 울린다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const got = pickNewChats([room({ lastUpdatedAt: '2026-09-03T10:05:00.000Z' })], seen, { userId: 나 });
    expect(got.map(r => r.id)).toEqual(['r1']);
  });

  it('같은 메시지를 두 번 울리지 않는다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const r = [room({ lastUpdatedAt: '2026-09-03T10:05:00.000Z' })];
    expect(pickNewChats(r, seen, { userId: 나 })).toHaveLength(1);
    expect(pickNewChats(r, seen, { userId: 나 })).toEqual([]);
  });

  it('내가 이미 읽은 건 안 울린다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const got = pickNewChats([room({
      lastUpdatedAt: '2026-09-03T10:05:00.000Z',
      lastReadBy: { [나]: '2026-09-03T10:06:00.000Z' },
    })], seen, { userId: 나 });
    expect(got).toEqual([]);
  });

  it('내 방이 아니면 안 울린다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const got = pickNewChats([room({ participantIds: ['e2', 'e3'], lastUpdatedAt: '2026-09-03T10:05:00.000Z' })],
      seen, { userId: 나 });
    expect(got).toEqual([]);
  });

  it('보고 있는 방은 안 울린다 — 눈앞에 있는 걸 알릴 필요가 없다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const got = pickNewChats([room({ lastUpdatedAt: '2026-09-03T10:05:00.000Z' })],
      seen, { userId: 나, openRoomId: 'r1', focused: true });
    expect(got).toEqual([]);
  });

  it('**다른 화면에 있으면 울린다** — 전에는 오피스톡 안에서만 감지했다', () => {
    const seen = new Map([['r1', '2026-09-03T10:00:00.000Z']]);
    const got = pickNewChats([room({ lastUpdatedAt: '2026-09-03T10:05:00.000Z' })],
      seen, { userId: 나, openRoomId: 'r1', focused: false });
    expect(got.map(r => r.id)).toEqual(['r1']);
  });
});

describe('chatMessage', () => {
  it('받은 이름을 그대로 쓴다 — 화면과 알림이 같은 이름이어야 한다', () => {
    expect(chatMessage(room(), '이은경')).toEqual({ title: '💬 이은경', body: '확인 부탁' });
  });
  it('내가 고친 이름이 알림에도 뜬다', () => {
    expect(chatMessage(room(), '택배건').title).toBe('💬 택배건');
  });
  it('이름이 없으면 오피스톡', () => {
    expect(chatMessage(room({ lastMessage: undefined }), '')).toEqual({
      title: '💬 오피스톡', body: '새 메시지가 도착했습니다.',
    });
  });
});
