// Authenticated PDF generation. The client sends ONLY obligation_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ensureChargeDocument } from '../_shared/charge_document.ts';

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
  let obligation_id:string,action:string;
  try{
    const body=await req.json();
    obligation_id=String(body?.obligation_id||'');
    action=String(body?.action||'generate');
  }catch{return respond('Corpo inválido',400);}
  if(!/^[0-9a-f-]{36}$/i.test(obligation_id||''))return respond('Obrigação inválida',400);
  if(!['generate','delete'].includes(action))return respond('Ação inválida',400);

  const userDB=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await userDB.auth.getUser(token);
  if(authError||!user)return respond('Sessão inválida',401);
  // Consulta passa por RLS: um escritório não consegue ver a cobrança de outro.
  const {data:obligation,error:fetchError}=await userDB.from('obligations')
    .select('id,org_id,title,amount,due_date,status,clients!inner(name,company,tax_id),organizations!inner(name,tax_id,pix_key,billing_contact,logo_path)')
    .eq('id',obligation_id).single();
  if(fetchError||!obligation)return respond('Cobrança não encontrada ou sem permissão',404);
  if(obligation.status!=='pending')return respond('Somente cobranças pendentes podem alterar o PDF',409);

  if(action==='delete'){
    // Operação excepcional e explícita. Não apagar um aviso com qualquer histórico
    // de tentativa de envio (inclusive processing, failed e status incerto).
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const {count,error:logError}=await admin.from('reminder_logs')
      .select('id',{count:'exact',head:true})
      .eq('org_id',obligation.org_id).eq('obligation_id',obligation.id);
    if(logError)return respond('Não foi possível verificar o histórico. O PDF foi preservado.',503);
    if((count||0)>0)return respond('Esse PDF possui histórico de envio. Não é possível excluí-lo. Crie uma nova cobrança corrigida e cancele a anterior.',409);
    const {data:record,error:docError}=await admin.from('billing_documents')
      .select('storage_path').eq('org_id',obligation.org_id)
      .eq('obligation_id',obligation.id).maybeSingle();
    if(docError)return respond('Não foi possível consultar o PDF. Nada foi excluído.',503);
    if(!record){
      return new Response(JSON.stringify({ok:true,deleted:false}),{status:200,
        headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    const expected=obligation.org_id+'/'+obligation.id+'.pdf';
    if(record.storage_path!==expected)return respond('Documento com caminho inesperado. Exclusão bloqueada para segurança.',409);
    // O bucket é privado. Remover sempre pela API Storage (nunca SQL direto).
    const {error:removeError}=await admin.storage.from('billing-documents').remove([expected]);
    if(removeError)return respond('Falha ao excluir o arquivo do Storage. O registro foi preservado.',503);
    const {data:deleted,error:deleteError}=await admin.from('billing_documents').delete()
      .eq('org_id',obligation.org_id).eq('obligation_id',obligation.id)
      .eq('storage_path',expected).select('id');
    if(deleteError||!deleted?.length)return respond(
      'Arquivo removido, mas não foi possível concluir o registro. Contate o suporte antes de gerar outro PDF.',503);
    return new Response(JSON.stringify({ok:true,deleted:true}),{status:200,
      headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(obligation.amount===null||Number(obligation.amount)<0)return respond('Informe o valor dos honorários',422);
  const client=obligation.clients as unknown as {name:string;company:string;tax_id:string|null};
  const office=obligation.organizations as unknown as {name:string;tax_id:string;pix_key:string;billing_contact:string;logo_path:string|null};
  try{
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const result=await ensureChargeDocument(admin,obligation.org_id,obligation.id,{
      officeName:office.name,officeTaxId:office.tax_id,pixKey:office.pix_key,billingContact:office.billing_contact,logoPath:office.logo_path,
      clientName:client.name,company:client.company,clientTaxId:client.tax_id||'',
      service:obligation.title,amount:Number(obligation.amount),dueDate:obligation.due_date
    });
    const bytes=result.bytes;
    // PDF previamente emitido é baixado, não recriado nem cobrado novamente.
    if(result.created){
      const {error:activityError}=await admin.from('saas_activity_events').insert({
        org_id:obligation.org_id,actor_user_id:user.id,entity_id:obligation.id,event_type:'pdf_generated'
      });
      if(activityError)console.warn('Registro da emissão de PDF indisponível:',activityError.code);
    }
    return new Response(new Uint8Array(bytes),{
      status:200,headers:{...cors,'Content-Type':'application/pdf',
        'Content-Disposition':'attachment; filename="cobranca-'+obligation.due_date+'.pdf"',
        'Cache-Control':'no-store'}
    });
  }catch(error){return respond('Erro ao gerar documento: '+String(error).slice(0,250),500);}
});
