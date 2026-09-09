import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partyOfPartner, partyOfCompany, 서류당사자, 서류당사자ById } from './docParty';
import type { Partner, CompanyInfo } from './types';

const 우리: CompanyInfo = {
  name: '태백식품', ceoName: '임영호', bizNo: '123-45-67890',
  bizType: '제조', bizItem: '식용유지', address: '충북 음성군 ...',
  phone: '043-000-0000', fax: '043-000-0001',
};

const 거래처 = {
  id: 'p1', name: '대왕유통', type: '일반',
  bizNo: '111-22-33333', ownerName: '홍길동',
  address: '서울시 강남구 테헤란로 1', addressDetail: '3층 302호',
  tel: '02-111-2222', fax: '02-111-2223', region: '서울',
} as unknown as Partner;

describe('서류에 찍는 당사자 칸', () => {
  it('거래처의 저장된 값이 다 들어간다 — 예전엔 이름·전화뿐이었다', () => {
    const p = partyOfPartner(거래처);
    expect(p.name).toBe('대왕유통');
    expect(p.bizNo).toBe('111-22-33333');
    expect(p.ceo).toBe('홍길동');
    expect(p.fax).toBe('02-111-2223');
  });

  it('주소는 상세주소까지 붙인다 — region(시·도)이 아니다', () => {
    expect(partyOfPartner(거래처).addr).toBe('서울시 강남구 테헤란로 1 3층 302호');
  });

  /** 313곳 중 `phone` 이 찬 것은 18곳뿐이고 실제 번호는 tel·mobile 에 있었다. */
  it('전화는 거래처관리 화면과 같은 tel → mobile → phone 차례로 본다', () => {
    expect(partyOfPartner({ tel: '02-1', phone: '02-2', mobile: '010-3' } as never).tel).toBe('02-1');
    expect(partyOfPartner({ phone: '02-2', mobile: '010-3' } as never).tel).toBe('010-3');
    expect(partyOfPartner({ mobile: '010-3' } as never).tel).toBe('010-3');
    expect(partyOfPartner({ phone: '02-2' } as never).tel).toBe('02-2');
    expect(partyOfPartner({} as never).tel).toBe('');
  });

  it('업태·종목은 거래처에 칸이 없어 빈칸이다 — 지어내지 않는다', () => {
    expect(partyOfPartner(거래처).bizType).toBe('');
    expect(partyOfPartner(거래처).bizItem).toBe('');
    expect(partyOfCompany(우리).bizType).toBe('제조');
  });

  it('거래처를 못 찾아도 적어도 상호는 찍힌다', () => {
    const p = partyOfPartner(undefined, '이름만아는곳');
    expect(p.name).toBe('이름만아는곳');
    expect(p.bizNo).toBe('');
  });

  it('빈 칸은 공백을 털어 낸다 — 주소에 공백 하나만 찍히면 안 된다', () => {
    expect(partyOfPartner({ name: '가', address: '  ', addressDetail: '' } as never).addr).toBe('');
  });
});

describe('공급자 · 공급받는자 가르기', () => {
  it('매출이면 우리가 공급자, 거래처가 공급받는자다', () => {
    const { sup, buy } = 서류당사자(true, 우리, 거래처);
    expect(sup.name).toBe('태백식품');
    expect(buy.name).toBe('대왕유통');
    expect(buy.bizNo).toBe('111-22-33333');   // 세금계산서 등록번호가 비어 있었다
  });

  it('매입이면 뒤집힌다', () => {
    const { sup, buy } = 서류당사자(false, 우리, 거래처);
    expect(sup.name).toBe('대왕유통');
    expect(buy.name).toBe('태백식품');
    expect(sup.bizNo).toBe('111-22-33333');
  });

  it('동명이인이 있어도 partnerId가 가리킨 거래처관리 원본만 쓴다', () => {
    const 같은이름 = [
      { ...거래처, id: 'wrong', bizNo: '000-00-00000', address: '틀린 주소' },
      { ...거래처, id: 'right', bizNo: '999-88-77777', address: '맞는 주소' },
    ] as Partner[];
    const { buy } = 서류당사자ById({
      isSale: true, companyInfo: 우리, partners: 같은이름,
      partnerId: 'right', partnerName: 거래처.name,
    });
    expect(buy.bizNo).toBe('999-88-77777');
    expect(buy.addr).toContain('맞는 주소');
  });

  it('없는 ID를 이름으로 다시 찾지 않고 저장 당시 상호만 남긴다', () => {
    const { buy } = 서류당사자ById({
      isSale: true, companyInfo: 우리, partners: [거래처],
      partnerId: 'deleted', partnerName: 거래처.name,
    });
    expect(buy.name).toBe(거래처.name);
    expect(buy.bizNo).toBe('');
    expect(buy.addr).toBe('');
  });
});

describe('서류 화면의 공용 모듈 연결', () => {
  it('거래명세서와 세금계산서가 모두 ID 공용 진입점을 쓴다', () => {
    const 거래명세서 = readFileSync(new URL('../../components/TradeStatement.tsx', import.meta.url), 'utf8');
    const 세금계산서 = readFileSync(new URL('../../components/TaxStatement.tsx', import.meta.url), 'utf8');

    expect(거래명세서).toContain('서류당사자ById({');
    expect(세금계산서).toContain('서류당사자ById({');
    expect(거래명세서).not.toMatch(/partners\.find\([^\n]*\.name\s*===/);
    expect(세금계산서).not.toContain('taxBuyerInfo');
  });
});
