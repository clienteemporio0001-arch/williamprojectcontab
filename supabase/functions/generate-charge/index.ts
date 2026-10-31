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
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const result=await ensureChargeDocument(admin,obligation.org_id,obligation.id,{
      officeName:office.name,officeTaxId:office.tax_id,pixKey:office.pix_key,billingContact:office.billing_contact,
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
