import { join } from 'node:path';

/** PC를 옮겨도 환경변수 지정과 기본 인증 탐색 순서는 바꾸지 않는다. */
export async function adminCredentialPath(envPath: string | undefined, home: string, exists: (path: string) => Promise<boolean>): Promise<string | undefined> {
  if (envPath) return envPath;
  const defaultPath = join(home, '.secrets', 'taebaek-admin.json');
  return await exists(defaultPath) ? defaultPath : undefined;
}
