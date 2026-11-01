import {createHash} from 'node:crypto';

/** 읽기와 경로는 호출자가 소유한다. 검증 실패 시 이후 작업을 진행하지 않는다. */
export function verifyPinnedSourceManifest(manifest: Readonly<Record<string, string>>, read: (path: string) => Uint8Array): void {
  for (const [path, expected] of Object.entries(manifest)) {
    if (createHash('sha256').update(read(path)).digest('hex').toUpperCase() !== expected) throw Error('소스 검증 실패');
  }
}
