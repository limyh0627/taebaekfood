import { describe, it, expect } from 'vitest';
import { roomNameFor, renameRoomPatch, isOwner } from './roomName';

const 사람 = [{ id: 'me', name: '임태백' }, { id: 'u2', name: '이은경' }, { id: 'u3', name: '임예진' }];
const 방 = (over = {}) => ({ participantIds: ['me', 'u2'], createdBy: 'u2', ...over });

describe('roomNameFor', () => {
  it('아무 이름도 없으면 상대 이름', () => {
    expect(roomNameFor(방(), 'me', 사람)).toBe('이은경');
  });
  it('여럿이면 늘어놓는다 — 나는 뺀다', () => {
    expect(roomNameFor(방({ participantIds: ['me', 'u2', 'u3'] }), 'me', 사람)).toBe('이은경, 임예진');
  });
  it('나 혼자면 나와의 대화', () => {
    expect(roomNameFor(방({ participantIds: ['me'] }), 'me', 사람)).toBe('나와의 대화');
  });

  it('**방장이 지은 이름이 모두에게 기본**', () => {
    const r = 방({ name: '9월 물류' });
    expect(roomNameFor(r, 'me', 사람)).toBe('9월 물류');
    expect(roomNameFor(r, 'u2', 사람)).toBe('9월 물류');
  });

  it('**내가 고친 건 나한테만**', () => {
    const r = 방({ name: '9월 물류', nameBy: { me: '택배건' } });
    expect(roomNameFor(r, 'me', 사람)).toBe('택배건');
    expect(roomNameFor(r, 'u2', 사람)).toBe('9월 물류');   // 방장은 그대로 본다
    expect(roomNameFor(r, 'u3', 사람)).toBe('9월 물류');
  });

  it('내가 고쳐 뒀으면 방장이 기본을 바꿔도 내 이름이 남는다', () => {
    const r = 방({ name: '10월 물류', nameBy: { me: '택배건' } });
    expect(roomNameFor(r, 'me', 사람)).toBe('택배건');
  });

  it('공백만 넣은 건 이름이 아니다', () => {
    expect(roomNameFor(방({ name: '   ' }), 'me', 사람)).toBe('이은경');
    expect(roomNameFor(방({ name: '9월 물류', nameBy: { me: '  ' } }), 'me', 사람)).toBe('9월 물류');
  });
});

describe('isOwner', () => {
  it('만든 사람이면 방장', () => {
    expect(isOwner(방({ createdBy: 'me' }), 'me')).toBe(true);
    expect(isOwner(방({ createdBy: 'u2' }), 'me')).toBe(false);
  });
  it('만든 사람이 안 적힌 옛 방은 아무나 기본을 고친다', () => {
    expect(isOwner(방({ createdBy: undefined }), 'me')).toBe(true);
  });
});

describe('renameRoomPatch', () => {
  it('방장이 고치면 모두의 기본이 바뀐다', () => {
    expect(renameRoomPatch(방({ createdBy: 'me' }), 'me', '9월 물류')).toEqual({ name: '9월 물류' });
  });
  it('남이 고치면 자기 것만 바뀐다', () => {
    expect(renameRoomPatch(방({ createdBy: 'u2' }), 'me', '택배건')).toEqual({ nameBy: { me: '택배건' } });
  });
  it('남이 고쳐도 남의 이름은 안 건드린다', () => {
    const r = 방({ createdBy: 'u2', nameBy: { u3: '딴이름' } });
    expect(renameRoomPatch(r, 'me', '택배건')).toEqual({ nameBy: { u3: '딴이름', me: '택배건' } });
  });
  it('빈 이름은 지우기 — 방장이 지은 이름으로 돌아간다', () => {
    const r = 방({ createdBy: 'u2', name: '9월 물류', nameBy: { me: '택배건' } });
    expect(renameRoomPatch(r, 'me', '')).toEqual({ nameBy: {} });
    expect(roomNameFor({ ...r, ...renameRoomPatch(r, 'me', '') }, 'me', 사람)).toBe('9월 물류');
  });
  it('앞뒤 공백은 떼고 저장한다', () => {
    expect(renameRoomPatch(방({ createdBy: 'me' }), 'me', '  9월 물류  ')).toEqual({ name: '9월 물류' });
  });
});
