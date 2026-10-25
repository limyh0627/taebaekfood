import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
import {configDefaults} from 'vitest/config';
import ts from 'typescript';

// 설정을 실행하면 플러그인이나 시험 모듈까지 로드할 수 있으므로 배열 원문만 읽는다.
const source=readFileSync('vitest.config.ts','utf8');
const tree=ts.createSourceFile('vitest.config.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let exclusion:ts.ArrayLiteralExpression|undefined;
const visit=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='exclude'&&ts.isArrayLiteralExpression(node.initializer))exclusion=node.initializer;ts.forEachChild(node,visit);};
visit(tree);
if(!exclusion)throw new Error('시험 제외 배열을 확인하지 못했습니다.');
const elements=exclusion.elements;
const excludes=elements.flatMap(element=>{
 if(ts.isSpreadElement(element)){if(element.expression.getText(tree)!=='configDefaults.exclude')throw new Error('알 수 없는 제외 spread입니다.');return [...configDefaults.exclude];}
 if(ts.isStringLiteral(element))return [element.text];
 throw new Error('제외 배열은 기본 spread와 문자열만 허용합니다.');
});
// tinyglobby가 사용하는 설치 matcher로 이름만 평가하며 대상 파일을 import하지 않는다.
const picomatch=createRequire(import.meta.url)('picomatch') as (patterns:readonly string[],options:{dot:boolean})=>(file:string)=>boolean;
const included=picomatch(configDefaults.include,{dot:true}),excluded=picomatch(excludes,{dot:true});
const collected=(file:string)=>included(file)&&!excluded(file);
it('루트 비공개 세 폴더와 그 하위 시험은 수집하지 않는다',()=>{
 for(const root of ['work','privatework','records'])for(const name of ['example.test.ts','nested/deep/example.spec.tsx'])expect(collected(root+'/'+name),root+'/'+name).toBe(false);
});
it('정식 루트와 중첩된 동명 폴더의 유효 시험을 유지한다',()=>{
 for(const file of ['src/example.test.ts','components/example.spec.tsx','apps/staff/example.test.tsx','functions/src/example.test.ts','scripts/example.test.mjs','src/work/example.test.ts','apps/records/deep/example.spec.tsx','components/privatework/example.test.tsx'])expect(collected(file),file).toBe(true);
});
it('기본 제외와 Node 단독 러너 제외를 함께 유지한다',()=>{
 expect(elements.some(node=>ts.isSpreadElement(node)&&node.expression.getText(tree)==='configDefaults.exclude')).toBe(true);
 expect(collected('scripts/dummyOrderExclusionPlan.test.mjs')).toBe(false);
 expect(collected('node_modules/example.test.ts')).toBe(false);
 expect(collected('.git/example.test.ts')).toBe(false);
});
