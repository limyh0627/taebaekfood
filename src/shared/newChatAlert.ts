//  **새 메시지가 왔는지 가려내는 셈**(2026-09-03 사장님).
//  전에는 이 셈이 [OfficeTalk.tsx](../../components/OfficeTalk.tsx) 안에 있었다. 그래서
//  **오피스톡 화면을 보고 있을 때만** 알림이 왔다 — 다른 화면으로 나가면 감지가 사라졌다.
//  화면 밖(AdminApp)에서 돌도록 셈만 따로 뺀다.

export interface RoomLike {
  id: string;
  name?: string;
  nameBy?: Record<string, string>;
  participantIds: string[];
  lastMessage?: string;
  lastUpdatedAt: string;
  lastReadBy?: Record<string, string>;
}

export interface ChatPickOpts {
  /** 나 */
  userId: string;
  /** 지금 보고 있는 방. 그 방은 알리지 않는다 — 눈앞에 있는 걸 알릴 필요가 없다. */
  openRoomId?: string | null;
  /** 화면을 보고 있나. 보고 있으면 열린 방은 건너뛴다. */
  focused?: boolean;
}

/**
 * 알릴 방만 골라낸다. **`seen` 은 이 함수가 직접 채운다.**
 * 처음 받은 목록은 통째로 '있던 것'으로 쳐서 아무것도 울리지 않는다 —
 * 앱을 켤 때 안 읽은 방이 우르르 울리면 안 된다.
 *
 * @param seen 방마다 마지막으로 본 시각. 호출한 쪽이 들고 있다가 그대로 다시 넘긴다.
 */
export function pickNewChats<T extends RoomLike>(rooms: T[], seen: Map<string, string>, opts: ChatPickOpts): T[] {
  const 알릴것: T[] = [];
  for (const room of rooms) {
    if (!room.participantIds.includes(opts.userId)) continue;

    const 전에본시각 = seen.get(room.id);
    seen.set(room.id, room.lastUpdatedAt);

    if (전에본시각 === undefined) continue;                    // 첫 목록
    if (!(room.lastUpdatedAt > 전에본시각)) continue;           // 안 바뀌었다
    if (room.lastUpdatedAt <= (room.lastReadBy?.[opts.userId] ?? '')) continue;  // 내가 이미 읽었다
    if (opts.focused && room.id === opts.openRoomId) continue; // 지금 보고 있는 방

    알릴것.push(room);
  }
  return 알릴것;
}

/**
 * 알림에 띄울 글.
 * @param 방이름 화면에 보이는 그 이름을 그대로 넣는다 — `roomNameFor` 로 뽑은 것.
 *              여기서 `room.name` 을 직접 읽으면 각자 고친 이름이 알림에만 안 뜬다.
 */
export function chatMessage(room: RoomLike, 방이름: string): { title: string; body: string } {
  return {
    title: `💬 ${방이름 || '오피스톡'}`,
    body: room.lastMessage || '새 메시지가 도착했습니다.',
  };
}
