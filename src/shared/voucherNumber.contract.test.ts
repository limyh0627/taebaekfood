import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../functions/src/shared/voucherNumber', async importOriginal => {
  const actual = await importOriginal<typeof import('../../functions/src/shared/voucherNumber')>();
  return { formatVoucherNo: vi.fn(actual.formatVoucherNo) };
});
vi.mock('firebase-functions/v2/https',()=>({HttpsError:class extends Error{},onCall:(_o:unknown,h:unknown)=>h}));
import { formatVoucherNo } from '../../functions/src/shared/voucherNumber';
import { formatVoucherNo as serverFormat } from '../../functions/src/voucherIssue';
import { nextDocNo, claimDocNo, releaseDocNo, resetDocNoClaims } from './voucherStamp';
beforeEach(()=>{ resetDocNoClaims();vi.mocked(formatVoucherNo).mockClear(); });
describe('실제 앱과 서버의 번호 포맷 소비',()=>{
 it('정상 날짜와 갈래는 같은 함수를 소비한다',()=>{
  expect(serverFormat).toBe(formatVoucherNo);
  expect(nextDocNo('2026-10-07',[{docNo:'반품261007-07'},{docNo:'반품261007-009'}],'반품')).toBe('반품261007-010');
  expect(formatVoucherNo).toHaveBeenCalledWith('2026-10-07',10,'반품');
  expect(serverFormat('2026-10-07',10,'반품')).toBe('반품261007-010');
 });
 it('예약·해제와 세 자리 초과 순번은 기존 계약이다',()=>{
  const prior=[{docNo:'261007-999'},{docNo:'261007-nan'}];
  const claimed=claimDocNo('2026-10-07',prior);
  expect(claimed).toBe('261007-1000');
  expect(nextDocNo('2026-10-07',prior)).toBe('261007-1001');
  releaseDocNo(claimed);
  expect(nextDocNo('2026-10-07',prior)).toBe('261007-1000');
 });
 it('짧거나 빈 날짜는 기존 앱 fallback이며 서버 포맷을 강제하지 않는다',()=>{
  expect(nextDocNo('2026-10',[{docNo:'2026-10-002'}])).toBe('2026-10-003');
  expect(nextDocNo('',[])).toBe('-001');
  expect(formatVoucherNo).not.toHaveBeenCalled();
 });
});
