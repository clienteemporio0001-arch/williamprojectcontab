import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

export type ConnectionCheck = {ok:boolean;message:string};
export async function checkSupabaseConnection():Promise<ConnectionCheck>{
  if(!url||!key)return {ok:false,message:'O Supabase não está configurado nesta versão do site.'};
  let endpoint:URL;
  try{endpoint=new URL('/auth/v1/health',url);}
  catch{return {ok:false,message:'A URL do projeto Supabase está inválida. Confira VITE_SUPABASE_URL no GitHub.'};}
  try{
    const response=await fetch(endpoint.toString(),{
      method:'GET',
      headers:{apikey:key,Accept:'application/json'},
      cache:'no-store',
      signal:AbortSignal.timeout(8000)
    });
    if(response.ok)return {ok:true,message:'Conexão com a API de autenticação do Supabase funcionando. Você pode tentar cadastrar a conta.'};
    if(response.status===401||response.status===403)
      return {ok:false,message:'O servidor Supabase respondeu, mas rejeitou a autenticação. Confira a chave pública e se ela pertence ao mesmo projeto.'};
    if(response.status===429)
      return {ok:false,message:'O Supabase respondeu, porém há um limite temporário de solicitações. Aguarde antes de tentar novamente.'};
    return {ok:false,message:'O Supabase respondeu com HTTP '+response.status+'. Confira se o projeto está ativo e verifique os logs de autenticação.'};
  }catch(error){
    if(error instanceof Error&&error.name==='TimeoutError')
      return {ok:false,message:'O Supabase demorou mais de 8 segundos para responder. Verifique a rede, o endereço do projeto e se ele está ativo.'};
    return {ok:false,message:'Não foi possível alcançar a API do Supabase. Confira a URL do projeto e teste em uma janela anônima ou em outra conexão (por exemplo, dados móveis).'};
  }
}
