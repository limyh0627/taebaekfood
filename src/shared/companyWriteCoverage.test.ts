import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

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
      if(rel==='shared/services/orgChartService.ts'){
        expect(text).toContain("withClaimCompany('settings', payload, { companyId: token.claims.companyId })");
        expect(text).toContain('const token = await actor.ready()');expect(text).toContain('await setDoc(ref, data, { merge: true })');
        expect(text).toContain("companySettingDocId(scope.companyId, 'orgChart')");
        const ast=ts.createSourceFile(rel,text,ts.ScriptTarget.Latest,true),calls:ts.CallExpression[]=[];
        const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&['addDoc','setDoc'].includes(node.expression.getText(ast)))calls.push(node);ts.forEachChild(node,visit);};visit(ast);
        expect(calls).toHaveLength(1);expect(calls[0].getText(ast)).toBe('setDoc(ref, data, { merge: true })');
        let parent:ts.Node|undefined=calls[0];while(parent&&!ts.isFunctionDeclaration(parent))parent=parent.parent;
        expect((parent as ts.FunctionDeclaration | undefined)?.name?.text).toBe('saveOrgChart');
        return [];
      }
      const directImport = /import\s*\{[^}]*\b(?:addDoc|setDoc)\b[^}]*\}\s*from\s*['\"]firebase\/firestore['\"]/.test(text);
      const dynamicImport = /(?:addDoc|setDoc)\s*[:}]\s*.*import\(['\"]firebase\/firestore['\"]\)/s.test(text);
      return directImport || dynamicImport ? [rel] : [];
    });
    expect(violations).toEqual([]);
  });
});
