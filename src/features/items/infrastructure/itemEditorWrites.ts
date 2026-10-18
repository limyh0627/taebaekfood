import { Bytes, DocumentReference, GeoPoint, Timestamp, collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../../shared/firebase';
import { ITEM_EDITOR_STAGES, ITEM_EDITOR_GRAPH_PARTS, normalizeItemEditorReference, normalizeItemEditorRequest, normalizeItemEditorResult, serializeItemEditorRequest, serializeItemEditorGraphPart, itemEditorTargetExpected, itemEditorDisplayMatches, type CatalogValue, type ItemEditorCommand, type ItemEditorDraft, type ItemEditorGraphDocuments, type ItemEditorGraphEvidence, type ItemEditorReference, type ItemEditorRequest, type ItemEditorResult } from '../../../shared/itemEditorCommand';
import { applyItemEditorResult, createItemEditorProgress, itemEditorUnknown, type ItemEditorProgress, type ItemEditorSaveResult } from '../application/itemEditorSave';
import type { CompanyId, Item } from '../../../shared/types';
export interface ItemEditorScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface ItemEditorOpening extends ItemEditorScope {
  targetId: string;
  graph: ItemEditorGraphEvidence;
  targetExpected: CatalogValue | null;
  documents: ItemEditorGraphDocuments;
  target: Record<string, unknown> | null;
}
export interface ItemEditorSaveInput {
  opening: ItemEditorOpening;
  draft: ItemEditorDraft;
  purchaseNoticeHash?: string;
}
export interface PendingItemEditorPlan {
  version: 1;
  actorUid: string;
  reference: ItemEditorReference;
  request: ItemEditorRequest;
  requestHash: string;
  readable: true;
}
export interface ItemEditorStoredReference {
  key: string;
  reference: ItemEditorReference | null;
  readable: boolean;
  error: string;
}
export interface ItemEditorWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope: (scope: ItemEditorScope) => Promise<void>;
  fetchGraph: (scope: ItemEditorScope) => Promise<ItemEditorGraphDocuments>;
  command: (command: ItemEditorCommand) => Promise<unknown>;
  exclusive: <T>(scope: ItemEditorScope, targetId: string, work: () => Promise<T>) => Promise<T>;
  id: () => string;
}
const adapter = {
  special(value: unknown): CatalogValue | undefined {
    if (value instanceof Date) {
      const t = Timestamp.fromDate(value);
      return ['timestamp', t.seconds, t.nanoseconds];
    }
    if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
    if (value instanceof DocumentReference) return ['reference', value.path];
    if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
    if (value instanceof Bytes) return ['bytes', [...value.toUint8Array()]];
    return undefined;
  }
};
const prefix = (scope: ItemEditorScope) => `tb_item_editor_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (scope: ItemEditorScope, ref: ItemEditorReference) => prefix(scope) + encodeURIComponent(ref.targetId) + ':' + encodeURIComponent(ref.planId);
const refOf = (request: ItemEditorRequest): ItemEditorReference => ({
  companyId: request.companyId,
  targetId: request.targetId,
  planId: request.planId
});
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
const rejected = (progress: ItemEditorProgress, message: string): ItemEditorSaveResult => ({
  progress,
  outcome: {
    status: 'rejected',
    message,
    nextAction: '아직 새 요청을 전송하지 않았습니다. 최초 작성 내용과 기기 저장소를 확인해 주세요.'
  }
});
export function itemEditorOpeningMatches(selected: Item | undefined, opening: ItemEditorOpening): boolean {
  if (!selected) return opening.target === null;
  return selected.id === opening.targetId && opening.target !== null && itemEditorDisplayMatches({
    ...selected
  }, opening.target, adapter);
}
export function createItemEditorWriter(port: ItemEditorWritePort) {
  const active = async (scope: ItemEditorScope, isCurrent: () => boolean) => {
    if (!isCurrent()) throw Error('편집 화면이 바뀌었습니다.');
    await port.assertScope(scope);
    if (!isCurrent()) throw Error('편집 화면이 바뀌었습니다.');
  };
  const capture = async (scope: ItemEditorScope, targetId: string, isCurrent: () => boolean): Promise<ItemEditorOpening> => {
    normalizeItemEditorReference({
      companyId: scope.companyId,
      targetId,
      planId: 'opening'
    });
    await active(scope, isCurrent);
    const documents = await port.fetchGraph(scope);
    await active(scope, isCurrent);
    const target = documents.items.find(row => row.id === targetId)?.data ?? null;
    if (target && Object.prototype.hasOwnProperty.call(target, 'id') && target.id !== targetId) throw Error('선택한 품목의 문서 번호와 저장된 번호가 다릅니다. 해당 품목을 확인한 뒤 다시 열어 주세요.');
    const graph = {
      schemaVersion: 1
    } as ItemEditorGraphEvidence;
    for (const part of ITEM_EDITOR_GRAPH_PARTS) graph[part] = {
      count: documents[part].length,
      digest: await digest(serializeItemEditorGraphPart(part, documents[part], adapter))
    };
    await active(scope, isCurrent);
    return {
      ...scope,
      targetId,
      documents,
      target,
      graph,
      targetExpected: target ? itemEditorTargetExpected(target, adapter) : null
    };
  };
  const read = (scope: ItemEditorScope, reference: ItemEditorReference): PendingItemEditorPlan => {
    const raw = port.storage.getItem(keyOf(scope, reference));
    if (raw === null) throw Error('보관된 최초 요청이 없습니다.');
    const row = JSON.parse(raw) as PendingItemEditorPlan,
      request = normalizeItemEditorRequest(row.request);
    if (row.version !== 1 || row.actorUid !== scope.actorUid || request.companyId !== scope.companyId || keyOf(scope, refOf(request)) !== keyOf(scope, reference) || typeof row.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.requestHash)) throw Error('보관 요청의 회사·계정·계획 번호가 다릅니다.');
    return {
      version: 1,
      actorUid: scope.actorUid,
      reference: refOf(request),
      request,
      requestHash: row.requestHash,
      readable: true
    };
  };
  const references = (scope: ItemEditorScope): ItemEditorStoredReference[] => {
    const rows: ItemEditorStoredReference[] = [];
    for (let i = 0; i < port.storage.length; i++) {
      const key = port.storage.key(i);
      if (!key?.startsWith(prefix(scope))) continue;
      let reference: ItemEditorReference | null = null;
      try {
        const [target, plan, ...extra] = key.slice(prefix(scope).length).split(':');
        if (extra.length) throw Error('저장 위치 형식이 다릅니다.');
        reference = normalizeItemEditorReference({
          companyId: scope.companyId,
          targetId: decodeURIComponent(target),
          planId: decodeURIComponent(plan)
        });
        read(scope, reference);
        rows.push({
          key,
          reference,
          readable: true,
          error: ''
        });
      } catch (error) {
        rows.push({
          key,
          reference,
          readable: false,
          error: error instanceof Error ? error.message : '보관 요청을 읽지 못했습니다.'
        });
      }
    }
    return rows;
  };
  const pending = (scope: ItemEditorScope) => references(scope).filter(row => row.readable && row.reference).map(row => read(scope, row.reference!));
  const prepare = async (scope: ItemEditorScope, input: ItemEditorSaveInput, isCurrent: () => boolean) => port.exclusive(scope, input.opening.targetId, async () => {
    await active(scope, isCurrent);
    const opening = input.opening;
    if (opening.companyId !== scope.companyId || opening.actorUid !== scope.actorUid) throw Error('열 때 확인한 회사·계정이 바뀌었습니다.');
    if (references(scope).some(row => row.reference?.targetId === opening.targetId)) throw Error('이 품목의 보관 요청을 먼저 확인하거나 중단해 주세요.');
    const request = normalizeItemEditorRequest({
      version: 1,
      companyId: scope.companyId,
      planId: port.id(),
      targetId: opening.targetId,
      graph: opening.graph,
      targetExpected: opening.targetExpected,
      draft: input.draft,
      ...(input.purchaseNoticeHash ? {
        purchaseNoticeHash: input.purchaseNoticeHash
      } : {})
    });
    const plan: PendingItemEditorPlan = {
      version: 1,
      actorUid: scope.actorUid,
      reference: refOf(request),
      request,
      requestHash: await digest(serializeItemEditorRequest(request)),
      readable: true
    };
    await active(scope, isCurrent);
    const key = keyOf(scope, plan.reference),
      text = JSON.stringify(plan);
    if (port.storage.getItem(key) !== null) throw Error('이미 보관된 계획 번호입니다.');
    port.storage.setItem(key, text);
    if (port.storage.getItem(key) !== text) throw Error('최초 요청의 기기 보관을 확인하지 못했습니다.');
    return plan;
  });
  const clear = async (scope: ItemEditorScope, reference: ItemEditorReference, original: string | null, isCurrent: () => boolean) => port.exclusive(scope, reference.targetId, async () => {
    await active(scope, isCurrent);
    const key = keyOf(scope, reference);
    const current = port.storage.getItem(key);
    if (current === null) return;
    if (current !== original) throw Error('보관 원문이 바뀌어 정리하지 않았습니다.');
    port.storage.removeItem(key);
    if (port.storage.getItem(key) !== null) throw Error('보관 요청 정리를 확인하지 못했습니다.');
  });
  const resolve = async (scope: ItemEditorScope, reference: ItemEditorReference, progress: ItemEditorProgress, isCurrent: () => boolean, mode: 'inspect' | 'cancel' | 'apply', stage?: typeof ITEM_EDITOR_STAGES[number]): Promise<ItemEditorSaveResult> => {
    if (progress.itemId !== reference.targetId || reference.companyId !== scope.companyId || progress.reference && (progress.reference.planId !== reference.planId || progress.reference.targetId !== reference.targetId || progress.reference.companyId !== reference.companyId)) return itemEditorUnknown(progress, '다른 품목 또는 회사의 보관 요청입니다.');
    let original: string | null,
      plan: PendingItemEditorPlan | null = null;
    try {
      normalizeItemEditorReference(reference);
      await active(scope, isCurrent);
      original = port.storage.getItem(keyOf(scope, reference));
    } catch {
      return itemEditorUnknown(progress, '보관 요청을 읽거나 원래 회사·계정을 확인하지 못했습니다.');
    }
    if (original !== null) {
      try {
        plan = read(scope, reference);
        if ((await digest(serializeItemEditorRequest(plan.request))) !== plan.requestHash) throw Error('최초 요청 해시가 다릅니다.');
      } catch {
        if (mode === 'apply') return itemEditorUnknown(progress, '보관 원문이 손상되어 다시 전송하지 않았습니다. 결과 확인 또는 요청 중단을 선택해 주세요.');
        plan = null;
      }
    }
    if (mode === 'apply' && (!plan || !stage)) return itemEditorUnknown(progress, '같은 최초 요청의 원문이 없어 다시 전송하지 않았습니다.');
    try {
      const command: ItemEditorCommand = mode === 'apply' ? {
        mode,
        stage: stage!,
        request: plan!.request
      } : {
        mode,
        reference,
        ...(plan ? {
          requestHash: plan.requestHash
        } : {})
      };
      await active(scope, isCurrent);
      const raw = await port.command(command);
      await active(scope, isCurrent);
      const result = normalizeItemEditorResult(raw, reference, scope.actorUid, plan?.requestHash);
      const mapped: ItemEditorSaveResult = {
        ...applyItemEditorResult(result, progress),
        serverStatus: result.status
      };
      if (result.status !== 'unknown' && progress.unknownStageId) return {
        ...mapped,
        serverStatus: undefined
      };
      if (result.status === 'completed' || result.status === 'cancelled' || result.status === 'rejected') {
        try {
          await clear(scope, reference, original, isCurrent);
        } catch {
          if (result.status === 'completed') return {
            progress,
            outcome: {
              status: 'partial',
              reason: 'followup-unconfirmed',
              committedIds: [reference.targetId],
              unconfirmedIds: [],
              message: '품목 저장의 모든 단계는 완료됐지만 기기 보관 요청을 정리하지 못했습니다.',
              nextAction: '다시 저장하지 말고 같은 요청의 결과를 확인해 주세요.'
            }
          };
          return itemEditorUnknown(progress, '서버 종결 결과를 받았지만 기기 보관 요청 정리를 확인하지 못했습니다.');
        }
      }
      return mapped;
    } catch {
      return itemEditorUnknown(progress);
    }
  };
  const execute = async (scope: ItemEditorScope, reference: ItemEditorReference, progress: ItemEditorProgress, isCurrent: () => boolean, inspectFirst = true): Promise<ItemEditorSaveResult> => {
    if (inspectFirst) {
      const inspected = await resolve(scope, reference, progress, isCurrent, 'inspect');
      if (!inspected.serverStatus) return inspected;
      if (['completed', 'cancelled', 'rejected'].includes(progress.terminalStatus ?? '')) return inspected;
      if (progress.unknownStageId && !isCurrent()) return inspected;
    }
    for (let i = progress.confirmedStageIds.length; i < ITEM_EDITOR_STAGES.length;) {
      const before = progress.confirmedStageIds.length;
      const result = await resolve(scope, reference, progress, isCurrent, 'apply', ITEM_EDITOR_STAGES[i]);
      if (progress.terminalStatus !== 'active' || progress.unknownStageId) return result;
      if (progress.confirmedStageIds.length <= before) return itemEditorUnknown(progress, '서버의 완료 단계가 진행되지 않았습니다.');
      i = progress.confirmedStageIds.length;
    }
    return {
      progress,
      outcome: {
        status: 'saved'
      }
    };
  };
  const submit = async (scope: ItemEditorScope, input: ItemEditorSaveInput, progress: ItemEditorProgress, isCurrent: () => boolean) => {
    if (progress.itemId !== input.opening.targetId) return rejected(progress, '작성한 품목과 진행 기록의 대상이 다릅니다.');
    if (progress.unknownStageId || progress.confirmedStageIds.length) {
      if (!progress.durableVersion || !progress.reference) return itemEditorUnknown(progress, '이전 영수증 없는 저장의 미확정 기록은 새 계획으로 전송하지 않습니다. 기존 결과를 먼저 확인해 주세요.');
      return itemEditorUnknown(progress, '보관 요청의 명시적인 이어하기를 선택해 주세요.');
    }
    let plan: PendingItemEditorPlan;
    try {
      plan = await prepare(scope, input, isCurrent);
    } catch (error) {
      return rejected(progress, error instanceof Error ? error.message : '최초 요청을 준비하지 못했습니다.');
    }
    progress.reference = plan.reference;
    progress.durableVersion = 1;
    return execute(scope, plan.reference, progress, isCurrent, false);
  };
  return {
    capture,
    read,
    references,
    pending,
    prepare,
    resolve,
    execute,
    submit
  };
}
async function assertScope(scope: ItemEditorScope) {
  await authReady;
  const user = auth.currentUser;
  if (!user || user.uid !== scope.actorUid) throw Error('로그인 계정이 바뀌었습니다.');
  const {
    claims
  } = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string') throw Error('회사·계정 권한이 바뀌었습니다.');
}
const writer = () => createItemEditorWriter({
  storage: localStorage,
  assertScope,
  id: () => crypto.randomUUID(),
  exclusive: async (scope, targetId, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 저장 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + targetId, {
      mode: 'exclusive'
    }, work);
  },
  fetchGraph: async scope => {
    const collections = {
      items: 'items',
      boms: 'item_bom',
      formulas: 'item_formula',
      links: 'partner_item'
    };
    const graph = {} as ItemEditorGraphDocuments;
    await Promise.all(ITEM_EDITOR_GRAPH_PARTS.map(async part => {
      const snapshot = await getDocsFromServer(query(collection(db, collections[part]), where('companyId', '==', scope.companyId)));
      graph[part] = snapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data()
      }));
    }));
    return graph;
  },
  command: async command => (await httpsCallable<ItemEditorCommand, unknown>(functions, 'itemEditorCommand')(command)).data
});
export const captureItemEditorOpening = (scope: ItemEditorScope, targetId: string, isCurrent: () => boolean) => writer().capture(scope, targetId, isCurrent);
export const pendingItemEditorPlans = (scope: ItemEditorScope) => writer().pending(scope);
export const itemEditorReferences = (scope: ItemEditorScope) => writer().references(scope);
export const submitItemEditorSave = (scope: ItemEditorScope, input: ItemEditorSaveInput, progress: ItemEditorProgress, isCurrent: () => boolean) => writer().submit(scope, input, progress, isCurrent);
export const inspectItemEditorSave = (scope: ItemEditorScope, ref: ItemEditorReference, progress: ItemEditorProgress, isCurrent: () => boolean) => writer().resolve(scope, ref, progress, isCurrent, 'inspect');
export const continueItemEditorSave = (scope: ItemEditorScope, ref: ItemEditorReference, progress: ItemEditorProgress, isCurrent: () => boolean) => writer().execute(scope, ref, progress, isCurrent, true);
export const cancelItemEditorSave = (scope: ItemEditorScope, ref: ItemEditorReference, progress: ItemEditorProgress, isCurrent: () => boolean) => writer().resolve(scope, ref, progress, isCurrent, 'cancel');
export const createPendingItemEditorProgress = (plan: PendingItemEditorPlan): ItemEditorProgress => ({
  ...createItemEditorProgress(plan.reference.targetId),
  durableVersion: 1,
  reference: plan.reference
});
