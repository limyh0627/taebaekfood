/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import PageHeader from './PageHeader';

it('제목과 부제를 유지하고 조작이 없으면 모바일 헤더 공간을 만들지 않는다',()=>{
  const {container}=render(<PageHeader title="거래처별 전체 상세 내역" subtitle="기간별 내역을 확인합니다" />);
  expect(screen.getByRole('heading',{level:2,name:'거래처별 전체 상세 내역'})).toBeInTheDocument();
  expect(screen.getByText('기간별 내역을 확인합니다')).toBeInTheDocument();
  expect(container.querySelector('[data-page-header-slot="header"]')).toHaveClass('hidden','md:flex');
  expect(container.firstElementChild).toHaveClass('hidden','md:flex');
});

it('우측 조작이 있으면 모바일에도 조작을 유지하고 원래 콜백을 한 번 실행한다',()=>{
  const action=vi.fn();
  const {container,rerender}=render(<PageHeader title="주문" right={<><button onClick={action}>새 주문</button><button>내역 보기</button></>} />);
  expect(container.querySelector('[data-page-header-slot="header"]')).toHaveClass('flex','flex-wrap');
  expect(container.querySelector('[data-page-header-slot="header"]')).not.toHaveClass('hidden');
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
it('새 슬롯은 제목·우측 전폭 탭·우측 행동·복구 순서이며 기존 right 조작은 보존한다',()=>{
 const tab=vi.fn(),action=vi.fn(),recovery=vi.fn();const {container}=render(<PageHeader title="배치 시험" right={<button>기존 우측</button>} tabs={<button onClick={tab}>보기 탭</button>} actions={<button onClick={action}>등록</button>} recovery={<button onClick={recovery}>실패 작업</button>}/>);
 const title=screen.getByRole('heading',{name:'배치 시험'}),tabs=screen.getByRole('button',{name:'보기 탭'}).parentElement!,actions=screen.getByRole('button',{name:'등록'}).parentElement!,failed=screen.getByRole('button',{name:'실패 작업'}).parentElement!;
 expect(title.compareDocumentPosition(tabs)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tabs.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(actions.compareDocumentPosition(failed)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tabs).toHaveClass('w-full','justify-end');expect(actions).toHaveClass('w-full','justify-end','flex-wrap');expect(screen.getByRole('button',{name:'기존 우측'}).parentElement).toHaveClass('ml-auto');expect(title.parentElement).toHaveClass('hidden','md:block','md:w-auto','md:flex-1');expect(tabs).toHaveClass('ml-auto','md:w-auto');expect(container.querySelector('[data-page-header-slot="header"]')).not.toHaveClass('hidden');
 fireEvent.click(screen.getByRole('button',{name:'보기 탭'}));fireEvent.click(screen.getByRole('button',{name:'등록'}));fireEvent.click(screen.getByRole('button',{name:'실패 작업'}));for(const fn of [tab,action,recovery])expect(fn).toHaveBeenCalledOnce();
});

it('전폭 내부 탭행과 보조 대기표시도 같은 오른쪽 그룹으로 두고 기존 right는 보존한다',()=>{
 const click=vi.fn();render(<PageHeader title="중첩 탭" right={<button>옛 행동</button>} tabs={<div className="w-full"><div className="flex w-full"><button onClick={click}>보드</button><span className="ml-auto">대기 1</span></div></div>}/>);
 const slot=screen.getByRole('button',{name:'보드'}).closest('[data-page-header-slot="tabs"]')!;expect(slot).toHaveClass('justify-end','max-w-full','flex-wrap','[&>div]:[justify-content:safe_flex-end]','[&>div>.ml-auto]:ml-0','[&>div>div.flex]:[justify-content:safe_flex-end]');expect(screen.getByRole('button',{name:'옛 행동'}).parentElement).toHaveClass('ml-auto');fireEvent.click(screen.getByRole('button',{name:'보드'}));expect(click).toHaveBeenCalledOnce();
});

it('업무 행동과 복구는 제목·탭 헤더의 바깥 형제이며 행동만 있으면 모바일 빈 헤더를 만들지 않는다',()=>{
 const {container,rerender}=render(<PageHeader title="본문 분리" tabs={<button>조회</button>} actions={<button>등록</button>} recovery={<button>복구</button>}/>);const header=container.querySelector('[data-page-header-slot="header"]')!,action=screen.getByRole('button',{name:'등록'}).parentElement!,recovery=screen.getByRole('button',{name:'복구'}).parentElement!;expect(header).not.toContainElement(action);expect(header).not.toContainElement(recovery);expect(action.parentElement).toBe(header.parentElement);expect(recovery.parentElement).toBe(header.parentElement);expect(header).toHaveClass('md:border-b');expect(action).not.toHaveClass('md:border-b');rerender(<PageHeader title="본문 분리" actions={<button>등록</button>}/>);expect(container.querySelector('[data-page-header-slot="header"]')).toHaveClass('hidden','md:flex');expect(screen.getByRole('button',{name:'등록'})).toBeInTheDocument();
});
