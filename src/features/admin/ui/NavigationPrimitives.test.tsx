/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NavGroup, NavItem } from './NavigationPrimitives';
const Icon = () => <svg data-testid="menu-icon" />;
beforeEach(() => { localStorage.clear(); });
it('그룹 접힘은 기존 nav 키로 저장되고 다시 열어도 유지한다', () => {
 const first=render(<NavGroup title="업무" storageKey="work"><span>주문 내용</span></NavGroup>);
 expect(screen.getByText('주문 내용')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'업무'}));
 expect(localStorage.getItem('nav.work')).toBe('closed');expect(screen.queryByText('주문 내용')).toBeNull();first.unmount();
 render(<NavGroup title="업무" storageKey="work"><span>주문 내용</span></NavGroup>);
 expect(screen.queryByText('주문 내용')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'업무'}));expect(localStorage.getItem('nav.work')).toBe('open');expect(screen.getByText('주문 내용')).toBeInTheDocument();
});
it('아이콘 사이드바는 그룹 접힘과 무관하게 자식을 보이고 토글을 두지 않는다',()=>{
 localStorage.setItem('nav.work','closed');render(<NavGroup title="업무" storageKey="work" collapsed><span>주문 내용</span></NavGroup>);
 expect(screen.getByText('주문 내용')).toBeInTheDocument();expect(screen.queryByRole('button')).toBeNull();expect(localStorage.getItem('nav.work')).toBe('closed');
});
it('브라우저 저장소가 막혀도 그룹은 열리고 현재 화면에서 접고 펼친다',()=>{
 const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});
 try{render(<NavGroup title="업무" storageKey="work"><span>주문 내용</span></NavGroup>);fireEvent.click(screen.getByRole('button',{name:'업무'}));expect(screen.queryByText('주문 내용')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'업무'}));expect(screen.getByText('주문 내용')).toBeInTheDocument();}finally{read.mockRestore();write.mockRestore();}
});
it('숨긴 메뉴는 아이콘·배지·클릭 경로를 렌더하지 않는다',()=>{
 const click=vi.fn();render(<NavItem icon={Icon} label="주문" active={false} onClick={click} hidden badge={120}/>);
 expect(screen.queryByRole('button')).toBeNull();expect(screen.queryByTestId('menu-icon')).toBeNull();expect(click).not.toHaveBeenCalled();
});
it('배지는 양수만 표시하고 99를 넘으면 99+로 표시한다',()=>{
 const view=render(<NavItem icon={Icon} label="주문" active={false} onClick={()=>{}} badge={0}/>);
 expect(screen.queryByText('0')).toBeNull();view.rerender(<NavItem icon={Icon} label="주문" active={false} onClick={()=>{}} badge={99}/>);expect(screen.getByText('99')).toBeInTheDocument();
 view.rerender(<NavItem icon={Icon} label="주문" active={false} onClick={()=>{}} badge={100}/>);expect(screen.getByText('99+')).toBeInTheDocument();
});
it('선택·아이콘 메뉴 표시는 유지하고 부모 클릭 순서를 그대로 실행한다',()=>{
 const calls:string[]=[];render(<NavItem icon={Icon} label="거래처 원장" active collapsed badge={2} onClick={()=>{calls.push('partner');calls.push('ledger');}}/>);
 const button=screen.getByRole('button',{name:/거래처 원장/});expect(button).toHaveAttribute('title','거래처 원장');expect(button).toHaveClass('justify-center','bg-indigo-600');expect(screen.getByText('거래처 원장')).toHaveClass('opacity-0','w-0');fireEvent.click(button);expect(calls).toEqual(['partner','ledger']);
});
