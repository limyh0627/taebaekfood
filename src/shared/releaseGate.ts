export function requireActiveReleaseId(gate: Record<string, unknown> | undefined): string {
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string'
    || !/^[A-Za-z0-9_-]{1,100}$/.test(gate.releaseId))
    throw new Error('배포 전환이 활성화되지 않아 저장하지 않았습니다.');
  return gate.releaseId;
}
