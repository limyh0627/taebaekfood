import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {getHelpMenuGuide,getHelpMenuGuides} from './helpGuides';

// 실제 부모의 두 메뉴 배열을 읽는다. 테스트용 가짜 메뉴를 유지해 누락을 숨기지 않는다.
function actualMenuIds() {
  const source=ts.createSourceFile('AdminApp.tsx',readFileSync('src/features/admin/AdminApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let branch:ts.ConditionalExpression|undefined;
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='menuEntries') {
      function find(n:ts.Node) { if(ts.isConditionalExpression(n)&&n.condition.getText(source)==='isAdmin')branch=n; else ts.forEachChild(n,find); }
      if(node.initializer)find(node.initializer);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);if(!branch)throw Error('실제 메뉴 분기를 찾지 못했습니다.');
  function ids(node:ts.Expression) {if(!ts.isArrayLiteralExpression(node))throw Error('실제 메뉴가 배열이 아닙니다.');return node.elements.map(row=>{if(!ts.isObjectLiteralExpression(row))throw Error('메뉴 구조 확인 필요');const prop=row.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='id') as ts.PropertyAssignment;return (prop.initializer as ts.StringLiteral).text;});}
  return {admin:ids(branch.whenTrue),staff:ids(branch.whenFalse)};
}
describe('현재 메뉴별 실제 기능 안내',()=>{
 it('서버와 화면이 같은 역할별 단일 원본을 사용한다',()=>{
   expect(readFileSync('src/shared/helpGuides.ts','utf8')).toContain("export * from '../../functions/src/shared/helpGuides'");
   const menus=actualMenuIds();
   for(const mode of ['admin','staff'] as const)for(const {viewId,guide} of getHelpMenuGuides(mode)){
     expect(guide).toEqual(getHelpMenuGuide(viewId,mode));
     expect([...menus[mode],'mypage']).toContain(viewId);
   }
   expect(getHelpMenuGuide('orders','staff').features.find(f=>f.id==='order-paste')?.steps.join(' ')).toContain('주문 생성 (N건)');
 });
 it('실제 관리자29/직원12 메뉴의 view 경로를 빠짐없이 안내하고 action은 별도다',()=>{
   const menus=actualMenuIds();expect(menus.admin).toHaveLength(29);expect(menus.staff).toHaveLength(12);
   for(const mode of ['admin','staff'] as const)for(const id of [...menus[mode],'mypage']){
     const view=id==='ledger-partner'?'ledger-cash':id;
     const result=getHelpMenuGuide(view,mode);
     if(['qr-label','partner-portal'].includes(id)){expect(result.features).toEqual([]);continue;}
     expect(result.features.length,`${mode}/${id}`).toBeGreaterThan(0);
     expect(result.features.length).toBeLessThanOrEqual(4);
     expect(new Set(result.features.map(f=>f.id)).size).toBe(result.features.length);
     for(const f of result.features){expect(f.title.trim()).not.toBe('');expect(f.steps.length).toBeGreaterThan(0);expect(f.steps.length).toBeLessThanOrEqual(4);expect(JSON.stringify(f)).not.toMatch(/(?:components\/|src\/|https?:\/\/)/);}
   }
 });
 it('배송·옛품목 별칭은 같은 역할의 실제화면으로 연결한다',()=>{
   for(const mode of ['admin','staff'] as const){expect(getHelpMenuGuide('shipping',mode)).toEqual(getHelpMenuGuide('orders',mode));expect(getHelpMenuGuide('item-price-management',mode)).toEqual(getHelpMenuGuide('item-management',mode));}
   expect(getHelpMenuGuide('ai-consultant','admin')).toEqual(getHelpMenuGuide('dashboard','admin'));
   expect(getHelpMenuGuide('cost-management','admin')).toEqual(getHelpMenuGuide('profit-analysis','admin'));
 });
 it('직원에게 관리자 전표·원장·승인·공지작성·재고처리 안내를 노출하지 않는다',()=>{
   for(const id of ['trade-statement','ledger-cash','hr','partners','admin-checklist','tax-statement','partner-signup','dashboard'])expect(getHelpMenuGuide(id,'staff').features).toEqual([]);
   expect(getHelpMenuGuide('notice','staff').features.map(f=>f.id)).toEqual(['notice-read']);
   expect(getHelpMenuGuide('notice','admin').features.map(f=>f.id)).toContain('notice-write');
   expect(getHelpMenuGuide('inventory','staff').features.map(f=>f.id)).not.toContain('inventory-receive');
   expect(getHelpMenuGuide('item-management','staff').features.map(f=>f.id)).not.toContain('item-edit');
 });
 it('주문 생성은 실제 세 갈래와 복사주문 실패작업 확인을 구별한다',()=>{
   const rows=getHelpMenuGuide('orders','staff').features;
   expect(rows.find(f=>f.id==='order-create')?.steps.join(' ')).toContain('직접 선택');
   expect(rows.find(f=>f.id==='order-create')?.note).toContain('재고 만들기');
   expect(rows.find(f=>f.id==='order-paste')?.steps.join(' ')).toContain('주문 내역 붙여넣기');
   expect(rows.find(f=>f.id==='order-paste')?.recovery).toContain('복사주문 실패 작업');
 });
 it('일반전표 여섯 갈래와 서버결과 확인·동일원문 복구를 안내한다',()=>{
   const rows=getHelpMenuGuide('trade-statement','admin').features;
   const create=rows.find(f=>f.id==='voucher-create')!;
   for(const label of ['매입','매출','대체','입금','출금','회사이체'])expect(create.steps.join(' ')).toContain(label);
   const recover=rows.find(f=>f.id==='statement-recovery')!;
   expect(recover.steps.join(' ')).toContain('처리결과 확인');
   expect(recover.steps.join(' ')).toContain('같은 첫 요청');
   expect(recover.note).toContain('이전 전표 재시도');
   expect(recover.recovery).toContain('발행 완료');expect(recover.recovery).toContain('임의로 모두 지우거나');
 });
 it('두 원장은 view만으로 선택탭을 단정하지 않고 모두 안내한다',()=>{
   const result=getHelpMenuGuide('ledger-cash','admin');expect(result.features.map(f=>f.id)).toEqual(['cash-ledger-read','partner-ledger-read']);expect(result.features[1].note).toContain('함께 안내합니다');
 });
 it('알수없는화면·view없는action은 지원대기 안내이며 호출마다 독립자료를 반환한다',()=>{
   for(const id of [undefined,'unknown','qr-label','partner-portal','__proto__','constructor']){const result=getHelpMenuGuide(id,'staff');expect(result.features).toEqual([]);expect(result.menuTitle).toContain('준비 중');}
   const a=getHelpMenuGuide('orders','admin');a.features[0].steps[0]='변경';a.features.pop();expect(getHelpMenuGuide('orders','admin').features).toHaveLength(4);expect(getHelpMenuGuide('orders','admin').features[0].steps[0]).not.toBe('변경');
 });
});
