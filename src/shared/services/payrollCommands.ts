import { companyOf, payrollDocId, type CompanyId, type PayrollLine } from '../types';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../firebase';
export type PayrollCommandInput = {
  yearMonth: string;
  payDate: string;
  lines: PayrollLine[];
  expectedRevision: number;
};
function sameActor(actorUid: string) {
  if (!actorUid || auth.currentUser?.uid !== actorUid) throw new Error('급여 요청 중 로그인 계정이 바뀌었습니다. 현재 계정으로 다시 확인해 주세요.');
}
async function ownCompany(companyId: CompanyId, actorUid: string) {
  sameActor(actorUid);
  await authReady;
  sameActor(actorUid);
  const user = auth.currentUser!;
  const {
    claims
  } = await user.getIdTokenResult();
  sameActor(actorUid);
  if (claims.companyId !== companyId || claims.isAdmin !== true) throw new Error('급여대장의 관리자 회사 권한이 바뀌었습니다.');
}
async function current(companyId: CompanyId, input: PayrollCommandInput, actorUid: string) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('급여대장 원본 버전이 잘못되었습니다.');
  await ownCompany(companyId, actorUid);
  const snap = await getDoc(doc(db, 'payrolls', payrollDocId(companyId, input.yearMonth)));
  sameActor(actorUid);
  const row = snap.data();
  if (row && companyOf(row) !== companyId) throw new Error('급여대장의 회사가 맞지 않습니다.');
  const revision = row?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('급여대장 버전이 잘못되었습니다.');
  return {
    row,
    revision
  };
}
export async function savePayrollDraft(companyId: CompanyId, input: PayrollCommandInput, expectedActorUid?: string) {
  const actorUid = expectedActorUid ?? auth.currentUser?.uid ?? '';
  await current(companyId, input, actorUid);
  await ownCompany(companyId, actorUid);
  const call = httpsCallable<unknown, {
    revision: number;
  }>(functions, 'savePayrollDraftCommand');
  sameActor(actorUid);
  const result = (await call(input)).data;
  await ownCompany(companyId, actorUid);
  if (!result || !Number.isSafeInteger(result.revision) || result.revision !== input.expectedRevision + 1) throw new Error('급여 저장 응답의 원본 버전을 확인하지 못했습니다. 현재 대장을 확인해 주세요.');
  return result;
}
/** 월별 작업 ID는 서버가 고정한다. 응답 유실 뒤에는 발행 당시 버전으로 같은 전표를 확인한다. */
export async function issuePayrollVoucher(companyId: CompanyId, input: PayrollCommandInput, mode: 'cash' | 'accrual', cashAccountId?: string, expectedActorUid?: string) {
  const actorUid = expectedActorUid ?? auth.currentUser?.uid ?? '';
  const {
    row
  } = await current(companyId, input, actorUid);
  await ownCompany(companyId, actorUid);
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  sameActor(actorUid);
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') throw new Error('급여 발행 서버가 준비되지 않았습니다.');
  const expectedRevision = row?.issueOperationId ? row.issueExpectedRevision : input.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('기존 급여 발행 버전을 확인해야 합니다.');
  const selectedBank = row?.issueOperationId ? row.issueCashAccountId : cashAccountId;
  await ownCompany(companyId, actorUid);
  const call = httpsCallable<unknown, {
    id: string;
    docNo: string;
    kind: 'cashEntries' | 'issuedStatements';
  }>(functions, 'issuePayrollVoucherCommand');
  sameActor(actorUid);
  const result = (await call({
    ...input,
    mode,
    expectedRevision,
    releaseId: gate.releaseId,
    ...(selectedBank ? {
      cashAccountId: selectedBank
    } : {})
  })).data;
  await ownCompany(companyId, actorUid);
  if (!result || typeof result.id !== 'string' || typeof result.docNo !== 'string' || !['cashEntries', 'issuedStatements'].includes(result.kind)) throw new Error('급여 전표 응답을 확인하지 못했습니다. 현재 대장과 전표를 확인해 주세요.');
  return result;
}
