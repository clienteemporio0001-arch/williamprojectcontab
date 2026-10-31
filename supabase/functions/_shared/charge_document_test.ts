import {ensureChargeDocument} from './charge_document.ts';

Deno.test('PDF da mesma cobrança é persistido uma vez e reutilizado em prévias e lembretes',async()=>{
  const stored=new Map<string,Uint8Array>();
  const docs=new Map<string,{org_id:string;obligation_id:string;storage_path:string}>();
  let uploads=0,registrations=0;
  const db={
    from(table:string){
      if(table!=='billing_documents')throw Error('Tabela inesperada');
      return {
        select(){return this;},
        eq(){return this;},
        async maybeSingle(){return {data:docs.values().next().value||null,error:null};},
        async upsert(row:{org_id:string;obligation_id:string;storage_path:string}){
          docs.set(row.obligation_id,row);registrations++;return {error:null};
        }
      };
    },
    storage:{from(bucket:string){
      if(bucket!=='billing-documents')throw Error('Bucket inesperado');
      return {
        async download(path:string){
          const bytes=stored.get(path);
          if(!bytes)return {data:null,error:{statusCode:404,message:'Object not found'}};
          return {data:new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),error:null};
        },
        async upload(path:string,bytes:Uint8Array){
          if(stored.has(path))return {error:{message:'Duplicate'}};
          stored.set(path,new Uint8Array(bytes));uploads++;
          return {error:null};
        }
      };
    }}
  };
  const org='11111111-1111-4111-8111-111111111111';
  const charge='22222222-2222-4222-8222-222222222222';
  const base={officeName:'Escritório Teste',clientName:'Cliente Teste',
    service:'Honorários',amount:120,dueDate:'2026-11-10'};
  const first=await ensureChargeDocument(db,org,charge,base);
  const second=await ensureChargeDocument(db,org,charge,{...base,amount:999});
  if(!first.created||second.created)throw Error('PDF reemitido indevidamente');
  if(uploads!==1||registrations!==1||docs.size!==1)throw Error('Duplicidade no armazenamento ou na tabela');
  if(first.bytes.length!==second.bytes.length)throw Error('PDF reutilizado é diferente do original');
  for(let i=0;i<first.bytes.length;i++)if(first.bytes[i]!==second.bytes[i])
    throw Error('PDF previamente emitido foi alterado');
  if(!first.path.startsWith(org+'/'))throw Error('Documento fora do escritório');
});
