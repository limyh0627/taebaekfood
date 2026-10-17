import {beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
const m=vi.hoisted(()=>({imports:[] as string[],events:[] as string[],render:vi.fn(),construct:vi.fn(),pdf:{addPage:vi.fn(),addImage:vi.fn(),save:vi.fn()}}));
vi.mock('jspdf',()=>{m.imports.push('jspdf');return {default:class {constructor(...args:unknown[]){m.construct(...args);m.events.push('construct');return m.pdf;}}};});
vi.mock('html2canvas',()=>{m.imports.push('html2canvas');return {default:m.render};});
import {downloadAsPDF} from './downloadAsPDF';
beforeEach(()=>{m.render.mockReset();m.construct.mockReset();m.pdf.addPage.mockReset();m.pdf.addImage.mockReset();m.pdf.save.mockReset();m.events=[];});

it('PDF 동적 import 순서·캡처 옵션·A4 규격과 원본 파일명을 보존한다',async()=>{
  const canvas={width:100,height:100,toDataURL:vi.fn(()=> 'original-png')};
  m.render.mockImplementation(async()=>{m.events.push('capture');return canvas;});
  const element={} as HTMLElement;await downloadAsPDF(element,'원본_일일점검.pdf');
  expect(m.imports).toEqual(['jspdf','html2canvas']);expect(m.events).toEqual(['capture','construct']);
  expect(m.render).toHaveBeenCalledWith(element,{scale:2,backgroundColor:'#ffffff',useCORS:true});
  expect(m.construct).toHaveBeenCalledWith('p','mm','a4');
  expect(m.pdf.addImage).toHaveBeenCalledWith('original-png','PNG',0,-0,210,210);
  expect(m.pdf.addPage).not.toHaveBeenCalled();expect(m.pdf.save).toHaveBeenCalledWith('원본_일일점검.pdf');
});
it('긴 캔버스를 자르거나 재캡처하지 않고 같은 이미지를 음수 Y로 반복한다',async()=>{
  const canvas={width:100,height:300,toDataURL:vi.fn(()=> 'same-image')};m.render.mockResolvedValue(canvas);
  await downloadAsPDF({} as HTMLElement,'long.pdf');
  expect(m.render).toHaveBeenCalledOnce();expect(m.pdf.addPage).toHaveBeenCalledTimes(2);
  expect(m.pdf.addImage.mock.calls).toEqual([['same-image','PNG',0,-0,210,630],['same-image','PNG',0,-297,210,630],['same-image','PNG',0,-594,210,630]]);
  expect(canvas.toDataURL).toHaveBeenCalledTimes(3);expect(m.pdf.save).toHaveBeenCalledOnce();
});
it('캡처와 PDF 기록의 오류를 원래 그대로 호출자에게 전달한다',async()=>{
  const error=new Error('캡처 실패');m.render.mockRejectedValueOnce(error);
  await expect(downloadAsPDF({} as HTMLElement,'failed.pdf')).rejects.toBe(error);expect(m.pdf.save).not.toHaveBeenCalled();
  m.render.mockResolvedValue({width:100,height:100,toDataURL:()=> 'png'});m.pdf.addImage.mockImplementationOnce(()=>{throw error;});
  await expect(downloadAsPDF({} as HTMLElement,'failed.pdf')).rejects.toBe(error);expect(m.pdf.save).not.toHaveBeenCalled();
});
it('HEAD6d4894a 함수 본문 원문과 같고 실제 16개 호출이 새 모듈에 연결된다',()=>{
  const text=readFileSync('src/features/haccp/infrastructure/downloadAsPDF.ts','utf8'),source=ts.createSourceFile('downloadAsPDF.ts',text,ts.ScriptTarget.Latest,true);
  const fn=source.statements.find(ts.isFunctionDeclaration)!;
  expect(createHash('sha256').update(fn.body!.getText(source).replace(/\r\n/g,'\n')).digest('hex')).toBe('b1231655433bba4e250a58963858d493e3da98fbb0e47be43acf452d67c93af0');
  const parent=ts.createSourceFile('HaccpChecklist.tsx',readFileSync('components/HaccpChecklist.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let calls=0,definitions=0;function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(parent)==='downloadAsPDF')calls++;if(ts.isFunctionDeclaration(node)&&node.name?.text==='downloadAsPDF')definitions++;ts.forEachChild(node,visit);}visit(parent);
  expect(calls).toBe(16);expect(definitions).toBe(0);
  expect(parent.statements.some(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.getText(parent).includes('/haccp/infrastructure/downloadAsPDF'))).toBe(true);
});
