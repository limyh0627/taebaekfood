/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import ItemLedger from './ItemLedger';
import type { Item, Order } from '../src/shared/types';
import { buildBomIndex, getBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
import type { ItemInventoryEntry } from '../src/features/admin/itemLedger';

it('제품별원장의 캔·벌크 선택 모두 같은 개봉 원본을 넘겨 개수/kg를 구분한다', () => {
  const items = [
    { id: 'can', name: '깨분참기름-캔', subtype: '캔', type: 'semi', unit: '개', stock: 2 },
    { id: 'bulk', name: '깨분참기름', subtype: '벌크', type: 'semi', unit: 'kg', stock: 16.5 },
  ] as Item[];
  const entry = { id: 'unpack', rawItemId: 'bulk', material: '깨분참기름', kind: 'unpack',
    source: { type: 'unpack', id: 'can' }, date: '2026-09-02', createdAt: '2026-09-02T01:00:00Z',
    received: 0, used: 0, canCount: 1, appliedDeltaKg: 16.5, note: '1캔 개봉', unit: 'kg',
  } as ItemInventoryEntry;
  render(<ItemLedger items={items} orders={[]} rawEntries={[entry]} companyId="taebaek" />);
  const query=screen.getByRole('region',{name:'검색조건'});expect([...query.querySelectorAll('[data-query-row]')].map(row=>row.getAttribute('data-query-row'))).toEqual(['condition','search']);
  fireEvent.click(screen.getByRole('button', { name: /깨분참기름-캔/ }));
  expect(screen.getByText('캔 개봉')).toBeTruthy();
  expect(screen.getByText('-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^깨분참기름(?!-캔)/ }));
  expect(screen.getByText('+18.013')).toBeTruthy();
  expect(screen.getByText('현재 18.013L')).toBeTruthy();
  expect(screen.getByText('18.013L')).toBeTruthy();
  expect(screen.getByText(/캔 -1개 → 벌크 \+16.5kg/)).toBeTruthy();
});


it('회사 원장 화면은 명시 BOM을 사용하고 같은 배열의 색인 변경도 다시 계산한다', () => {
  const items = [
    { id: 'a-box', companyId: 'taebaek', name: '태백 박스', type: 'product', stock: 0, unit: '박스' },
    { id: 'a-loose', companyId: 'taebaek', name: '태백 낱개', type: 'product', stock: 0, unit: '개' },
    { id: 'a-cap', companyId: 'taebaek', name: '태백 캡', type: 'submaterial', stock: 100, unit: '개' },
  ] as Item[];
  const orders = [{ id: 'a-order', companyId: 'taebaek', deliveredAt: '2026-09-01', partnerName: '거래처', producedUnits: [{ itemId: 'a-box', qty: 2 }], shippedOut: true,
    items: [{ itemId: 'a-box', name: '태백 박스', quantity: 100, boxQuantity: 5 }] }] as Order[];
  const inputs = (count: number) => ({ bom: buildBomIndex(items, [
    { parent_id: 'a-box', child_id: 'a-loose', quantity: 20 },
    { parent_id: 'a-box', child_id: 'a-cap', quantity: count },
  ]), pack: buildPackIndex() });
  const previous = getBomIndex(); setBomIndex(buildBomIndex([], []));
  try {
    const { rerender } = render(<ItemLedger companyId="taebaek" items={items} orders={orders} orderUnitInputs={inputs(20)} />);
    fireEvent.click(screen.getByRole('button', { name: /태백 박스/ })); expect(screen.getByText('-5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /태백 캡/ })); expect(screen.getByText('-40')).toBeTruthy();
    rerender(<ItemLedger companyId="taebaek" items={items} orders={orders} orderUnitInputs={inputs(10)} />);
    expect(screen.getByText('-20')).toBeTruthy(); expect(screen.queryByText('-40')).toBeNull();
  } finally { setBomIndex(previous); }
});

it('제품 원장은 기간을 양끝 포함으로 제한해도 전체 재고와 행 잔량을 다시 계산하지 않는다', () => {
 const items=[{id:'can-date',companyId:'taebaek',name:'날짜 검수 캔',subtype:'캔',type:'semi',unit:'개',stock:7}] as Item[];
 const entries=['2026-09-01','2026-09-02','2026-09-03'].map((date,i)=>({id:'date-'+i,companyId:'taebaek',rawItemId:'bulk',material:'깨분참기름',kind:'unpack',source:{type:'unpack',id:'can-date'},date,createdAt:date+'T01:00:00Z',received:0,used:0,canCount:1,appliedDeltaKg:16.5,note:'개봉-'+i,unit:'kg'} as ItemInventoryEntry));
 const view=render(<ItemLedger items={items} orders={[]} rawEntries={entries} companyId="taebaek"/>);
 fireEvent.click(within(view.container).getByRole('button',{name:/날짜 검수 캔/}));
 const ui=within(view.container), before=ui.getByText('개봉-1').closest('tr')!.textContent;
 fireEvent.change(ui.getByLabelText('제품 원장 기록일 시작일'),{target:{value:'2026-09-02'}});
 fireEvent.change(ui.getByLabelText('제품 원장 기록일 종료일'),{target:{value:'2026-09-02'}});
 expect(ui.queryByText('개봉-0')).toBeNull();expect(ui.queryByText('개봉-2')).toBeNull();expect(ui.getByText('개봉-1').closest('tr')!.textContent).toBe(before);
 expect(ui.getByText(/전체 기록 기준/)).toBeTruthy();
 fireEvent.click(ui.getByRole('button',{name:'전체'}));expect(ui.getByText('개봉-0')).toBeTruthy();expect(ui.getByText('개봉-2')).toBeTruthy();
});
