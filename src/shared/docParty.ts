import type { Partner, CompanyInfo } from './types';

/**
 * **서류에 찍는 한쪽 당사자** — 거래명세서·세금계산서의 공급자 / 공급받는자 칸.
 *
 * 우리 회사든 거래처든 서류에 들어가는 칸은 같다. 그런데 두 인쇄 경로가 칸을 각자
 * 채우고 있었고, **거래처 쪽이 거의 다 빈칸이었다**(2026-09-06 사장님이
 * "저장된 거래처 정보가 다 안 들어가냐"):
 *
 *   거래명세서   이름과 전화만. 사업자번호·대표자·주소·팩스가 빈 문자열로 박혀 있었다.
 *   세금계산서   **등록번호가 빈 문자열**이었고, 주소는 `address` 가 아니라
 *                `region`(시·도)을 썼다. 세금계산서에 등록번호가 비면 서류가 아니다.
 *
 * 전화번호도 어긋나 있었다 — 인쇄는 `phone` 만 봤는데 거래처 313곳 중 `phone` 이
 * 찬 것은 **18곳뿐**이고, 실제 번호는 `tel`(108곳)·`mobile`(78곳)에 들어 있다.
 * 그래서 전화가 거의 안 찍혔다. 세 칸을 차례로 본다.
 *
 * **업태·종목은 거래처에 칸이 없다.** 우리 회사만 있다. 거래처 쪽은 빈칸으로 둔다 —
 * 없는 값을 지어내는 것보다 빈칸이 낫다.
 */
export interface DocParty {
  /** 상호 */
  name: string;
  /** 사업자등록번호 */
  bizNo: string;
  /** 대표자명 */
  ceo: string;
  /** 사업장 주소 — 상세주소까지 붙인다 */
  addr: string;
  /** 업태 */
  bizType: string;
  /** 종목 */
  bizItem: string;
  /** 전화번호 */
  tel: string;
  /** 팩스번호 */
  fax: string;
}

const 빈칸: DocParty = { name: '', bizNo: '', ceo: '', addr: '', bizType: '', bizItem: '', tel: '', fax: '' };

const 글자 = (v: unknown): string => String(v ?? '').trim();

/** 거래처 → 서류 칸. 못 찾았으면 이름만 채운 것을 준다(적어도 상호는 찍혀야 한다). */
export function partyOfPartner(p: Partner | undefined, 이름대신?: string): DocParty {
  if (!p) return { ...빈칸, name: 글자(이름대신) };
  const 주소 = [글자(p.address), 글자(p.addressDetail)].filter(Boolean).join(' ');
  return {
    name: 글자(p.name) || 글자(이름대신),
    bizNo: 글자(p.bizNo),
    ceo: 글자(p.ownerName),
    addr: 주소,
    //  거래처에는 업태·종목 칸이 없다
    bizType: '',
    bizItem: '',
    //  `phone` 만 보던 탓에 전화가 거의 안 찍혔다 — 세 칸을 차례로 본다
    tel: 글자(p.tel) || 글자(p.phone) || 글자(p.mobile),
    fax: 글자(p.fax),
  };
}

/** 우리 회사 → 서류 칸. */
export function partyOfCompany(ci: CompanyInfo | undefined): DocParty {
  if (!ci) return { ...빈칸 };
  return {
    name: 글자(ci.name), bizNo: 글자(ci.bizNo), ceo: 글자(ci.ceoName),
    addr: 글자(ci.address), bizType: 글자(ci.bizType), bizItem: 글자(ci.bizItem),
    tel: 글자(ci.phone), fax: 글자(ci.fax),
  };
}

/**
 * 서류의 **공급자 · 공급받는자**를 한 번에 가른다.
 *
 * 매출이면 우리가 공급자, 매입이면 거래처가 공급자다. 이 뒤집기를 인쇄 경로마다
 * 손으로 적고 있었고 — 거래명세서 16줄, 세금계산서 12줄 — 한쪽만 고쳐지곤 했다.
 */
export function 서류당사자(
  isSale: boolean,
  ci: CompanyInfo | undefined,
  partner: Partner | undefined,
  거래처이름?: string,
): { sup: DocParty; buy: DocParty } {
  const 우리 = partyOfCompany(ci);
  const 상대 = partyOfPartner(partner, 거래처이름);
  return isSale ? { sup: 우리, buy: 상대 } : { sup: 상대, buy: 우리 };
}
