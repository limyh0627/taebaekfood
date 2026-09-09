import { describe, it, expect } from 'vitest';
import { actionsFor, replySnippet, deletePatch, isDeleted } from './messageActions';

const 나 = { id: 'me' };
const 말 = (o: any = {}) => ({ senderId: 'u2', text: '안녕하세요', ...o });

describe('actionsFor — 무엇을 할 수 있나', () => {
  it('남의 말: 복사·답장·공유·나에게·공지 (삭제는 없다)', () => {
    expect(actionsFor({ msg: 말(), me: 나 })).toEqual(['복사', '답장', '공유', '나에게', '공지 등록']);
  });

  it('내 말: 삭제까지', () => {
    expect(actionsFor({ msg: 말({ senderId: 'me' }), me: 나 }))
      .toEqual(['복사', '답장', '공유', '나에게', '공지 등록', '삭제']);
  });

  it('이미 공지면 내리기로 바뀐다 — 같은 자리에서 켜고 끈다', () => {
    const a = actionsFor({ msg: 말(), me: 나, pinned: true });
    expect(a).toContain('공지 내리기');
    expect(a).not.toContain('공지 등록');
  });

  it('공지는 남의 말에도 걸 수 있다 — 방에 있는 사람이면 누구나', () => {
    expect(actionsFor({ msg: 말({ senderId: '남' }), me: 나 })).toContain('공지 등록');
  });

  it('관리자는 남의 말도 지울 수 있다', () => {
    expect(actionsFor({ msg: 말(), me: 나, isAdmin: true })).toContain('삭제');
  });

  it('**글이 없으면**(사진만 보낸 것) 복사·공유·나에게를 뺀다 — 빈 글이 복사된다', () => {
    expect(actionsFor({ msg: 말({ text: '' }), me: 나 })).toEqual(['답장']);
    expect(actionsFor({ msg: 말({ text: '   ' }), me: 나 })).toEqual(['답장']);
  });

  it('**지운 말에는 아무것도 못 한다**', () => {
    expect(actionsFor({ msg: 말({ deletedAt: '2026-09-06T00:00:00Z' }), me: 나 })).toEqual([]);
    expect(actionsFor({ msg: 말({ senderId: 'me', deletedAt: '2026-09-06T00:00:00Z' }), me: 나, isAdmin: true })).toEqual([]);
  });
});

describe('replySnippet — 답장에 담을 조각', () => {
  it('보낸 사람과 글을 담는다', () => {
    expect(replySnippet({ id: 'm1', senderName: '이은경', text: '내일 봅시다' }))
      .toEqual({ id: 'm1', senderName: '이은경', text: '내일 봅시다' });
  });

  it('긴 글은 줄인다 — 답장 머리가 화면을 다 먹으면 안 된다', () => {
    const r = replySnippet({ id: 'm1', senderName: 'A', text: '가'.repeat(200) });
    expect(r.text.length).toBeLessThanOrEqual(61);
    expect(r.text.endsWith('…')).toBe(true);
  });

  it('줄바꿈은 한 칸으로 편다 — 답장 머리는 한 줄이다', () => {
    expect(replySnippet({ id: 'm1', senderName: 'A', text: '가\n\n나  다' }).text).toBe('가 나 다');
  });

  it('글이 없어도 터지지 않는다', () => {
    expect(replySnippet({ id: 'm1', senderName: 'A', text: '' }).text).toBe('');
  });
});

describe('deletePatch — 줄은 남기고 내용만 지운다', () => {
  const 때 = new Date('2026-09-06T10:00:00+09:00');

  it('지운 자국을 남기고 내용을 비운다', () => {
    expect(deletePatch('me', 때)).toEqual({
      deletedAt: 때.toISOString(), deletedBy: 'me', text: '', imageUrl: '', fileUrl: '',
    });
  });

  it('**줄 자체는 안 없앤다** — 없애면 앞뒤 대화가 어긋나고 답장이 가리키던 자리가 사라진다', () => {
    const p = deletePatch('me', 때);
    expect(p).not.toHaveProperty('id');
    expect(Object.keys(p)).toContain('deletedAt');
  });

  it('사진·파일도 같이 지운다 — 글만 지우면 사진이 남는다', () => {
    const p = deletePatch('me', 때);
    expect(p.imageUrl).toBe('');
    expect(p.fileUrl).toBe('');
  });
});

describe('isDeleted', () => {
  it('자국이 있으면 지운 말', () => {
    expect(isDeleted({ deletedAt: '2026-09-06T00:00:00Z' })).toBe(true);
    expect(isDeleted({})).toBe(false);
  });
});
