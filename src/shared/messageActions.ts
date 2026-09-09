import type { ChatMessage, Employee } from './types';

/**
 * **말풍선을 꾹 눌렀을 때 할 수 있는 일** — 카톡처럼 창이 뜬다(2026-09-06 사장님).
 *
 * 무엇을 보여줄지 고르는 규칙과, 고른 뒤 무엇을 쓸지 만드는 셈이 여기 있다.
 * 화면은 그 답을 그리기만 한다.
 */
export type MessageAction = '복사' | '답장' | '공유' | '나에게' | '공지 등록' | '공지 내리기' | '삭제';

export interface ActionCtx {
  msg: Pick<ChatMessage, 'senderId' | 'text' | 'deletedAt'>;
  me: Pick<Employee, 'id'>;
  /** 관리자는 남의 말도 지울 수 있다 */
  isAdmin?: boolean;
  /** 이 말이 지금 그 방의 공지인가 — 등록/내리기를 가른다 */
  pinned?: boolean;
}

/**
 * 이 말에 할 수 있는 일들.
 *
 * **지운 말에는 아무것도 못 한다** — 내용이 없으니 복사도 공유도 뜻이 없다.
 * **글이 없는 말**(사진만 보낸 것)은 복사·공유·공지를 뺀다 — 빈 글이 복사되고, 공지 띠도 빈칸이 된다.
 * **삭제는 내 말이거나 관리자일 때만.**
 * **공지는 방에 있는 사람이면 누구나** — 규칙은 [roomNotice](./roomNotice.ts) 머리말 참고.
 */
export function actionsFor(ctx: ActionCtx): MessageAction[] {
  if (ctx.msg.deletedAt) return [];
  const 글있음 = !!ctx.msg.text?.trim();
  const 내말 = ctx.msg.senderId === ctx.me.id;

  const out: MessageAction[] = [];
  if (글있음) out.push('복사');
  out.push('답장');
  if (글있음) out.push('공유', '나에게');
  if (글있음) out.push(ctx.pinned ? '공지 내리기' : '공지 등록');
  if (내말 || ctx.isAdmin) out.push('삭제');
  return out;
}

/** 답장에 담을 조각 — 그때 보인 글을 같이 넣는다(원본이 지워져도 남게) */
export function replySnippet(msg: Pick<ChatMessage, 'id' | 'senderName' | 'text'>, 최대 = 60) {
  const t = (msg.text ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: msg.id,
    senderName: msg.senderName,
    text: t.length > 최대 ? `${t.slice(0, 최대)}…` : t,
  };
}

/**
 * 말을 지울 때 쓸 것. **줄은 남기고 내용만 지운다** —
 * 통째로 없애면 앞뒤 대화가 어긋나고, 답장이 가리키던 자리가 사라진다.
 */
export function deletePatch(byId: string, now = new Date()): Partial<ChatMessage> {
  return { deletedAt: now.toISOString(), deletedBy: byId, text: '', imageUrl: '', fileUrl: '' };
}

/** 지운 말인가 */
export const isDeleted = (m: Pick<ChatMessage, 'deletedAt'>) => !!m.deletedAt;
