import { isCalendarDay } from '../../../shared/day';
import { useState, useRef, useEffect } from 'react';
import type { Order, OrderItem } from '../../../shared/types';
import { clampNote } from '../../../shared/orderNote';
export interface OrderEditDraft { deliveryDate:string;items:OrderItem[];note:string;noteImportant:boolean; }
export type OrderEditSaveResult = {status:'saved'} | {status:'blocked'|'cancelled';message?:string};
interface OrderEditorDraftOptions {
 onSaveOrderEdit?: (id:string,draft:OrderEditDraft)=>Promise<OrderEditSaveResult>;
 orders: Order[]; embeddedListOnly: boolean; onBeforeOpen: () => void;
 onUpdateDeliveryDate: (id: string, date: string) => void;
 onUpdateItems?: (id: string, items: OrderItem[]) => void;
 onUpdateNote?: (id: string, note: string, important: boolean) => void;
}
export function useOrderEditorDraft({ orders, embeddedListOnly, onBeforeOpen, onUpdateDeliveryDate, onUpdateItems, onUpdateNote, onSaveOrderEdit }: OrderEditorDraftOptions) {
  const [listOrderEditor, setListOrderEditor] = useState<{ orderId: string; deliveryDate: string; items: OrderItem[]; note: string; noteImportant: boolean } | null>(null);
  /*  주문 수정 창의 팔레트는 **접어 둔다**(2026-09-12 사장님: "팔레트는 좀 접어둬라
      필요할때 펼치게"). 늘 건드리는 칸이 아닌데 자리를 크게 먹어 품목이 밀렸다.
      창을 닫았다 열면 다시 접힌다. */
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const busy=useRef(false),generation=useRef(0),alive=useRef(true),draftRef=useRef(listOrderEditor);draftRef.current=listOrderEditor;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const [showEditorPallet, setShowEditorPallet] = useState(false);
  const editorOrder = listOrderEditor ? orders.find(order => order.id === listOrderEditor.orderId) : undefined;
  const openOrderEditor = (orderId: string) => {
    const order = orders.find(candidate => candidate.id === orderId);
    if (!order || embeddedListOnly) return;
    generation.current++;busy.current=false;setSaving(false);setSaveError('');
    onBeforeOpen();
    setShowEditorPallet(false);   // 열 때는 늘 접힌 채로
    setListOrderEditor({
      orderId: order.id,
      deliveryDate: order.deliveryDate.split('T')[0],
      items: order.items.map(item => ({ ...item })),
      note: order.note || '',
      noteImportant: !!order.noteImportant,
    });
  };
        const updateDraftItem = (index: number, patch: Partial<OrderItem>) => {
          if (!editorOrder) return;
          setListOrderEditor(current => current && current.orderId === editorOrder.id
            ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }
            : current);
        };
        const closeEditor = () => {generation.current++;busy.current=false;setSaving(false);setSaveError('');setListOrderEditor(null);};
        const 주문수량 = (item: OrderItem) => item.isBoxUnit ? (item.boxQuantity ?? item.quantity) : item.quantity;
        const saveEditor = async () => {
          if (busy.current || !listOrderEditor || !editorOrder) return;
          if (!isCalendarDay(listOrderEditor.deliveryDate) || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId || 주문수량(item) <= 0)) return;
          const snapshot=listOrderEditor,turn=generation.current;
          busy.current=true;setSaving(true);setSaveError('');
          try {
            const draft={deliveryDate:new Date(snapshot.deliveryDate).toISOString(),items:snapshot.items,note:clampNote(snapshot.note.trim(),editorOrder.note),noteImportant:snapshot.noteImportant};
            if(onSaveOrderEdit){
              const result=await onSaveOrderEdit(editorOrder.id,draft);
              if(!alive.current||turn!==generation.current)return;
              if(result.status!=='saved'){setSaveError(result.message??(result.status==='cancelled'?'저장을 취소했습니다.':'수정할 수 없는 품목을 확인해 주세요.'));return;}
            } else {
              if(snapshot.deliveryDate!==editorOrder.deliveryDate.split('T')[0])await onUpdateDeliveryDate(editorOrder.id,draft.deliveryDate);
              await onUpdateItems?.(editorOrder.id,draft.items);
              if(snapshot.note!==(editorOrder.note||'')||snapshot.noteImportant!==!!editorOrder.noteImportant)await onUpdateNote?.(editorOrder.id,draft.note,draft.noteImportant);
            }
            if(alive.current&&turn===generation.current&&draftRef.current===snapshot)closeEditor();
          }catch{
            if(alive.current&&turn===generation.current)setSaveError('저장 결과를 확인하지 못했습니다. 현재 주문을 확인한 뒤 다시 시도해 주세요. 작성 내용은 남아 있습니다.');
          }finally{if(alive.current&&turn===generation.current){busy.current=false;setSaving(false);}}
        };
        const addDraftItem = () => editorOrder && setListOrderEditor(current => current && current.orderId === editorOrder.id
          ? { ...current, items: [...current.items, { itemId: '', name: '', quantity: 1, price: 0 }] }
          : current);
        const saveDisabled = saving || !listOrderEditor || !isCalendarDay(listOrderEditor.deliveryDate) || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId || 주문수량(item) <= 0);
  return {listOrderEditor,setListOrderEditor,editorOrder,showEditorPallet,setShowEditorPallet,openOrderEditor,closeEditor,updateDraftItem,addDraftItem,saveEditor,saveDisabled,saving,saveError,주문수량};
}
