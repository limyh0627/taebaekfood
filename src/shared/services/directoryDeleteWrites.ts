import { Timestamp, DocumentReference, GeoPoint, Bytes } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { directoryDeleteOpening, normalizeDirectoryDeleteReference, normalizeDirectoryDeleteRequest, normalizeDirectoryDeletePreview, normalizeDirectoryDeleteResult, serializeDirectoryDeleteRequest, type DirectoryDeleteReference, type DirectoryDeleteRequest, type DirectoryDeleteCommand, type CatalogValue } from '../directoryDeleteCommand';
import type { CompanyId } from '../types';
import type { SaveOutcome } from '../saveOutcome';
export interface DirectoryDeleteScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface DirectoryDeleteInput {
  kind: DirectoryDeleteReference['kind'];
  targetId: string;
  opening: Record<string, unknown>;
}
export interface DirectoryDeletePlan {
  version: 1;
  actorUid: string;
  request: DirectoryDeleteRequest;
  requestHash: string;
  description: string;
}
export interface PendingDirectoryDelete {
  reference: DirectoryDeleteReference;
  description: string;
}
export interface DirectoryDeleteStoredReference {
  key: string;
  reference: DirectoryDeleteReference | null;
  readable: boolean;
}
export type DirectoryDeleteOutcome = SaveOutcome & {
  requiresReopen?: boolean;
};
export type DirectoryDeletePrepared = {
  status: 'ready';
  reference: DirectoryDeleteReference;
} | {
  status: 'rejected';
  outcome: DirectoryDeleteOutcome;
};
export interface DirectoryDeleteBindings {
  requestScopeKey?: string;
  onPrepareDirectoryDelete?: (input: DirectoryDeleteInput) => Promise<DirectoryDeletePrepared>;
  onConfirmDirectoryDelete?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  onInspectDirectoryDelete?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  onCancelDirectoryDelete?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  onReadPendingDirectoryDeletes?: () => PendingDirectoryDelete[];
  onReadDirectoryDeleteReferences?: () => DirectoryDeleteStoredReference[];
}
export interface DirectoryDeleteWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope(scope: DirectoryDeleteScope): Promise<void>;
  exclusive<T>(scope: DirectoryDeleteScope, identity: string, work: () => Promise<T>): Promise<T>;
  command(command: DirectoryDeleteCommand): Promise<unknown>;
  id(): string;
}
const codec = {
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
const prefix = (scope: DirectoryDeleteScope) => `tb_directory_delete_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (scope: DirectoryDeleteScope, ref: DirectoryDeleteReference) => prefix(scope) + [ref.kind, ref.targetId, ref.planId].map(encodeURIComponent).join(':');
const hash = async (request: DirectoryDeleteRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeDirectoryDeleteRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join('');
const unknown = (message = '삭제 결과를 확인하지 못했습니다.'): DirectoryDeleteOutcome => ({
  status: 'unknown',
  message,
  nextAction: '보관된 같은 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 현재 목록에 없다는 이유로 삭제 완료를 판단하지 마세요.'
});
const rejected = (error: unknown): DirectoryDeleteOutcome => ({
  status: 'rejected',
  message: error instanceof Error ? error.message : '삭제 준비를 완료하지 못했습니다.',
  nextAction: '삭제는 전송하지 않았습니다. 현재 자료와 기기 저장소를 확인한 뒤 다시 열어 주세요.'
});
export function createDirectoryDeleteWriter(port: DirectoryDeleteWritePort) {
  const read = (scope: DirectoryDeleteScope, reference: DirectoryDeleteReference): DirectoryDeletePlan => {
    const text = port.storage.getItem(keyOf(scope, reference));
    if (text === null) throw Error('보관된 삭제 원문이 없습니다.');
    const value = JSON.parse(text) as DirectoryDeletePlan;
    const request = normalizeDirectoryDeleteRequest(value.request);
    if (value.version !== 1 || value.actorUid !== scope.actorUid || request.reference.companyId !== scope.companyId || keyOf(scope, request.reference) !== keyOf(scope, reference) || !/^[a-f0-9]{64}$/.test(value.requestHash) || typeof value.description !== 'string') throw Error('삭제 원문의 회사·계정·저장 위치가 다릅니다.');
    return {
      version: 1,
      actorUid: value.actorUid,
      request,
      requestHash: value.requestHash,
      description: value.description
    };
  };
  const references = (scope: DirectoryDeleteScope): DirectoryDeleteStoredReference[] => {
    const result: DirectoryDeleteStoredReference[] = [];
    for (let i = 0; i < port.storage.length; i++) {
      const key = port.storage.key(i);
      if (!key?.startsWith(prefix(scope))) continue;
      let reference: DirectoryDeleteReference | null = null,
        readable = false;
      try {
        const parts = key.slice(prefix(scope).length).split(':').map(decodeURIComponent);
        if (parts.length !== 3) throw Error('보관 위치가 다릅니다.');
        reference = normalizeDirectoryDeleteReference({
          companyId: scope.companyId,
          kind: parts[0],
          targetId: parts[1],
          planId: parts[2]
        });
        read(scope, reference);
        readable = true;
      } catch {/* 손상 한 건은 보존하며 다른 대상의 정상 요청까지 막지 않는다. */}
      result.push({
        key,
        reference,
        readable
      });
    }
    return result;
  };
  const pending = (scope: DirectoryDeleteScope): PendingDirectoryDelete[] => references(scope).filter(row => row.readable && row.reference).map(row => {
    const plan = read(scope, row.reference!);
    return {
      reference: plan.request.reference,
      description: plan.description
    };
  });
  const prepare = async (scope: DirectoryDeleteScope, input: DirectoryDeleteInput): Promise<DirectoryDeletePrepared> => {
    try {
      // 첫 await 전에 선택 원문을 고정하여 확인창 준비 중 편집값 변경과 분리한다.
      const reference = normalizeDirectoryDeleteReference({
        companyId: scope.companyId,
        planId: port.id(),
        kind: input.kind,
        targetId: input.targetId
      });
      const opening = directoryDeleteOpening(input.opening, codec);
      const description = `${input.kind === 'partner' ? '거래처' : '직원'} 삭제 · ${typeof input.opening.name === 'string' ? input.opening.name : input.targetId}`;
      return await port.exclusive(scope, input.kind + ':' + input.targetId, async () => {
        await port.assertScope(scope);
        if (references(scope).some(row => row.reference?.kind === reference.kind && row.reference.targetId === reference.targetId)) throw Error('이 대상의 보관된 삭제 요청을 먼저 확인하거나 중단해 주세요.');
        const preview = normalizeDirectoryDeletePreview(await port.command({
          mode: 'preview',
          reference,
          opening
        }), reference, scope.actorUid);
        await port.assertScope(scope);
        if (JSON.stringify(preview.opening) !== JSON.stringify(opening)) throw Error('준비 중 선택 자료가 달라졌습니다. 최신 자료를 다시 열어 주세요.');
        const request = normalizeDirectoryDeleteRequest({
          version: 1,
          reference,
          opening,
          expectedVersion: preview.expectedVersion
        });
        const plan: DirectoryDeletePlan = {
          version: 1,
          actorUid: scope.actorUid,
          request,
          requestHash: await hash(request),
          description
        };
        await port.assertScope(scope);
        const key = keyOf(scope, reference),
          text = JSON.stringify(plan);
        if (port.storage.getItem(key) !== null) throw Error('이미 보관된 삭제 요청 번호입니다.');
        port.storage.setItem(key, text);
        if (port.storage.getItem(key) !== text) throw Error('삭제 원문의 보관을 확인하지 못했습니다.');
        return {
          status: 'ready' as const,
          reference
        };
      });
    } catch (error) {
      return {
        status: 'rejected',
        outcome: rejected(error)
      };
    }
  };
  const run = async (scope: DirectoryDeleteScope, reference: DirectoryDeleteReference, mode: 'apply' | 'inspect' | 'cancel'): Promise<DirectoryDeleteOutcome> => {
    try {
      normalizeDirectoryDeleteReference(reference);
      await port.assertScope(scope);
      if (reference.companyId !== scope.companyId) throw Error('회사 변경');
    } catch {
      return {
        status: 'cancelled',
        message: '회사나 계정이 바뀌어 삭제 요청을 시작하지 않았습니다.'
      };
    }
    let original: string | null,
      plan: DirectoryDeletePlan | null = null;
    try {
      original = port.storage.getItem(keyOf(scope, reference));
      if (original !== null) {
        try {
          plan = read(scope, reference);
          if ((await hash(plan.request)) !== plan.requestHash) throw Error('원문 해시 변경');
        } catch {
          if (mode !== 'cancel') return unknown('보관된 삭제 원문이 손상됐습니다. 원문은 유지하고 요청 중단으로 확인해 주세요.');
          plan = null;
        }
      }
      if (mode === 'apply' && !plan) return unknown('최초 삭제 원문이 없어 새 삭제는 전송하지 않았습니다.');
      await port.assertScope(scope);
      const command: DirectoryDeleteCommand = mode === 'apply' ? {
        mode,
        request: plan!.request
      } : {
        mode,
        reference,
        ...(plan ? {
          requestHash: plan.requestHash
        } : {})
      };
      const raw = await port.command(command);
      await port.assertScope(scope);
      const result = normalizeDirectoryDeleteResult(raw, reference, scope.actorUid, plan?.requestHash);
      if (result.status === 'unknown') return unknown(result.message);
      const committed = result.status === 'applied';
      const outcome: DirectoryDeleteOutcome = committed ? {
        status: 'saved'
      } : {
        status: result.status === 'cancelled' ? 'cancelled' : 'rejected',
        requiresReopen: true,
        message: result.message,
        nextAction: '확인창을 닫고 현재 자료를 다시 열어 필요한 작업을 선택해 주세요.'
      };
      try {
        await port.exclusive(scope, reference.kind + ':' + reference.targetId, async () => {
          await port.assertScope(scope);
          const key = keyOf(scope, reference),
            current = port.storage.getItem(key);
          if (current === null) return;
          if (current !== original) throw Error('다른 보관 원문으로 바뀌었습니다.');
          port.storage.removeItem(key);
          if (port.storage.getItem(key) !== null) throw Error('보관 정리를 확인하지 못했습니다.');
        });
      } catch {
        return committed ? {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: [reference.targetId],
          unconfirmedIds: [],
          message: '삭제는 확인됐지만 기기 보관 요청을 정리하지 못했습니다.',
          nextAction: '다시 삭제하지 말고 같은 요청의 결과를 확인해 주세요.'
        } : unknown('서버 결과를 받았지만 보관 요청 정리를 확인하지 못했습니다.');
      }
      return outcome;
    } catch {
      return unknown();
    }
  };
  return {
    read,
    references,
    pending,
    prepare,
    run
  };
}
async function active(scope: DirectoryDeleteScope) {
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  await authReady;
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  const {
    claims
  } = await auth.currentUser.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string') throw Error('현재 회사 직원 권한을 확인해 주세요.');
}
const writer = (isCurrent = () => true) => createDirectoryDeleteWriter({
  storage: localStorage,
  assertScope: async scope => {
    if (!isCurrent()) throw Error('열린 화면이 바뀌었습니다.');
    await active(scope);
    if (!isCurrent()) throw Error('열린 화면이 바뀌었습니다.');
  },
  id: () => crypto.randomUUID(),
  exclusive: async (scope, identity, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 삭제 요청 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + identity, {
      mode: 'exclusive'
    }, work);
  },
  command: async command => (await httpsCallable<DirectoryDeleteCommand, unknown>(functions, 'directoryDeleteCommand')(command)).data
});
export const prepareDirectoryDelete = (scope: DirectoryDeleteScope, input: DirectoryDeleteInput, isCurrent?: () => boolean) => writer(isCurrent).prepare(scope, input);
export const confirmDirectoryDelete = (scope: DirectoryDeleteScope, reference: DirectoryDeleteReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'apply');
export const inspectDirectoryDelete = (scope: DirectoryDeleteScope, reference: DirectoryDeleteReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'inspect');
export const cancelDirectoryDelete = (scope: DirectoryDeleteScope, reference: DirectoryDeleteReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'cancel');
export const pendingDirectoryDeletes = (scope: DirectoryDeleteScope) => writer().pending(scope);
export const directoryDeleteReferences = (scope: DirectoryDeleteScope) => writer().references(scope);
