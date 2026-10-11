/** 앱과 서버의 세금 포함 전표 줄 계산. 입력칸의 Number(value)||0 정책을 보존한다. */
export interface LineAmount {gross:number;supply:number;tax:number}
export const VAT_RATE=0.1;
export function lineAmount(qty:number,price:number,exempt?:boolean):LineAmount{
  const gross=Math.round((Number(qty)||0)*(Number(price)||0));
  if(exempt)return {gross,supply:gross,tax:0};
  const supply=Math.round(gross/(1+VAT_RATE));
  return {gross,supply,tax:gross-supply};
}
