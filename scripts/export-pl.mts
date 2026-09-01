// 손익을 엑셀로 뽑는다 — 화면(손익분석)과 **같은 함수**로 계산한다.
//   npx tsx scripts/export-pl.mts                 → 2026-08, 태백+풍회
//   npx tsx scripts/export-pl.mts 2026-08 taebaek → 달·회사 지정
//
// 읽기만 한다. DB를 안 건드린다.
//
// 왜 화면과 같은 함수인가: 여기서 따로 더하면 기초잔액·재고조정·계정그룹 배치가 빠져
// 화면 숫자와 다른 표가 나간다. 세무대리인께 드리는 표가 화면과 다르면 둘 다 못 믿는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import ExcelJS from 'exceljs';
import { buildJournals } from '../src/shared/buildJournals';
import { makeCodeToGroup, computeMonthPLFromJournals, COMPUTED_GROUP_IDS } from '../src/features/admin/financials';
import { openingDocId, companyOf, COMPANIES, type CompanyId } from '../src/shared/types';
import type { OpeningBalance } from '../src/shared/autoJournal';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const YM = args[0] ?? '2026-08';
const ONLY = args[1] as CompanyId | undefined;
const OUT = `손익계산서_${YM}.xlsx`;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [stmts, cash, codes, groups, snaps, openings] = await Promise.all(
  ['issuedStatements', 'cashEntries', 'accountCodes', 'accountGroups', 'inventorySnapshots', 'openingBalances'].map(load));

const wb = new ExcelJS.Workbook();
wb.creator = '태백푸드';
const won = '#,##0';

for (const co of (ONLY ? [ONLY] : COMPANIES.map(c => c.id))) {
  const name = COMPANIES.find(c => c.id === co)?.name ?? co;
  const mine = <T,>(rows: T[]) => rows.filter((r: any) => companyOf(r) === co);
  const openDoc = openings.find((r: any) => r.id === openingDocId(co));
  const opening: OpeningBalance | null = openDoc ? {
    date: openDoc.date, capitalAccount: '331',
    lines: Object.entries(openDoc.amounts as Record<string, number>).filter(([, v]) => v).map(([accountCode, amount]) => ({ accountCode, amount })),
  } : null;

  const jes = buildJournals({
    statements: mine(stmts), cashEntries: mine(cash), accounts: codes,
    ...(opening ? { opening } : {}), inventorySnapshots: mine(snaps),
  } as any).entries;
  //  화면과 똑같이 부른다 — 계산결과 그룹(매출총이익·영업이익)은 빼고,
  //  판관비 옛 id를 찾을 수 있게 원본 목록도 같이 넘긴다.
  const shownGroups = (groups as any[]).filter(g => !COMPUTED_GROUP_IDS.has(g.id));
  const codeToGroup = makeCodeToGroup(codes as any, shownGroups as any, groups as any);
  const pl = computeMonthPLFromJournals(YM, jes as any, codes as any, codeToGroup);

  //  계정별 내역 — 합계만 있으면 "왜 이 숫자냐"를 못 짚는다
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const e of jes) {
    if (!String((e as any).date ?? '').startsWith(YM)) continue;
    for (const l of ((e as any).lines ?? [])) {
      const cur = byCode.get(String(l.accountCode)) ?? { debit: 0, credit: 0 };
      cur.debit += l.debit ?? 0; cur.credit += l.credit ?? 0;
      byCode.set(String(l.accountCode), cur);
    }
  }
  const acc = new Map(codes.map((c: any) => [String(c.code), c]));
  const LINE: Record<string, string> = {
    revenue: '매출', cogs: '매출원가', sgna: '판매비와관리비',
    'other-income': '영업외수익', 'other-expense': '영업외비용',
  };

  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: '', key: 'a', width: 22 }, { header: '', key: 'b', width: 18 },
    { header: '', key: 'c', width: 16 }, { header: '', key: 'd', width: 16 },
  ];
  const title = ws.addRow([`${name}  손익계산서`]);
  title.font = { bold: true, size: 16 };
  ws.addRow([`${YM.slice(0, 4)}년 ${YM.slice(5)}월`]).font = { color: { argb: 'FF888888' } };
  ws.addRow([`뽑은 날 ${new Date().toISOString().slice(0, 10)}`]).font = { size: 9, color: { argb: 'FFAAAAAA' } };
  ws.addRow([]);

  const money = (label: string, v: number, bold = false, indent = 0) => {
    const r = ws.addRow([`${'  '.repeat(indent)}${label}`, v]);
    r.getCell(2).numFmt = won;
    if (bold) { r.font = { bold: true }; r.getCell(2).font = { bold: true }; }
    return r;
  };
  money('매출액', pl.sales, true);
  money('매출원가', pl.cogs);
  const gp = money('매출총이익', pl.grossProfit, true);
  gp.getCell(1).border = { top: { style: 'thin' } };
  gp.getCell(2).border = { top: { style: 'thin' } };
  money('판매비와관리비', pl.sgna);
  const op = money('영업이익', pl.operatingProfit, true);
  op.getCell(1).border = { top: { style: 'thin' } };
  op.getCell(2).border = { top: { style: 'thin' } };
  money('영업외수익', pl.otherIncome);
  money('영업외비용', pl.otherExpense);
  const ni = money('당기순이익', pl.netIncome, true);
  ni.getCell(1).border = { top: { style: 'double' } };
  ni.getCell(2).border = { top: { style: 'double' } };
  if (pl.sales > 0) {
    const r = ws.addRow(['매출총이익률', pl.grossProfit / pl.sales]);
    r.getCell(2).numFmt = '0.0%';
    const r2 = ws.addRow(['영업이익률', pl.operatingProfit / pl.sales]);
    r2.getCell(2).numFmt = '0.0%';
  }

  ws.addRow([]); ws.addRow([]);
  const h = ws.addRow(['계정별 내역', '', '', '']);
  h.font = { bold: true, size: 12 };
  const hh = ws.addRow(['구분', '계정과목', '금액', '']);
  hh.font = { bold: true };
  hh.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }; });

  const rows: { line: string; code: string; nm: string; amt: number }[] = [];
  for (const [code, t] of byCode) {
    const a: any = acc.get(code);
    if (a?.type !== '수익' && a?.type !== '비용') continue;
    const normal = a.normalBalance ?? (a.type === '수익' ? 'credit' : 'debit');
    const bal = normal === 'debit' ? t.debit - t.credit : t.credit - t.debit;
    if (!bal) continue;
    const pline = codeToGroup(code)?.plLine ?? (a.type === '수익' ? 'revenue' : 'cogs');
    rows.push({ line: LINE[pline] ?? pline, code, nm: a.name, amt: bal });
  }
  const order = ['매출', '매출원가', '판매비와관리비', '영업외수익', '영업외비용'];
  rows.sort((x, y) => order.indexOf(x.line) - order.indexOf(y.line) || y.amt - x.amt);
  let prev = '';
  for (const r of rows) {
    const row = ws.addRow([r.line === prev ? '' : r.line, `${r.code} ${r.nm}`, r.amt, '']);
    row.getCell(3).numFmt = won;
    prev = r.line;
  }
  console.log(`${name.padEnd(6)} 매출 ${pl.sales.toLocaleString().padStart(13)}  원가 ${pl.cogs.toLocaleString().padStart(13)}  판관비 ${pl.sgna.toLocaleString().padStart(11)}  영업이익 ${pl.operatingProfit.toLocaleString().padStart(12)}  순이익 ${pl.netIncome.toLocaleString().padStart(12)}  (계정 ${rows.length})`);
}

await wb.xlsx.writeFile(OUT);
console.log(`\n✅ ${OUT}`);
process.exit(0);
