/**
 * 견적서는 아직 거래를 시작하지 않은 문의처에도 낼 수 있다.
 * 등록 거래처면 ID를 함께 남기고, 미등록 업체면 이름만 남겨 거래처 원장과 섞지 않는다.
 */
export function quoteRecipient(partnerId: string | undefined, partnerName: string | undefined) {
  const name = String(partnerName ?? '').trim();
  if (!name) return null;
  return {
    partnerId: String(partnerId ?? '').trim(),
    partnerName: name,
  };
}
