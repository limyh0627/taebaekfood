import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../shared/firebase';
import type { CashEntry, CompanyId, PayrollLine } from '../../shared/types';
type Patch = Pick<Partial<CashEntry>, 'amount' | 'date' | 'dir' | 'accountCode' | 'lines' | 'note' | 'partnerId' | 'partnerName'>;
export type PayrollCashEdit = { yearMonth: string; payDate: string; lines: PayrollLine[]; expectedRevision: number };
export type TransferCashEdit = { counterpartId: string; expectedRevision: number; expectedCashHash: string; patch?: Patch };
export type PreparedTransferCashEdit = { counterpart: CashEntry; expectedRevision: number; expectedCashHash: string };

/** Read once when opening the editor; the returned revision is retained with that draft. */
export async function loadPayrollCashEdit(companyId: CompanyId, original: CashEntry): Promise<PayrollCashEdit> {
  const payrollId = (original as CashEntry & { payrollId?: string }).payrollId;
  if (!payrollId || payrollId.includes('/') || (original.companyId ?? 'taebaek') !== companyId) throw new Error('급여 원전표를 확인해주세요.');
  await authReady;
  const user = auth.currentUser;
  const claims = (await user?.getIdTokenResult())?.claims;
  if (!user || claims?.companyId !== companyId || claims.isAdmin !== true) throw new Error('관리자 회사 권한이 필요합니다.');
  const row = (await getDoc(doc(db, 'payrolls', payrollId))).data();
  if (!row || (row.companyId ?? 'taebaek') !== companyId || row.cashEntryId !== original.id
    || row.issueKind !== 'cashEntries' || row.issueCancelled || !Array.isArray(row.lines)
    || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('급여대장과 현금 원전표 연결을 확인해주세요.');
  const latest = (await user.getIdTokenResult()).claims;
  if (auth.currentUser?.uid !== user.uid || latest.companyId !== companyId || latest.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  return { yearMonth: row.yearMonth, payDate: row.payDate, lines: row.lines, expectedRevision: row.revision };
}
type Command = { operationId: string; cashEntryId: string; action: 'edit' | 'delete'; expectedRevision: number;
  expectedCashHash: string; releaseId: string; patch?: Patch; payrollEdit?: PayrollCashEdit; transferEdit?: TransferCashEdit };
type Result = { status: 'applied' | 'duplicate'; id: string; action: 'edit' | 'delete'; revision: number; docNo: string };
const running = new Set<string>();
export function hasPendingCashMutation(companyId: CompanyId, cashEntryId: string): boolean {
  try { return !!auth.currentUser?.uid && localStorage.getItem(`cash-mutation-pending:${companyId}:${cashEntryId}:${auth.currentUser.uid}`) !== null; }
  catch { return false; }
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value.toMillis === 'function') return { timestampMillis: value.toMillis() };
  if (value instanceof Date) return { dateISO: value.toISOString() };
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
async function hash(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Captures the UI original; never fetches a newer cash revision to approve a stale draft. */
export async function mutateCash(companyId: CompanyId, original: CashEntry, action: 'edit' | 'delete', patch?: Patch, payrollEdit?: PayrollCashEdit, transferEdit?: TransferCashEdit): Promise<Result> {
  if ((original.companyId ?? 'taebaek') !== companyId || !/^[A-Za-z0-9_-]{1,160}$/.test(original.id)
    || !['edit', 'delete'].includes(action) || (action === 'edit' ? !patch : patch !== undefined)) throw new Error('자금전표 변경 입력을 확인해주세요.');
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const key = `cash-mutation-pending:${companyId}:${original.id}:${user.uid}`;
  if (running.has(key)) throw new Error('이 자금전표를 변경 중입니다.');
  running.add(key);
  try {
    const { id, ...body } = original;
    const expectedCashHash = await hash(body);
    const intent = JSON.stringify(canonical({ action, cashEntryId: id, expectedCashHash, patch, payrollEdit, transferEdit }));
    const saved = localStorage.getItem(key);
    let pending: { intent: string; command: Command } | undefined;
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('저장된 자금 변경 요청을 확인해야 합니다.'); }
      const command = pending?.command;
      if (pending?.intent !== intent || !command || command.cashEntryId !== id || command.action !== action
        || command.expectedCashHash !== expectedCashHash || !/^[A-Za-z0-9_-]{1,160}$/.test(command.operationId)
        || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0
        || command.expectedRevision !== ((original as CashEntry & { mutationRevision?: number }).mutationRevision ?? 0)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(command.releaseId)
        || JSON.stringify(canonical(command.patch)) !== JSON.stringify(canonical(patch))
        || JSON.stringify(canonical(command.payrollEdit)) !== JSON.stringify(canonical(payrollEdit))
        || JSON.stringify(canonical(command.transferEdit)) !== JSON.stringify(canonical(transferEdit))) throw new Error('이전 변경 결과가 불확실합니다. 같은 입력으로 재시도해주세요.');
    }
    if (!pending) {
      const release = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release.releaseId ?? '')) throw new Error('자금 변경 서버가 준비되지 않았습니다.');
      const revision = (original as CashEntry & { mutationRevision?: number }).mutationRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('원전표 revision을 확인해주세요.');
      pending = { intent, command: { operationId: `cash-mutation-${crypto.randomUUID()}`, cashEntryId: id, action,
        expectedRevision: revision, expectedCashHash, releaseId: release.releaseId, ...(patch ? { patch } : {}), ...(payrollEdit ? { payrollEdit } : {}), ...(transferEdit ? { transferEdit } : {}) } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const { data } = await httpsCallable<Command, Result>(functions, 'cashMutationCommand')(pending.command);
    if (!['applied', 'duplicate'].includes(data?.status) || data.id !== id || data.action !== action
      || data.revision !== pending.command.expectedRevision + 1 || typeof data.docNo !== 'string') throw new Error('변경 응답이 불확실합니다. 같은 요청으로 재시도해주세요.');
    localStorage.removeItem(key);
    return data;
  } finally { running.delete(key); }
}

/** Only the server may authorize and read the other-company cash snapshot. */
export async function prepareTransferCash(companyId: CompanyId, original: CashEntry) {
  if ((original.companyId ?? 'taebaek') !== companyId || !/^[A-Za-z0-9_-]{1,160}$/.test(original.id)) throw new Error('현재 회사 원전표를 확인해주세요.');
  await authReady;
  const user = auth.currentUser;
  const token = await user?.getIdTokenResult();
  if (!user || token?.claims.companyId !== companyId || token.claims.isAdmin !== true) throw new Error('관리자 회사 권한이 필요합니다.');
  const { id, ...body } = original;
  const expectedCashHash = await hash(body);
  const release = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release.releaseId ?? '')) throw new Error('회사이체 조회 서버가 준비되지 않았습니다.');
  const latest = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== user.uid || latest.claims.companyId !== companyId || latest.claims.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  const { data } = await httpsCallable<{ cashEntryId: string; expectedCashHash: string; releaseId: string },
    PreparedTransferCashEdit>(functions, 'prepareTransferCashEditCommand')({ cashEntryId: id, expectedCashHash, releaseId: release.releaseId });
  if (!data?.counterpart?.id || data.counterpart.companyId === companyId || !['taebaek', 'punghoe'].includes(data.counterpart.companyId ?? '')
    || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 || !/^[a-f0-9]{64}$/.test(data.expectedCashHash)) throw new Error('회사이체 조회 응답을 확인해주세요.');
  const after = (await user.getIdTokenResult()).claims;
  if (auth.currentUser?.uid !== user.uid || after.companyId !== companyId || after.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  return data;
}
/** Confirms the exact old request, even if a successful but lost response changed the live snapshot. */
export async function resumeCashMutation(companyId: CompanyId, cashEntryId: string): Promise<Result> {
  await authReady;
  const user = auth.currentUser;
  const assertCompany = async () => {
    const claims = (await user?.getIdTokenResult())?.claims;
    if (!user || auth.currentUser?.uid !== user.uid || claims?.companyId !== companyId || claims.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const key = `cash-mutation-pending:${companyId}:${cashEntryId}:${user!.uid}`;
  if (running.has(key)) throw new Error('이 자금전표를 변경 중입니다.');
  running.add(key);
  try {
    const saved = localStorage.getItem(key);
    let pending: { intent: string; command: Command };
    try { pending = JSON.parse(saved ?? 'null'); } catch { throw new Error('저장된 자금 변경 요청을 확인해야 합니다.'); }
    const command = pending?.command;
    if (!command || command.cashEntryId !== cashEntryId || !['edit', 'delete'].includes(command.action)
      || !/^[A-Za-z0-9_-]{1,160}$/.test(command.operationId) || !/^[a-f0-9]{64}$/.test(command.expectedCashHash)
      || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0
      || !/^[A-Za-z0-9_-]{1,100}$/.test(command.releaseId)
      || (command.action === 'edit' ? !command.patch : command.patch !== undefined)
      || pending.intent !== JSON.stringify(canonical({ action: command.action, cashEntryId,
        expectedCashHash: command.expectedCashHash, patch: command.patch, payrollEdit: command.payrollEdit, transferEdit: command.transferEdit }))) throw new Error('저장된 자금 변경 요청을 확인해야 합니다.');
    await assertCompany();
    const { data } = await httpsCallable<Command, Result>(functions, 'cashMutationCommand')(command);
    if (!['applied', 'duplicate'].includes(data?.status) || data.id !== cashEntryId || data.action !== command.action
      || data.revision !== command.expectedRevision + 1 || typeof data.docNo !== 'string') throw new Error('변경 응답이 불확실합니다. 같은 요청으로 재시도해주세요.');
    if (localStorage.getItem(key) === saved) localStorage.removeItem(key);
    return data;
  } finally { running.delete(key); }
}

/** Separately confirmed FIFO matching reuses the existing atomic manual-allocation command. */
export async function matchCashAllocations(companyId: CompanyId, entry: CashEntry, allocations: { statementId: string; amount: number }[]) {
  if ((entry.companyId ?? 'taebaek') !== companyId || !entry.partnerId || !allocations.length
    || allocations.some(row => !row.statementId || !Number.isSafeInteger(row.amount) || row.amount <= 0)) throw new Error('매칭할 자금과 전표를 확인해주세요.');
  await authReady;
  const user = auth.currentUser;
  const assertCompany = async () => {
    const claims = (await user?.getIdTokenResult())?.claims;
    if (!user || auth.currentUser?.uid !== user.uid || claims?.companyId !== companyId || claims.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const business = { cashEntryId: entry.id, partnerId: entry.partnerId, allocations: [...allocations].sort((a, b) => a.statementId.localeCompare(b.statementId)) };
  const intent = JSON.stringify(canonical(business));
  const key = `cash-match-pending:${companyId}:${user!.uid}:${entry.id}`;
  if (running.has(key)) throw new Error('이 자금전표의 매칭을 처리 중입니다.');
  running.add(key);
  try {
    const saved = localStorage.getItem(key);
    let pending: { intent: string; request: typeof business & { operationId: string; releaseId: string; expectedPartnerRevision: number } } | undefined;
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('저장된 매칭 요청을 확인해야 합니다.'); }
      const request = pending?.request;
      if (!request || pending?.intent !== intent || !/^[A-Za-z0-9_-]{1,120}$/.test(request.operationId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId) || !Number.isSafeInteger(request.expectedPartnerRevision) || request.expectedPartnerRevision < 0
        || JSON.stringify(canonical(request)) !== JSON.stringify(canonical({ ...business, operationId: request.operationId,
          releaseId: request.releaseId, expectedPartnerRevision: request.expectedPartnerRevision }))) throw new Error('이전 매칭 결과가 불확실합니다. 같은 입력으로 재시도해주세요.');
    }
    if (!pending) {
      const [releaseDoc, stateDoc] = await Promise.all([getDoc(doc(db, 'appMeta', 'releaseCutover')),
        getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${entry.partnerId}`))]);
      const release = releaseDoc.data(), state = stateDoc.data(), revision = state?.revision ?? 0;
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release.releaseId ?? '')
        || !Number.isSafeInteger(revision) || revision < 0 || state && (state.companyId !== companyId || state.partnerId !== entry.partnerId)) throw new Error('거래처 매칭 상태를 확인해주세요.');
      pending = { intent, request: { ...business, operationId: `cash-match-${crypto.randomUUID()}`, releaseId: release.releaseId, expectedPartnerRevision: revision } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const { data } = await httpsCallable<typeof pending.request, { status: string; revision: number }>(functions, 'replaceManualSettlementBatchCommand')(pending.request);
    if (!['applied', 'duplicate'].includes(data?.status) || data.revision !== pending.request.expectedPartnerRevision + 1) throw new Error('매칭 응답이 불확실합니다. 같은 요청으로 재시도해주세요.');
    localStorage.removeItem(key);
    return data;
  } finally { running.delete(key); }
}
