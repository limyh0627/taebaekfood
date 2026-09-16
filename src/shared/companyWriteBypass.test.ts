import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'components'];
const allowed = new Set([
  'src/shared/services/firebaseService.ts',
]);
const reviewedTransactionWriters = new Set([
  // appMeta 전 기기 잠금(회사 메타 예외)만 쓴다.
  'src/features/admin/AdminApp.tsx',
  // 쓰기 전 companyScopedWriteData를 통과한 배열만 트랜잭션에 넣는다.
  'src/features/statements/infrastructure/applyStatementWrites.ts',
  'src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts',
  // 명령/상태 계약 자체에 companyId가 있고 서로 다르면 트랜잭션 전에 거부한다.
  'src/shared/services/rawInventoryJob.ts',
  'src/shared/services/rawInventoryService.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('회사 쓰기 공통 경계 우회 방지', () => {
  it('화면 코드는 Firestore 생성·set·batch API를 직접 가져오지 않는다', () => {
    const offenders = roots.flatMap(sourceFiles).filter(path => {
      if (allowed.has(path)) return false;
      const source = readFileSync(path, 'utf8');
      const firestoreImports = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]firebase\/firestore['"]/g)]
        .map(match => match[1]);
      const staticBypass = firestoreImports.some(names => /\b(addDoc|setDoc|writeBatch)\b/.test(names));
      const dynamicBypass = /import\(['"]firebase\/firestore['"]\)[\s\S]{0,300}\b(addDoc|setDoc|writeBatch)\b/.test(source);
      const transactionBypass = /\b(?:tx|transaction)\.set\s*\(/.test(source)
        && !reviewedTransactionWriters.has(path);
      return staticBypass || dynamicBypass || transactionBypass;
    });

    expect(offenders, '신규 업무문서는 firebaseService의 회사 경계를 통과해야 합니다').toEqual([]);
  });
});
