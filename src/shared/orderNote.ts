/**
 * **주문 비고 — 길이와 보이는 모양을 여기서 정한다.**
 *
 * 2026-09-15 사장님: "비고에 바탕이랑 테두리 회색으로 하고 5글자 이후...으로 떠서 줄 안
 * 바뀌게 하고 비고는 50자까지만 입력하게 해 그리고 ㅁ중요 이런식으로 체크박스 만들어서
 * 중요하다고 체크된 비고는 빨간 느낌표 달아".
 *
 * 카드·리스트·메모창이 **같은 수를 봐야** 한다. 한 곳에서 50자로 막고 다른 곳에서 500자를
 * 세면, 다 적었는데 저장이 잘리거나 셈만 틀린다.
 */

/** 비고에 넣을 수 있는 글자 수. 카드에 한 줄로 얹는 말이라 길면 자리를 먹는다. */
export const NOTE_MAX = 50;

/** 카드 딱지에 보일 글자 수 — 넘으면 `…` 로 줄인다. */
export const NOTE_CHIP_CHARS = 5;

/** 50자까지만 남긴다 — 붙여넣기로 긴 글이 들어오는 길도 여기서 막힌다. */
export const clampNote = (text: string): string => (text ?? '').slice(0, NOTE_MAX);

/**
 * 카드 딱지에 적을 글 — 다섯 글자 뒤는 `…`.
 *
 * **줄이 안 바뀌어야 한다**(사장님). 카드 한 줄에 라벨·소비기한과 나란히 서는 자리라,
 * 긴 비고가 그대로 들어오면 줄이 접히면서 카드가 통째로 길어졌다.
 */
export const noteChip = (note?: string): string => {
  const 글 = (note ?? '').trim();
  return 글.length > NOTE_CHIP_CHARS ? `${글.slice(0, NOTE_CHIP_CHARS)}…` : 글;
};

type NoteOrder = { note?: string; noteImportant?: boolean; items: { name: string; note?: string; noteImportant?: boolean }[] };

/** 새 주문은 주문 비고 하나를 쓰고, 옛 품목 비고는 지우거나 합치지 않고 읽기만 한다. */
export const orderNotesForDisplay = (order: NoteOrder): { text: string; important: boolean; legacyItem?: string }[] => {
  const current = order.note?.trim();
  const legacy = order.items.flatMap(item => item.note?.trim()
    ? [{ text: item.note.trim(), important: !!item.noteImportant, legacyItem: item.name }]
    : []);
  return current ? [{ text: current, important: !!order.noteImportant }, ...legacy] : legacy;
};
