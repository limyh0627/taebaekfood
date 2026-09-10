import type { ChatMessage, ChatRoom, RoomNotice } from './types';

/**
 * **방 위에 붙이는 공지** — 카톡과 같다(2026-09-09 사장님: "오피스톡에 공지사항 올릴 수 있는 기능").
 *
 * 관리자 메뉴에 [공지사항 게시판](../../components/NoticeBoard.tsx)이 따로 있지만 그건 **사내 게시판**이다.
 * 여기 공지는 **그 방 사람들에게, 그 대화 안에서** 붙여 두는 것이다 — 성격이 다르니 두 벌이 아니다.
 *
 * ---
 * **글을 통째로 담는다.** 말 id 만 들고 있으면 그 말을 지웠을 때 공지가 빈칸이 된다.
 * 답장(`replyTo`)이 그때 보인 글을 같이 담는 것과 같은 규칙이다.
 *
 * **누가 붙이나 — 방에 있는 사람이면 누구나.** 카톡이 그렇고, 공지는 "지금 다 같이 봐야 할 것"이라
 * 방장을 기다릴 일이 아니다(출고 담당이 "오늘 마감 3시"를 붙이는 게 제일 잦은 쓰임이다).
 * 방마다 하나뿐이라 새로 붙이면 앞의 것이 물러난다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 공지에 담을 글 길이. 넘으면 잘라서 담는다 — 띠가 화면을 다 먹으면 대화를 가린다. */
export const NOTICE_MAX = 200;

/** 사진만 보낸 말처럼 글이 없는 것은 공지가 될 수 없다 — 띠에 아무것도 못 그린다. */
export const canPin = (msg: Pick<ChatMessage, 'text' | 'deletedAt'>): boolean =>
  !msg.deletedAt && !!msg.text?.trim();

/** 이 말을 공지로 붙일 때 방에 쓸 것 */
export function pinPatch(
  msg: Pick<ChatMessage, 'id' | 'text'>,
  by: Pick<{ id: string; name: string }, 'id' | 'name'>,
  now = new Date(),
): Partial<ChatRoom> {
  const t = String(msg.text ?? '').trim();
  return {
    notice: {
      messageId: msg.id,
      text: t.length > NOTICE_MAX ? `${t.slice(0, NOTICE_MAX)}…` : t,
      by: by.id,
      byName: by.name,
      at: now.toISOString(),
    },
  };
}

/** 공지를 내릴 때 — 칸을 지우지 않고 null 로 둔다 */
export const unpinPatch = (): Partial<ChatRoom> => ({ notice: null });

/** 이 방에 붙은 공지. 없으면 null — 옛 방은 칸 자체가 없다. */
export const noticeOf = (room: Pick<ChatRoom, 'notice'> | undefined): RoomNotice | null =>
  room?.notice ?? null;

/**
 * 접어 놓았을 때 띠에 보일 한 줄.
 * 줄바꿈은 공백으로 눕힌다 — 여러 줄 공지가 띠를 세 겹으로 만들면 대화가 밀린다.
 */
export function noticeLine(notice: RoomNotice | null, 최대 = 40): string {
  const t = String(notice?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > 최대 ? `${t.slice(0, 최대)}…` : t;
}

/** 이 말이 지금 그 방의 공지인가 — 말풍선에 표시를 달고, '공지' 를 '공지 내리기' 로 바꾼다 */
export const isPinned = (
  room: Pick<ChatRoom, 'notice'> | undefined,
  msg: Pick<ChatMessage, 'id'>,
): boolean => !!room?.notice && room.notice.messageId === msg.id;
