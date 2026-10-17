import { previewRasterPdf, snapshotOutputElement, type RasterPdfPage } from '../../../shared/rasterPdfOutput';
export async function downloadAsPDF(element: HTMLElement, filename: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const snapshot = snapshotOutputElement(element);
  try {
    const { default: html2canvas } = await import('html2canvas'); if (signal.aborted) return;
    const canvas = await html2canvas(snapshot.element, {scale:2,backgroundColor:'#ffffff',useCORS:true}); snapshot.dispose(); if (signal.aborted) return;
    const pageWidth=210,pageHeight=297,imgWidth=pageWidth,imgHeight=(canvas.height*imgWidth)/canvas.width;
    let remainingHeight=imgHeight,currentY=0; const pages:RasterPdfPage[]=[];
    while(remainingHeight>0){pages.push({width:pageWidth,height:pageHeight,draws:[{image:canvas.toDataURL('image/png'),x:0,y:-currentY,width:imgWidth,height:imgHeight}]});currentY+=pageHeight;remainingHeight-=pageHeight;}
    if(signal.aborted)return;
    await previewRasterPdf({pages,fileName:filename,signal});
  } finally { snapshot.dispose(); }
}
