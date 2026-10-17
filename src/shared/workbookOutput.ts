import type { Workbook, CellValue } from 'exceljs';
import { appNotice } from './components/appDialog';

export interface WorkbookCellPreview { column: number; text: string; colSpan: number; rowSpan: number; align: 'left' | 'right' | 'center'; bold: boolean; note?: string }
export interface WorkbookSheetPreview { name: string; widths: number[]; rows: {height: number; cells: WorkbookCellPreview[]}[] }
let active = false;

export async function prepareWorkbookOutput(workbook: Workbook) {
  // 확정한 같은 파일을 미리보기와 저장에 함께 사용한다.
  const buffer = await workbook.xlsx.writeBuffer();
  const [{ Workbook: WorkbookClass }, { SSF }] = await Promise.all([import('exceljs'), import('xlsx')]);
  const frozen = new WorkbookClass(); await frozen.xlsx.load(buffer);
  const sheets: WorkbookSheetPreview[] = frozen.worksheets.map(sheet => {
    const count = sheet.columnCount, spans = new Map<string, {rows: number; columns: number}>();
    for (const address of sheet.model.merges ?? []) {
      const [from, to] = address.split(':').map(part => sheet.getCell(part));
      spans.set(from.address, {rows: Number(to.row) - Number(from.row) + 1, columns: Number(to.col) - Number(from.col) + 1});
    }
    const widths = Array.from({length: count}, (_, index) => Math.max(24, (sheet.getColumn(index + 1).width ?? 8.43) * 7 + 5));
    const rows = Array.from({length: sheet.rowCount}, (_, index) => {
      const row = sheet.getRow(index + 1), cells: WorkbookCellPreview[] = [];
      for (let column = 1; column <= count; column++) {
        const cell = row.getCell(column); if (cell.isMerged && cell.master.address !== cell.address) continue;
        let value: CellValue | undefined = cell.value, note: string | undefined;
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
          value = value.result; if (value === undefined) note = '계산 결과가 저장되지 않은 수식입니다.';
        }
        let text = value == null ? '' : cell.text;
        if (typeof value === 'number' || value instanceof Date) {
          try { text = SSF.format(cell.numFmt || 'General', value, {date1904: frozen.properties.date1904}); }
          catch { text = String(value); note = `서식 확인 필요: ${cell.numFmt}`; }
        } else if (value && typeof value === 'object' && 'error' in value) text = value.error;
        else if (typeof value === 'boolean') text = value ? 'TRUE' : 'FALSE';
        const span = spans.get(cell.address);
        cells.push({column, text, colSpan: span?.columns ?? 1, rowSpan: span?.rows ?? 1, align: cell.alignment?.horizontal === 'center' ? 'center' : cell.alignment?.horizontal === 'right' || typeof value === 'number' ? 'right' : 'left', bold: !!cell.font?.bold, note});
      }
      return {height: (row.height ?? 15) * 4 / 3, cells};
    });
    return {name: sheet.name, widths, rows};
  });
  return {sheets, buffer};
}

export type WorkbookOutputArtifact = Awaited<ReturnType<typeof prepareWorkbookOutput>>;

/** 확인한 파일 바이트만 내려받고 업무 저장은 호출하지 않는다. */
export function downloadWorkbookArtifact(artifact: WorkbookOutputArtifact, fileName: string, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  const url=URL.createObjectURL(new Blob([artifact.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  try { if(signal.aborted)return false;const anchor=document.createElement('a');anchor.href=url;anchor.download=fileName.replace(/[\\/:*?"<>|]/g,'_');anchor.click();return true; }
  finally { URL.revokeObjectURL(url); }
}

export async function previewPreparedWorkbookOutput(input:{artifact:WorkbookOutputArtifact;fileName:string;signal:AbortSignal;approvalOnly?:boolean}):Promise<boolean>{
  if(input.signal.aborted||active)return false;active=true;
  try{
    const [{createRoot},{createElement},{DocumentOutputPreview,WorkbookSheets}]=await Promise.all([import('react-dom/client'),import('react'),import('./components/DocumentOutputPreview')]);
    if(input.signal.aborted)return false;
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    return await new Promise<boolean>(resolve=>{
      let closed=false,approved=false;
      const close=()=>{if(closed)return;closed=true;input.signal.removeEventListener('abort',close);queueMicrotask(()=>{root.unmount();host.remove();resolve(approved&&!input.signal.aborted);});};
      input.signal.addEventListener('abort',close,{once:true});if(input.signal.aborted){close();return;}
      root.render(createElement(DocumentOutputPreview,{title:'문서 엑셀 미리보기',saveLabel:input.approvalOnly?'이 내용으로 진행':'엑셀 저장',signal:input.signal,onClose:close,onSave:async()=>{
        if(closed||input.signal.aborted)return;
        approved=input.approvalOnly?true:downloadWorkbookArtifact(input.artifact,input.fileName,input.signal);
      },children:createElement(WorkbookSheets,{sheets:input.artifact.sheets})}));
    });
  }catch{if(!input.signal.aborted)await appNotice('문서 미리보기를 준비하지 못했습니다. 파일은 저장하지 않았습니다. 다시 시도해 주세요.');return false;}
  finally{active=false;}
}
export const confirmWorkbookOutput=(input:{artifact:WorkbookOutputArtifact;fileName:string;signal:AbortSignal})=>previewPreparedWorkbookOutput({...input,approvalOnly:true});

export async function previewWorkbookOutput(input:{workbook:Workbook;fileName:string;signal:AbortSignal}):Promise<void>{
  if(input.signal.aborted||active)return;
  try{const artifact=await prepareWorkbookOutput(input.workbook);if(input.signal.aborted)return;await previewPreparedWorkbookOutput({artifact,fileName:input.fileName,signal:input.signal});}
  catch{if(!input.signal.aborted)await appNotice('문서 미리보기를 준비하지 못했습니다. 파일은 저장하지 않았습니다. 다시 시도해 주세요.');}
}
