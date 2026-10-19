import { deleteField } from 'firebase/firestore';
import { auth, authReady } from '../../../shared/firebase';
import { withClaimCompany } from '../../../shared/companyWriteBoundary';
import { updateItem } from '../../../shared/services/firebaseService';
import type { AccountCode, AccountGroup, CompanyId } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';

export interface AccountEditContext {
  companyId: CompanyId;
  actorUid: string;
  isCurrent: () => boolean;
}
export type AccountGroupEditPatch = Partial<Pick<AccountGroup, 'name' | 'type'>> & {
  plLine?: AccountGroup['plLine'] | null;
};
export type AccountCodeEditPatch = Partial<Pick<AccountCode, 'code' | 'name' | 'groupId'>>;

async function saveEdit(
  collection: 'accountGroups' | 'accountCodes', id: string,
  patch: Record<string, unknown>, context: AccountEditContext,
): Promise<SaveOutcome> {
  const assertCurrent = () => {
    if (!context.isCurrent() || !context.actorUid || auth.currentUser?.uid !== context.actorUid) {
      throw new Error('로그인 또는 회사가 바뀌어 저장하지 않았습니다. 창을 다시 열어 주세요.');
    }
  };
  try {
    if (!id || id.includes('/')) throw new Error('수정할 계정을 확인할 수 없어 저장하지 않았습니다.');
    assertCurrent();
    await authReady;
    assertCurrent();
    const token = await auth.currentUser!.getIdTokenResult();
    assertCurrent();
    withClaimCompany(collection, { companyId: context.companyId }, { companyId: token.claims.companyId });
  } catch (error) {
    return { status: 'rejected', message: error instanceof Error ? error.message : '로그인 정보를 확인해 주세요.' };
  }
  if (Object.keys(patch).length === 0) return { status: 'saved' };
  try {
    assertCurrent();
  } catch (error) {
    return { status: 'rejected', message: error instanceof Error ? error.message : '현재 창을 다시 열어 주세요.' };
  }
  try {
    await updateItem(collection, id, patch);
    return { status: 'saved' };
  } catch {
    // 공통 writer 내부 await 이후의 실패는 실제 반영 여부를 추측하지 않는다.
    return { status: 'unknown', message: '계정 저장 여부를 확인하지 못했습니다.',
      nextAction: '현재 목록을 확인해 주세요. 다시 저장하면 수정한 항목이 입력한 값으로 저장됩니다.' };
  }
}

export function saveAccountGroupEdit(id: string, changes: AccountGroupEditPatch, context: AccountEditContext): Promise<SaveOutcome> {
  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'type', 'plLine'] as const) {
    const value = changes[key];
    if (value !== undefined) patch[key] = key === 'plLine' && value === null ? deleteField() : value;
  }
  return saveEdit('accountGroups', id, patch, context);
}

export function saveAccountCodeEdit(id: string, changes: AccountCodeEditPatch, context: AccountEditContext): Promise<SaveOutcome> {
  const patch: Record<string, unknown> = {};
  for (const key of ['code', 'name', 'groupId'] as const) {
    if (changes[key] !== undefined) patch[key] = changes[key];
  }
  return saveEdit('accountCodes', id, patch, context);
}
