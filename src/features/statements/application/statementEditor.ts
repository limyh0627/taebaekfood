import { companyOf, type CompanyId, type IssuedStatement, type StatementPartySnapshot } from '../../../shared/types';
import type { LineItem, StatementType } from '../../../shared/statementLines';
import { readPurchaseUnitSnapshot } from '../../../shared/purchaseUnit';
import type { StatementEditEntry, StatementEditObservation, StatementEditBindings, StatementEditScope, StatementEditFollowupPlan, StatementEditProgress } from '../../../shared/services/statementEditWrites';
export interface StatementEditContext {
    companyId: CompanyId;
    actorUid: string;
    isCurrent: () => boolean;
}
export type StatementEditWriter = (id: string, patch: Partial<IssuedStatement>, original: IssuedStatement, expectedActorUid: string, isCurrent: () => boolean) => Promise<unknown>;
export interface StatementEditResult {
    status: 'saved' | 'partial' | 'unknown' | 'not-started' | 'stale';
    acknowledged: boolean;
    message: string;
}
/** 본문 영수증은 가격 후속까지 완료했다는 근거가 아니다. */
export function statementEditBodyResult(observation: StatementEditObservation): StatementEditResult {
    if (observation.copyMismatch) {
        const acknowledged = observation.result.status === 'applied' && !!observation.entry.retained && observation.result.requestHash === observation.entry.retained.requestHash;
        return { status: acknowledged ? 'partial' : 'unknown', acknowledged, message: '전표 처리 결과와 기기 사본을 다시 확인해 주세요. 다른 요청은 정리하지 않았습니다.' };
    }
    if (observation.result.status === 'unknown')
        return { status: 'unknown', acknowledged: false, message: observation.message };
    if (observation.result.status === 'cancelled')
        return { status: 'not-started', acknowledged: false, message: '미처리 전표 수정을 중단했습니다. 기기에 남은 요청 정보를 정리한 뒤 새로 수정할 수 있습니다.' };
    return { status: 'saved', acknowledged: true, message: '전표 수정 결과를 확인했습니다. 현재 전표와 후속 처리는 별도로 확인해 주세요.' };
}
export function statementEditFollowupPending(entry: StatementEditEntry): boolean {
    const body = entry.retained;
    if (!body?.followupPlan)
        return false;
    const { upserts, costUpdates } = body.followupPlan;
    return upserts.some((_row, index) => !body.progress.some(progress => progress.stage === 'terms' && progress.index === index && progress.status === 'acknowledged'))
        || costUpdates.some((_row, index) => !body.progress.some(progress => progress.stage === 'cost' && progress.index === index && progress.status === 'acknowledged'));
}
/** 저장 단계와 영속 진행 기록의 순서를 한 곳에서 지킨다. 재접속 조회는 이 함수를 실행하지 않는다. */
export async function executePersistentStatementEdit(input: {
    ports: StatementEditBindings;
    scope: StatementEditScope;
    original: IssuedStatement;
    patch: Partial<IssuedStatement>;
    plan: StatementEditFollowupPlan | null;
    current: () => boolean;
    afterSave?: (current: () => boolean, report: (progress: StatementEditProgress) => Promise<void>) => unknown | Promise<unknown>;
    onPrepared?: (entry: StatementEditEntry) => void;
    onObserved?: (observation: StatementEditObservation) => void;
}): Promise<StatementEditResult> {
    const { ports, scope, current } = input;
    let entry = await ports.prepare(scope, input.original, input.patch, input.plan, current);
    input.onPrepared?.(entry);
    if (!current())
        return { status: 'stale', acknowledged: false, message: '이전 입력의 요청을 보존했습니다. 현재 입력은 유지합니다.' };
    const observation = await ports.apply(scope, entry, current);
    input.onObserved?.(observation);
    if (!current())
        return { status: 'stale', acknowledged: observation.result.status === 'applied', message: '이전 전표의 응답입니다. 현재 입력은 유지합니다.' };
    entry = observation.entry;
    let result = statementEditBodyResult(observation);
    if (result.status !== 'saved' || !observation.terminal)
        return result;
    try {
        entry = await ports.markFollowup(scope, entry, 'body-ack', current);
        if (!current())
            return { status: 'stale', acknowledged: true, message: '이전 전표 수정은 반영됐습니다. 현재 입력은 유지합니다.' };
        const report = async (progress: StatementEditProgress) => {
            entry = await ports.markFollowup(scope, entry, progress, current);
            if (!current())
                throw Error('편집 입력이 바뀌어 후속 처리를 중단했습니다.');
        };
        await input.afterSave?.(current, report);
        if (!current())
            return { status: 'stale', acknowledged: true, message: '이전 전표 수정은 반영됐습니다. 현재 입력은 유지합니다.' };
        if (statementEditFollowupPending(entry))
            result = { status: 'partial', acknowledged: true, message: '전표 수정은 완료됐습니다. 거래조건과 원가 후속 처리를 따로 확인해 주세요.' };
        else
            await ports.discardObserved(scope, entry, current);
    }
    catch (error) {
        result = { status: 'partial', acknowledged: true, message: `전표 수정은 완료됐지만 후속 처리 또는 기기 사본 정리를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)} 전표 수정을 다시 보내지 말고 처리 결과를 확인해 주세요.` };
        try {
            await ports.markFollowup(scope, entry, { error: result.message }, current);
        }
        catch { /* 최초 원문과 이미 확인한 본문 ACK는 보존한다. */ }
    }
    return result;
}
/** 현재 목록으로 버전을 보충하지 않고 사용자가 선택한 사본만 고정한다. */
export function captureStatementEdit(original: IssuedStatement, id: string, companyId: CompanyId): {
    original: IssuedStatement;
    expectedRevision: number;
} {
    if (!original || typeof id !== 'string' || !id || original.id !== id || companyOf(original) !== companyId)
        throw Error('선택한 같은 회사의 전표 원문을 다시 확인해 주세요.');
    const expectedRevision = original.mutationRevision ?? 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw Error('선택한 전표의 변경 버전을 확인하지 못했습니다. 전표를 다시 열어 주세요.');
    return { original: { ...original, items: original.items.map(item => ({ ...item })) }, expectedRevision };
}
export interface StatementEditDraft {
    tradeDate: string;
    memo: string;
    partnerId: string;
    partnerName: string;
    totalSupply: number;
    totalTax: number;
    totalAmount: number;
    partySnapshot?: StatementPartySnapshot;
    lines: readonly LineItem[];
    type: StatementType;
}
/** 기존 전표 편집의 저장 필드만 옮긴다. 수량·세금·원가를 다시 계산하지 않는다. */
export function buildStatementEditPatch(input: StatementEditDraft): Partial<IssuedStatement> {
    return {
        tradeDate: input.tradeDate, memo: input.memo.trim(), partnerId: input.partnerId, partnerName: input.partnerName,
        totalSupply: input.totalSupply, totalTax: input.totalTax, totalAmount: input.totalAmount, partySnapshot: input.partySnapshot,
        items: input.lines.map((line, index) => ({
            ...(line.itemId ? { itemId: line.itemId } : {}), ...(line.lineKind ? { lineKind: line.lineKind } : {}),
            name: line.name, spec: line.spec, qty: line.qty, price: line.price, supply: line.supply, tax: line.tax, total: line.total, isTaxExempt: line.isTaxExempt,
            accountCode: line.accountCode || undefined, ...(line.side ? { side: line.side } : {}),
            ...(input.type === '매입' ? readPurchaseUnitSnapshot(line) ?? {} : {}),
            ...(input.type === '매입' && line.purchaseUnitId ? { sourceLineIndex: line.sourceLineIndex ?? index } : {}),
            ...(input.type === '매입' && line.purchaseQuantityKg !== undefined ? { purchaseQuantityKg: line.purchaseQuantityKg } : {}),
        })),
    };
}
export async function executeStatementEdit(input: {
    original: IssuedStatement;
    patch: Partial<IssuedStatement>;
    context: StatementEditContext;
    save?: StatementEditWriter;
    afterSave?: (isCurrent: () => boolean) => unknown | Promise<unknown>;
}): Promise<StatementEditResult> {
    const { context } = input;
    if (!context.actorUid || !context.isCurrent())
        return { status: 'not-started', acknowledged: false, message: '회사 또는 로그인 정보가 바뀌어 전표 수정을 전송하지 않았습니다.' };
    let captured: ReturnType<typeof captureStatementEdit>;
    try {
        captured = captureStatementEdit(input.original, input.original?.id, context.companyId);
        if (!input.save)
            throw Error('전표 수정 기능이 연결되지 않았습니다.');
    }
    catch (error) {
        return { status: 'not-started', acknowledged: false, message: error instanceof Error ? error.message : String(error) };
    }
    try {
        const pending = input.save!(captured.original.id, input.patch, captured.original, context.actorUid, context.isCurrent);
        if (!pending || typeof pending.then !== 'function')
            return { status: 'unknown', acknowledged: false, message: '전표 수정 결과를 확인하지 못했습니다. 현재 전표를 다시 확인해 주세요.' };
        await pending;
    }
    catch (error) {
        return { status: context.isCurrent() ? 'unknown' : 'stale', acknowledged: false, message: `전표 수정 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)} 현재 전표를 확인한 뒤 필요한 작업을 선택해 주세요.` };
    }
    if (!context.isCurrent())
        return { status: 'stale', acknowledged: true, message: '이전 전표의 수정 응답입니다. 현재 입력은 유지합니다.' };
    try {
        await input.afterSave?.(context.isCurrent);
    }
    catch (error) {
        return { status: context.isCurrent() ? 'partial' : 'stale', acknowledged: true, message: `전표 수정은 완료됐지만 거래조건 후속 처리를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)} 전표를 다시 수정하지 말고 거래조건 결과를 확인해 주세요.` };
    }
    return context.isCurrent() ? { status: 'saved', acknowledged: true, message: '전표가 수정되었습니다.' } : { status: 'stale', acknowledged: true, message: '이전 전표의 수정 응답입니다. 현재 입력은 유지합니다.' };
}
