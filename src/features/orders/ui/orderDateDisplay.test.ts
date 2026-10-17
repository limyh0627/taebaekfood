import {afterEach,expect,it,vi} from 'vitest';
import {OrderStatus,type Order} from '../../../shared/types';
import {fmtYYMMDD,expiryFromMfgDate,seoulDateInput,isCarriedOrder} from './orderDateDisplay';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('표시 날짜는 UTC 변환 없이 로컬 getter를 그대로 사용한다',()=>{
 const date=new Date('2026-12-31T23:59:00Z');vi.spyOn(date,'getFullYear').mockReturnValue(2031);vi.spyOn(date,'getMonth').mockReturnValue(0);vi.spyOn(date,'getDate').mockReturnValue(2);
 expect(fmtYYMMDD(date)).toBe('31.01.02');
});
it.each([['2024-02-29','25.02.28'],['2023-03-01','24.02.29'],['2026-12-31T12:34:56Z','27.12.31']])('제조일 %s에 원래대로 로컬 365일을 더한다', (input,expected)=>expect(fmtYYMMDD(expiryFromMfgDate(input))).toBe(expected));
it('Seoul 월 경계의 날짜 입력을 기기 지역시각과 구분한다',()=>{
 expect(seoulDateInput(new Date('2026-09-30T14:59:59Z'))).toBe('2026-09-30');expect(seoulDateInput(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10-01');
});
it.each([OrderStatus.PENDING,OrderStatus.PROCESSING,OrderStatus.SHIPPED,OrderStatus.DISPATCHED,OrderStatus.ON_HOLD])('%s는 서울 기준 이전 달 주문만 이월이다',status=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T15:00:00Z'));
 const order=(createdAt:string)=>({status,createdAt} as Order);
 expect(isCarriedOrder(order('2026-10-31T14:59:59Z'))).toBe(true);expect(isCarriedOrder(order('2026-10-31T15:00:00Z'))).toBe(false);expect(isCarriedOrder(order('bad-date'))).toBe(false);
});
it('완료 주문은 오래돼도 이월 표시하지 않는다',()=>expect(isCarriedOrder({status:OrderStatus.DELIVERED,createdAt:'2020-01-01'} as Order)).toBe(false));
