import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companySettingDocId } from '../companySettings';
import { withClaimCompany } from '../companyWriteBoundary';
import { captureInventoryWriterContext, runInventoryWriterTransaction, prepareCatalogOrderCommit, protectInventoryWriterPatch, inventoryWriterSame } from '../inventoryWriterProtocol';
import type { CompanyId } from '../types';
export interface DeliveryScheduleRequest {
    version: 1;
    companyId: CompanyId;
    actorUid: string;
    auditId: string;
    orderId: string;
    previousDeliveryDate: string;
    previousStatus: string;
    previousTimeSlot: '오전' | '오후';
    nextDeliveryDate: string;
    nextTimeSlot: '오전' | '오후';
    changedBy: string;
    changedAt: string;
}
export interface DeliveryScheduleScope {
    companyId: CompanyId;
    isCurrent: () => boolean;
}
export type DeliveryScheduleResult = {
    status: 'applied';
} | {
    status: 'not-found';
} | {
    status: 'cancelled';
};
export class DeliveryScheduleError extends Error {
    constructor(message: string, readonly outcome: 'not-started' | 'unknown') { super(message); }
}
/** 기술 오류 코드를 사용자 원인·다음 행동으로 바꾸되 원오류는 별도로 보존한다. */
function failure(error: unknown, sent: boolean): DeliveryScheduleError {
    const code = String((error as {
        code?: unknown;
    } | null)?.code ?? '').replace(/^firestore\//, '');
    const messages: Record<string, string> = {
        'permission-denied': '현재 계정의 저장 권한을 확인하지 못했습니다. 처리 결과를 먼저 확인한 뒤 계정 권한을 확인해 주세요.',
        'unauthenticated': '로그인 인증을 확인하지 못했습니다. 현재 계정으로 다시 로그인한 뒤 처리 결과를 먼저 확인해 주세요.',
        'unavailable': '연결이 끊겨 처리 응답을 받지 못했습니다. 연결을 확인한 뒤 처리 결과를 먼저 확인해 주세요.',
        'deadline-exceeded': '응답 대기 시간이 지나 처리 결과를 확인하지 못했습니다. 처리 결과를 먼저 확인해 주세요.'
    };
    if (error instanceof DeliveryScheduleError && !sent)
        return error;
    const message = messages[code] ?? (error instanceof Error ? error.message : '처리 결과를 확인하지 못했습니다. 결과를 다시 확인해 주세요.');
    return Object.assign(new DeliveryScheduleError(message, sent ? 'unknown' : 'not-started'), { cause: error });
}
/** 처음 선택한 원문을 고정하여 재시도에서 날짜와 ID를 만들지 않는다. */
export function prepareDeliverySchedule(input: Omit<DeliveryScheduleRequest, 'version'>): DeliveryScheduleRequest {
    const request: DeliveryScheduleRequest = { version: 1, ...input };
    if (!['taebaek', 'punghoe'].includes(request.companyId) || !request.actorUid || !request.auditId || request.auditId.includes('/') || !request.orderId || request.orderId.includes('/') || !request.previousStatus || typeof request.previousDeliveryDate !== 'string' || !Number.isFinite(Date.parse(request.nextDeliveryDate)) || !Number.isFinite(Date.parse(request.changedAt)) || !['오전', '오후'].includes(request.previousTimeSlot) || !['오전', '오후'].includes(request.nextTimeSlot) || typeof request.changedBy !== 'string')
        throw new DeliveryScheduleError('처음 선택한 주문과 출고 일정 원문을 확인해 주세요.', 'not-started');
    return Object.freeze(request);
}
const strictRequest = (input: DeliveryScheduleRequest) => {
    if (input.version !== 1)
        throw new DeliveryScheduleError('지원하지 않는 출고 일정 요청입니다.', 'not-started');
    const { version: _, ...fields } = input;
    return prepareDeliverySchedule(fields);
};
function owner(scope: DeliveryScheduleScope, request: DeliveryScheduleRequest) {
    const companyId = scope.companyId, current = scope.isCurrent;
    const user = auth.currentUser;
    const check = () => {
        if (!current() || !user || auth.currentUser !== user || user.uid !== request.actorUid || request.companyId !== companyId)
            throw new DeliveryScheduleError('회사 또는 로그인 계정이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.', 'not-started');
    };
    const ready = async () => {
        check();
        await authReady;
        check();
        const token = await user!.getIdTokenResult();
        check();
        withClaimCompany('orders', { companyId: request.companyId }, { companyId: token.claims.companyId });
        check();
    };
    return { check, ready, user };
}
function receipt(data: Record<string, unknown> | undefined, request: DeliveryScheduleRequest) {
    if (!data || !['COMPLETED', 'CANCELLED'].includes(String(data.outcome)) || data.companyId !== request.companyId || data.actorUid !== request.actorUid || !inventoryWriterSame(data.request, request))
        throw new DeliveryScheduleError('같은 기록 번호에 다른 요청 또는 확인할 수 없는 처리 기록이 있습니다.', 'not-started');
    return data.outcome === 'CANCELLED' ? { status: 'cancelled' as const } : { status: 'applied' as const };
}
export async function applyDeliverySchedule(scope: DeliveryScheduleScope, input: DeliveryScheduleRequest, store: Firestore = db): Promise<DeliveryScheduleResult> {
    const request = strictRequest(input), actor = owner(scope, request);
    let sent = false;
    try {
        await actor.ready();
        const context = await captureInventoryWriterContext(store, { companyId: request.companyId, requestIdentity: JSON.stringify(request), ready: authReady, getCurrentUser: () => auth.currentUser, isStillCurrent: () => { actor.check(); return true; } });
        actor.check();
        const result = await runInventoryWriterTransaction(store, context, async (tx) => {
            actor.check();
            const auditRef = doc(store, 'deliveryScheduleAudits', request.auditId);
            const existing = await tx.get(auditRef);
            actor.check();
            if (existing.exists())
                return receipt(existing.data(), request);
            const orderRef = doc(store, 'orders', request.orderId), settingsRef = doc(store, 'settings', companySettingDocId(request.companyId, 'deliveryOrdering'));
            const order = await tx.get(orderRef);
            actor.check();
            const settings = await tx.get(settingsRef);
            actor.check();
            const before = order.data(), config = settings.exists() ? settings.data() : {};
            if (!order.exists() || before?.companyId !== request.companyId || (settings.exists() && config.companyId !== request.companyId))
                throw new DeliveryScheduleError('현재 회사의 주문과 배송 설정을 다시 확인해 주세요.', 'not-started');
            const slots = config.timeSlots ?? {};
            if (!slots || typeof slots !== 'object' || Array.isArray(slots) || before.deliveryDate !== request.previousDeliveryDate || before.status !== request.previousStatus || (slots[request.orderId] ?? '오전') !== request.previousTimeSlot)
                throw new DeliveryScheduleError('주문 날짜·상태 또는 시간대가 변경되었습니다. 최신 내용을 다시 선택해 주세요.', 'not-started');
            const patch = await prepareCatalogOrderCommit(store, tx, request.orderId, before, { companyId: request.companyId, deliveryDate: request.nextDeliveryDate });
            actor.check();
            const protectedPatch = protectInventoryWriterPatch(before, patch, ['status', 'items', 'inventoryOperation', 'inventoryGenerationCompletion', 'productionRecordIndex', 'producedAt', 'shippedOut', 'productConsumedLots', 'rawConsumedLots', 'itemInventory', 'inventorySnapshots', 'rawInventoryAttempt', 'deliveredAt']);
            actor.check();
            sent = true;
            tx.update(orderRef, protectedPatch);
            tx.set(settingsRef, { companyId: request.companyId, timeSlots: { ...slots, [request.orderId]: request.nextTimeSlot } }, { merge: true });
            tx.set(auditRef, { id: request.auditId, companyId: request.companyId, actorUid: request.actorUid, orderId: request.orderId, outcome: 'COMPLETED', request, changedBy: request.changedBy, changedAt: request.changedAt, partnerId: before.partnerId ?? '', partnerName: before.partnerName ?? '', orderStatus: request.previousStatus, previousDeliveryDate: request.previousDeliveryDate, nextDeliveryDate: request.nextDeliveryDate, previousTimeSlot: request.previousTimeSlot, nextTimeSlot: request.nextTimeSlot, completedAt: new Date().toISOString() });
            return { status: 'applied' as const };
        });
        actor.check();
        return result;
    }
    catch (error) {
        throw failure(error, sent);
    }
}
/** 기록 부재만으로 늦은 쓰기까지 미처리로 확정하지 않는다. */
export async function inspectDeliverySchedule(scope: DeliveryScheduleScope, input: DeliveryScheduleRequest, store: Firestore = db): Promise<DeliveryScheduleResult> {
    try {
        const request = strictRequest(input), actor = owner(scope, request);
        await actor.ready();
        actor.check();
        const snapshot = await getDocFromServer(doc(store, 'deliveryScheduleAudits', request.auditId));
        actor.check();
        return snapshot.exists() ? receipt(snapshot.data(), request) : { status: 'not-found' };
    }
    catch (error) {
        throw failure(error, false);
    }
}
/** 중단 기록도 같은 문서의 거래로 확정해 늦은 apply와 한쪽만 이기게 한다. */
export async function cancelDeliverySchedule(scope: DeliveryScheduleScope, input: DeliveryScheduleRequest, store: Firestore = db): Promise<DeliveryScheduleResult> {
    const request = strictRequest(input), actor = owner(scope, request);
    let sent = false;
    try {
        await actor.ready();
        actor.check();
        const result = await runTransaction(store, async (tx) => {
            actor.check();
            const ref = doc(store, 'deliveryScheduleAudits', request.auditId), existing = await tx.get(ref);
            actor.check();
            if (existing.exists())
                return receipt(existing.data(), request);
            actor.check();
            sent = true;
            tx.set(ref, { id: request.auditId, companyId: request.companyId, actorUid: request.actorUid, orderId: request.orderId, outcome: 'CANCELLED', request, changedBy: request.changedBy, changedAt: request.changedAt });
            return { status: 'cancelled' as const };
        });
        actor.check();
        return result;
    }
    catch (error) {
        throw failure(error, sent);
    }
}
/** 과거 처리 기록과 현재 주문 조회를 분리해 명시적으로 다시 선택하게 한다. */
export async function readDeliverySchedule(scope: DeliveryScheduleScope, orderId: string, store: Firestore = db): Promise<{
    deliveryDate: string;
    status: string;
    timeSlot: '오전' | '오후';
}> {
    try {
        const user = auth.currentUser;
        if (!user || !orderId || orderId.includes('/'))
            throw new DeliveryScheduleError('현재 주문을 다시 확인해 주세요.', 'not-started');
        const request = { companyId: scope.companyId, actorUid: user.uid } as DeliveryScheduleRequest, actor = owner(scope, request);
        await actor.ready();
        actor.check();
        const order = await getDocFromServer(doc(store, 'orders', orderId));
        actor.check();
        const settings = await getDocFromServer(doc(store, 'settings', companySettingDocId(scope.companyId, 'deliveryOrdering')));
        actor.check();
        const row = order.data(), config = settings.exists() ? settings.data() : {};
        if (!order.exists() || row?.companyId !== scope.companyId || (settings.exists() && config.companyId !== scope.companyId) || typeof row.deliveryDate !== 'string' || typeof row.status !== 'string')
            throw new DeliveryScheduleError('현재 회사의 주문과 배송 설정을 확인할 수 없습니다.', 'not-started');
        const timeSlot = config.timeSlots?.[orderId] ?? '오전';
        if (!['오전', '오후'].includes(timeSlot))
            throw new DeliveryScheduleError('현재 출고 시간대를 확인해 주세요.', 'not-started');
        return { deliveryDate: row.deliveryDate, status: row.status, timeSlot };
    }
    catch (error) {
        throw failure(error, false);
    }
}
