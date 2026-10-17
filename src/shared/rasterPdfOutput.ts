import { appNotice } from './components/appDialog';
export interface RasterPdfDraw { image: string; x: number; y: number; width: number; height: number }
export interface RasterPdfPage { width: number; height: number; draws: RasterPdfDraw[] }
let active = false;

/** 대기 중 사용자가 원래 폼을 바꿔도 캡처할 입력값은 바뀌지 않는다. */
export function snapshotOutputElement(source: HTMLElement) {
  const element = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...Array.from(source.querySelectorAll('*'))], copies = [element, ...Array.from(element.querySelectorAll('*'))];
  originals.forEach((node, index) => {
    const copy = copies[index];
    if (node instanceof HTMLInputElement && copy instanceof HTMLInputElement) { copy.value = node.value; copy.setAttribute('value', node.value); copy.checked = node.checked; if (node.checked) copy.setAttribute('checked', ''); else copy.removeAttribute('checked'); }
    if (node instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) { copy.value = node.value; copy.textContent = node.value; }
    if (node instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) Array.from(copy.options).forEach((option, i) => { option.selected = node.options[i].selected; if (option.selected) option.setAttribute('selected', ''); else option.removeAttribute('selected'); });
    if (node instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement) { copy.width = node.width; copy.height = node.height; copy.getContext('2d')?.drawImage(node, 0, 0); }
  });
  const host = document.createElement('div'), rect = source.getBoundingClientRect(), style = getComputedStyle(source);
  Object.assign(host.style, {position:'fixed',left:'-100000px',top:'0',pointerEvents:'none',width:`${rect.width || source.scrollWidth || 794}px`,font:style.font,color:style.color});
  host.setAttribute('aria-hidden','true'); host.appendChild(element); document.body.appendChild(host);
  return {element, dispose: () => host.remove()};
}
export async function prepareRasterPdf(pages: RasterPdfPage[]) {
  const { default: JsPDF } = await import('jspdf');
  const first = pages[0] ?? {width:210,height:297};
  const pdf = new JsPDF(first.width > first.height ? 'l' : 'p', 'mm', first.width === 210 && first.height === 297 ? 'a4' : [first.width, first.height]);
  pages.forEach((page, index) => { if (index > 0) pdf.addPage([page.width,page.height],page.width > page.height ? 'l' : 'p'); page.draws.forEach(draw => pdf.addImage(draw.image, 'PNG', draw.x, draw.y, draw.width, draw.height)); });
  return {pages, buffer: pdf.output('arraybuffer')};
}
export async function previewRasterPdf(input: {pages: RasterPdfPage[]; fileName: string; signal: AbortSignal}): Promise<void> {
  if (input.signal.aborted || active) return;
  active = true;
  const pages = input.pages.map(page => ({...page,draws:page.draws.map(draw=>({...draw}))}));
  try {
    const artifact = await prepareRasterPdf(pages); if (input.signal.aborted) return;
    const [{createRoot}, {createElement}, {DocumentOutputPreview}] = await Promise.all([import('react-dom/client'),import('react'),import('./components/DocumentOutputPreview')]);
    if (input.signal.aborted) return;
    const host = document.createElement('div');document.body.appendChild(host);const root = createRoot(host);
    await new Promise<void>(resolve => {
      let closed = false;
      const close=()=>{if(closed)return;closed=true;input.signal.removeEventListener('abort',close);queueMicrotask(()=>{root.unmount();host.remove();resolve();});};
      input.signal.addEventListener('abort',close,{once:true});if(input.signal.aborted){close();return;}
      const children=createElement('div',{className:'space-y-4'},...artifact.pages.map((page,index)=>createElement('section',{key:index,'aria-label':`PDF ${index+1}쪽`,className:'relative mx-auto w-full max-w-[794px] overflow-hidden border border-slate-200 bg-white',style:{aspectRatio:`${page.width}/${page.height}`}},...page.draws.map((draw,i)=>createElement('img',{key:i,src:draw.image,alt:'',style:{position:'absolute',maxWidth:'none',left:`${draw.x/page.width*100}%`,top:`${draw.y/page.height*100}%`,width:`${draw.width/page.width*100}%`,height:`${draw.height/page.height*100}%`}})))));
      root.render(createElement(DocumentOutputPreview,{title:'PDF 미리보기',saveLabel:'PDF 저장',signal:input.signal,onClose:close,children,onSave:async()=>{
        if(closed||input.signal.aborted)return;
        const url=URL.createObjectURL(new Blob([artifact.buffer],{type:'application/pdf'}));
        try{if(closed||input.signal.aborted)return;const anchor=document.createElement('a');anchor.href=url;anchor.download=input.fileName.replace(/[\\/:*?"<>|]/g,'_');anchor.click();}finally{URL.revokeObjectURL(url);}
      }}));
    });
  }catch{if(!input.signal.aborted)await appNotice('PDF 미리보기를 준비하지 못했습니다. 파일은 저장하지 않았습니다. 다시 시도해 주세요.');}
  finally{active=false;}
}
