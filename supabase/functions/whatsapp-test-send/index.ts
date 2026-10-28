// Botão de teste: envio manual de UM template hello_world pela conta conectada do escritório.
// Sem disparos em massa, sem bypass de consentimento, sem publicar credenciais no navegador.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins=new Set([
  'https://clienteemporio0001-arch.github.io',
  'http://localhost:5173',
  'http://localhost:3000'
]);
function headers(req:Request){
  const origin=req.headers.get('origin')||'';
  return {
    'Content-Type':'application/json','Vary':'Origin',
    ...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS'
  };
}
function reply(req:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:headers(req)});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
  if(req.method!=='POST')return reply(req,{error:'Método não permitido'},405);
  const authorization=req.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer '))return reply(req,{error:'Entre na sua conta antes de testar.'},401);
  const supaUrl=Deno.env.get('SUPABASE_URL')||'';
  const roleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const encryptionKey=Deno.env.get('WHATSAPP_CREDENTIAL_KEY')||'';
  if(!supaUrl||!roleKey||encryptionKey.length<32)
    return reply(req,{error:'Configuração de teste indisponível no servidor.'},503);
  const db=createClient(supaUrl,roleKey,{auth:{persistSession:false}});
  const {data:auth,error:authError}=await db.auth.getUser(authorization.slice(7));
  if(authError||!auth.user)return reply(req,{error:'Sua sessão expirou. Faça login novamente.'},401);

  let input:Record<string,unknown>={};
  try{input=await req.json();}catch{return reply(req,{error:'Preencha os dados do teste.'},400);}
  const orgId=String(input.org_id||'');
  let phone=String(input.phone||'').replace(/\D/g,'');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orgId))return reply(req,{error:'Escritório inválido.'},400);
  if(phone.length===10||phone.length===11)phone='55'+phone;
  if(!/^55\d{10,11}$/.test(phone))
    return reply(req,{error:'Informe DDD + número brasileiro válido, como (68) 99999-9999.'},400);
  if(input.consent_confirmed!==true)
    return reply(req,{error:'Confirme que o destinatário autorizou o recebimento do teste.'},400);

  const {data:member,error:memberError}=await db.from('organization_members')
    .select('role').eq('org_id',orgId).eq('user_id',auth.user.id).maybeSingle();
  if(memberError)return reply(req,{error:'Não foi possível validar seu escritório.'},503);
  if(member?.role!=='owner')return reply(req,{error:'Somente o responsável pelo escritório pode enviar testes.'},403);

  // O número deve constar como destinatário ativo com autorização registrada neste escritório.
  const {data:recipients,error:clientError}=await db.from('clients')
    .select('id,consent_source').eq('org_id',orgId).eq('phone',phone)
    .eq('active',true).eq('opt_in',true).not('opt_in_at','is',null).limit(1);
  if(clientError)return reply(req,{error:'Não foi possível validar a autorização do destinatário.'},503);
  if(!recipients?.length||!String(recipients[0].consent_source||'').trim())
    return reply(req,{error:'Cadastre primeiro este número na aba Clientes, com autorização real de WhatsApp e origem do consentimento. Em número de teste da Meta, ele também precisa estar verificado como destinatário.'},403);

  const {data:conn,error:connError}=await db.from('whatsapp_integrations')
    .select('phone_number_id,connection_status').eq('org_id',orgId).maybeSingle();
  if(connError||conn?.connection_status!=='connected'||!/^\d{5,30}$/.test(String(conn?.phone_number_id||'')))
    return reply(req,{error:'Conecte primeiro o WhatsApp Business deste escritório.'},409);

  const dayStart=new Date();
  dayStart.setUTCHours(0,0,0,0);
  const {count,error:countError}=await db.from('whatsapp_test_attempts')
    .select('id',{count:'exact',head:true}).eq('org_id',orgId)
    .gte('requested_at',dayStart.toISOString());
  if(countError)return reply(req,{error:'Não foi possível validar o limite de testes.'},503);
  if((count||0)>=3)return reply(req,{error:'Limite de 3 testes por escritório atingido hoje (UTC).'},429);

  // Inserção antes de falar com a Meta e UNIQUE por janela de 5 minutos:
  // evita cliques duplicados e envios repetidos em concorrência.
  const {data:attempt,error:attemptError}=await db.from('whatsapp_test_attempts')
    .insert({org_id:orgId,requested_by:auth.user.id,recipient_last4:phone.slice(-4),status:'processing'})
    .select('id').single();
  if(attemptError){
    if(attemptError.code==='23505')
      return reply(req,{error:'Aguarde 5 minutos entre dois disparos de teste.'},429);
    return reply(req,{error:'Não foi possível registrar o teste com segurança.'},503);
  }
  const saveStatus=async(status:'accepted'|'failed',code:string|null=null,providerId:string|null=null)=>{
    await db.from('whatsapp_test_attempts')
      .update({status,error_code:code,provider_message_id:providerId}).eq('id',attempt.id).eq('org_id',orgId);
  };
  try{
    const {data:token,error:tokenError}=await db.rpc('whatsapp_integration_token',{
      p_org_id:orgId,p_crypto_key:encryptionKey
    });
    if(tokenError||typeof token!=='string'||token.length<30){
      await saveStatus('failed','credential_error');
      return reply(req,{error:'Não foi possível recuperar a autorização de envio. A conexão pode precisar ser renovada.'},503);
    }
    const version=Deno.env.get('WHATSAPP_GRAPH_VERSION')||'v26.0';
    const result=await fetch('https://graph.facebook.com/'+version+'/'+conn.phone_number_id+'/messages',{
      method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        messaging_product:'whatsapp',to:phone,type:'template',
        template:{name:'hello_world',language:{code:'en_US'}}
      })
    });
    const json=await result.json().catch(()=>({}));
    if(!result.ok||!json?.messages?.[0]?.id){
      const code=String(json?.error?.code||result.status).slice(0,30);
      await saveStatus('failed',code);
      if(code==='131030')return reply(req,{error:'A Meta só permite números verificados como destinatários do número de teste. Adicione e confirme o celular em Meta > WhatsApp > Etapa 1: Experimente.'},400);
      if(code==='132001')return reply(req,{error:'O modelo hello_world (en_US) não está disponível nessa conta WhatsApp. Verifique os modelos aprovados na Meta.'},400);
      if(code==='190')return reply(req,{error:'O token da conexão expirou ou foi revogado. Reconecte o WhatsApp Business no ContabFlow.'},400);
      return reply(req,{error:'A Meta rejeitou o envio de teste (código '+code+'). Confira os destinatários e as permissões da conta.'},400);
    }
    const messageId=String(json.messages[0].id);
    await saveStatus('accepted',null,messageId);
    return reply(req,{ok:true,accepted:true,message:'A Meta aceitou a mensagem de teste. Confira a entrega no WhatsApp do destinatário.'});
  }catch{
    await saveStatus('failed','network_error');
    return reply(req,{error:'Não foi possível concluir a chamada à Meta. Confira a conexão e tente novamente mais tarde.'},502);
  }
});
