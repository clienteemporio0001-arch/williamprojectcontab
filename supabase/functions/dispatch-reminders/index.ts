// Edge Function: disparo horário de lembretes usando a API oficial da Meta.
// Configure verify_jwt=false, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME.
// Nunca inclua essas credenciais no código do navegador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createChargePdf } from '../_shared/billing_pdf.ts';

type Org = { id:string; name:string; timezone:string;tax_id:string;pix_key:string;billing_contact:string;access_status:'active'|'suspended' };
type Client = { id:string; name:string; phone:string; active:boolean; opt_in:boolean; opt_in_at:string|null };
type Obligation = {
  id:string; org_id:string; client_id:string; title:string; due_date:string;
  amount:number|null; status:string; recurring:boolean; series_id:string|null;
  due_day:number|null; document_url:string|null; reminder_offsets:number[]|null; clients:Client|null;
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
  const next=new Date(Date.UTC(year,month,1));
  const y=next.getUTCFullYear(),m=next.getUTCMonth()+1;
  const last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return String(y)+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
}
function formatDate(date:string){
  const [y,m,d]=date.split('-');
  return d+'/'+m+'/'+y;
}
function formatBRL(n:number|null){
  return n==null?'não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
}
async function sendDocument(phone:string,values:string[],bytes:Uint8Array,filename:string) {
  const token=Deno.env.get('WHATSAPP_TOKEN');
  const phoneId=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const template=Deno.env.get('WHATSAPP_TEMPLATE_NAME')||'cobranca_honorarios_pdf';
  const lang=Deno.env.get('WHATSAPP_TEMPLATE_LANG')||'pt_BR';
  const version=Deno.env.get('WHATSAPP_GRAPH_VERSION')||'v23.0';
  if(!token||!phoneId)throw new Error('WhatsApp não configurado');
  // Faz upload privado do PDF para a Cloud API; não expõe links fiscais públicos.
  const form=new FormData();
  form.append('messaging_product','whatsapp');
  form.append('type','application/pdf');
  form.append('file',new File([new Uint8Array(bytes)],filename,{type:'application/pdf'}));
  const upload=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/media',{
    method:'POST',headers:{Authorization:'Bearer '+token},body:form
  });
  const uploaded=await upload.json();
  if(!upload.ok||!uploaded?.id)throw new Error('Falha no upload da mídia: HTTP '+upload.status);
  const response=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({
      messaging_product:'whatsapp',to:phone,type:'template',
      template:{name:template,language:{code:lang},components:[
        {type:'header',parameters:[{type:'document',document:{id:uploaded.id,filename}}]},
        {type:'body',parameters:values.map(text=>({type:'text',text}))}
      ]}
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
  // A simulação autenticada permite conferir quais cobranças seriam enviadas
  // sem contato com a Meta, gravação de logs ou geração de novas competências.
  let dryRun=false;
  try { dryRun=(await req.json())?.dry_run===true; } catch { /* sem corpo = execução normal */ }
  const token=Deno.env.get('WHATSAPP_TOKEN');
  const phoneId=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if(!dryRun&&(!token||!phoneId||!Deno.env.get('WHATSAPP_TEMPLATE_NAME')))
    return fail('Configure os segredos do WhatsApp e um template de utilidade aprovado',503);

  const stats={dryRun,organizations:0,generated:0,wouldSend:0,sent:0,failed:0,skipped:0};
  const {data:orgs,error:orgError}=await db.from('organizations')
    .select('id,name,timezone,tax_id,pix_key,billing_contact,access_status').limit(200);
  if(orgError)return fail(orgError.message);

  for(const org of (orgs||[]) as Org[]) {
    if(org.access_status!=='active'){stats.skipped++;continue;}
    let local;
    try{local=localParts(new Date(),org.timezone);}
    catch{stats.skipped++;continue;}
    // Agendamento: uma vez por dia, entre 9h e 10h da manhã de cada escritório.
    if(local.hour!==9&&!dryRun)continue;
    stats.organizations++;

    // Gera a competência do mês corrente em séries recorrentes (idempotente).
    const {data:cycles,error:cyclesError}=await db.from('obligations')
      .select('id,org_id,client_id,title,amount,due_date,document_url,recurring,series_id,due_day,reminder_offsets')
      .eq('org_id',org.id).eq('recurring',true).order('due_date',{ascending:false}).limit(1000);
    if(cyclesError){stats.failed++;continue;}
    const latest=new Map<string, NonNullable<typeof cycles>[number]>();
    for(const item of cycles||[]){
      if(item.series_id && !latest.has(item.series_id))latest.set(item.series_id,item);
    }
    for(const item of latest.values()){
      if(dryRun)break;
      if(item.due_date.slice(0,7)>local.date.slice(0,7))continue;
      const newDue=nextMonthDue(local.date,item.due_day||20);
      const {error:e}=await db.from('obligations').insert({
        org_id:org.id,client_id:item.client_id,title:item.title,amount:item.amount,
        due_date:newDue,status:'pending',recurring:true,series_id:item.series_id,
        due_day:item.due_day,reminder_offsets:item.reminder_offsets||[7,3,1,0],
        document_url:null // Documentos de outras competências não devem ser reaproveitados.
      });
      if(!e)stats.generated++;
      else if(e.code!=='23505')stats.failed++;
    }

    // Lê somente obrigações ainda não pagas, com vencimento na janela permitida.
    const minDate=new Date(local.date+'T00:00:00Z');minDate.setUTCDate(minDate.getUTCDate()-7);
    const maxDate=new Date(local.date+'T00:00:00Z');maxDate.setUTCDate(maxDate.getUTCDate()+30);
    const {data:due,error:dueError}=await db.from('obligations')
      .select('id,org_id,client_id,title,amount,due_date,status,recurring,series_id,due_day,document_url,reminder_offsets,clients!inner(id,name,company,tax_id,phone,active,opt_in,opt_in_at)')
      .eq('org_id',org.id).eq('status','pending')
      .gte('due_date',minDate.toISOString().slice(0,10))
      .lte('due_date',maxDate.toISOString().slice(0,10)).limit(1000);
    if(dueError){stats.failed++;continue;}

    for(const record of due||[]){
      const item=record as unknown as Obligation;
      const client=item.clients;
      if(!client?.active||!client.opt_in||!client.opt_in_at||item.amount===null){stats.skipped++;continue;}
      const offset=dayDiff(item.due_date,local.date);
      if(!(item.reminder_offsets||[7,3,1,0]).includes(offset))continue;
      if(dryRun) {
        const {data:existing,error:checkError}=await db.from('reminder_logs')
          .select('id').eq('org_id',org.id).eq('obligation_id',item.id)
          .eq('due_date',item.due_date).eq('offset_days',offset).maybeSingle();
        if(checkError){stats.failed++;continue;}
        if(existing)stats.skipped++;
        else stats.wouldSend++;
        continue;
      }

      // Unique constraint registra a tentativa ANTES de enviar, impedindo duplicidade.
      const {data:log,error:logError}=await db.from('reminder_logs').insert({
        org_id:org.id,obligation_id:item.id,due_date:item.due_date,
        offset_days:offset,status:'processing'
      }).select('id').single();
      if(logError){stats.skipped++;continue;}
      try{
        // PDF é uma cobrança, nunca uma declaração de pagamento recebido.
        const pdf=await createChargePdf({
          officeName:org.name,officeTaxId:org.tax_id,pixKey:org.pix_key,
          billingContact:org.billing_contact,clientName:client.name,
          company:(client as Client&{company?:string}).company||'',
          clientTaxId:(client as Client&{tax_id?:string}).tax_id||'',
          service:item.title,amount:Number(item.amount),dueDate:item.due_date
        });
        const path=org.id+'/'+item.id+'.pdf';
        const {error:uploadError}=await db.storage.from('billing-documents').upload(path,pdf,{
          contentType:'application/pdf',cacheControl:'0',upsert:true
        });
        if(uploadError)throw uploadError;
        const {error:documentError}=await db.from('billing_documents').upsert({
          org_id:org.id,obligation_id:item.id,storage_path:path,
          generated_at:new Date().toISOString()
        },{onConflict:'obligation_id'});
        if(documentError)throw documentError;
        const messageId=await sendDocument(client.phone,[
          client.name.split(' ')[0],item.title,formatDate(item.due_date),formatBRL(item.amount)
        ],pdf,'cobranca-'+item.due_date+'.pdf');
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
