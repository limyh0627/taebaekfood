import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {returnBusinessText} from './returnBusinessEvidence';
it('서버 기존 businessHash 원문과 동치이며 map순서만 무시한다',()=>{
 const a={companyId:'taebaek',partnerId:'p',returnType:'매입',totalAmount:110,items:[{itemId:'a',quantity:1,sourceLineIndex:0}],payableAccountCode:'253'};
 const b={...a,items:[{sourceLineIndex:0,quantity:1,itemId:'a'}]};expect(returnBusinessText(a)).toBe(returnBusinessText(b));
 expect(returnBusinessText({...a,payableAccountCode:'251'})).not.toBe(returnBusinessText(a));expect(returnBusinessText({...a,items:[{...a.items[0],sourceLineIndex:1}]})).not.toBe(returnBusinessText(a));
 const text=returnBusinessText(a); expect(text).toBe('{"companyId":"taebaek","items":[{"itemId":"a","quantity":1,"sourceLineIndex":0}],"partnerId":"p","payableAccountCode":"253","returnType":"매입","totalAmount":110}');expect(createHash('sha256').update(text).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
});
it('처리상태는 제외하고 원전표/행순서 및 standalone계정은 승인원문에 포함한다',()=>{
 const a={companyId:'taebaek',partnerId:'p',linkedStatementId:'s',totalAmount:1,items:[{itemId:'a'},{itemId:'b'}]};
 expect(returnBusinessText({...a,status:'processed'})).toBe(returnBusinessText(a));expect(returnBusinessText({...a,items:[...a.items].reverse()})).not.toBe(returnBusinessText(a));
 expect(returnBusinessText({...a,linkedStatementId:'other'})).not.toBe(returnBusinessText(a));
});
