import {expect,it} from 'vitest';
import {templateAccrRows,templateJournalLines} from './cashTemplateProjection';
import type {CashTemplate} from './cashTemplateCatalog';
import * as legacy from '../../../shared/cashTemplates';
const template=(patch:Partial<CashTemplate>):CashTemplate=>({id:'test',label:'합성',dir:'대체',mode:'일반',amount:110,...patch});
it('facade는 투영 정본함수와 동일 binding이다',()=>{expect(legacy.templateAccrRows).toBe(templateAccrRows);expect(legacy.templateJournalLines).toBe(templateJournalLines);});
it('한 금액으로 채울 수 없는 3줄 양식은 0과 perVoucher를 유지한다',()=>{const t=template({transferLines:[{accountCode:'255',side:'차변'},{accountCode:'135',side:'대변'},{accountCode:'261',side:'대변'}]});expect(templateJournalLines(t).map(l=>[l.amount,l.perVoucher])).toEqual([[0,true],[0,true],[0,true]]);expect(templateAccrRows(t).map(r=>r.price)).toEqual(['','','']);});
it('급여 공제와 통장 실지급 및 일반 입금 차대 방향을 보존한다',()=>{expect(templateJournalLines(template({dir:'출금',mode:'급여',gross:100,deduction:20})).map(l=>[l.side,l.amount])).toEqual([['차변',100],['대변',20],['대변',80]]);expect(templateJournalLines(template({dir:'입금',accountCode:'800'}),'합성통장').map(l=>[l.side,l.label,l.amount])).toEqual([['차변','합성통장',110],['대변','',110]]);});
it('거래처 매입 과세는 공급가·부가세·채무 총액을 공유 계산으로 투영한다',()=>{const lines=templateJournalLines(template({dir:'줄돈',statementType:'매입',partnerId:'p',accountCode:'401',taxExempt:false}));expect(lines.map(l=>[l.side,l.amount])).toEqual([['차변',100],['차변',10],['대변',110]]);});