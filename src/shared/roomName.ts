//  **대화방 이름이 정해지는 규칙은 여기 하나다**(2026-09-03 사장님).
//
//  이름은 두 층이다.
//   ① `name`     — **방을 만든 사람**이 정한 이름. 모두에게 기본으로 보인다.
//   ② `nameBy[나]` — 내가 따로 고친 이름. **나한테만** 보인다.
//
//  그래서 방장이 "9월 물류"라고 지으면 모두 그렇게 보고, 그중 누가 "택배건"으로
//  바꾸면 그 사람 화면에서만 "택배건"이다. 방장이 나중에 기본 이름을 또 바꿔도
//  따로 고쳐 둔 사람은 자기 이름을 지킨다.
//
//  둘 다 없으면 참여자 이름을 늘어놓는다 — 카톡과 같다.

export interface RoomNameLike {
  participantIds: string[];
  /** 방장이 정한 이름 — 모두의 기본 */
  name?: string;
  /** 각자 따로 정한 이름 — 자기한테만 */
  nameBy?: Record<string, string>;
  /** 누가 만들었나. 옛 방은 비어 있다(2026-09-03 이전) */
  createdBy?: string;
}

export interface Person { id: string; name?: string }

/** 나에게 보일 방 이름. */
export function roomNameFor(room: RoomNameLike, meId: string, people: readonly Person[]): string {
  const 내가고친것 = room.nameBy?.[meId]?.trim();
  if (내가고친것) return 내가고친것;
  if (room.name?.trim()) return room.name.trim();

  const 남들 = room.participantIds
    .filter(id => id !== meId)
    .map(id => people.find(p => p.id === id)?.name || '알 수 없음');
  return 남들.join(', ') || '나와의 대화';
}

/**
 * 이름을 고칠 때 **어느 칸에 쓸지**.
 * 방장이면 모두의 기본(`name`)을, 아니면 내 것(`nameBy[나]`)을 고친다.
 *
 * 방장이 없는 옛 방은 아무나 기본을 고칠 수 있다 — 그때는 방장이랄 게 없었다.
 */
export function isOwner(room: RoomNameLike, meId: string): boolean {
  return !room.createdBy || room.createdBy === meId;
}

/**
 * 이름 바꾸기를 저장할 조각. `onUpdateRoom(id, 이것)` 에 그대로 넘긴다.
 *
 * 빈 이름은 **지우기**다 — 방장이면 기본이 사라져 참여자 이름으로 돌아가고,
 * 아니면 내가 고친 게 사라져 방장이 지은 이름으로 돌아간다.
 */
export function renameRoomPatch(room: RoomNameLike, meId: string, 새이름: string): Partial<RoomNameLike> {
  const 이름 = 새이름.trim();
  if (isOwner(room, meId)) return { name: 이름 };

  const nameBy = { ...(room.nameBy ?? {}) };
  if (이름) nameBy[meId] = 이름;
  else delete nameBy[meId];
  return { nameBy };
}
