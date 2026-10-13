import {describe,expect,it} from 'vitest';
import {receiveOemFinishedGoods,assertOemReceiptWriteLimit} from './oemReceiptCommand';
const valid={poId:'po',operationId:'oem-receive:po',releaseId:'release',date:'2026-10-13',returns:[],bulk:[{material:'참깨',kg:1,rawItemId:'raw'}]};
describe('OEM 벌크 입력의 저장 전 검사',()=>{
 it('제품100·카운터100·벌크100의 실제 503쓰기는 거절하고 500 경계는 허용한다',()=>{
   expect(()=>assertOemReceiptWriteLimit(100,100,100)).toThrow('발주');
   expect(()=>assertOemReceiptWriteLimit(100,97,100)).not.toThrow();
   expect(()=>assertOemReceiptWriteLimit(100,98,100)).toThrow('발주');
 });
 it.each([0,-1,NaN,Infinity,0.0001])('잘못된 kg %s는 거래를 시작하지 않는다',async kg=>{let writes=0;const db={runTransaction:()=>{writes++;throw new Error('거래 시작');}};await expect(receiveOemFinishedGoods(db as any,'taebaek',{...valid,bulk:[{material:'참깨',kg}]})).rejects.toThrow('벌크');expect(writes).toBe(0);});
 it.each([{material:'',kg:1},{material:'참깨',kg:1,rawItemId:'bad/id'}])('잘못된 홀더 명세는 거래를 시작하지 않는다',async row=>{const db={runTransaction:()=>{throw new Error('거래 시작');}};await expect(receiveOemFinishedGoods(db as any,'taebaek',{...valid,bulk:[row]})).rejects.toThrow('벌크');});
 it('완제품과 벌크가 모두 비면 거절한다',async()=>{await expect(receiveOemFinishedGoods({} as any,'taebaek',{...valid,bulk:[]})).rejects.toThrow('잘못');});
});
