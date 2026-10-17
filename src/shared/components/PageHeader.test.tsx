/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import PageHeader from './PageHeader';

it('제목과 부제를 유지하고 조작이 없으면 모바일 헤더 공간을 만들지 않는다',()=>{
  const {container}=render(<PageHeader title="거래처별 전체 상세 내역" subtitle="기간별 내역을 확인합니다" />);
  expect(screen.getByRole('heading',{level:2,name:'거래처별 전체 상세 내역'})).toBeInTheDocument();
  expect(screen.getByText('기간별 내역을 확인합니다')).toBeInTheDocument();
  expect(container.firstElementChild).toHaveClass('hidden','md:flex');
});

it('우측 조작이 있으면 모바일에도 조작을 유지하고 원래 콜백을 한 번 실행한다',()=>{
  const action=vi.fn();
  const {container,rerender}=render(<PageHeader title="주문" right={<><button onClick={action}>새 주문</button><button>내역 보기</button></>} />);
  expect(container.firstElementChild).toHaveClass('flex','flex-wrap');
  expect(container.firstElementChild).not.toHaveClass('hidden');
  expect(screen.getByRole('heading').parentElement).toHaveClass('hidden','md:block');
  fireEvent.click(screen.getByRole('button',{name:'새 주문'}));
  expect(action).toHaveBeenCalledOnce();
  rerender(<PageHeader title="새 제목" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText('기간별 내역을 확인합니다')).not.toBeInTheDocument();
});
it('복구 조작은 우측 조작과 별도 줄에 두고 자손 버튼 크기는 강제하지 않는다',()=>{
  const click=vi.fn();
  const {container}=render(<PageHeader title="전표" right={<button>전표내역</button>} recovery={<button onClick={click}>실패 2</button>}/>);
  const normal=screen.getByRole('button',{name:'전표내역'}),recovery=screen.getByRole('button',{name:'실패 2'});
  expect(normal.parentElement).not.toBe(recovery.parentElement);expect(recovery.parentElement).toHaveClass('w-full','border-t');
  expect(container.innerHTML).not.toContain('[&_button]');expect(container.innerHTML).not.toContain('[&>div]');
  fireEvent.click(recovery);expect(click).toHaveBeenCalledOnce();
});
it('새 슬롯은 제목·좌측 전폭 탭·우측 행동·복구 순서이며 기존 right 조작은 보존한다',()=>{
 const tab=vi.fn(),action=vi.fn(),recovery=vi.fn();const {container}=render(<PageHeader title="배치 시험" right={<button>기존 우측</button>} tabs={<button onClick={tab}>보기 탭</button>} actions={<button onClick={action}>등록</button>} recovery={<button onClick={recovery}>실패 작업</button>}/>);
 const title=screen.getByRole('heading',{name:'배치 시험'}),tabs=screen.getByRole('button',{name:'보기 탭'}).parentElement!,actions=screen.getByRole('button',{name:'등록'}).parentElement!,failed=screen.getByRole('button',{name:'실패 작업'}).parentElement!;
 expect(title.compareDocumentPosition(tabs)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tabs.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(actions.compareDocumentPosition(failed)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tabs).toHaveClass('w-full','justify-start');expect(actions).toHaveClass('w-full','justify-end','flex-wrap');expect(screen.getByRole('button',{name:'기존 우측'}).parentElement).toHaveClass('ml-auto');expect(title.parentElement).toHaveClass('hidden','md:block');expect(container.firstElementChild).not.toHaveClass('hidden');
 fireEvent.click(screen.getByRole('button',{name:'보기 탭'}));fireEvent.click(screen.getByRole('button',{name:'등록'}));fireEvent.click(screen.getByRole('button',{name:'실패 작업'}));for(const fn of [tab,action,recovery])expect(fn).toHaveBeenCalledOnce();
});
