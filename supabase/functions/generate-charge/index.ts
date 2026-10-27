// Authenticated PDF generation. The client sends ONLY obligation_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createChargePdf } from '../_shared/billing_pdf.ts';

Deno.serve(async(req:Request)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method==='OPTIONS')return new Response('',{headers:cors});
  const respond=(message:string,status:number)=>new Response(JSON.stringify({error:message}),{
    status,headers:{...cors,'Content-Type':'application/json'}
  });
  if(req.method!=='POST')return respond('Método inválido',405);
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return respond('É necessário entrar na plataforma',401);
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service)return respond('Serviço ainda não configurado',503);
  let obligation_id:string;
  try{({obligation_id}=await req.json());}catch{return respond('Corpo inválido',400);}
  if(!/^[0-9a-f-]{36}$/i.test(obligation_id||''))return respond('Obrigação inválida',400);

  const userDB=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await userDB.auth.getUser(token);
  if(authError||!user)return respond('Sessão inválida',401);
  // Consulta passa por RLS: um escritório não consegue ver a cobrança de outro.
  const {data:obligation,error:fetchError}=await userDB.from('obligations')
    .select('id,org_id,title,amount,due_date,status,clients!inner(name,company,tax_id),organizations!inner(name,tax_id,pix_key,billing_contact)')
    .eq('id',obligation_id).single();
  if(fetchError||!obligation)return respond('Cobrança não encontrada ou sem permissão',404);
  if(obligation.status!=='pending')return respond('Apenas cobranças pendentes podem gerar aviso pré-pagamento',409);
  if(obligation.amount===null||Number(obligation.amount)<0)return respond('Informe o valor dos honorários',422);
  const client=obligation.clients as unknown as {name:string;company:string;tax_id:string|null};
  const office=obligation.organizations as unknown as {name:string;tax_id:string;pix_key:string;billing_contact:string};
  try{
    const bytes=await createChargePdf({
      officeName:office.name,officeTaxId:office.tax_id,pixKey:office.pix_key,billingContact:office.billing_contact,
      clientName:client.name,company:client.company,clientTaxId:client.tax_id||'',
      service:obligation.title,amount:Number(obligation.amount),dueDate:obligation.due_date
    });
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const path=obligation.org_id+'/'+obligation.id+'.pdf';
    const {error:uploadError}=await admin.storage.from('billing-documents').upload(path,bytes,{
      contentType:'application/pdf',upsert:true,cacheControl:'0'
    });
    if(uploadError)throw uploadError;
    const {error:logError}=await admin.from('billing_documents').upsert({
      org_id:obligation.org_id,obligation_id:obligation.id,storage_path:path,
      generated_at:new Date().toISOString()
    },{onConflict:'obligation_id'});
    if(logError)throw logError;
    // Auditoria administrativa: conta PDFs realmente gerados (sem armazenar conteúdo).
    // A geração do documento não deve falhar caso a Etapa 6 ainda não tenha sido instalada.
    const {error:activityError}=await admin.from('saas_activity_events').insert({
      org_id:obligation.org_id, actor_user_id:user.id,entity_id:obligation.id,
      event_type:'pdf_generated'
    });
    if(activityError)console.warn('Registro de atividade PDF indisponível:',activityError.code);
    return new Response(new Uint8Array(bytes),{
      status:200,headers:{...cors,'Content-Type':'application/pdf',
        'Content-Disposition':'attachment; filename="cobranca-'+obligation.due_date+'.pdf"',
        'Cache-Control':'no-store'}
    });
  }catch(error){return respond('Erro ao gerar documento: '+String(error).slice(0,250),500);}
});
