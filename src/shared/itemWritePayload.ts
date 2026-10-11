import type { CollectionName } from './collections';

/** 구형 품목 원문을 편집해도 품목 가격 필드를 다시 저장하지 않는다. 원가는 추정하지 않는다. */
export function itemWritePayload(collectionName: CollectionName, data: Record<string, unknown>): Record<string, unknown> {
  if (collectionName !== 'items') return data;
  // updateDoc의 dotted field도 같은 품목 가격을 다시 만들 수 있어 함께 제외한다.
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'price' && !key.startsWith('price.')));
}
