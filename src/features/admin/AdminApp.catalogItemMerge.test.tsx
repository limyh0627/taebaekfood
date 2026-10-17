import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
it('품목통합완료callback은새로고침만호출하며원장복사삭제SDK를실행하지않는다',async()=>{
 const text=readFileSync('src/features/admin/AdminApp.tsx','utf8'),source=ts.createSourceFile('AdminApp.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback:ts.ArrowFunction|undefined;
 function visit(node:ts.Node){if(ts.isJsxAttribute(node)&&node.name.getText(source)==='onMergeItems'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression&&ts.isArrowFunction(node.initializer.expression))callback=node.initializer.expression;ts.forEachChild(node,visit);}visit(source);expect(callback).toBeDefined();
 const refresh=vi.fn(),forbidden=vi.fn(()=>{throw Error('클라이언트 직접 쓰기 금지');});
 const fn=Function('refreshStaticData','commitCompanyWrites','getDocs',`return (${callback!.getText(source)});`)(refresh,forbidden,forbidden) as ()=>Promise<void>;
 await fn();expect(refresh).toHaveBeenCalledTimes(1);expect(forbidden).not.toHaveBeenCalled();expect(callback!.getText(source)).not.toMatch(/import\(|partner_item|COL\.items|deleteIds/);
});
