import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';

const 에뮬레이터실행중 = async () => {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) return true;
  try {
    const response = await fetch('http://127.0.0.1:9199/', { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
};

const 준비됨 = await 에뮬레이터실행중();
let env: RulesTestEnvironment;
const bytes = new Uint8Array([1, 2, 3]);

describe.skipIf(!준비됨)('회사별 권한 (Storage 규칙)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-storage-rules-test',
      storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  const 직원 = (companyId: string) => env.authenticatedContext(`staff-${companyId}`, {
    employeeId: `staff-${companyId}`, companyId, isAdmin: false,
  }).storage();
  const 관리자 = (companyId: string) => env.authenticatedContext(`admin-${companyId}`, {
    employeeId: `admin-${companyId}`, companyId, isAdmin: true,
  }).storage();

  it('직원은 자기 회사 오피스톡에만 올린다', async () => {
    await assertSucceeds(uploadBytes(ref(직원('taebaek'), 'companies/taebaek/officetalk/ROOM-1/a.jpg'), bytes));
    await assertFails(uploadBytes(ref(직원('taebaek'), 'companies/punghoe/officetalk/ROOM-1/a.jpg'), bytes));
  });

  it('문서함은 같은 회사 관리자만 올린다', async () => {
    await assertSucceeds(uploadBytes(ref(관리자('punghoe'), 'companies/punghoe/file-cabinet/업무/일반/a.pdf'), bytes));
    await assertFails(uploadBytes(ref(직원('punghoe'), 'companies/punghoe/file-cabinet/업무/일반/b.pdf'), bytes));
    await assertFails(uploadBytes(ref(관리자('taebaek'), 'companies/punghoe/file-cabinet/업무/일반/c.pdf'), bytes));
  });

  it('미인증·claim 없는 계정과 옛 경로를 거절한다', async () => {
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'companies/taebaek/officetalk/R/a.jpg'), bytes));
    await assertFails(uploadBytes(ref(env.authenticatedContext('old-anon', {}).storage(), 'companies/taebaek/officetalk/R/b.jpg'), bytes));
    await assertFails(uploadBytes(ref(관리자('taebaek'), 'file-cabinet/업무/일반/old.pdf'), bytes));
    await assertFails(uploadBytes(ref(직원('taebaek'), 'officetalk/ROOM-1/old.jpg'), bytes));
  });
});
