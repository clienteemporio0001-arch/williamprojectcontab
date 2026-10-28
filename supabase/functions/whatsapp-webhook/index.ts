// WhatsApp Cloud API webhook: apenas atualização de status de envio por escritório.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const enc=new TextEncoder();
function reply(body:string,status=200){return new Response(body,{status,headers:{'Content-Type':'text/plain'}});}
async function validate(body:string,signature:string,secret:string){
  if(!/^sha256=[0-9a-f]{64}$/i.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(body)));
  const hex=Array.from(sig).map(b=>b.toString(16).padStart(2,'0')).join('');
  const got=signature.slice(7).toLowerCase();
  if(hex.length!==got.length)return false;
  let diff=0;
  for(let i=0;i<hex.length;i++)diff|=hex.charCodeAt(i)^got.charCodeAt(i);
  return diff===0;
}
Deno.serve(async req=>{
  const verifyToken=Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');
  if(req.method==='GET'){
    const uri=new URL(req.url);
    const mode=uri.searchParams.get('hub.mode');
    const token=uri.searchParams.get('hub.verify_token');
    const challenge=uri.searchParams.get('hub.challenge')||'';
    return (mode==='subscribe'&&verifyToken&&token===verifyToken)
      ?reply(challenge):reply('Forbidden',403);
  }
  if(req.method!=='POST')return reply('Method not allowed',405);
  const secret=Deno.env.get('META_APP_SECRET');
  const raw=await req.text();
  if(!secret||!(await validate(raw,req.headers.get('x-hub-signature-256')||'',secret)))return reply('Invalid signature',401);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply('Service unavailable',503);
  const db=createClient(url,key,{auth:{persistSession:false}});
  let payload:any;
  try{payload=JSON.parse(raw);}catch{return reply('Invalid payload',400);}
  if(payload?.object!=='whatsapp_business_account')return reply('OK',200);
  for(const entry of payload.entry||[]){
    for(const change of entry.changes||[]){
      if(change.field!=='messages')continue;
      const phoneId=String(change.value?.metadata?.phone_number_id||'');
      if(!/^\d{5,30}$/.test(phoneId))continue;
      const {data:conn}=await db.from('whatsapp_integrations')
        .select('org_id').eq('phone_number_id',phoneId).maybeSingle();
      if(!conn?.org_id)continue;
      for(const status of change.value?.statuses||[]){
        const providerId=String(status.id||'');
        const target=String(status.status||'');
        if(!providerId.startsWith('wamid.')||!['sent','delivered','read','failed'].includes(target))continue;
        const {data:log}=await db.from('reminder_logs').select('id,status')
          .eq('org_id',conn.org_id).eq('channel','whatsapp')
          .eq('provider_message_id',providerId).maybeSingle();
        if(!log)continue;
        // Webhooks podem ser entregues fora de ordem; não regredir "read" para "sent".
        const rank:Record<string,number>={processing:0,sent:1,delivered:2,read:3,failed:4};
        if(target!=='failed'&&(rank[log.status]||0)>=(rank[target]||0))continue;
        if(log.status==='read')continue;
        const updates:Record<string,unknown>={status:target};
        if(target==='delivered')updates.delivered_at=new Date().toISOString();
        if(target==='read'){updates.read_at=new Date().toISOString();updates.delivered_at=new Date().toISOString();}
        if(target==='failed'){
          const err=status.errors?.[0];
          updates.error=('Meta '+String(err?.code||'')+': '+String(err?.title||'Falha de envio')).slice(0,300);
        }
        await db.from('reminder_logs').update(updates).eq('id',log.id).eq('org_id',conn.org_id);
      }
      // Mensagens recebidas não são salvas neste endpoint; sem coleta de conversa privada.
    }
  }
  return reply('OK',200);
});