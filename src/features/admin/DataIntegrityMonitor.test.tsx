/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import DataIntegrityMonitor from './DataIntegrityMonitor';
import {auditDataIntegrity,type IntegrityAuditInput} from './dataIntegrityAudit';
vi.mock('./dataIntegrityAudit',()=>({auditDataIntegrity:vi.fn(()=>[
 {id:'a',area:'입고·재고',severity:'warning',title:'원료 연결 확인',detail:'입고 근거',reference:'입고1'},
 {id:'b',area:'전표·서류',severity:'error',title:'전표 연결 확인',detail:'발행 근거',reference:'전표1'}
])}));
const props:IntegrityAuditInput={companyId:'taebaek',orders:[],items:[],itemBoms:[],purchaseOrders:[],itemReceipts:[],rawMaterialLedger:[],rawInventories:[],issuedStatements:[],productionSalesLogs:[]};
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('점검 날짜는 오늘 기본과 경계 없는 원래 입력 스타일·상대값을 유지한다',()=>{
 render(<DataIntegrityMonitor {...props}/>);const today=new Date().toLocaleDateString('sv-SE');
 const from=screen.getByLabelText('점검 시작일'),to=screen.getByLabelText('점검 종료일');
 expect(from).toHaveValue(today);expect(to).toHaveValue(today);expect(from).toHaveClass('py-2','text-sm');
 expect(from).not.toHaveAttribute('max');expect(from.nextElementSibling).not.toHaveAttribute('aria-hidden');expect(to).not.toHaveAttribute('min');expect(from.parentElement).toHaveClass('contents');
 const before=vi.mocked(auditDataIntegrity).mock.calls.length;
 fireEvent.change(from,{target:{value:'2026-01-01'}});
 expect(auditDataIntegrity).toHaveBeenCalledTimes(before+1);expect(auditDataIntegrity).toHaveBeenLastCalledWith(expect.objectContaining({dateFrom:'2026-01-01',dateTo:today}));
 fireEvent.change(to,{target:{value:''}});expect(from).toHaveValue('2026-01-01');expect(auditDataIntegrity).toHaveBeenLastCalledWith(expect.objectContaining({dateFrom:'2026-01-01',dateTo:''}));
});
it('점검 날짜 변경은 영역·검색 필터를 초기화하지 않고 별도 초기화·새로고침을 유지한다',()=>{
 const refresh=vi.fn();render(<DataIntegrityMonitor {...props} onRefresh={refresh}/>);
 fireEvent.click(screen.getByRole('button',{name:/입고·재고/}));
 const query=screen.getByPlaceholderText('주문번호·전표번호·내용 검색');fireEvent.change(query,{target:{value:'원료'}});
 fireEvent.change(screen.getByLabelText('점검 종료일'),{target:{value:'2026-10-01'}});
 expect(query).toHaveValue('원료');expect(screen.getByText('원료 연결 확인')).toBeTruthy();expect(screen.queryByText('전표 연결 확인')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'필터 초기화'}));expect(query).toHaveValue('');expect(screen.getByText('전표 연결 확인')).toBeTruthy();
 expect(screen.getByLabelText('점검 종료일')).toHaveValue('2026-10-01');
 fireEvent.click(screen.getByRole('button',{name:'새로고침'}));expect(refresh).toHaveBeenCalledOnce();
});
