import { describe, expect, it } from 'vitest';
import { haccpTemplateDocId } from './haccpTemplateId';
import { readFileSync, globSync } from 'node:fs';
import ts from 'typescript';

describe('회사별 HACCP 템플릿 문서 ID', () => {
  it('태백은 기존 문서 ID를 유지한다', () => {
    expect(haccpTemplateDocId('taebaek', 'personal_hygiene')).toBe('personal_hygiene');
  });

  it('풍회는 이관된 punghoe 접두사 문서를 사용한다', () => {
    expect(haccpTemplateDocId('punghoe', 'personal_hygiene')).toBe('punghoe--personal_hygiene');
  });

  it('HACCP 화면의 템플릿 조회와 저장은 모두 회사별 ID 함수를 거친다', () => {
    const shell=readFileSync('components/HaccpChecklist.tsx','utf8');
    expect(shell).toContain('HaccpChecklistShells');
    let reads=0,writes=0,literals=0;
    for(const path of globSync('src/features/haccp/**/*.{ts,tsx}').filter(p=>!p.includes('.test.'))){
      const source=readFileSync(path,'utf8'),file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const visit=(node:ts.Node)=>{if(ts.isStringLiteral(node)&&node.text==='haccp_templates')literals++;if(ts.isCallExpression(node)){
        const name=node.expression.getText(file),args=node.arguments;
        const isRead=name==='doc'&&args[1]&&ts.isStringLiteral(args[1])&&args[1].text==='haccp_templates';
        const isWrite=name==='setDocument'&&args[0]&&ts.isStringLiteral(args[0])&&args[0].text==='haccp_templates';
        if(isRead||isWrite){const id=args[isRead?2:1];expect(ts.isCallExpression(id)&&id.expression.getText(file)==='haccpTemplateDocId',path).toBe(true);if(isRead)reads++;else writes++;}
      }ts.forEachChild(node,visit);};visit(file);
    }
    expect(reads).toBeGreaterThan(0);expect(writes).toBeGreaterThan(0);expect(literals).toBe(reads+writes);
  });
});
