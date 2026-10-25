import { createHaccpRecordKnowledge } from './haccpRecordKnowledge';

export type HaccpRecordTargetIssue = 'body-mismatch' | 'duplicate-key' | 'existing-key' | 'missing-record';

interface Options<T> {
  getKey(record: T): string;
  strategy: { kind: 'numeric'; getRevision(record: T): number } | { kind: 'echo'; sameSavedBody(server: T, ack: T): boolean };
  mergeConfirmed(base: T, result: T): T;
}

// 권한·초안 폐기는 화면이 결정한다. 이 저장소는 한 owner에서 확인된 본문만 기억한다.
export function createHaccpRecordAcknowledgements<T extends { id?: string }>(options: Options<T>) {
  let raw: T[] = [], records: T[] = [], serverRecords: T[] = [];
  const saved = new Map<string, T>(), confirmations = new Map<string, {key: string; metadata: T}>(), deleted = new Set<string>();
  const knowledge = createHaccpRecordKnowledge();
  let serverGeneration = 0;
  const savedGeneration = new Map<string, number>();
  const { getKey: keyOf, mergeConfirmed: merge, strategy } = options;
  const sameBody = (server: T, ack: T) => strategy.kind === 'echo' && strategy.sameSavedBody(server, ack);
  const joins = (server: T, ack: T) => (strategy.kind === 'numeric' ? strategy.getRevision(server) >= strategy.getRevision(ack) : sameBody(server, ack)) && confirmedJoined(server, ack);
  const confirmedJoined = (server: T, ack: T) => JSON.stringify(merge({ id: server.id } as T, server)) === JSON.stringify(merge({ id: ack.id } as T, ack));
  const bestConfirmedBase = (key: string, id?: string, includeServer = true): T | undefined => {
    const ack = saved.get(key);
    const validAck = ack && !deleted.has(ack.id ?? '') && (!id || ack.id === id) ? ack : undefined;
    const server = includeServer ? serverRecords.find(row => keyOf(row) === key && (!id || row.id === id) && !deleted.has(row.id ?? '')) : undefined;
    if (validAck) {
      if (server && server.id === validAck.id && joins(server, validAck)) return server;
      return validAck;
    }
    if (server) { const confirmed = confirmations.get(server.id ?? ''); return confirmed?.key === key ? merge(server, confirmed.metadata) : server; }
    return undefined;
  };
  const resolve = (fallback: T, serverReady: boolean) => bestConfirmedBase(keyOf(fallback), undefined, serverReady) ?? fallback;
  const select = (record: T | null, serverReady: boolean): T | null => {
    knowledge.clearSelection();
    if (!record || (record.id && deleted.has(record.id))) return null;
    const resolved = resolve(record, serverReady);
    if (resolved.id && saved.get(keyOf(resolved))?.id === resolved.id) knowledge.rememberAck(resolved.id);
    return resolved;
  };
  const targetIssue = (kind: 'save' | 'confirm' | 'delete', id: string | undefined, key: string): HaccpRecordTargetIssue | undefined => {
    if (kind === 'delete') return id && !deleted.has(id) && records.some(row => row.id === id) ? undefined : 'missing-record';
    const sameKey = records.filter(row => keyOf(row) === key);
    if (sameKey.some(row => row.id !== id)) return sameKey.length > 1 ? 'duplicate-key' : 'existing-key';
    const ack = saved.get(key), server = serverRecords.find(row => row.id === id && keyOf(row) === key);
    if (strategy.kind === 'echo' && ack && server && ack.id === id && serverGeneration > (savedGeneration.get(key) ?? -1) && !sameBody(server, ack)) return 'body-mismatch';
    if (id) return !deleted.has(id) && (records.some(row => row.id === id && keyOf(row) === key) ||
      (!sameKey.length && knowledge.allowsUnobservedAck(id))) ? undefined : 'missing-record';
    return raw.some(row => keyOf(row) === key) ? 'existing-key' : undefined;
  };
  return {
    observe(rows: T[], serverReady: boolean) {
      raw = rows; records = rows.filter(row => !deleted.has(row.id ?? ''));
      knowledge.observe(rows.map(row => row.id));
      if (serverReady) { serverRecords = records; serverGeneration++; }
    },
    resolve,
    known(key: string, serverReady: boolean) { return bestConfirmedBase(key, undefined, serverReady); },
    select,
    captureConfirm(key: string, id: string) { return { key, id, base: bestConfirmedBase(key, id) }; },
    rememberConfirm(result: T, captured: { key: string; id: string; base?: T }) {
      if (result.id !== captured.id || keyOf(result) !== captured.key || deleted.has(captured.id)) return;
      const latest = bestConfirmedBase(captured.key, captured.id);
      const base = captured.base && (!latest || (strategy.kind === 'numeric' ? strategy.getRevision(captured.base) > strategy.getRevision(latest) : !sameBody(latest, captured.base))) ? captured.base : latest;
      const metadata = merge({ id: captured.id } as T, result);
      confirmations.set(captured.id, {key: captured.key, metadata});
      if (base) saved.set(captured.key, merge(base, metadata));
    },
    captureSave: () => serverGeneration,
    rememberSave(record: T, observedBeforeSend = serverGeneration) { if (record.id) { saved.set(keyOf(record), record); savedGeneration.set(keyOf(record), observedBeforeSend); knowledge.rememberAck(record.id); } },
    rememberDelete(id: string, selectedId?: string) {
      deleted.add(id); confirmations.delete(id);
      for (const [key, ack] of saved) if (ack.id === id) saved.delete(key);
      records = records.filter(row => row.id !== id); serverRecords = serverRecords.filter(row => row.id !== id);
      if (selectedId === id) knowledge.clearSelection();
    },
    targetIssue,
    canTarget: (kind: 'save' | 'confirm' | 'delete', id: string | undefined, key: string) => targetIssue(kind, id, key) === undefined,
    openServerRecord(key: string, id: string, serverReady: boolean) {
      const row = serverReady ? serverRecords.find(row => row.id === id && keyOf(row) === key && !deleted.has(row.id ?? '')) : undefined;
      if (row) { knowledge.clearSelection(); saved.delete(key); savedGeneration.delete(key); confirmations.delete(id); }
      return row;
    },
    serverRecord: (key: string) => serverRecords.find(row => keyOf(row) === key && !deleted.has(row.id ?? '')),
    visibleRecords: () => records,
    isDeleted: (id: string) => deleted.has(id),
    allowsUnobservedAck: (id: string) => knowledge.allowsUnobservedAck(id),
    resetOwner() { raw = []; records = []; serverRecords = []; saved.clear(); savedGeneration.clear(); confirmations.clear(); deleted.clear(); knowledge.resetOwner(); },
  };
}
