import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,ExternalLink,Loader2,MessageCircle,ShieldAlert,Unplug,XCircle} from 'lucide-react';
import {supabase} from './lib/supabase';

type ConnectionState={
  display_phone_number:string;
  verified_name:string;
  connection_status:'connected'|'pending'|'error';
  last_error?:string|null;
};
type MetaLoginResponse={
  authResponse?:{code?:string;accessToken?:string};
  code?:string;
  status?:string;
};
type MetaSdk={
  init:(options:Record<string,unknown>)=>void;
  login:(callback:(r:MetaLoginResponse)=>void,options:Record<string,unknown>)=>void;
};
declare global{interface Window{FB?:MetaSdk;}}
const appId=import.meta.env.VITE_META_APP_ID||'';
const configId=import.meta.env.VITE_META_CONFIG_ID||'';
const MAX_SIGNUP_MS=180_000;
const MISSING_WHATSAPP_SESSION_MS=2_000;
const ALLOWED_META_EVENTS=new Set([
  'FINISH','FINISH_ONLY_WABA','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_OBO_MIGRATION','FINISH_GRANT_ONLY_API_ACCESS'
]);

async function invokeErrorMessage(error:unknown,fallback:string):Promise<string>{
  const err=error as {context?:{json?:()=>Promise<unknown>};message?:string}|null;
  if(err?.context?.json){
    try{
      const response=await err.context.json() as {error?:unknown};
      if(typeof response?.error==='string'&&response.error.length>0){
        return response.error.slice(0,350);
      }
    }catch{ /* resposta do servidor não disponível */ }
  }
  return fallback;
}

export default function WhatsAppConnectionPanel({
  orgId,onStatusChange
}:{
  orgId:string|null;
  onStatusChange?:(connected:boolean)=>void;
}){
  const [sdkReady,setSdkReady]=useState(false);
  const [serverReady,setServerReady]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [status,setStatus]=useState<ConnectionState|null>(null);
  const [error,setError]=useState('');
  const [existingBusinessApp,setExistingBusinessApp]=useState(false);
  const info=useRef<{code?:string;waba?:string;phone?:string}>({});
  const submitting=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const sessionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const flowId=useRef(0);
  const configured=Boolean(appId&&configId&&supabase);

  const clearTimer=useCallback(()=>{
    if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}
  },[]);
  const clearSessionTimer=useCallback(()=>{
    if(sessionTimer.current!==null){clearTimeout(sessionTimer.current);sessionTimer.current=null;}
  },[]);
  const stopFlow=useCallback((message='')=>{
    flowId.current+=1;
    clearTimer();
    clearSessionTimer();
    info.current={};
    submitting.current=false;
    setBusy(false);
    setProgress('');
    if(message)setError(message);
  },[clearSessionTimer,clearTimer]);

  useEffect(()=>()=>{flowId.current+=1;clearTimer();clearSessionTimer();},[clearSessionTimer,clearTimer]);

  const refresh=useCallback(async()=>{
    if(!supabase||!orgId)return;
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'status',org_id:orgId}
    });
    if(e||data?.error){
      setServerReady(null);
      setError(data?.error||await invokeErrorMessage(e,
        'Não foi possível consultar a conexão. Confira sua sessão e o responsável pelo escritório.'));
      onStatusChange?.(false);
      return;
    }
    const missing=Array.isArray(data?.configuration?.missing)
      ?(data.configuration.missing as unknown[]).filter((name):name is string=>typeof name==='string')
      :[];
    setServerReady(missing.length===0);
    setError(missing.length
      ?'Credenciais pendentes no Supabase: '+missing.join(', ')+'. Corrija em Edge Functions > Secrets.'
      :'');
    const connection=(data?.connection||null) as ConnectionState|null;
    setStatus(connection);
    onStatusChange?.(connection?.connection_status==='connected');
  },[orgId,onStatusChange]);

  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!configured)return;
    let disposed=false;
    const scriptId='contabflow-facebook-sdk';
    const init=()=>{
      if(disposed||!window.FB)return;
      window.FB.init({appId,autoLogAppEvents:false,xfbml:false,version:'v26.0'});
      setSdkReady(true);
    };
    if(window.FB){init();return;}
    let script=document.getElementById(scriptId) as HTMLScriptElement|null;
    if(!script){
      script=document.createElement('script');
      script.id=scriptId;
      script.src='https://connect.facebook.net/pt_BR/sdk.js';
      script.async=true;
      document.body.appendChild(script);
    }
    script.addEventListener('load',init);
    return()=>{disposed=true;script?.removeEventListener('load',init);};
  },[configured]);

  const attemptComplete=useCallback(async()=>{
    const {code,waba='',phone=''}=info.current;
    if(!code||!orgId||!supabase||submitting.current)return;
    submitting.current=true;
    const activeFlow=flowId.current;
    setProgress('Autorização recebida. Registrando o número com segurança...');
    try{
      const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
        body:{action:'connect',org_id:orgId,code,waba_id:waba,phone_number_id:phone}
      });
      if(e||data?.error)throw Error(data?.error||
        await invokeErrorMessage(e,'O servidor não conseguiu finalizar a conexão. Confira sua conta no Supabase.'));
      if(activeFlow!==flowId.current)return;
      setStatus(data.connection as ConnectionState);
      onStatusChange?.(data.status==='connected');
      stopFlow();
      if(data.status!=='connected'){
        setError('O número foi autorizado, mas a assinatura de webhooks ainda está pendente. Confira o aviso acima.');
      }else{
        setError('');
      }
    }catch(e){
      if(activeFlow===flowId.current)stopFlow(
        e instanceof Error?e.message:'Falha na conexão. Tente novamente.'
      );
    }finally{
      if(activeFlow===flowId.current)submitting.current=false;
    }
  },[orgId,onStatusChange,stopFlow]);

  useEffect(()=>{
    const onMessage=(event:MessageEvent)=>{
      let host='';
      try{host=new URL(event.origin).hostname;}catch{return;}
      if(host!=='facebook.com'&&!host.endsWith('.facebook.com'))return;
      let payload:unknown;
      try{payload=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
      if(!payload||typeof payload!=='object')return;
      const data=payload as {type?:string;event?:string;data?:Record<string,unknown>};
      if(data.type!=='WA_EMBEDDED_SIGNUP'||!busy)return;
      if(data.event==='CANCEL'||data.event==='ERROR'){
        stopFlow(data.event==='CANCEL'?
          'A autorização foi cancelada na Meta. Nenhum número foi conectado.':
          'A Meta informou um problema no cadastro do WhatsApp. Revise a conta e tente novamente.');
        return;
      }
      if(!ALLOWED_META_EVENTS.has(String(data.event)))return;
      const waba=String(data.data?.waba_id||'');
      const phone=String(data.data?.phone_number_id||'');
      if(!waba){
        stopFlow('A Meta não informou a conta WhatsApp (WABA). Abra novamente e escolha Editar configurações para selecionar a empresa e o número.');
        return;
      }
      clearSessionTimer();
      info.current={...info.current,waba,phone};
      setProgress(info.current.code?
        'Número e autorização recebidos. Concluindo conexão...':
        'Número selecionado. Aguardando confirmação final da Meta...');
      void attemptComplete();
    };
    window.addEventListener('message',onMessage);
    return()=>window.removeEventListener('message',onMessage);
  },[attemptComplete,busy,clearSessionTimer,stopFlow]);

  function connect(){
    if(!window.FB||!configId||busy||!orgId)return;
    flowId.current+=1;
    const activeFlow=flowId.current;
    info.current={};
    submitting.current=false;
    setError('');
    setProgress('Conclua a seleção do número na janela da Meta. Você pode cancelar aqui se a janela fechar.');
    setBusy(true);
    clearTimer();
    clearSessionTimer();
    timer.current=setTimeout(()=>{
      if(activeFlow!==flowId.current)return;
      stopFlow('Não recebemos todas as confirmações da Meta. A tentativa foi encerrada para evitar travamento. Confira se selecionou e verificou um número.');
    },MAX_SIGNUP_MS);
    try{
      window.FB.login((response)=>{
        if(activeFlow!==flowId.current)return;
        const code=response?.authResponse?.code||response?.code;
        if(!code){
          stopFlow(response?.authResponse?.accessToken?
            'A Meta retornou um token de login, mas não o código de autorização exigido. Verifique a configuração Embedded Signup no Meta for Developers.':
            'A Meta não concluiu a autorização. Confira a janela do Facebook, as permissões e o cadastro do número.');
          return;
        }
        info.current={...info.current,code};
        setProgress(info.current.waba?
          'Autorização e conta WhatsApp recebidas. Concluindo conexão...':
          'Login autorizado. Verificando se a Meta concedeu acesso a um número WhatsApp...');
        if(!info.current.waba){
          clearSessionTimer();
          sessionTimer.current=setTimeout(()=>{
            if(activeFlow!==flowId.current||info.current.waba)return;
            setProgress('Consultando as contas WhatsApp autorizadas diretamente na Meta...');
            void attemptComplete();
          },MISSING_WHATSAPP_SESSION_MS);
        }
        void attemptComplete();
      },{
        config_id:configId,
        auth_type:'rerequest',
        response_type:'code',
        override_default_response_type:true,
        extras:existingBusinessApp
          ?{setup:{},featureType:'whatsapp_business_app_onboarding'}
          :{setup:{}}
      });
    }catch{
      if(activeFlow===flowId.current)stopFlow('Não foi possível abrir a janela da Meta. Verifique a permissão de pop-ups do navegador.');
    }
  }

  async function disconnect(){
    if(!orgId||!supabase||busy)return;
    if(!window.confirm('Desconectar este WhatsApp do ContabFlow? Os próximos lembretes serão interrompidos.'))return;
    setBusy(true);setError('');
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'disconnect',org_id:orgId}
    });
    setBusy(false);
    if(e||data?.error){
      setError(data?.error||await invokeErrorMessage(e,'Não foi possível desconectar'));
      return;
    }
    setStatus(null);onStatusChange?.(false);
  }

  return <div className="stack gap-lg">
    <div className="integration-status">
      <span className="integration-icon"><MessageCircle size={20}/></span>
      <div><strong>WhatsApp próprio de cada escritório</strong>
        <p>O contador autoriza seu número pela Meta. As mensagens são enviadas pelo servidor, sem WhatsApp Web ou computador ligado.</p>
      </div>
    </div>
    {status?.connection_status==='connected'?<div className="integration-status">
      <CheckCircle2 color="#45d8ad" size={24}/>
      <div><strong>Conexão autorizada: {status.display_phone_number}</strong>
        <p>{status.verified_name||'Número do escritório'} · API da Meta vinculada. O envio exige template aprovado, assinatura ativa e agendamento configurado.</p>
      </div>
    </div>:status?<div className="integration-status">
      <ShieldAlert size={23}/><div><strong>Conexão pendente: {status.display_phone_number}</strong>
        <p>{status.last_error||'Verifique registro do número e assinatura de webhooks na Meta.'}</p>
      </div>
    </div>:<p className="subtle small">Nenhum WhatsApp conectado a este escritório.</p>}
    {!configured&&<p className="subtle small">O Admin Master deve cadastrar o App ID e Configuration ID na publicação GitHub Pages. A Meta também exige autorização para conectar números de outros escritórios.</p>}
    <label className="check-card">
      <input type="checkbox" checked={existingBusinessApp} onChange={e=>setExistingBusinessApp(e.target.checked)} disabled={busy}/>
      <span><strong>Este número já usa o aplicativo WhatsApp Business</strong>
        <small>Tentar coexistência quando permitida pela Meta. Não exclua a conta do aplicativo.</small>
      </span>
    </label>
    <button type="button" className="btn primary" onClick={connect} disabled={!configured||!sdkReady||busy||!orgId||serverReady===false}>
      {busy?<Loader2 size={16}/>:<MessageCircle size={16}/>}
      {busy?'Conectando com a Meta...':status?'Reconectar meu WhatsApp Business':'Conectar meu WhatsApp Business'}
    </button>
    {busy&&<div className="stack" style={{gap:8}}>
      <p className="subtle small" role="status">{progress}</p>
      <button className="btn ghost" type="button" onClick={()=>stopFlow('Conexão cancelada no ContabFlow. Se a janela da Meta continuar aberta, feche-a antes de tentar novamente.')}>
        <XCircle size={16}/> Cancelar conexão
      </button>
    </div>}
    {!sdkReady&&configured&&<p className="subtle small">Inicializando login seguro da Meta...</p>}
    {status&&!busy&&<button type="button" className="btn ghost" onClick={disconnect}>
      <Unplug size={16}/> Desconectar número
    </button>}
    {error&&<p role="alert" className="error-message">{error}</p>}
    {serverReady===false&&<button type="button" className="btn ghost" onClick={()=>{void refresh();}} disabled={busy}>
      Verificar credenciais novamente
    </button>}
    <p className="subtle small">Nenhum token é exibido no painel. A autorização é individual e não dá acesso a conversas particulares. Se não conseguir conectar, confira as permissões de Provedor de Tecnologia na Meta.</p>
    <a className="external-link" href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
      Configurar autorização do aplicativo na Meta <ExternalLink size={15}/>
    </a>
  </div>;
}
