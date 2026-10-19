import { auth, authReady } from '../firebase';
import type { CompanyId } from '../types';
import { decodeWorkOrderOpening, workOrderExpected } from '../workOrderCommand';
import { workOrderWrites, reportWorkOrderNotice, hasWorkOrderCopy, type WorkOrderBindings } from './workOrderWrites';
import { saveOutcomeMessage } from '../saveOutcome';
/** 날짜가 바뀐 뒤 회사 작업순서를 한 기기에서 비운다. */
export async function resetDailyWorkOrder(companyId: CompanyId, isCurrent: () => boolean = () => true, bindings: WorkOrderBindings = workOrderWrites): Promise<void> {
    const today = new Date().toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul'
    }).replace(/\. /g, '-').replace('.', '');
    await authReady;
    const scope = {
        companyId, actorUid: auth.currentUser?.uid ?? ''
    };
    const current = () => isCurrent() && auth.currentUser?.uid === scope.actorUid;
    let capturedReference: {
        companyId: CompanyId;
        planId: string;
    } | null = null;
    let proposedReference: {
        companyId: CompanyId;
        planId: string;
    } | null = null;
    try {
        const reference = {
            companyId, planId: crypto.randomUUID()
        };
        proposedReference = reference;
        const opening = await bindings.open(scope, reference, current);
        if (!current())
            return;
        const reset = decodeWorkOrderOpening(opening).reset;
        if (reset?.date === today) {
            reportWorkOrderNotice(scope, '');
            return;
        }
        const entry = await bindings.prepare(scope, {
            version: 1, reference, expected: workOrderExpected(opening), action: 'resetDaily', date: today
        }, current);
        capturedReference = reference;
        if (!current())
            return;
        const result = await bindings.command(scope, entry, 'apply', current);
        if (!current())
            return;
        const message = result.outcome.status === 'saved' ? '' : saveOutcomeMessage(result.outcome) || result.result?.message || '작업순서 초기화 결과를 확인해 주세요.';
        reportWorkOrderNotice(scope, message, capturedReference);
    }
    catch (error) {
        console.error('[작업순서 초기화] 실패:', error);
        if (!capturedReference && proposedReference && hasWorkOrderCopy(scope, proposedReference))
            capturedReference = proposedReference;
        if (current())
            reportWorkOrderNotice(scope, error instanceof Error ? error.message : String(error), capturedReference);
    }
}
