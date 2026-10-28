// Meta Embedded Signup: provisionamento isolado de WhatsApp por escritório.
// Segurança: apenas owner autenticado; token Meta trocado no servidor e criptografado.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const originAllow=new Set(['https://clienteemporio0001-arch.github.io','http://localhost:5173','http://localhost:3000']);
function headers(req:Request){
  const origin=req.headers.get('origin')||'';
  return {'Content-Type':'application/json','Vary':'Origin',
    ...(originAllow.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS'};
}
function respond(req:Request,data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:headers(req)});
}
async function graph(path:string,token:string,version:string,method='GET'){
  const resp=await fetch('https://graph.facebook.com/'+version+'/'+path,{
    method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}
  });
  const json=await resp.json().catch(()=>({}));
  if(!resp.ok)throw Error('Meta HTTP '+resp.status+': '+(json?.error?.message||'Requisição recusada'));
  return json;
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
  if(req.method!=='POST')return respond(req,{error:'Método inválido'},405);
  const authHeader=req.headers.get('Authorization')||'';
  if(!authHeader.startsWith('Bearer '))return respond(req,{error:'Faça login no ContabFlow'},401);
  const supaUrl=Deno.env.get('SUPABASE_URL'),roleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!supaUrl||!roleKey)return respond(req,{error:'Supabase não configurado'},503);
  const db=createClient(supaUrl,roleKey,{auth:{persistSession:false}});
  const {data:userData,error:userError}=await db.auth.getUser(authHeader.slice(7));
  if(userError||!userData.user)return respond(req,{error:'Sessão expirada'},401);
  let body:Record<string,unknown>;
  try{body=await req.json();}catch{return respond(req,{error:'JSON inválido'},400);}
  const orgId=String(body.org_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orgId))return respond(req,{error:'Escritório inválido'},400);
  const {data:member,error:memberError}=await db.from('organization_members')
    .select('role').eq('org_id',orgId).eq('user_id',userData.user.id).maybeSingle();
  if(memberError||member?.role!=='owner')return respond(req,{error:'Somente o responsável pelo escritório pode conectar o WhatsApp'},403);
  const action=String(body.action||'status');
  if(action==='status'){
    const {data:conn,error:connError}=await db.from('whatsapp_integrations')
      .select('display_phone_number,verified_name,connection_status,last_error,connected_at,updated_at')
      .eq('org_id',orgId).maybeSingle();
    if(connError)return respond(req,{error:'Instale a migração WhatsApp por escritório antes de conectar'},503);
    return respond(req,{connection:conn||null});
  }
  if(action==='disconnect'){
    const {error:e}=await db.from('whatsapp_integrations').delete().eq('org_id',orgId);
    if(e)return respond(req,{error:'Não foi possível desconectar'},500);
    await db.from('organizations').update({whatsapp_reminders_enabled:false}).eq('id',orgId);
    return respond(req,{ok:true,disconnected:true});
  }
  if(action!=='connect')return respond(req,{error:'Ação inválida'},400);
  const code=String(body.code||''),wabaId=String(body.waba_id||''),phoneId=String(body.phone_number_id||'');
  if(!/^[a-zA-Z0-9_-]{10,1500}$/.test(code) || !/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneId)){
    return respond(req,{error:'Conclusão incompleta na Meta. Confira o número e tente conectar novamente.'},400);
  }
  const appId=Deno.env.get('META_APP_ID'),appSecret=Deno.env.get('META_APP_SECRET');
  const encryptionKey=Deno.env.get('WHATSAPP_CREDENTIAL_KEY');
  const version=Deno.env.get('WHATSAPP_GRAPH_VERSION')||'v26.0';
  if(!appId||!appSecret||!encryptionKey||encryptionKey.length<32){
    return respond(req,{error:'Conexão indisponível. Admin Master: configure META_APP_ID, META_APP_SECRET e WHATSAPP_CREDENTIAL_KEY no servidor.'},503);
  }
  try{
    // O token é emitido pela Meta e nunca passa para o browser ou banco em texto aberto.
    const url='oauth/access_token?'+new URLSearchParams({
      client_id:appId,client_secret:appSecret,code
    });
    const response=await fetch('https://graph.facebook.com/'+version+'/'+url);
    const exchanged=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(exchanged?.error?.message||'Falha na troca do código Meta');
    const accessToken=String(exchanged?.access_token||'');
    if(accessToken.length<30)throw Error('A Meta não retornou um token de integração válido.');
    const phoneList=await graph(wabaId+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100',accessToken,version);
    const phone=(phoneList?.data||[]).find((p:{id:string})=>String(p.id)===phoneId);
    if(!phone)throw Error('Esse número não pertence à conta WhatsApp autorizada nesta conexão.');
    const {data:previous}=await db.from('whatsapp_integrations')
      .select('org_id').eq('phone_number_id',phoneId).neq('org_id',orgId).maybeSingle();
    if(previous)throw Error('Este número já está conectado a outro escritório no ContabFlow.');
    let subscribed=false,reason='';
    try{
      const subscription=await graph(wabaId+'/subscribed_apps',accessToken,version,'POST');
      subscribed=subscription?.success===true;
      if(!subscribed)reason='Meta não confirmou assinatura dos webhooks.';
    }catch(e){reason=String(e instanceof Error?e.message:e).slice(0,250);}
    const {error:storeError}=await db.rpc('whatsapp_integration_store',{
      p_org_id:orgId,p_waba_id:wabaId,p_phone_number_id:phoneId,
      p_display_phone_number:String(phone.display_phone_number||''),
      p_verified_name:String(phone.verified_name||''),
      p_access_token:accessToken,p_crypto_key:encryptionKey,
      p_status:subscribed?'connected':'pending',p_error:reason||null
    });
    if(storeError)throw Error('Falha ao armazenar a conexão. Verifique a migração WhatsApp.');
    return respond(req,{ok:true,status:subscribed?'connected':'pending',
      connection:{display_phone_number:String(phone.display_phone_number||''),
        verified_name:String(phone.verified_name||''),connection_status:subscribed?'connected':'pending',
        last_error:reason||null}});
  }catch(e){
    // Nunca incluir code, bearer token ou app secret nos erros.
    const msg=String(e instanceof Error?e.message:e);
    return respond(req,{error:msg.slice(0,350)},400);
  }
});
