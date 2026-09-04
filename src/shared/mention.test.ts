import { describe, it, expect } from 'vitest';
import { appendMention, replaceMentionQuery, mentionedIds, mentionToken } from './mention';

const 사람 = [
  { id: 'e1', name: '이은경' },
  { id: 'e2', name: '이은' },
  { id: 'e3', name: '임예진' },
];

describe('mentionToken', () => {
  it('뒤에 공백을 달고 나온다 — 다음 글자와 붙으면 이름이 늘어난다', () => {
    expect(mentionToken('이은경')).toBe('@이은경 ');
  });
});

describe('appendMention — 메시지를 꾹 눌러 부를 때', () => {
  it('빈 칸이면 멘션만 남는다', () => {
    expect(appendMention('', '이은경')).toBe('@이은경 ');
  });
  it('앞말과 붙지 않게 띄운다', () => {
    expect(appendMention('네', '이은경')).toBe('네 @이은경 ');
  });
  it('이미 띄어져 있으면 더 띄우지 않는다', () => {
    expect(appendMention('네 ', '이은경')).toBe('네 @이은경 ');
  });
  it('같은 사람을 두 번 부르지 않는다', () => {
    expect(appendMention('@이은경 네', '이은경')).toBe('@이은경 네');
  });
});

describe('replaceMentionQuery — @ 치다가 고를 때', () => {
  it('치다 만 글자를 고른 이름으로 갈아낀다', () => {
    expect(replaceMentionQuery('네 @이은', '이은', '이은경')).toBe('네 @이은경 ');
  });
  it('@ 만 치고 골라도 된다', () => {
    expect(replaceMentionQuery('네 @', '', '이은경')).toBe('네 @이은경 ');
  });
  it('뒤에 남은 글은 지키다', () => {
    expect(replaceMentionQuery('@이은 확인', '이은 확인', '이은경')).toBe('@이은경 ');
  });
  it('@ 가 없으면 끝에 붙인다', () => {
    expect(replaceMentionQuery('네', '', '이은경')).toBe('네 @이은경 ');
  });
});

describe('mentionedIds — 누가 불렸나', () => {
  it('부른 사람만 센다', () => {
    expect(mentionedIds('@이은경 확인 부탁', 사람)).toEqual(['e1']);
  });
  it('긴 이름이 이긴다 — @이은경은 이은이 아니다', () => {
    expect(mentionedIds('@이은경 ', 사람)).toEqual(['e1']);
    expect(mentionedIds('@이은 ', 사람)).toEqual(['e2']);
  });
  it('여럿을 불러도 다 센다', () => {
    expect(mentionedIds('@이은경 @임예진 회의', 사람).sort()).toEqual(['e1', 'e3']);
  });
  it('같은 사람을 두 번 불러도 한 번만 센다', () => {
    expect(mentionedIds('@이은경 @이은경', 사람)).toEqual(['e1']);
  });
  it('@관리자는 자리라서 admin 으로 간다', () => {
    expect(mentionedIds('@관리자 결재 부탁', 사람)).toEqual(['admin']);
  });
  it('아무도 안 불렀으면 빈 목록', () => {
    expect(mentionedIds('오늘 몇시에 오세요?', 사람)).toEqual([]);
    expect(mentionedIds('', 사람)).toEqual([]);
  });
  it('이메일처럼 생긴 건 사람이 아니다', () => {
    expect(mentionedIds('a@b.com 으로 보내주세요', 사람)).toEqual([]);
  });
});
