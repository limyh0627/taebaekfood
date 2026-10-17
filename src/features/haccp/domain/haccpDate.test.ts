import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {todayStr} from './haccpDate';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('UTC 변환이나 공용 업무일 정책으로 바꾸지 않고 로컬 날짜 getter를 사용한다',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-12-31T23:59:00Z'));
 vi.spyOn(Date.prototype,'getFullYear').mockReturnValue(2031);vi.spyOn(Date.prototype,'getMonth').mockReturnValue(0);vi.spyOn(Date.prototype,'getDate').mockReturnValue(2);
 expect(todayStr()).toBe('2031-01-02');
});
it('local getter 원문은 baseline eeaffa8과 같다',()=>{
 const path='src/features/haccp/domain/haccpDate.ts',text=readFileSync(path,'utf8'),s=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
 const declaration=s.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).find(n=>n.name.getText(s)==='todayStr')!;
 expect(createHash('sha256').update(declaration.initializer!.getText(s).replace(/\r\n/g,'\n')).digest('hex')).toBe('d2218d26354d0945d89dcbd21a47a51f416a17e0636fb70c583b7b861fe5330a');
 expect(text).not.toContain('shared/day');
});
