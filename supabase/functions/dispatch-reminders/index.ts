// Edge Function: disparo horário de lembretes usando a API oficial da Meta.
// Configure verify_jwt=false, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME.
// Nunca inclua essas credenciais no código do navegador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Org = { id:string; name:string; timezone:string };
type Client = { id:string; name:string; phone:string; active:boolean; opt_in:boolean; opt_in_at:string|null };
type Obligation = {
  id:string; org_id:string; client_id:string; title:string; due_date:string;
  amount:number|null; status:string; recurring:boolean; series_id:string|null;
  due_day:number|null; document_url:string|null; clients:Client|null;
};

const cors = { 'content-type':'application/json' };
function fail(message:string,status=500){return new Response(JSON.stringify({error:message}),{status,headers:cors});}
function localParts(date:Date,zone:string) {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const get=(key:string)=>parts.find(p=>p.type===key)?.value||'';
  return {date:get('year')+'-'+get('month')+'-'+get('day'),hour:Number(get('hour'))};
}
function dayDiff(date1:string,date2:string){
  return Math.round((Date.parse(date1+'T00:00:00Z')-Date.parse(date2+'T00:00:00Z'))/86400000);
}
function nextMonthDue(today:string,day:number) {
  const [year,month]=today.split('-').map(Number);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return String(year)+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
}
function formatDate(date:string){
  const [y,m,d]=date.split('-');
  return d+'/'+m+'/'+y;
}
function formatBRL(n:number|null){
  return n==null?'não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
}
async function sendOfficial(phone:string,values:string[]) {
  const token=Deno.env.get('WHATSAPP_TOKEN');
  const phoneId=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const template=Deno.env.get('WHATSAPP_TEMPLATE_NAME')||'lembrete_contabil';
  const lang=Deno.env.get('WHATSAPP_TEMPLATE_LANG')||'pt_BR';
  const version=Deno.env.get('WHATSAPP_GRAPH_VERSION')||'v23.0';
  if(!token||!phoneId) throw new Error('Credenciais WhatsApp não configuradas');
  const response=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({
      messaging_product:'whatsapp',to:phone,type:'template',
      template:{name:template,language:{code:lang},components:[{
        type:'body',parameters:values.map(text=>({type:'text',text}))
      }]}
    })
  });
  const json=await response.json();
  if(!response.ok||!json?.messages?.[0]?.id)
    throw new Error('Meta HTTP '+response.status+': '+JSON.stringify(json).slice(0,300));
  return String(json.messages[0].id);
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return fail('Método não permitido',405);
  const secret=Deno.env.get('CRON_SECRET');
  if(!secret||req.headers.get('x-cron-secret')!==secret)return fail('Não autorizado',401);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return fail('Banco não configurado');
  const db=createClient(url,key,{auth:{persistSession:false}});
  const token=Deno.env.get('WHATSAPP_TOKEN');
  const phoneId=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if(!token||!phoneId||!Deno.env.get('WHATSAPP_TEMPLATE_NAME'))
    return fail('Configure os segredos do WhatsApp e um template de utilidade aprovado',503);

  const stats={organizations:0,generated:0,sent:0,failed:0,skipped:0};
  const {data:orgs,error:orgError}=await db.from('organizations')
    .select('id,name,timezone').limit(200);
  if(orgError)return fail(orgError.message);

  for(const org of (orgs||[]) as Org[]) {
    let local;
    try{local=localParts(new Date(),org.timezone);}
    catch{stats.skipped++;continue;}
    // Agendamento: uma vez por dia, entre 9h e 10h da manhã de cada escritório.
    if(local.hour!==9)continue;
    stats.organizations++;

    // Gera a competência do mês corrente em séries recorrentes (idempotente).
    const {data:cycles,error:cyclesError}=await db.from('obligations')
      .select('id,org_id,client_id,title,amount,due_date,document_url,recurring,series_id,due_day')
      .eq('org_id',org.id).eq('recurring',true).order('due_date',{ascending:false}).limit(1000);
    if(cyclesError){stats.failed++;continue;}
    const latest=new Map<string, NonNullable<typeof cycles>[number]>();
    for(const item of cycles||[]){
      if(item.series_id && !latest.has(item.series_id))latest.set(item.series_id,item);
    }
    for(const item of latest.values()){
      if(item.due_date.slice(0,7)>=local.date.slice(0,7))continue;
      const newDue=nextMonthDue(local.date,item.due_day||20);
      const {error:e}=await db.from('obligations').insert({
        org_id:org.id,client_id:item.client_id,title:item.title,amount:item.amount,
        due_date:newDue,status:'pending',recurring:true,series_id:item.series_id,
        due_day:item.due_day,document_url:null // URL anterior nunca é reutilizada em outra competência.
      });
      if(!e)stats.generated++;
      else if(e.code!=='23505')stats.failed++;
    }

    // Lê somente obrigações ainda não pagas, com vencimento na janela permitida.
    const minDate=new Date(local.date+'T00:00:00Z');minDate.setUTCDate(minDate.getUTCDate()-1);
    const maxDate=new Date(local.date+'T00:00:00Z');maxDate.setUTCDate(maxDate.getUTCDate()+7);
    const {data:due,error:dueError}=await db.from('obligations')
      .select('id,org_id,client_id,title,amount,due_date,status,recurring,series_id,due_day,document_url,clients!inner(id,name,phone,active,opt_in,opt_in_at)')
      .eq('org_id',org.id).eq('status','pending')
      .gte('due_date',minDate.toISOString().slice(0,10))
      .lte('due_date',maxDate.toISOString().slice(0,10)).limit(1000);
    if(dueError){stats.failed++;continue;}

    for(const record of due||[]){
      const item=record as unknown as Obligation;
      const client=item.clients;
      if(!client?.active||!client.opt_in||!client.opt_in_at){stats.skipped++;continue;}
      const offset=dayDiff(item.due_date,local.date);
      if(![7,3,1,0,-1].includes(offset))continue;

      // Unique constraint registra a tentativa ANTES de enviar, impedindo duplicidade.
      const {data:log,error:logError}=await db.from('reminder_logs').insert({
        org_id:org.id,obligation_id:item.id,due_date:item.due_date,
        offset_days:offset,status:'processing'
      }).select('id').single();
      if(logError){stats.skipped++;continue;}
      try{
        // Template Meta 'lembrete_contabil' aprovado com 4 campos de corpo:
        // {{1}} nome, {{2}} documento, {{3}} vencimento, {{4}} valor.
        const messageId=await sendOfficial(client.phone,[
          client.name.split(' ')[0],item.title,formatDate(item.due_date),formatBRL(item.amount)
        ]);
        await db.from('reminder_logs').update({
          status:'sent',provider_message_id:messageId,sent_at:new Date().toISOString()
        }).eq('id',log.id);
        stats.sent++;
      }catch(err){
        await db.from('reminder_logs').update({
          status:'failed',error:String(err).slice(0,500)
        }).eq('id',log.id);
        stats.failed++;
      }
    }
  }
  return new Response(JSON.stringify({ok:true,...stats}),{headers:cors});
});
