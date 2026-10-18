/** @vitest-environment jsdom */
import React from 'react';
import {render,fireEvent,screen,waitFor} from '@testing-library/react';
import QuotationManager from '../../components/QuotationManager';
import type {Quotation} from '../features/quotations/domain/quotation';
import {quotationSnapshot} from './quotationCommand';
import {subscribeToCollection} from './services/firebaseService';
import type {QuotationScope} from '../features/quotations/infrastructure/quotationWrites';
import {captureQuotation,prepareQuotation} from '../features/quotations/infrastructure/quotationWrites';
import { readFileSync } from 'node:fs';
import { describe, expect, it,vi } from 'vitest';

vi.mock('./firebase',()=>({auth:{currentUser:{uid:'query-actor'}},authReady:Promise.resolve(),functions:{},db:{}}));
vi.mock('./services/firebaseService',()=>({subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn(),deleteItem:vi.fn()}));
vi.mock('../features/quotations/infrastructure/quotationWrites',async importOriginal=>{const actual=await importOriginal<typeof import('../features/quotations/infrastructure/quotationWrites')>();return {...actual,captureQuotation:vi.fn(async(scope:QuotationScope,selected:Quotation)=>({reference:{companyId:scope.companyId,planId:'read-open',targetId:selected.id},expectedVersion:'1:000000001',snapshot:quotationSnapshot({...selected,companyId:scope.companyId})})),prepareQuotation:vi.fn(),pendingQuotations:()=>[],quotationReferences:()=>[]};});

describe('견적서 회사별 구독', () => {
  it('전체 컬렉션이 아니라 로그인 회사만 조회한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(source).toMatch(/subscribeToCollection<Quotation>[\s\S]*where\('companyId',\s*'==',\s*companyId\)/);
  });

  it('등록되지 않은 품목명과 규격을 줄에서 직접 입력할 수 있다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(source).toContain('placeholder="품목명 직접 입력"');
    expect(source).toContain('placeholder="규격 직접 입력"');
    expect(source).toMatch(/name: e\.target\.value, itemId: undefined, cost: undefined/);
  });

  it('목록의 기존 견적서는 원문 열림 확인 뒤 기존 날짜와 내용으로 수정한다',async()=>{
    const selected:Quotation={id:'기존-견적',companyId:'taebaek',quoteNo:'Q250202-01',date:'2025-02-02',validUntil:'2025-02-10',partnerId:'',partnerName:'합성 문의처',lines:[{name:'원료',spec:'20kg',qty:2.5,price:100,isTaxExempt:true}],totalSupply:250,totalTax:0,totalAmount:250,createdAt:'2025-02-02T00:00:00Z'};
    vi.mocked(subscribeToCollection).mockImplementation((_name,onRows)=>{onRows([selected]);return()=>{};});
    render(React.createElement(QuotationManager,{items:[],partners:[]}));fireEvent.click(screen.getByTitle('견적서 수정'));
    await waitFor(()=>expect(screen.getByRole('button',{name:'수정 저장'})).toBeEnabled());
    expect(screen.getByDisplayValue(selected.date)).toBeInTheDocument();expect(screen.getByDisplayValue(selected.validUntil!)).toBeInTheDocument();expect(screen.getByDisplayValue('원료')).toBeInTheDocument();expect(screen.getByDisplayValue('2.5')).toBeInTheDocument();
    expect(captureQuotation).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'query-actor'},selected,expect.any(Function));expect(prepareQuotation).not.toHaveBeenCalled();
  });

  it('인쇄할 때 견적서 본문만 인쇄 대상으로 표시한다', () => {
    const parent = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(parent).toContain("from '../src/features/quotations/ui/QuotationPreview'");
    expect(parent).toContain("from '../src/features/quotations/infrastructure/printQuotation'");
    const source = readFileSync('src/features/quotations/ui/QuotationPreview.tsx', 'utf8') + readFileSync('src/features/quotations/infrastructure/printQuotation.ts', 'utf8');
    expect(source).toContain('id="quotation-print-area"');
    expect(source).toContain('id="quotation-print-document"');
    expect(source).toContain("frame.id = 'quotation-print-frame'");
    expect(source).toContain('frame.srcdoc = `<!doctype html>');
    expect(source).toContain('printWindow.print()');
    expect(source.indexOf('frame.srcdoc = `<!doctype html>')).toBeLessThan(source.indexOf('document.body.appendChild(frame)'));
  });

  it('정식 견적서 인쇄 항목을 한 장에 배치한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8') + readFileSync('src/features/quotations/ui/QuotationPreview.tsx', 'utf8');
    for (const label of ['합계금액', '공급가액']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('{viewing.partnerName} 귀하');
    expect(source).toContain('아래와 같이 견적합니다.');
    expect(source).toContain("viewing.recipientPhone || '—'");
    expect(source).toContain("viewing.deliveryTerms || '별도 협의'");
    expect(source).toContain("viewing.paymentTerms || '별도 협의'");
    expect(source).toContain("{l?.unit || ''}");
    expect(source).toContain('const printCompany = companyInfo ?? DEFAULT_COMPANY_INFO');
    expect(source).not.toContain('tracking-[0.32em]">견 적 서');
    expect(source).not.toContain('태백식품 대표 임기주');
    expect(source).toContain("printCompany.fax && <><br />FAX {printCompany.fax}</>");
    expect(source).toContain('className="h-9"');
    expect(source).not.toContain('>등록번호<');
    for (const label of ['참조', '업태·종목', '입금계좌', '비고', 'No']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('Math.max(12, viewing.lines.length)');
  });

});
