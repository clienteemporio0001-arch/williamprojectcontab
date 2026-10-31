// Exclusão definitiva de registros do escritório, autenticada e explícita.
// Storage é limpo pela API oficial; registros relacionais são apagados em uma transação RPC.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Content-Type':'application/json'
};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{...cors,'Cache-Control':'no-store'}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATHS_PER_BATCH=500;

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'Método inválido'},405);
  const bearer=req.headers.get('authorization')||'';
  if(!bearer.startsWith('Bearer '))return reply({error:'Faça login no ContabFlow'},401);
  const url=Deno.env.get('SUPABASE_URL');
  const anon=Deno.env.get('SUPABASE_ANON_KEY');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service)return reply({error:'Serviço de exclusão indisponível'},503);

  let body:{org_id?:string;record_id?:string;kind?:string;confirmation?:string};
  try{body=await req.json();}catch{return reply({error:'Requisição inválida'},400);}
  const orgId=String(body?.org_id||'');
  const recordId=String(body?.record_id||'');
  const kind=String(body?.kind||'');
  if(!uuid.test(orgId)||!uuid.test(recordId)||!['client','obligation'].includes(kind))
    return reply({error:'Identificação inválida'},400);
  if(body?.confirmation!=='EXCLUIR')
    return reply({error:'Confirmação explícita obrigatória'},400);

  const userDB=createClient(url,anon,{
    global:{headers:{Authorization:bearer}},auth:{persistSession:false}
  });
  const token=bearer.slice(7);
  const {data:{user},error:authError}=await userDB.auth.getUser(token);
  if(authError||!user)return reply({error:'Sessão expirada'},401);

  // A verificação de existência usa as políticas RLS do usuário, não o service_role.
  const table=kind==='client'?'clients':'obligations';
  const {data:target,error:targetError}=await userDB.from(table)
    .select('id,org_id').eq('id',recordId).eq('org_id',orgId).maybeSingle();
  if(targetError||!target)return reply({error:'Registro não encontrado ou sem acesso a este escritório'},404);

  // Descobrir apenas os IDs da cobrança afetada, com paginação se necessário.
  const chargeIds:string[]=[];
  if(kind==='obligation')chargeIds.push(recordId);
  else{
    for(let offset=0;offset<100000;offset+=MAX_PATHS_PER_BATCH){
      const {data,error}=await userDB.from('obligations').select('id')
        .eq('org_id',orgId).eq('client_id',recordId)
        .order('id',{ascending:true}).range(offset,offset+MAX_PATHS_PER_BATCH-1);
      if(error)return reply({error:'Não foi possível conferir as cobranças vinculadas. Nada foi excluído.'},503);
      for(const charge of data||[])chargeIds.push(String(charge.id));
      if((data||[]).length<MAX_PATHS_PER_BATCH)break;
      if(offset+MAX_PATHS_PER_BATCH>=100000)
        return reply({error:'O cliente tem muitas cobranças para exclusão automática. Contate o suporte.'},409);
    }
  }

  const admin=createClient(url,service,{auth:{persistSession:false}});
  const paths=new Set<string>();
  for(const id of chargeIds)paths.add(orgId+'/'+id+'.pdf');

  // Usar apenas caminhos previamente registrados e pertencentes ao escritório.
  for(let offset=0;offset<chargeIds.length;offset+=MAX_PATHS_PER_BATCH){
    const ids=chargeIds.slice(offset,offset+MAX_PATHS_PER_BATCH);
    const {data,error}=await userDB.from('billing_documents')
      .select('obligation_id,storage_path').eq('org_id',orgId).in('obligation_id',ids);
    if(error)return reply({error:'Não foi possível validar os PDFs privados. Nada foi excluído.'},503);
    for(const record of data||[]){
      const expected=orgId+'/'+String(record.obligation_id)+'.pdf';
      if(record.storage_path!==expected)
        return reply({error:'Há um PDF com caminho não padrão. Exclusão bloqueada para conferência.'},409);
    }
  }

  // Sempre pela Storage API. Uma falha impede o apagamento dos dados no banco.
  const allPaths=[...paths];
  for(let i=0;i<allPaths.length;i+=MAX_PATHS_PER_BATCH){
    const {error}=await admin.storage.from('billing-documents')
      .remove(allPaths.slice(i,i+MAX_PATHS_PER_BATCH));
    if(error){
      console.error('Storage remove failed',error.statusCode||error.message);
      return reply({error:'Falha na limpeza dos PDFs. O cadastro não foi excluído; tente novamente.'},503);
    }
  }

  // A transação remove cobranças, documentos, logs e o cliente, se aplicável.
  // RPC só pode ser executada por service_role e valida o vínculo do usuário.
  const {data:result,error:deleteError}=await admin.rpc('purge_office_record',{
    p_org_id:orgId,p_record_id:recordId,p_kind:kind,p_actor_id:user.id
  });
  if(deleteError||result?.deleted!==true){
    console.error('purge_office_record failed',deleteError?.code||'no_result');
    return reply({error:'Os PDFs foram limpos, mas a exclusão dos registros não foi confirmada. Tente novamente ou contate o suporte.'},503);
  }
  return reply({ok:true,kind,record_id:recordId,
    charges_deleted:Number(result.charges_deleted||0),deleted:true});
});
