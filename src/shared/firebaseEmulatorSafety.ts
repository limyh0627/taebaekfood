/** 테스트 모드가 운영 Firebase로 빠지는 것을 앱 시작 전에 막는다. */
export function assertLocalEmulatorTarget(projectId: string | undefined, host: string): void {
  if (!projectId?.startsWith('demo-')) {
    throw new Error('로컬 테스트 모드는 demo- 프로젝트 ID에서만 실행할 수 있습니다.');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('로컬 테스트 에뮬레이터는 이 컴퓨터에서만 연결할 수 있습니다.');
  }
}
