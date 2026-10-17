/** @vitest-environment jsdom */
import React from 'react';
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {HaccpCompanyContext,useHaccpCompany} from './HaccpCompanyContext';
const Read=()=> <span data-testid="company">{useHaccpCompany()}</span>;
it('기본 태백과 같은 provider 객체의 회사 변경을 모든 소비자가 받는다',()=>{
 const view=render(<Read/>);expect(screen.getByTestId('company')).toHaveTextContent('taebaek');
 view.rerender(<HaccpCompanyContext.Provider value="punghoe"><Read/></HaccpCompanyContext.Provider>);expect(screen.getByTestId('company')).toHaveTextContent('punghoe');
 view.rerender(<HaccpCompanyContext.Provider value="taebaek"><Read/></HaccpCompanyContext.Provider>);expect(screen.getByTestId('company')).toHaveTextContent('taebaek');
});
it('부모 provider2와 전체17 소비자가 같은 하위 context 모듈을 참조한다',()=>{
 const parent=readFileSync('components/HaccpChecklist.tsx','utf8'),temp=readFileSync('src/features/haccp/ui/TempForm.tsx','utf8'),incoming=readFileSync('src/features/haccp/ui/IncomingForm.tsx','utf8');
 const hygiene=['SanitationForm','CleaningForm','PersonalHygieneForm'].map(name=>readFileSync(`src/features/haccp/ui/${name}.tsx`,'utf8'));
 const shell=readFileSync('src/features/haccp/ui/HaccpChecklistShells.tsx','utf8');
 expect(shell.match(/<HaccpCompanyContext\.Provider /g)).toHaveLength(2);expect(parent).not.toContain('<HaccpCompanyContext.Provider');
 const files=(directory:string):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):/\.tsx?$/.test(entry.name)&&!entry.name.includes('.test.')?[`${directory}/${entry.name}`]:[]);
 const products=files('src/features/haccp').map(path=>readFileSync(path,'utf8'));
 expect([parent,...products].join('\n').match(/useHaccpCompany\(\)/g)).toHaveLength(17);
 expect(shell).toContain("from '../context/HaccpCompanyContext'");
 for(const source of [temp,incoming,...hygiene,...['CCPHeatForm','CCPMetalForm','DailyForm','OverviewForm','PestForm'].map(name=>readFileSync(`src/features/haccp/ui/${name}.tsx`,'utf8'))])expect(source).toContain("from '../context/HaccpCompanyContext'");
 expect(parent).not.toContain('createContext<CompanyId>');
 const path='src/features/haccp/context/HaccpCompanyContext.tsx',source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const expected:Record<string,string>={HaccpCompanyContext:'cf14e4598fc28abb84684b0a12bc13434f646f6ee9d65e24e5e61aa6723e0f8b',useHaccpCompany:'920c4c7f96fdb440b91dde5b3cdd946aee4710b372e47f647b37d8d0f2567513'};
 const found:Record<string,string>={};for(const node of source.statements)if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations){const name=declaration.name.getText(source);if(expected[name])found[name]=createHash('sha256').update(declaration.initializer!.getText(source).replace(/\r\n/g,'\n')).digest('hex');}expect(found).toEqual(expected);
});
