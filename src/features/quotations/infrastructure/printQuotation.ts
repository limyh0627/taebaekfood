export function printQuotation() {
    // 앱 화면을 인쇄하지 않는다. 견적서 본문과 스타일만 담은 독립 문서를 iframe에 만든 뒤
    // 그 문서를 인쇄한다. 그래야 모달의 가운데 정렬·크기·스크롤이 A4에 섞이지 않는다.
    const source = document.getElementById('quotation-print-document');
    if (!source) return;
    document.getElementById('quotation-print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'quotation-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0',
      border: '0', opacity: '0', pointerEvents: 'none',
    });
    const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML).join('\n');
    const printCss = `
      @page { size: A4 portrait; margin: 0; }
      html, body { width: 210mm; margin: 0; padding: 0; background: white; }
      #quotation-print-document {
        display: block !important; width: 210mm !important; min-height: 0 !important;
        margin: 0 !important; padding: 10mm !important; box-sizing: border-box !important;
        overflow: visible !important; font-family: Arial, "Noto Sans KR", sans-serif;
      }
      .print\\:hidden { display: none !important; }
    `;
    const cleanup = () => {
      frame.remove();
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="UTF-8"><title></title>${styleTags}<style>${printCss}</style></head><body>${source.outerHTML}</body></html>`;
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { cleanup(); return; }
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      printWindow.focus();
      printWindow.print();
    };
    // srcdoc를 넣기 전에 DOM에 붙이면 iframe의 첫 about:blank 로드가 onload를 먼저 불러
    // 빈 종이를 인쇄한다. 완성된 문서를 지정한 뒤 붙여야 견적서가 든 로드 한 번만 일어난다.
    document.body.appendChild(frame);
  }
