/**
 * **말로 온 주문을 표로 옮긴다 — 읽어낸 것을 믿지 않는 자리.**
 *
 * 2026-09-15 사장님: "api달아서 메시지에서 주문 추출하는 기능 할 수 있냐 지금 복사주문 처럼",
 * "그냥 복사주문 업그레이드", "걔는 너무 못해".
 *
 * 지금 복사주문은 정규식으로 **마지막 숫자+단위**를 뽑고 나머지 글자를 품목 이름과
 * 글자 닮은 정도로 견준다. 그래서 `참기름 두 박스요`(숫자가 없다), `볶음참깨 5, 참기름 3`
 * (한 줄에 둘), `내일 오전까지`(날짜) 같은 **사람 말**을 못 읽는다.
 *
 * ---
 * **여기는 AI 가 읽어 온 것을 검사하는 곳이다.** 읽는 일 자체는 Cloud Function 이 한다
 * (열쇠를 앱에 두면 브라우저에서 그대로 보인다). 이 파일은 네트워크를 안 탄다 — 그래야
 * 시험할 수 있고, **무엇을 믿고 무엇을 안 믿는지가 한 곳에 모인다.**
 *
 * 믿지 않는 까닭: 수량 하나가 틀리면 재고·전표가 다 틀어진다. 그래서
 *   · 품목은 **우리 목록에 있는 id 만** 받는다 — 이름이 그럴듯해도 지어낸 것은 버린다.
 *   · 수량은 **양수**여야 한다.
 *   · 날짜는 `YYYY-MM-DD` 모양이어야 한다.
 * 걸러낸 줄은 버리지 않고 **왜 걸렸는지 적어** 돌려준다 — 사람이 보고 고칠 수 있어야 한다.
 */

/** AI 가 돌려주는 날것. 무엇이든 올 수 있다고 보고 다룬다. */
export interface RawExtracted {
  partnerId?: unknown;
  deliveryDate?: unknown;
  lines?: unknown;
  note?: unknown;
}

export interface ExtractedLine {
  itemId: string;
  /** 화면에 보여 줄 이름 — 우리 목록의 이름이다(AI 가 적은 이름이 아니다). */
  name: string;
  qty: number;
  /** 박스로 읽었나. 못 정하면 `undefined` — 화면이 품목 기본값을 쓴다. */
  isBox?: boolean;
  /** 그 줄이 어느 글에서 나왔나 — 사람이 대조할 수 있게. */
  source?: string;
}

export interface ExtractResult {
  partnerId?: string;
  partnerName?: string;
  deliveryDate?: string;
  note?: string;
  lines: ExtractedLine[];
  /** 못 받아들인 것들 — 무엇이 왜 걸렸는지. 조용히 버리면 빠진 줄을 못 찾는다. */
  rejected: { text: string; reason: string }[];
}

export interface CatalogItem { id: string; name: string; spec?: string }
export interface CatalogPartner { id: string; name: string }

const 글 = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const 수 = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(글(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** `YYYY-MM-DD` 인가 — 달력이 받는 모양이어야 화면에 그대로 꽂힌다. */
const 날짜꼴 = (v: unknown): string | undefined => {
  const t = 글(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const d = new Date(`${t}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : t;
};

/**
 * 읽어 온 것을 우리 목록에 비춰 본다.
 *
 * **id 로만 받는다.** 이름으로 다시 찾아 주면 "참기름"처럼 여러 품목이 같은 이름을 쓰는
 * 자리에서 엉뚱한 것이 잡힌다(낱개와 박스가 같은 이름이다). 목록에 없는 id 는 버린다.
 */
export function validateExtract(
  raw: RawExtracted,
  items: readonly CatalogItem[],
  partners: readonly CatalogPartner[] = [],
): ExtractResult {
  const 품목표 = new Map(items.map(i => [i.id, i]));
  const 거래처표 = new Map(partners.map(p => [p.id, p]));
  const rejected: ExtractResult['rejected'] = [];
  const lines: ExtractedLine[] = [];

  for (const 날것 of Array.isArray(raw.lines) ? raw.lines : []) {
    const row = (날것 ?? {}) as Record<string, unknown>;
    const 적힌글 = 글(row.source) || 글(row.name) || JSON.stringify(날것).slice(0, 60);
    const id = 글(row.itemId);
    const 품목 = 품목표.get(id);
    if (!품목) {
      //  **지어낸 품목은 버린다** — 이름이 그럴듯해도 우리 목록에 없으면 없는 것이다.
      rejected.push({ text: 적힌글, reason: id ? '우리 품목 목록에 없는 품목입니다' : '품목을 못 정했습니다' });
      continue;
    }
    const qty = 수(row.qty);
    if (!(qty > 0)) {
      rejected.push({ text: 적힌글, reason: '수량을 못 읽었습니다' });
      continue;
    }
    lines.push({
      itemId: 품목.id,
      //  **이름은 우리 것을 쓴다** — AI 가 적은 이름을 그대로 두면 화면과 DB 가 다른 말을 한다.
      name: 품목.name,
      qty,
      isBox: typeof row.isBox === 'boolean' ? row.isBox : undefined,
      source: 글(row.source) || undefined,
    });
  }

  const 거래처 = 거래처표.get(글(raw.partnerId));
  return {
    partnerId: 거래처?.id,
    partnerName: 거래처?.name,
    deliveryDate: 날짜꼴(raw.deliveryDate),
    note: 글(raw.note) || undefined,
    lines,
    rejected,
  };
}

/**
 * **AI 에게 줄 품목 목록** — 이름이 같은 것이 여럿이라 규격까지 붙여 준다.
 *
 * 목록이 길면 값이 비싸지고 헷갈리기도 쉽다. 그래서 **그 거래처가 사는 것**만 추려 넘기는 게
 * 낫다 — 부르는 쪽이 골라서 준다.
 */
export const catalogLine = (item: CatalogItem): string =>
  `${item.id}\t${item.name}${item.spec ? ` ${item.spec}` : ''}`;
