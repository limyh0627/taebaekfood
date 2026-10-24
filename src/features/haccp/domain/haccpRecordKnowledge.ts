// 한 계정 수명에서 이미 본 기록은 빈 조회나 늦은 ACK로 다시 미관측 기록이 될 수 없다.
export function createHaccpRecordKnowledge() {
  const observedIds = new Set<string>();
  let pendingAckId: string | null = null;
  return {
    observe(ids: Iterable<string | undefined>): void {
      for (const id of ids) if (id) observedIds.add(id);
      if (pendingAckId && observedIds.has(pendingAckId)) pendingAckId = null;
    },
    rememberAck(id: string): void {
      pendingAckId = id && !observedIds.has(id) ? id : null;
    },
    allowsUnobservedAck(id: string): boolean {
      return !!id && pendingAckId === id && !observedIds.has(id);
    },
    clearSelection(): void { pendingAckId = null; },
    resetOwner(): void { observedIds.clear(); pendingAckId = null; },
  };
}
