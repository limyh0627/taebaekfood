/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import {SanitationPrintable,SanitationMonthlyCover,sanSlotLabel,sanRevLabel} from './SanitationPrint';
import type {SanitationRecord} from '../domain/sanitationTypes';
const record:SanitationRecord={checkDate:'2024-02-01',checkTime:'08:30',checkZone:'합성구역',rows:[{result:'pass',note:'정상 확인',inspector:'검사자A'},{result:'fail',note:'개선 필요',inspector:'검사자B'}],specialNotes:'합성 개선사항',createdBy:'작성자A',createdAt:'',updatedBy:'수정자B',updatedAt:'',revisionCount:2};
const items=[{item:'첫 항목',standard:'첫 기준'},{item:'둘째 항목',standard:'둘째 기준'},{item:'빈 항목',standard:'빈 기준'}];

it('읽기전용 인쇄물의 고정 서식·적합/부적합 열·빈 행·수정자 표시를 보존한다',()=>{
  const view=render(<SanitationPrintable record={record} templateItems={items}/>);
  expect(screen.getByText('HACCP 작업장 위생점검표')).toBeInTheDocument();expect(screen.getByText('HACCP-PRP-001')).toBeInTheDocument();
  const first=screen.getByText('첫 항목').closest('tr')!,second=screen.getByText('둘째 항목').closest('tr')!,empty=screen.getByText('빈 항목').closest('tr')!;
  expect(first.children[3]).toHaveTextContent('●');expect(first.children[4]).toBeEmptyDOMElement();
  expect(second.children[3]).toBeEmptyDOMElement();expect(second.children[4]).toHaveTextContent('●');expect(second).toHaveClass('bg-rose-50');
  expect(empty.children[3]).toBeEmptyDOMElement();expect(empty.children[4]).toBeEmptyDOMElement();
  expect(screen.getByText('검사자A')).toBeInTheDocument();expect(screen.getByText('수정자')).toBeInTheDocument();expect(screen.getByText('합성 개선사항')).toBeInTheDocument();
  expect(view.container.querySelector('input,select,button')).toBeNull();
  view.rerender(<SanitationPrintable record={{...record,updatedBy:record.createdBy,confirmedBy:'확인자C',confirmedAt:'2024-02-02T09:00:00'}} templateItems={items}/>);
  expect(screen.queryByText('수정자')).not.toBeInTheDocument();expect(screen.getByText(/관리자 확인완료 · 확인자C/)).toBeInTheDocument();
});
it('윤년 월간 표지의 2회 계획·확인·부적합과 날짜별 두 시간대를 보존한다',()=>{
  const rows:SanitationRecord[]=[{...record,rows:[{result:'pass',note:'',inspector:''}],confirmedBy:'관리자'}, {...record,checkTime:'15:00'}, {...record,checkDate:'2024-02-02',rows:[]}];
  render(<SanitationMonthlyCover ym="2024-02" monthRecords={rows}/>);
  expect(screen.getByText('총 점검').parentElement).toHaveTextContent('3회계획 58회');
  expect(screen.getByText('확인완료').parentElement).toHaveTextContent('1회');expect(screen.getByText('미확인').parentElement).toHaveTextContent('2회');expect(screen.getByText('부적합 발생').parentElement).toHaveTextContent('1회');
  const day=screen.getByText('2024-02-01').closest('tr')!;expect(day.children[1]).toHaveTextContent('확인');expect(day.children[2]).toHaveTextContent('점검·부적합');
  expect(within(screen.getByText('2024-02-29').closest('tr')!).getAllByText('미점검')).toHaveLength(2);expect(screen.queryByText('2024-02-30')).not.toBeInTheDocument();
  expect(sanSlotLabel('08:30')).toBe('오전 08:30');expect(sanSlotLabel('15:00')).toBe('오후 15:00');expect(sanRevLabel({revisionCount:-1})).toBe('미저장');expect(sanRevLabel({revisionCount:0})).toBe('Rev.0');
});
it('인쇄 컴포넌트·라벨 원문과 실제 부모 연결을 유지한다',()=>{
  const text=readFileSync('src/features/haccp/ui/SanitationPrint.tsx','utf8'),file=ts.createSourceFile('SanitationPrint.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const expected:Record<string,string>={sanSlotLabel:'4ff9538e39b35d59b31e2372d9c66f9571679830138b3ce3a757d53d683f74a2',sanRevLabel:'541400beae93e32f30ff19720b4872a34cd1ce3525b6e4da5adb268eaa916044',SanitationPrintable:'0e34cfd2caf83502373c0f783fdf595f3a0619d53b0488ee7ea1a8c8f7f315d9',SanitationMonthlyCover:'3ab88379e34b5ba8784cb5081575e4b86589621b5468158e440fb5c30f45997d'};
  const found:Record<string,string>={};for(const statement of file.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){const name=declaration.name.getText(file);if(expected[name])found[name]=createHash('sha256').update(declaration.initializer!.getText(file).replace(/\r\n/g,'\n')).digest('hex');}expect(found).toEqual(expected);
  expect(text).not.toContain('HaccpChecklist');const parent=readFileSync('components/HaccpChecklist.tsx','utf8');expect(parent).toContain("from '../src/features/haccp/ui/SanitationPrint'");expect(parent).toContain('<SanitationMonthlyCover ym={bulkMonth} monthRecords={bulkList} />');expect(parent).toContain('<SanitationPrintable record={r} templateItems={templateItems} />');
});
