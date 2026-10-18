import { Timestamp, DocumentReference, GeoPoint, Bytes } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { normalizePartnerItemTermsReference, normalizePartnerItemTermsPreviewInput, normalizePartnerItemTermsPreview, normalizePartnerItemTermsRequest, serializePartnerItemTermsRequest, serializePartnerItemTermsNotice, normalizePartnerItemTermsResult, partnerItemTermsOpening, type PartnerItemTermsCommand, type PartnerItemTermsRequest, type PartnerItemTermsReference, type PartnerItemTerms as CommandTerms, type CatalogValue } from '../../../shared/partnerItemTermsCommand';
import type { PartnerItem, CompanyId } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface PartnerItemTermsScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface PartnerItemTermsTarget {
  itemId: string;
  partnerId: string;
  direction: 'in' | 'out';
  existingLinkId?: string;
  opening: PartnerItem | null;
}
export type PartnerItemTerms = CommandTerms;
export interface PartnerItemTermsInput {
  target: PartnerItemTermsTarget;
  /** UI가 열림 원행과 수정값을 정본으로 합친 최종값이다. 인프라에서 옛 값을 다시 보충하지 않는다. */
  terms: PartnerItemTerms;
}
export type PartnerItemTermsOutcome = SaveOutcome & {
  requiresReopen?: boolean;
};
export interface PendingPartnerItemTerms {
  reference: PartnerItemTermsReference;
  description: string;
}
export interface PartnerItemTermsStoredReference {
  key: string;
  reference: PartnerItemTermsReference | null;
  readable: boolean;
}
export interface PartnerItemTermsBindings {
  requestScopeKey?: string;
  onSavePartnerItemTerms?: (input: PartnerItemTermsInput) => Promise<PartnerItemTermsOutcome>;
  onReadPendingPartnerItemTerms?: () => PendingPartnerItemTerms[];
  onReadPartnerItemTermsReferences?: () => PartnerItemTermsStoredReference[];
  onInspectPartnerItemTerms?: (reference: PartnerItemTermsReference) => Promise<PartnerItemTermsOutcome>;
  onCancelPartnerItemTerms?: (reference: PartnerItemTermsReference) => Promise<PartnerItemTermsOutcome>;
}
export const partnerItemTermsTargetKey = (target: Pick<PartnerItemTermsTarget, 'itemId' | 'partnerId' | 'direction'>) => JSON.stringify([target.itemId, target.partnerId, target.direction]);
export const partnerItemTermsTargetId = (target: PartnerItemTermsTarget) => target.existingLinkId ?? target.opening?.id ?? `${target.itemId}_${target.partnerId}_${target.direction}`;
export type { PartnerItemTermsReference } from '../../../shared/partnerItemTermsCommand';
export interface PartnerItemTermsPlan {
  version: 1;
  actorUid: string;
  request: PartnerItemTermsRequest;
  requestHash: string;
}
export interface PartnerItemTermsWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope: (scope: PartnerItemTermsScope) => Promise<void>;
  exclusive: <T>(scope: PartnerItemTermsScope, identity: string, work: () => Promise<T>) => Promise<T>;
  command: (command: PartnerItemTermsCommand) => Promise<unknown>;
  id: () => string;
}
const codec = {
  special(value: unknown): CatalogValue | undefined {
    if (value instanceof Date) {
      const time = Timestamp.fromDate(value);
      return ['timestamp', time.seconds, time.nanoseconds];
    }
    if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
    if (value instanceof DocumentReference) return ['reference', value.path];
    if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
    if (value instanceof Bytes) return ['bytes', [...value.toUint8Array()]];
    return undefined;
  }
};
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
const prefix = (scope: PartnerItemTermsScope) => `tb_partner_item_terms_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const refOf = (request: PartnerItemTermsReference): PartnerItemTermsReference => ({
  companyId: request.companyId,
  planId: request.planId,
  targetId: request.targetId,
  itemId: request.itemId,
  partnerId: request.partnerId,
  direction: request.direction
});
const keyOf = (scope: PartnerItemTermsScope, reference: PartnerItemTermsReference) => prefix(scope) + [reference.targetId, reference.itemId, reference.partnerId, reference.direction, reference.planId].map(encodeURIComponent).join(':');
const unknown = (message = '거래조건 저장 결과를 확인하지 못했습니다.'): PartnerItemTermsOutcome => ({
  status: 'unknown',
  message,
  nextAction: '보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 같은 내용을 새 요청으로 보내지 마세요.'
});
export function createPartnerItemTermsWriter(port: PartnerItemTermsWritePort) {
  const assert = async (scope: PartnerItemTermsScope, isCurrent: () => boolean) => {
    if (!isCurrent()) throw Error('작성 화면이 바뀌었습니다.');
    await port.assertScope(scope);
    if (!isCurrent()) throw Error('작성 화면이 바뀌었습니다.');
  };
  const read = (scope: PartnerItemTermsScope, reference: PartnerItemTermsReference): PartnerItemTermsPlan => {
    const text = port.storage.getItem(keyOf(scope, reference));
    if (text === null) throw Error('보관 원문이 없습니다.');
    const plan = JSON.parse(text) as PartnerItemTermsPlan;
    const request = normalizePartnerItemTermsRequest(plan.request);
    if (plan.version !== 1 || plan.actorUid !== scope.actorUid || request.companyId !== scope.companyId || keyOf(scope, request) !== keyOf(scope, reference) || !/^[a-f0-9]{64}$/.test(plan.requestHash)) throw Error('보관 원문의 계정·회사·대상·저장 위치가 다릅니다.');
    return {
      version: 1,
      actorUid: plan.actorUid,
      request,
      requestHash: plan.requestHash
    };
  };
  const references = (scope: PartnerItemTermsScope): PartnerItemTermsStoredReference[] => {
    const result: PartnerItemTermsStoredReference[] = [];
    for (let index = 0; index < port.storage.length; index++) {
      const key = port.storage.key(index);
      if (!key?.startsWith(prefix(scope))) continue;
      let reference: PartnerItemTermsReference | null = null,
        readable = false;
      try {
        const parts = key.slice(prefix(scope).length).split(':').map(decodeURIComponent);
        if (parts.length !== 5) throw Error('저장 위치 손상');
        reference = normalizePartnerItemTermsReference({
          companyId: scope.companyId,
          targetId: parts[0],
          itemId: parts[1],
          partnerId: parts[2],
          direction: parts[3],
          planId: parts[4]
        });
        read(scope, reference);
        readable = true;
      } catch {/* 손상 한 건이 다른 품목·거래처의 정상 작업을 막지는 않는다. */}
      result.push({
        key,
        reference,
        readable
      });
    }
    return result;
  };
  const pending = (scope: PartnerItemTermsScope): PendingPartnerItemTerms[] => references(scope).filter(row => row.readable && row.reference).map(row => {
    const plan = read(scope, row.reference!);
    return {
      reference: refOf(plan.request),
      description: `${plan.request.direction === 'in' ? '매입' : '판매'} 거래조건 · 품목 ${plan.request.itemId} · 거래처 ${plan.request.partnerId}`
    };
  });
  const prepare = async (scope: PartnerItemTermsScope, input: PartnerItemTermsInput, notice: (message: string) => Promise<void>, isCurrent: () => boolean = () => true) => {
    // 첫 await 전에 UI 선택 원문과 입력을 정규화해 대기 중 바뀐 초안을 섞지 않는다.
    const target = input.target,
      opening = target.opening;
    if (opening && (opening.itemId !== target.itemId || opening.partnerId !== target.partnerId || (opening.Direction ?? 'out') !== target.direction || opening.id !== partnerItemTermsTargetId(target))) throw Error('선택한 거래조건의 품목·거래처·방향·번호가 다릅니다.');
    const reference = normalizePartnerItemTermsReference({
      companyId: scope.companyId,
      planId: port.id(),
      targetId: partnerItemTermsTargetId(target),
      itemId: target.itemId,
      partnerId: target.partnerId,
      direction: target.direction
    });
    const previewInput = normalizePartnerItemTermsPreviewInput({
      version: 1,
      ...reference,
      opening: opening ? partnerItemTermsOpening({
        ...opening
      }, codec) : null,
      terms: input.terms
    });
    return port.exclusive(scope, partnerItemTermsTargetKey(reference), async () => {
      await assert(scope, isCurrent);
      if (references(scope).some(row => row.reference && partnerItemTermsTargetKey(row.reference) === partnerItemTermsTargetKey(reference))) throw Error('이 거래조건의 보관 요청을 먼저 확인하거나 중단해 주세요.');
      const response = await port.command({
        mode: 'preview',
        input: previewInput
      });
      await assert(scope, isCurrent);
      const preview = normalizePartnerItemTermsPreview(response, reference);
      if (preview.notices.length) {
        const hash = await digest(serializePartnerItemTermsNotice(reference, preview.expected, previewInput.terms, preview.evidence, preview.notices));
        if (hash !== preview.noticeHash) throw Error('박스·낱개 안내 내용과 확인 근거가 다릅니다.');
        await assert(scope, isCurrent);
        await notice(preview.notices.map(row => `"${row.itemName}"은(는) 박스 품목입니다.\n낱개 품목 "${row.childName}"이(가) 이 거래처에 없어 함께 등록합니다.`).join('\n\n'));
        await assert(scope, isCurrent);
      }
      const request = normalizePartnerItemTermsRequest({
        version: 1,
        ...reference,
        expected: preview.expected,
        terms: previewInput.terms,
        evidence: preview.evidence,
        ...(preview.noticeHash ? {
          noticeHash: preview.noticeHash
        } : {})
      });
      const plan: PartnerItemTermsPlan = {
        version: 1,
        actorUid: scope.actorUid,
        request,
        requestHash: await digest(serializePartnerItemTermsRequest(request))
      };
      await assert(scope, isCurrent);
      const key = keyOf(scope, reference),
        text = JSON.stringify(plan);
      if (port.storage.getItem(key) !== null) throw Error('이미 보관된 요청 번호입니다.');
      port.storage.setItem(key, text);
      if (port.storage.getItem(key) !== text) throw Error('최초 거래조건 원문 보관을 확인하지 못했습니다.');
      return plan;
    });
  };
  const run = async (scope: PartnerItemTermsScope, reference: PartnerItemTermsReference, mode: 'apply' | 'inspect' | 'cancel', isCurrent: () => boolean = () => true): Promise<PartnerItemTermsOutcome> => {
    try {
      normalizePartnerItemTermsReference(reference);
      await assert(scope, isCurrent);
      if (reference.companyId !== scope.companyId) throw Error('회사 변경');
    } catch {
      return {
        status: 'cancelled',
        message: '계정이나 회사·작성 화면이 바뀌어 요청을 시작하지 않았습니다.'
      };
    }
    try {
      const original = port.storage.getItem(keyOf(scope, reference));
      let plan: PartnerItemTermsPlan | null = null;
      if (original !== null) {
        try {
          plan = read(scope, reference);
          if ((await digest(serializePartnerItemTermsRequest(plan.request))) !== plan.requestHash) throw Error('해시 불일치');
        } catch {
          if (mode !== 'cancel') return unknown('보관 원문이 손상됐습니다. 원문은 유지하고 명시 요청 중단으로 확인해 주세요.');
          plan = null;
        }
      }
      if (mode === 'apply' && !plan) return unknown('최초 거래조건 원문이 없어 새 저장을 보내지 않았습니다.');
      await assert(scope, isCurrent);
      const command: PartnerItemTermsCommand = mode === 'apply' ? {
        mode,
        request: plan!.request
      } : {
        mode,
        reference,
        ...(plan ? {
          requestHash: plan.requestHash
        } : {})
      };
      const value = await port.command(command);
      await assert(scope, isCurrent);
      const result = normalizePartnerItemTermsResult(value, reference, scope.actorUid, plan?.requestHash);
      if (result.status === 'unknown') return unknown(result.message);
      const saved = result.status === 'applied' || result.status === 'duplicate';
      const outcome: PartnerItemTermsOutcome = saved ? {
        status: 'saved'
      } : {
        status: result.status as 'rejected' | 'cancelled',
        requiresReopen: true,
        message: result.message,
        nextAction: '현재 품목과 거래처의 조건을 다시 열어 확인한 뒤 필요한 작업을 선택해 주세요.'
      };
      try {
        await port.exclusive(scope, partnerItemTermsTargetKey(reference), async () => {
          await assert(scope, isCurrent);
          const key = keyOf(scope, reference),
            current = port.storage.getItem(key);
          if (current === null) return;
          if (current !== original) throw Error('다른 원문이 있어 정리하지 않았습니다.');
          port.storage.removeItem(key);
          if (port.storage.getItem(key) !== null) throw Error('정리를 확인하지 못했습니다.');
        });
      } catch {
        return saved ? {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: [reference.targetId],
          unconfirmedIds: [],
          message: '거래조건 저장은 확인됐지만 기기 보관 요청을 정리하지 못했습니다.',
          nextAction: '다시 저장하지 말고 같은 보관 요청의 결과를 확인해 주세요.'
        } : unknown('서버 결과는 받았지만 보관 원문 정리를 확인하지 못했습니다.');
      }
      return outcome;
    } catch {
      return unknown();
    }
  };
  const submit = async (scope: PartnerItemTermsScope, input: PartnerItemTermsInput, notice: (message: string) => Promise<void>, isCurrent: () => boolean = () => true): Promise<PartnerItemTermsOutcome> => {
    let plan: PartnerItemTermsPlan;
    try {
      plan = await prepare(scope, input, notice, isCurrent);
    } catch (error) {
      return {
        status: 'rejected',
        message: error instanceof Error ? error.message : '거래조건 안내·원문 보관을 완료하지 못했습니다.',
        nextAction: '업무 저장은 전송하지 않았습니다. 작성 내용과 보관 요청·기기 저장소를 확인해 주세요.'
      };
    }
    return run(scope, refOf(plan.request), 'apply', isCurrent);
  };
  return {
    read,
    references,
    pending,
    prepare,
    run,
    submit
  };
}
async function active(scope: PartnerItemTermsScope) {
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  await authReady;
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  const {
    claims
  } = await auth.currentUser.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string') throw Error('회사 직원 권한 변경');
}
const writer = () => createPartnerItemTermsWriter({
  storage: localStorage,
  assertScope: active,
  id: () => crypto.randomUUID(),
  exclusive: async (scope, identity, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + identity, {
      mode: 'exclusive'
    }, work);
  },
  command: async command => (await httpsCallable<PartnerItemTermsCommand, unknown>(functions, 'partnerItemTermsCommand')(command)).data
});
export const submitPartnerItemTerms = (scope: PartnerItemTermsScope, input: PartnerItemTermsInput, notice: (message: string) => Promise<void>, isCurrent: () => boolean = () => true) => writer().submit(scope, input, notice, isCurrent);
export const pendingPartnerItemTerms = (scope: PartnerItemTermsScope) => writer().pending(scope);
export const partnerItemTermsReferences = (scope: PartnerItemTermsScope) => writer().references(scope);
export const inspectPartnerItemTerms = (scope: PartnerItemTermsScope, reference: PartnerItemTermsReference, isCurrent: () => boolean = () => true) => writer().run(scope, reference, 'inspect', isCurrent);
export const cancelPartnerItemTerms = (scope: PartnerItemTermsScope, reference: PartnerItemTermsReference, isCurrent: () => boolean = () => true) => writer().run(scope, reference, 'cancel', isCurrent);
