export type Client = {
  id: string; org_id?: string; name: string; company: string; tax_id?: string | null; phone: string;
  opt_in: boolean; opt_in_at: string | null; consent_source: string | null;
  active: boolean; created_at?: string;
};
export type Obligation = {
  id: string; org_id?: string; client_id: string; title: string; amount: number | null;
  due_date: string; status: 'pending' | 'paid' | 'cancelled'; document_url: string | null;
  recurring: boolean; series_id: string | null; due_day: number | null; reminder_offsets?: number[];
  created_at?: string;
};
export type ReminderLog = {
  id: string; org_id: string; obligation_id: string; due_date: string;
  offset_days: number; status: 'sent' | 'failed' | 'processing';
  created_at: string; error?: string | null;
};
export const DEFAULT_TEMPLATE = 'Olá, {nome}! Seus honorários contábeis referentes a {documento} vencem em {vencimento}, no valor de {valor}. Segue o aviso de cobrança. Caso já tenha pago, por favor desconsidere.';
export function dateISO(delta = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + delta);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export const formatDate = (iso: string) => iso ? new Intl.DateTimeFormat('pt-BR', {day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z')) : '—';
export function daysUntil(iso: string) {
  return Math.round((Date.parse(iso+'T12:00:00Z') - Date.parse(dateISO()+'T12:00:00Z')) / 86400000);
}
export const money = (n: number | null) => n == null ? 'Não informado' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
export function phoneDigits(phone: string) {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}
export function renderMessage(template: string, client: Client, obligation: Obligation) {
  const vars: Record<string,string> = {
    nome: client.name.split(' ')[0], cliente: client.name, empresa: client.company || client.name,
    documento: obligation.title, vencimento: formatDate(obligation.due_date),
    valor: money(obligation.amount),
    link: obligation.document_url ? 'Documento: '+obligation.document_url : ''
  };
  return template.replace(/\{([a-z_]+)\}/gi, (_whole, key: string) => vars[key.toLowerCase()] ?? '');
}
export const demoClients: Client[] = [
  {id:'demo-c1',name:'Ana Martins',company:'Martins Comércio',phone:'5568999112233',opt_in:true,opt_in_at:new Date().toISOString(),consent_source:'Formulário (exemplo)',active:true},
  {id:'demo-c2',name:'Carlos Oliveira',company:'Oliveira Serviços',phone:'5568999223344',opt_in:true,opt_in_at:new Date().toISOString(),consent_source:'Contrato (exemplo)',active:true},
  {id:'demo-c3',name:'Fernanda Lima',company:'FL Consultoria',phone:'5568999334455',opt_in:false,opt_in_at:null,consent_source:null,active:true},
  {id:'demo-c4',name:'Pedro Souza',company:'Souza Transportes',phone:'5568999445566',opt_in:true,opt_in_at:new Date().toISOString(),consent_source:'Formulário (exemplo)',active:true}
];
export const demoObligations: Obligation[] = [
  {id:'demo-o1',client_id:'demo-c1',title:'Honorários contábeis',amount:385.9,due_date:dateISO(3),status:'pending',document_url:null,recurring:true,series_id:'demo-series1',due_day:new Date(dateISO(3)+'T12:00:00').getDate()},
  {id:'demo-o2',client_id:'demo-c2',title:'Honorários contábeis',amount:450,due_date:dateISO(1),status:'pending',document_url:null,recurring:true,series_id:'demo-series2',due_day:new Date(dateISO(1)+'T12:00:00').getDate()},
  {id:'demo-o3',client_id:'demo-c3',title:'Honorários contábeis',amount:210.5,due_date:dateISO(-2),status:'pending',document_url:null,recurring:false,series_id:null,due_day:null},
  {id:'demo-o4',client_id:'demo-c4',title:'Honorários contábeis',amount:780,due_date:dateISO(7),status:'pending',document_url:null,recurring:true,series_id:'demo-series4',due_day:new Date(dateISO(7)+'T12:00:00').getDate()}
];
