/** @vitest-environment jsdom */
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import {buildOrderProductionRecordPlan} from '../../shared/orderProductionRecordPlan';
import {OrderStatus,type Order,type Item} from '../../shared/types';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8'),ast=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback(){let expression='';function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='createProductionRecordPlan')expression=n.initializer!.getText(ast);ts.forEachChild(n,visit);}visit(ast);expect(expression).not.toBe('');return new Function('buildOrderProductionRecordPlan','allItems','addItem',`const callback = ${ts.transpileModule(expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText}; return callback;`);}
it('실제 Admin callback은 순수 builder를 전달하고 일반 생산기록 addItem을 호출하지 않는다',()=>{const write=vi.fn(),items=[{id:'p',name:'기름',type:'product',companyId:'taebaek',stock:0,minStock:0,unit:'개',cost:0} as Item],order:Order={id:'o',companyId:'taebaek',partnerName:'거래처',items:[{itemId:'p',lineId:'line',name:'기름',quantity:2,price:0}],totalAmount:0,status:OrderStatus.PROCESSING,createdAt:'2026-10-12',deliveryDate:'2026-10-12',email:'',source:'일반'},g={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'o',operationId:'op',startedAt:'2026-10-12T00:00:00Z',actorUid:'uid'};const result=callback()(buildOrderProductionRecordPlan,items,write)(order,undefined,g);expect(result.records[0]).toMatchObject({finishedQty:2,cost:0,companyId:'taebaek'});expect(write).not.toHaveBeenCalled();});
it('실제 엔진 구성에 신규 순수 callback을 연결한다',()=>{let connected=false;function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='createOrderStockEngine'){const value=n.arguments[0];if(ts.isObjectLiteralExpression(value))connected=value.properties.some(p=>p.name?.getText(ast)==='createProductionRecordPlan');}ts.forEachChild(n,visit);}visit(ast);expect(connected).toBe(true);});
it('원 주문 자동 생산기록의 옛 일반 writer가 실제 Admin 경로에 남지 않는다',()=>{expect(source).not.toContain('const createProductionRecordsForOrder');expect(source).not.toContain("await addItem('productionRecords', record)");expect(source).toContain("onAdd={(record) => addItem('productionRecords', record)}");});

it('실제 OrdersList 경로는 전체 초안 저장 callback에 연결한다',()=>{let hits=0;function walk(n:ts.Node){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(ast)==='OrdersList'){expect(n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='onSaveOrderEdit'&&p.initializer?.getText(ast)==='{handleSaveOrderEdit}')).toBe(true);hits++;}ts.forEachChild(n,walk);}walk(ast);expect(hits).toBeGreaterThan(0);});

it('부모는 주문 수정 service에 단일 주문 patch와 별도 이력 gateway를 연결한다',()=>{
 let expression='';function walk(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='runOrderEdit')expression=node.initializer!.getText(ast);ts.forEachChild(node,walk);}walk(ast);
 expect(expression).toContain('await saveOrderEdit(');expect(expression).not.toContain('classifyOrderEdit(');expect(expression).not.toContain('stampOrderItemEdits(');
 expect(expression).toContain("updateItem('orders', id, patch)");expect(expression).toContain("addItem('orderItemEdits', history)");
 expect(expression).toContain('auth.currentUser?.uid === uid');expect(expression).toContain('orderAskScope.current.token === token');
});
