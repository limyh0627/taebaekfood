import ts from 'typescript';

/** 직접 선언 통계와 별도로 상속·mapped type의 정적 필드를 확인한다. */
export function resolvedModelFields(checker, declaration, location) {
  const belongsToModel = node => { for (let parent = node.parent; parent; parent = parent.parent) { if (parent === declaration) return true; } return false; };
  const type = checker.getTypeAtLocation(declaration);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { scope: 'unresolved-model', fields: [] };
  if (!(type.flags & ts.TypeFlags.Object) && !(type.flags & ts.TypeFlags.Intersection)) return { scope: 'non-object-model-not-expanded', fields: [] };
  const fields = checker.getPropertiesOfType(type).flatMap(symbol => {
    const declarations = symbol.getDeclarations() ?? [];
    const originals = declarations.filter(node => ts.isPropertySignature(node) || ts.isPropertyDeclaration(node));
    if (!originals.length) return [];
    return [{ field: symbol.name, optional: !!(symbol.flags & ts.SymbolFlags.Optional),
      type: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration)),
      declarations: originals.map(location), inherited: originals.every(node => !belongsToModel(node)) }];
  });
  return { scope: 'checker-resolved-properties-only', fields };
}
