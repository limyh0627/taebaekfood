export async function downloadAsPDF(element: HTMLElement, filename: string) {
  const { default: jsPDF } = await import('jspdf') as any;
  const { default: html2canvas } = await import('html2canvas') as any;
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const pageHeight = 297;
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  let remainingHeight = imgHeight;
  let currentY = 0;
  let isFirstPage = true;
  while (remainingHeight > 0) {
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -currentY, imgWidth, imgHeight);
    currentY += pageHeight;
    remainingHeight -= pageHeight;
    isFirstPage = false;
  }
  pdf.save(filename);
}
