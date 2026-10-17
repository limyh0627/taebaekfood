export const STORAGE_ZONES = [
  { name: '냉장창고 1', standard: '0~10℃' },
  { name: '냉장창고 2', standard: '0~10℃' },
  { name: '냉동창고', standard: '-18℃ 이하' },
  { name: '원료 보관실', standard: '실온(15~25℃)' },
];

export type StorageZone = { name: string; standard: string };
