import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : [];
});
const files = ['src', 'components', 'functions/src'].flatMap(dir => walk(join(root, dir)));
const fileNames = new Set(files.map(file => file.replaceAll('\\', '/').toLowerCase()));
const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(files, parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(join(root, 'src/shared/types.ts'));
const fields = [];
const byDeclaration = new Map();
const location = node => {
  const file = node.getSourceFile();
  return `${relative(root, file.fileName).replaceAll('\\', '/')}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};
for (const statement of source.statements) {
  if (!ts.isInterfaceDeclaration(statement)) continue;
  for (const member of statement.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const field = { model: statement.name.text, field: member.name.getText(source),
      optional: !!member.questionToken, type: member.type?.getText(source) ?? 'unknown',
      declaration: location(member), references: [] };
    fields.push(field);
    byDeclaration.set(member, field);
  }
}
let unresolvedAccesses = 0;
for (const file of program.getSourceFiles()) {
  if (!fileNames.has(file.fileName.replaceAll('\\', '/').toLowerCase())) continue;
  const visit = node => {
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (!symbol) unresolvedAccesses++;
      for (const declaration of symbol?.declarations ?? []) {
        const field = byDeclaration.get(declaration);
        if (field) field.references.push(location(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
for (const field of fields) field.references = [...new Set(field.references)].sort();
const collections = [...readFileSync('src/shared/collections.ts', 'utf8').matchAll(/^\s+(\w+): '([^']+)',/gm)]
  .map(([, key, collection]) => ({ key, collection }));
const report = { generatedAt: new Date().toISOString(), sourceFiles: files.length, unresolvedAccesses,
  scope: 'shared/types.ts direct interface properties; statically resolved property accesses only; no DB schema or zero-use deletion proof',
  collections, fields };
writeFileSync('docs/field-dictionary.generated.json', JSON.stringify(report, null, 2));
const rows = fields.map(field => `| ${field.model} | ${field.field} | ${field.optional ? '선택' : '필수'} | ${field.type.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${field.declaration} | ${field.references.length} |`);
writeFileSync('docs/field-dictionary.generated.md', [
  '# 현재 코드 필드 사전', '',
  `COL ${collections.length}개, 선언 필드 ${fields.length}개, 운영 소스 ${files.length}개를 분석했다.`, '',
  'TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다.', '',
  '| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |',
  '| --- | --- | --- | --- | --- | --- |', ...rows, '',
].join('\n'));
console.log(JSON.stringify({ collections: collections.length, fields: fields.length, sourceFiles: files.length,
  fieldsWithReferences: fields.filter(field => field.references.length).length, unresolvedAccesses }));
