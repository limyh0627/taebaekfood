import { useState } from 'react';
import type { Order, OrderItem } from '../../../shared/types';
import { clampNote } from '../../../shared/orderNote';
interface OrderEditorDraftOptions {
 orders: Order[]; embeddedListOnly: boolean; onBeforeOpen: () => void;
 onUpdateDeliveryDate: (id: string, date: string) => void;
 onUpdateItems?: (id: string, items: OrderItem[]) => void;
 onUpdateNote?: (id: string, note: string, important: boolean) => void;
}
export function useOrderEditorDraft({ orders, embeddedListOnly, onBeforeOpen, onUpdateDeliveryDate, onUpdateItems, onUpdateNote }: OrderEditorDraftOptions) {
  const [listOrderEditor, setListOrderEditor] = useState<{ orderId: string; deliveryDate: string; items: OrderItem[]; note: string; noteImportant: boolean } | null>(null);
  /*  주문 수정 창의 팔레트는 **접어 둔다**(2026-09-12 사장님: "팔레트는 좀 접어둬라
      필요할때 펼치게"). 늘 건드리는 칸이 아닌데 자리를 크게 먹어 품목이 밀렸다.
      창을 닫았다 열면 다시 접힌다. */
  const [showEditorPallet, setShowEditorPallet] = useState(false);
  const editorOrder = listOrderEditor ? orders.find(order => order.id === listOrderEditor.orderId) : undefined;
  const openOrderEditor = (orderId: string) => {
    const order = orders.find(candidate => candidate.id === orderId);
    if (!order || embeddedListOnly) return;
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
        const closeEditor = () => setListOrderEditor(null);
        const 주문수량 = (item: OrderItem) => item.isBoxUnit ? (item.boxQuantity ?? item.quantity) : item.quantity;
        const saveEditor = () => {
          if (!listOrderEditor || !editorOrder) return;
          if (!listOrderEditor.deliveryDate || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId || 주문수량(item) <= 0)) return;
          if (listOrderEditor.deliveryDate !== editorOrder.deliveryDate.split('T')[0]) {
            onUpdateDeliveryDate(editorOrder.id, new Date(listOrderEditor.deliveryDate).toISOString());
          }
          onUpdateItems?.(editorOrder.id, listOrderEditor.items);
          if (listOrderEditor.note !== (editorOrder.note || '') || listOrderEditor.noteImportant !== !!editorOrder.noteImportant) {
            onUpdateNote?.(editorOrder.id, clampNote(listOrderEditor.note.trim(), editorOrder.note), listOrderEditor.noteImportant);
          }
          closeEditor();
        };
        const addDraftItem = () => editorOrder && setListOrderEditor(current => current && current.orderId === editorOrder.id
          ? { ...current, items: [...current.items, { itemId: '', name: '', quantity: 1, price: 0 }] }
          : current);
        const saveDisabled = !listOrderEditor || !listOrderEditor.deliveryDate || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId || 주문수량(item) <= 0);
  return {listOrderEditor,setListOrderEditor,editorOrder,showEditorPallet,setShowEditorPallet,openOrderEditor,closeEditor,updateDraftItem,addDraftItem,saveEditor,saveDisabled,주문수량};
}
