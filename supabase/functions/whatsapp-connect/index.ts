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
// Diagnóstico restrito ao proprietário autenticado: nunca retorna valores secretos.
function missingCredentialNames():string[]{
  const missing:string[]=[];
  if(!Deno.env.get('META_APP_ID')?.trim())missing.push('META_APP_ID');
  if(!Deno.env.get('META_APP_SECRET')?.trim())missing.push('META_APP_SECRET');
  const key=Deno.env.get('WHATSAPP_CREDENTIAL_KEY');
  if(!key||key.length<32)missing.push('WHATSAPP_CREDENTIAL_KEY (mínimo 32 caracteres)');
  return missing;
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
  if(memberError){
    // Erro de consulta não equivale a falta de permissão. Não mostrar SQL ao cliente.
    console.error('Erro ao consultar vínculo do escritório',memberError.code||'unknown');
    return respond(req,{error:'Não foi possível consultar as permissões do escritório. Verifique os logs da função no Supabase.'},503);
  }
  if(!member)return respond(req,{error:'Este login não está vinculado ao escritório selecionado. Entre com a conta do responsável pelo escritório.'},403);
  if(member.role!=='owner')return respond(req,{error:'Somente o responsável pelo escritório pode conectar o WhatsApp.'},403);
  const action=String(body.action||'status');
  if(action==='status'){
    const {data:conn,error:connError}=await db.from('whatsapp_integrations')
      .select('display_phone_number,verified_name,connection_status,last_error,connected_at,updated_at')
      .eq('org_id',orgId).maybeSingle();
    if(connError)return respond(req,{error:'Instale a migração WhatsApp por escritório antes de conectar'},503);
    const missing=missingCredentialNames();
    return respond(req,{connection:conn||null,configuration:{ready:missing.length===0,missing}});
  }
  if(action==='disconnect'){
    const {error:e}=await db.from('whatsapp_integrations').delete().eq('org_id',orgId);
    if(e)return respond(req,{error:'Não foi possível desconectar'},500);
    await db.from('organizations').update({whatsapp_reminders_enabled:false}).eq('id',orgId);
    return respond(req,{ok:true,disconnected:true});
  }
  if(action!=='connect')return respond(req,{error:'Ação inválida'},400);
  const code=String(body.code||''),wabaId=String(body.waba_id||''),phoneId=String(body.phone_number_id||'');
  if(!/^[a-zA-Z0-9_-]{10,1500}$/.test(code) || (wabaId!==''&&!/^\d{5,30}$/.test(wabaId)) || (phoneId!==''&&!/^\d{5,30}$/.test(phoneId)) || (phoneId!==''&&!wabaId)){
    return respond(req,{error:'Conclusão incompleta na Meta. Confira o número e tente conectar novamente.'},400);
  }
  const appId=Deno.env.get('META_APP_ID')||'',appSecret=Deno.env.get('META_APP_SECRET')||'';
  const encryptionKey=Deno.env.get('WHATSAPP_CREDENTIAL_KEY')||'';
  const version=Deno.env.get('WHATSAPP_GRAPH_VERSION')||'v26.0';
  const missing=missingCredentialNames();
  if(missing.length>0){
    return respond(req,{error:'Credenciais pendentes no Supabase: '+missing.join(', ')+'. Entre em Edge Functions > Secrets para corrigir.'},503);
  }
  try{
    // O token é emitido pela Meta e nunca passa para o browser ou banco em texto aberto.
    const url='oauth/access_token?'+new URLSearchParams({
      client_id:appId,client_secret:appSecret,code,redirect_uri:''
    });
    const response=await fetch('https://graph.facebook.com/'+version+'/'+url);
    const exchanged=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(exchanged?.error?.message||'Falha na troca do código Meta');
    const accessToken=String(exchanged?.access_token||'');
    if(accessToken.length<30)throw Error('A Meta não retornou um token de integração válido.');
    // O Login Embedded Signup envia o código e o evento FINISH separadamente.
    // Se o evento FINISH não chegar, consultar somente os WABAs explicitamente
    // autorizados no token da própria Meta. Nunca inferir contas de terceiros.
    let selectedWabaId=wabaId;
    if(!selectedWabaId){
      const audit=await graph('debug_token?'+new URLSearchParams({
        input_token:accessToken
      }),appId+'|'+appSecret,version);
      const grant=audit?.data as {
        is_valid?:boolean;app_id?:string|number;
        granular_scopes?:Array<{scope?:string;target_ids?:string[]}>;
      }|undefined;
      if(!grant?.is_valid||String(grant.app_id)!==appId){
        throw Error('A Meta retornou uma autorização que não pertence ao aplicativo ContabFlow.');
      }
      const ids=new Set<string>();
      for(const entry of grant.granular_scopes||[]){
        if(!['whatsapp_business_management','whatsapp_business_messaging'].includes(String(entry.scope)))continue;
        for(const candidate of entry.target_ids||[]){
          if(/^\d{5,30}$/.test(String(candidate)))ids.add(String(candidate));
        }
      }
      if(ids.size!==1){
        throw Error(ids.size===0?
          'A Meta autorizou somente o Facebook, sem conceder acesso a uma conta WhatsApp. No login, use Editar configurações e conclua a seleção do WhatsApp Business.':
          'A Meta autorizou mais de uma conta WhatsApp. Selecione um único número em Editar configurações antes de conectar.');
      }
      selectedWabaId=[...ids][0];
    }
    const phoneList=await graph(selectedWabaId+'/phone_numbers?fields=id,display_phone_number,verified_name&limit=100',accessToken,version);
    const phones=(phoneList?.data||[]) as Array<{id:string;display_phone_number?:string;verified_name?:string}>;
    // Coexistência pode retornar somente waba_id, sem phone_number_id.
    // Escolher automaticamente apenas se houver um único número autorizado.
    const phone=phoneId?phones.find(p=>String(p.id)===phoneId):phones.length===1?phones[0]:null;
    if(!phone)throw Error(phoneId?
      'O número selecionado não pertence à conta WhatsApp autorizada.':
      'A conta WhatsApp autorizada não possui um número único disponível. Confirme o número na Meta e tente novamente.');
    const selectedPhoneId=String(phone.id);
    const {data:previous}=await db.from('whatsapp_integrations')
      .select('org_id').eq('phone_number_id',selectedPhoneId).neq('org_id',orgId).maybeSingle();
    if(previous)throw Error('Este número já está conectado a outro escritório no ContabFlow.');
    let subscribed=false,reason='';
    try{
      const subscription=await graph(selectedWabaId+'/subscribed_apps',accessToken,version,'POST');
      subscribed=subscription?.success===true;
      if(!subscribed)reason='Meta não confirmou assinatura dos webhooks.';
    }catch(e){reason=String(e instanceof Error?e.message:e).slice(0,250);}
    const {error:storeError}=await db.rpc('whatsapp_integration_store',{
      p_org_id:orgId,p_waba_id:selectedWabaId,p_phone_number_id:selectedPhoneId,
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
