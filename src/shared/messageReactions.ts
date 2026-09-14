import type { ChatMessage } from './types';

/**
 * **말풍선에 이모티콘 남기기**(2026-09-14 사장님: "모바일에서 꾹 눌렀을때 이모티콘 남길 수
 * 있는 기능").
 *
 * 꾹 누르면 뜨는 창(`messageActions`)에 이모지 줄을 얹는다 — 같은 창이라 새 손짓을 안 배워도 된다.
 *
 * 담는 모양은 **이모지 → 누른 사람들**이다. 반대로 하면(사람 → 이모지) 개수를 셀 때마다
 * 전부 훑어야 하고, 화면은 늘 "👍 3" 처럼 개수를 먼저 보여 준다.
 *
 * **한 사람이 여러 이모지를 남길 수 있다**(카톡은 하나지만 슬랙은 여럿이다). 여럿을 막을 이유가
 * 없다 — 같은 이모지를 다시 누르면 뗀다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 고르는 이모지 — 줄 하나에 들어가야 해서 여섯이다. */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏'] as const;

export type Reactions = NonNullable<ChatMessage['reactions']>;

/**
 * 그 사람이 그 이모지를 눌렀다 → 넣거나 뺀다.
 *
 * **빈 줄은 아예 지운다** — 아무도 안 남은 이모지가 칸에 남아 있으면 화면이 그걸 0개로 그리거나
 * 빈 칩을 띄운다. 지우는 쪽이 읽기도 쉽다.
 */
export function toggleReaction(reactions: Reactions | undefined, emoji: string, userId: string): Reactions {
  const 지금 = { ...(reactions ?? {}) };
  const 누른사람 = 지금[emoji] ?? [];
  const 뗀다 = 누른사람.includes(userId);
  const 다음 = 뗀다 ? 누른사람.filter(id => id !== userId) : [...누른사람, userId];
  if (다음.length === 0) delete 지금[emoji];
  else 지금[emoji] = 다음;
  return 지금;
}

/** 화면에 그릴 줄 — 많이 눌린 것부터, 같으면 고른 차례대로. */
export function reactionChips(reactions: Reactions | undefined, meId: string): {
  emoji: string; count: number; mine: boolean;
}[] {
  const 순서 = (e: string) => {
    const i = (REACTION_EMOJIS as readonly string[]).indexOf(e);
    return i === -1 ? REACTION_EMOJIS.length : i;
  };
  return Object.entries(reactions ?? {})
    .filter(([, ids]) => ids.length > 0)
    .map(([emoji, ids]) => ({ emoji, count: ids.length, mine: ids.includes(meId) }))
    .sort((a, b) => b.count - a.count || 순서(a.emoji) - 순서(b.emoji));
}

/**
 * **누가 눌렀는지 사람 이름으로** — 칩에 마우스를 올리면 뜬다.
 * 이름을 못 찾으면 그 사람은 건너뛴다(나간 직원).
 */
export function reactionTitle(
  reactions: Reactions | undefined, emoji: string, 이름찾기: (id: string) => string | undefined,
): string {
  return (reactions?.[emoji] ?? []).map(이름찾기).filter(Boolean).join(', ');
}
