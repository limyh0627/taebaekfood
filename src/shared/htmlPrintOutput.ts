import { appNotice } from './components/appDialog';
let active = false;
/** 준비된 문서 하나를 고정하고, 사용자가 보고 승인한 같은 프레임만 인쇄한다. */
export async function previewHtmlPrint(input: { html: string; title: string; signal: AbortSignal }): Promise<void> {
 if (input.signal.aborted || active) return;
 active = true;
 const marker = crypto.randomUUID();
 const snapshot = String(input.html).replace(/<head\b[^>]*>/i, head => head + `<meta name="html-output-snapshot" content="${marker}">`);
 const title = String(input.title);
 try {
  const [React,{createRoot},{DocumentOutputPreview}] = await Promise.all([import('react'),import('react-dom/client'),import('./components/DocumentOutputPreview')]);
  if (input.signal.aborted) return;
  const host=document.createElement('div'); document.body.appendChild(host);const root=createRoot(host);
  await new Promise<void>(resolve=>{
   let closed=false,frame:HTMLIFrameElement|null=null,ready=false,stopPrint=()=>{};
   const close=()=>{if(closed)return;closed=true;ready=false;input.signal.removeEventListener('abort',close);stopPrint();queueMicrotask(()=>{root.unmount();host.remove();resolve();});};
   input.signal.addEventListener('abort',close,{once:true});if(input.signal.aborted){close();return;}
   function Preview(){
    const [loadError,setLoadError]=React.useState(''),[loaded,setLoaded]=React.useState(false),[generation,setGeneration]=React.useState(0),[printing,setPrinting]=React.useState(false);
    const onLoad=()=>{if(closed||input.signal.aborted)return;const matches=frame?.contentDocument?.querySelector('meta[name="html-output-snapshot"]')?.getAttribute('content')===marker;ready=matches;if(matches){setLoaded(true);setLoadError('');}else{setLoaded(false);setLoadError('인쇄 내용을 준비하지 못했습니다. 같은 문서를 다시 불러오세요.');}};
    const save=async()=>{
     const target=frame;if(closed||input.signal.aborted)return;
     if(!ready||!target?.isConnected||!target.contentWindow)throw Error('문서 준비 필요');
     await target.contentDocument?.fonts?.ready;
     if(closed||input.signal.aborted)return;
     if(!ready||frame!==target||!target.isConnected||!target.contentWindow)throw Error('문서 변경');
     setPrinting(true);
     try { await new Promise<void>((yes,no)=>{const win=target.contentWindow!;let settled=false;const finish=()=>{if(settled)return;settled=true;win.removeEventListener('afterprint',finish);stopPrint=()=>{};yes();};stopPrint=finish;win.addEventListener('afterprint',finish,{once:true});try{if(closed||input.signal.aborted){finish();return;}win.focus();win.print();}catch(error){win.removeEventListener('afterprint',finish);stopPrint=()=>{};settled=true;no(error);}}); } finally { if(!closed&&!input.signal.aborted)setPrinting(false); }
    };
    return React.createElement(DocumentOutputPreview,{title:title+' 인쇄 미리보기',signal:input.signal,onSave:save,onClose:close,saveLabel:'인쇄창 열기',errorMessage:'인쇄창을 열지 못했습니다. 문서 준비 상태를 확인하고 같은 내용으로 다시 시도해 주세요.',children:React.createElement(React.Fragment,null,
     React.createElement('p',{className:'mb-3 text-sm'},'아래 문서를 확인한 뒤 인쇄하세요.'),
     !loaded&&React.createElement('p',{role:'status'},'인쇄 문서를 준비하고 있습니다.'),
     loadError&&React.createElement('p',{role:'alert'},loadError),
     React.createElement('button',{type:'button',disabled:printing,className:'mb-3 rounded-lg border border-slate-300 px-3 py-2',onClick:()=>{if(closed||input.signal.aborted)return;ready=false;setLoaded(false);setLoadError('');setGeneration(value=>value+1);}},'같은 문서 다시 불러오기'),
     React.createElement('iframe',{key:generation,title:title+' 인쇄 내용',srcDoc:snapshot,sandbox:'allow-same-origin allow-modals',ref:(value:HTMLIFrameElement|null)=>{frame=value;},onLoad,onError:()=>{if(!closed&&!input.signal.aborted){ready=false;setLoaded(false);setLoadError('문서를 불러오지 못했습니다. 같은 문서를 다시 불러오세요.');}},className:'w-full min-w-0 rounded-lg border border-slate-200',style:{height:'60vh',minHeight:320,background:'white'}}))});
   }
   root.render(React.createElement(Preview));
  });
 }catch{if(!input.signal.aborted)await appNotice('인쇄 미리보기를 열지 못했습니다. 인쇄하지 않았습니다. 다시 시도해 주세요.');}
 finally{active=false;}
}
