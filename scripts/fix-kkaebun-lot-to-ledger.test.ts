import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';
const cli = resolve('scripts/fix-kkaebun-lot-to-ledger.mts');
const source = readFileSync(cli, 'utf8');
it.each([[], ['--dry'], ['--help'], ['--apply'], ['--undo'], ['--unknown'], ['--dry','--apply'], ['--help','--undo']].map(args=>({args})))('실제 CLI $args 는 인증 없는 별도 폴더에서 읽기·쓰기 없이 안내한다',({args})=>{
 const cwd=mkdtempSync(join(tmpdir(),'retired-raw-cli-'));
 try {
  writeFileSync(join(cwd,'sentinel.json'),'기존자료');
  const env={...process.env};
  for(const key of Object.keys(env))if(/FIREBASE|GOOGLE|SERVICE_ACCOUNT|CREDENTIAL|GCLOUD/i.test(key))delete env[key];
  const r=spawnSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8',timeout:5000});
  expect(r.error).toBeUndefined();expect(r.signal).toBeNull();
  expect(r.status).toBe(args.some(a=>!['--dry','--help'].includes(a))?1:0);
  const text=r.stdout+r.stderr;expect(text).toContain('옛 깨분참기름 원장 기준 로트 정정·복원 명령은 폐기');expect(text).toContain('원격 접속과 자료 변경은 하지 않습니다');expect(text).toContain('DB-CHANGELOG.md');expect(text).toContain('docs/deprecated-field-audit-20261006.md');
  if(args.includes('--apply')||args.includes('--undo'))expect(text).toContain('쓰기 요청을 거절');
  expect(text).not.toContain('apiKey');expect(text).not.toContain('FIREBASE');
  expect(readdirSync(cwd)).toEqual(['sentinel.json']);expect(readFileSync(join(cwd,'sentinel.json'),'utf8')).toBe('기존자료');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
it('실행 AST에는 Firebase·파일 IO·동적 실행·옛 writer가 없다',()=>{
 const ast=ts.createSourceFile(cli,source,ts.ScriptTarget.Latest,true),calls:string[]=[],imports:string[]=[];
 function visit(node:ts.Node){
  if(ts.isImportDeclaration(node))imports.push(node.getText(ast));
  if(ts.isCallExpression(node))calls.push(node.expression.getText(ast));
  expect(ts.isNewExpression(node)).toBe(false);ts.forEachChild(node,visit);
 }
 visit(ast);expect(imports).toEqual([]);expect(calls.every(c=>['process.argv.slice','console.error','args.includes','args.some'].includes(c))).toBe(true);
 expect(source).toContain('과거 백업·작업 이력은 보존');
});

