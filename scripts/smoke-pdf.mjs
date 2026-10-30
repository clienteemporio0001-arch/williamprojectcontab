import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { makeDemoChargePdf, referenceMonth } from '../src/lib/demo-pdf.ts';

// Geração real do arquivo com nomes, valores e vencimentos fictícios.
const pdf = await makeDemoChargePdf({
  officeName: 'Escritorio de Teste', officeTaxId:'00.000.000/0001-00',
  pixKey:'pix@exemplo.com',billingContact:'contato@exemplo.com',
  clientName:'Cliente de Teste',company:'Empresa Exemplo Ltda.',
  clientTaxId:'00.000.000/0001-11',service:'Honorarios contabeis',
  amount:450.00,dueDate:'2026-11-20'
});
assert.ok(pdf.length > 1000, 'O PDF deve conter conteudo real');
const parsed = await PDFDocument.load(pdf);
assert.equal(parsed.getPageCount(),1,'A cobranca deve ter uma pagina');
assert.ok(String.fromCharCode(...pdf.slice(0,5)).startsWith('%PDF-'),'Arquivo precisa ser PDF');
console.log('OK: PDF de cobranca gerado e validado (uma pagina).');

assert.equal(referenceMonth('2026-11-06'),'Outubro/2026','Mês anterior ao vencimento');
assert.equal(referenceMonth('2027-01-06'),'Dezembro/2026','Virada de ano');
