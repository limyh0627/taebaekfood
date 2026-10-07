import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

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
const unresolvedPropertyAccesses = [];
for (const file of program.getSourceFiles()) {
  if (!fileNames.has(file.fileName.replaceAll('\\', '/').toLowerCase())) continue;
  const visit = node => {
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (!symbol) {
        unresolvedAccesses++;
        const receiver = checker.getTypeAtLocation(node.expression);
        unresolvedPropertyAccesses.push({ location: location(node), expression: node.getText(),
          receiverExpression: node.expression.getText(), receiverType: checker.typeToString(receiver),
          reason: receiver.flags & ts.TypeFlags.Any ? 'any-receiver'
            : receiver.flags & ts.TypeFlags.Unknown ? 'unknown-receiver' : 'property-symbol-unresolved' });
      }
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
const registry = new Set(collections.map(entry => entry.collection));
const additionalModels = [];
const pathCalls = [];
const candidateCalls = [];
const apiNames = new Set(['collection', 'doc', 'collectionGroup']);
// ponytail: 별칭의 선언과 직접 호출만 추적한다. 함수 반환·런타임 분기는 미해석으로 남긴다.
const initializer = node => {
  const symbol = checker.getSymbolAtLocation(node);
  const declaration = symbol?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
};
const importedApi = node => {
  const symbol = checker.getSymbolAtLocation(node);
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isImportSpecifier(declaration)) {
      const module = declaration.parent.parent.parent.moduleSpecifier;
      const name = declaration.propertyName?.text ?? declaration.name.text;
      if (module?.text === 'firebase/firestore' && apiNames.has(name)) return name;
    }
    if (ts.isBindingElement(declaration)) {
      const variable = declaration.parent.parent;
      const expression = variable.initializer;
      const call = expression && ts.isAwaitExpression(expression) ? expression.expression : expression;
      const name = declaration.propertyName?.getText() ?? declaration.name.getText();
      if (call && ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword
        && call.arguments[0]?.text === 'firebase/firestore' && apiNames.has(name)) return name;
    }
  }
};
const api = node => {
  if (!ts.isCallExpression(node)) return undefined;
  if (ts.isIdentifier(node.expression)) {
    const name = importedApi(node.expression);
    return name ? { name, style: 'modular', evidence: 'firebase/firestore import' } : undefined;
  }
  if (!ts.isPropertyAccessExpression(node.expression) || !apiNames.has(node.expression.name.text)) return undefined;
  const symbol = checker.getSymbolAtLocation(node.expression.name);
  const evidence = symbol?.declarations?.some(declaration => /[\\/](@google-cloud[\\/]firestore|firebase-admin|@firebase[\\/]firestore)[\\/]/.test(declaration.getSourceFile().fileName));
  const type = checker.typeToString(checker.getTypeAtLocation(node.expression.expression));
  if (evidence || /\b(Firestore|CollectionReference|DocumentReference)\b/.test(type))
    return { name: node.expression.name.text, style: 'method', evidence: evidence ? 'Firestore SDK declaration' : `receiver type: ${type}` };
};
const literalParts = (node, seen = new Set()) => {
  if (!node) return [{ expression: '<auto-id>', kind: 'dynamic' }];
  if (ts.isStringLiteralLike(node)) return node.text.split('/').map(value => ({ value, kind: 'literal' }));
  if (ts.isParenthesizedExpression(node)) return literalParts(node.expression, seen);
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'COL') {
    const symbol = checker.getSymbolAtLocation(node.name);
    const declaration = symbol?.valueDeclaration;
    if (declaration && ts.isPropertyAssignment(declaration)
      && declaration.getSourceFile().fileName.replaceAll('\\', '/').endsWith('/src/shared/collections.ts'))
      return literalParts(declaration.initializer, seen).map(part => ({ ...part, kind: 'COL', key: node.name.text }));
  }
  if (ts.isIdentifier(node) && !seen.has(node)) {
    const value = initializer(node);
    if (value) return literalParts(value, new Set([...seen, node]));
  }
  return [{ expression: node.getText(), kind: 'dynamic' }];
};
const referencePath = (node, seen = new Set()) => {
  if (!node || seen.has(node)) return { segments: [], context: 'unresolved-parent' };
  const nextSeen = new Set([...seen, node]);
  if (ts.isParenthesizedExpression(node)) return referencePath(node.expression, nextSeen);
  if (ts.isIdentifier(node)) {
    const value = initializer(node);
    if (value) {
      const resolved = referencePath(value, nextSeen);
      if (resolved.context !== 'unresolved-parent') return resolved;
    }
  }
  const type = checker.typeToString(checker.getTypeAtLocation(node));
  if (/\bFirestore\b/.test(type)) return { segments: [], context: 'root' };
  const callApi = api(node);
  if (!callApi) return { segments: [], context: 'unresolved-parent', parentExpression: node.getText(), parentType: type };
  const parent = callApi.style === 'modular' ? node.arguments[0] : node.expression.expression;
  const args = callApi.style === 'modular' ? [...node.arguments].slice(1) : [...node.arguments];
  if (callApi.name === 'collectionGroup') return { segments: args.flatMap(arg => literalParts(arg)), context: 'collection-group' };
  const base = referencePath(parent, nextSeen);
  const parts = args.length ? args.flatMap(arg => literalParts(arg)) : literalParts(undefined);
  return { ...base, segments: [...base.segments, ...parts] };
};
const label = parts => parts.map(part => part.value ?? `{${part.expression}}`).join('/');
const dynamicWrappers = new Map();
// 익명 callback은 넘기고 SDK 호출을 소유한 가장 가까운 명명 함수를 찾는다.
const namedOwner = node => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return { node: parent, name: parent.name.text };
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent))
      && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name))
      return { node: parent, name: parent.parent.name.text };
  }
};
for (const file of program.getSourceFiles()) {
  if (!fileNames.has(file.fileName.replaceAll('\\', '/').toLowerCase())) continue;
  const visit = node => {
    if (file !== source && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
      const members = ts.isInterfaceDeclaration(node) ? node.members : ts.isTypeLiteralNode(node.type) ? node.type.members : undefined;
      additionalModels.push({ model: node.name.text, declaration: location(node), kind: ts.isInterfaceDeclaration(node) ? 'interface' : 'type-alias',
        scope: members ? 'direct-properties-only' : 'non-object-alias-not-expanded',
        fields: members ? members.filter(ts.isPropertySignature).map(member => ({ field: member.name.getText(), optional: !!member.questionToken,
          type: member.type?.getText() ?? 'unknown', declaration: location(member) })) : [],
        ...(members ? {} : { type: node.type.getText() }) });
    }
    const callApi = api(node);
    if (callApi) {
      const resolved = referencePath(node);
      const collectionSegments = resolved.context === 'collection-group' ? resolved.segments
        : resolved.context === 'root' ? resolved.segments.filter((_, index) => index % 2 === 0
          && !resolved.segments.slice(0, index).some(part => part.kind === 'dynamic')) : [];
      const unresolved = resolved.context === 'unresolved-parent' || resolved.segments.some(part => part.kind === 'dynamic');
      const dynamicCollection = resolved.segments[0]?.kind === 'dynamic';
      const owner = dynamicCollection ? namedOwner(node) : undefined;
      if (owner) {
        if (!dynamicWrappers.has(owner.node)) dynamicWrappers.set(owner.node, {
          name: owner.name, declaration: location(owner.node), sdkLocations: [], callers: [],
          parameters: owner.node.parameters.map(parameter => parameter.name.getText()),
        });
        dynamicWrappers.get(owner.node).sdkLocations.push(location(node));
      }
      pathCalls.push({ location: location(node), runtime: file.fileName.replaceAll('\\', '/').includes('/functions/src/') ? 'server' : 'client',
        api: callApi.name, style: callApi.style, evidence: callApi.evidence, expression: node.getText(),
        path: label(resolved.segments), ...resolved,
        pathKind: resolved.context === 'root' ? (resolved.segments.length > 2 ? 'subcollection' : 'top-level') + (unresolved ? '-candidate' : '') : resolved.context,
        depth: resolved.context === 'root' && !unresolved ? Math.ceil(resolved.segments.length / 2) : null,
        argumentDepthCandidate: resolved.context === 'root' ? Math.ceil(resolved.segments.length / 2) : null,
        outsideRegistry: collectionSegments.filter(part => part.value !== undefined && !registry.has(part.value)).map(part => part.value),
        unresolved, resolutionKind: resolved.context === 'unresolved-parent' ? 'unresolved-parent'
          : dynamicCollection ? 'dynamic-collection'
            : unresolved ? 'known-collection-dynamic-document' : 'static-path',
        ...(owner ? { wrapper: owner.name, wrapperDeclaration: location(owner.node) } : {}) });
    } else if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      if (apiNames.has(name)) candidateCalls.push({ location: location(node), expression: node.getText(),
        reason: 'collection/doc 이름만 일치. Firestore SDK 근거가 없어 집계 밖 후보' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
// 타입 검사기가 실제 선언으로 연결한 호출만 기록한다. 런타임 값으로 확대하지 않는다.
for (const file of program.getSourceFiles()) {
  if (!fileNames.has(file.fileName.replaceAll('\\', '/').toLowerCase())) continue;
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const wrapper = dynamicWrappers.get(checker.getResolvedSignature(node)?.declaration);
      if (wrapper) wrapper.callers.push({ location: location(node), callee: node.expression.getText(),
        argumentExpressions: node.arguments.map((argument, index) => ({
          parameter: wrapper.parameters[index] ?? String(index), expression: argument.getText().slice(0, 240),
          truncated: argument.getText().length > 240,
          staticString: ts.isStringLiteralLike(argument) ? argument.text : undefined,
        })) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
if (process.argv.includes('--self-check')) {
  const fixture = ts.createSourceFile('fixture.ts', "const a = 'orders'; const b = 'orders/one/messages'; const c = `orders/${id}`;", ts.ScriptTarget.Latest, true);
  const declarations = fixture.statements.map(statement => statement.declarationList.declarations[0]);
  assert.deepEqual(literalParts(declarations[0].initializer), [{ value: 'orders', kind: 'literal' }]);
  assert.deepEqual(literalParts(declarations[1].initializer).map(part => part.value), ['orders', 'one', 'messages']);
  assert.equal(literalParts(declarations[2].initializer)[0].kind, 'dynamic');
  assert(pathCalls.some(call => call.location.startsWith('functions/src/editIssuedStatementCommand.ts:') && call.path === 'appMeta/releaseCutover'));
  assert(pathCalls.some(call => call.path.startsWith('orders/') && call.unresolved));
  assert(pathCalls.some(call => call.segments.some(part => part.kind === 'COL')));
  assert(additionalModels.some(model => model.model === 'Attempt' && model.fields.length === 3));
  assert.equal(fields.length, byDeclaration.size);
  assert(pathCalls.filter(call => call.unresolved).every(call => call.depth === null));
  assert.equal(unresolvedPropertyAccesses.length, unresolvedAccesses);
  assert(unresolvedPropertyAccesses.every(access => access.location && access.expression && access.receiverType));
  assert(pathCalls.some(call => call.resolutionKind === 'known-collection-dynamic-document'));
  assert([...dynamicWrappers.values()].some(wrapper => wrapper.name === 'fetchCollection' && wrapper.callers.length > 0));
  console.log('필드 사전 검증 통과: 리터럴·동적식·COL·서버 경로·별도 모델·기존 필드 집계');
}
const report = { generatedAt: new Date().toISOString(), sourceFiles: files.length, unresolvedAccesses, unresolvedPropertyAccesses,
  scope: 'shared/types.ts direct interface properties; statically resolved property accesses only; no DB schema or zero-use deletion proof',
  collections, fields, additionalModels,
  firestorePaths: { scope: 'Firestore SDK import/declaration or receiver type confirmed calls only; direct const aliases traced; dynamic expressions and unresolved parents retained; no runtime schema proof',
    calls: pathCalls, candidateCalls, outsideRegistry: [...new Set(pathCalls.flatMap(call => call.outsideRegistry))].sort(),
    dynamicWrappers: [...dynamicWrappers.values()],
    unresolvedLocations: pathCalls.filter(call => call.unresolved).map(call => call.location) } };
if (!process.argv.includes('--check-only')) {
writeFileSync('docs/field-dictionary.generated.json', JSON.stringify(report, null, 2));
const rows = fields.map(field => `| ${field.model} | ${field.field} | ${field.optional ? '선택' : '필수'} | ${field.type.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${field.declaration} | ${field.references.length} |`);
writeFileSync('docs/field-dictionary.generated.md', [
  '# 현재 코드 필드 사전', '',
  `COL ${collections.length}개, 선언 필드 ${fields.length}개, 운영 소스 ${files.length}개를 분석했다.`, '',
  'TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다. 현재 checkout의 미배포 후보가 포함될 수 있으므로 배포 경계는 erd-current-and-target-20261007.md에서 별도로 확인한다.', '',
  '## Firestore 경로 보완', '',
  `SDK import·선언·수신 객체 타입으로 확인한 collection/doc/collectionGroup 호출 ${pathCalls.length}건. 동적 문서 ID도 미해석으로 보존하며, 미해석 ${report.firestorePaths.unresolvedLocations.length}건은 컬렉션 이름 누락과 같은 의미가 아니다. 서버 호출·중첩 경로·직접 const 별칭을 포함한다. 동적 문자열 안의 슬래시 수는 알 수 없어 깊이를 확정하지 않으며, JSON의 argumentDepthCandidate/pathKind는 인수 형태에 따른 후보이다. 함수 반환·분기·객체 전개로 구성한 경로는 해석하지 않는다. scripts·rules·테스트·JS 및 공용 래퍼 호출부의 경로 문자열은 이 운영 TS 소스 범위 밖이다. SDK 근거 없는 같은 이름 호출 ${candidateCalls.length}건은 JSON의 candidateCalls에 집계 밖 후보로 남긴다.`, '',
  `COL 밖 정적 컬렉션 이름: ${report.firestorePaths.outsideRegistry.map(name => '`' + name + '`').join(', ') || '없음'}. 이 목록은 운영 DB 존재/삭제 대상이 아니라 코드에 나타난 이름이다. 부모를 해석하지 못한 호출은 COL 대조에서 제외한다.`, '',
  `동적 컬렉션 호출 ${pathCalls.filter(call => call.resolutionKind === 'dynamic-collection').length}건과 정적 컬렉션의 동적 문서 경로 ${pathCalls.filter(call => call.resolutionKind === 'known-collection-dynamic-document').length}건을 구분한다. 후자는 컬렉션 자체의 누락이 아니다. JSON dynamicWrappers는 SDK 호출의 명명 함수와 타입 검사기로 연결된 실제 소비자 위치/인수식을 기록한다. 인수식은 240자까지 표시하고 잘린 경우 truncated=true를 남기며, 런타임 컬렉션 전체 집합을 보장하지 않는다. 익명 고차 함수·객체 DTO·동적 분기는 원문 소스를 함께 대조한다.`, '',
  '| 동적 컬렉션 공용 함수 | 선언 | SDK 위치 | 실제 연결된 소비자 위치 |',
  '| --- | --- | --- | --- |',
  ...report.firestorePaths.dynamicWrappers.map(wrapper => `| ${wrapper.name} | ${wrapper.declaration} | ${wrapper.sdkLocations.join(', ')} | ${wrapper.callers.map(caller => caller.location).join(', ') || '정적 호출 연결 없음'} |`), '',
  '| 위치 | 실행 | API | 문맥 | 깊이 | 경로 (중괄호는 동적식) | COL 밖 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...pathCalls.map(call => `| ${call.location} | ${call.runtime} | ${call.api} | ${call.context} / ${call.pathKind} | ${call.depth ?? '미해석'} | ${call.path.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${call.outsideRegistry.join(', ')} |`), '',
  '## 별도 모델 보완', '',
  `shared/types.ts 외 interface/type alias ${additionalModels.length}개를 별도 목록에 기록한다. 직접 property만 나열하며 상속·교차/공용체·mapped type·객체 전개는 펼치지 않는다. UI 상태/요청/응답 모델도 있으므로 DB 필드로 단정하지 않는다. 이 목록의 필드는 기존 shared 선언 필드 통계와 사용처 집계에 합치지 않는다. shared/types.ts 안의 type alias도 기존 interface 전용 집계에서는 제외된다.`, '',
  '| 모델 | 선언 위치 | 종류 | 범위 | 직접 필드 |',
  '| --- | --- | --- | --- | --- |',
  ...additionalModels.map(model => `| ${model.model} | ${model.declaration} | ${model.kind} | ${model.scope} | ${model.fields.map(field => field.field).join(', ').replaceAll('|', '\\|')} |`), '',
  '## 미해석 속성 접근 조사 목록', '',
  '이 목록은 속성 선언을 해석하지 못한 위치와 수신 객체 타입이다. DB 필드 목록이 아니며 any/unknown·동적/런타임 접근을 실제 소스에서 분류해야 한다. 미해석 숫자 0을 완료 조건으로 바꾸지 않는다.', '',
  '| 위치 | 식 | 수신 타입 | 미해석 이유 |',
  '| --- | --- | --- | --- |',
  ...unresolvedPropertyAccesses.map(access => `| ${access.location} | ${access.expression.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${access.receiverType.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${access.reason} |`), '',
  '## 기존 shared 선언 필드', '',
  '| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |',
  '| --- | --- | --- | --- | --- | --- |', ...rows, '',
].join('\n'));
}
console.log(JSON.stringify({ collections: collections.length, fields: fields.length, sourceFiles: files.length,
  fieldsWithReferences: fields.filter(field => field.references.length).length, unresolvedAccesses }));
