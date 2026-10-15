// 기본 locale 표시는 소수 셋째 자리에서 잘려 수량이 0이나 다른 값으로 보일 수 있다.
export const formatQuantity = (n: number): string =>
  n.toLocaleString('ko-KR', { maximumSignificantDigits: 21 });
