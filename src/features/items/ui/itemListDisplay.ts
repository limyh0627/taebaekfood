import { splitNameVolume, specText } from '../../../shared/productChip';
import { parseSpecUnit, parseSpecCount } from '../../../constants/formula';

const hasVolumeInName = (name: string) => /\d+(\.\d+)?\s*(ml|kg|l|g)(?![a-z])/i.test(name);

export const boxEquivalentLabel = (qty: number, unitsPerBox: number): string => {
  const boxes = qty / unitsPerBox;
  const value = Number.isInteger(boxes) ? String(boxes) : boxes.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${value}박스 분량`;
};

export const inventoryNameSpec = (p: { name: string; spec?: string; subtype?: string }): { name: string; spec: string } => {
  const { base, vol } = splitNameVolume(p);
  const nameCount = p.name.match(/\(?\s*(\d+)\s*개입\s*\)?/i)?.[1];
  const cleanName = base
    .replace(/\/?\s*\d+(?:\.\d+)?\s*(?:ml|kg|g|l)\s*(?:\(\s*\d+\s*개입\s*\))?\s*$/i, '')
    .replace(/\(\s*\d+\s*개입\s*\)\s*$/i, '')
    .trim();
  const baseSpec = specText(p.spec) || vol || '-';
  const specCount = parseSpecCount(p.spec);
  const count = specCount > 1 ? specCount : Number(nameCount || 0);
  const countedSpec = count > 1 && !baseSpec.includes(String(count)) ? `${baseSpec} × ${count}` : baseSpec;
  // 선물세트의 1호·2호는 규격이 아니라 품목 구분명이다. 규격 칸에는 포장 형태만 적는다.
  const giftSpec = p.subtype === '선물세트' ? '선물세트' : countedSpec;
  return { name: cleanName || base, spec: giftSpec };
};

export const withSpec = (p: { name: string; spec?: string }): string => {
  const sp = parseSpecUnit(p.spec);
  const count = parseSpecCount(p.spec);
  const base = sp && !hasVolumeInName(p.name)
    ? `${p.name}/${sp.value}${sp.unit === 'l' ? 'L' : sp.unit}`
    : p.name;
  return count > 1 ? `${base} ×${count}` : base;
};

const MAKE_GRADE_WORDS = ['특골드', '골드A', '특A', '골드', '원액', '특', '분', 'A'];

export const parseMakeLabel = (p: { name: string; spec?: string }): { base: string; grade: string; size: string; pack: string; brand: string; container: string } => {
  let nm = p.name;
  // 개입수는 규격('1750ml * 10')에서 읽는다 — 이름에서 '(10개입)'을 뺐다(2026-08-14).
  // 옛 이름이 남아 있을 수 있어 이름 쪽도 폴백으로 본다.
  const packM = nm.match(/\((\d+)\s*개입\)/);
  const cnt = parseSpecCount(p.spec);
  const pack = cnt > 1 ? `${cnt}개입` : (packM ? `${packM[1]}개입` : '');
  nm = nm.replace(/\(\s*\d+\s*개입\s*\)/g, '').trim();
  const sizeM = String(p.spec ?? '').match(/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i) || nm.match(/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i);
  const size = sizeM ? sizeM[0].replace(/\s+/g, '') : '';
  const toks = nm.split('/').map(s => s.trim()).filter(Boolean);
  const base = toks[0] ?? nm;
  let grade = '', brand = '';
  for (const raw of toks.slice(1)) {
    const t = raw.replace(/\(.*?\)/g, '').trim();                 // "(스마트)" 같은 부기 제거
    if (!t || t === '병') continue;
    if (/\d+(?:\.\d+)?\s*(?:ml|kg|l)\b/i.test(t)) continue;       // 용량 토큰은 size로 이미 뽑음
    if (!grade && (MAKE_GRADE_WORDS.includes(t) || /골드|원액/.test(t))) grade = t;
    else if (!brand) brand = t;
  }
  // 용기 타입 — 180/300/350ml=병, 1500/1750/1800ml=페트, 16.5kg(캔) 등은 표시 안 함
  const sizeNum = parseFloat(size);
  const container = (/kg/i.test(size) || !sizeNum) ? '' : sizeNum <= 350 ? '병' : sizeNum >= 1500 ? '페트' : '';
  return { base, grade, size, pack, brand, container };
};
