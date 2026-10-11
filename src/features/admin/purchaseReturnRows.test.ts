import { expect, it } from 'vitest';
import { purchaseReturnRows } from './purchaseReturnRows';
import type { IssuedStatement, Item, ReturnRequest } from '../../shared/types';
const source = {id:'s',companyId:'taebaek',type:'매입',items:[{itemId:'raw',name:'들깨',qty:2,purchaseUnit:'20kg포대',unitKg:20},{itemId:'raw',name:'들깨',qty:3,purchaseUnit:'25kg포대',unitKg:25}]} as IssuedStatement;
it('같은 품목 다른포장 두 줄은 각각 원전표 index와 단위를 보존한다',()=>{expect(purchaseReturnRows(source,[],[])).toEqual([{itemId:'raw',name:'들깨',qty:'',unit:'20kg포대',sourceLineIndex:0,unitKg:20,originalQty:2,remainingQty:2},{itemId:'raw',name:'들깨',qty:'',unit:'25kg포대',sourceLineIndex:1,unitKg:25,originalQty:3,remainingQty:3}]);});
it('처리된 반품은 해당 줄 잔량만 줄이고 상대회사 반품은 섞지 않는다',()=>{const requests=[{companyId:'taebaek',linkedStatementId:'s',returnType:'매입',status:'processed',items:[{itemId:'raw',sourceLineIndex:1,quantity:1.5}]},{companyId:'punghoe',linkedStatementId:'s',returnType:'매입',status:'processed',items:[{itemId:'raw',sourceLineIndex:0,quantity:2}]}] as unknown as ReturnRequest[];expect(purchaseReturnRows(source,[],requests).map(row=>row.remainingQty)).toEqual([2,1.5]);});
