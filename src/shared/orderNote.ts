/**
 * **주문 비고 — 길이와 보이는 모양을 여기서 정한다.**
 *
 * 2026-09-15 사장님: "비고에 바탕이랑 테두리 회색으로 하고 5글자 이후...으로 떠서 줄 안
 * 바뀌게 하고 비고는 50자까지만 입력하게 해 그리고 ㅁ중요 이런식으로 체크박스 만들어서
 * 중요하다고 체크된 비고는 빨간 느낌표 달아".
 *
 * 신규 비고는 50자 제한을 공유한다. 이관된 장문은 원문 길이까지 편집을 허용해 잘리지 않게 한다.
 */

/** 비고에 넣을 수 있는 글자 수. 카드에 한 줄로 얹는 말이라 길면 자리를 먹는다. */
export const NOTE_MAX = 50;

/** 기존 이관 장문의 길이는 보존하고 신규 입력에만 기본 제한을 적용한다. */
export const noteEditLimit = (original?: string): number => Math.max(NOTE_MAX, original?.length ?? 0);
export const clampNote = (text: string, original?: string): string => (text ?? '').slice(0, noteEditLimit(original));

export type LegacyNoteItem = { name: string; note?: string; noteImportant?: boolean; noteBy?: string; noteAt?: string };
type NoteOrder = { note?: string; noteImportant?: boolean; items: LegacyNoteItem[] };
type MigratedNoteOrder<T extends NoteOrder> = Omit<T, 'items' | 'note' | 'noteImportant'> & Pick<NoteOrder, 'note' | 'noteImportant'> & {
  items: Omit<T['items'][number], 'note' | 'noteBy' | 'noteAt' | 'noteImportant'>[];
};

/** 원래 주문 메타는 그대로 두고 품목 문맥을 합친다. 이관에는 입력 길이 제한을 적용하지 않는다. */
export function migrateOrderItemNotes<T extends NoteOrder>(order: T): MigratedNoteOrder<T> {
  const hasLegacy = order.items.some(item => ['note', 'noteBy', 'noteAt', 'noteImportant'].some(key => Object.hasOwn(item, key)));
  if (!hasLegacy) return order as MigratedNoteOrder<T>;
  const legacy = order.items.flatMap(item => item.note?.trim() ? [`${item.name}: ${item.note}`] : []);
  const note = [order.note, ...legacy].filter(value => value !== undefined && value !== '').join('\n');
  const important = !!order.noteImportant || order.items.some(item => !!item.noteImportant);
  const items = order.items.map(item => {
    const { note: _note, noteBy: _by, noteAt: _at, noteImportant: _important, ...rest } = item;
    return rest;
  });
  return { ...order, ...(note ? { note } : {}), ...(important ? { noteImportant: true } : {}), items } as MigratedNoteOrder<T>;
}

/** 활성 화면은 주문 비고 하나만 읽는다. 품목 메모 이관은 별도 스크립트가 담당한다. */
export const orderNotesForDisplay = (order: Pick<NoteOrder, 'note' | 'noteImportant'>): { text: string; important: boolean }[] => {
  const current = order.note?.trim();
  return current ? [{ text: current, important: !!order.noteImportant }] : [];
};
