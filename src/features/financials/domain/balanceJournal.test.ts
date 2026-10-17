import {expect,it,vi} from 'vitest';
import {journalizeInventory,buildOpeningEntry} from './balanceJournal';
it('재고 월순서·기초월 건너뛰기·직전스냅샷 기준과 윤년 월말을 유지한다',()=>{
 const snapshots=[{id:'mar',yearMonth:'2024-03',value:9.75},{id:'feb',yearMonth:'2024-02',value:12.25},{id:'jan',yearMonth:'2024-01',value:10.5},{id:'bad',yearMonth:'bad',value:999}];const before=JSON.stringify(snapshots);
 const out=journalizeInventory(snapshots,100,'2024-01');
 expect(out.map(j=>[j.sourceId,j.date,j.lines])).toEqual([
 ['feb','2024-02-29',[{accountCode:'146',debit:1.75,credit:0},{accountCode:'500',debit:0,credit:1.75}]],
 ['mar','2024-03-31',[{accountCode:'500',debit:2.5,credit:0},{accountCode:'146',debit:0,credit:2.5}]]]);
 expect(out[0].createdAt).toBe('2024-02-29T00:00:00.000Z');expect(out[0].memo).toBe('재고 조정 2024-02 (실사 '+(12.25).toLocaleString()+'원)');expect(JSON.stringify(snapshots)).toBe(before);
});
it('동액 재고는 생략하고 기본 sourceID와 기존 소수 둘째 반올림을 유지한다',()=>{
 const out=journalizeInventory([{yearMonth:'2026-01',value:1.234},{yearMonth:'2026-02',value:1.234},{yearMonth:'2026-03',value:0}],0);
 expect(out).toHaveLength(2);expect(out[0]).toMatchObject({sourceId:'inv-2026-01',date:'2026-01-31'});
 expect(out[0].lines[0].debit).toBe(1.23);expect(out[1].lines[0]).toEqual({accountCode:'500',debit:1.23,credit:0});
});
it('기초 정상방향·거래처와 기본자본331을 보존하고 음수차액은 사용자 자본 차변으로 맞춘다',()=>{
 const normal=vi.fn((code:string):'debit'|'credit'=>code==='251'?'credit':'debit');
 const ob={date:'2026-01-01',lines:[{accountCode:'108',amount:10.254,partnerId:'p'},{accountCode:'251',amount:3.254},{accountCode:'0',amount:0}]};const before=JSON.stringify(ob);
 const out=buildOpeningEntry(ob,normal);
 expect(out.lines).toEqual([{accountCode:'108',debit:10.25,credit:0,partnerId:'p'},{accountCode:'251',debit:0,credit:3.25},{accountCode:'331',debit:0,credit:7}]);
 expect(normal.mock.calls.map(args=>args[0])).toEqual(['108','251']);expect(out).toMatchObject({id:'je-opening',sourceType:'수동',sourceId:'opening',createdAt:'2026-01-01T00:00:00.000Z'});
 expect(buildOpeningEntry({date:ob.date,capitalAccount:'375',lines:[{accountCode:'251',amount:2.5}]},normal).lines.at(-1)).toEqual({accountCode:'375',debit:2.5,credit:0});
 expect(buildOpeningEntry({date:ob.date,lines:[]},normal).lines).toEqual([]);expect(JSON.stringify(ob)).toBe(before);
});
