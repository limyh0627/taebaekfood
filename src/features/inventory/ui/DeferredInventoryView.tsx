import React, {Component, lazy, Suspense, useState, type ComponentType, type ReactNode} from 'react';
import type ItemList from '../../../../components/ItemList';
import type BomIntegrityPanel from '../../../../components/BomIntegrityPanel';

type ItemProps = React.ComponentProps<typeof ItemList>;
type BomProps = React.ComponentProps<typeof BomIntegrityPanel>;
type Loader<P> = () => Promise<{default: ComponentType<P>}>;
const loadItems = () => import('../../../../components/ItemList');
const loadBom = () => import('../../../../components/BomIntegrityPanel');

class InventoryLoadBoundary extends Component<{children:ReactNode;label:string;onRetry:()=>void},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if (this.state.failed) return <section role="alert" className="rounded border border-slate-200 bg-white p-4 text-slate-700">
      <p>{this.props.label} 화면을 불러오지 못했습니다. 다시 불러와 주세요.</p>
      <p className="mt-1 text-sm">계속 열리지 않으면 입력한 작업의 보관 상태를 확인한 뒤 화면을 새로고침해 주세요.</p>
      <button type="button" className="mt-3 rounded border px-3 py-2" onClick={this.props.onRetry}>다시 불러오기</button>
      <button type="button" className="ml-2 rounded border px-3 py-2" onClick={()=>window.location.reload()}>화면 새로고침</button>
    </section>;
    return this.props.children;
  }
}

/** 실패한 영역만 새 lazy 시도로 바꿔 옆 재고 화면의 입력을 유지한다. */
export function DeferredInventorySection<P extends object>({loader,label,viewProps}:{loader:Loader<P>;label:string;viewProps:P}) {
  const [attempt,setAttempt] = useState(()=>({number:0,View:lazy(loader)}));
  const View = attempt.View as ComponentType<P>;
  return <InventoryLoadBoundary key={attempt.number} label={label} onRetry={()=>setAttempt(previous=>({number:previous.number+1,View:lazy(loader)}))}>
    <Suspense fallback={<div role="status" className="p-4 text-slate-500">{label} 화면을 불러오는 중입니다.</div>}><View {...viewProps}/></Suspense>
  </InventoryLoadBoundary>;
}

export default function DeferredInventoryView({bomProps,...itemProps}:ItemProps & {bomProps?:BomProps}) {
  return <>
    {bomProps&&<DeferredInventorySection key={'bom:'+itemProps.companyId} loader={loadBom} label="BOM 점검" viewProps={bomProps}/>}
    <DeferredInventorySection key={'items:'+itemProps.companyId} loader={loadItems} label="재고" viewProps={itemProps}/>
  </>;
}
