import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';
const cli = 'scripts/fix-spec-loose-bulk.mts';
const source = readFileSync(cli, 'utf8');
it.each([[], ['--dry'], ['--help'], ['--apply'], ['--undo'], ['--unknown']].map(args => ({ args })))('폐기 CLI $args 는 원격 작업 없이 즉시 종료하고 실제 읽기 경로를 안내한다', ({ args }) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(args.includes('--apply') || args.includes('--undo') || args.includes('--unknown') ? 1 : 0);
  const text = result.stdout + result.stderr;
  expect(text).toContain('옛 낱개·벌크 규격 일괄 보정·복원 명령은 폐기');
  expect(text).toContain('docs/deprecated-field-audit-20261006.md');
  if (args.includes('--apply') || args.includes('--undo')) expect(text).toContain('쓰기 요청을 거절');
  expect(text).not.toContain('apiKey');
});
it('원격 접속·동적 코드 실행이 없는 안내 전용 실제 소비 경로다', () => {
  const ast = ts.createSourceFile(cli, source, ts.ScriptTarget.Latest, true);
  const calls: string[] = []; const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) imports.push(node.getText(ast));
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
    expect(ts.isNewExpression(node)).toBe(false);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(imports).toEqual([]);
  expect(calls.every(call => ['process.argv.slice', 'console.error', 'args.includes', 'args.some'].includes(call))).toBe(true);
  expect(source).toContain('현재 규격 관리 UI·BOM·item_pack과 과거 백업·기록은 보존');
  expect(source).toContain('scripts/fix-spec-loose-bulk-backup.json');
  expect(source).toContain('DB-CHANGELOG.md');
});
