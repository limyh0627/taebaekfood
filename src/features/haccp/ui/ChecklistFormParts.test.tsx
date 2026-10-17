/** @vitest-environment jsdom */
import React from 'react';
import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {FormHeader,SignBox,TH,TD,TDL} from './ChecklistFormParts';
import {CCP_PRODUCTS} from '../domain/ccpProducts';
afterEach(()=>vi.useRealTimers());

it('제목·기본회사·오늘 표시와 명시한 회사·날짜를 그대로 표시한다',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,17,12));
  const view=render(<FormHeader title="점검표"/>);
  expect(screen.getByText('점검표')).toBeInTheDocument();expect(screen.getByText(`태백식품 | ${new Date().toLocaleDateString('ko-KR')}`)).toBeInTheDocument();
  view.rerender(<FormHeader title="다른 점검표" company="시험회사" date="2026-01"/>);
  expect(screen.getByText('시험회사 | 2026-01')).toBeInTheDocument();
});
it('서명 기본 순서와 호출자가 준 서명 이름 순서를 보존한다',()=>{
  const view=render(<SignBox/>);expect(view.container.textContent).toBe('작성자확인자관리자');
  view.rerender(<SignBox labels={['작성자','검증자','대표자']}/>);expect(view.container.textContent).toBe('작성자검증자대표자');
  expect(TH).toBe('border border-slate-400 bg-slate-100 p-1.5 text-xs font-bold text-center');expect(TD).toContain('text-center');expect(TDL).toContain('text-left');
});
it('공통 부품·검사제품·위생 타입 원문 AST를 baseline aba5fc6와 대조한다',()=>{
  const expected:Record<string,string>={TH:'0e6195d46662cefab2932d88475ba01f34955869d4fd3f7ff2b0e388ce501d20',TD:'12036d6948023e8d9820f0fda294a117b979e86482bc2223bb99190be7fbd149',TDL:'8c20bdfdf89b8327efdd7672004cb03b031b83e296304548590d767f38077b88',FormHeader:'ca0497e8c7b15fd2024daea9a2c42e9fbce2db93054509fb44eaf7c743fcd91a',SignBox:'fc2aa5bfeef7af31b8d758a5c7dd290c3c78040f0f5bc96c8b8f8293f3d231f6',CCP_PRODUCTS:'01aa8fc310ade604533e0e70c8cee31e98d4db2d606c160d0a6bbb97fc6baf34',SlotTime:'cff764ae9d10f36ccc5830618e73f3ea0771537343c4f6a0042b51f0f6ef67be',SanitationRow:'6f43559979711e86bb1ee1308303ebe9d5592b91990c1bd8cd0d3b50d653cfe4',SanitationRecord:'64f282e11552b0155a3c2079fe957ef2ff89fbed4b9fa669938c20065b0e59f4'};
  const found:Record<string,string>={};
  for(const path of ['src/features/haccp/ui/ChecklistFormParts.tsx','src/features/haccp/domain/ccpProducts.ts','src/features/haccp/domain/sanitationTypes.ts']){
    const text=readFileSync(path,'utf8'),file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    for(const statement of file.statements){
      if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){const name=declaration.name.getText(file);if(expected[name])found[name]=createHash('sha256').update(declaration.initializer!.getText(file).replace(/\r\n/g,'\n')).digest('hex');}
      else if(ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)){const name=statement.name.text;if(expected[name])found[name]=createHash('sha256').update(statement.getText(file).replace(/^export /,'').replace(/\r\n/g,'\n')).digest('hex');}
    }
    expect(text).not.toContain('HaccpChecklist');
  }
  expect(found).toEqual(expected);expect(CCP_PRODUCTS).toHaveLength(6);
  const parent=readFileSync('src/features/haccp/ui/HaccpChecklistShells.tsx','utf8');
  expect(parent).toContain("import CCPHeatForm from './CCPHeatForm'");expect(parent).toContain("import CCPMetalForm from './CCPMetalForm'");
  expect(parent).toContain("{activeTab === 'ccp-heat'  && <CCPHeatForm />}");expect(parent).toContain("{activeTab === 'ccp-metal'   && <CCPMetalForm />}");
  expect(parent).not.toContain('const CCPHeatForm:');expect(parent).not.toContain('const CCPMetalForm:');
});
