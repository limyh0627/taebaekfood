import type { CompanyId } from './types';

/** Storage도 Firestore와 같은 회사 경계를 쓴다. 경로를 화면마다 조립하면 한 군데는 반드시 빠진다. */
export const companyStorageRoot = (companyId: CompanyId) => `companies/${companyId}`;

export const cabinetStoragePath = (
  companyId: CompanyId,
  category: string,
  subCategory: string,
  storedName: string,
) => `${companyStorageRoot(companyId)}/file-cabinet/${category}/${subCategory}/${storedName}`;

export const officeTalkStoragePath = (companyId: CompanyId, roomId: string, storedName: string) =>
  `${companyStorageRoot(companyId)}/officetalk/${roomId}/${storedName}`;

