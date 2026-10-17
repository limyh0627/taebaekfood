/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CashTemplateModal, CashTemplatePicker } from './CashTemplateSelection';
import type { CashTemplate } from '../domain/cashTemplateCatalog';
import type { AccountCode } from '../../../shared/types';
const templates:CashTemplate[]=[{id:'first',label:'임차료',dir:'출금',mode:'일반',group:'고정',accountCode:'820',partnerName:'합성임대인'}, {id:'favorite',label:'상품매입',dir:'줄돈',mode:'일반',group:'매입',accountCode:'501',favorite:true}, {id:'blocked',label:'없는계정',dir:'입금',mode:'일반',group:'기타',unavailableCodes:['999']}];
const accounts=[{code:'820',name:'지급임차료'},{code:'501',name:'상품'}] as AccountCode[];
it('즐겨찾기는 먼저 보이고 선택은 복사 없이 원래 객체를 전달한다',()=>{
 const pick=vi.fn();render(<CashTemplatePicker templates={templates} accountCodes={accounts} activeId="favorite" onPick={pick}/>);const buttons=screen.getAllByRole('button');expect(buttons[0]).toHaveTextContent('상품매입');expect(buttons[0]).toHaveClass('border-indigo-500');fireEvent.click(buttons[0]);expect(pick.mock.calls[0][0]).toBe(templates[1]);
});
it('사용불가 계정 사유와 disabled를 유지하며 label override는 원본 방향을 바꾸지 않는다',()=>{
 const pick=vi.fn();render(<CashTemplatePicker templates={templates} accountCodes={accounts} activeId={null} onPick={pick} directionLabel="매입"/>);const blocked=screen.getByRole('button',{name:/없는계정/});expect(blocked).toBeDisabled();expect(blocked).toHaveAttribute('title','현재 회사 계정표에 없는 계정: 999');expect(screen.getByText(/현재 회사 계정표에 999 없음/)).toBeInTheDocument();fireEvent.click(blocked);expect(pick).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:/상품매입/}));expect(pick.mock.calls[0][0]).toBe(templates[1]);expect(templates[1].dir).toBe('줄돈');expect(screen.queryByText('줄돈')).toBeNull();
});
it('검색·그룹·즐겨찾기·갈래 탭을 조합하되 직접입력과 닫기 콜백은 유지한다',()=>{
 const direct=vi.fn(),close=vi.fn(),pick=vi.fn();render(<CashTemplateModal templates={templates} accountCodes={accounts} activeId={null} onPick={pick} onDirect={direct} onClose={close}/>);const search=screen.getByPlaceholderText('이름·거래처·계정 검색');fireEvent.change(search,{target:{value:'지급임차료'}});expect(screen.getByRole('button',{name:/임차료/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/상품매입/})).toBeNull();fireEvent.change(search,{target:{value:'합성임대인'}});expect(screen.getByRole('button',{name:/임차료/})).toBeInTheDocument();fireEvent.change(search,{target:{value:''}});fireEvent.change(screen.getByLabelText('템플릿 그룹'),{target:{value:'매입'}});expect(screen.queryByRole('button',{name:/임차료/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'★'}));fireEvent.click(screen.getByRole('button',{name:/상품매입/}));expect(pick.mock.calls[0][0]).toBe(templates[1]);expect(close).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:/직접입력/}));expect(direct).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'닫기'}));expect(close).toHaveBeenCalledOnce();
});
it('갈래 탭을 숨겨도 전체·즐겨찾기와 빈 검색 안내를 유지한다',()=>{
 render(<CashTemplateModal templates={templates} accountCodes={accounts} activeId={null} onPick={vi.fn()} onDirect={vi.fn()} onClose={vi.fn()} hideDirectionTabs/>);expect(screen.queryByRole('button',{name:/^출금$/})).toBeNull();expect(screen.getByRole('button',{name:'전체'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'★'})).toBeInTheDocument();fireEvent.change(screen.getByPlaceholderText('이름·거래처·계정 검색'),{target:{value:'없는검색어'}});expect(screen.getByText('찾는 템플릿이 없습니다')).toBeInTheDocument();expect(screen.getByRole('button',{name:/직접입력/})).toBeInTheDocument();
});

it('카드는 0원에도 차변 대변과 거래처를 독립 줄에 표시한다',()=>{
 render(<CashTemplatePicker templates={[templates[0]]} accountCodes={accounts} activeId={null} onPick={vi.fn()}/>);
 const card=screen.getByRole('button',{name:/임차료/}),view=within(card);
 expect(view.getByText('차변')).toBeInTheDocument();expect(view.getByText('대변')).toBeInTheDocument();
 expect(view.getByText('820 지급임차료')).toBeInTheDocument();expect(view.getByText('103 보통예금')).toBeInTheDocument();
 expect(view.getByText('거래처 · 합성임대인')).toHaveClass('border-t');expect(view.getByText('0원')).toBeInTheDocument();
 expect(view.getByText('임차료')).toHaveClass('break-words');expect(card.parentElement).toHaveClass('gap-2');
});
