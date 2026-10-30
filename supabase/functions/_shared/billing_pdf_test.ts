import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { createChargePdf,referenceMonth } from './billing_pdf.ts';

Deno.test('gera PDF de cobrança de honorários antes do pagamento',async()=>{
  const bytes=await createChargePdf({
    officeName:'Escritorio Teste',officeTaxId:'00.000.000/0001-00',pixKey:'pix@exemplo.com',
    clientName:'Maria da Silva',company:'Empresa Exemplo',clientTaxId:'00.000.000/0001-11',
    service:'Honorarios contabeis',amount:450,dueDate:'2026-11-20'
  });
  if(bytes.length<1000)throw new Error('PDF inesperadamente vazio');
  const pdf=await PDFDocument.load(bytes);
  if(pdf.getPageCount()!==1)throw new Error('A cobrança deve ter uma página');
});
Deno.test('não permite valor negativo',async()=>{
  let rejected=false;
  try{await createChargePdf({officeName:'Teste',clientName:'Cliente',service:'Honorarios',amount:-1,dueDate:'2026-11-20'});}
  catch{rejected=true;}
  if(!rejected)throw new Error('Cobrança com valor negativo foi aceita');
});

Deno.test('mês de referência é sempre o anterior ao vencimento, inclusive na virada de ano',()=>{
  if(referenceMonth('2026-11-06')!=='Outubro/2026')throw new Error('Referência de novembro incorreta');
  if(referenceMonth('2027-01-06')!=='Dezembro/2026')throw new Error('Referência de janeiro incorreta');
  if(referenceMonth('2026-03-31')!=='Fevereiro/2026')throw new Error('Referência de março incorreta');
});
