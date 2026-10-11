/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {IssuedStatement,Item,Partner,PartnerItem} from '../src/shared/types';
vi.mock('../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-uid'}},db:{}}));
// 회사별 BOM 시험은 Firebase 읽기를 하지 않고 빈 매입단위 등록표를 사용한다.
vi.mock('../src/shared/services/itemPurchaseUnitService',()=>({subscribeItemPurchaseUnits:vi.fn((_companyId,onData)=>{onData([]);return vi.fn();})}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
vi.mock('../src/features/admin/useVoucherLedger',()=>({useVoucherLedger:({issuedStatements}:{issuedStatements:IssuedStatement[]})=>({mergedStatements:issuedStatements,journalBySource:new Map(),partnerBalances:new Map(),getBalance:(s:IssuedStatement)=>s.totalAmount,canSettle:()=>false,isVouchered:()=>false,isFetchingHistory:false,forgetStatement:vi.fn()})}));
vi.mock('./CashLedger',()=>({AccountModal:()=>null}));
vi.mock('./voucher/VoucherComposer',()=>({default:()=>null}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn(async()=>true),appPrompt:vi.fn(async()=>null),appNotice:vi.fn(async()=>{})}));
import TradeStatement from './TradeStatement';
const original=getBomIndex();afterEach(()=>{setBomIndex(original);localStorage.clear();});
it('실제 매입 전표의 박스 불러오기는 상대 회사 전역 대신 화면 회사 개입수와 단가를 쓴다',async()=>{
 const loose={id:'loose',name:'낱개 기름',spec:'300ml',unit:'병',type:'product'} as Item;
 const box={...loose,id:'box',name:'박스 기름',unit:'박스'};
 const items=[loose,box],own={bom:buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:12}]),pack:buildPackIndex([])};
 setBomIndex(buildBomIndex(items,[{parent_id:'box',child_id:'loose',quantity:6}]));
 const partner={id:'partner',name:'거래처',role:'매입'} as unknown as Partner;
 const price={id:'pi',itemId:'loose',partnerId:'partner',Direction:'in',price:1000,taxType:'과세',Account_Code:'500'} as PartnerItem;
 render(<TradeStatement orders={[]} allItems={items} partners={[partner]} partnerItems={[price]} issuedStatements={[]} orderUnitInputs={own} composerOnly pendingInvoice={{partnerId:'partner',partnerName:'거래처',items:[{itemId:'box',name:'박스 기름',spec:'',qty:2,price:12000}]}}/>);
 await waitFor(()=>expect(screen.getByDisplayValue('24')).toBeInTheDocument());
 expect(screen.getByDisplayValue('낱개 기름')).toBeInTheDocument();expect(screen.getAllByDisplayValue('1000').length).toBeGreaterThan(0);
});
