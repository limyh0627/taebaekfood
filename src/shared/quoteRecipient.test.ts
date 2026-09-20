import { describe, expect, it } from 'vitest';
import { quoteRecipient } from './quoteRecipient';

describe('견적 받을 곳', () => {
  it('등록되지 않은 업체도 이름만 있으면 견적을 낼 수 있다', () => {
    expect(quoteRecipient('', ' 새봄상회 ')).toEqual({ partnerId: '', partnerName: '새봄상회' });
  });

  it('등록 거래처는 ID와 이름을 함께 남긴다', () => {
    expect(quoteRecipient('partner-1', '가득찬')).toEqual({ partnerId: 'partner-1', partnerName: '가득찬' });
  });

  it('받는 업체 이름이 없으면 저장할 수 없다', () => {
    expect(quoteRecipient('', '   ')).toBeNull();
  });
});
