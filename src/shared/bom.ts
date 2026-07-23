import { SubmaterialComponent } from './types';

/**
 * BOM 구성품 1개당 소요 수량.
 *
 * 주의 — 이 값은 `SubmaterialComponent.stock`에 들어있다. 필드 이름이 stock일 뿐
 * 재고가 아니라 "완제품 1개에 몇 개 들어가는가"다. 품목 등록 화면의 수량 입력칸이
 * 여기에 쓴다(AddItemModal). 기본 1.
 *
 * **0은 0이다** — "BOM에는 두되 차감은 안 함"을 이걸로 표현한다(테이프가 그렇다).
 * 값 자체가 안 박힌 옛 데이터만 1로 본다 — 차감을 통째로 건너뛰는 것보다 낫다.
 */
export function bomQty(s: Pick<SubmaterialComponent, 'stock'>): number {
  const q = s?.stock;
  if (typeof q !== 'number' || Number.isNaN(q)) return 1;
  return q > 0 ? q : 0;
}
