import {OrderStatus,type Order,type Partner,type Item,type PalletStock} from '../../../shared/types';
import {boxCountOf} from '../../../shared/orderUnits';
import {orderNotesForDisplay} from '../../../shared/orderNote';
import {queryDateKey} from './deliveryQueryDate';

export const queryFields = [
    ['source', '판매 채널'], ['partner', '거래처'], ['address', '주소'],
    ['completion', '작업완료 여부'], ['item', '주문 품목'], ['quantity', '주문 수량'],
    ['label', '라벨 작업'], ['packaging', '포장'], ['pallet', '팔레트'],
    ['shipment', '출고완료 여부'], ['invoice', '송장'], ['note', '비고'],
    ['orderDate', '주문일'], ['deliveryDate', '출고예정일'],
  ];

export function queryValuesFor(order:Order,field:string,{partners,items,palletStocks}:{partners:Partner[];items:Item[];palletStocks:PalletStock[]}):string[] {
    const partner = partners.find(candidate => candidate.id === order.partnerId);
    switch (field) {
      case 'source': return [order.source];
      case 'partner': return [order.partnerName || partner?.name || '이름 없음'];
      case 'address': return [[partner?.address, partner?.addressDetail].filter(Boolean).join(' ')];
      case 'completion': return order.items.map(item => item.checked ? '완료' : '미완료');
      case 'item': return order.items.map(item => item.name);
      case 'quantity': return order.items.map(item => item.isBoxUnit ? `${boxCountOf(item)}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`);
      case 'label': return order.items.map(item => item.labelType && item.labelType !== '대기' ? item.labelType : '-');
      case 'packaging': return order.items.map(item => item.boxType || '-');
      case 'pallet': return (order.pallets ?? []).map(pallet => `${palletStocks.find(stock => stock.id === pallet.type)?.name || pallet.type} ${pallet.quantity}개`);
      case 'shipment': return [order.status === OrderStatus.SHIPPED ? '완료' : '미완료'];
      case 'invoice': return [(order.source === '택배' || order.source === '스마트스토어' || order.deliveryBoxes !== undefined) ? (order.invoicePrinted ? '완료' : '미완료') : '-'];
      case 'note': return orderNotesForDisplay(order).map(entry => entry.text);
      case 'orderDate': return [queryDateKey(order.createdAt)];
      case 'deliveryDate': return [queryDateKey(order.deliveryDate)];
      default: return [];
    }
  }

export function filterDeliverySearchOrders(sourceOrders:Order[],partners:Partner[],{queryDateFrom,queryDateTo,queryText}:{queryDateFrom:string;queryDateTo:string;queryText:string}):Order[] {
    const normalized = queryText.trim().toLocaleLowerCase('ko-KR');
    return sourceOrders.filter(order => {
      /*  **배송 화면은 상태로 거르지 않는다**(2026-09-14 사장님: "배송캘린더에 작업완료
       *  출고완료 주문만 뜨게 하지말고 대기중 작업중인 주문도 뜨게 해").
       *
       *  여기서 작업완료·출고완료만 들이고 있어서 **금일 배송순서와 캘린더가 어긋나 있었다** —
       *  금일 배송순서(`deliverySequenceOrders`)는 이미 `sourceOrders` 를 바로 읽어
       *  '배송완료가 아닌 것'을 다 담는데(2026-09-12 사장님: "금일배송순서가 배송캘린더
       *  당일에 해당하는거랑 일치해야 하는데"), 캘린더만 좁아 대기중·작업중이 빠졌다.
       *  **세는 곳이 둘이면 또 갈린다** — 그쪽 규칙에 맞춘다.
       *
       *  예전 주문(배송완료)도 들인다. 캘린더가 그걸 따로 모아(`deliveredSchedules`)
       *  '이전 N건' 으로 접어 두기 때문이다 — 전에는 여기서 막혀 그 접힘이 늘 비어 있었다. */
      if (order.partnerName === '생산기록') return false;
      const orderDate = queryDateKey(order.createdAt);
      if (queryDateFrom && orderDate < queryDateFrom) return false;
      if (queryDateTo && orderDate > queryDateTo) return false;
      if (!normalized) return true;
      const partner = partners.find(candidate => candidate.id === order.partnerId);
      return [
        order.id, order.partnerName, partner?.name, partner?.address, partner?.addressDetail,
        order.source, order.deliveryDate, order.note, ...order.items.map(item => item.name),
      ].filter(Boolean).some(value => String(value).toLocaleLowerCase('ko-KR').includes(normalized));
    });
  }
