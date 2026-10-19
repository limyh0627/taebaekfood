import { Timestamp, DocumentReference, GeoPoint, Bytes, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions, db } from '../../../shared/firebase';
import { quotationSnapshot, quotationOpening, decodeQuotationOpenSnapshot, normalizeQuotationReference, normalizeQuotationRequest, normalizeQuotationResult, normalizeQuotationOpenResult, serializeQuotationRequest, type QuotationReference, type QuotationRequest, type QuotationCommand, type CatalogValueAdapter, type CatalogValue } from '../../../shared/quotationCommand';
import type { Quotation } from '../domain/quotation';
import type { CompanyId } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface QuotationScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface QuotationOpening {
  reference: QuotationReference;
  snapshot: CatalogValue;
  expectedVersion: string;
}
export interface QuotationWriteInput {
  targetId: string;
  action: QuotationRequest['action'];
  opening?: QuotationOpening;
  snapshot?: Quotation;
}
export type QuotationOutcome = SaveOutcome & {
  requiresReopen?: boolean;
  copyMismatch?: true;
};
export interface QuotationCopyDiscardResult {
  status: 'cleared' | 'blocked' | 'unknown';
  message: string;
}
export type QuotationPrepared = {
  status: 'ready';
  reference: QuotationReference;
} | {
  status: 'rejected';
  outcome: QuotationOutcome;
};
export interface QuotationPlan {
  version: 1;
  actorUid: string;
  request: QuotationRequest;
  requestHash: string;
  description: string;
}
export interface PendingQuotation {
  reference: QuotationReference;
  action: QuotationRequest['action'];
  description: string;
  observedLocalText?: string | null;
}
export interface QuotationStoredReference {
  key: string;
  reference: QuotationReference | null;
  readable: boolean;
  observedLocalText?: string | null;
}
export interface QuotationWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope(scope: QuotationScope): Promise<void>;
  exclusive<T>(scope: QuotationScope, targetId: string, work: () => Promise<T>): Promise<T>;
  command(command: QuotationCommand): Promise<unknown>;
  id(): string;
}
const codec: CatalogValueAdapter = {
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
  },
  timestamp: (s, n) => new Timestamp(s, n),
  reference: path => doc(db, path),
  geo: (lat, lng) => new GeoPoint(lat, lng),
  bytes: values => Bytes.fromUint8Array(new Uint8Array(values))
};
export const cloneQuotation = (row: Quotation): Quotation => decodeQuotationOpenSnapshot(quotationSnapshot(row, codec), codec) as unknown as Quotation;
const prefix = (scope: QuotationScope) => `tb_quotation_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (scope: QuotationScope, ref: QuotationReference) => prefix(scope) + [ref.targetId, ref.planId].map(encodeURIComponent).join(':');
const hash = async (request: QuotationRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeQuotationRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join('');
const unknown = (message = '견적 처리 결과를 확인하지 못했습니다.'): QuotationOutcome => ({
  status: 'unknown',
  message,
  nextAction: '같은 보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 새 요청으로 다시 보내지 마세요.'
});
const rejected = (error: unknown): QuotationOutcome => ({
  status: 'rejected',
  message: error instanceof Error ? error.message : '견적 원문을 준비하지 못했습니다.',
  nextAction: '업무 저장은 전송하지 않았습니다. 작성 내용과 기기 저장소를 확인해 주세요.'
});
export function createQuotationWriter(port: QuotationWritePort) {
  const parsePlan = (scope: QuotationScope, reference: QuotationReference, text: string | null): QuotationPlan => {
    if (text === null) throw Error('보관된 견적 원문이 없습니다.');
    const value = JSON.parse(text) as QuotationPlan,
      request = normalizeQuotationRequest(value.request);
    if (value.version !== 1 || value.actorUid !== scope.actorUid || request.reference.companyId !== scope.companyId || keyOf(scope, request.reference) !== keyOf(scope, reference) || !/^[a-f0-9]{64}$/.test(value.requestHash) || typeof value.description !== 'string') throw Error('견적 원문의 회사·계정·저장 위치가 다릅니다.');
    return {
      version: 1,
      actorUid: value.actorUid,
      request,
      requestHash: value.requestHash,
      description: value.description
    };
  };
  const read = (scope: QuotationScope, reference: QuotationReference): QuotationPlan => parsePlan(scope, reference, port.storage.getItem(keyOf(scope, reference)));
  const references = (scope: QuotationScope): QuotationStoredReference[] => {
    const rows: QuotationStoredReference[] = [];
    for (let i = 0; i < port.storage.length; i++) {
      const key = port.storage.key(i);
      if (!key?.startsWith(prefix(scope))) continue;
      let reference: QuotationReference | null = null,
        readable = false;
      const observedLocalText = port.storage.getItem(key);
      try {
        const parts = key.slice(prefix(scope).length).split(':').map(decodeURIComponent);
        if (parts.length !== 2) throw Error('보관 위치 손상');
        reference = normalizeQuotationReference({
          companyId: scope.companyId,
          targetId: parts[0],
          planId: parts[1]
        });
        parsePlan(scope, reference, observedLocalText);
        readable = true;
      } catch {/* 손상 한 건 때문에 다른 견적까지 막지 않는다. */}
      rows.push({
        key,
        reference,
        readable,
        observedLocalText
      });
    }
    return rows;
  };
  const pending = (scope: QuotationScope): PendingQuotation[] => references(scope).filter(row => row.reference && row.readable).map(row => {
    const plan = parsePlan(scope, row.reference!, row.observedLocalText ?? null);
    return {
      reference: plan.request.reference,
      action: plan.request.action,
      description: plan.description,
      observedLocalText: row.observedLocalText
    };
  });
  const capture = async (scope: QuotationScope, selected: Quotation): Promise<QuotationOpening> => {
    const reference = normalizeQuotationReference({
        companyId: scope.companyId,
        targetId: selected.id,
        planId: port.id()
      }),
      opening = quotationOpening(selected, codec);
    await port.assertScope(scope);
    const result = normalizeQuotationOpenResult(await port.command({
      mode: 'open',
      reference,
      opening
    }), reference, scope.actorUid);
    await port.assertScope(scope);
    const snapshot = result.snapshot;
    if (JSON.stringify(quotationOpening(decodeQuotationOpenSnapshot(snapshot, codec), codec)) !== JSON.stringify(opening)) throw Error('견적 내용이 열기 중 바뀌었습니다. 창을 닫고 최신 견적을 다시 열어 주세요.');
    return {
      reference,
      snapshot,
      expectedVersion: result.expectedVersion
    };
  };
  const prepare = async (scope: QuotationScope, input: QuotationWriteInput): Promise<QuotationPrepared> => {
    try {
      // 첫 await 전 최종 원문을 확정해 뒤따른 구독·폼 변경이 최초 요청을 바꾸지 못하게 한다.
      const reference = normalizeQuotationReference(input.opening?.reference ?? {
        companyId: scope.companyId,
        targetId: input.targetId,
        planId: port.id()
      });
      if (reference.companyId !== scope.companyId || reference.targetId !== input.targetId) throw Error('견적 열림 원문과 저장 대상이 다릅니다.');
      const request = normalizeQuotationRequest({
        version: 1,
        reference,
        action: input.action,
        expectedVersion: input.action === 'create' ? null : input.opening?.expectedVersion,
        ...(input.action !== 'delete' ? {
          snapshot: quotationSnapshot(input.snapshot!, codec)
        } : {})
      });
      const description = `${input.action === 'delete' ? '견적 삭제' : '견적 저장'} · ${input.snapshot?.quoteNo ?? input.targetId}`;
      return await port.exclusive(scope, input.targetId, async () => {
        await port.assertScope(scope);
        if (references(scope).some(row => row.reference?.targetId === input.targetId)) throw Error('이 견적의 보관 요청을 먼저 확인하거나 중단해 주세요.');
        const plan: QuotationPlan = {
          version: 1,
          actorUid: scope.actorUid,
          request,
          requestHash: await hash(request),
          description
        };
        await port.assertScope(scope);
        const key = keyOf(scope, reference),
          text = JSON.stringify(plan);
        if (port.storage.getItem(key) !== null) throw Error('이미 보관된 요청 번호입니다.');
        port.storage.setItem(key, text);
        if (port.storage.getItem(key) !== text) throw Error('최초 견적 원문의 기기 보관을 확인하지 못했습니다.');
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
  const run = async (scope: QuotationScope, reference: QuotationReference, mode: 'apply' | 'inspect' | 'cancel'): Promise<QuotationOutcome> => {
    try {
      normalizeQuotationReference(reference);
      await port.assertScope(scope);
      if (reference.companyId !== scope.companyId) throw Error('회사 변경');
    } catch {
      return {
        status: 'cancelled',
        message: '회사나 계정이 바뀌어 견적 요청을 시작하지 않았습니다.'
      };
    }
    let original: string | null,
      plan: QuotationPlan | null = null;
    try {
      original = port.storage.getItem(keyOf(scope, reference));
      if (original !== null) {
        try {
          plan = parsePlan(scope, reference, original);
          if ((await hash(plan.request)) !== plan.requestHash) throw Error('원문 해시 변경');
        } catch {
          if (mode === 'apply') return unknown('보관 원문이 손상됐습니다. 원문을 유지하고 결과 확인 또는 요청 중단을 선택해 주세요.');
          plan = null;
        }
      }
      if (mode === 'apply' && !plan) return unknown('최초 원문이 없어 새 견적 처리는 보내지 않았습니다.');
      await port.assertScope(scope);
      const command: QuotationCommand = mode === 'apply' ? {
        mode,
        request: plan!.request
      } : {
        mode,
        reference
      };
      const value = await port.command(command);
      await port.assertScope(scope);
      const result = normalizeQuotationResult(value, reference, scope.actorUid);
      if (result.status === 'unknown') return unknown(result.message);
      if ((original === null && result.status === 'applied') || (original !== null && (!plan || result.requestHash !== null && result.requestHash !== plan.requestHash))) {
        const state = result.status === 'applied' ? '서버에서는 견적 처리가 완료됐습니다.' : result.status === 'cancelled' ? '서버에서는 미처리 요청 중단이 확인됐습니다.' : '서버에서는 요청 거절이 확인됐습니다.';
        return {
          status: 'rejected', copyMismatch: true, requiresReopen: true,
          message: `${state} ${result.message} ${original === null ? '이 기기에 최초 원문이 없어 현재 작성의 완료로 처리하지 않았습니다.' : '이 기기 사본과 같은 원문인지는 확인하지 못해 보존했습니다.'}`,
          nextAction: original === null ? '현재 목록에서 서버 처리 내역을 확인해 주세요. 이 조회는 현재 작성 내용을 저장하지 않습니다.' : '서버 결과를 확인한 뒤 필요한 경우 이 기기 사본만 명시적으로 정리해 주세요. 이미 처리된 견적은 되돌리지 않습니다.'
        };
      }
      const committed = result.status === 'applied';
      const outcome: QuotationOutcome = committed ? {
        status: 'saved'
      } : {
        status: result.status === 'cancelled' ? 'cancelled' : 'rejected',
        requiresReopen: true,
        message: result.message,
        nextAction: '현재 견적을 다시 열어 필요한 작업을 선택해 주세요.'
      };
      try {
        await port.exclusive(scope, reference.targetId, async () => {
          await port.assertScope(scope);
          const key = keyOf(scope, reference),
            current = port.storage.getItem(key);
          if (current === null) return;
          if (current !== original) throw Error('보관 원문이 바뀌었습니다.');
          port.storage.removeItem(key);
          if (port.storage.getItem(key) !== null) throw Error('보관 정리 실패');
        });
      } catch {
        return committed ? {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: [reference.targetId],
          unconfirmedIds: [],
          message: '견적 처리는 확인됐지만 기기 보관 원문을 정리하지 못했습니다.',
          nextAction: '다시 저장하지 말고 같은 보관 요청의 결과를 확인해 주세요.'
        } : unknown('서버 결과는 받았지만 기기 보관 원문 정리를 확인하지 못했습니다.');
      }
      return outcome;
    } catch {
      return unknown();
    }
  };
  const discardCopy = async (scope: QuotationScope, reference: QuotationReference, observedLocalText: string): Promise<QuotationCopyDiscardResult> => {
    try {
      normalizeQuotationReference(reference);
      if (reference.companyId !== scope.companyId || typeof observedLocalText !== 'string') throw Error('정리할 회사와 관측한 사본을 확인해 주세요.');
      await port.assertScope(scope);
      const raw = await port.command({mode: 'inspect', reference});
      await port.assertScope(scope);
      const result = normalizeQuotationResult(raw, reference, scope.actorUid);
      if (result.status === 'unknown') return {status: 'blocked', message: result.message + ' 미처리 요청을 먼저 중단한 뒤 사본을 정리해 주세요.'};
      return await port.exclusive<QuotationCopyDiscardResult>(scope, reference.targetId, async () => {
        await port.assertScope(scope);
        const key = keyOf(scope, reference);
        if (port.storage.getItem(key) !== observedLocalText) return {status: 'blocked', message: '관측한 뒤 사본이 바뀌어 지우지 않았습니다. 요청 목록을 다시 확인해 주세요.'};
        port.storage.removeItem(key);
        if (port.storage.getItem(key) !== null) throw Error('기기 사본 정리를 확인하지 못했습니다.');
        return {status: 'cleared', message: '이 기기 사본만 정리했습니다. 견적 저장이나 삭제 결과를 바꾸지 않았습니다.'};
      });
    } catch (error) {
      return {status: 'unknown', message: error instanceof Error ? error.message : '이 기기 사본 정리를 확인하지 못했습니다.'};
    }
  };
  return {
    read,
    references,
    pending,
    capture,
    prepare,
    run,
    discardCopy
  };
}
async function active(scope: QuotationScope) {
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  await authReady;
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  const {
    claims
  } = await auth.currentUser.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string') throw Error('현재 회사 직원 권한을 확인해 주세요.');
}
const writer = (isCurrent = () => true) => createQuotationWriter({
  storage: localStorage,
  assertScope: async scope => {
    if (!isCurrent()) throw Error('열린 화면이 바뀌었습니다.');
    await active(scope);
    if (!isCurrent()) throw Error('열린 화면이 바뀌었습니다.');
  },
  exclusive: async (scope, targetId, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + targetId, {
      mode: 'exclusive'
    }, work);
  },
  command: async command => (await httpsCallable<QuotationCommand, unknown>(functions, 'quotationCommand')(command)).data,
  id: () => crypto.randomUUID()
});
export const captureQuotation = (scope: QuotationScope, selected: Quotation, isCurrent?: () => boolean) => writer(isCurrent).capture(scope, selected);
export const prepareQuotation = (scope: QuotationScope, input: QuotationWriteInput, isCurrent?: () => boolean) => writer(isCurrent).prepare(scope, input);
export const applyQuotation = (scope: QuotationScope, reference: QuotationReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'apply');
export const inspectQuotation = (scope: QuotationScope, reference: QuotationReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'inspect');
export const cancelQuotation = (scope: QuotationScope, reference: QuotationReference, isCurrent?: () => boolean) => writer(isCurrent).run(scope, reference, 'cancel');
export const discardQuotationCopy = (scope: QuotationScope, reference: QuotationReference, observedLocalText: string, isCurrent?: () => boolean) => writer(isCurrent).discardCopy(scope, reference, observedLocalText);
export const pendingQuotations = (scope: QuotationScope) => writer().pending(scope);
export const quotationReferences = (scope: QuotationScope) => writer().references(scope);
export const quotationFromOpening = (opening: QuotationOpening): Quotation => decodeQuotationOpenSnapshot(opening.snapshot, codec) as unknown as Quotation;
