import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

export type ChargeInfo = {
  officeName: string; officeTaxId?:string; pixKey?:string; billingContact?:string;
  clientName:string; company?:string; clientTaxId?:string;
  service:string; amount:number; dueDate:string; issueDate?:string;
  logoPath?:string|null; logoPng?:Uint8Array;
};
function clean(value:string|undefined, limit=160) {
  return (value||'').replace(/[\r\n\t]/g,' ').replace(/[^\x20-\x7E\u00A0-\u00FF]/g,'').trim().slice(0,limit);
}
function fmtDate(iso:string){
  const [y,m,d]=iso.split('-');return [d,m,y].join('/');
}

export function referenceMonth(dueDate:string):string {
  const [year,month]=dueDate.split('-').map(Number);
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)
    throw new Error('Mês de vencimento inválido');
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return months[(month+10)%12]+'/'+(month===1?year-1:year);
}

function brl(value:number){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
}
export async function createChargePdf(input:ChargeInfo):Promise<Uint8Array> {
  if(!Number.isFinite(input.amount)||input.amount<0)throw new Error('Valor inválido');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))throw new Error('Vencimento inválido');
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([595.28,841.89]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(.07,.13,.23), teal=rgb(.04,.54,.45), muted=rgb(.36,.43,.50);
  const W=page.getWidth();
  const text=(s:string,x:number,y:number,size=11,heavy=false,color=navy)=>
    page.drawText(clean(s),{x,y,size,font:heavy?bold:font,color});
  const line=(y:number)=>page.drawLine({start:{x:48,y},end:{x:W-48,y},thickness:1,color:rgb(.87,.90,.92)});
  const wrap=(raw:string,x:number,y:number,max:number,size=11)=>{
    let row='';for(const word of clean(raw,300).split(/\s+/)) {
      const attempt=row?row+' '+word:word;
      if(font.widthOfTextAtSize(attempt,size)>max&&row){text(row,x,y,size);y-=18;row=word;}
      else row=attempt;
    }if(row){text(row,x,y,size);y-=18;}return y;
  };
  page.drawRectangle({x:0,y:770,width:W,height:72,color:navy});
  // Identidade visual compacta: logo à esquerda e textos ao lado.
  // Mantém a proporção sem alterar nenhuma outra seção do PDF.
  let headerX=48;
  if(input.logoPng?.length){
    try{
      const logo=await pdf.embedPng(input.logoPng);
      const box={x:48,y:778,width:82,height:54};
      const scale=Math.min(box.width/logo.width,box.height/logo.height);
      const w=logo.width*scale,h=logo.height*scale;
      page.drawImage(logo,{
        x:box.x+(box.width-w)/2,y:box.y+(box.height-h)/2,
        width:w,height:h
      });
      headerX=145;
    }catch{ /* Uma imagem inválida não impede a emissão do documento. */ }
  }
  const headerTitle=clean(input.officeName,80).toUpperCase();
  const availableWidth=W-headerX-48;
  let titleSize=17;
  while(titleSize>10&&bold.widthOfTextAtSize(headerTitle,titleSize)>availableWidth)titleSize-=.5;
  text(headerTitle,headerX,803,titleSize,true,rgb(1,1,1));
  text('COBRANCA DE HONORARIOS CONTABEIS',headerX,783,10,false,rgb(.66,.91,.86));
  text('AVISO DE COBRANCA',48,733,20,true);
  text('Documento de cobranca - pagamento ainda nao confirmado',48,711,10,false,muted);
  line(693);
  text('DADOS DO PAGADOR',48,667,10,true,teal);
  let y=643;
  y=wrap('Cliente: '+input.clientName,48,y,500,12);
  if(input.company)y=wrap('Empresa: '+input.company,48,y,500);
  if(input.clientTaxId)y=wrap('CPF/CNPJ: '+input.clientTaxId,48,y,500);
  line(y-8);
  y-=39;
  text('DESCRICAO DOS SERVICOS',48,y,10,true,teal);y-=26;
  y=wrap(input.service||'Honorarios contabeis',48,y,500,12);
  text('Mês de referência: '+referenceMonth(input.dueDate),48,y-4,11,true,navy);
  // Reserva espaço para a referência antes do quadro de valor: sem sobreposição.
  y-=70;
  page.drawRectangle({x:48,y:y-36,width:W-96,height:92,color:rgb(.94,.98,.97),borderColor:rgb(.80,.90,.87),borderWidth:1});
  text('VALOR A PAGAR',66,y+30,10,true,teal);
  text(brl(input.amount),66,y,24,true,navy);
  text('VENCIMENTO',356,y+30,10,true,teal);
  text(fmtDate(input.dueDate),356,y,16,true,navy);
  y-=86;
  text('DADOS PARA PAGAMENTO',48,y,10,true,teal);y-=23;
  y=wrap('Favorecido: '+input.officeName,48,y,500);
  if(input.officeTaxId)y=wrap('CPF/CNPJ do favorecido: '+input.officeTaxId,48,y,500);
  if(input.pixKey)y=wrap('Chave Pix: '+input.pixKey,48,y,500);
  else y=wrap('Solicite ao escritorio os dados para pagamento.',48,y,500);
  if(input.billingContact)y=wrap('Contato: '+input.billingContact,48,y,500);
  line(Math.min(y-8,232));
  text('IMPORTANTE',48,196,10,true,teal);
  wrap('Este documento e um aviso de cobranca e nao comprova pagamento ou quitacao. A confirmacao do pagamento deve ser realizada pelo escritorio.',48,174,500,10);
  line(89);
  text('Emitido em '+fmtDate(input.issueDate||new Date().toISOString().slice(0,10)),48,66,9,false,muted);
  text('ContabFlow | Aviso de cobranca',384,66,9,false,muted);
  pdf.setTitle('Cobranca de honorarios - '+clean(input.clientName));
  pdf.setSubject('Aviso de cobranca - nao e recibo de pagamento');
  return pdf.save();
}
