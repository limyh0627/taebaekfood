import * as ExcelJS from 'exceljs';
import type { LineItem, StatementType } from '../../../shared/statementLines';

interface Input {
  type: StatementType;
  docNo: string;
  dateLabel: string;
  tradeDate: string;
  partnerName: string;
  items: LineItem[];
  totals: { supply: number; tax: number; amount: number };
}

/** 전표를 엑셀 파일로 만들고 브라우저 다운로드를 시작한다. */
export async function downloadStatementExcel(input: Input): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${input.type}전표`);
  const border: Partial<ExcelJS.Borders> = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
  const headerFill: ExcelJS.Fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
  sheet.columns = [{width:5},{width:20},{width:10},{width:8},{width:12},{width:14},{width:12},{width:14}];
  sheet.mergeCells('A1:H1');
  const title = sheet.getCell('A1');
  title.value = input.type === '매출' ? '거  래  명  세  서' : '거  래  명  세  서 (매입)';
  title.font = {bold:true,size:18}; title.alignment={horizontal:'center',vertical:'middle'}; sheet.getRow(1).height=36;
  sheet.mergeCells('A2:D2'); sheet.getCell('A2').value=`문서번호: ${input.docNo}`;
  sheet.mergeCells('E2:H2'); sheet.getCell('E2').value=`거래일자: ${input.dateLabel}`; sheet.getCell('E2').alignment={horizontal:'right'}; sheet.getRow(2).height=18;
  sheet.getRow(3).height=16; sheet.mergeCells('A3:D3');
  sheet.getCell('A3').value = input.type==='매출' ? '【 공급자 】' : `【 공급자 】  ${input.partnerName}`;
  sheet.getCell('A3').fill=headerFill; sheet.getCell('A3').font={bold:true}; sheet.getCell('A3').border=border;
  sheet.mergeCells('E3:H3');
  sheet.getCell('E3').value = input.type==='매출' ? `【 공급받는자 】  ${input.partnerName}` : '【 공급받는자 】';
  sheet.getCell('E3').fill=headerFill; sheet.getCell('E3').font={bold:true}; sheet.getCell('E3').border=border;
  sheet.addRow([]);
  const headings = sheet.addRow(['No','품목명','규격','수량','단가','공급가액','세액','합계']);
  headings.height=18; headings.eachCell(cell=>{cell.font={bold:true,size:9};cell.fill=headerFill;cell.border=border;cell.alignment={horizontal:'center',vertical:'middle'};});
  input.items.forEach(item=>{
    const row=sheet.addRow([item.no,item.name,item.spec,item.qty,item.price,item.supply,item.isTaxExempt?'면세':item.tax,item.total]);
    row.height=16; row.eachCell((cell,column)=>{cell.border=border;cell.font={size:9};cell.alignment={horizontal:column<=3?'left':'right',vertical:'middle'};if(column>=4&&column!==7)cell.numFmt='#,##0';});
  });
  for(let i=0;i<Math.max(0,10-input.items.length);i++){const row=sheet.addRow(['','','','','','','','']);row.height=14;row.eachCell(cell=>{cell.border=border;});}
  const sum=sheet.addRow(['합계','','','','',input.totals.supply,input.totals.tax,input.totals.amount]);
  sum.height=18; sum.eachCell((cell,column)=>{cell.border=border;cell.font={bold:true,size:9};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}};cell.alignment={horizontal:column<=3?'center':'right',vertical:'middle'};if(column>=5)cell.numFmt='#,##0';});
  sheet.mergeCells(`A${sum.number}:E${sum.number}`);
  const buffer=await workbook.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a'); anchor.href=url; anchor.download=`${input.type}전표_${input.partnerName}_${input.tradeDate}.xlsx`; anchor.click();
  URL.revokeObjectURL(url);
}
