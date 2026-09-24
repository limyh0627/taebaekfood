import { describe, expect, it } from 'vitest';
import { oemIssueFingerprint, recoverableOemDrafts, runOemIssueJob, type OemIssueDraft, type OemIssueInput, type OemIssuePorts } from './oemIssueJob';

const input = (jobId = 'oem-click-1'): OemIssueInput => ({
  jobId, companyId: 'taebaek', partnerId: 'p-oem', partnerName: '외주공장', date: '2026-09-24',
  sent: [{ material: '참깨', rawItemId: 'raw-sesame', kg: 100 }, { material: '들깨', rawItemId: 'raw-perilla', kg: 50 }],
});

function harness() {
  const drafts = new Map<string, OemIssueDraft>();
  const applied = new Set<string>();
  const effects = new Map<string, number>();
  let failRawAt = -1;
  let failFinalize = false;
  const ports: OemIssuePorts = {
    prepareDraft: async command => {
      const fingerprint = oemIssueFingerprint(command);
      const existing = drafts.get(command.jobId);
      if (existing) {
        if (existing.oemIssueFingerprint !== fingerprint) throw new Error('같은 OEM 작업번호의 회사나 내용이 다릅니다.');
        return existing;
      }
      const draft = {
        id: command.jobId, companyId: command.companyId, poType: 'oem' as const,
        status: 'pending' as const, oemIssueStatus: 'processing' as const,
        oemIssueFingerprint: fingerprint, oemIssueDate: command.date,
        oemSent: command.sent, partnerId: command.partnerId, partnerName: command.partnerName,
        oemPartnerId: command.partnerId, itemId: '', itemName: '', quantity: 0, createdAt: '2026-09-24T00:00:00Z',
      };
      drafts.set(command.jobId, draft);
      return draft;
    },
    runRawSteps: async draft => {
      for (const [index, row] of draft.oemSent.entries()) {
        if (index === failRawAt) throw new Error('원료 단계 실패');
        const operationId = `${draft.id}:${row.rawItemId}`;
        if (!applied.has(operationId)) effects.set(operationId, (effects.get(operationId) ?? 0) + 1);
        applied.add(operationId);
      }
    },
    missingRawSteps: async draft => draft.oemSent.filter(row => !applied.has(`${draft.id}:${row.rawItemId}`)).map(row => row.rawItemId ?? ''),
    finalizeDraft: async draft => {
      if (failFinalize) throw new Error('카드 확정 실패');
      drafts.set(draft.id, { ...draft, status: 'invoiced', oemIssueStatus: 'complete' });
    },
    markFailed: async (draft, message) => {
      drafts.set(draft.id, { ...draft, oemIssueStatus: 'failed', oemIssueError: message });
    },
  };
  return { drafts, applied, effects, ports, failRawAt: (index: number) => { failRawAt = index; }, failFinalize: (value: boolean) => { failFinalize = value; } };
}

describe('OEM 외주발주 재개 계약', () => {
  it('두 번째 원료가 실패해도 같은 jobId 재시도는 첫 원료를 한 번만 반영한다', async () => {
    const h = harness();
    h.failRawAt(1);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('부분 완료');
    expect(h.applied).toEqual(new Set(['oem-click-1:raw-sesame']));
    expect(recoverableOemDrafts([...h.drafts.values()], 'taebaek')).toHaveLength(1);
    h.failRawAt(-1);
    await runOemIssueJob(input(), h.ports);
    expect(h.applied).toEqual(new Set(['oem-click-1:raw-sesame', 'oem-click-1:raw-perilla']));
    expect(h.effects.get('oem-click-1:raw-sesame')).toBe(1);
    expect(h.drafts.get('oem-click-1')).toMatchObject({ status: 'invoiced', oemIssueStatus: 'complete' });
  });

  it('카드 확정 실패 후 재시도해도 원료를 다시 차감하지 않고 카드 한 건만 확정한다', async () => {
    const h = harness();
    h.failFinalize(true);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('카드 확정 실패');
    expect(h.applied.size).toBe(2);
    expect(h.drafts.size).toBe(1);
    h.failFinalize(false);
    await runOemIssueJob(input(), h.ports);
    expect(h.applied.size).toBe(2);
    expect(h.effects.get('oem-click-1:raw-sesame')).toBe(1);
    expect(h.effects.get('oem-click-1:raw-perilla')).toBe(1);
    expect(h.drafts.size).toBe(1);
    expect(h.drafts.get('oem-click-1')?.status).toBe('invoiced');
  });

  it('같은 내용의 별도 클릭은 새 jobId로 별도 발주가 된다', async () => {
    const h = harness();
    await runOemIssueJob(input('oem-click-1'), h.ports);
    await runOemIssueJob(input('oem-click-2'), h.ports);
    expect(h.drafts.size).toBe(2);
    expect(h.applied.size).toBe(4);
  });

  it('같은 jobId의 내용 변경은 원료 명령 전에 거절한다', async () => {
    const h = harness();
    await runOemIssueJob(input(), h.ports);
    const altered = { ...input(), sent: [{ material: '참깨', rawItemId: 'raw-sesame', kg: 101 }] };
    await expect(runOemIssueJob(altered, h.ports)).rejects.toThrow('내용이 다릅니다');
    expect(h.applied.size).toBe(2);
    expect(h.drafts.size).toBe(1);
  });

  it('재접속 후에도 저장된 미완료 초안만 찾아 같은 ID로 재개한다', async () => {
    const h = harness();
    h.failRawAt(0);
    await expect(runOemIssueJob(input(), h.ports)).rejects.toThrow('부분 완료');
    const recoverable = recoverableOemDrafts([...h.drafts.values()], 'taebaek');
    expect(recoverable.map(row => row.id)).toEqual(['oem-click-1']);
    expect(recoverableOemDrafts([...h.drafts.values()], 'punghoe')).toEqual([]);
    h.failRawAt(-1);
    await runOemIssueJob(input(recoverable[0]!.id), h.ports);
    expect(recoverableOemDrafts([...h.drafts.values()], 'taebaek')).toEqual([]);
  });
});
