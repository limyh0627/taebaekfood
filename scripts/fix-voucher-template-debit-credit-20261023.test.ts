import { expect, it, vi } from 'vitest';
import { runRepair, buildPlan, validatePlan, writesFor, execute, observePlan, hash, ROOT, TARGET_IDS, nativeVersion, parseArgs, type TypedDocument, type Observation, type Port, type Receipt } from './fix-voucher-template-debit-credit-20261023.mts';
const version = '2026-10-23T09:10:17.123456789Z';
const stringValue = (s: string) => ({ stringValue: s });
const doc = (collection: string, id: string, fields: Record<string, unknown>): TypedDocument => ({ name: `${ROOT}/${collection}/${id}`, fields, createTime: '2026-01-01T00:00:00Z', updateTime: version });
function fixture(): Observation {
    const templates = TARGET_IDS.map((id, i) => doc('fixedCostTemplates', id, { companyId: stringValue(i === 5 ? 'punghoe' : 'taebaek'), name: stringValue('합성템플릿' + i), dir: stringValue('대체'), kind: stringValue('voucher'), mode: stringValue('일반'), partnerId: stringValue('p' + (i === 5 ? 8 : i % 8)), accountCode: stringValue('828'), amount: { integerValue: i === 13 ? '0' : '110000' }, taxExempt: { booleanValue: i % 2 === 0 }, active: { booleanValue: false }, autoIssue: { booleanValue: false }, hidden: { booleanValue: false }, legacyTimestamp: { timestampValue: '2026-01-01T00:00:00.123456789Z' } }));
    for (let i = 14; i < 102; i++)
        templates.push(doc('fixedCostTemplates', 'untouched-' + i, { companyId: stringValue('taebaek'), dir: stringValue('출금') }));
    const accounts = ['taebaek', 'punghoe'].flatMap(company => ['253', '828'].map(code => doc('accountCodes', company + '-' + code, { companyId: stringValue(company), code: stringValue(code), normalBalance: stringValue(code === '253' ? 'credit' : 'debit') })));
    const partners = Array.from({ length: 9 }, (_, i) => doc('partners', 'p' + i, { companyId: stringValue(i === 8 ? 'punghoe' : 'taebaek'), name: stringValue('합성거래처' + i) }));
    return { templates, accounts, partners };
}
function store(input: Observation) {
    const docs = new Map(input.templates.map(d => [d.name, structuredClone(d)]));
    let n = 0;
    const commit = vi.fn(async (writes) => {
        for (const w of writes) {
            const current = docs.get(w.update.name)!;
            if (current.updateTime !== w.currentDocument.updateTime)
                throw Error('CAS');
        }
        const results = [];
        for (const w of writes) {
            const d = docs.get(w.update.name)!;
            if (Object.prototype.hasOwnProperty.call(w.update.fields, 'statementType'))
                d.fields.statementType = w.update.fields.statementType;
            else
                delete d.fields.statementType;
            d.updateTime = `2026-10-23T09:11:00.${String(++n).padStart(9, '0')}Z`;
            results.push({ updateTime: d.updateTime });
        }
        return { writeResults: results };
    });
    const port: Port = { get: async (name) => structuredClone(docs.get(name) ?? null), commit };
    return { port, docs, commit };
}
it('dry는 typed 102원문/나노초를 보관하고 exact14에 매입만 추가한다', () => {
    const f = fixture(), p = buildPlan(f);
    validatePlan(p);
    expect(p.targets).toHaveLength(14);
    for (const t of p.targets) {
        expect(t.afterFields).toEqual({ ...t.before.fields, statementType: stringValue('매입') });
        expect(t.before.updateTime).toBe(version);
    }
    expect(p.observation).toEqual(f);
    expect(nativeVersion(version).nanoseconds).toBe(123456789);
});
it('조건집합은 고정14와 양방향 같아야 한다', () => { const missing = fixture(); missing.templates[0].fields.statementType = stringValue('매입'); expect(() => buildPlan(missing)).toThrow(); const extra = fixture(); extra.templates[14] = doc('fixedCostTemplates', 'unexpected', { ...extra.templates[0].fields }); expect(() => buildPlan(extra)).toThrow(); });
it('활성자동발행/다른회사거래처/계정누락을 거절한다', () => {
    for (const change of [(f: Observation) => f.templates[0].fields.autoIssue = { booleanValue: true }, (f: Observation) => f.partners[0].fields.companyId = stringValue('punghoe'), (f: Observation) => f.accounts.splice(0, 1)]) {
        const f = fixture();
        change(f);
        expect(() => buildPlan(f)).toThrow();
    }
});
it('손상된 계획해시와 새 statementType 외 필드변경은 거절한다', () => { const p = buildPlan(fixture()); p.targets[0].afterFields.amount = { integerValue: '999' }; expect(() => validatePlan(p)).toThrow(); });
it('commit14는 updateMask 한필드와 exact 원문version만 전달한다', () => {
    const p = buildPlan(fixture()), writes = writesFor(p, 'apply');
    expect(writes).toHaveLength(14);
    for (const w of writes) {
        expect(w.updateMask.fieldPaths).toEqual(['statementType']);
        expect(w.update.fields).toEqual({ statementType: stringValue('매입') });
        expect(w.currentDocument.updateTime).toBe(version);
    }
});
it('exact fresh 원문 또는 ns버전이 달라지면 intent/commit 모두 0이다', async () => {
    for (const versionOnly of [true, false]) {
        const f = fixture(), p = buildPlan(f), s = store(f), intent = vi.fn();
        const d = s.docs.get(p.targets[0].before.name)!;
        if (versionOnly)
            d.updateTime = '2026-10-23T09:10:17.123456788Z';
        else
            d.fields.note = stringValue('새수정');
        await expect(execute(p, s.port, 'apply', intent)).rejects.toThrow();
        expect(s.commit).not.toHaveBeenCalled();
        expect(intent).not.toHaveBeenCalled();
    }
});
it('정상 ACK14버전과 postGET가 일치해야 조건부undo 영수증이다', async () => {
    const f = fixture(), p = buildPlan(f), s = store(f), intent = vi.fn();
    const receipt = await execute(p, s.port, 'apply', intent);
    expect(receipt.responseConfirmed).toBe(true);
    expect(receipt.state).toBe('after');
    expect(intent).toHaveBeenCalledTimes(1);
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(receipt.writeVersions).toHaveLength(14);
    const undo = await execute(p, s.port, 'undo', vi.fn(), receipt);
    expect(undo.state).toBe('before');
    for (const t of p.targets)
        expect(s.docs.get(t.before.name)!.fields).toEqual(t.before.fields);
});
it('응답유실 after14는 관측만이며 undo 자격이 생기지 않는다', async () => { const f = fixture(), p = buildPlan(f), s = store(f); const commit = s.port.commit; s.port.commit = async (writes) => { await commit(writes); throw Error('응답 유실'); }; const receipt = await execute(p, s.port, 'apply', vi.fn()); expect(receipt.state).toBe('after'); expect(receipt.responseConfirmed).toBe(false); expect(() => writesFor(p, 'undo', receipt)).toThrow('ACK'); expect(s.commit).toHaveBeenCalledTimes(1); await observePlan(p, s.port, 'apply'); expect(s.commit).toHaveBeenCalledTimes(1); });
it('응답유실 before14와 mixed는 미처리/자동복구로 승격하지 않는다', async () => { const f = fixture(), p = buildPlan(f), s = store(f); s.port.commit = vi.fn().mockRejectedValue(Error('미확인')); const receipt = await execute(p, s.port, 'apply', vi.fn()); expect(receipt.state).toBe('before'); expect(receipt.responseConfirmed).toBe(false); s.docs.get(p.targets[0].before.name)!.fields.statementType = stringValue('매입'); expect((await observePlan(p, s.port, 'apply')).state).toBe('conflict'); });
it('ACK 버전이 부족하거나 postGET 메타가 더 바뀌면 undo영수증이 아니다', async () => {
    for (const kind of ['short', 'changed']) {
        const f = fixture(), p = buildPlan(f), s = store(f), commit = s.port.commit;
        s.port.commit = async (writes) => {
            const result = await commit(writes) as {
                writeResults: {
                    updateTime: string;
                }[];
            };
            if (kind === 'short')
                result.writeResults.pop();
            else
                s.docs.get(p.targets[0].before.name)!.updateTime = '2026-10-23T09:12:00Z';
            return result;
        };
        const receipt = await execute(p, s.port, 'apply', vi.fn());
        expect(receipt.responseConfirmed).toBe(false);
        expect(() => writesFor(p, 'undo', receipt)).toThrow();
    }
});
it('undo는 후속 수정의 typed원문/버전이나 영수증해시를 덮지 않는다', async () => { const f = fixture(), p = buildPlan(f), s = store(f), receipt = await execute(p, s.port, 'apply', vi.fn()); s.docs.get(p.targets[0].before.name)!.fields.note = stringValue('후속업무'); await expect(execute(p, s.port, 'undo', vi.fn(), receipt)).rejects.toThrow(); expect(s.commit).toHaveBeenCalledTimes(1); const tampered = structuredClone(receipt); tampered.documents[0].updateTime = version; expect(() => writesFor(p, 'undo', tampered)).toThrow(); });
it('기본CLI는 dry이고 모드혼합/임의인자는 허용하지 않는다', () => { expect(parseArgs([])).toBe('--dry'); expect(() => parseArgs(['--apply', '--undo'])).toThrow(); expect(() => parseArgs(['--force'])).toThrow(); });
it('intent 저장이 실패하면 최초 또는 재시도 commit을 보내지 않는다', async () => { const f = fixture(), p = buildPlan(f), s = store(f); await expect(execute(p, s.port, 'apply', () => { throw Error('intent 기존존재/저장불가'); })).rejects.toThrow(); expect(s.commit).not.toHaveBeenCalled(); });
it('intent가 있으면 거래처/계정이 바뀌어도 결과관측만 하고 새쓰기는 검증실패로 막는다', async () => { const f = fixture(), p = buildPlan(f), s = store(f), broken = vi.fn().mockRejectedValue(Error('거래처 삭제/계정 없음')), intent = vi.fn(); const result = await runRepair(p, s.port, 'apply', { existingIntent: { planHash: p.hash, mode: 'apply' }, validateReferences: broken, recordIntent: intent }); expect(result.observationOnly).toBe(true); expect(result.receipt.state).toBe('before'); expect(broken).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(s.commit).not.toHaveBeenCalled(); await expect(runRepair(p, s.port, 'apply', { validateReferences: broken, recordIntent: intent })).rejects.toThrow('거래처'); expect(s.commit).not.toHaveBeenCalled(); });
