import { expect, it } from 'vitest';
import { buildStatementPrintHtml } from './statementPrint';
it('매입 인쇄는 거래 포대수와 당시 kg를 따로 표시하고 단위에 HTML을 실행하지 않는다',()=>{
 const html=buildStatementPrintHtml([{name:'들깨',spec:'',qty:2,price:44000,supply:88000,tax:0,total:88000,isTaxExempt:true,purchaseUnitId:'u',purchaseUnit:'포대<script>',purchaseQty:2,unitKg:22.5,inventoryQty:45}],88000,0,88000,'매입','매입처','1','2026년 10월 11일','','p',undefined,{partners:[],allItems:[]});
 expect(html).toContain('단위당 22.5kg · 입고 45kg');expect(html).toContain('포대&lt;script&gt;');expect(html).not.toContain('포대<script>');expect(html).toContain('>2</td>');
});
