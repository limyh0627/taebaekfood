import ts from 'typescript';

/** 이름이 같은 다른 모델을 섞지 않고 원선언에 정적 접근을 귀속한다. */
export function collectFieldReferences(checker, node, location, references, coverage, isTrackedDeclaration = () => true) {
  const syntax=ts.isPropertyAccessExpression(node)?'dot':ts.isElementAccessExpression(node)?'element':ts.isBindingElement(node)?'binding':null;
  if (!syntax) return;
  const record=(reason)=>{if(!coverage)return; const key=`${node.getSourceFile().fileName}:${node.pos}:${node.end}:${reason}`;if(!coverage.has(key))coverage.set(key,{location:location(node),syntax,reason});};
  const supported=type=>{
    if(type.flags&ts.TypeFlags.Any){record('any-receiver');return null;}
    if(type.flags&ts.TypeFlags.Unknown){record('unknown-receiver');return null;}
    if(type.isUnion()){
      const rest=type.types.filter(part=>!(part.flags&(ts.TypeFlags.Null|ts.TypeFlags.Undefined)));
      if(rest.length!==1){record('ambiguous-union');return null;}
      return supported(rest[0]);
    }
    if(checker.isArrayType(type)||checker.isTupleType(type)){record('array-index');return null;}
    return type;
  };
  const bindingType=pattern=>{
    const parent=pattern.parent;
    if(ts.isBindingElement(parent)){
      if(!ts.isObjectBindingPattern(parent.parent)){record('array-binding');return null;}
      const outer=bindingType(parent.parent);if(!outer)return null;
      const name=parent.propertyName??parent.name;
      if(!ts.isIdentifier(name)&&!ts.isStringLiteral(name)){record('dynamic-key');return null;}
      const symbol=checker.getPropertyOfType(outer,name.text);
      if(!symbol){record('property-symbol-unresolved');return null;}
      const original=supported(checker.getTypeOfSymbolAtLocation(symbol,parent));
      if(!original)return null;
      if(parent.initializer){
        const fallback=supported(checker.getTypeAtLocation(parent.initializer));
        if(!fallback)return null;
        if(original!==fallback){record('ambiguous-union');return null;}
      }
      return original;
    }
    if(ts.isVariableDeclaration(parent)&&parent.initializer)return supported(checker.getTypeAtLocation(parent.initializer));
    return supported(checker.getTypeAtLocation(pattern));
  };
  let symbol;
  if(syntax==='binding'){
    if(ts.isArrayBindingPattern(node.parent)){record('array-binding');return;}
    if(node.dotDotDotToken){record('rest-binding');return;}
    const name=node.propertyName??node.name;
    if(!ts.isIdentifier(name)&&!ts.isStringLiteral(name)){record('dynamic-key');return;}
    const receiver=bindingType(node.parent);if(!receiver)return;
    symbol=checker.getPropertyOfType(receiver,name.text);
  }else{
    // null·undefined만 섞인 단일 모델은 원선언을 읽되 다른 공용체와 기존 점 접근은 그대로 둔다.
    const original=checker.getTypeAtLocation(node.expression);
    const nullableDot=syntax==='dot'&&original.isUnion()&&original.types.some(part=>part.flags&(ts.TypeFlags.Null|ts.TypeFlags.Undefined));
    if(syntax==='dot'&&original.isUnion()){
      const alternatives=original.types.filter(part=>!(part.flags&(ts.TypeFlags.Null|ts.TypeFlags.Undefined)));
      if(!nullableDot||alternatives.length!==1||!(alternatives[0].flags&(ts.TypeFlags.Object|ts.TypeFlags.Intersection))||checker.isArrayType(alternatives[0])||checker.isTupleType(alternatives[0])){record('ambiguous-union');return;}
    }
    const receiver=syntax==='dot'&&!nullableDot?original:supported(original);if(!receiver)return;
    if(syntax==='dot'&&(original.flags&(ts.TypeFlags.Any|ts.TypeFlags.Unknown))){record(original.flags&ts.TypeFlags.Any?'any-receiver':'unknown-receiver');return;}
    if(syntax==='element'){
      if(!ts.isStringLiteral(node.argumentExpression)){record('dynamic-key');return;}
      symbol=checker.getPropertyOfType(receiver,node.argumentExpression.text);
    }else symbol=nullableDot?checker.getPropertyOfType(receiver,node.name.text):checker.getSymbolAtLocation(node.name);
  }
  if(!symbol){record('property-symbol-unresolved');return;}
  const declarations=(symbol.declarations??[]).filter(declaration=>(ts.isPropertySignature(declaration)||ts.isPropertyDeclaration(declaration))&&(syntax==='dot'||!declaration.getSourceFile().fileName.includes('node_modules')&&isTrackedDeclaration(declaration)));
  if(!declarations.length){record('no-model-declaration');return;}
  record(declarations.some(declaration=>!declaration.getSourceFile().fileName.includes('node_modules')&&isTrackedDeclaration(declaration))?'connected':'no-model-declaration');
  for (const declaration of declarations) {
    if (!ts.isPropertySignature(declaration) && !ts.isPropertyDeclaration(declaration)) continue;
    if (!references.has(declaration)) references.set(declaration, new Set());
    references.get(declaration).add(location(node));
  }
}

export const referencesOfDeclarations = (declarations, references) => [...new Set(declarations.flatMap(node => [...(references.get(node) ?? [])]))].sort();

export function summarizeReferenceCoverage(coverage) {
  const rows=[...coverage.values()];
  return {scope:'정적 구문별 원선언 연결과 제외 사유이며 전체 DB 필드 또는 모든 사용처의 증명이 아니다.',
    entriesScope:'entries는 새 고정 문자열 접근과 객체 구조분해만 기록한다. counts는 기존 점 접근도 포함한다.',
    entries:rows.filter(row=>row.syntax!=='dot'),
    counts:rows.reduce((counts,row)=>{const key=`${row.syntax}:${row.reason}`;counts[key]=(counts[key]??0)+1;return counts;},{})};
}

/** 직접 선언 통계와 별도로 상속·mapped type의 정적 필드를 확인한다. */
export function resolvedModelFields(checker, declaration, location, references) {
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
      declarations: originals.map(location), inherited: originals.every(node => !belongsToModel(node)),
      ...(references ? { references: referencesOfDeclarations(originals, references) } : {}) }];
  });
  return { scope: 'checker-resolved-properties-only', fields };
}
