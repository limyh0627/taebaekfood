import type { CollectionName } from './collections';

/** 구형 전체 사본을 편집해도 폐기 필드를 재전송하지 않는다. 기존 DB 값의 삭제는 별도다. */
export function itemWritePayload(collectionName: CollectionName, data: Record<string, unknown>): Record<string, unknown> {
  const excluded = collectionName === 'items' ? ['price', 'lotsAreTotal'] : collectionName === 'pallets' ? ['inUse'] : [];
  if (!excluded.length) return data;
  // updateDoc의 점 표기도 폐기 필드를 다시 만들 수 있어 함께 제외한다.
  return Object.fromEntries(Object.entries(data).filter(([key]) => !excluded.some(field => key === field || key.startsWith(field + '.'))));
}
