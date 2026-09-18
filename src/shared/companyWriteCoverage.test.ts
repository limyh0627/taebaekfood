import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(process.cwd(), 'src');
const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
});

describe('회사값 누락 쓰기 정적 감사', () => {
  it('업무 화면은 Firestore 생성 API를 직접 부르지 않고 회사 경계 서비스를 통한다', () => {
    const allowed = new Set(['shared/services/firebaseService.ts']);
    const violations = sourceFiles(root).flatMap(path => {
      const rel = relative(root, path).replaceAll('\\', '/');
      if (allowed.has(rel)) return [];
      const text = readFileSync(path, 'utf8');
      const directImport = /import\s*\{[^}]*\b(?:addDoc|setDoc)\b[^}]*\}\s*from\s*['\"]firebase\/firestore['\"]/.test(text);
      const dynamicImport = /(?:addDoc|setDoc)\s*[:}]\s*.*import\(['\"]firebase\/firestore['\"]\)/s.test(text);
      return directImport || dynamicImport ? [rel] : [];
    });
    expect(violations).toEqual([]);
  });
});
