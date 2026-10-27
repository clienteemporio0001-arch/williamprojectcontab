/** Converte preço em reais digitado no painel (ex.: "69,90") sem arredondar valores inválidos. */
export function parsePlanPrice(raw:string):number|null {
  const text=raw.trim();
  if(!/^(?:0|[1-9][0-9]{0,4})(?:[,.][0-9]{1,2})?$/.test(text))return null;
  const parsed=Number(text.replace(',','.'));
  if(!Number.isFinite(parsed)||parsed<0||parsed>99999.99)return null;
  return Math.round(parsed*100)/100;
}

export function formatPlanPriceInput(value:number):string {
  return Number(value).toFixed(2).replace('.',',');
}
