/** @vitest-environment jsdom */
import React from 'react';
import {act,renderHook} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {arrayMove,useDragReorder} from './useDragReorder';

it('배열 원본을 바꾸지 않고 같은 행 객체를 옮긴다',()=>{
  const first={id:'a'},second={id:'b'},third={id:'c'},input=[first,second,third];
  expect(arrayMove(input,0,2)).toEqual([second,third,first]);expect(input).toEqual([first,second,third]);
  expect(arrayMove(input,2,0)[0]).toBe(third);expect(arrayMove(input,1,1)).toEqual(input);
});
it('dragRef의 최신 위치로 연속 이동하며 종료 시에만 settle한다',()=>{
  const move=vi.fn(),settle=vi.fn(),{result}=renderHook(()=>useDragReorder(move,settle));
  act(()=>result.current.rowProps(2).onDragEnter());expect(move).not.toHaveBeenCalled();
  const transfer={setData:vi.fn(),effectAllowed:''};
  act(()=>result.current.handleProps(0).onDragStart({dataTransfer:transfer} as unknown as React.DragEvent));
  expect(transfer.setData).toHaveBeenCalledWith('text/plain','');expect(transfer.effectAllowed).toBe('move');expect(result.current.dragIdx).toBe(0);
  act(()=>{result.current.rowProps(2).onDragEnter();result.current.rowProps(1).onDragEnter();result.current.rowProps(1).onDragEnter();});
  expect(move.mock.calls).toEqual([[0,2],[2,1]]);expect(result.current.dragIdx).toBe(1);expect(settle).not.toHaveBeenCalled();
  const preventDefault=vi.fn();result.current.rowProps(0).onDragOver({preventDefault} as unknown as React.DragEvent);expect(preventDefault).toHaveBeenCalledOnce();
  act(()=>result.current.handleProps(1).onDragEnd());expect(result.current.dragIdx).toBeNull();expect(settle).toHaveBeenCalledOnce();
  act(()=>result.current.rowProps(0).onDragEnter());expect(move).toHaveBeenCalledTimes(2);
});
it('settle 인수가 없어도 시작·종료할 수 있다',()=>{
  const {result}=renderHook(()=>useDragReorder(vi.fn()));
  expect(result.current.handleProps(0).draggable).toBe(true);
  act(()=>result.current.handleProps(0).onDragEnd());expect(result.current.dragIdx).toBeNull();
});
it('훅과 arrayMove 원문 동치·실제 7개 에디터 연결을 보존한다',()=>{
  const text=readFileSync('src/features/haccp/hooks/useDragReorder.ts','utf8'),source=ts.createSourceFile('useDragReorder.ts',text,ts.ScriptTarget.Latest,true);
  const fn=source.statements.find(ts.isFunctionDeclaration)!;
  const array=source.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).find(n=>n.name.getText(source)==='arrayMove')!;
  const hash=(node:ts.Node)=>createHash('sha256').update(node.getText(source).replace(/\r\n/g,'\n')).digest('hex');
  expect(hash(fn.body!)).toBe('0c3a74b289e4d263ad8ea7a45c775f83483fa25f97840286eca25b99c28a7bfa');expect(hash(array.initializer!)).toBe('2a466a4e94d813ab706b740e2f1a562828d540fb49ca82d975f06e18aa5a11eb');
  const parent=ts.createSourceFile('HaccpChecklist.tsx',readFileSync('components/HaccpChecklist.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let calls=0,definitions=0;function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(parent)==='useDragReorder')calls++;if(ts.isFunctionDeclaration(node)&&node.name?.text==='useDragReorder')definitions++;ts.forEachChild(node,visit);}visit(parent);
  expect(calls).toBe(7);expect(definitions).toBe(0);expect(text).not.toContain('HaccpChecklist');
});
