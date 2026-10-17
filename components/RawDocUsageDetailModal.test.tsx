/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RawDocUsageDetailModal from './RawDocUsageDetailModal';
import type {RawDocUsageSelection} from '../src/shared/rawDocUsageDetail';
afterEach(cleanup);
const detail:RawDocUsageSelection={companyId:'taebaek',month:'2026-10',material:'깨분참기름',date:'2026-10-15',segment:'2026-10-15#1',total:1731,contributions:[{kind:'document',itemName:'서류 품목',rawKg:1731,sources:[{orderId:'order',lineId:'line',lineIndex:0,itemId:'box',itemName:'합성 기름',spec:'1.8L',documentQuantity:240,documentOilKg:395.76,roundedOilKg:396,inputQuantity:20,stockUnits:20,rawContributionKg:1731,production:{id:'record',finishedQty:240}}]},{kind:'excluded',itemName:'깨분참기름',rawKg:0,sources:[],recordId:'op_id',reportedDeltaKg:-1245.721,note:'긴 원문'}]};
it('서류 수량·배분과 저장 생산수량을 구분하고 중복 제외 원문은 합계0으로 설명한다',()=>{const close=vi.fn();render(<RawDocUsageDetailModal detail={detail} onClose={close}/>);expect(screen.getByText(/서류 출고 240개/)).toBeTruthy();expect(screen.getByText('깨분참기름 서류 배분 1,731kg')).toBeTruthy();expect(screen.getByText('확인된 생산수량 240개')).toBeTruthy();expect(screen.getByText(/서류 합계 중복 반영 제외 0kg/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'원료수불부 사용량 상세 닫기'}));expect(close).toHaveBeenCalledOnce();});
it('저장 생산근거가 없으면 출고수량을 제조수량으로 바꾸지 않고 원문 번호를 보존한다',()=>{const next=structuredClone(detail);next.contributions[0].sources[0].production=undefined;render(<RawDocUsageDetailModal detail={next} onClose={()=>{}}/>);expect(screen.getByText('생산수량 미확인')).toBeTruthy();expect(screen.queryByText(/확인된 생산수량/)).toBeNull();expect(screen.getByText(/주문 order · 줄 line/)).toBeTruthy();});
