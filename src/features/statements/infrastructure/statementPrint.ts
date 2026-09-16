import type { CompanyInfo, IssuedStatement, Item, Partner } from '../../../../types';
import type { LineItem, StatementType } from '../../../shared/statementLines';
import { withDocNames } from '../../../shared/docName';
import { 서류당사자스냅샷우선 } from '../../../shared/docParty';

interface StatementPrintDeps {
  companyInfo?: CompanyInfo | null;
  partners: Partner[];
  allItems: Item[];
}
const fmt = (value: number) => value.toLocaleString('ko-KR');
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const buildStatementPrintHtml = (items: LineItem[] | IssuedStatement['items'], sup: number, tax: number, amt: number, type: StatementType, partner: string, docNoStr: string, dateString: string, memoText = '', partnerIdStr = '', snapshot: IssuedStatement['partySnapshot'] | undefined, deps: StatementPrintDeps) => {
  const { companyInfo, partners, allItems } = deps;
    const m = dateString.match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
    const yyyy = m ? m[1] : '';
    const mmN  = m ? m[2] : '';
    const dd   = m ? m[3] : '';
    const dateLabel = `${yyyy}-${mmN.padStart(2,'0')}-${dd.padStart(2,'0')}`;

    const ci = companyInfo;
    const isSale = type === '매출';

    //  **거래처 칸을 저장된 값으로 채운다**(2026-09-06 사장님: "저장된 거래처 정보가
    //  다 안 들어가냐"). 전에는 거래처 쪽이 이름과 전화만이었고 사업자번호·대표자·
    //  주소·팩스가 빈 문자열로 박혀 있었다. shared/docParty 가 양쪽을 같은 규칙으로 낸다.
    //  거래처는 **id 로 찾는다** — 이름으로 찾으면 같은 이름이 둘일 때 엉뚱한 곳이 걸린다.
    const { sup: 파는쪽, buy: 사는쪽 } = 서류당사자스냅샷우선(snapshot, {
      isSale, companyInfo: ci, partners, partnerId: partnerIdStr, partnerName: partner,
    });
    const supName = 파는쪽.name, supCeo = 파는쪽.ceo, supBizNo = 파는쪽.bizNo;
    const supBizType = 파는쪽.bizType, supBizItem = 파는쪽.bizItem;
    const supAddr = 파는쪽.addr, supPhone = 파는쪽.tel, supFax = 파는쪽.fax;
    const buyName = 사는쪽.name, buyCeo = 사는쪽.ceo, buyBizNo = 사는쪽.bizNo;
    const buyBizType = 사는쪽.bizType, buyBizItem = 사는쪽.bizItem;
    const buyAddr = 사는쪽.addr, buyPhone = 사는쪽.tel, buyFax = 사는쪽.fax;

    const MAX_ROWS = 11;
    //  **인쇄에만** 서류용 품목명으로 바꾼다 — 화면·저장은 실제 이름 그대로다.
    //  (2026-09-06 사장님) 원료수불부·생산작업기록부가 그 이름으로 나가서, 전표도 맞춰야
    //  서류끼리 대조가 된다. shared/statementLines 의 withDocNames 참고.
    const itemList = withDocNames(items as any[], allItems);
    const totalQty = itemList.reduce((s,i)=>s+(Number(i.qty)||0),0);

    const makePage = (borderColor: string, pageLabel: string, stripeColor: string) => {
      const BC = borderColor;
      const SC = stripeColor;
      const LB = '#efefef';

      // ── 헤더 (테두리 바깥) ──
      const headerHtml = `
<div style="display:flex;align-items:flex-end;margin-bottom:0.5mm;">
  <span style="flex:1;font-size:10px;"></span>
  <span style="font-size:22px;font-weight:bold;letter-spacing:6px;color:${BC};">거&nbsp;&nbsp;래&nbsp;&nbsp;명&nbsp;&nbsp;세&nbsp;&nbsp;서</span>
  <span style="flex:1;font-size:10px;text-align:right;">[재발행]</span>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-bottom:0.5mm;">
  <span>전표일자 : <strong>${dateLabel}</strong></span>
  <span style="color:${BC};font-weight:bold;font-size:12px;">${pageLabel}</span>
  <span>전표NO. : <strong>${docNoStr}</strong></span>
</div>`;

      // ── 회사 정보 ──
      const V = (t:string, extra='') =>
        `<td style="border:1px solid ${BC};padding:1px 4px;font-size:10px;overflow:hidden;white-space:nowrap;${extra}">${t}</td>`;
      const L = (t:string) =>
        `<td style="border:1px solid ${BC};background:${LB};padding:1px 4px;font-size:9.5px;font-weight:bold;white-space:nowrap;text-align:center;">${t}</td>`;

      const infoHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:6mm;"/><col style="width:18mm;"/><col/>
    <col style="width:6mm;"/><col style="width:18mm;"/><col/>
  </colgroup>
  <tbody>
    <tr style="height:5.5mm;">
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:10px;font-weight:bold;color:${BC};">공급받는자</td>
      ${L('상&nbsp;&nbsp;호')}${V(buyName,'font-weight:bold;font-size:11px;')}
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:10px;font-weight:bold;color:${BC};">공급자</td>
      ${L('상&nbsp;&nbsp;호')}${V(supName,'font-weight:bold;font-size:11px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('대&nbsp;&nbsp;표')}${V(buyCeo,'font-weight:bold;')}
      ${L('대&nbsp;&nbsp;표')}${V(supCeo,'font-weight:bold;')}
    </tr>
    <tr style="height:5mm;">
      ${L('사업자번호')}${V(buyBizNo)}
      ${L('사업자번호')}${V(supBizNo)}
    </tr>
    <tr style="height:5mm;">
      ${L('주&nbsp;&nbsp;소')}${V(buyAddr,'font-size:9.5px;')}
      ${L('주&nbsp;&nbsp;소')}${V(supAddr,'font-size:9.5px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('전화번호')}${V((buyPhone?buyPhone:'')+(buyFax?'&nbsp;&nbsp;FAX:'+buyFax:''),'font-size:9.5px;')}
      ${L('전화번호')}${V(supPhone+(supFax?'&nbsp;&nbsp;FAX:'+supFax:''),'font-size:9.5px;')}
    </tr>
  </tbody>
</table>`;

      // ── 품목 테이블 ──
      const TH = (t:string) =>
        `<th style="border:1px solid ${BC};background:${SC};padding:2px 2px;font-size:10px;text-align:center;font-weight:bold;">${t}</th>`;

      const iRows = itemList.map((item:any, idx:number) => {
        const bg = idx%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0 1px;">${idx+1}</td>
          <td style="border:1px solid ${BC};font-size:11px;font-weight:bold;padding:0 3px;overflow:hidden;white-space:nowrap;">${item.name||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;padding:0 2px;">${item.spec||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0 2px;">${(item as any).unit||'개'}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.qty)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.price)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.total)}</td>
        </tr>`;
      }).join('');

      // **** 이하여백 **** — 마지막 아이템 바로 다음
      const blankBg0 = itemList.length%2===0 ? '#ffffff' : SC;
      const blankRow = `<tr style="height:5.5mm;background:${blankBg0};">
        <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0;"></td>
        <td colspan="6" style="border:1px solid ${BC};font-size:10px;padding:0 3px;color:${BC};">*&nbsp;*&nbsp;*&nbsp;*&nbsp;&nbsp;이&nbsp;하&nbsp;여&nbsp;백&nbsp;&nbsp;*&nbsp;*&nbsp;*&nbsp;*</td>
      </tr>`;

      const emptyCount = Math.max(0, MAX_ROWS - itemList.length - 1);
      const eRows = Array.from({length:emptyCount}).map((_,idx)=>{
        const bg = (itemList.length+1+idx)%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td>
        </tr>`;
      }).join('');

      const itemsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:7mm;"/><col/><col style="width:19mm;"/>
    <col style="width:11mm;"/><col style="width:14mm;"/>
    <col style="width:19mm;"/><col style="width:23mm;"/>
  </colgroup>
  <thead>
    <tr style="background:${SC};">${TH('순번')}${TH('제&nbsp;&nbsp;&nbsp;품&nbsp;&nbsp;&nbsp;명')}${TH('규&nbsp;&nbsp;격')}${TH('단&nbsp;&nbsp;위')}${TH('수&nbsp;&nbsp;량')}${TH('단&nbsp;&nbsp;가')}${TH('금&nbsp;&nbsp;액')}</tr>
  </thead>
  <tbody>${iRows}${blankRow}${eRows}</tbody>
</table>`;

      // ── 합계 (합계 1행) ──
      const totalsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:14mm;"/><col style="width:12mm;"/>
    <col style="width:14mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:12mm;"/><col/>
  </colgroup>
  <tr style="height:6mm;background:${SC};">
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;font-weight:bold;">합&nbsp;&nbsp;&nbsp;계</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">수량</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(totalQty)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">공급가</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(sup)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">부가세</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(tax)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">합계</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(amt)}</td>
  </tr>
</table>`;

      // ── 하단: (좌) 미수금 표 + 비고 / (우) 인수확인 ──
      const now = new Date();
      const h = now.getHours(); const mn = now.getMinutes(); const sc2 = now.getSeconds();
      const ampm = h<12?'오전':'오후'; const hh = h%12||12;

      const bottomHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup><col/><col style="width:28mm;"/></colgroup>
  <tr>
    <td style="border:1px solid ${BC};padding:0;vertical-align:top;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:22mm;"/><col/></colgroup>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;white-space:nowrap;">전일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;">금일판매</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">${fmt(amt)}</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;">금일입금</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;font-weight:bold;padding:1.5px 4px;">금일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:1.5px 5px;">${fmt(amt)}</td></tr>
        <tr><td colspan="2" style="font-size:9.5px;font-weight:bold;padding:2px 4px;height:10mm;vertical-align:top;">비&nbsp;고${memoText ? `<div style="font-weight:normal;font-size:9px;white-space:pre-wrap;margin-top:1px;">${esc(memoText)}</div>` : ''}</td></tr>
      </table>
    </td>
    <td style="border:1px solid ${BC};text-align:center;vertical-align:middle;font-size:11px;font-weight:bold;letter-spacing:3px;">인<br/>수<br/>확<br/>인</td>
  </tr>
</table>
<div style="display:flex;justify-content:space-between;font-size:9px;margin-top:0.5mm;color:#555;padding:0 1mm;">
  <span>발행일시 : ${dateLabel} ${ampm} ${hh}:${String(mn).padStart(2,'0')}:${String(sc2).padStart(2,'0')}</span>
  <span>${ci?.name||''}&nbsp;/&nbsp;${ci?.phone||''}</span>
</div>`;

      return `
<div style="font-family:'맑은 고딕',sans-serif;color:#000;box-sizing:border-box;">
  ${headerHtml}
  <div style="border:1.5px solid ${BC};">${infoHtml}${itemsHtml}${totalsHtml}${bottomHtml}</div>
</div>`;
    };

    return `
<div style="width:210mm;height:297mm;overflow:hidden;box-sizing:border-box;padding:5mm 6mm;display:flex;flex-direction:column;font-family:'맑은 고딕',sans-serif;">
  <div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;justify-content:center;">
    ${makePage('#cc0000','(공급자용)','#f5d8b0')}
  </div>
  <div style="flex:0 0 auto;display:flex;align-items:center;gap:2mm;padding:1mm 0;color:#666;">
    <span style="flex:1;border-top:1.2px dashed #999;"></span>
    <span style="font-size:8px;white-space:nowrap;letter-spacing:2px;">✂&nbsp;&nbsp;절&nbsp;취&nbsp;선</span>
    <span style="flex:1;border-top:1.2px dashed #999;"></span>
  </div>
  <div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;justify-content:center;">
    ${makePage('#0044cc','(공급받는자용)','#c4d4f0')}
  </div>
</div>`;
  };

export const printStatementViaIframe = (html: string, title: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(`<html><head><title>${title}</title>
      <style>
        @page{size:A4 portrait;margin:0;}
        *{margin:0;padding:0;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
        body{font-family:'맑은 고딕',sans-serif;font-size:8px;color:#000;}
        table{border-collapse:collapse;}
      </style></head><body>${html}</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    }, 400);
};

export function buildReceiptHtml(input: {
  companyInfo?: CompanyInfo | null;
  tradeDate: string;
  docNo: string;
  partnerName: string;
  items: LineItem[];
  totals: { supply: number; tax: number; amount: number };
}): string {
  const date = new Date(`${input.tradeDate}T00:00:00`);
  const dateLabel = `${date.getFullYear()}.${date.getMonth()+1}.${date.getDate()}`;
  return `<div style="font-family:'맑은 고딕',sans-serif;font-size:9px;color:#000;width:80mm;margin:0 auto;padding:4mm;">
  <div style="text-align:center;font-size:16px;font-weight:900;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:3mm;">영&nbsp;&nbsp;수&nbsp;&nbsp;증</div>
  <div style="display:flex;justify-content:space-between;margin-bottom:1mm;"><span>일자: <strong>${dateLabel}</strong></span><span>No: ${input.docNo}</span></div>
  <div style="margin-bottom:3mm;border-bottom:1px solid #ccc;padding-bottom:2mm;">
    <div>공급자: <strong>${input.companyInfo?.name||''}</strong></div><div>사업자: ${input.companyInfo?.bizNo||''}</div>
    <div>주소: ${input.companyInfo?.address||''}</div><div>대표: ${input.companyInfo?.ceoName||''}</div>
  </div>
  <div style="margin-bottom:1mm;border-bottom:1px solid #000;padding-bottom:1mm;font-weight:bold;"><span>거래처: ${input.partnerName}</span></div>
  <table style="border-collapse:collapse;width:100%;margin-bottom:2mm;font-size:8px;"><thead><tr style="background:#f0f0f0;">
    <th style="border:1px solid #ccc;padding:1px 3px;text-align:left;">품목</th><th style="border:1px solid #ccc;padding:1px 3px;text-align:center;">수량</th><th style="border:1px solid #ccc;padding:1px 3px;text-align:right;">금액</th>
  </tr></thead><tbody>${input.items.map(item=>`<tr><td style="border:1px solid #ccc;padding:1px 3px;">${item.name}${item.spec?' ('+item.spec+')':''}</td><td style="border:1px solid #ccc;padding:1px 3px;text-align:center;">${fmt(item.qty)}</td><td style="border:1px solid #ccc;padding:1px 3px;text-align:right;">${fmt(item.total)}</td></tr>`).join('')}</tbody></table>
  <div style="border-top:2px solid #000;padding-top:2mm;"><div style="display:flex;justify-content:space-between;"><span>공급가액</span><span>${fmt(input.totals.supply)}원</span></div><div style="display:flex;justify-content:space-between;"><span>부가세</span><span>${fmt(input.totals.tax)}원</span></div><div style="display:flex;justify-content:space-between;font-size:11px;font-weight:900;margin-top:1mm;border-top:1px solid #000;padding-top:1mm;"><span>합계</span><span>${fmt(input.totals.amount)}원</span></div></div>
  <div style="margin-top:4mm;text-align:center;font-size:7px;color:#888;">위 금액을 정히 영수합니다</div><div style="margin-top:6mm;text-align:right;">서&nbsp;&nbsp;명:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
</div>`;
}

