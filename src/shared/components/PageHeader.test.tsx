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
