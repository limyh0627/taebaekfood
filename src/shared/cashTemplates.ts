/**
 * 일반전표 템플릿 — 자주 끊는 자금전표를 한 번에 채운다.
 *
 * 전표 하나 끊을 때마다 방향 고르고 계정과목 목록에서 찾아 내려가는 게 실제 병목이었다.
 * 계정을 잘못 고르면 손익·현금흐름이 통째로 어긋나므로, 자주 쓰는 것만 미리 박아 둔다.
 *
 * 코드는 setup-account-codes.mjs의 계정과목과 같다. 계정이 없으면 그 칩은 안 뜬다
 * (화면 쪽에서 accountCodes에 있는 것만 거른다) — 죽은 버튼을 남기지 않으려는 것.
 */
export interface CashTemplate {
  id: string;
  label: string;
  dir: '입금' | '출금';
  accountCode: string;
  /** 비고 기본값 — 비워 두면 사용자가 적는다 */
  note?: string;
  /** 거래처를 같이 골라야 뜻이 통하는 것(카드대금·운임 등) */
  wantsPartner?: boolean;
}

export const CASH_TEMPLATES: CashTemplate[] = [
  // ── 매달 나가는 고정비 ──
  { id: 'elec',    label: '전기세',    dir: '출금', accountCode: '520' },
  { id: 'water',   label: '수도세',    dir: '출금', accountCode: '525' },
  { id: 'rent',    label: '임대료',    dir: '출금', accountCode: '510' },
  { id: 'ins4',    label: '4대보험',   dir: '출금', accountCode: '530' },
  { id: 'ins',     label: '보험료',    dir: '출금', accountCode: '590' },
  { id: 'cesco',   label: '세스코',    dir: '출금', accountCode: '595' },
  { id: 'lease',   label: '리스료',    dir: '출금', accountCode: '819' },

  // ── 그때그때 나가는 것 ──
  { id: 'card',    label: '카드대금',  dir: '출금', accountCode: '650' },
  { id: 'freight', label: '운임',      dir: '출금', accountCode: '605', wantsPartner: true },
  { id: 'outwork', label: '외주가공비', dir: '출금', accountCode: '540', wantsPartner: true },
  { id: 'submat',  label: '부자재매입', dir: '출금', accountCode: '505', wantsPartner: true },
  { id: 'interest',label: '이자',      dir: '출금', accountCode: '951' },

  // ── 받아 뒀다 대신 내주는 돈 ──
  //   급여에서 뗀 원천세·4대보험은 예수금(부채)으로 잡혀 있다가 다음 달 납부로 털린다.
  { id: 'withhold', label: '원천세·4대보험 납부', dir: '출금', accountCode: '254', note: '원천공제 납부' },

  // ── 사장님 돈 ──
  { id: 'draw',    label: '인출금',    dir: '출금', accountCode: '338' },

  // ── 들어오는 것 ──
  { id: 'advance', label: '선수금',    dir: '입금', accountCode: '259', wantsPartner: true },
  { id: 'loanIn',  label: '차입 실행', dir: '입금', accountCode: '260' },
];
