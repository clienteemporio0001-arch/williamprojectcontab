// Uma cobrança, um PDF privado, reutilizado em todos os lembretes.
// O caminho é determinístico. Nunca sobrescreva um PDF já emitido.
import {createChargePdf, type ChargeInfo} from './billing_pdf.ts';

type DB=any;
function validPdf(bytes:Uint8Array){
  if(bytes.length<100||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')
    throw new Error('PDF armazenado inválido. Corrija o arquivo antes de enviar cobranças.');
}
async function download(db:DB,path:string):Promise<Uint8Array|null>{
  const {data,error}=await db.storage.from('billing-documents').download(path);
  if(error){
    // Uma ausência é esperada apenas na PRIMEIRA geração do documento.
    const msg=String(error.message||'').toLowerCase();
    if((error.statusCode===404||error.status===404||msg.includes('not found')||msg.includes('not exist')))
      return null;
    throw new Error('Falha ao consultar PDF privado: '+String(error.message||'erro do storage'));
  }
  if(!data)throw new Error('Download do PDF retornou vazio');
  const bytes=new Uint8Array(await data.arrayBuffer());
  validPdf(bytes);
  return bytes;
}
export async function ensureChargeDocument(
  db:DB,orgId:string,obligationId:string,info:ChargeInfo
):Promise<{bytes:Uint8Array;created:boolean;path:string}>{
  if(!/^[0-9a-f-]{36}$/i.test(orgId)||!/^[0-9a-f-]{36}$/i.test(obligationId))
    throw new Error('Identificação de cobrança inválida');
  const canonical=orgId+'/'+obligationId+'.pdf';
  const {data:existing,error:lookupError}=await db.from('billing_documents')
    .select('storage_path').eq('org_id',orgId).eq('obligation_id',obligationId).maybeSingle();
  if(lookupError)throw new Error('Falha ao consultar o registro do PDF: '+lookupError.message);
  if(existing?.storage_path&&existing.storage_path!==canonical)
    throw new Error('O documento registrado tem caminho diferente do esperado. Revise antes de enviar.');
  // Evita uma requisição Storage/404 desnecessária a cada primeira emissão.
  // Se já houver registro, baixar o original. Se um arquivo órfão existir,
  // o upload sem sobrescrita dará conflito e será reutilizado abaixo.
  const stored=existing?await download(db,canonical):null;
  if(stored){
    if(!existing){
      const {error:registerError}=await db.from('billing_documents').upsert({
        org_id:orgId,obligation_id:obligationId,storage_path:canonical
      },{onConflict:'obligation_id'});
      if(registerError)throw new Error('Falha ao registrar PDF já existente: '+registerError.message);
    }
    return {bytes:stored,created:false,path:canonical};
  }
  if(existing)throw new Error('PDF registrado não foi encontrado no Storage. Restaure o arquivo; não recrie um aviso diferente automaticamente.');
  const bytes=await createChargePdf(info);
  validPdf(bytes);
  const {error:uploadError}=await db.storage.from('billing-documents').upload(canonical,bytes,{
    contentType:'application/pdf',cacheControl:'0',upsert:false
  });
  if(uploadError){
    // Concorrência: outra execução pode ter criado o arquivo primeiro.
    const winner=await download(db,canonical);
    if(!winner)throw new Error('Falha ao guardar PDF: '+uploadError.message);
    const {error:recordError}=await db.from('billing_documents').upsert({
      org_id:orgId,obligation_id:obligationId,storage_path:canonical
    },{onConflict:'obligation_id'});
    if(recordError)throw new Error('Falha ao registrar PDF concorrente: '+recordError.message);
    return {bytes:winner,created:false,path:canonical};
  }
  const {error:recordError}=await db.from('billing_documents').upsert({
    org_id:orgId,obligation_id:obligationId,storage_path:canonical,
    generated_at:new Date().toISOString()
  },{onConflict:'obligation_id'});
  if(recordError)throw new Error('PDF salvo, mas registro pendente: '+recordError.message);
  return {bytes,created:true,path:canonical};
}
