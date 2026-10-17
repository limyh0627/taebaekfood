/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TemplateAccountSummary from './TemplateAccountSummary';
import type { FixedCostTemplate, AccountCode } from '../../../shared/types';
afterEach(cleanup);
const base = { id: 't', name: '합성', amount: 0, dir: '대체', mode: '일반', accountCode: '819' } as FixedCostTemplate;
it('0원도 정본의 계정을 표시하고 없는 상대변은 보충하지 않는다', () => {
  render(<TemplateAccountSummary template={base} accountCodes={[{code:'819',name:'현재 비용'}] as AccountCode[]}/>);
  expect(screen.getByText('819 현재 비용')).toBeInTheDocument();
  expect(screen.getByText('작성 시 결정')).toBeInTheDocument();
  expect(screen.getByText('차변')).toBeInTheDocument();
  expect(screen.getByText('대변')).toBeInTheDocument();
});
it('여러 계정을 순서대로 표시하며 현재 이름과 원래 라벨을 구분한다', () => {
  render(<TemplateAccountSummary template={{...base,transferLines:[{side:'차변',accountCode:'135',name:'옛 이름'},{side:'차변',accountCode:'255',name:'원래 라벨'},{side:'대변',accountCode:'',name:'빈 코드'}]}} accountCodes={[{code:'135',name:'현재 이름'}] as AccountCode[]}/>);
  expect(screen.getByText('135 현재 이름 · 255 원래 라벨')).toBeInTheDocument();
  expect(screen.getByText('계정 직접 선택')).toBeInTheDocument();
  expect(screen.queryByText('작성 시 결정')).toBeNull();
});

it('옛 템플릿의 없는 갈래는 기존 출금 기본값으로 표시한다',()=>{render(<TemplateAccountSummary template={{...base,dir:undefined,mode:undefined}} accountCodes={[{code:'819',name:'현재 비용'}] as AccountCode[]}/>);expect(screen.getByText('819 현재 비용')).toBeInTheDocument();expect(screen.getByText('103 보통예금')).toBeInTheDocument();expect(screen.queryByText('작성 시 결정')).toBeNull();});
