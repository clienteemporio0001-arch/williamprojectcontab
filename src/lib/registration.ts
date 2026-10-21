export function digits(value:string){return value.replace(/\D/g,'');}
export function normalizeBrazilPhone(raw:string):string|null{
  const compact=digits(raw);
  const withCountry=compact.startsWith('55')&&compact.length>=12?compact:'55'+compact;
  if(!/^55[1-9]\d{9,10}$/.test(withCountry))return null;
  return withCountry;
}
export function validCNPJ(value:string):boolean{
  const cnpj=digits(value);
  if(!/^\d{14}$/.test(cnpj)||/^(\d)\1{13}$/.test(cnpj))return false;
  const check=(length:number)=>{
    const weights=length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum=weights.reduce((n,w,i)=>n+Number(cnpj[i])*w,0);
    const rem=sum%11;
    return rem<2?0:11-rem;
  };
  return Number(cnpj[12])===check(12)&&Number(cnpj[13])===check(13);
}
export function signupErrorMessage(raw:string):string{
  const message=raw.toLowerCase();
  if(/security purposes|after \d+ second|rate limit|too many requests|over_email_send_rate_limit|email rate limit|request.*after/i.test(message)){
    const seconds=raw.match(/(\d+)\s*(?:seconds?|segundos?)/i)?.[1];
    return 'O Supabase ativou um limite temporário de segurança. Aguarde '+(seconds?seconds+' segundos':'alguns instantes')+' e tente novamente apenas uma vez. Confira também se chegou um e-mail de confirmação.';
  }
  if(/already registered|user already exists|already exists/i.test(message))return 'Este e-mail pode já ter uma conta. Experimente entrar ou recuperar a senha.';
  if(/email not confirmed/i.test(message))return 'Confirme seu endereço de e-mail antes de entrar. Verifique também a pasta Spam.';
  if(/invalid login credentials/i.test(message))return 'E-mail ou senha incorretos. Confirme os dados e tente novamente.';
  if(/password.*(weak|short|6 char)/i.test(message))return 'Sua senha não atende aos requisitos do Supabase. Escolha uma senha mais forte.';
  return raw;
}
