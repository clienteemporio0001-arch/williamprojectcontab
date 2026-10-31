// Compacta a identidade visual no navegador: nenhuma Edge Function ou transformação de imagem.
// Transparência é preservada. O limite de 80 KiB impede uploads pesados no Storage.
export const LOGO_MAX_BYTES=80*1024;
export const LOGO_MAX_DIMENSION=500;
export async function compressOfficeLogo(file:File):Promise<Blob>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))
    throw new Error('Selecione uma imagem PNG, JPG ou WebP.');
  if(file.size>5*1024*1024)
    throw new Error('A imagem original deve ter no máximo 5 MB.');
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file);}
  catch{throw new Error('Não foi possível abrir a imagem selecionada.');}
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width>8192||bitmap.height>8192)
      throw new Error('As dimensões da imagem não são suportadas.');
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Seu navegador não oferece suporte à compactação de imagens.');
    let maxDimension=LOGO_MAX_DIMENSION;
    for(let attempt=0;attempt<10;attempt++){
      const ratio=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
      canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>
        canvas.toBlob(value=>value?resolve(value):reject(new Error('Falha ao converter imagem.')),'image/png'));
      if(blob.size<=LOGO_MAX_BYTES)return blob;
      maxDimension=Math.round(maxDimension*.78);
      if(maxDimension<85)break;
    }
    throw new Error('Esta imagem tem muitos detalhes para caber em 80 KB como PNG. Escolha uma logo mais simples, preferencialmente sem fundo.');
  }finally{bitmap.close();}
}
