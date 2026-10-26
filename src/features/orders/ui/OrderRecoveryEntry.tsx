import React,{useState} from 'react';
import {LockKeyhole} from 'lucide-react';
import ModalShell from '../../../shared/components/ModalShell';
import type { Order } from '../../../shared/types';
import { orderInventoryErrorMessage } from '../../../shared/orderInventoryError';
export function OrderRecoveryEntry({order,renderOrderRecovery}:{order:Order;renderOrderRecovery?: (order:Order)=>React.ReactNode}) {
 const [open,setOpen]=useState(false),action=renderOrderRecovery?.(order);
 if(action)return <>{action}</>;
 if(!order.inventoryOperation)return null;
 return <><button type="button" aria-label="잠금 이유 및 복구" title="잠금 이유 및 복구" className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600" onClick={()=>setOpen(true)}><LockKeyhole size={14}/></button>{open&&<ModalShell className="text-slate-700" title="주문 재고 작업 확인" onClose={()=>setOpen(false)}><p>{order.inventoryOperation.state==='processing'?'현재 재고 작업을 처리 중입니다. 자동 해제하거나 다시 시작하지 않습니다.':'실패한 원작업을 확인해 주세요.'}</p>{order.inventoryOperation.error&&<p>{orderInventoryErrorMessage(order.inventoryOperation.error)}</p>}<button type="button" onClick={()=>setOpen(false)}>주문으로 돌아가기</button></ModalShell>}</>;
}
