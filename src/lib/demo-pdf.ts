import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type Input={officeName:string;officeTaxId:string;pixKey:string;billingContact:string;clientName:string;company:string;clientTaxId:string;service:string;amount:number;dueDate:string};
const safe=(s:string|undefined)=>String(s||'').replace(/[\r\n]/g,' ').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'').slice(0,150);
const date=(s:string)=>s.split('-').reverse().join('/');
export async function makeDemoChargePdf(data:Input):Promise<Uint8Array>{
 const pdf=await PDFDocument.create();const page=pdf.addPage([595,842]);
 const font=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const navy=rgb(.07,.13,.23),muted=rgb(.37,.44,.51),teal=rgb(.05,.56,.46);
 const text=(s:string,x:number,y:number,size=11,strong=false,color=navy)=>{
   const chunks:string[]=[];let line='';
   for(const word of safe(s).split(/\s+/)){const next=line?line+' '+word:word;
     if((strong?bold:font).widthOfTextAtSize(next,size)>490&&line){chunks.push(line);line=word;}else line=next;}
   if(line)chunks.push(line);
   chunks.forEach((chunk,i)=>page.drawText(chunk,{x,y:y-i*18,size,font:strong?bold:font,color}));
   return y-chunks.length*19;
 };
 page.drawRectangle({x:0,y:763,width:595,height:79,color:navy});
 text(data.officeName.toUpperCase(),48,800,17,true,rgb(1,1,1));
 text('COBRANCA DE HONORARIOS CONTABEIS',48,779,10,false,rgb(.68,.93,.84));
 text('AVISO DE COBRANCA',48,722,21,true);
 text('Pagamento pendente - este documento nao e recibo de quitacao.',48,702,10,false,muted);
 page.drawLine({start:{x:48,y:686},end:{x:546,y:686},thickness:1,color:rgb(.85,.89,.92)});
 let y=658;
 y=text('CLIENTE / PAGADOR',48,y,10,true,teal)-9;
 y=text('Nome: '+data.clientName,48,y,12);
 if(data.company)y=text('Empresa: '+data.company,48,y);
 if(data.clientTaxId)y=text('CPF/CNPJ: '+data.clientTaxId,48,y);
 y-=25;y=text('SERVICO',48,y,10,true,teal)-8;
 y=text(data.service,48,y,12);y=text('Competencia: '+data.dueDate.slice(0,7).split('-').reverse().join('/'),48,y);
 y-=27;page.drawRectangle({x:48,y:y-43,width:499,height:88,color:rgb(.94,.98,.97)});
 text('VALOR A PAGAR',66,y+23,10,true,teal);
 text(new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(data.amount),66,y-13,21,true);
 text('VENCIMENTO',360,y+23,10,true,teal);text(date(data.dueDate),360,y-10,15,true);
 y-=85;y=text('PAGAMENTO',48,y,10,true,teal)-8;
 y=text('Favorecido: '+data.officeName,48,y);
 if(data.officeTaxId)y=text('CPF/CNPJ: '+data.officeTaxId,48,y);
 y=text(data.pixKey?'Chave Pix: '+data.pixKey:'Solicite os dados para pagamento ao seu contador.',48,y);
 if(data.billingContact)y=text('Contato: '+data.billingContact,48,y);
 text('AVISO: Este documento nao confirma recebimento ou quitacao.',48,127,10,true,navy);
 text('Demonstracao - nenhum envio automatico foi realizado.',48,106,9,false,muted);
 text('Emitido em '+new Date().toLocaleDateString('pt-BR'),48,76,9,false,muted);
 return pdf.save();
}
